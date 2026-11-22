import * as P from '@radix-ui/react-popover';
import { ShieldAlert, ShieldCheck, Scale, EyeOff, X, ClipboardCheck } from 'lucide-react';
import type { MetricGuardRow } from '@contracts';
import { HelpTrigger } from './HelpTrigger';
import { Tip } from './Tip';
import { cx } from '@/lib/format';
import '@/theme/pages/c66-metric-guard.css';

/**
 * Goodhart guard (improvement cycle 66): what a number could be gamed by, and what it leaves out. Progressive disclosure: a small
 * shield (amber when an agent identity can write an input of the row) that opens a popover; a `?` inside explains the words.
 * Display only: nothing in AXION changes because of this flag.
 */
export const guardWord = (g: MetricGuardRow) => (g.gameable ? 'gameable' : 'not agent-writable');

function auditLine(g: MetricGuardRow): string {
  const a = g.audit;
  if (a.n === 0) return 'No human audit yet. A person can re-check a sample and record what they found.';
  if (a.state === 'none') return `${a.n} audited so far; at least ${a.minN} are needed before the metric and the audit are compared.`;
  return `${a.n} audited: the metric and the person disagree on ${a.divergence}% (${a.metricOver} over-credited by the metric, ${a.auditOver} the other way). Flag bar: ${a.bar}%.${a.flagged ? ' Above the bar, so this row is flagged.' : ' Below the bar.'}`;
}

export function GuardBody({ g }: { g: MetricGuardRow }) {
  return (
    <div className="col gm-body" data-guard-body={g.id}>
      <div className="row gm-flags">
        <span className={cx('gm-chip', g.gameable ? 'warn' : 'ok')} data-gameable={g.gameable ? '1' : '0'}>{g.gameable ? <ShieldAlert size={12} aria-hidden /> : <ShieldCheck size={12} aria-hidden />}{g.gameable ? 'Gameable' : 'Not agent-writable'}</span>
        {g.audit.flagged && <span className="gm-chip warn" data-audit-flag="1"><ClipboardCheck size={12} aria-hidden />Audit disagrees</span>}
        <HelpTrigger k="guard.gameable" />
      </div>
      <p className="gm-text">{g.gameableText}</p>
      <div className="gm-sec"><b><Scale size={12} aria-hidden /> Counter-metric</b>
        {g.counter.kind === 'metric' ? <span>{g.counter.refLabel}: {g.counter.why}.</span> : <span data-counter-none="1">{g.counter.reason}.</span>}</div>
      <div className="gm-sec"><b><EyeOff size={12} aria-hidden /> Does not cover</b>
        <span className="gm-tags">{g.uncovered.map((u) => <i key={u.id} data-uncovered={u.id}>{u.label.replace(/ \(.*\)$/, '')}</i>)}</span></div>
      <div className="gm-sec"><b><ClipboardCheck size={12} aria-hidden /> Human audit</b><span>{auditLine(g)}</span><small className="gm-fine">Labels, and which samples to check, are entered by an administrator. The metric label is typed, not read from the metric, so a flag is only as good as the sampling.</small></div>
    </div>
  );
}

/** The shield button. `compact` is the 12 px version used inside a scorecard row. */
export function GuardTrigger({ g, compact, className }: { g: MetricGuardRow | undefined; compact?: boolean; className?: string }) {
  if (!g) return null;
  const Icon = g.gameable ? ShieldAlert : ShieldCheck;
  const flagged = g.gameable || g.audit.flagged;
  return (
    <P.Root>
      <Tip label={`${g.label}: ${guardWord(g)}. Open the counter-metric and what it does not cover.`}>
        <P.Trigger asChild>
          <button type="button" className={cx('gm-btn', compact && 'cp', flagged && 'warn', className)} data-guard-key={g.id} data-gameable={g.gameable ? '1' : '0'}
            aria-label={`Goodhart guard for ${g.label}: ${guardWord(g)}`} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <Icon size={compact ? 11 : 13} aria-hidden />
          </button>
        </P.Trigger>
      </Tip>
      <P.Portal>
        <P.Content className="popover help-pop gm-pop" sideOffset={8} collisionPadding={12} align="start">
          <div className="row" style={{ marginBottom: 6 }}>
            <strong style={{ fontSize: 14 }}>{g.label}</strong>
            <span className="spacer" />
            <P.Close className="icon-btn xs" aria-label="Close the guard"><X size={13} /></P.Close>
          </div>
          <GuardBody g={g} />
          <P.Arrow width={12} height={6} style={{ fill: 'var(--border-strong)' }} />
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

/** A non-interactive cue (for inside a role=button cell): the amber shield, named for screen readers by the cell's note line. */
export function GuardCue({ g }: { g: MetricGuardRow | undefined }) {
  if (!g || !(g.gameable || g.audit.flagged)) return null;
  return <ShieldAlert size={10} className="gm-cue" aria-hidden data-guard-cue={g.id} />;
}
