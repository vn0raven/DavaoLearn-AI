# Litera Reading Checks

One demo session connects the five-word phonics check, teacher-marked oral reading and English reading comprehension. The checks share a fictional learner and session ID. Their assessment scores, form IDs and difficulty tiers stay separate.

## Run on Windows

1. Extract the ZIP. Install Python 3.11 or 3.12 if needed.
2. Close older BasaBridge test servers using port 8765. Double-click `Start-Litera.cmd` and keep the terminal open.
3. Open http://127.0.0.1:8765 in Chrome or Edge. The launcher builds the React frontend on first run (Node.js and internet are needed for npm installation). Initial Python setup and the first speech model download need internet. Both recorded checks use the local faster-whisper model.
4. Start a session with an adult teammate and a fictional learner ID.

## Demo sequence

- **Phonics:** Complete five printed words by recording or listening live, then generate the evidence. Whisper provides a transcript for teacher review.
- **Oral reading:** Switch to Oral reading and start a passage. Optionally record the read-aloud before opening the clean reading view. When you stop, Litera transcribes the passage and aligns the words. On the teacher screen, dashed green boxes are AI matches and dashed red boxes are possible substitutions or omissions. Replay the clip and correct individual boxes, or use **Confirm remaining AI marks** after reviewing them. The teacher verification step still applies. Record the teacher's voice note separately. The read-aloud uses one room microphone and may capture both people. It does not separate speakers. If the teacher prompts or models during the reading, select the appropriate assistance setting. A note recorded afterward is review material.
- **Comprehension:** Choose a passage the learner has not seen. Read independently, then answer all five questions. Use Previous and Next to revise answers before submission. Mark the attempt as assisted if the learner received help, or end it without submitting if the session was interrupted. FastAPI grades the submitted answers.
- **Practice:** Start a matching activity under **Session evidence → Recommended practice**, work through feedback, then try a fresh reading check. See [PRACTICE.md](PRACTICE.md) for content, storage, and Windows verification.
- **Evidence:** Submit the teacher-verified results. Open **Current session JSON (raw checks)** to copy the separate events and independent checks for the same learner session. Assisted oral and comprehension results remain in the event list and are excluded from the independent checks.

Audio in the oral module is optional, stays in the tab, and is released when switching checks, ending the session, or reloading. Recording failures leave hand marking available. Export scoring JSON before ending the session. Only read-aloud clips are sent to the local backend for transcription. Teacher voice notes stay in the tab. Neither recordings nor transcripts are included in the scoring JSON. One mic can capture both speakers, so use consenting adults for the demo.

For a port conflict, run `.\.venv\Scripts\python.exe -m uvicorn backend.server:app --host 127.0.0.1 --port 8766` from the extracted folder, then open http://127.0.0.1:8766.

## Evidence and existing tree

Completed results are stored by learner, skill, and tier in local SQLite. See **Recommended next steps** under Session evidence for the primary and secondary activities and the reason for each plan. Open **Saved evidence and decision-tree input** for the underlying evidence and queues. See [EVIDENCE.md](EVIDENCE.md) for evidence contracts and [ADAPTIVE-PLAN.md](ADAPTIVE-PLAN.md) for routing, overrides, and Windows verification. Keep the repository's `voice/` and `litera-reading-checks/` directories side by side.

The reading passages are original provisional demonstration materials. For the oral rubric, see `ORAL-READING.md`. For the new assessment API, repeat rules and Windows verification, see `COMPREHENSION.md`.

## Development

Use Node.js 22.12 or newer to rebuild. From the project root run `npm --prefix frontend ci`, `npm --prefix frontend test`, and `npm --prefix frontend run build`. Start FastAPI with `python -m backend.server` after installing `backend/requirements.txt`. For React development, use `npm --prefix frontend run dev` with the backend on port 8765.

## Phase A–F educational integration enhancement (November 15, 2026)

The enhanced ZIP adds three-step teacher-authored guided hints, response-grounded feedback labels, a private **Word Village / Story Forest / Meaning Mountain** quest map, reading accessibility controls, and a **localhost-only teacher evidence view**. It retains the existing assessment/scoring/decision-tree behavior and separately stores teacher recommendation overrides. See [IMPLEMENTATION-AUDIT.md](IMPLEMENTATION-AUDIT.md) and [DEVELOPMENT.md](DEVELOPMENT.md) for source provenance, limitations, safety requirements, tests and Windows commands.

**Important:** The React `frontend/dist` assets shipped in the archived Phase 6 source were stale and were excluded from the enhanced ZIP. The launcher will install npm dependencies and rebuild the React frontend on first start. Do not launch the unrelated `legacy/filipino-demo/` Filipino prototype when demonstrating the Grade 3 English assessments.

Teacher dashboard **is not access-controlled**; it appears only from a localhost browser and must be used with fictional learners. The FastAPI evidence routes themselves are not authenticated and must never be exposed to a public network with real child data. Teacher audio review is done during the existing recording session; previously submitted audio is not stored for replay in the dashboard. Guided practice history is saved only in the same browser, not synchronized between teacher devices.
