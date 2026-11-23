import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { METRICS, METRIC_BY_ID, CONTEXT_READS } from '../../shared/contracts/src/index.ts';
it('shared', () => {
  const DEPT = ['agent_definitions.dept', 'agent_definitions.status', 'agent_instances.agent_id', 'agent_instances.simulated', 'agent_instances.created_at'];
  const ctx = (c: string) => CONTEXT_READS.some((x) => x.column === c || (x.column.startsWith('*.') && c.endsWith(x.column.slice(1))));
  const scope = (c: string) => DEPT.includes(c) || /\.(simulated|demo)$/.test(c);
  const out: string[] = [];
  for (const m of METRICS) {
    if (!('ref' in m.counter)) continue;
    const c = METRIC_BY_ID.get(m.counter.ref)!;
    const sh = m.reads.filter((x) => c.reads.includes(x) && !ctx(x) && !scope(x));
    const shIn = m.inputs.filter((x) => c.inputs.includes(x));
    out.push(`${m.id} -> ${c.id}: cols=[${sh.join(',')}] inputs=[${shIn.join(',')}]`);
  }
  writeFileSync('/tmp/claude-0/-home-luca-AXION/110db678-84c0-496e-aaa7-b625859aebb5/scratchpad/shared.txt', out.join('\n'));
});
