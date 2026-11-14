# BasaBridge Phonics Check

Standalone Grade 3 phonics demo. React and TypeScript record and replay one printed word at a time. FastAPI runs faster-whisper locally. The transcript is advisory. Only a teacher's five clear, independent judgments generate a score and tree input.

## Windows 11

1. Install 64-bit Python 3.11 or 3.12 with the Windows Python launcher. Extract the ZIP.
2. Double-click `Start-Phonics.cmd` and leave it open. The ZIP contains the built frontend, so Node is only needed to rebuild. Close any older BasaBridge server using port 8765 first.
3. Open http://127.0.0.1:8765 in Chrome or Edge. Start the check and allow the mic. Record an adult teammate's attempt, stop, replay, and choose a teacher judgment. Watch for the first model download. If speech recognition times out, replay or select **Teacher listens live**.
4. Score all five words. Choose **Generate evidence** and open **Decision tree input**. Four correct and one incorrect should give **80%** with review required. An unclear result retries the same word. A hint makes the form ineligible for an independent score.
5. Press Ctrl+C in the terminal to stop the service.

Internet is needed to install dependencies and download `base.en` the first time. The cached model and bundled frontend can then work on the same computer without an external API. Local browser microphone support requires localhost or HTTPS. Use fictional IDs and adult recordings. The app releases replay audio on retry, advancement and exit. It keeps no permanent clip files or transcripts. Session receipts and deduplication are in memory and reset on restart.

## Source and development

- `backend/forms/` contains provisional five-word forms. To add one, copy the JSON layout, change the form ID, provide five distinct item IDs and appropriately comparable fresh words, and restart. Keep the tier the same when the new form should count toward that tier. The software checks identifiers, not educational comparability. Use a teacher-reviewed form for real assessment.
- `backend/speech.py` decodes short clips with PyAV and uses faster-whisper on CPU, loaded on first use. The endpoint returns match, possible mismatch, review for multiple tokens, or recognition unavailable.
- `backend/scoring.py` validates final judgments, creates evidence, suppresses duplicate submissions, and adapts events to the existing tree.
- `frontend/src/` contains the React view, microphone lifecycle and TypeScript contracts.
- `tests/` covers the speech and scoring API. From the module root run `.\.venv\Scripts\python.exe -m unittest discover -s tests -v` after setup. For a real-model test set `$env:BASABRIDGE_TEST_AUDIO = "C:\path\to\adult-clip.wav"` and rerun.

To rebuild the frontend after editing it, install Node 22.12 or newer, then run `npm --prefix frontend ci` and `npm --prefix frontend run build`. Restart the backend to serve the new build. For development, run `npm --prefix frontend run dev` alongside the backend.

## Integrate with BasaBridge

`GET /api/forms` returns forms. `POST /api/phonics/transcribe` accepts multipart fields `clip`, `attemptId`, `itemId`, and `formId`. `POST /api/phonics/complete` accepts the final teacher judgments and returns `{event, treeCheck}`. See `/docs` for endpoint details and `frontend/src/contracts.ts` for client types.

Inside the existing BasaBridge codebase:

```python
from voice.tree import Check
from backend.scoring import PhonicsEvidence, to_tree_check

event = PhonicsEvidence.model_validate(receipt["event"])
check = Check.model_validate(to_tree_check(event))
# Append check to this learner's ordered evidence history once per event.eventId.
# Run the existing skill scorer for check.tier; keep historical forms and session IDs.
```

Use the receiving app's durable event ledger for retries across restarts. A successful repeat request returns the same receipt in this local demo; a conflicting reuse of the ID or a duplicate learner/form or learner/tier/session returns 409. Only complete, usable, independent probes are emitted. Audio, transcripts and model confidence are excluded from tree input. The existing tree decides SUPPORT, UNCONFIRMED, READY and any later transitions. The 80% cutoff and inclusive 75–85% initial review band are prototype settings. The module neither assigns a status nor writes to an existing learner profile.

### References

- [BasaBridge phonics validation specification](https://chatgpt.com/library?file_id=libfile_2955034e28e4819180680e336daca66f&account_id=personal)
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
- [MediaRecorder format support](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static)

For a repo handoff, copy this folder as `phonics/` and run commands inside it. Keep the existing `voice/` module intact. The downloadable ZIP includes the built assets and its launcher can rebuild if they are absent from Git.
