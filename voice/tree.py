from dataclasses import asdict, dataclass, replace
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

CUT = 80
REVIEW_LOW, REVIEW_HIGH = 75, 85

class Skill(StrEnum):
    PHONICS = "phonics"
    ORAL = "oral"
    COMPREHENSION = "comprehension"

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
    status: Literal["support", "ready", "unconfirmed"] = "unconfirmed"
    score: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
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

class ActivityId(StrEnum):
    PHONICS = "PHONICS_BASED_LEARNING"
    ORAL = "GUIDED_ORAL_READING"
    COMPREHENSION = "GUIDED_COMPREHENSION"
    MIXED = "MIXED_READING"
    REVIEW = "ROTATING_REVIEW"
    REREAD = "ORAL_REREADING"
    MEANING = "CONNECTED_TEXT_MEANING"
    SUPPORTED_COMPREHENSION = "SUPPORTED_COMPREHENSION"
    CONNECTED = "CONNECTED_TEXT_READING"
    SUPPORTED_CONNECTED = "SUPPORTED_CONNECTED_TEXT_READING"
    ACCESSIBLE = "ACCESSIBLE_CURRENT_LEVEL_PRACTICE"
    FRESH_CHECK = "FRESH_INDEPENDENT_CHECK"
    TEACHER_SELECTED = "TEACHER_SELECTED_ACTIVITY"


@dataclass(frozen=True)
class Activity:
    activityId: ActivityId
    label: str
    purpose: str
    skill: Skill | None = None
    difficultyTier: str | None = None


PHONICS = Activity(ActivityId.PHONICS, "Phonics-Based Learning",
                   "Model a target spelling pattern and guide word blending.", Skill.PHONICS)
ORAL = Activity(ActivityId.ORAL, "Guided Oral Reading",
                "Model a short sentence, give corrective feedback, and guide a reread.", Skill.ORAL)
COMPREHENSION = Activity(ActivityId.COMPREHENSION, "Guided Comprehension",
                         "Find an explicit detail and point to the words that support it.", Skill.COMPREHENSION)
MIXED = Activity(ActivityId.MIXED, "Mixed Reading", "Mix short reading tasks with an appropriate extension.")
REVIEW = Activity(ActivityId.REVIEW, "Rotating review", "Review a previously practised skill.")
REREAD = Activity(ActivityId.REREAD, "Oral rereading", "Maintain accuracy through a short reread.", Skill.ORAL)
MEANING = Activity(ActivityId.MEANING, "Connected-text meaning practice",
                   "Discuss the meaning of a short accessible text.", Skill.COMPREHENSION)
SUPPORTED_COMPREHENSION = Activity(ActivityId.SUPPORTED_COMPREHENSION, "Supported comprehension",
                                    "Read the text together and discuss an explicit detail.", Skill.COMPREHENSION)
CONNECTED = Activity(ActivityId.CONNECTED, "Connected-text reading",
                     "Read a short connected text and discuss its meaning.", Skill.ORAL)
SUPPORTED_CONNECTED = Activity(ActivityId.SUPPORTED_CONNECTED, "Supported connected-text reading",
                               "Model and reread a short text. Include a brief supported meaning question.", Skill.ORAL)
ACCESSIBLE = Activity(ActivityId.ACCESSIBLE, "Accessible practice at the current level",
                      "Stay at the current level and use teacher modeling or accessible text.")
FRESH_CHECK = Activity(ActivityId.FRESH_CHECK, "Fresh independent check",
                       "Schedule a fresh independent check when the learner can access the material.")

# Keys are all confirmed SUPPORT skills, in foundational order.
ROUTES = {
    (): (MIXED, REVIEW),
    (Skill.COMPREHENSION,): (COMPREHENSION, REREAD),
    (Skill.ORAL,): (ORAL, MEANING),
    (Skill.ORAL, Skill.COMPREHENSION): (ORAL, SUPPORTED_COMPREHENSION),
    (Skill.PHONICS,): (PHONICS, CONNECTED),
    (Skill.PHONICS, Skill.COMPREHENSION): (PHONICS, COMPREHENSION),
    (Skill.PHONICS, Skill.ORAL): (PHONICS, ORAL),
    (Skill.PHONICS, Skill.ORAL, Skill.COMPREHENSION): (PHONICS, SUPPORTED_CONNECTED),
}
ACTIVITIES = {
    item.activityId: item
    for item in (PHONICS, ORAL, COMPREHENSION, MIXED, REVIEW, REREAD, MEANING,
                 SUPPORTED_COMPREHENSION, CONNECTED, SUPPORTED_CONNECTED, ACCESSIBLE, FRESH_CHECK)
}
PRIORITY = {skill: index for index, skill in enumerate(Skill)}
SKILL_NAMES = {Skill.PHONICS: "phonics", Skill.ORAL: "oral reading", Skill.COMPREHENSION: "comprehension"}


