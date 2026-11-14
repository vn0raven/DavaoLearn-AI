# Development and demo verification — BasaBridge enhancement

This package enhances the original Phase 6 TypeScript/React/Vite + Python/FastAPI demo. It **does not** include a freshly compiled React bundle; run the Windows build before presenting.

## Windows 11 setup

1. Extract `BasaBridge_Enhanced_Phase6.zip` to a simple folder (e.g., `C:\Projects\BasaBridge-Enhanced`). Keep `voice`, `litera-reading-checks`, and `tests` together.
2. Install **Node.js 22.12+** and **Python 3.11 or 3.12**. Do not use the older static `legacy/filipino-demo/index.html` for the English lesson demo.
3. Open PowerShell in `C:\Projects\BasaBridge-Enhanced\litera-reading-checks`.
4. Run `npm --prefix frontend ci`, then `npm --prefix frontend test`, then `npm --prefix frontend run build`.
5. Double-click `Start-Litera.cmd` to set up Python (or activate `.venv` and run `python -m pip install -r backend/requirements.txt`). The launcher creates the enhanced-build marker only after a successful React build.
6. Visit `http://127.0.0.1:8765`. For a different port: from `litera-reading-checks`, run `.\.venv\Scripts\python.exe -m uvicorn backend.server:app --host 127.0.0.1 --port 8766`.
7. If source files change, rebuild with `npm --prefix frontend run build`. To force a launcher rebuild remove `frontend\dist\.basabridge-enhanced-build-v1`.

### PowerShell command sequence

```powershell
cd C:\Projects\BasaBridge-Enhanced\litera-reading-checks
npm --prefix frontend ci
npm --prefix frontend test
npm --prefix frontend run build
.\Start-Litera.cmd
```

### Python regression tests (PowerShell)

```powershell
cd C:\Projects\BasaBridge-Enhanced
$env:PYTHONPATH = "litera-reading-checks"
.\litera-reading-checks\.venv\Scripts\python.exe -m pip install pytest httpx
.\litera-reading-checks\.venv\Scripts\python.exe -m pytest -q litera-reading-checks\tests tests
```

## P0 integration walkthrough — synthetic learner only

1. Start one demo session with ID `fictional-demo-001` (do not use a real child).
2. In **Phonics**, record with a consenting adult voice or complete teacher review. Confirm marks; verify receipt and raw counts.
3. Switch to **Oral reading**, record if needed, replay, review word judgments, and submit; verify saved event and accuracy.
4. Switch to **Comprehension**, use a fresh passage and answer all questions. Verify independent/assisted status and raw counts.
5. Read primary and secondary recommendations. Where multiple confirmed skills are SUPPORT, verify foundational priority and recommended activity mapping.
6. Start the primary recommended practice. The UI must explicitly say Guided Practice.
7. Request hints 1, 2, and 3. Verify they advance and are tracked. Level 3 can reveal an answer **only in guided practice**.
8. Submit an incorrect option and confirm feedback describes that observable choice without claiming phoneme-level diagnosis.
9. Complete every practice step. Check that Word Village/Story Forest/Meaning Mountain updates the **personal quest counter only**.
10. Request a fresh independent check. If no eligible fresh form exists, verify that the teacher-review notice appears instead of reusing an exposed form.
11. If a fresh form exists, verify the new session ID and that it has no hint UI. Complete it unaided.
12. Open **Teacher evidence view (local demo)**. Confirm assessment scores remain separate, raw evidence/revisions are visible, and the previous practice shows as browser-local.
13. Save a reasoned recommendation override and refresh. Confirm the original score/event history is unchanged.
14. For complete mastery-change verification, use synthetic API evidence through `tests/test_hackathon_integration.py`; the tiny demo form set may not support two new comparable forms from the UI.

## Regression / accessibility checklist

- [ ] Desktop Chrome/Edge; no broken navigation or React console error.
- [ ] 320 px, 375 px, and 390 px browser device viewport; no clipped passage or inaccessible controls.
- [ ] Navigate every control with Tab, Shift+Tab, Enter and Space; visible focus indicators.
- [ ] Toggle Larger text, High contrast, and Focus mode. Focus must not hide a passage required for comprehension.
- [ ] Use a screen reader or accessibility-tree inspection for button labels, headings and status messages.
- [ ] Invalid learner ID, no saved events, interrupted comprehension, and failed backend requests produce readable states.
- [ ] Confirm repeated phonics/oral audio submission does not duplicate an event.
- [ ] Verify an assisted check is excluded and a practice quest never enters SQLite assessment evidence.
- [ ] Two qualifying fresh independent sessions can update classification; one check alone cannot change a previously confirmed classification in the 75–85% band.
- [ ] Disconnect the network after serving the page; failed API operations show recoverable feedback without phantom completion.
- [ ] Simulate slow backend responses and verify no duplicate clicking/submitting.
- [ ] Browser localStorage can be cleared without modifying SQLite stored assessment events.
- [ ] Confirm the teacher dashboard is not offered on non-localhost origins; **do not publish the unprotected backend**.
- [ ] Test actual recording playback/transcription on a microphone-equipped Windows machine, using adult voice data only.

## Software boundaries

Assessment evidence: server SQLite and existing evaluation functions (`backend/evidence.py`, `backend/evidence_store.py`). Recommendation: existing `voice/tree.py`. Practice: existing `Practice.tsx` plus curated `content.json` and browser localStorage (`practice/storage.ts`). Quest map and hints are display/instruction enhancements, not score mechanisms.

Teacher panel is a **local hackathon demo** only. A real classroom rollout needs school permission, privacy review, authenticated teacher accounts, backend authorization on every evidence/override route, audit access policies, real approved forms, and cross-device practice synchronization.

## Suggested commits after copying changes to your working Git repository

1. `test: document baseline phase 1-6 integration and add synthetic journey checks`
2. `feat(practice): add graduated hints and observable response feedback`
3. `feat(accessibility): add text contrast focus controls and assessment mode clarity`
4. `feat(quests): add private three-zone reading journey backed by practice history`
5. `feat(teacher): expose local demo evidence audit and reasoned overrides`
6. `docs: update Windows verification audit and change log`

Do not overwrite a newer local/remote branch without comparing it against this **Phase 6 snapshot**.
