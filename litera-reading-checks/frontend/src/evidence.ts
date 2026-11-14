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

export interface RecommendedActivity {
  skill: AssessmentEvent["skill"] | null;
  activityId: string;
  label: string;
  purpose: string;
  difficultyTier: string | null;
}

export interface Recommendation {
  primary: RecommendedActivity;
  secondary: RecommendedActivity;
  pendingRechecks: AssessmentEvent["skill"][];
  queuedGaps: AssessmentEvent["skill"][];
  teacherReviewRequired: boolean;
  explanation: string;
}

export interface EvidenceProfile {
  learnerId: string;
  skills: SkillState[];
  activeGaps: AssessmentEvent["skill"][];
  unconfirmed: AssessmentEvent["skill"][];
  missingEvidence: AssessmentEvent["skill"][];
  reassessmentQueue: AssessmentEvent["skill"][];
  events: AssessmentEvent[];
  recommendation: Recommendation;
  selectedTiers: Record<AssessmentEvent["skill"], string>;
  rejectedSubmissions?: { eventId: string; reason: string; receivedAt: string }[];
  originalSubmissions?: Record<string, unknown>;
  revisions?: { eventId: string; before: unknown; after: unknown }[];
  overrides?: { overrideId: string; why: string; timestamp: string; primaryActivityId?: string }[];
  planInput: {
    evidence: Record<AssessmentEvent["skill"], {
      status: Lowercase<Status>;
      score: number | null;
      raw_below: boolean;
      recheck: boolean;
      note: string;
    }>;
    learnerId: string;
    selectedTiers: Record<AssessmentEvent["skill"], string>;
    evidenceRefs: Record<AssessmentEvent["skill"], string | null>;
    print_accessible: boolean;
    support_stalled: boolean;
    override?: { reason: string; activity?: string; primaryActivityId?: string; secondaryActivityId?: string;
      primaryDifficultyTier?: string; secondaryDifficultyTier?: string; overrideId?: string; sessionId?: string };
  };
}

export function getEvidence(learnerId: string, sessionId: string, printAccessible: boolean, signal: AbortSignal) {
  const query = new URLSearchParams({ overrideSession: sessionId, printAccessible: String(printAccessible) });
  return request<EvidenceProfile>(`/api/evidence/learners/${encodeURIComponent(learnerId)}?${query}`, { signal });
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

/** Demonstration-only endpoint: do not expose this API to real learners without server-side teacher authorization. */
export function saveTeacherOverride(input: {
  learnerId: string; sessionId: string; primaryActivityId: string; why: string;
}) {
  return request<{ overrideId: string }>("/api/evidence/overrides", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, overrideId: crypto.randomUUID(), timestamp: new Date().toISOString() }),
  });
}
