export type Judgment = "CORRECT" | "INCORRECT" | "UNASSESSED" | "UNCLEAR";
export type Assistance = "independent" | "teacher-assisted" | "modeling" | "prompting";
export type Quality = "complete" | "incomplete" | "unclear" | "interrupted";

export interface Passage {
  passageId: string;
  formId: string;
  title: string;
  text: string;
  difficultyTier: string;
  wordCount: number;
  competency: string;
  version: string;
  source: string;
}

export interface Word {
  id: string;
  text: string;
}

export interface Session {
  eventId: string;
  learnerId: string;
  sessionId: string;
  passage: Passage;
  judgments: Readonly<Record<string, Judgment>>;
  assistance: Assistance;
  quality: Quality;
  verified: boolean;
}

export interface OralEvent {
  eventId: string;
  learnerId: string;
  sessionId: string;
  skill: "oral";
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

export interface DetailedResult {
  event: OralEvent;
  assistance: Assistance;
  words: (Word & { judgment: "CORRECT" | "INCORRECT" })[];
}

export interface TreeCheck {
  skill: "oral";
  form: string;
  session: string;
  tier: string;
  kind: "probe";
  correct: number;
  total: number;
  assisted: boolean;
  usable: true;
}