class PlanOverride(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1, max_length=240, pattern=r"\S")
    activity: str | None = Field(default=None, min_length=1, max_length=240, pattern=r"\S")
    primaryActivityId: ActivityId | None = None
    secondaryActivityId: ActivityId | None = None
    primaryDifficultyTier: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{1,64}$")
    secondaryDifficultyTier: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{1,64}$")
    overrideId: str | None = None
    sessionId: str | None = None

    @field_validator("primaryActivityId", "secondaryActivityId")
    @classmethod
    def validate_activity(cls, activity):
        if activity is not None and activity not in ACTIVITIES:
            raise ValueError("Choose a supported activity ID.")
        return activity

    @model_validator(mode="after")
    def check_change(self):
        if not any((self.activity, self.primaryActivityId, self.secondaryActivityId,
                    self.primaryDifficultyTier, self.secondaryDifficultyTier)):
            raise ValueError("Specify an activity or a difficulty tier to override.")
        return self


def _with_tier(activity, tiers, fallback=None):
    tier = tiers.get(activity.skill, fallback) if activity.skill else fallback
    return replace(activity, difficultyTier=tier)


def _override_activities(primary, secondary, override, tiers):
    if override.primaryActivityId:
        primary = _with_tier(ACTIVITIES[override.primaryActivityId], tiers)
    elif override.activity:
        primary = Activity(ActivityId.TEACHER_SELECTED, override.activity, "Teacher-selected activity.")
    if override.secondaryActivityId:
        secondary = _with_tier(ACTIVITIES[override.secondaryActivityId], tiers)
    return (
        replace(primary, difficultyTier=override.primaryDifficultyTier or primary.difficultyTier),
        replace(secondary, difficultyTier=override.secondaryDifficultyTier or secondary.difficultyTier),
    )


