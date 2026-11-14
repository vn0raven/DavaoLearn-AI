# Phase 3 — English reading comprehension

The module samples literal comprehension after independent reading. The two passages are original demonstrations from *original Grade 3 English Reading Resources*. The added questions ask for explicit story details, including people, locations, order or time, and actions. The forms reference the narrative story-element portions of Grade 3 MATATAG EN3CAT-I-2 and EN3CAT-II-2 as identified in that document. An educator should review the texts and items before classroom use and establish comparability before any actual reassessment. Informational and inferential comprehension need separate items.

## Windows 11 verification

1. Extract the complete ZIP and open the folder containing `Start-Litera.cmd`.
2. Close any older Litera server on port 8765. Double-click the launcher and open http://127.0.0.1:8765. The ZIP includes the compiled frontend. Python 3.11 or 3.12 and the backend dependencies are needed. Comprehension makes no speech-model calls.
3. Start a reading session with a fictional learner ID. Select **Comprehension**, **The Seed Bag**, and **Independent reading**, then open the passage.
4. Start questions. Answer one and try to submit. Check that the first unanswered question opens. Navigate back to verify that the selected option was preserved.
5. Answer all five and submit. For an 80% check, choose “On the bench by the garden gate,” “Ana,” “Seeds,” “Before the bell rang,” and “They made labels.” Confirm the summary shows four correct and one incorrect. Find the event and independent check under **Current session JSON (raw checks)**.
6. Copy the handoff before ending the session. Open another session for the same fictional learner. `COMP-A` has already been seen. Use `COMP-B` if the learner has not seen its passage. Mark it assisted and submit to verify that its result appears in `events` only.

On a port conflict, after the launcher has created the environment, run from the extracted folder:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.server:app --host 127.0.0.1 --port 8766
```

Then visit http://127.0.0.1:8766.

## Grading and evidence

- FastAPI grades answer IDs against the selected version of the form. Each form defines its denominator. Every question requires one answer before the app issues a receipt. An unanswered item blocks scoring and remains visible in the progress count.
- The server persists graded evidence and ordered responses in SQLite. The open attempt is held in memory. Exact completion retries can recover a saved receipt after restart. Identical retries return the original event and timestamp. Changed graded answers and a second completed result for the same learner, session and tier are rejected. After an ambiguous request failure, use **Retry submission** before leaving the check to recover the original receipt.
- Session history in the React UI is temporary. Completed events and explicit interruptions survive a restart. Unfinished starts and browser-only oral exposure are temporary. Starting a form counts as exposure even if the learner stops early. The shared tab also records oral passage exposure for the same learner. For an independent oral and comprehension demo, choose different passages. Across tab or server restarts, the teacher should verify exposure and use a genuinely unseen text. The browser and API are intended for a single local demo using fictional learner IDs.
- Assisted practice can produce a complete score. The event has `assisted: true` and stays out of `independentChecks`. Interruptions and validation failures produce no scoring event.
- The backend sends the event, the existing tree-check projection and a separate receipt with item responses. The shared handoff exports only events and eligible tree checks. The tree uses exact counts to apply the configured 80% cutoff, inclusive 75–85% review band and separate-session confirmation. Phase 3 displays no skill status.

## Integration

In `frontend/src/main.tsx`, the comprehension receipt goes through the existing session evidence receiver. For recommendations, load **Saved evidence and decision-tree input** and pass `planInput` to the voice tester’s `POST /api/plan`. See [EVIDENCE.md](EVIDENCE.md).

- `GET /api/comprehension/forms` lists form metadata.
- `POST /api/comprehension/start` opens a form using `eventId`, `learnerId`, `sessionId`, `formId`, `difficultyTier` and `mode`. The response omits answer keys.
- `POST /api/comprehension/{eventId}/complete` accepts `responses` containing question and answer IDs plus `assisted`. The server calculates the result.
- `POST /api/comprehension/{eventId}/interrupt` closes an unsubmitted attempt.

Add original or licensed forms under `backend/comprehension_forms/` using the two examples. Give revisions unique form IDs and versions, preserving the same passage ID for the same text. Use a new passage ID only for fresh text. Requiring another app-level review band or form equivalence check would belong in the assessment policy and the existing scoring engine.

## Development tests

Run from the extracted root after setup:

```powershell
.\.venv\Scripts\python.exe -m pip install httpx
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
npm --prefix frontend ci
npm --prefix frontend test
npm --prefix frontend run build
```

To enable the two integration tests against the existing scoring service, set `$env:LITERA_TREE_PATH` to the folder containing its `voice` package before running the Python tests. The other API tests run with the Litera source alone.
