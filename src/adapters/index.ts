import { educationAdapter } from "./education";
import { fireSafetyAdapter } from "./fire-safety";
import { jalShaktiAdapter } from "./jal-shakti";
import type { DomainAdapter, DomainId } from "./types";

export * from "./types";

const registry: Record<DomainId, DomainAdapter> = {
  fire_safety: fireSafetyAdapter,
  education: educationAdapter,
  jal_shakti: jalShaktiAdapter,
};

export function getAdapter(domainId: string): DomainAdapter {
  const adapter = registry[domainId as DomainId];
  if (!adapter) {
    throw new Error(`Unknown domain "${domainId}". Available: ${Object.keys(registry).join(", ")}`);
  }
  return adapter;
}

export function listAdapters(): DomainAdapter[] {
  return Object.values(registry);
}
