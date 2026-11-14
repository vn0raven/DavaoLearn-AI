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
