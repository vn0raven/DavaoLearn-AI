# BasaBridge integration audit — November 15, 2026

## Source and verification boundary

Audited **Litera_Phase6_Learning_Activities.zip**, a saved project snapshot available in the user's file library. The remote repository's GitHub landing page was inspected, but direct Git cloning and downloading were unavailable in this runtime. A different merged Phase 7/8 archive was listed in the library but its original bytes were not accessible here. **This package is a compatible enhancement of the Phase 6 source snapshot, not a verified edit of the latest GitHub `main` or of the merged student dashboard.** Compare file versions before merging and do not replace a newer branch wholesale.

The independent legacy static prototype lives in `dist/`; the Grade 3 English assessment application lives in `litera-reading-checks/frontend` and `litera-reading-checks/backend`; the older voice lab lives in `voice/` and is also used by the existing decision-tree plan. These are not a single production-ready application.

## A1. Implementation inventory

| Module | Implemented in Phase 6 snapshot? | Verified behavior | Integrated with English app? | Gaps/risks |
|---|---|---|---|---|
| 1. Phonics STT and verification | Yes | Server form, upload, transcript indication, teacher-confirmed judgments, saved evidence; Python adapter tests pass | Yes, via React component and FastAPI | Requires real microphone and Whisper/PyAV runtime test; STT is not pronunciation diagnosis; no retained audio for later dashboard replay |
| 2. Oral reading | Yes | Per-word teacher judgments, word counts, evidence API, replay during live capture; tests pass | Yes | Full physical-audio and long-device recordings not executed in this runtime; audio remains transient |
| 3. Reading comprehension | Yes | Server-validated choice answer keys, complete/interrupt/fresh form flows; tests pass | Yes | Form coverage is provisional and small; fresh passage availability can be exhausted |
| 4. Unified evidence scoring | Yes | SQLite event store, independent skill/tier profiles, duplicate resistance, revisions, SUPPORT/READY/UNCONFIRMED | Yes | No real-child privacy/identity infrastructure or authenticated teacher access |
| 5. Adaptive decision tree | Yes | Uses `voice/tree.py` for primary/secondary activities; 80 cutoff, inclusive 75–85 review, two-check confirmation; tests pass | Yes | Returns teacher review or no exact activity when a form/tier is unavailable; maintain current routing rules |
| 6. Learning activities | Yes | Local prepared content, teacher-guided steps, feedback, browser storage, fresh check request; 9 front-end logic tests pass | Yes, via Practice component | Practice history is *browser-local*; cross-device teacher synchronization not implemented |

## Data flow and responsibility boundaries

`PhonicsAssessment` → `POST /api/phonics/complete` → stored `AssessmentEvent` (teacher-confirmed phonics score)

`OralReadingAssessment` → `POST /api/evidence/oral` → stored per-word teacher-confirmed score

`ComprehensionAssessment` → `/api/comprehension/start` then `/{event_id}/complete` → server-checked answer key → stored evidence

All → `GET /api/evidence/learners/{learner_id}` → SQLite `project()` in `backend/evidence.py` → `backend/plan.py` → original `voice/tree.py` route → `selectActivity()` → `Practice` → browser-local practice run/quest → fresh form endpoint → new session → independent check.

**The score and status functions were not edited.** The app keeps 80%, inclusive 75–85% initial review, three skills, independent/fresh/two separate sessions and multiple approved form checks. Practice and hints never call assessment submission endpoints or insert score events. A teacher recommendation override is stored separately and never changes original evidence.

## What was changed for this enhancement

- Added three-level **pre-authored** hint text for choice and teacher-guided steps; hint history contains step/level/time. Level 3 may give the answer **in guided practice only**.
- Error feedback labels are limited to observable incorrect choice selections; no speech error or underlying learning disorder is inferred.
- Added one three-zone private reading map, recommended quest highlighting and activity-completion tally. No independent score is inferred from a quest.
- Added text size, high contrast, focus mode, 44 px targets and a visible keyboard focus; focus mode hides optional metadata, **not** the comprehension passage.
- Added a local-demo teacher evidence view of skill statuses, raw events, missing/recheck/rejected queues, saved practice records for the **same browser**, audits and session-scoped recommended-activity overrides.
- Improved the local server's optional-PyAV behavior: non-audio APIs can load without PyAV and supported 16 kHz PCM WAV clips have a lightweight fallback; browser WebM/audio transcription still requires normal dependencies.
- Updated the Windows launcher so the React frontend is rebuilt from enhanced sources on first run, instead of accidentally using stale Phase 6 compiled assets.

## Missing, limited, or unverified

1. **Teacher authentication and server authorization are absent in this source.** The teacher view only appears on localhost and says it is a demo; `/api/evidence/*` is not protected for internet deployment. Do not use real children or expose this server publicly.
2. Current React/Vite `npm ci` / `npm run build` could not execute in this evaluation container because npm packages were not cached and outbound network was unavailable. All 28 TypeScript/TSX files passed syntax parsing; four pure TypeScript logic modules passed semantic checking with the installed compiler; practice/quest behavior passed a temporary dependency-free harness. **Final browser build, visual QA, and real microphone testing must be completed on Windows.**
3. Audio recordings are transient and are not archived in SQLite; teacher review/replay occurs within the assessment module while the recording exists. A dashboard replay of a previous session cannot be claimed.
4. Practice history and teacher notes are browser-local, not teacher-synchronized across devices. Browser data may be lost or read by others using the same device.
5. An independent reassessment may be blocked if there is no approved fresh comparable form; the application correctly surfaces a review need rather than recycling a previous form.
6. The archived original static `dist/` Filipino prototype remains separate; no migration or rebuild of that unrelated prototype was attempted.

## Executed quality checks

- Python: **58 passed, 3 skipped** using `PYTHONPATH=litera-reading-checks python -m pytest -q litera-reading-checks/tests tests` from the extracted repository root. Includes new synthetic API and evidence/recommendation/override checks.
- Frontend logic: **9 passed** from `frontend/tests/practice.test.ts` and `frontend/tests/quests.test.ts`, transpiled with global TypeScript into a temporary Node ESM harness because npm dependencies were unavailable. On Windows use normal `npm test`.
- TypeScript/TSX: **28 files, 0 parser errors**, using TypeScript's parser; pure practice/evidence modules compiled with strict `tsc --noEmit` and no dependencies.
- **Not verified:** `npm ci`, full React/Vite type-check/build, desktop/mobile visual browser run, physical microphone, real speech recognition model download, slow-network and cross-device testing. Do not label these checks as passed.

## Required Windows checks before demonstration

Run `Start-Litera.cmd` (installs dependencies and builds the frontend), then `npm --prefix frontend test` and `npm --prefix frontend run build`. Test the checklist in [DEVELOPMENT.md](DEVELOPMENT.md); preserve the original scoring rules and use only fictional identities and consenting adult voices.
