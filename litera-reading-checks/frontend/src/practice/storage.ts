import type { PracticeRun } from "./activity";

const prefix = "litera-practice-v1:";

export function readPractice(storage: Pick<Storage, "getItem" | "setItem">, learnerId: string): PracticeRun[] {
  const raw = storage.getItem(prefix + learnerId);
  return raw ? JSON.parse(raw) : [];
}

export function savePractice(storage: Pick<Storage, "getItem" | "setItem">, run: PracticeRun) {
  const records = readPractice(storage, run.learnerId);
  const prior = records.find(item => item.runId === run.runId);
  if (prior?.completedAt) return prior;
  storage.setItem(prefix + run.learnerId, JSON.stringify([...records.filter(item => item.runId !== run.runId), run]));
  return run;
}

interface ReviewRequest {
  skill: PracticeRun["skill"];
  tier: string;
  requestedAt: string;
}

const queuePrefix = "litera-practice-review-v1:";

export function readQueue(storage: Pick<Storage, "getItem" | "setItem">, learnerId: string): ReviewRequest[] {
  const raw = storage.getItem(queuePrefix + learnerId);
  return raw ? JSON.parse(raw) : [];
}

export function setQueue(storage: Pick<Storage, "getItem" | "setItem">, learnerId: string, skill: ReviewRequest["skill"], tier: string, at?: string) {
  const queue = readQueue(storage, learnerId).filter(item => item.skill !== skill || item.tier !== tier);
  if (at) queue.push({ skill, tier, requestedAt: at });
  storage.setItem(queuePrefix + learnerId, JSON.stringify(queue));
  return queue;
}
