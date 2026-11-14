# Litera UI integration audit

## Source branches

| Source | Inspection and use |
| --- | --- |
| `main` at `68a2b45` | Canonical `frontend/` and `backend/`. Contains the newest learner and teacher layouts, server sessions, teacher validation, quest map, and progress. |
| `litera-guided-tts` at `7fbfcd6` | Feature branch base. Same current UI with practice-only browser audio, recording, and persisted assistance. Reused the existing practices, sound targets, recorder, and browser voice fallback. |
| `tester-final` at `0279f5c`, `UI`, `UI-nalang-kulang` | Ancestors of `main`. Their published student and teacher work is already included. |
| `tester` | Contains an additional guided-practice/fresh-check implementation for the nested Phase 6 demo. The active application retains its own assessment routing and evidence checks. |
| `Log-In/-Sign-UP` | Contains a prior standalone email-login snapshot and generated Python/JavaScript assets. The active application uses its integrated version of the email sign-in flow. |

## Before and after

| Area | Before | Integrated branch |
| --- | --- | --- |
| Student and teacher portals | Canonical root UI alongside older launch targets and unused assessment views | Root views and launch flow remain canonical. Removed unreachable duplicate assessment views. Moved the older Filipino demo under `legacy/`. |
| Student authentication | Email challenge and one-use password for signup/login | Same server flow, with **Enter Password** for login, email retained in view, a show/hide control, and clear signup confirmation. |
| Portrait | Several breakpoints, horizontal navigation at some sizes, 1px overflow in a narrow teacher view on the earlier snapshot | Safe-area-aware page gutters, compact grid navigation, readable inputs, and 44px key controls. Desktop keeps wide review columns. |
| Speech | Local browser voice only | Server WAV playback for existing practice content. Explicit on-device voice fallback. Session-owned content and feedback gates. |
| Scoring and evidence | Separate per-skill evidence, teacher validation, decision-tree recommendations | Same scoring, authentication and review rules. Added TTS metadata to existing private practice history. |

## Demonstration verification

- Production TypeScript and Vite build passed.
- 41 frontend tests passed. 35 Python tests passed, including the real WAV endpoint test. The optional live Whisper inference test was skipped.
- Authentication and learner/teacher separation were exercised against a temporary SQLite database. The application launcher remains at the repository root.

The end-to-end check uses fictional accounts, a test inbox and a fake microphone. It exercises signup, rejected and valid login, hidden/shown password, five phonics recordings, teacher validation, a 60% result, Word Village recommendation, real backend WAV decoding and playback, slow audio, replay, stop, recording handoff, a hint, quest completion, and teacher review. The profile is identical before and after practice completion. Story Forest narration and Meaning Mountain feedback were checked separately, including the server-unavailable fallback with a test local voice.

Automated mobile emulation covers 360×800, 375×667, 390×844, 393×852, and 430×932. Tablet and desktop checks cover 768×1024 and 1366×768. Physical iOS Safari safe areas and keyboard, the Windows batch launcher and installed Windows voice, live Gmail delivery, and acoustic suitability for local learners require a device check.
