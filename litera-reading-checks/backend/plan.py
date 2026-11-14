"""Connect Litera's saved Phase 4 profile to the repository's shared planner."""

import sys
from pathlib import Path

# The Litera launcher runs inside litera-reading-checks. The planner is a sibling package.
REPOSITORY = str(Path(__file__).resolve().parents[2])
if REPOSITORY not in sys.path:
    sys.path.append(REPOSITORY)

from voice.tree import Evidence, PlanOverride, Skill, route


def plan_from_profile(profile, *, print_accessible=True, support_stalled=False):
    plan = profile["planInput"]
    override = plan.get("override")
    return route(
        {Skill(skill): Evidence.model_validate(state) for skill, state in plan["evidence"].items()},
        learner_id=profile["learnerId"],
        tiers=profile["selectedTiers"],
        evidence_refs=plan.get("evidenceRefs"),
        print_accessible=print_accessible,
        support_stalled=support_stalled,
        override=PlanOverride.model_validate(override) if override else None,
    )
