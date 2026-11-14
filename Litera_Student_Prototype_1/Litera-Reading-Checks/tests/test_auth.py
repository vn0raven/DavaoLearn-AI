import smtplib
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.auth import COOKIE_NAME, PASSWORD_LIFETIME, EmailAuth, gmail_sender
from backend.server import create_app


class EmailAuthTest(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.database = Path(temp.name) / "accounts.sqlite3"
        self.inbox = []
        self.auth = EmailAuth(self.database, lambda email, password: self.inbox.append((email, password)))
        self.client = TestClient(create_app(self.auth))
        self.email = "reader@example.com"
        self.clock = self.enterContext(patch("backend.auth.time.time", return_value=1_800_000_000))

    def send(self, purpose="signup"):
        return self.client.post(f"/api/auth/{purpose}", json={"email": self.email})

    def verify(self, password, purpose="signup", client=None):
        return (client or self.client).post("/api/auth/verify", json={
            "email": self.email, "purpose": purpose, "password": password,
        })

    def test_signup_login_and_reading_access(self):
        self.assertEqual(self.client.get("/api/forms").status_code, 401)
        self.assertEqual(self.client.post("/api/oral/transcribe", files={"clip": ("test.webm", b"clip")}).status_code, 401)
        response = self.send()
        self.assertEqual(response.json(), {"ok": True})
        self.assertEqual(self.inbox[-1][0], self.email)
        password = self.inbox[-1][1]
        self.assertNotIn(password, response.text)
        self.assertEqual(self.client.get("/api/auth/session").status_code, 401)
        self.assertEqual(self.verify(password, "login").status_code, 401)
        verified = self.verify(password)
        self.assertEqual(verified.status_code, 200)
        learner_id = verified.json()["learnerId"]
        self.assertIn("HttpOnly", verified.headers["set-cookie"])
        self.assertIn("SameSite=strict", verified.headers["set-cookie"])
        self.assertEqual(self.verify(password).status_code, 401)
        form = self.client.get("/api/forms").json()[0]
        submission = {
            "eventId": "event-1", "learnerId": "other", "formId": form["formId"], "sessionId": "session-1",
            "judgments": [
                {"itemId": item["itemId"], "attemptId": f"attempt-{index}", "verdict": "CORRECT"}
                for index, item in enumerate(form["items"])
            ],
        }
        self.assertEqual(self.client.post("/api/phonics/complete", json=submission).status_code, 403)
        submission["learnerId"] = learner_id
        received = self.client.post("/api/phonics/complete", json=submission)
        self.assertEqual(received.status_code, 200, received.text)
        self.assertEqual(received.json()["event"]["correct"], 5)

        cookie = self.client.cookies.get(COOKIE_NAME)
        self.client = TestClient(create_app(EmailAuth(self.database, self.auth.send_password)))
        self.client.cookies.set(COOKIE_NAME, cookie)
        self.assertEqual(self.client.get("/api/auth/session").json()["learnerId"], learner_id)
        self.assertEqual(self.client.post("/api/auth/logout").status_code, 200)
        self.client.cookies.set(COOKIE_NAME, cookie)
        self.assertEqual(self.client.get("/api/forms").status_code, 401)
        self.clock.return_value += 61
        self.assertEqual(self.send("login").json(), {"ok": True})
        self.assertEqual(self.verify(password, "login").status_code, 401)
        self.assertEqual(self.verify(self.inbox[-1][1], "login").json()["learnerId"], learner_id)

    def test_resend_expiry_and_attempt_limit(self):
        self.assertEqual(self.send().status_code, 200)
        password = self.inbox[-1][1]
        self.assertEqual(self.send().status_code, 429)
        self.clock.return_value += 61
        self.assertEqual(self.send().status_code, 200)
        self.assertEqual(self.verify(password).status_code, 401)
        for _ in range(4):
            self.assertEqual(self.verify("wrong").status_code, 401)
        self.assertEqual(self.verify(self.inbox[-1][1]).status_code, 401)
        self.clock.return_value += 61
        self.send()
        self.clock.return_value += PASSWORD_LIFETIME
        self.assertEqual(self.verify(self.inbox[-1][1]).status_code, 401)

    def test_only_one_concurrent_verification_can_succeed(self):
        self.send()
        password = self.inbox[-1][1]
        clients = [TestClient(create_app(self.auth)) for _ in range(2)]
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda client: self.verify(password, client=client).status_code, clients))
        self.assertEqual(sorted(results), [200, 401])

    def test_failed_delivery_cannot_create_account(self):
        def failed_send(email, password):
            self.inbox.append((email, password))
            raise smtplib.SMTPDataError(451, b"Test error")

        self.auth.send_password = failed_send
        self.assertEqual(self.send().status_code, 503)
        self.assertEqual(self.verify(self.inbox[-1][1]).status_code, 401)
        self.assertEqual(self.send("login").json(), {"ok": True})
        self.assertEqual(len(self.inbox), 1)
        self.auth.send_password = None
        self.assertEqual(self.send().status_code, 503)

    def test_other_origins_cannot_request_email(self):
        response = self.client.post("/api/auth/signup", json={"email": self.email},
                                    headers={"Origin": "https://elsewhere.example"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.inbox, [])

    def test_gmail_sender_uses_tls_and_targets_learner_email(self):
        with patch("backend.auth.load_dotenv"), patch.dict("os.environ", {
            "GMAIL_USER": "sender@gmail.com", "GMAIL_APP_PASSWORD": "abcd efgh ijkl mnop",
        }), patch("backend.auth.smtplib.SMTP_SSL") as smtp:
            gmail_sender()(self.email, "temporary-test-password")

        self.assertEqual(smtp.call_args.args, ("smtp.gmail.com", 465))
        client = smtp.return_value.__enter__.return_value
        client.login.assert_called_once_with("sender@gmail.com", "abcdefghijklmnop")
        email = client.send_message.call_args.args[0]
        self.assertEqual(client.send_message.call_args.kwargs["to_addrs"], [self.email])
        self.assertIn("temporary-test-password", email.get_content())


if __name__ == "__main__":
    unittest.main()
