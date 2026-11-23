import { Undo2, Scale, Layers, Repeat, Target, CheckCircle2, AlertOctagon, Gauge, Timer, CircleSlash, ClipboardCheck, Coins, SearchX, SearchCheck, Lock } from 'lucide-react';
import type { OrgChurn, OrgContractCheck, OrgEvidence, RestructureTrigger, TriggerEvidence } from '@contracts';
import { Chip } from '@/components/ui/Chips';
import { HelpTrigger } from '@/components/ui/HelpTrigger';

/* c64 (R3-6): the guardrails of a restructure, as plain facts. Evidence counts, contract checks and the churn status all come from
   the server's dry run; nothing here is typed by the proposer except which triggers apply, and the two statements. The research gives
   no rule for when to restructure, so none of this says that more hierarchy helps: it shows what is recorded and what is kept. */
export const TRIGGERS: { key: RestructureTrigger; label: string; icon: typeof Scale; hint: string }[] = [
  { key: 'load_imbalance', label: 'Uneven load', icon: Scale, hint: 'Open tasks are piled on a few agents' },
  { key: 'coverage_gap', label: 'Coverage gap', icon: Layers, hint: 'A role, department head, duty or manager is missing today' },
  { key: 'repeated_reassigns', label: 'Repeated reassigns', icon: Repeat, hint: 'Tasks keep being taken away from the affected roles' },
  { key: 'failure_concentration', label: 'Failures in one role', icon: Target, hint: 'Confirmed failure tags pile up on one role' },
];
const LABEL = Object.fromEntries(TRIGGERS.map((t) => [t.key, t])) as Record<RestructureTrigger, (typeof TRIGGERS)[number]>;

const SCOPE = (t: { scope: 'now' | 'window' }, days: number) => (t.scope === 'now' ? 'now' : `last ${days} days`);
const stamp = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'now');

/** All four triggers are shown with their counts; the ones the proposer picked are marked, so the counts can't be cherry-picked.
    "No recorded trigger" (none picked) is a valid, honest answer: it is said out loud. `asOf` = when the server computed the counts. */
export function EvidenceBlock({ ev, compact, asOf }: { ev: OrgEvidence; compact?: boolean; asOf?: string | null }) {
  const row = (t: TriggerEvidence, picked: boolean) => {
    const L = LABEL[t.kind];
    // c88 (T2): a member does not get counts taken over missions they may not see; the server sends `hidden` (no verdict, no facts)
    if (t.hidden) return (
      <div key={t.kind} className={'oa-rs-row' + (picked ? '' : ' unpicked') + (compact ? ' compact' : '')} {...(picked ? { 'data-trigger': t.kind } : { 'data-trigger-other': t.kind })} data-hidden="1">
        <L.icon size={13} aria-hidden />
        <b>{L.label}</b>
        {picked ? <Chip hue={225} size="sm" title="The proposer picked this trigger as a reason for the change">picked</Chip> : <span className="dim" style={{ fontSize: 11 }}>not picked</span>}
        <span className="dim row" style={{ gap: 4, fontSize: 11.5 }} data-evidence-hidden><Lock size={11} aria-hidden />Counts visible to administrators<HelpTrigger k="org.proposal.evidenceHidden" /></span>
        <span className="dim" style={{ fontSize: 11 }} data-scope={t.scope}>{SCOPE(t, ev.windowDays)}</span>
      </div>
    );
    return (
      <div key={t.kind} className={'oa-rs-row' + (picked ? '' : ' unpicked') + (compact ? ' compact' : '')} title={picked ? undefined : t.facts.map((f) => `${f.label}: ${f.value}`).join('\n')} {...(picked ? { 'data-trigger': t.kind } : { 'data-trigger-other': t.kind })} data-supported={t.supported ? '1' : '0'}>
        <L.icon size={13} aria-hidden />
        <b>{L.label}</b>
        {picked ? <Chip hue={225} size="sm" title="The proposer picked this trigger as a reason for the change">picked</Chip> : <span className="dim" style={{ fontSize: 11 }}>not picked</span>}
        <Chip hue={t.supported ? 145 : 38} size="sm" title={t.supported ? 'The recorded counts back this trigger' : 'The recorded counts do not back this trigger'}>{t.supported ? 'backed by the counts' : 'not backed by the counts'}</Chip>
        <span className={'dim oa-rs-facts' + (compact ? ' inl' : '')} title={t.facts.map((f) => `${f.label}: ${f.value}`).join('\n')}>{t.facts.map((f) => `${f.label} ${f.value}`).join(' · ')}</span>
        <span className="dim" style={{ fontSize: 11 }} data-scope={t.scope}>{SCOPE(t, ev.windowDays)}</span>
      </div>
    );
  };
  return (
    <div className="oa-rs" data-evidence={ev.triggers.length}>
      <div className="row" style={{ gap: 6, fontSize: 11.5 }}><SearchCheck size={12} aria-hidden /><b>Evidence</b><span className="dim">real work only</span><span className="dim" data-as-of="evidence">as of {stamp(asOf)}</span><HelpTrigger k="org.proposal.evidence" /></div>
      {ev.triggers.length === 0 && <div className="oa-issue warn" data-evidence-none><SearchX size={13} aria-hidden /><span>No recorded trigger: this proposal does not say what motivated it.</span></div>}
      {ev.triggers.map((t) => row(t, true))}
      {(ev.others ?? []).map((t) => row(t, false))}
    </div>
  );
}

