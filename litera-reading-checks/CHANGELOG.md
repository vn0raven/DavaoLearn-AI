# Changelog

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
