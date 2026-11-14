import os
import sys
import unittest
from pathlib import Path
from uuid import uuid4

from pydantic import ValidationError

from backend.comprehension import Form, load_forms
from backend.server import create_app

try:
    from fastapi.testclient import TestClient
except RuntimeError as error:
    raise RuntimeError("Install httpx to run the API tests.") from error

FORMS = load_forms()


def choices(form_id="COMP-A", num_correct=5):
    form = FORMS[form_id]
    return [
        {
            "questionId": question.questionId,
            "answerId": question.correctAnswerId if i < num_correct else
            next(choice.answerId for choice in question.choices if choice.answerId != question.correctAnswerId),
        }
        for i, question in enumerate(form.questions)
    ]


class ComprehensionTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(create_app())
        self.addCleanup(self.client.close)

    def start(self, form="COMP-A", learner="demo-001", session="session-1", mode="independent", event_id=None):
        event_id = event_id or uuid4().hex
        payload = {
            "eventId": event_id, "learnerId": learner, "sessionId": session,
            "formId": form, "difficultyTier": "short-text", "mode": mode,
        }
        return event_id, self.client.post("/api/comprehension/start", json=payload)

    def complete(self, event_id, responses, assisted=False, **extra):
        return self.client.post(f"/api/comprehension/{event_id}/complete", json={
            "responses": responses, "assisted": assisted, **extra,
        })

    def result_for(self, count, **start_options):
        event_id, opened = self.start(**start_options)
        self.assertEqual(opened.status_code, 200, opened.text)
        response = self.complete(event_id, choices(start_options.get("form", "COMP-A"), count))
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_all_correct(self):
        result = self.result_for(5)
        self.assertEqual((result["event"]["score"], result["incorrect"]), (100, 0))

    def test_all_incorrect(self):
        result = self.result_for(0)
        self.assertEqual((result["event"]["score"], result["incorrect"]), (0, 5))

    def test_mixed_results_and_metadata(self):
        result = self.result_for(4, form="COMP-B")
        event = result["event"]
        self.assertEqual((event["score"], event["correct"], event["total"]), (80, 4, 5))
        self.assertEqual((event["formId"], event["passageId"], event["passageVersion"]), ("COMP-B", "plant-labels", "1.0.0"))
        self.assertEqual((event["difficultyTier"], event["sessionId"], event["learnerId"]), ("short-text", "session-1", "demo-001"))
        self.assertTrue(event["timestamp"].endswith("Z"))
        self.assertEqual((result["quality"], result["incorrect"], result["unanswered"]), ("complete", 1, 0))
        self.assertEqual(len(result["responses"]), 5)
        self.assertEqual(set(result["treeCheck"]), {"skill", "kind", "form", "session", "tier", "correct", "total", "assisted", "usable"})

    def test_incomplete_is_not_graded_and_can_be_finished(self):
        event_id, _ = self.start()
        incomplete = self.complete(event_id, choices()[:-1])
        self.assertEqual(incomplete.status_code, 422)
        self.assertIn("Remaining: 1", incomplete.json()["detail"])
        self.assertNotIn("event", incomplete.json())
        self.assertEqual(self.complete(event_id, choices()).status_code, 200)

    def test_invalid_answer_and_question_ids(self):
        event_id, _ = self.start()
        for field in ("answerId", "questionId"):
            with self.subTest(field=field):
                responses = choices()
                responses[0][field] = "outside-form"
                self.assertEqual(self.complete(event_id, responses).status_code, 422)

    def test_duplicate_response(self):
        event_id, _ = self.start()
        responses = choices()
        self.assertEqual(self.complete(event_id, [*responses[:-1], responses[0]]).status_code, 422)

    def test_no_client_score_or_keys_in_public_routes(self):
        event_id, opened = self.start()
        listing = self.client.get("/api/comprehension/forms").json()
        self.assertNotIn("correctAnswerId", opened.text)
        self.assertNotIn("correctAnswerId", str(listing))
        self.assertNotIn("text", listing[0])
        self.assertNotIn("questions", listing[0])
        self.assertEqual(len(opened.json()["questions"]), 5)
        self.assertEqual(self.complete(event_id, choices(), score=100).status_code, 422)

    def test_assisted_mode_cannot_be_downgraded(self):
        result = self.result_for(5, mode="assisted")
        self.assertTrue(result["event"]["assisted"])
        self.assertTrue(result["treeCheck"]["assisted"])

    def test_help_during_independent_assessment(self):
        event_id, _ = self.start()
        result = self.complete(event_id, choices(), assisted=True).json()
        self.assertTrue(result["event"]["assisted"])
        self.assertTrue(result["treeCheck"]["assisted"])
        self.assertEqual(self.complete(event_id, choices(), assisted=False).status_code, 409)

    def test_interrupt_blocks_grading_and_consumes_exposure(self):
        event_id, _ = self.start()
        result = self.client.post(f"/api/comprehension/{event_id}/interrupt")
        self.assertEqual(result.status_code, 204)
        self.assertEqual(self.complete(event_id, choices()).status_code, 409)
        _, reopened = self.start(session="session-2")
        self.assertEqual(reopened.status_code, 409)
        self.assertEqual(self.start(form="COMP-B", session="session-2")[1].status_code, 200)

    def test_duplicate_event_is_idempotent_and_changed_answers_are_rejected(self):
        event_id, first_open = self.start()
        self.assertEqual(self.start(event_id=event_id)[1].json(), first_open.json())
        first = self.complete(event_id, choices())
        retry = self.complete(event_id, list(reversed(choices())))
        self.assertEqual(first.json(), retry.json())
        self.assertEqual(self.complete(event_id, choices(num_correct=4)).status_code, 409)

    def test_fresh_form_requires_separate_session_for_separate_usable_result(self):
        self.result_for(5)
        self.assertEqual(self.start(session="session-2")[1].status_code, 409)
        self.assertEqual(self.start(form="COMP-B")[1].status_code, 409)
        next_result = self.result_for(5, form="COMP-B", session="session-2")
        self.assertEqual(next_result["treeCheck"]["form"], "COMP-B")
        self.assertEqual(next_result["treeCheck"]["session"], "session-2")

    def test_concurrent_open_attempts_cannot_both_be_graded_in_one_session(self):
        first, _ = self.start()
        second, _ = self.start(form="COMP-B")
        self.assertEqual(self.complete(first, choices()).status_code, 200)
        self.assertEqual(self.complete(second, choices("COMP-B")).status_code, 409)

    def test_missing_identity_or_form(self):
        missing = self.client.post("/api/comprehension/start", json={
            "eventId": "example", "formId": "COMP-A", "difficultyTier": "short-text", "mode": "independent",
        })
        self.assertEqual(missing.status_code, 422)
        self.assertEqual(self.start(form="COMP-MISSING")[1].status_code, 404)

    def test_malformed_form_is_rejected(self):
        for problem in ("empty", "duplicate", "bad-key", "missing-key"):
            with self.subTest(problem=problem):
                form = FORMS["COMP-A"].model_dump()
                if problem == "empty":
                    form["questions"] = []
                elif problem == "duplicate":
                    form["questions"].append(form["questions"][0])
                elif problem == "bad-key":
                    form["questions"][0]["correctAnswerId"] = "missing"
                else:
                    del form["questions"][0]["correctAnswerId"]
                with self.assertRaises(ValidationError):
                    Form.model_validate(form)


