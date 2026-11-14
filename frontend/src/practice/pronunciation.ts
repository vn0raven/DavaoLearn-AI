import type { Activity, PracticeRun } from "./activity";

export type AudioSource = "model" | "passage" | "sentence" | "word" | "instructions" | "explanation" | "teacher-model";
export type PracticeAudio = { step: number; source: AudioSource };
export type ListenTarget = { id: string; source: AudioSource; label: string; text: string };

export function practiceTargets(activity: Activity, stepIndex: number, feedbackShown: boolean): ListenTarget[] {
  if (activity.intendedUse !== "practice") return [];
  const step = activity.steps[stepIndex];
  if (!step) return [];
  if (activity.skill === "phonics") {
    if (!step.modelWord || (step.kind === "choice" && !feedbackShown)) return [];
    return [{ id: "model", source: "model", label: step.modelWord, text: step.modelWord }];
  }
  const targets: ListenTarget[] = [];
  if (activity.passage?.length) {
    targets.push({ id: "passage", source: "passage", label: "Whole story", text: activity.passage.join(" ") });
    targets.push(...activity.passage.map((text, index): ListenTarget => ({
      id: `sentence-${index}`, source: "sentence", label: `Sentence ${index + 1}`, text,
    })));
  }
  if (activity.skill === "oral") {
    targets.push(...(activity.wordCues ?? []).map(({ word }, index): ListenTarget => ({
      id: `word-${index}`, source: "word", label: `Word: ${word}`, text: word,
    })));
  } else {
    targets.push({ id: "instructions", source: "instructions", label: "Activity instructions", text: activity.instructions });
    if (step.kind === "choice" && feedbackShown) {
      targets.push({ id: "explanation", source: "explanation", label: "Answer explanation", text: step.feedback });
    }
  }
  return targets;
}

export function teacherSoundModel(activity: Activity, stepIndex: number) {
  const step = activity.steps[stepIndex];
  if (activity.intendedUse !== "practice" || activity.skill !== "phonics" || step?.kind !== "guide") return;
  const model = step.soundModel;
  if (model?.label.trim() && /^[a-z0-9_-]+\.(mp3|wav|ogg)$/i.test(model.file)) {
    return { label: model.label, url: `/practice-audio/${model.file}` };
  }
}

export function logPracticeAudio(run: PracticeRun, step: number, source: AudioSource): PracticeRun {
  const used = run.audioAssistance ?? [];
  if (run.completedAt || run.step !== step || used.some(entry => entry.step === step && entry.source === source)) return run;
  return { ...run, audioAssistance: [...used, { step, source }] };
}
