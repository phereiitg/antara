"""Domain adapter contract (``src/adapters/types.ts``: ActionTypeSpec, DomainAdapter, getChecklist).

The engine is domain-independent: everything domain-specific (checklists, thresholds, allowed
actions, privacy gates, agent guidance) arrives through this configuration object. Concrete
adapters (Jal Shakti, Education, Health) are Phase 2B+ and are not defined here.
"""

from __future__ import annotations

from pydantic import Field

from antara_core.schemas.base import AntaraModel
from antara_core.schemas.case import ItemStatus
from antara_core.schemas.checklist import Checklist


class ActionTypeSpec(AntaraModel):
    description: str
    # An action may only cite items in one of these statuses (enforced in code, not the prompt).
    allowed_item_statuses: list[ItemStatus]


class DomainAdapter(AntaraModel):
    # TS restricts ids to a union of known domains; here any id, so new ministries are config only.
    id: str = Field(min_length=1)
    version: str
    name: str
    checklists: list[Checklist]
    default_language: str
    # Privacy gate: may frames from wearable video be saved and sent to the vision model?
    allow_video_frames: bool
    actions: dict[str, ActionTypeSpec]
    agent_guidance: str


def get_checklist(adapter: DomainAdapter, checklist_id: str | None = None) -> Checklist:
    """Port of ``getChecklist``: the named checklist, or the adapter's first one."""
    if checklist_id:
        checklist = next((c for c in adapter.checklists if c.id == checklist_id), None)
    else:
        checklist = adapter.checklists[0] if adapter.checklists else None
    if checklist is None:
        ids = ", ".join(c.id for c in adapter.checklists)
        raise ValueError(f'Unknown checklist "{checklist_id}" for {adapter.id}. Available: {ids}')
    return checklist
