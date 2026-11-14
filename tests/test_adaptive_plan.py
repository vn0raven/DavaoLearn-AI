import unittest

from fastapi.testclient import TestClient

from voice.server import app
from voice.tree import Evidence, PlanOverride, Skill, route


def snapshot(support=(), unconfirmed=(), missing=()):
    return {
        skill: Evidence(
            status="unconfirmed" if skill in missing or skill in unconfirmed else
            "support" if skill in support else "ready",
            score=None if skill in missing else 80 if skill in unconfirmed else 60 if skill in support else 95,
            raw_below=skill in support,
            recheck=False,
        )
        for skill in Skill
    }


class DecisionTreeTests(unittest.TestCase):
    def test_all_established_routes_and_activity_queue(self):
        cases = [
            ((), "MIXED_READING", "ROTATING_REVIEW"),
            (("comprehension",), "GUIDED_COMPREHENSION", "ORAL_REREADING"),
            (("oral",), "GUIDED_ORAL_READING", "CONNECTED_TEXT_MEANING"),
            (("oral", "comprehension"), "GUIDED_ORAL_READING", "SUPPORTED_COMPREHENSION"),
            (("phonics",), "PHONICS_BASED_LEARNING", "CONNECTED_TEXT_READING"),
            (("phonics", "comprehension"), "PHONICS_BASED_LEARNING", "GUIDED_COMPREHENSION"),
            (("phonics", "oral"), "PHONICS_BASED_LEARNING", "GUIDED_ORAL_READING"),
            (("phonics", "oral", "comprehension"), "PHONICS_BASED_LEARNING", "SUPPORTED_CONNECTED_TEXT_READING"),
        ]
        for gaps, primary, secondary in cases:
            with self.subTest(gaps=gaps):
                plan = route(snapshot(gaps))
                self.assertEqual(plan["activeGaps"], list(gaps))
                self.assertEqual(plan["primary"]["activityId"], primary)
                self.assertEqual(plan["secondary"]["activityId"], secondary)
                self.assertEqual(plan["queuedGaps"], list(gaps[2:]))
                self.assertEqual(plan["pendingRechecks"], list(gaps[2:]))
                self.assertEqual(plan["maintenanceSkills"], [skill for skill in Skill if skill not in gaps])
                self.assertTrue(plan["explanation"])
                self.assertEqual(plan, route(snapshot(gaps)))
                if len(gaps) == 3:
                    self.assertIn("meaning question", plan["secondary"]["purpose"])

    def test_missing_never_means_zero_or_support(self):
        evidence = snapshot(missing=tuple(Skill))
        evidence[Skill.PHONICS] = Evidence(status="support", score=None, raw_below=True, recheck=False)
        plan = route(evidence)
        self.assertEqual(plan["missingEvidence"], list(Skill))
        self.assertEqual(plan["pendingRechecks"], list(Skill))
        self.assertEqual(plan["readySkills"], [])
        self.assertEqual(plan["activeGaps"], [])
        self.assertEqual(plan["rawBelowCutoff"], [])
        self.assertIsNone(plan["skillEvidence"]["phonics"]["score"])
        self.assertEqual(plan["secondary"]["activityId"], "FRESH_INDEPENDENT_CHECK")

    def test_missing_and_uncertain_prerequisites_hold_accessible_route(self):
        for evidence in (snapshot(("oral",), missing=("phonics",)),
                         snapshot(("comprehension",), unconfirmed=("phonics", "oral"))):
            with self.subTest(evidence=evidence):
                plan = route(evidence)
                self.assertTrue(plan["teacherReviewRequired"])
                self.assertEqual(plan["primary"]["activityId"], "ACCESSIBLE_CURRENT_LEVEL_PRACTICE")
                self.assertEqual(plan["queuedGaps"], plan["activeGaps"])
                self.assertIn("phonics", plan["pendingRechecks"])
        plan = route(snapshot(unconfirmed=("oral", "comprehension")))
        self.assertEqual(plan["unconfirmedSkills"], ["oral", "comprehension"])

    def test_raw_disagreement_does_not_change_confirmed_route(self):
        evidence = snapshot(("phonics", "oral", "comprehension"))
        evidence[Skill.PHONICS] = Evidence(status="support", score=90, raw_below=False, recheck=True)
        evidence[Skill.ORAL] = Evidence(status="support", score=10, raw_below=True, recheck=False)
        self.assertEqual(route(evidence)["primary"]["skill"], "phonics")
        self.assertIn("phonics", route(evidence)["pendingRechecks"])
        evidence[Skill.PHONICS] = Evidence(status="ready", score=55, raw_below=True, recheck=True)
        self.assertEqual(route(evidence)["primary"]["skill"], "oral")
        evidence[Skill.ORAL] = Evidence(status="ready", score=96, recheck=False)
        self.assertEqual(route(evidence)["primary"]["skill"], "comprehension")
        self.assertEqual(route(evidence)["activeGaps"], ["comprehension"])

    def test_ready_with_reassessment_does_not_extend(self):
        evidence = snapshot()
        evidence[Skill.ORAL] = Evidence(status="ready", score=60, raw_below=True, recheck=True)
        plan = route(evidence)
        self.assertEqual(plan["primary"]["activityId"], "ACCESSIBLE_CURRENT_LEVEL_PRACTICE")
        self.assertEqual(plan["secondary"]["skill"], "oral")
        self.assertEqual(plan["pendingRechecks"], ["oral"])

    def test_print_access_and_stalled_support(self):
        plan = route(snapshot(("comprehension",)), print_accessible=False)
        self.assertEqual(plan["secondary"]["activityId"], "SUPPORTED_COMPREHENSION")
        self.assertTrue(plan["teacherReviewRequired"])
        self.assertEqual(plan["queuedGaps"], ["comprehension"])
        plan = route(snapshot(("phonics",)), support_stalled=True)
        self.assertTrue(plan["teacherReviewRequired"])
        self.assertIn("stalled", plan["explanation"])
        plan = route(snapshot(missing=("phonics",)), print_accessible=False)
        self.assertEqual(plan["secondary"]["activityId"], "SUPPORTED_COMPREHENSION")
        self.assertEqual(plan["pendingRechecks"], ["phonics"])

    def test_overrides_preserve_original_and_evidence(self):
        evidence = snapshot(("phonics", "oral"))
        tiers = {"phonics": "CVCC-final-nt", "oral": "short-text"}
        plan = route(evidence, tiers=tiers, override=PlanOverride(
            primaryActivityId="GUIDED_ORAL_READING", secondaryActivityId="ROTATING_REVIEW",
            primaryDifficultyTier="shorter-text", reason="Teacher observed fatigue.",
        ))
        self.assertEqual(plan["activeGaps"], ["phonics", "oral"])
        self.assertEqual(plan["algorithmicPlan"]["primary"]["activityId"], "PHONICS_BASED_LEARNING")
        self.assertEqual(plan["primary"]["difficultyTier"], "shorter-text")
        self.assertEqual(plan["secondary"]["activityId"], "ROTATING_REVIEW")
        self.assertEqual(plan["queuedGaps"], ["phonics"])
        self.assertEqual(evidence[Skill.PHONICS].status, "support")


