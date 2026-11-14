# Integration notes — Phase 7 & 8

## Grounded source priorities

- UI base: Litera Student Prototype 2; retain logo, palette, reading cards, microphone hooks, and teacher UI concept.
- Authentication: Litera Student Prototype 1; maintain one-time temporary password sign-in by server-side Gmail SMTP.
- Adaptive/backend: DavaoLearn-AI; maintain three-skill classification, independent evidence, and recommended learning activities.

## Resolved conflicts

- The UI prototype's original `backend/reviews.py` used a demo learner name and a single audio clip per prompt. New `reviews.py` derives learner identity from the authenticated cookie and stores all 1–3 takes.
- Original teacher assessment relied on a shared teacher key and stored scores in a separate JSON blob. The new teacher endpoint writes an official evidence event after human validation, which the adaptive planner consumes.
- Original DavaoLearn comprehension used an automatic, instantly authoritative scoring endpoint. Here the same comprehension form/answer-validation helpers produce **provisional** feedback until the teacher confirms it.
- Earlier independent UI components remain in source for code reference, but the integrated `main.tsx`, `StudentDashboard.tsx`, and `TeacherDashboard.tsx` are the active routes.
- Existing voice `tree.py` is preserved. Reassessment outcomes follow its source-defined confirmation logic and do not presume new forms are automatically comparable.

## Phase 7 checklist

- [x] Student Gmail sign-in; session cookie
- [x] Entry page with three assessments
- [x] Three recording attempts per prompt, with all audio saved
- [x] Progress and microphone feedback
- [x] Comprehension answers and previous/next navigation
- [x] Submission and tentative right/wrong feedback
- [x] Teacher-only review, listening, validation, remarks
- [x] Teacher progress metrics, history, queue, documented overrides
- [x] Mobile-friendly CSS breakpoints, labels, basic focus/ARIA support
- [ ] Automated screen-reader audit and physical-device viewport testing

## Phase 8 checklist

- [x] One FastAPI server exposing student and teacher flows
- [x] Verified phonics, oral and comprehension scores saved as assessment events
- [x] Decision-tree recommendation using only verified saved evidence
- [x] Persistent SQLite audio, submissions, and review history
- [x] Duplicate ID rejection; bad-manifest and cross-student access rejection
- [x] Teacher-only write permissions; structured errors on failed uploads
- [x] Provisional STT failure handled as uncertain, never as incorrect
- [x] Python synthetic workflows and existing planner tests passed
- [ ] Full Vite/npm build (registry inaccessible here)
- [ ] Live real-microphone and full browser accessibility testing

## Operational recommendation

Teacher-validated results are the only official assessment scores. Automatic transcriptions are fallible. Keep all source evidence, teacher notes, and override history. Before deployment, move from a shared teacher key to individual teacher accounts, enforce school-specific consent and retention policies, and add hosted database/backups and audit logs.

## Landscape Litera UI refresh (2026-11-15)

- **Frontend:** `src/Icons.tsx`, `src/litera-refresh.css`, `src/assets/reading-hero.webp`, and revised `main.tsx`, `StudentDashboard.tsx`, `TeacherDashboard.tsx`. All routes and backend contracts remain unchanged.
- **Student:** responsive reading lesson cards, verified score summaries, adaptive activity, submitted results, accessible header anchors, three-attempt recorder preserved.
- **Teacher:** responsive queue and summary, three-take phonics recording grid with inline marks, word-chip oral passage review with correct/incorrect verdicts, completion gating, saved result chips, student profile/overrides unchanged.
- **Brand:** Litera only in visible pages and voice demo; original educational source and licensing provenance remain documented without modifying student passage text.
- **Validation performed:** Python `pytest -q tests`: 21 passed, 1 skipped; 40 subtests. TypeScript transpiler syntax: 22 source files, no parse diagnostics. CSS parser: 3 core style files, no errors. **Full npm/Vite build and browser interaction testing remain required** because dependency installation failed in this container.
- **Upgrade:** copy only user-controlled `.env` and, if preserving account history, `.litera-data` from the previous installation while the server is stopped. The distributed archive contains neither.
