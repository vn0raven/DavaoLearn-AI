import assert from "node:assert/strict";
import test from "node:test";
import type { RecommendedActivity } from "../src/evidence";
import { activities, feedback, nextStep, recordAttempt, selectActivity, startPractice, useHint } from "../src/practice/activity";
import { readPractice, readQueue, savePractice, setQueue } from "../src/practice/storage";

const tiers = { phonics: "CVCC-final-nt", oral: "short-text", comprehension: "short-text" };
const identity = { learnerId: "demo-practice", sessionId: "demo-session" };
const now = "2026-11-15T00:00:00Z";
const rec = (activityId: string, skill: RecommendedActivity["skill"] = null, difficultyTier: string | null = null) =>
  ({ activityId, skill, difficultyTier, label: "", purpose: "" });
const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) };
};

test("Phase 5 activity IDs select practice for each skill and mixed reading", () => {
  for (const [category, skill] of [
    ["PHONICS_BASED_LEARNING", "phonics"], ["GUIDED_ORAL_READING", "oral"],
    ["GUIDED_COMPREHENSION", "comprehension"], ["MIXED_READING", "comprehension"],
    ["CONNECTED_TEXT_READING", "oral"], ["SUPPORTED_CONNECTED_TEXT_READING", "oral"],
    ["SUPPORTED_COMPREHENSION", "comprehension"], ["CONNECTED_TEXT_MEANING", "comprehension"],
    ["ROTATING_REVIEW", "comprehension"], ["ORAL_REREADING", "oral"],
  ] as const) {
    const selection = selectActivity(rec(category), tiers, []);
    assert.equal(selection?.skill, skill, category);
    assert.equal(selection?.intendedUse, "practice");
  }
  assert.equal(selectActivity(rec("MIXED_READING"), tiers, [])?.type, "mixed-reading");
});

test("only matching tier, skill and competency are eligible; unused content is preferred", () => {
  const phonics = rec("PHONICS_BASED_LEARNING", "phonics", tiers.phonics);
  const first = selectActivity(phonics, tiers, [], "EN3PWS-I-2")!;
  const second = selectActivity(phonics, tiers, [first.id])!;
  assert.notEqual(first.id, second.id);
  assert.equal(selectActivity(phonics, tiers, [first.id, second.id])?.id, first.id);
  assert.equal(selectActivity(phonics, tiers, [], "EN3CAT-I-2"), undefined);
  assert.equal(selectActivity({ ...phonics, difficultyTier: "another-tier" }, tiers, []), undefined);
  assert.equal(selectActivity(rec("MIXED_READING", "phonics"), tiers, []), undefined);
  assert.equal(selectActivity(rec("TEACHER_SELECTED_ACTIVITY"), tiers, []), undefined);
  assert.equal(selectActivity(rec("FRESH_INDEPENDENT_CHECK"), tiers, []), undefined);
});

test("pack IDs are unique and material is kept separate from assessment passages and forms", () => {
  assert.equal(new Set(activities.map(item => item.id)).size, activities.length);
  const assessmentWords = /\b(tent|bent|dent|sent|rent)\b/i;
  for (const item of activities) {
    assert.match(item.id, /^practice-/);
    if (item.passageId) assert.match(item.passageId, /^practice-/);
    if (item.skill === "phonics") assert.doesNotMatch(JSON.stringify(item.steps), assessmentWords);
    assert.ok(item.steps.length);
    for (const step of item.steps) {
      if (step.kind !== "choice") continue;
      assert.ok(step.options[step.answer]);
      if (step.evidenceLine !== undefined) assert.ok(item.passage?.[step.evidenceLine]);
    }
  }
});

test("hints and corrective feedback are counted, feedback follows an attempt, and retries stay practice", () => {
  const activity = selectActivity(rec("GUIDED_COMPREHENSION"), tiers, [])!;
  let run = startPractice(activity, identity, "run-1", now);
  assert.equal(feedback(run, activity), undefined);
  assert.equal(nextStep(run, activity, now), run);
  run = useHint(run, activity);
  assert.deepEqual(run.hints, [0]);
  run = recordAttempt(run, activity, 0);
  assert.equal(feedback(run, activity)?.correct, false);
  assert.match(feedback(run, activity)?.text ?? "", /under the steps/);
  assert.equal(feedback(run, activity)?.line, 0);
  assert.equal(nextStep(run, activity, now), run);
  run = recordAttempt(run, activity, 1);
  assert.deepEqual(run.attempts[1].assistance, ["teacher-guided", "hint", "corrective-feedback"]);
  assert.equal(recordAttempt(run, activity, 1), run);
  assert.equal(feedback(run, activity)?.correct, true);
  assert.equal(run.intendedUse, "practice");
  assert.ok(!Object.hasOwn(run, "eventId"));
});

test("oral rereads record guidance and save one resumable, idempotent completion", () => {
  const activity = selectActivity(rec("GUIDED_ORAL_READING"), tiers, [])!;
  const storage = memory();
  let run = startPractice(activity, identity, "oral-1", now);
  savePractice(storage, run);
  assert.equal(readPractice(storage, identity.learnerId)[0].completedAt, null);
  for (const step of activity.steps) {
    assert.equal(step.kind, "guide");
    run = recordAttempt(run, activity, "guided");
    run = nextStep(run, activity, now);
  }
  assert.equal(run.completedAt, now);
  assert.equal(run.passageId, "practice-rainy-kite");
  assert.ok(run.attempts.every(a => a.correct === null && a.assistance.includes("teacher-guided")));
  savePractice(storage, run);
  savePractice(storage, run);
  assert.deepEqual(readPractice(storage, identity.learnerId), [run]);
  assert.deepEqual(readPractice(storage, "somebody-else"), []);
});

test("teacher review queue persists missing tiers once and can clear them", () => {
  const storage = memory();
  setQueue(storage, identity.learnerId, "phonics", tiers.phonics, now);
  setQueue(storage, identity.learnerId, "phonics", tiers.phonics, now);
  assert.deepEqual(readQueue(storage, identity.learnerId), [{ skill: "phonics", tier: tiers.phonics, requestedAt: now }]);
  assert.deepEqual(setQueue(storage, identity.learnerId, "phonics", tiers.phonics), []);
});
