import assert from "node:assert/strict";
import test from "node:test";
import { activities, hintLevel, hintText, recordAttempt, startPractice, useHint, nextStep } from "../src/practice/activity";
import { progressFor, questFor, recommendedQuest, zones } from "../src/practice/quests";

const identity = { learnerId: "fictional-only", sessionId: "session-a" };
const tiers = { phonics: "CVCC-final-nt", oral: "short-text", comprehension: "short-text" };
const t = "2026-11-15T01:00:00Z";

test("three private quest areas map to the existing skill categories only", () => {
  assert.deepEqual(zones.map(zone => zone.skill), ["phonics", "oral", "comprehension"]);
  for (const activity of activities) {
    const quest = questFor(activity);
    assert.equal(quest.linkedActivityId, activity.id);
    assert.equal(quest.targetSkill, activity.skill);
    assert.equal(quest.difficultyTier, activity.difficultyTier);
  }
  const quest = recommendedQuest({ activityId: "PHONICS_BASED_LEARNING", label: "", purpose: "", skill: "phonics", difficultyTier: tiers.phonics }, tiers, []);
  assert.equal(quest?.zone, "Word Village");
});

test("graduated hints advance one level, stop at three, and never create an assessment event", () => {
  const activity = activities.find(item => item.skill === "comprehension" && item.steps[0].kind === "choice")!;
  let run = startPractice(activity, identity, "run-a", t);
  assert.equal(hintLevel(run), 0);
  const collected: string[] = [];
  for (let level = 1; level <= 3; level++) {
    run = useHint(run, activity, t);
    assert.equal(hintLevel(run), level);
    collected.push(hintText(run, activity) ?? "");
  }
  assert.equal(useHint(run, activity, t), run);
  assert.equal(new Set(collected).size, 3);
  assert.equal(run.hintHistory?.length, 3);
  assert.equal(run.hints.length, 1); // backward-compatible unique hinted step list
  assert.equal(run.intendedUse, "practice");
  assert.equal(Object.hasOwn(run, "eventId"), false);
});

test("error categories require authored evidence and progress never claims mastery", () => {
  const activity = activities.find(item => item.skill === "phonics" && item.steps[0].kind === "choice") ?? activities.find(item => item.skill === "phonics")!;
  let run = startPractice(activity, identity, "run-b", t);
  // Guided modeling is an instruction step; advance without creating any assessment event.
  while (activity.steps[run.step]?.kind === "guide") {
    run = nextStep(recordAttempt(run, activity, "guided"), activity, t);
  }
  const step = activity.steps[run.step];
  assert.equal(step?.kind, "choice");
  if (step?.kind !== "choice") return;
  const wrong = step.options.findIndex((_, index) => index !== step.answer);
  run = recordAttempt(run, activity, wrong);
  assert.equal(run.attempts.at(-1)?.correct, false);
  assert.equal(run.attempts.at(-1)?.errorCategory, "incorrect-word-selection");
  const progress = progressFor([run]);
  assert.equal(progress.activitiesCompleted, 0);
  assert.deepEqual(progress.completedQuests, []);
  assert.equal(Object.hasOwn(progress, "status"), false);
});