class PlanEndpointTests(unittest.TestCase):
    def test_legacy_shape_and_validated_profile_shape(self):
        with TestClient(app) as client:
            result = client.post("/api/plan", json={"checks": []}).json()
            self.assertIsInstance(result["primary"], str)
            self.assertEqual(result["recheck"], list(Skill))
            evidence = {skill: value.model_dump() for skill, value in snapshot(("phonics",)).items()}
            response = client.post("/api/plan", json={
                "evidence": evidence, "learnerId": "demo-001",
                "selectedTiers": {"phonics": "CVCC-final-nt"}, "evidenceRefs": {"phonics": "e-001"},
            })
            self.assertEqual(response.status_code, 200)
            plan = response.json()["recommendation"]
            self.assertEqual(plan["learnerId"], "demo-001")
            self.assertEqual(plan["primary"]["difficultyTier"], "CVCC-final-nt")
            self.assertEqual(plan["skillEvidence"]["phonics"]["latestUsableEventId"], "e-001")

    def test_malformed_evidence_and_overrides_are_rejected(self):
        evidence = {skill: value.model_dump() for skill, value in snapshot().items()}
        with TestClient(app) as client:
            for payload in (
                {"evidence": {"phonics": evidence[Skill.PHONICS]}},
                {"evidence": {**evidence, "oral": {"status": "mastered", "score": 100}}},
                {"evidence": {**evidence, "oral": {"status": "ready", "score": -1}}},
                {"evidence": evidence, "checks": []},
                {"evidence": evidence, "override": {"reason": "  ", "secondaryActivityId": "ROTATING_REVIEW"}},
                {"evidence": evidence, "override": {"reason": "Example", "primaryActivityId": "UNKNOWN"}},
            ):
                with self.subTest(payload=payload):
                    self.assertEqual(client.post("/api/plan", json=payload).status_code, 422)
