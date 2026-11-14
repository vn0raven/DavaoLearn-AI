import type { AssessmentEvent } from "../evidence";

export interface FormSummary {
  formId: string;
  passageId: string;
  title: string;
  difficultyTier: string;
  version: string;
  source: string;
  licensingStatus: string;
  competencies: string[];
}

export interface Choice {
  answerId: string;
  text: string;
}

export interface Question {
  questionId: string;
  prompt: string;
  choices: Choice[];
}

export interface ComprehensionForm extends FormSummary {
  text: string;
  questions: Question[];
}

export type Mode = "independent" | "assisted";

export interface LearnerResponse {
  questionId: string;
  answerId: string;
}

export interface ComprehensionEvent {
  eventId: string;
  learnerId: string;
  sessionId: string;
  skill: "comprehension";
  formId: string;
  passageId: string;
  passageVersion: string;
  difficultyTier: string;
  kind: "probe";
  correct: number;
  total: number;
  score: number;
  assisted: boolean;
  usable: true;
  timestamp: string;
}

export type TreeCheck = Pick<ComprehensionEvent, "skill" | "kind" | "correct" | "total" | "assisted" | "usable"> & {
  form: string;
  session: string;
  tier: string;
};

export interface Receipt {
  event: ComprehensionEvent;
  evidence: AssessmentEvent;
  treeCheck: TreeCheck;
  responses: (LearnerResponse & { correct: boolean })[];
  incorrect: number;
  unanswered: number;
  quality: "complete";
}
