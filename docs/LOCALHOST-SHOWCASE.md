# Litera localhost showcase

## Repository audit

The default branch is `main`. [PR #6](https://github.com/vn0raven/DavaoLearn-AI/pull/6) merged seven commits from `feature/litera-phase10-portrait-tts` into `main` at `da0fb5969ecfc96638544dfe1aba3d39a73a0854`. Its head was `bf40e36837b9d43dde344dfbd4bc0fb9fbe50254`. GitHub's public API returned zero submitted reviews and zero check runs or commit statuses for the PR head. The merge commit and PR metadata confirm the merge. Historical pre-merge conflict status is unavailable.

The showcase branch is `release/litera-localhost-showcase`, based on the merge commit. The current UI, backend speech, teacher authorization, and existing quest workflow are already integrated there. `tester-final` is part of the baseline's history. `tester` retains older standalone Phase 6 work. The fetch found no `litera-main-v2` branch. See [UI integration](UI-INTEGRATION.md) for the earlier sources.

| Location | Role |
| --- | --- |
| Root `Start-Litera.cmd`, `scripts/start_litera.py` | Canonical Windows launcher and local preparation |
| Root `frontend/`, `backend/` | Integrated React and FastAPI student and teacher workflow |
| `voice/` | Standalone speech lab and shared decision-tree source |
| `phonics/`, `litera-reading-checks/`, `legacy/filipino-demo/` | Preserved prototypes and alternate launchers |

## Finding resolutions

| Finding | Cause and verification |
| --- | --- |
| Old forms offered as reassessments | The quest used the general form picker. The server now checks submissions, logged exposures and shared passages, educator approval, and the current comparison group before reserving a fresh form and session. Test-only approvals exercise the success path. The default demo shows **Teacher review needed**. |
| Wrong launcher and occupied port | The root launcher already targeted the integrated app, but rebuilt on every run and printed a fixed port. It now prepares the canonical app, checks the configured port, and reports the correct URLs. The shared Python launch path passed cold and warm starts, occupied-port handling, and clean shutdown. Windows batch execution still needs a Windows 11 run. |
| Teacher authorization | The integrated teacher router already requires the configured private key, and the legacy evidence router is absent from the canonical server. Added regression checks for profiles, overrides, legacy routes, and preserved student record isolation. The server binds to localhost. |
| Empty oral transcript | The transcript aligner formerly treated an empty match list as all wrong. Empty results now show uncertain previews and remain available for teacher review. Existing stored previews are interpreted safely without rewriting their original rows. |
| Logical duplicate submission | A unique attempt ID alone was insufficient. The review repository rejects reused forms and second submissions for the same skill and session, even with new IDs. Finalization also rejects pending historical duplicates over existing evidence. Tests compare the verified profile before and after a rejected duplicate. |

The branch leaves scoring thresholds, decision-tree priority, original evidence and prior rows in place. Already finalized historical duplicates remain in the audit history. The baseline comparison contains zero deleted or renamed paths.

## Windows rehearsal

1. Install Python 3.11 or 3.12 and Node.js 22.12 or newer. Open PowerShell in the repository root.
2. If needed, copy `.env.example` to `.env`. Enter a configured Gmail sender for a fictional learner, a private teacher key, and the desired port. Keep those settings and local databases out of Git.
3. Run `.\Start-Litera.cmd`. The default learner URL is [localhost:8765](http://127.0.0.1:8765) and the teacher workspace is [localhost:8765/teacher](http://127.0.0.1:8765/teacher). Use the printed address if `PORT` differs.
4. Test the existing capped speech recording and a teacher-approved pronunciation in Chrome or Edge. Windows TTS uses an installed English desktop voice. If server speech is unavailable and the browser exposes a local English voice, use the device-voice fallback. The recording and independent assessment remain available without the advisory STT model.

## Five-minute pitch checklist

| Time | Demo action |
| --- | --- |
| Before recording | Warm the localhost service. Sign in as a fictional learner and unlock the teacher workspace in another tab. Use consented adult or clearly marked synthetic clips. |
| 0:00–0:50 | Show a phonics submission and the protected teacher review. Validate three of five items for the fictional 60% phonics example. |
| 0:50–1:30 | Refresh the learner dashboard and show separate skill scores and the Word Village recommendation. |
| 1:30–2:55 | Open the suggested quest. Play normal and slow audio, record a rehearsal, open a hint, and finish the quest. |
| 2:55–3:50 | Compare the practice star and the unchanged verified phonics status. Choose **Check for a fresh assessment** and show the teacher-review state when no approved form is available. |
| 3:50–5:00 | Return to the teacher workspace to show validated evidence, private practice history, and the recommended next activity. |

The browser rehearsal used a temporary SQLite database, simulated email delivery, and a simulated microphone. It submitted and teacher-validated all three assessment types, completed Word Village, and verified the learner profile stayed identical across guided practice. Recorded synthetic scores were 60% phonics, 100% oral reading, and 40% comprehension. These are demonstration records.

## What was verified

- 41 frontend tests and 44 Python tests passed, including opt-in Whisper inference with the cached model and a synthetic clip. The production React/Vite build passed after dependency installation. The localhost launcher helper opened both portals, initialized all four SQLite stores, reused the frontend on warm start, and refused a second launch on the occupied port.
- Browser profiles at 360×800, 375×667, 390×844, 393×852, 430×932, 768×1024, and 1366×768. The student and teacher views fit these widths and the desktop portrait preview preserved session state.
- Normal and slower server speech returned playable WAVs. Browser checks exercised replay, stop, recording handoff, Story Forest narration, Meaning Mountain feedback, and a simulated device-voice fallback. Assessment screens exposed no guided audio controls.
- Whisper decoded and transcribed one synthetic clip. The transcript did not establish a score. Blank and failed transcript handling was covered by regression tests.
- Pending physical checks include Windows 11 batch launch, installed Windows voice quality, actual Gmail delivery, and Safari microphone, keyboard, and safe-area behavior. The default demo has no educator-approved comparable form.
