# Phase 6 · Guided reading practice

In Litera Reading Checks, **Session evidence → Recommended practice** uses the existing Phase 5 primary and secondary recommendation IDs. The earlier standalone Filipino activities in the root `dist/` use a separate offline demo and its own local data.

| Recommendation | Practice pack |
| --- | --- |
| Phonics-Based Learning | Two final-`nt` activities for letter–sound modeling, blending, and guided decoding |
| Guided Oral Reading, Oral Rereading, Connected-text Reading, Supported Connected-text Reading | *The Kite in the Hall*, with word cues, a first read, feedback from the teacher, and rereading |
| Guided or Supported Comprehension, Connected-text Meaning | *The Blue Lunch Box*, with a literal question and a question that asks for the evidence sentence |
| Mixed Reading and Rotating Review | *The Library Book*, combining word review, story reading, and a literal question |
| Accessible Current-Level Practice | Teacher-modeled short text |
| Fresh Independent Check | Existing assessment lookup, with no practice item |

Selection requires the matching category and exact difficulty tier. The code accepts an optional competency filter and prefers completed-history items the learner has not done. Teacher activity or tier overrides flow through the same selector. Unknown categories and unsupported tiers display a teacher-review message. Mixed and review materials belong to their pack's listed skill for the post-practice check.

The original JSON pack uses EN3PWS-I-2 for CVCC word-pattern reading, EN3CAT-I-1 for guided sentence reading, and EN3CAT-I-2 for explicit story details. See the project's Grade 3 English Reading Resources and the MATATAG English guide, printed pp. 61 and 63. These activities sample specific parts of the competencies. Teachers model the sound or reading; there is no automatic pronunciation or fluency score. Optional hints are marked as help. Choice feedback and evidence highlighting follow the learner's first response. Content is provisional and requires educator review before classroom use. [MATATAG English Grades 2–10 curriculum guide, mirrored PDF](https://matatagcurriculum.com/wp-content/uploads/2024/11/MATATAG-Curriculum-Grade-2-10-English.pdf)

## Practice records and reassessment

Practice progress is saved in localStorage on the device, keyed by fictional learner and run ID. A record includes session, content version, tier, steps, attempts, hints, guidance, teacher notes, and completion timestamp. Pause and resume keep the original practice session ID. **View last completed activity** can reopen the completion screen after a reload. Repeated completion updates cannot add another completed record. Practice never calls a scoring endpoint. Phase 4 evidence stays in its existing SQLite store.

**Try a new reading check** looks up a form for the completed activity’s skill and tier. The browser opens only that form in a separate session through the existing assessment screen. Form exposure is tracked in the same SQLite file, separately from scored evidence. Previously opened or scored forms and passages shared across oral reading and comprehension are excluded. Fresh starts recheck exposure before revealing content. Phase 4 still decides comparability and whether any result can confirm a status.

If no unseen form at the same tier is available, a teacher-review request stays in that browser’s local queue. The bundled phonics pack has one assessment form. Once the learner has seen it, the fresh-check flow queues review. Older unsubmitted exposures from before this update are not in the persistent exposure ledger. Some assessment passages are shared across skills, so the two available passages can be exhausted quickly.

## Windows 11 test

1. Extract the demo ZIP or build from a Git checkout. Run `litera-reading-checks\Start-Litera.cmd` with Python 3.11 or 3.12 and open [http://127.0.0.1:8765](http://127.0.0.1:8765). The ZIP includes the compiled frontend.
2. Start a fictional learner. Use the recommended accessible activity to finish a guided reread. Try a new reading check and verify that the existing oral form opens in a separate session.
3. Submit a teacher-confirmed phonics check with three of five words correct. Start **Phonics-Based Learning**, use a hint, try an incorrect option, retry, and complete the activity. The saved score stays 60%. The fresh-phonics request queues teacher review because the single form has been seen.
4. Turn off **Learner can access the current printed text** to get supported comprehension. Answer a question, pause, reload, and start a new session with the same fictional learner ID. Select **Resume practice** to verify persistence. To test fresh comprehension after using the first oral passage, the handoff should offer the second passage only.
5. To rebuild and run tests from `litera-reading-checks` after the launcher installs the backend requirements:

```powershell
.\.venv\Scripts\python.exe -m pip install httpx
$env:LITERA_TREE_PATH = '..'
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
npm --prefix frontend ci
npm --prefix frontend test
npm --prefix frontend run build
```
