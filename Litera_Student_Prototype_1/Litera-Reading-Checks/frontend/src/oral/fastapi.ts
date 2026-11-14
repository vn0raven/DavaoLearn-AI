import { toTreeCheck } from "./scoring";
import type { OralEvent, TreeCheck } from "./types";

// The existing endpoint evaluates supplied history. The host owns persistence and deduplication.
export async function submitOralForPlan<T>(
  event: OralEvent,
  previousChecks: readonly (Omit<TreeCheck, "skill" | "kind" | "usable"> & {
    skill: "phonics" | "oral" | "comprehension";
    kind: "probe" | "exit_item";
    usable: boolean;
  })[],
  endpoint = "/api/plan",
): Promise<T> {
  if (event.assisted || !event.usable) throw new Error("Only usable independent evidence is sent to the adaptive engine.");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({checks: [...previousChecks, toTreeCheck(event)], tier: event.difficultyTier}),
  });
  if (!response.ok) throw new Error(`Adaptive engine rejected the request (${response.status}).`);
  return response.json();
}
