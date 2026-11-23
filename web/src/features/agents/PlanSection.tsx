import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ClipboardList, ArrowUp, ArrowDown, Copy, Check, ShieldAlert, AlertTriangle, History, Hourglass, CheckCircle2, CircleDashed, Ruler, Fingerprint, Loader2, Layers } from 'lucide-react';
import { METRIC_BY_ID, type ChangePlan, type OrgPlanDto, type PlanObservation } from '@contracts';
import { Chip } from '@/components/ui/Chips';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Tip } from '@/components/ui/Tip';
import { ago } from '@/lib/format';

import '@/theme/pages/c89-plans-forecasts.css';

const metricLabel = (id: string) => METRIC_BY_ID.get(id)?.label ?? id;
const FIELD: Record<string, string> = { 'primary.metric': 'primary metric', 'primary.direction': 'direction', 'primary.margin': 'margin', minN: 'minimum n', windowDays: 'window', guardrails: 'guardrails', why: 'why' };
const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const shortSha = (s: string) => s.slice(0, 10);

/** The sha, short, with a copy button that answers with a check mark. */
function ShaCopy({ sha }: { sha: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(sha); } catch { /* the full sha is also in the title */ }
    setDone(true); window.setTimeout(() => setDone(false), 1400);
  };
  return (
    <span className="row pl-sha" style={{ gap: 4 }}>
      <Fingerprint size={12} aria-hidden />
      <span className="mono" title={sha} data-plan-sha={sha}>{shortSha(sha)}</span>
      <Tip label={done ? 'Copied' : 'Copy the full sha'}>
        <button type="button" className="icon-btn" style={{ width: 22, height: 22 }} aria-label="Copy plan sha" onClick={copy}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={done ? 'y' : 'n'} initial={{ scale: .5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: .5, opacity: 0 }} transition={{ duration: .12 }} style={{ display: 'inline-flex' }}>
              {done ? <Check size={12} /> : <Copy size={12} />}
            </motion.span>
          </AnimatePresence>
        </button>
      </Tip>
      <HelpTrigger k="plan.sha" />
    </span>
  );
}

function PlanFacts({ plan, label }: { plan: ChangePlan; label?: string }) {
  const up = plan.primary.direction === 'up';
  return (
    <div className="pl-facts" data-plan-facts={label}>
      <div className="pl-row"><Ruler size={13} aria-hidden /><b>Primary metric</b><HelpTrigger k="plan.primary" />
        <span className="pl-val" data-plan-primary={plan.primary.metric}>{metricLabel(plan.primary.metric)}</span>
        <Chip hue={up ? 150 : 205} size="sm" icon={up ? ArrowUp : ArrowDown}>{up ? 'up' : 'down'}</Chip>
        <Chip hue={225} size="sm" title="The margin is in the metric's own unit">margin {plan.primary.margin}</Chip></div>
      <div className="pl-row"><Layers size={13} aria-hidden /><b>Window</b><HelpTrigger k="plan.window" />
        <Chip hue={225} size="sm">min n {plan.minN} per window</Chip><Chip hue={225} size="sm">{plan.windowDays} days before and after</Chip></div>
      <div className="pl-row"><ShieldAlert size={13} aria-hidden /><b>Guardrails</b><HelpTrigger k="plan.guardrails" />
        {plan.guardrails.length === 0 ? <span className="dim">none</span> : plan.guardrails.map((g) => <Chip key={g.metric} hue={38} size="sm" title={`margin ${g.margin}`}>{metricLabel(g.metric)} · margin {g.margin}</Chip>)}</div>
      <div className="pl-row top"><ClipboardList size={13} aria-hidden /><b>Why</b><HelpTrigger k="plan.why" /><span className="pl-why" data-plan-why>{plan.why}</span></div>
    </div>
  );
}

function Counts({ o }: { o: PlanObservation }) {
  const side = (n: number, met: boolean, w: string) => (
    <span className={'pl-n tnum' + (met ? ' met' : '')} title={met ? `${w}: ${n} counted, the minimum ${o.minN} is reached` : `${w}: ${n} counted, the minimum is ${o.minN}`}>
      {met ? <CheckCircle2 size={11} aria-hidden /> : <CircleDashed size={11} aria-hidden />}{w} {n} / {o.minN}
    </span>
  );
  return (
    <div className="pl-obs" data-plan-obs={o.metric} data-pre={o.pre} data-post={o.post}>
      <Chip hue={o.role === 'primary' ? 260 : 38} size="sm">{o.role}</Chip>
      <span className="pl-val ellipsis" title={o.unit}>{o.label}</span>
      <span className="spacer" />
      {side(o.pre, o.preMet, 'pre')}{side(o.post, o.postMet, 'post')}
    </div>
  );
}

