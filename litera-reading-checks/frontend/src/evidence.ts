import { request } from "./api";
import type { DetailedResult } from "./oral/types";

export interface AssessmentEvent {
  eventId: string;
  learnerId: string;
  skill: "phonics" | "oral" | "comprehension";
  sessionId: string;
  formId: string;
  difficultyTier: string;
  kind: "probe" | "exit_item" | "practice";
  correct: number | null;
  total: number | null;
  assisted: boolean;
  usable: boolean;
  timestamp: string;
  formVersion: string;
  rubricVersion: string;
  conditions: string;
  submissionStatus: "complete" | "incomplete" | "interrupted" | "invalid";
  reviewReason: string | null;
  passageId: string | null;
}

export type Status = "SUPPORT" | "READY" | "UNCONFIRMED";

export interface SkillState {
  skill: AssessmentEvent["skill"];
  difficultyTier: string;
  status: Status;
  latestUsableScore: number | null;
  rawBelowCutoff: boolean | null;
  missingEvidence: boolean;
  reassess: boolean;
  reason: string;
  confirmationEventIds: string[];
}

export interface EvidenceProfile {
  learnerId: string;
  skills: SkillState[];
  activeGaps: AssessmentEvent["skill"][];
  unconfirmed: AssessmentEvent["skill"][];
  missingEvidence: AssessmentEvent["skill"][];
  reassessmentQueue: AssessmentEvent["skill"][];
  events: AssessmentEvent[];
  planInput: {
    evidence: Record<AssessmentEvent["skill"], {
      status: Lowercase<Status>;
      score: number | null;
      raw_below: boolean;
      recheck: boolean;
      note: string;
    }>;
    override?: { activity: string; reason: string };
  };
}

export function getEvidence(learnerId: string, signal?: AbortSignal) {
  return request<EvidenceProfile>(`/api/evidence/learners/${encodeURIComponent(learnerId)}`, { signal });
}

export async function recordOral(result: DetailedResult) {
  const { event, assistance, words } = result;
  return request<{ event: AssessmentEvent }>("/api/evidence/oral", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventId: event.eventId, learnerId: event.learnerId, sessionId: event.sessionId,
      formId: event.formId, passageVersion: event.passageVersion, assistance, verified: true,
      words: words.map(({ id, judgment }) => ({ id, judgment })),
    }),
  });
}