@unittest.skipUnless(os.environ.get("LITERA_TREE_PATH"), "Set LITERA_TREE_PATH to an existing voice tester source folder.")
class ExistingTreeTests(unittest.TestCase):
    setUp = ComprehensionTests.setUp
    start = ComprehensionTests.start
    complete = ComprehensionTests.complete
    result_for = ComprehensionTests.result_for

    def test_existing_tree_uses_scores_around_cutoff(self):
        tree = self.tree_client()
        checks = [
            self.result_for(3, learner="demo-60")["treeCheck"],
            self.result_for(4, learner="demo-80")["treeCheck"],
            self.result_for(5, learner="demo-100")["treeCheck"],
        ]
        for check, expected in zip(checks, ("support", "unconfirmed", "ready")):
            with self.subTest(check=check):
                self.assertEqual(self.status(tree, [check]), expected)

        for count, expected in ((74, "support"), (75, "unconfirmed"), (79, "unconfirmed"),
                                (81, "unconfirmed"), (85, "unconfirmed"), (86, "ready")):
            with self.subTest(count=count):
                self.assertEqual(self.status(tree, [{**checks[1], "correct": count, "total": 100}]), expected)

    def test_existing_tree_confirms_fresh_independent_form_only(self):
        tree = self.tree_client()
        first = self.result_for(4)["treeCheck"]
        next_check = self.result_for(4, form="COMP-B", session="session-2")["treeCheck"]
        self.assertEqual(self.status(tree, [first, {**next_check, "assisted": True}]), "unconfirmed")
        self.assertEqual(self.status(tree, [first, next_check]), "ready")

    @staticmethod
    def tree_client():
        sys.path.insert(0, str(Path(os.environ["LITERA_TREE_PATH"]).resolve()))
        from voice.server import app
        return TestClient(app)

    def status(self, tree, checks):
        response = tree.post("/api/plan", json={"tier": "short-text", "checks": checks})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["evidence"]["comprehension"]["status"]
