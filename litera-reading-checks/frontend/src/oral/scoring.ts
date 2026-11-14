import type { DetailedResult, Judgment, OralEvent, Passage, Session, TreeCheck, Word } from "./types";

const validId = /^[A-Za-z0-9_-]{1,64}$/;
const judgments = new Set(["CORRECT", "INCORRECT", "UNASSESSED", "UNCLEAR"]);

export type PassagePart = Word | string;

export function tokenize(passage: Pick<Passage, "passageId" | "version" | "text">): PassagePart[] {
  // Internal apostrophes and hyphens stay with the word. Preserve all gaps and punctuation.
  const parts: PassagePart[] = [];
  let end = 0;
  let position = 0;
  for (const match of passage.text.matchAll(/\p{L}+(?:[’'-]\p{L}+)*/gu)) {
    const start = match.index;
    if (start > end) parts.push(passage.text.slice(end, start));
    parts.push({ id: `${passage.passageId}@${passage.version}:${++position}`, text: match[0] });
    end = start + match[0].length;
  }
  if (end < passage.text.length) parts.push(passage.text.slice(end));
  return parts;
}

export function wordsOf(passage: Passage): Word[] {
  return tokenize(passage).filter((part): part is Word => typeof part !== "string");
}

export function validatePassages(passages: Passage[]): void {
  const ids = new Set<string>();
  const forms = new Set<string>();
  if (!passages.length) throw new Error("Configure at least one demonstration passage.");
  for (const p of passages) {
    if (![p.passageId, p.formId, p.difficultyTier].every(id => validId.test(id)) ||
      !p.title?.trim() || !p.version?.trim() || !p.source?.trim() || !p.competency?.trim()) {
      throw new Error("Each passage must have complete metadata and valid identifiers.");
    }
    if (ids.has(p.passageId) || forms.has(p.formId)) throw new Error("Passage and form IDs must be unique.");
    ids.add(p.passageId);
    forms.add(p.formId);
    if (!Number.isInteger(p.wordCount) || p.wordCount < 1 || p.wordCount > 200 || wordsOf(p).length !== p.wordCount) {
      throw new Error(`Declared count does not match the scored words for ${p.formId} (limit: 200).`);
    }
  }
}

export function mark(session: Session, wordId: string, judgment: Judgment): Session {
  if (!wordsOf(session.passage).some(word => word.id === wordId) || !judgments.has(judgment)) {
    throw new Error("Unknown word or judgment.");
  }
  return { ...session, judgments: { ...session.judgments, [wordId]: judgment }, verified: false };
}

export function counts(session: Session) {
  const words = wordsOf(session.passage);
  const stats = { total: words.length, correct: 0, incorrect: 0, unassessed: 0, unclear: 0 };
  for (const word of words) {
    switch (session.judgments[word.id]) {
      case "CORRECT": stats.correct++; break;
      case "INCORRECT": stats.incorrect++; break;
      case "UNCLEAR": stats.unclear++; break;
      default: stats.unassessed++;
    }
  }
  const marked = stats.correct + stats.incorrect;
  return { ...stats, preview: marked ? accuracy(stats.correct, marked) : null };
}

export function accuracy(correct: number, total: number): number {
  if (!Number.isInteger(correct) || !Number.isInteger(total) || total < 1 || correct < 0 || correct > total) {
    throw new Error("Counts must be whole numbers with 0 ≤ correct ≤ total.");
  }
  return 100 * correct / total;
}

export function submissionIssue(session: Session): string | null {
  if (session.quality !== "complete") return "Observation is incomplete, unclear, or interrupted. Start a fresh check to submit usable evidence.";
  const stats = counts(session);
  if (stats.unassessed || stats.unclear) return "Finish judging every word. Leave uncertain words unscored until you can verify them.";
  if (!session.verified) return "Confirm that every word was observed and that the assistance setting is accurate.";
  return null;
}

export function buildResult(session: Session, now = new Date()): DetailedResult {
  validatePassages([session.passage]);
  if (![session.eventId, session.learnerId, session.sessionId].every(id => validId.test(id))) {
    throw new Error("Invalid event, learner, or session identifier.");
  }
  if (!["independent", "teacher-assisted", "modeling", "prompting"].includes(session.assistance)) {
    throw new Error("Specify how the passage was read.");
  }
  const issue = submissionIssue(session);
  if (issue) throw new Error(issue);
  const { total, correct } = counts(session);
  const passage = session.passage;
  const details = wordsOf(passage).map(word => {
    const judgment = session.judgments[word.id];
    if (judgment !== "CORRECT" && judgment !== "INCORRECT") throw new Error("Every word needs a usable judgment.");
    return { ...word, judgment };
  });
  return {
    event: {
      eventId: session.eventId, learnerId: session.learnerId, sessionId: session.sessionId,
      skill: "oral", formId: passage.formId, passageId: passage.passageId, passageVersion: passage.version,
      difficultyTier: passage.difficultyTier, kind: "probe", correct, total,
      score: accuracy(correct, total), assisted: session.assistance !== "independent", usable: true,
      timestamp: now.toISOString(),
    },
    assistance: session.assistance,
    words: details,
  };
}

export function toTreeCheck(event: OralEvent): TreeCheck {
  return {
    skill: event.skill, form: event.formId, session: event.sessionId, tier: event.difficultyTier,
    kind: event.kind, correct: event.correct, total: event.total, assisted: event.assisted, usable: event.usable,
  };
}

export function createReceiver(previous: readonly OralEvent[] = []) {
  const ids = new Set(previous.map(event => event.eventId));
  const independentKeys = new Set(previous.filter(event => !event.assisted).map(independentKey));
  function independentKey(event: OralEvent) {
    return `${event.learnerId}/${event.difficultyTier}/${event.sessionId}`;
  }
  return (session: Session): DetailedResult => {
    if (ids.has(session.eventId)) throw new Error("This assessment has already been submitted.");
    const result = buildResult(session);
    const key = independentKey(result.event);
    if (!result.event.assisted && independentKeys.has(key)) {
      throw new Error("An independent oral check already exists for this learner, tier and session.");
    }
    ids.add(session.eventId);
    if (!result.event.assisted) independentKeys.add(key);
    return result;
  };
}
