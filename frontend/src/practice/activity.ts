import type { Profile, Skill } from "../models";
type RecommendedActivity = NonNullable<Profile["recommendation"]["primary"]>;
import type { SessionIdentity } from "../session";
import pack from "./content.json";

export type { Skill } from "../models";
type Guide = { kind: "guide"; prompt: string; cue: string; action: string; hints?: [string, string, string] };
type Choice = { kind: "choice"; prompt: string; hint: string; hints?: [string, string, string]; errorCategory?: string; options: string[];
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
  errorCategory?: string;
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
  hintHistory?: { step: number; level: 1 | 2 | 3; requestedAt: string }[];
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
    startedAt, completedAt: null, step: 0, attempts: [], hints: [], hintHistory: [], notes: "", intendedUse: "practice" };
}

/** Guided-practice-only assistance; it never creates assessment evidence. */
export function hintLevel(run: PracticeRun): number {
  return run.hintHistory
    ? run.hintHistory.filter(item => item.step === run.step).length
    : Number(run.hints.includes(run.step));
}

export function hintText(run: PracticeRun, activity: Activity): string | undefined {
  const level = hintLevel(run);
  if (!level) return undefined;
  const step = activity.steps[run.step];
  if (!step) return undefined;
  if (step.hints) return step.hints[level - 1];
  if (step.kind === "guide") return level === 1 ? "Notice the words or sounds you want to practice." :
    level === 2 ? "Ask your teacher to demonstrate the strategy slowly." : step.cue;
  return level === 1 ? "Look again at the question and the words in the text." :
    level === 2 ? step.hint : step.feedback;
}

export function useHint(run: PracticeRun, activity: Activity, requestedAt = new Date().toISOString()): PracticeRun {
  if (run.completedAt || !activity.steps[run.step] || hintLevel(run) >= 3 ||
      run.attempts.some(attempt => attempt.step === run.step && attempt.correct !== false)) return run;
  const nextLevel = (hintLevel(run) + 1) as 1 | 2 | 3;
  return { ...run, hints: run.hints.includes(run.step) ? run.hints : [...run.hints, run.step],
    hintHistory: [...(run.hintHistory ?? run.hints.map(step => ({ step, level: 1 as const, requestedAt: run.startedAt }))),
      { step: run.step, level: nextLevel, requestedAt }] };
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
    ...(step.kind === "choice" && response !== step.answer && step.errorCategory ? { errorCategory: step.errorCategory } : {}),
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
