import type { AssessmentEvent } from "./evidence";

export interface Target { itemId: string; word: string }
export interface Form {
  formId: string;
  difficultyTier: string;
  pattern: string;
  items: Target[];
}
export type Verdict = "CORRECT" | "INCORRECT" | "UNCLEAR";
export type Signal = "match" | "possible_mismatch" | "unavailable" | "review";
export interface SpeechResult {
  attemptId: string;
  transcript: string;
  indication: Signal;
  message: string | null;
}
export interface Judgment {
  itemId: string;
  attemptId: string;
  verdict: Verdict;
  assisted: boolean;
}
export interface Submission {
  eventId: string;
  learnerId: string;
  formId: string;
  sessionId: string;
  judgments: Judgment[];
}
export interface PhonicsEvidence {
  eventId: string;
  learnerId: string;
  skill: "phonics";
  formId: string;
  sessionId: string;
  difficultyTier: string;
  kind: "probe";
  correct: number;
  total: 5;
  score: number;
  assisted: boolean;
  usable: true;
  reviewRequired: boolean;
  timestamp?: string;
  formVersion?: string;
}
export type TreeCheck = Pick<PhonicsEvidence, "skill" | "kind" | "correct" | "total" | "assisted" | "usable"> & {
  form: string;
  session: string;
  tier: string;
};
export interface Receipt { event: PhonicsEvidence; evidence: AssessmentEvent; treeCheck: TreeCheck }