def route(evidence, *, learner_id=None, tiers=None, evidence_refs=None,
          print_accessible=True, support_stalled=False, override=None):
    """Recommend two activities from validated states. Scores remain descriptive."""
    tiers = tiers or {}
    evidence = {skill: evidence.get(skill, Evidence()) for skill in Skill}
    missing = [skill for skill in Skill if evidence[skill].score is None]
    unconfirmed = [skill for skill in Skill if skill in missing or evidence[skill].status == "unconfirmed"]
    ready = [skill for skill in Skill if skill not in missing and evidence[skill].status == "ready"]
    gaps = [skill for skill in Skill if skill not in missing and evidence[skill].status == "support"]
    raw_below = [skill for skill in Skill if skill not in missing and evidence[skill].raw_below]
    pending = [
        skill for skill in Skill
        if skill in unconfirmed or evidence[skill].recheck
        or (skill in ready and skill in raw_below)
        or (skill in gaps and skill not in raw_below)
        or (len(gaps) == len(Skill) and skill == Skill.COMPREHENSION)
    ]
    focus = gaps[0] if gaps else None
    uncertain_prerequisites = [
        skill for skill in unconfirmed if focus is not None and PRIORITY[skill] < PRIORITY[focus]
    ]
    blocked = bool(uncertain_prerequisites) or (focus in (Skill.ORAL, Skill.COMPREHENSION) and not print_accessible)

    primary, secondary = ROUTES[tuple(gaps)]
    if blocked:
        primary, secondary = ACCESSIBLE, SUPPORTED_COMPREHENSION
        if uncertain_prerequisites:
            names = ", ".join(SKILL_NAMES[skill] for skill in uncertain_prerequisites)
            explanation = f"Confirm {names} while providing accessible practice and supported meaning work."
        else:
            explanation = "Support access to the text before assigning the targeted reading activity."
        if focus not in pending:
            pending = [skill for skill in Skill if skill in pending or skill == focus]
    elif not gaps and pending:
        primary, secondary = ACCESSIBLE, replace(FRESH_CHECK, skill=pending[0])
        explanation = "Continue practice at the current level while gathering fresh independent evidence."
        if not print_accessible:
            secondary = SUPPORTED_COMPREHENSION
    elif not gaps and print_accessible:
        explanation = "Current evidence indicates readiness across the three skills. Continue mixed reading and review previously practised skills."
    elif not gaps:
        primary, secondary = ACCESSIBLE, SUPPORTED_COMPREHENSION
        explanation = "Use accessible practice and supported meaning work while the teacher reviews access to print."
    else:
        if not print_accessible:
            secondary = SUPPORTED_COMPREHENSION
        explanation = f"Confirmed support is needed in {SKILL_NAMES[focus]}, so begin with {primary.label}. Use {secondary.label.lower()} alongside it."

    queued = [skill for skill in gaps if skill not in (primary.skill, secondary.skill)]
    if blocked or not print_accessible:
        # Supported meaning makes the text accessible. It does not replace targeted independent comprehension work.
        queued = [skill for skill in gaps if skill != primary.skill]
    if pending:
        explanation += f" Recheck {', '.join(SKILL_NAMES[skill] for skill in pending)}."
    if support_stalled:
        explanation += " Review the plan with a teacher because supported practice has stalled."

    primary = _with_tier(primary, tiers, tiers.get(focus))
    secondary = _with_tier(secondary, tiers)
    original = {"primary": asdict(primary), "secondary": asdict(secondary), "queuedGaps": queued}
    if override:
        primary, secondary = _override_activities(primary, secondary, override, tiers)
        covered = {primary.skill, secondary.skill}
        # In inaccessible-text fallback, meaning support alone does not cover the independent gap.
        if (blocked or not print_accessible) and secondary.activityId == ActivityId.SUPPORTED_COMPREHENSION:
            covered = {primary.skill}
        queued = [skill for skill in gaps if skill not in covered]
        explanation += f" Teacher override: {override.reason}"
    if queued:
        explanation += f" Keep {', '.join(SKILL_NAMES[skill] for skill in queued)} in the support queue."

    teacher_review = bool(blocked or not print_accessible or support_stalled or len(gaps) == len(Skill))
    return {
        "learnerId": learner_id,
        "primary": asdict(primary),
        "secondary": asdict(secondary),
        "activeGaps": gaps,
        "rawBelowCutoff": raw_below,
        "pendingRechecks": pending,
        "queuedGaps": queued,
        "missingEvidence": missing,
        "unconfirmedSkills": unconfirmed,
        "readySkills": ready,
        "maintenanceSkills": ready,
        "teacherReviewRequired": teacher_review,
        "explanation": explanation,
        "teacherOverride": override.model_dump(exclude_none=True) if override else None,
        "algorithmicPlan": original,
        "skillEvidence": {
            skill: {
                **evidence[skill].model_dump(), "difficultyTier": tiers.get(skill),
                "latestUsableEventId": (evidence_refs or {}).get(skill),
            }
            for skill in Skill
        },
    }


def recommend(checks, tier="demo", print_accessible=True, override=None, *, evidence=None, **context):
    # The raw-check path is retained for the standalone Voice Lab and its fictional fixtures.
    if evidence is None:
        evidence = {
            skill: skill_evidence(c for c in checks if c.skill == skill and c.tier == tier)
            for skill in Skill
        }
    if override is not None and not isinstance(override, PlanOverride):
        override = PlanOverride(activity=override.activity, reason=override.reason)
    result = route(evidence, print_accessible=print_accessible, override=override, **context)
    gaps = result["activeGaps"]
    return {
        "recommendation": result,
        "evidence": evidence,
        "raw_below": result["rawBelowCutoff"],
        "active_gaps": gaps,
        "recheck": result["pendingRechecks"],
        "queued_gaps": result["queuedGaps"],
        "primary_skill": gaps[0] if gaps else None,
        "primary": result["primary"]["label"],
        "secondary": result["secondary"]["label"],
        "reason": result["explanation"],
        "teacher_review": result["teacherReviewRequired"],
    }
