import test from "node:test";
import assert from "node:assert/strict";
import {addEvidence, buildHandoff} from "../src/session";
import type {ReadingEvidence} from "../src/session";
import {buildResult, toTreeCheck, wordsOf} from "../src/oral/scoring";
import passages from "../src/oral/data/passages.json";

const identity = {learnerId: "demo-001", sessionId: "session-01"};
const phonics: ReadingEvidence = {
  skill:"phonics",
  event:{...identity,eventId:"p",skill:"phonics",formId:"PHONICS-A",difficultyTier:"CVCC-final-nt",kind:"probe",correct:4,total:5,score:80,assisted:false,usable:true,reviewRequired:true},
  check:{skill:"phonics",form:"PHONICS-A",session:identity.sessionId,tier:"CVCC-final-nt",kind:"probe",correct:4,total:5,assisted:false,usable:true},
};
const passage = passages[0];
function oral(assisted = false): Extract<ReadingEvidence,{skill:"oral"}> {
  const result = buildResult({...identity,eventId:"o",passage,
    judgments:Object.fromEntries(wordsOf(passage).map(w=>[w.id,"CORRECT"])),
    assistance:assisted?"prompting":"independent", quality:"complete", verified:true});
  return {skill:"oral",event:result.event,check:toTreeCheck(result.event)};
}
test("shares learner and session while keeping skills and tiers separate", () => {
  const entries = addEvidence(identity, [phonics], oral());
  const handoff = buildHandoff(identity, entries);
  assert.deepEqual(handoff.independentChecks.map(c=>[c.skill,c.session,c.tier]), [
    ["phonics", identity.sessionId, "CVCC-final-nt"], ["oral", identity.sessionId, "short-text"],
  ]);
  assert.ok(handoff.events.every(e=>e.learnerId===identity.learnerId));
  assert.ok(!/audio|transcript|words/.test(JSON.stringify(handoff)));
});
test("assisted oral results stay in the session and out of tree inputs", () => {
  const handoff = buildHandoff(identity, addEvidence(identity, [phonics], oral(true)));
  assert.equal(handoff.events.length,2);
  assert.equal(handoff.independentChecks.length,1);
});
test("duplicate retries do not add evidence and foreign sessions are rejected", () => {
  const event = oral();
  assert.equal(addEvidence(identity,[event],event).length,1);
  assert.throws(()=>addEvidence({...identity,sessionId:"s2"},[],event),/different learner or session/);
  assert.throws(()=>addEvidence(identity,[event],{...event,event:{...event.event,eventId:"new"}}),/already has/);
});
