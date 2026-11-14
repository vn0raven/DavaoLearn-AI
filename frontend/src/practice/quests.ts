import type { Profile } from "../models";
type RecommendedActivity = NonNullable<Profile["recommendation"]["primary"]>;
import { activities, selectActivity } from "./activity";
import type { Activity, PracticeRun, Skill } from "./activity";

export const zones = [
  { skill: "phonics", name: "Word Village", description: "Letter sounds and blending" },
  { skill: "oral", name: "Story Forest", description: "Guided reading and rereading" },
  { skill: "comprehension", name: "Meaning Mountain", description: "Story details and meaning" },
] as const;

export function questFor(activity: Activity) {
  const zone = zones.find(item => item.skill === activity.skill)!;
  return { id: `quest-${activity.id}`, linkedActivityId: activity.id, targetSkill: activity.skill,
    difficultyTier: activity.difficultyTier, title: activity.title, instructions: activity.instructions,
    completionCriteria: "Complete the guided steps in the linked activity", zone: zone.name };
}

export function progressFor(records: readonly PracticeRun[]) {
  const completed = records.filter(item => Boolean(item.completedAt) &&
    activities.some(activity => activity.id === item.activityId && activity.version === item.contentVersion));
  return { completedQuests: [...new Set(completed.map(item => `quest-${item.activityId}`))],
    activitiesCompleted: completed.length, usedHints: completed.reduce((total, item) => total + (item.hintHistory?.length ?? item.hints.length), 0) };
}

export function recommendedQuest(recommendation: RecommendedActivity | undefined, tiers: Record<Skill, string>, used: readonly string[]) {
  if (!recommendation) return undefined;
  const activity = selectActivity(recommendation, tiers, used);
  return activity ? questFor(activity) : undefined;
}
