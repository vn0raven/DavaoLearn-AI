import type { AssessmentEvent, RecommendedActivity } from "../evidence";
import type { SessionIdentity } from "../session";
import pack from "./content.json";

export type Skill = AssessmentEvent["skill"];
type Guide = { kind: "guide"; prompt: string; cue: string; action: string };
type Choice = { kind: "choice"; prompt: string; hint: string; options: string[];
  answer: number; feedback: string; evidenceLine?: number };

export interface Activity {
  id: string;
  skill: Skill;
  type: string;
  categories: string[];
  difficultyTier: string;
  competencies: string[];
  title: string;
  instructions: string;
  version: string;
  source: string;
  license: string;
  intendedUse: "practice";
  assistance: "teacher-guided";
  passageId?: string;
  passage?: string[];
  wordCues?: { word: string; cue: string }[];
  steps: (Guide | Choice)[];
}

export const activities = pack as Activity[];

export interface Attempt {
  step: number;
  response: number | "guided";
  correct: boolean | null;
  assistance: ("teacher-guided" | "hint" | "corrective-feedback")[];
}

export interface PracticeRun extends SessionIdentity {
  runId: string;
  activityId: string;
  contentVersion: string;
  skill: Skill;
  difficultyTier: string;
  passageId?: string;
  startedAt: string;
  completedAt: string | null;
  step: number;
  attempts: Attempt[];
  hints: number[];
  notes: string;
  intendedUse: "practice";
}

export function selectActivity(
  recommendation: RecommendedActivity, tiers: Record<Skill, string>, used: readonly string[], competency?: string,
): Activity | undefined {
  const matches = activities.filter(activity =>
    activity.categories.includes(recommendation.activityId) &&
    (!recommendation.skill || recommendation.skill === activity.skill) &&
    activity.difficultyTier === (recommendation.difficultyTier ?? tiers[activity.skill]) &&
    (!competency || activity.competencies.includes(competency)),
  );
  return matches.find(activity => !used.includes(activity.id)) ?? matches[0];
}

export function startPractice(
  activity: Activity, identity: SessionIdentity, runId: string, startedAt: string,
): PracticeRun {
  return { ...identity, runId, activityId: activity.id, contentVersion: activity.version,
    skill: activity.skill, difficultyTier: activity.difficultyTier, passageId: activity.passageId,
    startedAt, completedAt: null, step: 0, attempts: [], hints: [], notes: "", intendedUse: "practice" };
}

export function useHint(run: PracticeRun, activity: Activity): PracticeRun {
  if (run.completedAt || activity.steps[run.step]?.kind !== "choice" || run.hints.includes(run.step) ||
      run.attempts.some(attempt => attempt.step === run.step && attempt.correct)) return run;
  return { ...run, hints: [...run.hints, run.step] };
}

export function recordAttempt(run: PracticeRun, activity: Activity, response: Attempt["response"]): PracticeRun {
  const step = activity.steps[run.step];
  const previous = run.attempts.filter(attempt => attempt.step === run.step);
  if (run.completedAt || !step || previous.some(attempt => attempt.correct !== false)) return run;
  if (step.kind === "guide" ? response !== "guided" :
      typeof response !== "number" || !Number.isInteger(response) || !step.options[response]) return run;
  const assistance: Attempt["assistance"] = ["teacher-guided"];
  if (run.hints.includes(run.step)) assistance.push("hint");
  if (previous.length) assistance.push("corrective-feedback");
  return { ...run, attempts: [...run.attempts, {
    step: run.step, response, correct: step.kind === "choice" ? response === step.answer : null, assistance,
  }] };
}

export function feedback(run: PracticeRun, activity: Activity) {
  const step = activity.steps[run.step];
  const attempt = run.attempts.filter(item => item.step === run.step).at(-1);
  if (step?.kind !== "choice" || !attempt) return undefined;
  return { text: step.feedback, correct: attempt.correct, line: step.evidenceLine };
}

export function nextStep(run: PracticeRun, activity: Activity, timestamp: string): PracticeRun {
  if (run.completedAt || !run.attempts.some(attempt => attempt.step === run.step && attempt.correct !== false)) return run;
  return run.step + 1 < activity.steps.length
    ? { ...run, step: run.step + 1 }
    : { ...run, completedAt: timestamp };
}
