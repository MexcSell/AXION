import type { Provenance } from '@contracts';
import { MIN_EVIDENCE } from '@contracts';
import { DemoTag } from '@/components/ui/Chips';
import { isApi } from '@/api/mode';
import type { Agent } from '@/data/types';

/**
 * Where an agent's numbers come from (Stage 6, decision E2). Seeded agents carry the prototype's numbers (DEMO); an agent created
 * on the server has a measured source with no evidence yet. A measured value with fewer than MIN_EVIDENCE tasks is never shown.
 */
export const provenanceOf = (a: Agent): Provenance => a.provenance ?? { source: 'demo-fixture', sample: null, window: '90d' };
/** api mode only: the agent's metrics are measured but there are not enough evaluated tasks behind them. */
export const needsEvidence = (a: Agent) => { if (!isApi()) return false; const p = provenanceOf(a); return p.source === 'measured' && (p.sample ?? 0) < MIN_EVIDENCE; };
export const NOT_ENOUGH = `Not enough evidence yet: shown after ${MIN_EVIDENCE} evaluated tasks`;

/** The chip itself (api mode): DEMO, or "n tasks / 90 days". */
export function ProvenanceChip({ agent }: { agent: Agent }) {
  if (!isApi()) return null;
  const p = provenanceOf(agent);
  if (p.source === 'demo-fixture') return <DemoTag title="Prototype numbers: measured from Stage 9/10" />;
  const n = p.sample ?? 0;
  return <span className="demo-tag measured" data-provenance="measured" title={`Measured from ${n} evaluated tasks in the last ${p.window === '90d' ? '90 days' : p.window}`}>{n} {n === 1 ? 'task' : 'tasks'} / 90 days</span>;
}
/** Where a DemoTag stood: unchanged in demo mode, the provenance chip in api mode. */
export function ProvTag({ agent }: { agent: Agent }) {
  return isApi() ? <ProvenanceChip agent={agent} /> : <DemoTag />;
}
