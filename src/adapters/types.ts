import type { Checklist, ItemStatus } from "../contracts";

export type DomainId = "fire_safety" | "education" | "jal_shakti";

export interface ActionTypeSpec {
  description: string;
  // An action may only cite items in one of these statuses (enforced in the tool, not the prompt).
  allowedItemStatuses: ItemStatus[];
}

export interface DomainAdapter {
  id: DomainId;
  version: string;
  name: string;
  checklists: Checklist[];
  defaultLanguage: string;
  // Privacy gate: may frames from wearable video be saved and sent to the vision model?
  // Off for domains where minors or patients are likely to be in view.
  allowVideoFrames: boolean;
  actions: Record<string, ActionTypeSpec>;
  // Domain-specific instructions appended to the agent's system prompt.
  agentGuidance: string;
}

export function getChecklist(adapter: DomainAdapter, checklistId?: string): Checklist {
  const checklist = checklistId
    ? adapter.checklists.find((c) => c.id === checklistId)
    : adapter.checklists[0];
  if (!checklist) {
    const ids = adapter.checklists.map((c) => c.id).join(", ");
    throw new Error(`Unknown checklist "${checklistId}" for ${adapter.id}. Available: ${ids}`);
  }
  return checklist;
}
