from enum import StrEnum

from pydantic import BaseModel, Field, model_validator

CUT = 80
REVIEW_LOW, REVIEW_HIGH = 75, 85

class Skill(StrEnum):
    PHONICS = "phonics"
    ORAL = "oral"
    COMPREHENSION = "comprehension"

ACTIVITY = {
    Skill.PHONICS: "Model one spelling pattern, then guide blending.",
    Skill.ORAL: "Model a short sentence, then listen to a guided reread.",
    Skill.COMPREHENSION: "Prompt the learner to find the sentence that answers the question.",
}

class Check(BaseModel):
    skill: Skill
    form: str = Field(min_length=1, max_length=64)
    session: str = Field(min_length=1, max_length=64)
    tier: str = Field(default="demo", min_length=1, max_length=64)
    correct: int = Field(ge=0)
    total: int = Field(ge=1, le=200)
    assisted: bool = False
    usable: bool = True
    kind: str = Field(default="probe", pattern="^(probe|exit_item)$")

    @model_validator(mode="after")
    def validate_counts(self):
        if self.correct > self.total:
            raise ValueError("Correct responses cannot exceed total responses.")
        return self

    @property
    def score(self):
        return 100 * self.correct / self.total

class Evidence(BaseModel):
    status: str = "unconfirmed"
    score: float | None = None
    raw_below: bool = False
    recheck: bool = True
    note: str = "No usable independent probe."

def skill_evidence(checks):
    evidence = Evidence()
    forms = set()
    seen_sessions = set()
    directions = []
    for check in checks:
        if check.kind != "probe":
            continue
        # A previously seen probe form is no longer fresh, even with a new session.
        already_seen = check.form in forms
        forms.add(check.form)
        if already_seen or not check.usable or check.assisted:
            evidence.recheck = True
            continue
        if check.session in seen_sessions:
            continue
        seen_sessions.add(check.session)
        score = check.score
        direction = "support" if score < CUT else "ready"
        evidence.score = score
        evidence.raw_below = score < CUT
        directions.append(direction)
        if len(directions) == 1 and not REVIEW_LOW <= score <= REVIEW_HIGH:
            evidence.status = direction
        if len(directions) >= 2 and directions[-2] == direction:
            evidence.status = direction
        evidence.recheck = evidence.status != direction
        if evidence.recheck:
            evidence.note = "Keep the current level and confirm on a fresh independent form."
        elif evidence.status == "support":
            evidence.note = "Below the demo cutoff. Give targeted practice."
        else:
            evidence.note = "Independent success observed on this probe."
    return evidence

def recommend(checks, tier="demo", print_accessible=True, override=None, *, evidence=None):
    if evidence is None:
        evidence = {
            skill: skill_evidence(
                c for c in checks if c.skill == skill and c.tier == tier
            )
            for skill in Skill
        }
    raw_below = [s for s in Skill if evidence[s].raw_below]
    gaps = [s for s in Skill if evidence[s].status == "support"]
    pending = [s for s in Skill if evidence[s].recheck]
    primary = gaps[0] if gaps else None
    secondary = gaps[1] if len(gaps) > 1 else None
    supported = "Use accessible text or a teacher read-aloud with a meaning question."
    if primary:
        earlier = list(Skill)[:list(Skill).index(primary)]
        needs_review = (
            any(evidence[s].score is None for s in earlier)
            or (primary != Skill.PHONICS and not print_accessible)
        )
        primary_activity = (
            "Teacher review: check text access and use supported practice."
            if needs_review else ACTIVITY[primary]
        )
        reason = (
            f"{primary.value.capitalize()} is the first active gap in the demo order."
            f" Latest usable probe: {evidence[primary].score:g}%."
        )
    else:
        primary_activity = (
            "Stay at the current level and confirm pending skills."
            if pending else "Try slightly harder mixed reading."
        )
        reason = (
            "Gather more independent evidence before changing level."
            if pending else "All three skills meet the demo routing criteria."
        )
    secondary_activity = (
        ACTIVITY[secondary] if secondary and print_accessible else supported
    )
    if override:
        primary_activity = override.activity
        reason = f"Teacher override: {override.reason}"
    return {
        "evidence": evidence,
        "raw_below": raw_below,
        "active_gaps": gaps,
        "recheck": pending,
        "queued_gaps": gaps[2:],
        "primary_skill": primary,
        "primary": primary_activity,
        "secondary": secondary_activity,
        "reason": reason,
        "teacher_review": len(gaps) == 3 or not print_accessible or (
            primary is not None and primary_activity.startswith("Teacher review:")
        ),
    }
