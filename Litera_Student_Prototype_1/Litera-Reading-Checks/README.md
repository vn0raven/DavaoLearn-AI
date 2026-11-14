# Litera Reading Checks

This prototype adds a student lesson hub and read-aloud screen styled with the Litera logo palette. One reading session connects the five-word phonics check and teacher-marked oral reading. After email verification, Litera assigns an account-specific learner ID for scoring. Their assessment scores, form IDs and difficulty tiers stay separate.

## Run on Windows

1. Extract the ZIP. Install Python 3.11 or 3.12 if needed.
2. In the extracted project folder, run `Copy-Item .env.example .env` in PowerShell. Open `.env` and set `GMAIL_USER` to your sender's Gmail address and `GMAIL_APP_PASSWORD` to the Google App Password from that account. Google requires 2-Step Verification for app passwords. The setup page is https://myaccount.google.com/apppasswords.
3. Close older BasaBridge test servers using port 8765. Double-click `Start-Litera.cmd` and keep the terminal open. Open http://127.0.0.1:8765 in Chrome or Edge. The built frontend is included. Initial Python setup and the first speech model download need internet.
4. Select **Sign up** and enter the email address that should receive the temporary password. Check the inbox or spam folder, then enter the password in Litera. For later visits after logging out or when the session expires, select **Log in** to request a fresh password.

Gmail is the sender. Learners can sign up with any supported email address. Keep the sender credentials in the root `.env` file on the backend machine. Reload the backend after changing them. Gmail delivery uses TLS on port 465.

Each temporary password works once and expires after 15 minutes. Resending after the one-minute cooldown replaces the previous password. Accounts persist in `.litera-data/accounts.sqlite3`. The browser login lasts up to eight hours or until logout. Reading evidence stays in the active reading session. Export it before ending a session or logging out.

## Demo sequence

- **Phonics:** Complete five printed words by recording or listening live, then generate the evidence. Whisper provides a transcript for teacher review.
- **Oral reading:** From **My lessons**, choose a story and start a check. On the student screen, use **Start recording** and **Stop recording**. Litera transcribes the recording on the local backend, then marks matched words in mint and words to check again in coral. Use **Read again** for a new recording. **Listen to example** and **Listen to word** use the browser's English speech voice. Playing an example marks the session as practice for the scoring handoff.
- **Teacher review:** Select **Open teacher review** in the same tab. Replay the student recording, confirm or change the word marks, verify the assessment, then submit. For a live check, open teacher review without recording and mark each word manually. Record an optional teacher voice note separately.
- **Evidence:** Submit the teacher-verified results. Open **Scoring handoff JSON** to copy the separate events and independent checks for the same learner session. Assisted oral results remain in the event list and are excluded from the independent checks.

Teacher review takes place in the same session on the same device. Audio in the oral module is optional, stays in the tab, and is released when switching checks, ending the session, or reloading. Recording failures leave hand marking available. Export scoring JSON before ending the session. Only read-aloud clips are sent to the local backend for transcription. Teacher voice notes stay in the tab. Neither recordings nor transcripts are included in the scoring JSON. One mic can capture both speakers, so use consenting adults for the demo.

For a port conflict, run `.\.venv\Scripts\python.exe -m uvicorn backend.server:app --host 127.0.0.1 --port 8766` from the extracted folder, then open http://127.0.0.1:8766.

## Existing tree

Use `independentChecks` with the existing scoring adapter and merge by learner ID and event ID with the learner’s prior history. The existing endpoint evaluates one difficulty tier per request. Phonics uses `CVCC-final-nt`; oral reading uses `short-text`. Preserve both tiers and their histories. This combined demo exports the handoff but does not call the existing adaptive service. It does not change the decision tree, combine the scores into an average, or set a learner’s skill status.

The reading passages are original provisional demonstration materials. For the full oral rubric, see `ORAL-READING.md`.

## Development

Use Node.js 22.12 or newer to rebuild. From the project root run `npm --prefix frontend ci`, `npm --prefix frontend test`, and `npm --prefix frontend run build`. Start FastAPI with `python -m backend.server` after installing `backend/requirements.txt`. For React development, use `npm --prefix frontend run dev` with the backend on port 8765. To run the auth regressions, install `httpx` in the backend environment and run `python -m unittest discover -s tests` from the project root. The tests use a test sender instead of Gmail.
