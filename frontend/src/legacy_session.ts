import type { Receipt } from "./contracts";
import type { Receipt as ComprehensionReceipt } from "./comprehension/types";
import type { DetailedResult } from "./oral/types";
import { toTreeCheck } from "./oral/scoring";

export interface SessionIdentity {
  learnerId: string;
  sessionId: string;
}
export type ReadingEvidence =
  | { skill: "phonics"; event: Receipt["event"]; check: Receipt["treeCheck"] }
  | { skill: "oral"; event: DetailedResult["event"]; check: ReturnType<typeof toTreeCheck> }
  | { skill: "comprehension"; event: ComprehensionReceipt["event"]; check: ComprehensionReceipt["treeCheck"] };

export function addEvidence(
  identity: SessionIdentity, entries: readonly ReadingEvidence[], next: ReadingEvidence,
): ReadingEvidence[] {
  if (next.event.learnerId !== identity.learnerId || next.event.sessionId !== identity.sessionId) {
    throw new Error("Evidence belongs to a different learner or session.");
  }
  if (entries.some(entry => entry.event.eventId === next.event.eventId)) return [...entries];
  if (!next.event.assisted && entries.some(entry => !entry.event.assisted && entry.skill === next.skill &&
    entry.event.difficultyTier === next.event.difficultyTier)) {
    throw new Error("This session already has an independent check for this skill and tier.");
  }
  return [...entries, next];
}

export function buildHandoff(identity: SessionIdentity, entries: readonly ReadingEvidence[]) {
  return {
    ...identity,
    events: entries.map(entry => entry.event),
    independentChecks: entries.filter(entry => entry.event.usable && !entry.event.assisted).map(entry => entry.check),
  };
}
