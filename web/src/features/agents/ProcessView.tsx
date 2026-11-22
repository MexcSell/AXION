import { motion } from 'motion/react';
import { RotateCcw, CheckCheck, Copy, Shuffle, Hourglass, ArrowUp, ArrowDown, ArrowRight, type LucideIcon } from 'lucide-react';
import type { ProcessCell, ProcessDto, ProcessWindow } from '@contracts';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Tip } from '@/components/ui/Tip';
import { LiveStatus } from '@/components/ui/LiveStatus';
import { GuardTrigger } from '@/components/ui/MetricGuard';
import type { MetricGuardRow } from '@contracts';
import { cx } from '@/lib/format';
import '@/theme/pages/c69-process.css';

/**
 * Process metrics (improvement cycle 69, R3-5): how the work moved, next to how it ended. A view of the Dimensions panel (it shares the department and window
 * controls). Five measured cards, each with its value, n, window, the items still open (never in the denominator), the cause breakdown where there is one,
 * the c66 guard (shield with a popover) and a ? with the formula. Two figures have no source in this version and are shown as honest blanks.
 * There is no total and no "good" level.
 */
const ICON: Record<string, LucideIcon> = { rework_rate: RotateCcw, first_pass_acceptance: CheckCheck, duplicate_delegation: Copy, reassign_churn: Shuffle, handoff_wait_h: Hourglass };
const TREND = { up: ArrowUp, down: ArrowDown, flat: ArrowRight } as const;
const WIN: Record<ProcessWindow, string> = { '7d': 'last 7 days', '30d': 'last 30 days', '90d': 'last 90 days' };
const short = (k: string) => k.replace('process.', '');

export function fmtProc(c: Pick<ProcessCell, 'value' | 'unit'>): string {
  if (c.value === null) return '—';
  if (c.unit === '%') return `${Number.isInteger(c.value) ? c.value : c.value.toFixed(1)}%`;
  if (c.unit === 'h') return `${c.value < 10 ? c.value.toFixed(1) : Math.round(c.value)} h`;
  return String(c.value);
}
const p90Text = (c: ProcessCell) => (c.p90 === null ? null : c.unit === 'h' ? `p90 ${fmtProc({ value: c.p90, unit: 'h' })}` : `p90 ${c.p90}`);

function Card({ c, w, i, g, demo }: { c: ProcessCell; w: ProcessWindow; i: number; g?: MetricGuardRow; demo: boolean }) {
  const key = short(c.key);
  const Icon = ICON[key] ?? Hourglass;
  const T = c.trend ? TREND[c.trend] : null;
  const prev = c.previous.value !== null ? fmtProc({ value: c.previous.value, unit: c.unit }) : '';
  const p90 = p90Text(c);
  return (
    <motion.article className={cx('proc-card', c.state !== 'ok' && 'none', c.state === 'ok' && (c.n ?? 0) < 10 && 'low')} data-pcell={c.key} data-state={c.state} data-value={c.value ?? ''} data-n={c.n ?? ''} data-open={c.open?.n ?? ''} data-trend={c.trend ?? ''}
      aria-label={c.state === 'ok' ? `${c.label}: ${fmtProc(c)}, n = ${c.n}, ${w}` : `${c.label}: ${c.evidence}`}
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .05 + i * .04 }}>
      <header className="proc-ch">
        <Icon size={14} className="proc-ico" aria-hidden />
        <span className="proc-cl">{c.label}</span>
        <GuardTrigger g={g} compact />
        <HelpTrigger k={c.key} />
      </header>
      {c.state === 'ok'
        ? <Tip label={c.evidence}><div className="proc-cv" tabIndex={0} aria-label={c.evidence}><b className="tnum">{fmtProc(c)}</b><span className="proc-n tnum">n = {c.n}</span>{p90 && <span className="proc-p90 tnum" title="90th percentile, nearest rank">{p90}</span>}
            {T && <small className="proc-tr" title={`previous window: ${prev} (n = ${c.previous.n})`}><T size={12} aria-hidden />{prev}</small>}</div></Tip>
        : <div className="proc-cv proc-none">{c.state === 'unmeasured' && <Hourglass size={12} aria-hidden />}{c.state === 'none' ? `not enough evidence (n = ${c.n})` : c.evidence}</div>}
      <div className="proc-meta tnum">{demo ? 'SAMPLE · ' : ''}{c.state === 'unmeasured' ? 'no source' : WIN[w]}{c.state === 'none' && c.minN ? ` · needs ${c.minN}` : ''}</div>
      {c.open && <div className={cx('proc-open', c.open.n === 0 && 'zero')} data-open-line={c.open.n}><b className="tnum">{c.open.n} open</b> · {c.open.what}; not in the rate</div>}
      {c.breakdown.length > 0 && <ul className="proc-causes" aria-label="Causes of the returns, with n" data-causes={c.breakdown.length}>{c.breakdown.map((b) => <li key={b.label} data-cause={b.label}>{b.label}<b className="tnum">{b.n}</b></li>)}</ul>}
    </motion.article>
  );
}

export function ProcessView({ data, error, w, byId, demo }: { data: ProcessDto | null; error: string | null; w: ProcessWindow; byId: (id: string, label?: string) => MetricGuardRow | undefined; demo: boolean }) {
  if (!data) return error ? <LiveStatus kind="error" className="dim">{error}</LiveStatus> : <LiveStatus className="dim">Reading the process figures…</LiveStatus>;
  const measured = data.cells.filter((c) => c.state !== 'unmeasured');
  const blank = data.cells.filter((c) => c.state === 'unmeasured');
  return (
    <div className="proc-wrap" data-process="ready" data-window={w} data-department={data.department ?? ''}>
      <div className="proc-grid" role="list" aria-label="Process figures">{measured.map((c, i) => <div role="listitem" key={c.key} className="proc-li"><Card c={c} w={w} i={i} g={byId(c.key, c.label)} demo={demo} /></div>)}</div>
      {blank.length > 0 && <div className="proc-blank" data-unmeasured={blank.map((c) => c.key).join(',')}>
        {blank.map((c) => <div key={c.key} className="proc-bl" data-pcell={c.key} data-state="unmeasured"><Hourglass size={13} aria-hidden /><b>{c.label}</b><Tip label={c.evidence}><span tabIndex={0}>{c.evidence.split(':')[0]}</span></Tip><GuardTrigger g={byId(c.key, c.label)} compact /><HelpTrigger k={c.key} /></div>)}
      </div>}
      <p className="dim dim-note proc-note">{data.department ?? 'Whole company'} · {new Date(data.from).toLocaleDateString()} to {new Date(data.to).toLocaleDateString()} · missions you can see; no simulated or DEMO rows · open items sit beside a figure, never inside it · no total, no "good" level</p>
    </div>
  );
}
