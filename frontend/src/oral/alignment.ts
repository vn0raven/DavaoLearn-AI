import type { Word } from "./types";

export type Suggestion = { kind: "MATCH" | "DIFFERENT" | "NOT_HEARD"; heard?: string };
const normalize = (word: string) => word.toLowerCase().replaceAll("’", "'");

export function alignReading(words: readonly Word[], transcript: string): Record<string, Suggestion> {
  const heard = transcript.match(/\p{L}+(?:[’'-]\p{L}+)*/gu) ?? [];
  // No usable transcript is not evidence of an omission.
  if (!heard.length || !words.length) return {};
  if (heard.length > 2000 || words.length > 200) throw new Error("The transcript is too long to compare.");
  const expected = words.map(w => normalize(w.text));
  const tokens = heard.map(normalize);
  const n = words.length, m = tokens.length;
  const costs = Array.from({length: n + 1}, () => new Float64Array(m + 1));
  for (let i = n; i >= 0; i--) {
    for (let j = m; j >= 0; j--) {
      if (i === n) costs[i][j] = m - j;
      else if (j === m) costs[i][j] = n - i;
      else costs[i][j] = Math.min(
        costs[i+1][j+1] + (expected[i] === tokens[j] ? 0 : 1.5),
        costs[i+1][j] + 1,
        costs[i][j+1] + 1,
      );
    }
  }
  const result: Record<string, Suggestion> = {};
  let i = 0, j = 0;
  while (i < n) {
    if (j < m && expected[i] === tokens[j] && costs[i][j] === costs[i+1][j+1]) {
      result[words[i++].id] = {kind:"MATCH", heard:heard[j++]};
    } else if (j < m && costs[i][j] === costs[i+1][j+1] + 1.5) {
      result[words[i++].id] = {kind:"DIFFERENT", heard:heard[j++]};
    } else if (costs[i][j] === costs[i+1][j] + 1) {
      result[words[i++].id] = {kind:"NOT_HEARD"};
    } else {
      j++;
    }
  }
  return result;
}

export function reviewSuggestions(
  suggestions: Readonly<Record<string, Suggestion>>,
  manual: Readonly<Record<string, import("./types").Judgment>>,
) {
  const reviewed = {...manual};
  for (const [id, suggestion] of Object.entries(suggestions)) {
    if (id in reviewed) continue;
    reviewed[id] = suggestion.kind === "MATCH" ? "CORRECT" : "INCORRECT";
  }
  return reviewed;
}
