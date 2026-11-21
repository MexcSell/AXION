import { Plus, Minus, ArrowRight } from 'lucide-react';
import type { OrgEdgeDto } from '@contracts';
import { AGENT_BY_ID } from '@/data/agents';
import { cx } from '@/lib/format';

/** One reporting line as an "A → B" pill (A manages B): added (green) or removed (struck). Shared by the proposals' dry run
    and the organisation history (cycle 4; its own module so the two views don't import each other). */
export function Line({ e, kind }: { e: OrgEdgeDto; kind: 'add' | 'rm' }) {
  const name = (id: string) => AGENT_BY_ID[id]?.name ?? id;
  return (
    <span className={cx('oa-line', kind)} data-line={kind} data-from={e.supervisorId} data-to={e.subordinateId}>
      {kind === 'add' ? <Plus size={11} aria-label="added" /> : <Minus size={11} aria-label="removed" />}
      <b>{name(e.supervisorId)}</b><ArrowRight size={11} aria-hidden /><b>{name(e.subordinateId)}</b>
    </span>
  );
}
