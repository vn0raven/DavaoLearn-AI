import assert from "node:assert/strict";
import test from "node:test";
import { alignReading, reviewSuggestions } from "../src/oral/alignment";

const words = (text: string) => text.split(" ").map((token, i) => ({ id: String(i), text: token }));
test("matches despite punctuation and case", () => {
  const result = alignReading(words("The cat sat"), "THE cat sat.");
  assert.deepEqual(Object.values(result).map(m => m.kind), ["MATCH","MATCH","MATCH"]);
});
test("flags a substitution or omitted word without shifting later words", () => {
  const target = words("the cat can sit");
  assert.deepEqual(alignReading(target, "the cap can sit")["1"], {kind:"DIFFERENT",heard:"cap"});
  const skipped = alignReading(target, "the cat sit");
  assert.equal(skipped["2"].kind, "NOT_HEARD");
  assert.equal(skipped["3"].kind, "MATCH");
});
test("repeated words and added words do not shift clean matches", () => {
  const result = alignReading(words("the dog saw the cat"), "the dog um saw the cat");
  assert.ok(Object.values(result).every(m => m.kind === "MATCH"));
  assert.equal(Object.keys(result).length, 5);
});
test("empty transcript generates no marks", () => {
  assert.deepEqual(alignReading(words("the dog"), ""), {});
});
test("confirming suggestions never overwrites teacher judgments", () => {
  const suggestions = alignReading(words("the dog sat"), "the cat sat");
  assert.deepEqual(reviewSuggestions(suggestions, {"0":"UNCLEAR","1":"CORRECT"}),
    {"0":"UNCLEAR","1":"CORRECT","2":"CORRECT"});
});