/** Administrators only. A compact "Change plan" section: the plan as locked, its amendments (called out as made after the change) and, for an applied proposal, the counts. */
export function PlanSection({ plan, error, retry }: { plan: OrgPlanDto | null; error: string | null; retry: () => void }) {
  if (!plan && !error) return <div className="dim row" role="status" style={{ gap: 6, fontSize: 11.5, marginTop: 6 }} data-plan-state="loading"><Loader2 size={12} className="spin" />Reading the change plan…</div>;
  if (!plan) return <div className="oa-banner" role="alert" style={{ marginTop: 8 }} data-plan-state="error"><AlertTriangle size={15} /><span>The change plan was not loaded: {error}</span><button className="btn sm" onClick={retry}>Retry</button></div>;
  if (!plan.plan) return (
    <div className="row dim" style={{ gap: 6, fontSize: 11.5, marginTop: 6 }} data-plan-state="none"><ClipboardList size={12} aria-hidden />No change plan recorded for this proposal.<HelpTrigger k="plan.section" /></div>
  );
  const applied = plan.change !== null;
  const eff = plan.effectivePlan ?? plan.plan;
  return (
    <motion.section className="pl-sec" data-plan-state="plan" data-plan-verdict={plan.verdict} aria-label="Change plan" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <div className="row wrap" style={{ gap: 6 }}>
        <ClipboardList size={14} aria-hidden /><b style={{ fontSize: 12.5 }}>Change plan</b><HelpTrigger k="plan.section" />
        <Chip hue={plan.locked ? 145 : 38} size="sm">{plan.locked ? 'locked at approval' : 'set, not yet locked'}</Chip>
        <span className="spacer" />
        {plan.sha && <ShaCopy sha={plan.sha} />}
      </div>
      <PlanFacts plan={plan.plan} />
      {!plan.shaMatches && <div className="oa-issue bad" role="alert" data-plan-mismatch><ShieldAlert size={13} aria-hidden /><span>The sha stored with the approval does not match the plan as stored now. Treat this plan as unreliable.</span><HelpTrigger k="plan.mismatch" /></div>}
      {plan.amendments.length > 0 && (
        <div className="pl-amend" data-plan-amendments={plan.amendments.length}>
          <div className="row" style={{ gap: 6 }}><History size={13} aria-hidden /><b style={{ fontSize: 12 }}>Amendments ({plan.amendments.length})</b><HelpTrigger k="plan.amendments" />
            <Chip hue={38} icon={AlertTriangle} size="sm" title="Amendments exist only after the proposal was approved">amended after the change</Chip></div>
          {plan.amendments.map((a) => (
            <div key={a.seq} className="pl-am" data-amendment={a.seq}>
              <div className="dim" style={{ fontSize: 11.5 }}>#{a.seq} by {a.createdByName} · {ago((Date.now() - new Date(a.createdAt).getTime()) / 60_000)} · changed {a.changed.length ? a.changed.map((c) => FIELD[c] ?? c).join(', ') : 'nothing'} · <span className="mono" title={a.sha}>{shortSha(a.sha)}</span></div>
              <div style={{ fontSize: 12.5 }}>{a.reason}</div>
            </div>
          ))}
          {plan.amendedAfterChange && eff.primary.metric !== plan.plan.primary.metric && <div className="dim" style={{ fontSize: 11.5 }}>The counts below use the plan as it was locked, not the amended choice.</div>}
        </div>
      )}
      {applied && (
        <div className="pl-read" data-plan-readout>
          <div className="row wrap" style={{ gap: 6 }}>
            <Hourglass size={13} aria-hidden /><b style={{ fontSize: 12 }}>Readout</b><HelpTrigger k="plan.readout" />
            <span className="pl-verdict" data-ready={plan.verdict === 'ready_for_analysis' ? '1' : '0'}>{plan.verdict === 'ready_for_analysis' ? <CheckCircle2 size={13} aria-hidden /> : <Hourglass size={13} aria-hidden />}<span data-plan-verdict-text>{plan.verdictText}</span></span>
            {plan.change && <span className="dim" style={{ fontSize: 11.5 }}>change took effect {day(plan.change.activeFrom)} as rev {plan.change.revision}</span>}
          </div>
          {plan.windows && <div className="dim" style={{ fontSize: 11.5 }}>pre {day(plan.windows.pre.from)} to {day(plan.windows.pre.to)} · post {day(plan.windows.post.from)} to {day(plan.windows.post.to)} · {plan.windows.postComplete ? 'post window complete' : 'post window still running'}</div>}
          <div className="col" style={{ gap: 4 }}>
            <div className="row" style={{ gap: 6 }}><span className="dim" style={{ fontSize: 11.5 }}>Observations counted per window</span><HelpTrigger k="plan.counts" /></div>
            {plan.observations.map((o) => <Counts key={o.role + o.metric} o={o} />)}
          </div>
          {plan.otherChanges > 0 && <div className="oa-issue warn" data-plan-other><AlertTriangle size={13} aria-hidden /><span>Another change took effect during the window ({plan.otherChanges}): the counts mix both.</span><HelpTrigger k="plan.other" /></div>}
          <div className="dim" style={{ fontSize: 11 }}>Counts only. They say nothing about whether the change helped.</div>
        </div>
      )}
    </motion.section>
  );
}
