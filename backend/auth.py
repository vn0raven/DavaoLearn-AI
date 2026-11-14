"""Litera email sign-in and server-side sessions."""
import hashlib
import logging
import os
import secrets
import smtplib
import sqlite3
import ssl
import string
import time
from contextlib import contextmanager
from email.message import EmailMessage
from email.utils import formataddr
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from email_validator import EmailNotValidError, validate_email
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator

LOG = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
COOKIE_NAME = "litera_session"
PASSWORD_LIFETIME = 15 * 60
SESSION_LIFETIME = 8 * 60 * 60
INVALID_PASSWORD = "That temporary password is incorrect or expired. Check your latest email or request a new password."


class EmailRequest(BaseModel):
    email: str = Field(max_length=254)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        try:
            return validate_email(value.strip(), check_deliverability=False, allow_smtputf8=False).ascii_email
        except EmailNotValidError as exc:
            raise ValueError("Enter a valid email address.") from exc


class PasswordRequest(EmailRequest):
    purpose: Literal["signup", "login"]
    password: str = Field(min_length=1, max_length=64)


def digest(value: str) -> str:
    # Inputs are generated high-entropy secrets or rate-limit keys.
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def gmail_sender():
    load_dotenv(PROJECT_ROOT / ".env")
    address = os.getenv("GMAIL_USER", "").strip()
    app_password = "".join(os.getenv("GMAIL_APP_PASSWORD", "").split())
    if not address or not app_password:
        return None

    def send(recipient: str, password: str) -> None:
        email = EmailMessage()
        email["From"] = formataddr(("Litera", address))
        email["To"] = recipient
        email["Subject"] = "Your Litera temporary password"
        email.set_content(
            f"Your temporary password is {password}\n\n"
            "Enter it on the Litera page where you requested it. "
            "This password expires after 15 minutes and works once.\n\n"
            "If you did not request this email, you can ignore it."
        )
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=12, context=ssl.create_default_context()) as client:
            client.login(address, app_password)
            client.send_message(email, from_addr=address, to_addrs=[recipient])

    return send


