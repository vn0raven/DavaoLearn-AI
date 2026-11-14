import test from "node:test";
import assert from "node:assert/strict";
import passages from "../src/oral/data/passages.json";
import { accuracy, buildResult, counts, createReceiver, mark, tokenize, toTreeCheck, validatePassages, wordsOf } from "../src/oral/scoring";
import type { Passage, Session } from "../src/oral/types";

function passage(text: string, wordCount: number): Passage {
  return { ...passages[0], text, wordCount };
}
function session(p = passages[0]): Session {
  return {
    eventId: "oral-001", learnerId: "demo-001", sessionId: "s1",
    passage: p, judgments: {}, assistance: "independent", quality: "complete", verified: false,
  };
}
function observed(p = passages[0], wrong = 0): Session {
  const current = session(p);
  const judgments = Object.fromEntries(wordsOf(p).map((word, index) =>
    [word.id, index < wrong ? "INCORRECT" : "CORRECT"] as const));
  return {...current, judgments, verified: true};
}

test("all words correct", () => {
  const result = buildResult(observed());
  assert.equal(result.event.correct, 41);
  assert.equal(result.event.score, 100);
});

test("several errors preserve the denominator", () => {
  const result = buildResult(observed(passages[1], 7));
  assert.equal(result.event.correct, 33);
  assert.equal(result.event.total, 40);
  assert.equal(result.event.score, 82.5);
});

test("repeated words get different position IDs", () => {
  const p = passage("The cat saw the dog.", 5);
  const words = wordsOf(p);
  assert.notEqual(words[0].id, words[3].id);
  const first = mark(mark(session(p), words[0].id, "CORRECT"), words[3].id, "INCORRECT");
  assert.deepEqual(counts(first), {total:5, correct:1, incorrect:1, unassessed:3, unclear:0, preview:50});
});

test("punctuation is displayed but cannot be scored", () => {
  const p = passage("“Look,” she said. Don't re-read.", 5);
  const parts = tokenize(p);
  assert.equal(parts.map(part => typeof part === "string" ? part : part.text).join(""), p.text);
  assert.deepEqual(wordsOf(p).map(word => word.text), ["Look","she","said","Don't","re-read"]);
});

test("unassessed or unclear words prevent final scoring", () => {
  assert.throws(() => buildResult({...session(), verified:true}), /every word/);
  const current = observed();
  const changed = mark(current, wordsOf(current.passage)[0].id, "UNCLEAR");
  assert.equal(counts(changed).unclear, 1);
  assert.throws(() => buildResult({...changed, verified:true}), /every word/);
});

test("a correction replaces the previous judgment and clears verification", () => {
  const current = observed(passages[0], 1);
  const id = wordsOf(current.passage)[0].id;
  const changed = mark(mark(current, id, "CORRECT"), id, "CORRECT");
  assert.equal(Object.keys(changed.judgments).length, 41);
  assert.equal(counts(changed).correct, 41);
  assert.equal(counts(changed).incorrect, 0);
  assert.throws(() => buildResult(changed), /Confirm/);
});

test("accuracy validates counts and the full passage denominator", () => {
  assert.equal(accuracy(43, 50), 86);
  for (const values of [[-1, 5],[6, 5],[1, 0],[1.5, 5]]) {
    assert.throws(() => accuracy(values[0], values[1]), /Counts/);
  }
});

test("preserves exact 75, 80 and 85 boundaries and nearby values for the tree", () => {
  const p = passage(Array(100).fill("word").join(" "), 100);
  for (const score of [74, 75, 79, 80, 85, 86]) {
    const result = buildResult(observed(p, 100 - score));
    assert.equal(result.event.score, score);
    const check = toTreeCheck(result.event);
    assert.equal(accuracy(check.correct, check.total), score);
  }
  assert.equal(accuracy(32, 41), 100 * 32 / 41);
});

test("teacher-assisted, modeled and prompted probes remain practice evidence", () => {
  for (const assistance of ["teacher-assisted","modeling","prompting"] as const) {
    const result = buildResult({...observed(), assistance});
    assert.equal(result.event.assisted, true);
    assert.equal(result.assistance, assistance);
    assert.equal(toTreeCheck(result.event).assisted, true);
  }
});

test("incomplete, unclear and interrupted observations cannot emit a result", () => {
  for (const quality of ["incomplete","unclear","interrupted"] as const) {
    assert.throws(() => buildResult({...observed(), quality}), /Observation/);
  }
});

test("deduplicates an event and a second independent probe in the same session", () => {
  const current = observed();
  const receive = createReceiver();
  const result = receive(current);
  assert.throws(() => receive(current), /already been submitted/);
  assert.throws(() => receive({...observed(passages[1]), eventId:"oral-002"}), /already exists/);
  assert.throws(() => createReceiver([result.event])(current), /already been submitted/);
  const next = receive({...observed(passages[1]), eventId:"oral-003", sessionId:"s2"});
  assert.equal(next.event.formId, "ORAL-B");
});

test("lightweight event serialization keeps form, passage, version, and difficulty", () => {
  const result = buildResult(observed(), new Date("2026-11-14T10:00:00Z"));
  assert.deepEqual(JSON.parse(JSON.stringify(result.event)), {
    eventId:"oral-001", learnerId:"demo-001", sessionId:"s1", skill:"oral",
    formId:"ORAL-A", passageId:"seed-bag", passageVersion:"1.0.0",
    difficultyTier:"short-text", kind:"probe", correct:41, total:41, score:100,
    assisted:false, usable:true, timestamp:"2026-11-14T10:00:00.000Z",
  });
  assert.equal(result.words.length, 41);
});

test("actual data passes word-count checks and malformed metadata is rejected", () => {
  validatePassages(passages);
  assert.throws(() => validatePassages([{...passages[0], wordCount:50}]), /Declared count/);
  assert.throws(() => validatePassages([passages[0], passages[0]]), /unique/);
});

test("adapter maps to the existing Check model and strips word UI state", () => {
  const result = buildResult(observed(passages[1], 8));
  assert.deepEqual(toTreeCheck(result.event), {
    skill:"oral", form:"ORAL-B", session:"s1", tier:"short-text", kind:"probe",
    correct:32, total:40, assisted:false, usable:true,
  });
});

test("unknown IDs cannot add scores", () => {
  assert.throws(() => mark(session(), "unknown", "CORRECT"), /Unknown word/);
  const current = observed();
  assert.equal(buildResult({...current, judgments:{...current.judgments, unknown:"CORRECT"}}).event.correct, 41);
});
