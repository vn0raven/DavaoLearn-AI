# Litera changelog

## Phase 10 portrait and TTS integration

- Ported the Phase 10 desktop portrait preview into the active app. The same practice and review components stay mounted when the preview switches.
- Applied the compact lesson, recording, and review layouts in the preview and on narrow handsets. Kept older assessment components available as source.
- Rechecked the backend speech, emailed login, and teacher-validated progress workflow on the integrated build.

## Final UI integration and backend practice speech

- Updated the learner sign-in password label, added show/hide controls, and kept email signup, password delivery, and teacher authorization.
- Optimized the student and teacher portals for portrait phones with safe-area spacing, compact navigation, and larger controls.
- Added authenticated FastAPI audio for approved guided steps at two speeds. The existing device voice is available as an explicit fallback.
- Kept audio usage in practice history and retained existing scoring, reassessment, and recommendation rules.
- Removed unused root assessment views and moved the original Filipino prototype to `legacy/filipino-demo/`.

## Guided practice audio

- Added user-initiated English listening, slow playback, replay, and stop controls in Word Village, Story Forest, and Meaning Mountain.
- Added local Word Village rehearsal recording, playback cancellation on navigation, and coordination between speech and the microphone.
- Added optional packaged teacher clips for isolated sound models and practice-only audio assistance history.
- Removed the modeled playback controls from the older root oral assessment component. Existing assessment scoring, teacher validation, and recommendation rules remain in effect.

## 2026-11-15 — Phase 9 DavaoLearn guided quests and gamification

- Kept the Phase 7/8 responsive landscape UI, student activity cards, teacher review controls, Gmail sign-in, three audio takes and original assessment/evidence/decision tree.
- Ported DavaoLearn's 5 guided Grade 3 English practice activities, three-level hints, authored corrective feedback and 3-zone quest map into an additional full-width learner dashboard panel.
- Added unique quest stars, participation XP, five badges, recommendation matching, pause/resume, notes, and accessibility controls.
- Replaced the old fake "Mark practice complete" action with navigation into real guided activities.
- Added authenticated SQLite practice persistence, local browser backup with retry UI, and a teacher-only history viewer in learner progress.
- Kept practice events explicitly separate from official validated assessment scores and statuses.
- Added GAMIFICATION.md, frontend practice/quest logic tests and secure backend practice API tests.
- Verification: 26 Python tests passed and 1 skipped; TypeScript pure practice code compiled and smoke-tested. Full React/Vite production build and live microphone/browser QA remain to be tested on Windows due npm registry access restrictions.

## 2026-11-15 — Litera landscape UI/UX refresh

- Reworked learner dashboard into a wider, responsive two-column layout with navigation, reading lesson cards, teacher-validated progress, practice recommendations, and assessment history.
- Redesigned teacher overview and assessment queue, including inline phonics verdict controls alongside all three recording attempts.
- Replaced the long read-aloud verdict dropdown grid with selectable word chips and adjacent verdict controls; teachers still mark every word.
- Preserved teacher verification, audit notes, evidence, Gmail temporary-password student login, and adaptive learning recommendations.
- Updated visible product branding to Litera and documented the data-preserving upgrade path.
- Added reusable SVG icons and a decorative reading illustration based on the approved Litera UI mockups.

# Changelog

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
