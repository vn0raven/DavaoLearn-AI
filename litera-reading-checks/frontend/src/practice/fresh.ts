import { request } from "../api";
import type { Skill } from "./activity";

export interface FreshCheck {
  skill: Skill;
  formId: string | null;
  difficultyTier: string;
  reason?: string;
}

export function freshCheck(learnerId: string, skill: Skill, tier: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ skill, tier });
  return request<FreshCheck>(`/api/assessment-forms/fresh/${encodeURIComponent(learnerId)}?${query}`, { signal });
}

export function recordExposure(learnerId: string, formId: string, requireFresh = false) {
  return request<{ recorded: boolean }>("/api/assessment-forms/exposure", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ learnerId, formId, requireFresh }),
  });
}
