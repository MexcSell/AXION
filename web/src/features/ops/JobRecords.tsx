import { useEffect, useState } from 'react';
import { Database, Lock, RefreshCw } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Chip } from '@/components/ui/Chips';
import { IconButton } from '@/components/ui/IconButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { api, ApiFailure } from '@/api/client';

const STATUSES = ['queued', 'leased', 'succeeded', 'failed', 'canceled', 'dead'] as const;
type St = (typeof STATUSES)[number];
interface Queues {
  kinds: { kind: string; counts: Record<St, number>; total: number }[];
  oldestQueuedAgeSec: number | null; expiredLeases: number; total: number; checkedAt: string;
}
const HUE: Record<St, number> = { queued: 205, leased: 148, succeeded: 160, failed: 350, canceled: 240, dead: 350 };
const age = (s: number | null) => (s === null ? 'none waiting' : s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);

/** c45: read-only counts of the durable job records (administrators). No control here enqueues, claims or cancels. */
export function JobRecords() {
  const [q, setQ] = useState<Queues | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try { setQ(await api<Queues>('GET', '/operations/queues')); setErr(''); }
    catch (e) { setErr(e instanceof ApiFailure ? e.message : 'Not reachable'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);
  return (
    <Panel icon={Database} titleSize="lg" title="Job records" help="ops.jobRecords" delay={.02} className="ops-job-records"
      sub="Records only: no workers run in this build"
      actions={<><Chip hue={err ? 0 : 205} size="sm"><Lock size={11} />read-only</Chip><IconButton size="xs" icon={RefreshCw} label="Refresh now" onClick={() => void load()} className={busy ? 'spin' : undefined} /></>}>
      {err ? <div className="dim" style={{ fontSize: 13 }}>{err}</div> : !q ? <div className="dim" style={{ fontSize: 13 }}>Loading…</div> : q.total === 0 ? (
        <div data-testid="job-records-empty"><EmptyState icon={Database} title="No job records yet" body="Records only: no workers run in this build, so nothing creates or claims a job." /></div>
      ) : (
        <div data-testid="job-records">
          {q.kinds.map((k) => (
            <div key={k.kind} className="subpanel" data-testid={`job-kind-${k.kind}`}>
              <div className="row"><b className="mono">{k.kind}</b><span className="spacer" /><span className="dim" style={{ fontSize: 12 }}>{k.total} total</span></div>
              <div className="row" style={{ gap: 6, margin: '8px 0', flexWrap: 'wrap' }}>
                {STATUSES.map((s) => <Chip key={s} hue={k.counts[s] ? HUE[s] : 240} size="sm">{s} {k.counts[s]}</Chip>)}
              </div>
            </div>
          ))}
          <div className="row dim" style={{ gap: 14, fontSize: 12, marginTop: 8 }}>
            <span>Oldest queued: <b data-testid="job-oldest">{age(q.oldestQueuedAgeSec)}</b></span>
            <span>Expired leases: <b data-testid="job-expired">{q.expiredLeases}</b></span>
          </div>
        </div>
      )}
    </Panel>
  );
}
