import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { englishVoices, SpeechPlayback } from "../src/speech/playback";
import type { PlaybackState } from "../src/speech/playback";
import { activities, recordAttempt, startPractice } from "../src/practice/activity";
import { logPracticeAudio, practiceTargets, teacherSoundModel } from "../src/practice/pronunciation";

function voice(lang: string, localService = true, isDefault = false): SpeechSynthesisVoice {
  return { lang, localService, default: isDefault, voiceURI: lang, name: lang };
}

function setup(timeout?: number) {
  const spoken: SpeechSynthesisUtterance[] = [];
  const states: PlaybackState[] = [];
  let cancelled = 0;
  let started = 0;
  const player = new SpeechPlayback({
    cancel: () => { cancelled++; },
    speak: utterance => spoken.push(utterance),
  }, text => ({ text } as SpeechSynthesisUtterance), state => states.push(state), () => { started++; }, timeout);
  return { player, states, spoken, counts: () => ({ cancelled, started }) };
}

test("voice selection prefers Philippine English, then the default on-device English voice", () => {
  assert.deepEqual(englishVoices([voice("en-US", false, true), voice("fr-FR", true, true),
    voice("en-GB"), voice("en-AU", true, true), voice("en-PH")]).map(item => item.lang),
  ["en-PH", "en-AU", "en-GB"]);
  assert.deepEqual(englishVoices([voice("en-US", false), voice("fil-PH")]), []);
});

test("normal and slow playback cancel the previous utterance; stale speech callbacks are ignored", () => {
  const { player, states, spoken, counts } = setup();
  const english = voice("en-GB");
  player.play("hunt", english, 1);
  const staleStart = spoken[0]!.onstart!;
  player.play("hunt", english, 0.75);
  staleStart.call(spoken[0]!, new Event("start") as SpeechSynthesisEvent);
  assert.deepEqual(counts(), { cancelled: 2, started: 0 });
  assert.deepEqual(spoken.map(item => [item.text, item.lang, item.rate]), [["hunt", "en-GB", 1], ["hunt", "en-GB", 0.75]]);
  spoken[1]!.onstart!(new Event("start") as SpeechSynthesisEvent);
  assert.equal(counts().started, 1);
  player.stop();
  assert.equal(spoken[1]!.onend, null);
  assert.equal(counts().cancelled, 3);
  assert.deepEqual(states, ["starting", "starting", "playing", "stopped"]);
});

test("ending and playback errors produce distinct states", () => {
  const { player, states, spoken, counts } = setup();
  player.play("mint", voice("en-US"), 1);
  spoken[0]!.onend!(new Event("end") as SpeechSynthesisEvent);
  player.play("mint", voice("en-US"), 1);
  spoken[1]!.onerror!(new Event("error") as SpeechSynthesisErrorEvent);
  assert.deepEqual(states, ["starting", "ended", "starting", "error"]);
  assert.equal(counts().started, 0);
});

test("speech that never starts is cancelled and reported", async () => {
  const { player, states, counts } = setup(1);
  player.play("mint", voice("en-US"), 1);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(states, ["starting", "error"]);
  assert.deepEqual(counts(), { cancelled: 2, started: 0 });
});

test("phonics models whole words, and withholds choice answers until feedback", () => {
  const activity = activities.find(item => item.skill === "phonics")!;
  assert.deepEqual(practiceTargets(activity, 0, false).map(item => item.text), ["hunt"]);
  assert.deepEqual(practiceTargets(activity, 1, false), []);
  assert.deepEqual(practiceTargets(activity, 1, true).map(item => item.text), ["tint"]);
  assert.deepEqual(practiceTargets(activity, -1, true), []);
});

test("synthesized phonics practice models are separate from the scored target list", () => {
  const forms = new URL("../../backend/forms/", import.meta.url);
  const scored = new Set<string>();
  for (const file of readdirSync(forms).filter(name => name.endsWith(".json"))) {
    const form = JSON.parse(readFileSync(new URL(file, forms), "utf8")) as { items: { word: string }[] };
    for (const item of form.items) scored.add(item.word.toLowerCase());
  }
  for (const activity of activities.filter(item => item.skill === "phonics")) {
    for (const [step] of activity.steps.entries()) {
      for (const target of practiceTargets(activity, step, true)) {
        assert.ok(!scored.has(target.text.toLowerCase()), `Scored word used as a spoken model: ${target.text}`);
      }
    }
  }
});

test("oral and comprehension allow only their authored practice material", () => {
  const oral = activities.find(item => item.skill === "oral")!;
  assert.equal(practiceTargets(oral, 0, false)[0]!.source, "passage");
  assert.ok(practiceTargets(oral, 0, false).some(item => item.source === "sentence"));
  assert.ok(practiceTargets(oral, 0, false).some(item => item.source === "word" && item.text === "knot"));
  const comp = activities.find(item => item.skill === "comprehension" && item.steps[0]?.kind === "choice")!;
  assert.ok(practiceTargets(comp, 0, false).some(item => item.source === "instructions"));
  assert.ok(!practiceTargets(comp, 0, false).some(item => item.source === "explanation"));
  assert.ok(practiceTargets(comp, 0, true).some(item => item.source === "explanation"));
});

test("teacher recordings are limited to configured practice guide steps with local media filenames", () => {
  const activity = structuredClone(activities.find(item => item.skill === "phonics")!);
  const step = activity.steps[0]!;
  if (step.kind !== "guide") throw new Error("Demo begins with a guide step");
  step.soundModel = { label: "Teacher sound model", file: "final-nt.wav" };
  assert.deepEqual(teacherSoundModel(activity, 0), {
    label: "Teacher sound model", url: "/practice-audio/final-nt.wav",
  });
  step.soundModel.file = "../final-nt.wav";
  assert.equal(teacherSoundModel(activity, 0), undefined);
});

test("listening tracks practice assistance once per step without changing responses", () => {
  const activity = activities.find(item => item.skill === "phonics")!;
  const run = startPractice(activity, { learnerId: "fictional", sessionId: "session" }, "run", "2026-11-15T00:00:00Z");
  const listened = logPracticeAudio(run, 0, "model");
  assert.deepEqual(listened.audioAssistance, [{ step: 0, source: "model" }]);
  assert.deepEqual(listened.attempts, []);
  assert.equal(listened.intendedUse, "practice");
  assert.equal(logPracticeAudio(listened, 0, "model"), listened);
  assert.equal(logPracticeAudio(listened, 1, "model"), listened);
  assert.deepEqual(recordAttempt(listened, activity, "guided").audioAssistance, listened.audioAssistance);
});
