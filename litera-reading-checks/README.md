# Litera Reading Checks

One demo session connects the five-word phonics check, teacher-marked oral reading and English reading comprehension. The checks share a fictional learner and session ID. Their assessment scores, form IDs and difficulty tiers stay separate.

## Run on Windows

1. Extract the ZIP. Install Python 3.11 or 3.12 if needed.
2. Close older BasaBridge test servers using port 8765. Double-click `Start-Litera.cmd` and keep the terminal open.
3. Open http://127.0.0.1:8765 in Chrome or Edge. The built React frontend is included. Initial Python setup and the first speech model download need internet. Both recorded checks use the local faster-whisper model.
4. Start a session with an adult teammate and a fictional learner ID.

## Demo sequence

- **Phonics:** Complete five printed words by recording or listening live, then generate the evidence. Whisper provides a transcript for teacher review.
- **Oral reading:** Switch to Oral reading and start a passage. Optionally record the read-aloud before opening the clean reading view. When you stop, Litera transcribes the passage and aligns the words. On the teacher screen, dashed green boxes are AI matches and dashed red boxes are possible substitutions or omissions. Replay the clip and correct individual boxes, or use **Confirm remaining AI marks** after reviewing them. The teacher verification step still applies. Record the teacher's voice note separately. The read-aloud uses one room microphone and may capture both people. It does not separate speakers. If the teacher prompts or models during the reading, select the appropriate assistance setting. A note recorded afterward is review material.
- **Comprehension:** Choose a passage the learner has not seen. Read independently, then answer all five questions. Use Previous and Next to revise answers before submission. Mark the attempt as assisted if the learner received help, or end it without submitting if the session was interrupted. FastAPI grades the submitted answers.
- **Evidence:** Submit the teacher-verified results. Open **Scoring handoff JSON** to copy the separate events and independent checks for the same learner session. Assisted oral and comprehension results remain in the event list and are excluded from the independent checks.

Audio in the oral module is optional, stays in the tab, and is released when switching checks, ending the session, or reloading. Recording failures leave hand marking available. Export scoring JSON before ending the session. Only read-aloud clips are sent to the local backend for transcription. Teacher voice notes stay in the tab. Neither recordings nor transcripts are included in the scoring JSON. One mic can capture both speakers, so use consenting adults for the demo.

For a port conflict, run `.\.venv\Scripts\python.exe -m uvicorn backend.server:app --host 127.0.0.1 --port 8766` from the extracted folder, then open http://127.0.0.1:8766.

## Existing tree

Use `independentChecks` with the existing scoring adapter and merge by learner ID and event ID with the learner’s prior history. The existing endpoint evaluates one difficulty tier per request. Phonics uses `CVCC-final-nt`; oral reading and comprehension use `short-text`. Preserve both tiers and their histories. This combined demo exports the handoff but does not call the existing adaptive service. It does not change the decision tree, combine the scores into an average, or set a learner’s skill status.

The reading passages are original provisional demonstration materials. For the oral rubric, see `ORAL-READING.md`. For the new assessment API, repeat rules and Windows verification, see `COMPREHENSION.md`.

## Development

Use Node.js 22.12 or newer to rebuild. From the project root run `npm --prefix frontend ci`, `npm --prefix frontend test`, and `npm --prefix frontend run build`. Start FastAPI with `python -m backend.server` after installing `backend/requirements.txt`. For React development, use `npm --prefix frontend run dev` with the backend on port 8765.