class EmailAuth:
    def __init__(self, database, send_password):
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.send_password = send_password
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS accounts (
                    email TEXT PRIMARY KEY,
                    learner_id TEXT NOT NULL UNIQUE
                );
                CREATE TABLE IF NOT EXISTS challenges (
                    email TEXT PRIMARY KEY,
                    purpose TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    expires_at INTEGER NOT NULL,
                    delivered INTEGER NOT NULL DEFAULT 0,
                    attempts INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    email TEXT NOT NULL REFERENCES accounts(email),
                    expires_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS rate_events (
                    action TEXT NOT NULL,
                    subject TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS rate_lookup ON rate_events (action, subject, created_at);
                CREATE INDEX IF NOT EXISTS rate_expiry ON rate_events (created_at);
            """)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.database)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def rate_limit(self, db, action, subject, now, window, limit):
        count = db.execute(
            "SELECT COUNT(*) FROM rate_events WHERE action = ? AND subject = ? AND created_at > ?",
            (action, subject, now - window),
        ).fetchone()[0]
        if count >= limit:
            raise HTTPException(429, "Too many requests. Wait a little before trying again.")
        db.execute("INSERT INTO rate_events VALUES (?, ?, ?)", (action, subject, now))

    def issue(self, email: str, purpose: str, ip: str) -> None:
        if self.send_password is None:
            raise HTTPException(503, "Email sign-in is unavailable until the app's Gmail sender is configured.")
        now = int(time.time())
        alphabet = string.ascii_letters + string.digits
        password = "".join(secrets.choice(alphabet) for _ in range(20))
        password_hash = digest(password)
        email_key = digest(email)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM rate_events WHERE created_at <= ?", (now - PASSWORD_LIFETIME,))
            db.execute("DELETE FROM challenges WHERE expires_at <= ?", (now,))
            self.rate_limit(db, "send-ip", ip, now, PASSWORD_LIFETIME, 10)
            account = db.execute("SELECT learner_id FROM accounts WHERE email = ?", (email,)).fetchone()
            if (account is None) != (purpose == "signup"):
                return
            self.rate_limit(db, "send-email", email_key, now, 60, 1)
            self.rate_limit(db, "send-total", "", now, PASSWORD_LIFETIME, 40)
            db.execute(
                """INSERT INTO challenges (email, purpose, password_hash, expires_at) VALUES (?, ?, ?, ?)
                   ON CONFLICT(email) DO UPDATE SET purpose = excluded.purpose,
                   password_hash = excluded.password_hash, expires_at = excluded.expires_at,
                   delivered = 0, attempts = 0""",
                (email, purpose, password_hash, now + PASSWORD_LIFETIME),
            )
        try:
            self.send_password(email, password)
        except (OSError, smtplib.SMTPException, ValueError) as exc:
            LOG.warning("Temporary password delivery failed (%s)", type(exc).__name__)
            with self.connect() as db:
                db.execute("DELETE FROM challenges WHERE email = ? AND password_hash = ?", (email, password_hash))
            raise HTTPException(503, "Litera couldn't send the email. Wait a minute and try again.") from None
        with self.connect() as db:
            db.execute(
                "UPDATE challenges SET delivered = 1, expires_at = ? WHERE email = ? AND password_hash = ?",
                (int(time.time()) + PASSWORD_LIFETIME, email, password_hash),
            )

    def verify(self, data: PasswordRequest, ip: str, previous_token: str | None):
        now = int(time.time())
        token = secrets.token_urlsafe(32)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM rate_events WHERE created_at <= ?", (now - PASSWORD_LIFETIME,))
            self.rate_limit(db, "verify-ip", ip, now, PASSWORD_LIFETIME, 60)
            challenge = db.execute(
                """SELECT password_hash FROM challenges WHERE email = ? AND purpose = ?
                   AND delivered = 1 AND expires_at > ? AND attempts < 5""",
                (data.email, data.purpose, now),
            ).fetchone()
            if challenge is None:
                return None
            if not secrets.compare_digest(challenge["password_hash"], digest(data.password.strip())):
                db.execute("UPDATE challenges SET attempts = attempts + 1 WHERE email = ?", (data.email,))
                return None
            db.execute("DELETE FROM challenges WHERE email = ?", (data.email,))
            if data.purpose == "signup":
                db.execute("INSERT INTO accounts VALUES (?, ?)", (data.email, secrets.token_hex(16)))
            account = db.execute("SELECT learner_id FROM accounts WHERE email = ?", (data.email,)).fetchone()
            expires_at = now + SESSION_LIFETIME
            db.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
            if previous_token and len(previous_token) == 43:
                db.execute("DELETE FROM sessions WHERE token_hash = ?", (digest(previous_token),))
            db.execute("INSERT INTO sessions VALUES (?, ?, ?)", (digest(token), data.email, expires_at))
        return token, {"learnerId": account["learner_id"], "expiresAt": expires_at}

    def current_learner(self, request: Request):
        token = request.cookies.get(COOKIE_NAME)
        if token and len(token) == 43:
            with self.connect() as db:
                account = db.execute(
                    """SELECT learner_id, expires_at FROM sessions JOIN accounts USING (email)
                       WHERE token_hash = ? AND expires_at > ?""",
                    (digest(token), int(time.time())),
                ).fetchone()
            if account:
                return {"learnerId": account["learner_id"], "expiresAt": account["expires_at"]}
        raise HTTPException(401, "Log in to continue.")

    def sign_out(self, token: str | None) -> None:
        if token and len(token) == 43:
            with self.connect() as db:
                db.execute("DELETE FROM sessions WHERE token_hash = ?", (digest(token),))


def check_origin(request: Request):
    origin = request.headers.get("origin")
    if origin is not None and origin != f"{request.url.scheme}://{request.url.netloc}":
        raise HTTPException(403, "Open Litera directly to sign in.")


def auth_router(auth: EmailAuth):
    router = APIRouter(prefix="/api/auth")

    def send_for(data: EmailRequest, request: Request, response: Response, purpose: str):
        auth.issue(data.email, purpose, request.client.host if request.client else "")
        response.headers["Cache-Control"] = "no-store"
        return {"ok": True}

    @router.post("/signup", dependencies=[Depends(check_origin)])
    def signup(data: EmailRequest, request: Request, response: Response):
        return send_for(data, request, response, "signup")

    @router.post("/login", dependencies=[Depends(check_origin)])
    def login(data: EmailRequest, request: Request, response: Response):
        return send_for(data, request, response, "login")

    @router.post("/verify", dependencies=[Depends(check_origin)])
    def verify(data: PasswordRequest, request: Request, response: Response):
        result = auth.verify(data, request.client.host if request.client else "", request.cookies.get(COOKIE_NAME))
        if result is None:
            raise HTTPException(401, INVALID_PASSWORD)
        token, account = result
        response.headers["Cache-Control"] = "no-store"
        response.set_cookie(
            COOKIE_NAME, token, max_age=SESSION_LIFETIME, httponly=True,
            secure=request.url.scheme == "https", samesite="strict",
        )
        return account

    @router.get("/session")
    def session(response: Response, learner=Depends(auth.current_learner)):
        response.headers["Cache-Control"] = "no-store"
        return learner

    @router.post("/logout", dependencies=[Depends(check_origin)])
    def logout(request: Request, response: Response):
        auth.sign_out(request.cookies.get(COOKIE_NAME))
        response.headers["Cache-Control"] = "no-store"
        response.delete_cookie(COOKIE_NAME, httponly=True, secure=request.url.scheme == "https", samesite="strict")
        return {"ok": True}

    return router
