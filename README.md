
# BasaBridge v0.2

A browser-local hackathon MVP for reading practice in Region XI, Mindanao. This build includes two fictional learner profiles, 12 prepared Filipino activities, a six-item informal check, skill-specific recommendations, Cebuano parent guidance, local progress, JSON export, and service-worker caching.

## Run
Serve `dist` on localhost (for example `python -m http.server 8080 --directory dist`). HTTPS is required for service workers outside localhost. No build or dependencies are required. `dist` is the deployment directory.

## Demo
1. Switch between Maya and Nico on Overview. Their equal seeded totals produce different suggested practice.
2. Start a reading check. Adults read listening prompts and record oral word reading; comprehension items are answered by the learner.
3. Mark an answer assisted to show that it does not count as independent success.
4. Complete all six items and inspect updated recommendations and Progress.
5. Reload to demonstrate persistence. Export progress to JSON.
6. After Ready offline appears, disconnect and reopen the app on the same browser to test offline access on the target device.

## Implementation
Buildless HTML/CSS/JavaScript; localStorage for small prototype records; prepared local JSON-like activity objects; a service worker caches local assets. No external fonts, APIs, database, analytics, microphone collection, or student data transmission. A later version can migrate to IndexedDB/Dexie, recording assets, and authenticated teacher sync.

Recommendations use up to eight recent attempts per skill and independent success ratios. Seed scores are used only for untested skills. Prototype cutoffs (0.7 decoding/listening and 0.8 comprehension) are illustrative and must not be represented as validated mastery thresholds. Repeated item performance is not independent evidence of general literacy or transfer.

## Scope and limitations
- Fictional learners, informal checks, no official CRLA assessment or educational effectiveness claim.
- Filipino reading activities; selected Cebuano guidance and vocabulary scaffolds. English interface remains in most screens.
- No automatic speech grading. Adult narration is the reliable offline option; optional Filipino browser speech varies by device and may need network access.
- Offline first visit requires downloading the app. Browser storage/cache can be cleared. Export is a backup; import and server synchronization are not implemented.
- This private demo uses owner authentication at the hosting layer. Validate offline reopening on deployment devices; authentication redirects may require connectivity.
- Teacher, native-speaker, accessibility, and child usability review needed before real use.

## Verification
JavaScript syntax checks; browser walkthrough of profile switching, full six-item check, independent vs assisted scoring, completion, recommendations, and saved progress after reload. Offline caching registration observed as ready; airplane-mode reopening and physical mobile-device testing remain deployment checks.

## Mobile update
Phone layouts use fixed bottom navigation, safe-area spacing, larger touch controls, and a compact header. The manifest includes PNG app icons and home-screen setup is available from Add app / Guide. Installation is offered through the browser where supported, with Android Chrome and iPhone Safari instructions otherwise. Checked at 390px and 320px iframe viewport widths; no horizontal overflow at 320px. Verified mobile navigation, install guidance, and assisted scoring after a hint. Real device installation and airplane-mode checks remain outstanding.

## Grade 3 English assessment and adaptive plan

[Litera Reading Checks](litera-reading-checks/README.md) saves phonics, oral reading, and comprehension evidence in SQLite. The current Grade 3 English flow reads its next steps from the [Phase 5 planner](litera-reading-checks/ADAPTIVE-PLAN.md) and opens matching [guided practice](litera-reading-checks/PRACTICE.md).

## Grade 3 English Voice Lab

The Python backend and its local test UI live in `voice/`. The original static site is in `dist/`. Run the voice app on the same PC as the browser.

1. Install Python 3.11 or 3.12. On Windows, double-click `Start-Voice-Test.cmd`.
2. Open http://127.0.0.1:8765. The first recording downloads the English `base.en` faster-whisper model. Try one recording before the live demo. The model is then reused in memory and subsequent starts reuse its disk cache.
3. Allow microphone access. Read a prompt, stop recording and replay it. Compare the transcript with what you heard. A transcript may miss or hide a pronunciation difference. Only the teacher's score enters the assessment history.
4. Score all five distinct phonics prompts and select **Use voice scores for a phonics check** to submit the full probe. An isolated word or oral clip is an exit item. It appears in history without changing the skill classification.
5. Enter teacher-confirmed oral and independent comprehension probe totals. For reassessment, use comparable fresh forms and different session IDs. Two consecutive usable results on the same side of the cutoff can change an existing status.

To run manually from the repository root:

```bash
python -m venv .venv
# Activate the environment, then:
python -m pip install -r voice/requirements.txt
python -m voice.server
```

The Windows launcher binds to localhost. Microphone capture in a browser on another device needs a reachable secure origin. The existing static deployment does not run this Python backend. Use adult voices and fictional results in the demo. The server does not intentionally retain clips or transcripts. The browser retains demo probe and teacher-review history for this device only.

`POST /api/plan` accepts a validated Litera skill profile or ordered fictional check events for the standalone demo. `POST /api/transcribe` accepts a multipart `clip` and returns text for review. `GET /health` reports server and model state. API details are at `/docs`.

The 80% cutoff and 75–85% initial review band are demo routing choices. “Ready” describes the app’s evidence for a particular probe tier. It is not a DepEd proficiency label or a phoneme-level speech score.
