import type { EvidenceProfile } from "../evidence";
import type { PracticeRun } from "./activity";
import { activities } from "./activity";
import { progressFor, recommendedQuest, zones } from "./quests";

export function QuestMap({ profile, records }: { profile: EvidenceProfile; records: PracticeRun[] }) {
  const complete = progressFor(records);
  const quest = recommendedQuest(profile.recommendation.primary, profile.selectedTiers,
    records.filter(item => item.completedAt).map(item => item.activityId));
  return <section className="quest-map" aria-label="My private reading journey">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="text-lg font-bold">My Reading Journey</h4>
      <p className="text-sm">★ {complete.activitiesCompleted} activities completed</p>
    </div>
    <p className="text-sm">Practice progress only. It does not mean you have passed an assessment.</p>
    <ol className="quest-zones">
      {zones.map((zone, index) => <li key={zone.skill} className={quest?.zone === zone.name ? "quest-zone selected" : "quest-zone"}>
        <span aria-hidden="true" className="quest-number">{index + 1}</span>
        <div><strong>{zone.name}</strong><p className="text-sm">{zone.description}</p>
          {quest?.zone === zone.name && <p className="text-sm font-semibold">Recommended quest: {quest.title}</p>}
          <p className="text-sm">{records.filter(record => record.skill === zone.skill && record.completedAt).length} completed</p>
        </div>
      </li>)}
    </ol>
    {complete.activitiesCompleted > 0 && <div className="mt-3">
      <p className="font-semibold">My completed reading quests</p>
      <ul className="list-disc pl-5 text-sm">
        {records.filter(item => item.completedAt).slice(-3).map(item =>
          <li key={item.runId}>{activities.find(activity => activity.id === item.activityId)?.title ?? item.activityId}</li>)}
      </ul>
      <p className="text-sm">You practiced these activities. Only a fresh independent check can update skill status.</p>
    </div>}
  </section>;
}
