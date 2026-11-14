# Phase 4 · Unified scoring and evidence

This layer belongs to the existing Litera reading checks. FastAPI writes to `data/evidence.sqlite3` by default. Assessment modules continue to own their grading workflows. The store receives server-checked phonics judgments, passage-specific teacher marks, and server-graded comprehension answers. Scores use the original counts. The database records events, source judgments or answers, intake rejections handled by the adapters, before/after status snapshots, and separate teacher overrides. Speech recordings and transcripts are outside the evidence store.

## Status rules

1. Track phonics, oral reading, and comprehension independently for each difficulty tier. Missing evidence has a null score.
2. For the first usable independent fresh probe, a score below the review band gives SUPPORT, a score above it gives READY, and a score in the inclusive band gives UNCONFIRMED. Defaults are 75–85% inclusive and an 80% cutoff. These are prototype routing decisions.
3. For confirmation, use the two most recent eligible probes in that skill and tier. The checks must have distinct forms and sessions, matching approval groups, matching rubric and administration conditions, and agreement relative to the cutoff. The baseline counts only if it also meets those conditions. One contradictory eligible result retains the prior status and queues reassessment.
4. Repeated forms, repeated passages within a scope, same-session results, practice, assisted or unusable evidence, and unapproved forms cannot confirm a status. An unapproved fresh first probe may support the demo's initial classification. The profile includes the latest usable score and the reason a status was assigned or retained. The history flags each ineligible observation.
5. Event IDs are unique across all modules. An exact retry can recover the original stored event. A conflicting reuse gets a conflict response. Events replay in assessment timestamp order, with event ID breaking ties. Each intake preserves its original before/after snapshot and effective configuration. A new configuration reprojects the current view without rewriting those snapshots.

The default approval registry is empty. To configure the local backend, set `LITERA_EVIDENCE_CONFIG` to a JSON file containing `rules` and `comparableForms`. Give configuration changes a new `rules.version`. Each approved form entry requires `skill`, `difficultyTier`, `formId`, `formVersion`, `rubricVersion`, `conditions`, `group`, `approvedBy`, and `approvalReference`. Use matching groups only after review of the exact form versions, rubric, and conditions. The shipped assessments use rubric `v1` and conditions `standard`. Use new form IDs for genuinely fresh content. Set `LITERA_EVIDENCE_DB` to an alternate local database path if needed. Carry the database across restarts to retain saved evidence. Phase 3 browser history and unfinished in-memory attempts are outside the migration.

### Fictional demo

| Assessment | Counts | Status | Why |
|---|---|---|---|
| Phonics baseline | 3/5 | SUPPORT | 60% is below the band |
| Oral baseline | 18/20 | READY | 90% is above the band |
| Comprehension baseline | 4/5 | UNCONFIRMED | 80% is inside the band |
| Phonics session 2 | 4/5 | SUPPORT | First eligible improvement |
| Phonics session 3 | 4/5 | READY | Second agreeing eligible check on a fresh approved form |

The last two rows use synthetic approvals in tests. The shipped phonics pack includes only the baseline form. Comprehension stays UNCONFIRMED in this scenario.

## Integration

- `POST /api/phonics/complete` and the existing comprehension completion endpoint include the normalized event in `evidence`. Their legacy receipts stay available under `event` and `treeCheck`.
- `POST /api/evidence/oral` receives passage version, assistance and verified teacher judgments. The backend checks the expected word IDs and derives the count; it does not accept a client-supplied score.
- `GET /api/evidence/learners/{learnerId}` returns the profile. Add `phonicsTier`, `oralTier`, or `comprehensionTier` query parameters to select a scope for the tree. Each tier remains visible in the history.
- `POST /api/evidence/overrides` requires `overrideId`, `learnerId`, `sessionId`, `why`, `selectedRecommendation`, and an ISO timestamp with a timezone. It also accepts `skill` and `previousRecommendation`. Add `overrideSession` to the profile query to include that session's most recent override in `planInput`.
- Pass the profile's `planInput` as JSON to the existing voice service's `POST /api/plan`. Its legacy `checks` payload is still supported. The unified input uses already-classified statuses and keeps the original recommendation logic. In the Litera demo, load the profile using **Saved evidence and decision-tree input**. The current session export shows raw checks for inspection.

Litera displays its plan directly using the shared Python planner. To test the legacy Voice Lab endpoint as well, start Litera on port 8765, then start the voice service from the repository root on port 8766. Use the selected profile's `planInput` with that endpoint:

```powershell
python -m uvicorn voice.server:app --host 127.0.0.1 --port 8766
```

In a second PowerShell window:

```powershell
$profile = Invoke-RestMethod http://127.0.0.1:8765/api/evidence/learners/demo-001
Invoke-RestMethod http://127.0.0.1:8766/api/plan -Method Post -ContentType application/json `
  -Body ($profile.planInput | ConvertTo-Json -Depth 10)
```

Run the Litera backend on loopback with fictional learner IDs. The assessment confirmations and override submissions use the existing local teacher workflow. Workspace authentication and authorization are outside this phase. The history keeps adapter-level rejections with safe, typed input. Requests rejected at schema validation are not saved. In-progress attempts remain in memory. Saved scores, event identities, and completed retry receipts are durable.

## Run and verify

From the repository root, build with `npm --prefix litera-reading-checks/frontend ci` and `npm --prefix litera-reading-checks/frontend run build`. Open `litera-reading-checks/Start-Litera.cmd` on Windows. Use the bundled frontend build when running the demo ZIP.

For tests, install the Litera backend requirements and `httpx`. From `litera-reading-checks`, run `python -m unittest discover -s tests -v`. In PowerShell, set `$env:LITERA_TREE_PATH = '..'` to run the existing Phase 3 optional tests against the repository's voice tree. Also run `npm --prefix frontend test`.

## Assessment limitations

IES distinguishes foundational decoding and connected-text reading work, while DepEd ARAL-Reading provides its own implementation and assessment guidance. NCME emphasizes evidence supporting a specific score interpretation and use. The demo scores represent performance on these tasks under recorded conditions. They do not establish Philippine Grade 3 proficiency or form equivalence.

- [IES What Works Clearinghouse · Foundational Skills to Support Reading for Understanding](https://ies.ed.gov/ncee/wwc/PracticeGuide/21)
- [NCME · Validity and Educational Testing](https://ncme.org/resources/professional-learning/items/validity-and-educational-testing/)
- [DepEd Memorandum 064, s. 2025 · ARAL-Reading guidelines](https://www.deped.gov.ph/wp-content/uploads/DM_s2025_064r.pdf)
