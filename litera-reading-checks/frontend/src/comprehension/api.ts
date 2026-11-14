import { request } from "../api";
import type { SessionIdentity } from "../session";
import type { ComprehensionForm, FormSummary, LearnerResponse, Mode, Receipt } from "./types";

const root = "/api/comprehension";

export interface StartRequest extends SessionIdentity {
  eventId: string;
  formId: string;
  difficultyTier: string;
  mode: Mode;
  requireFresh?: boolean;
}

function post(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export const listForms = (signal: AbortSignal) => request<FormSummary[]>(`${root}/forms`, { signal });
export const startAssessment = (data: StartRequest) => request<ComprehensionForm>(`${root}/start`, post(data));
export const completeAssessment = (eventId: string, responses: LearnerResponse[], assisted: boolean) =>
  request<Receipt>(`${root}/${eventId}/complete`, post({ responses, assisted }));

export async function interruptAssessment(eventId: string) {
  const response = await fetch(`${root}/${eventId}/interrupt`, { method: "POST", keepalive: true });
  if (!response.ok) throw new Error("Could not close this attempt on the server.");
}
