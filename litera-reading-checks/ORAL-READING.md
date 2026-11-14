# Litera Oral Reading Assessment

Phase 2 of BasaBridge (now Litera). A teacher marks individual words in a Grade 3 English passage. The module calculates word-reading accuracy and exports an event. It does not score rate, expression, comprehension or pronunciation.

For the combined project setup, see `README.md`. The oral scoring functions run in the browser.

## Try a check

1. Start a check with a fictional learner. Select a passage, then open the clean reading view or give the learner a clean printout. Use the teacher view to mark.
2. Select a word, then choose Correct, Incorrect, Unclear or Unassessed. With Correct or Incorrect, the selection moves to the next word. Select an earlier word to fix a mark. The ✓, ×, ? and · symbols and accessible names distinguish judgments.
3. To test efficiently, mark the first word incorrect and select **Mark remaining as correct**. Confirm only if each remaining word was actually heard. The Seed Bag should give 40/41, or 97.56%. Unclear words stay unscored.
4. Choose the assistance and observation fields. Confirm the verification checkbox and submit. Inspect or copy the assessment event, detailed word judgments and, for independent evidence, the decision-tree input.

The live preview uses only words marked correct or incorrect. The final score uses the full passage denominator and requires every word to have a clear judgment. Marking or changing settings invalidates prior verification. Incomplete, unclear or interrupted observation blocks submission. A fully observed assisted result can be saved as practice evidence for the current run. The standalone page does not send it to the assessment engine. Save any JSON you need before refreshing.

### Provisional rubric

- Count each printed occurrence once. Readable pronunciation variation that preserves the intended word can count as correct.
- Count an unaided self-correction to the target before the learner moves on as correct. This is a demo convention.
- Repeating a word does not change the score or denominator. Score the intended printed occurrence once.
- A clearly observed omission, substitution or skip is incorrect. If a line was visibly skipped, mark each skipped word incorrect. If you did not hear or see what happened, use Unclear or Unassessed. A recording or observation failure is not a learner error.
- Record models, prompts and corrective feedback during the reading attempt as assistance. Use a fresh comparable form in a separate session for independent confirmation. The two demo passages have not been validated as equivalent.
- Ask an educator to review prompts, scoring and forms before classroom use. This is not official DepEd scoring.

## Files and integration

| Files | Purpose |
| --- | --- |
| `src/data/passages.json` | Two original demonstration passages from the BasaBridge reading resources. The metadata records title, form, tier, version, source and EN3CAT-I-1 as an accuracy reference. Add educator-reviewed forms here. Keep IDs unique and counts consistent. Change the form ID when a revision is intended to be a distinct form. |
| `src/scoring.ts` and `src/types.ts` | Position-based tokens, judgment edits, scoring, submission validation, duplicate protection and typed event contracts. Apostrophes and hyphens inside words stay with the word, and punctuation around words is preserved for display. |
| `src/OralReadingAssessment.tsx` | Reusable component with a clean reading view, teacher controls, verification and export. |
| `src/fastapi.ts` | Optional adapter for the existing `POST /api/plan` endpoint. No dependency on it at demo runtime. |
| `tests/oral.test.ts` | Scoring, passage integrity, thresholds and adapter checks. |

Use `<OralReadingAssessment learnerId="demo-001" onComplete={receiveOral} />` in your React app and import the Tailwind styles. The callback receives the lightweight `event`, detailed `words` and `assistance`. Save the full result in your application if needed. Keep an event-ID ledger in the host to deduplicate retries across reloads and retain practice evidence separately. The default receiver tracks duplicates only for the life of this component. A failed callback can be retried with the original event ID.

Call `toTreeCheck(event)` for a usable independent event. It maps `formId` → `form`, `sessionId` → `session`, and `difficultyTier` → `tier`, and sends only the fields expected by `voice.tree.Check`. Retain learner ID and event ID in the host. Send the learner's ordered prior checks alongside this new check when using `submitOralForPlan`; exclude this event from that prior list. The endpoint evaluates supplied history and does not store it. Use one comparable tier across relevant skills when asking the existing tree to evaluate a combined history. Record only genuinely separate supervised sessions as separate confirmations.

The existing scoring engine owns the demo cutoff of 80%, the inclusive 75–85% initial review band, and SUPPORT, READY and UNCONFIRMED. The module does not set or display a skill status. It sends exact counts and the unrounded ratio, and the UI rounds for display only.

### References

- [BasaBridge Grade 3 English Reading Resources](https://chatgpt.com/library?file_id=libfile_45abd9f0b3f081918472296740a0028b&account_id=personal)
- [BasaBridge Phonics Speech Validation](https://chatgpt.com/library?file_id=libfile_2955034e28e4819180680e336daca66f&account_id=personal)
- [DepEd revised K–10 curriculum](https://www.deped.gov.ph/revised-k-to-10-curriculum/)
