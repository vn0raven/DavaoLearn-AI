# Changelog

## Phase 6 — Guided learning activities

- Added original phonics, guided oral reading, comprehension, and mixed practice mapped to Phase 5 recommendations.
- Added guided feedback, resumable local practice records, and separate activity completion tracking.
- Added fresh assessment selection with persistent form exposure and a local teacher-review queue when no form is available.

## Phase 5 — Adaptive decision tree

- Added eight confirmed-state routes, accessible practice when evidence is uncertain, and explainable support and reassessment queues.
- Connected Litera’s saved evidence to the shared Python planner and displayed the two recommended activities in the existing session view.
- Extended stored teacher overrides to primary and secondary activities and optional difficulty tiers.

## Phase 4 — Unified scoring and evidence

- Added persistent assessment history, review-band classification, reassessment confirmation, and separately stored teacher overrides.
- Connected server-checked phonics, oral reading, and comprehension results to the shared evidence store.
- Exposed skill states and audit history to the existing decision tree while keeping legacy plan input compatible.
- Added tests for evidence quality, form freshness, concurrent deduplication, persistence, and all three adapters.

## Phase 3 — Reading comprehension

- Added two Grade 3 English demonstration forms with five literal questions each.
- Added a comprehension tab to the shared reading session, with answer revision, completion checks, an assisted mode and a score summary.
- Added FastAPI grading with server-side answer keys, same-attempt retry receipts, interruption handling and freshness checks.
- Added comprehension evidence to the existing scoring handoff using the shared learner and session IDs.
- Added API, handoff and optional reference-tree compatibility tests.

## 2026-11-15 — Hackathon integration, guided reading, accessibility, quests, teacher review (candidate)

- Preserved Phases 1–6 assessment evidence, configurable cutoff/review band, fresh-check policy and original decision-tree routing.
- Added curated three-level phonics/oral/comprehension practice hints with timestamped assistance history; no hints in assessment screens.
- Added response-supported corrective feedback labels and removed speculative phoneme-error claims.
- Added Word Village, Story Forest and Meaning Mountain as a three-zone private practice map. Quest completion is independent of learning status.
- Added larger text, high contrast, focus mode, and strengthened focus/touch styling; maintained the existing violet UI theme.
- Added local-only teacher dashboard with skill summaries, evidence history, rejection/reassessment queue, practice log and reasoned session override controls.
- Added syntax and logic checks and synthetic backend journey tests. Local checks: 58 Python passed, 3 skipped; 9 frontend logic tests passed; final React/Vite build requires npm install on Windows.
- Improved Python audio dependency fallback for non-audio API testing and standard PCM WAV; browser speech still requires installed dependencies.
- Added implementation audit, Windows checklist, and launcher rebuild guard. This is a Phase 6 snapshot enhancement; remote GitHub merge remains unverified.