export function ContractChecks({ checks }: { checks: OrgContractCheck[] }) {
  return (
    <div className="oa-rs" data-contracts={checks.every((c) => c.ok) ? 'ok' : 'fail'}>
      <div className="row" style={{ gap: 6, fontSize: 11.5 }}><ClipboardCheck size={12} aria-hidden /><b>Contracts kept</b><HelpTrigger k="org.proposal.contracts" /></div>
      {checks.map((c) => (
        <div key={c.code} className={'oa-issue ' + (c.ok ? 'ok' : 'bad')} data-contract={c.code} data-ok={c.ok ? '1' : '0'}>
          {c.ok ? <CheckCircle2 size={13} aria-hidden /> : <AlertOctagon size={13} aria-hidden />}
          <span>{c.title}{c.reasons.map((r, i) => <span key={i} className="oa-rs-reason">{r}</span>)}</span>
        </div>
      ))}
    </div>
  );
}

export function ChurnStatus({ churn, asOf }: { churn: OrgChurn; asOf?: string | null }) {
  const left = churn.cooldownEndsInMinutes;
  return (
    <div className="oa-rs" data-churn>
      <div className="row wrap" style={{ gap: 6 }}>
        <Chip hue={225} icon={Gauge} size="sm" title="Reporting lines this proposal adds, removes or re-points"><span data-churn-lines>{churn.linesChanged} {churn.linesChanged === 1 ? 'line' : 'lines'} changed</span></Chip>
        {churn.exempt && <Chip hue={145} icon={Undo2} size="sm" title="Only the undo of the last applied change is not held by the cooldown or the budget. Every other rollback is."><span data-churn-exempt>undo of the last change: not held by cooldown or budget</span></Chip>}
        {churn.budget !== null && <Chip hue={churn.overBudget && !churn.exempt ? 0 : 145} icon={churn.overBudget && !churn.exempt ? AlertOctagon : CheckCircle2} size="sm" title="Lines changed by approved proposals in the window, this one included, against the operator's budget"><span data-churn-budget>{churn.usedInWindow + churn.linesChanged} of {churn.budget} in {churn.windowHours} h</span></Chip>}
        {churn.budget === null && churn.cooldownHours === null && <Chip hue={225} icon={CircleSlash} size="sm" title="The operator has set no churn budget and no cooldown"><span data-churn-off="both">budget and cooldown: not enforced</span></Chip>}
        {churn.budget === null && churn.cooldownHours !== null && <Chip hue={225} icon={CircleSlash} size="sm" title="The operator has set no churn budget"><span data-churn-off="budget">budget: not enforced</span></Chip>}
        {churn.cooldownHours === null && churn.budget !== null && <Chip hue={225} icon={CircleSlash} size="sm" title="The operator has set no cooldown"><span data-churn-off="cooldown">cooldown: not enforced</span></Chip>}
        {churn.cooldownHours !== null && !churn.exempt && (left === null
          ? <Chip hue={145} icon={Timer} size="sm" title="No organisation change was approved inside the operator's cooldown"><span data-churn-cooldown="clear">cooldown {churn.cooldownHours} h: clear</span></Chip>
          : <Chip hue={38} icon={Timer} size="sm"><span data-churn-cooldown="active">cooldown: {left >= 120 ? `${Math.ceil(left / 60)} h` : `${left} min`} left</span></Chip>)}
        {churn.budget === null && churn.cooldownHours === null && <span hidden data-churn-none />}
        <span className="dim" style={{ fontSize: 11 }} data-as-of="churn">as of {stamp(asOf)}</span>
        <HelpTrigger k="org.proposal.churn" />
      </div>
    </div>
  );
}

/** The two statements the proposer made: what it is compared with, and what it is expected to add. */
export function Statements({ baseline, cost }: { baseline: string; cost: string }) {
  if (!baseline && !cost) return <div className="dim" style={{ fontSize: 11.5 }} data-statements="none">Made before baselines were required: no baseline or cost was stated.</div>;
  return (
    <div className="oa-rs" data-statements>
      <div className="oa-rs-row"><ClipboardCheck size={13} aria-hidden /><b>Baseline</b><HelpTrigger k="org.proposal.baseline" /><span className="oa-rs-text" data-baseline>{baseline}</span></div>
      <div className="oa-rs-row"><Coins size={13} aria-hidden /><b>Expected cost</b><HelpTrigger k="org.proposal.cost" /><span className="oa-rs-text" data-cost>{cost}</span></div>
    </div>
  );
}
