# Phase 5 · Adaptive reading recommendation

Litera's existing evidence endpoint returns a `recommendation` generated from the saved Phase 4 profile. `voice/tree.py` owns the routing rules. The existing Voice Lab calls the same planner and still accepts its fictional raw-check fixtures. The older browser-local Filipino demo in `dist/` keeps its separate data and thresholds.

## Confirmed routes

| Phonics | Oral reading | Comprehension | Primary | Secondary |
|---|---|---|---|---|
| READY | READY | READY | Mixed Reading | Rotating review |
| READY | READY | SUPPORT | Guided Comprehension | Oral rereading |
| READY | SUPPORT | READY | Guided Oral Reading | Connected-text meaning practice |
| READY | SUPPORT | SUPPORT | Guided Oral Reading | Supported comprehension |
| SUPPORT | READY | READY | Phonics-Based Learning | Connected-text reading |
| SUPPORT | READY | SUPPORT | Phonics-Based Learning | Guided Comprehension |
| SUPPORT | SUPPORT | READY | Phonics-Based Learning | Guided Oral Reading |
| SUPPORT | SUPPORT | SUPPORT | Phonics-Based Learning | Supported connected-text reading |

When all three skills need support, the secondary activity includes a brief meaning question. Comprehension stays in the support and reassessment queues. The plan flags teacher review when all three skills need support, a needed prerequisite is uncertain, print is inaccessible, or a teacher reports stalled support. The last two observations are supplied as context and remain separate from scores.

An UNCONFIRMED skill is never a confirmed gap. A missing score stays null. A pending result keeps a ready learner at the current level pending fresh evidence. If an earlier skill is missing or UNCONFIRMED before an oral reading or comprehension gap, use accessible practice and supported meaning while scheduling the needed checks. A contradictory score can queue a fresh check while the previously confirmed state continues to guide the plan. Phase 4 determines whether reassessment changes a status.

## API and override integration

- `GET /api/evidence/learners/{learnerId}` returns the Phase 4 profile and `recommendation`. The plan reports activities, confirmed gaps, queued gaps, pending rechecks, ready and missing skills, selected tiers, latest usable event references, and an explanation. Each activity has a machine-readable ID, a label, a purpose, and an optional difficulty tier. IDs describe categories that [guided practice](PRACTICE.md) maps to the available content pack.
- Use `printAccessible=false` or `supportStalled=true` to supply session observations. The default print-access setting assumes the learner can access the current text. The Litera screen provides a checkbox for changing it.
- `POST /api/plan` on the Voice Lab accepts the profile's `planInput` and returns the same structured plan under `recommendation`. It retains the original `primary`, `secondary`, `reason`, and other response fields for the existing UI. The older `checks` input is still accepted for the Voice Lab's standalone demo.
- Use the existing `POST /api/evidence/overrides` endpoint to save a teacher's change. Submit a unique `overrideId`, `learnerId`, target `sessionId`, `why`, and an ISO timestamp with timezone. Provide any of `primaryActivityId`, `secondaryActivityId`, `primaryDifficultyTier`, and `secondaryDifficultyTier`. Activity IDs must appear in the planner's catalogue. Legacy free-text `selectedRecommendation` still works for a primary activity. Assessment tiers and scores remain unchanged when the teacher changes an activity's difficulty.
- Read the profile with `overrideSession=<sessionId>` to apply the latest saved override for that session. The response includes `teacherOverride` and keeps the default activities and support queue in `algorithmicPlan`. Litera passes the current session ID when it loads its recommendation. A legacy Voice Lab-only override still lives in that demo's browser state.

## Windows 11

Keep `voice/` beside `litera-reading-checks/` in the same checkout or extracted ZIP. Open `litera-reading-checks\Start-Litera.cmd`, then [open Litera](http://127.0.0.1:8765). The bundled build starts with Python 3.11 or 3.12. To build from a Git checkout, install Node.js as well and run `npm --prefix litera-reading-checks/frontend ci` and `npm --prefix litera-reading-checks/frontend run build` from the repo root before launching.

1. Start a fictional learner session. Under Session evidence, expect accessible practice and a fresh check.
2. In Phonics, use **Teacher listens live** and mark 3 of 5 words correct. Submit the check. Expect **Phonics-Based Learning** as primary and a recheck for skills that lack evidence.
3. Submit an oral check with teacher-confirmed marks. Leave comprehension unassessed or complete it and inspect the changing secondary activity and reassessment lists.
4. Uncheck **Learner can access the current printed text** to see supported meaning practice and teacher review. Reload the profile to recover the prior observations. Comparability approvals for multi-session progression are synthetic in the automated tests. The bundled forms ship without confirmed comparability.

From the repo root after launching once:

```powershell
$python = (Resolve-Path ".\litera-reading-checks\.venv\Scripts\python.exe").Path
& $python -m pip install httpx
& $python -m unittest discover -s tests -v
Push-Location litera-reading-checks
$env:LITERA_TREE_PATH = '..'
& $python -m unittest discover -s tests -v
npm --prefix frontend ci
npm --prefix frontend test
npm --prefix frontend run build
Pop-Location
```

The saved-evidence API is part of the local fictional-learner demo. Teacher observations and overrides use the existing local API workflow. The policy and thresholds are prototype choices. The following resources support differentiated instruction, monitoring progress, and teaching connected-text reading and comprehension. DepEd uses its own reading assessment procedures.

- [IES What Works Clearinghouse · Foundational Skills](https://ies.ed.gov/ncee/wwc/PracticeGuide/21)
- [IES What Works Clearinghouse · Response to Intervention](https://ies.ed.gov/ncee/wwc/PracticeGuide/3)
- [IES What Works Clearinghouse · Reading Comprehension](https://ies.ed.gov/ncee/wwc/practiceguide/14)
- [Connor et al. · Individualized Literacy Instruction](https://pmc.ncbi.nlm.nih.gov/articles/PMC4737583/)
- [Duke and Cartwright · The Science of Reading Progresses](https://doi.org/10.1002/rrq.411)
- [DepEd Memorandum 064, s. 2025 · ARAL-Reading](https://www.deped.gov.ph/wp-content/uploads/DM_s2025_064r.pdf)
