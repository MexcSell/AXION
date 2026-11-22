import { Crosshair, Globe2, Lock, Zap, ShieldAlert, Database, Send, Check, Minus } from 'lucide-react';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { isApi } from '@/api/mode';
import { useId, type ButtonHTMLAttributes } from 'react';
import type { Approval } from '@/data/types';

const EFFECT: Record<string, string> = { read: 'Reads only', prepare: 'Prepares a reversible change', external: 'Acts outside the company', infra: 'Changes live infrastructure', critical: 'Critical, hard to reverse' };

const REASON: Record<string, string> = {
  tier_requires_admin: 'Needs an administrator',
  requester_cannot_decide: 'You requested this; someone else must decide',
  already_decided: 'Already decided',
  expired: 'Expired; the agent must ask again',
};

/**
 * Can the signed-in user decide this request? The answer is the server's (`canDecide`, computed by the same function that refuses a decision);
 * nothing here knows a tier or a role. A request without the flag (demo fixtures, an older server) is offered, and the server still decides.
 */
export function gateOf(a: Pick<Approval, 'canDecide' | 'decideBlockedReason'>): { blocked: boolean; text: string } {
  // api mode fails closed: no flag from the server means no button (an older server, or a bug, never turns into a decision the server refuses). Demo fixtures carry `canDecide: true`.
  const blocked = a.canDecide === false || (a.canDecide === undefined && isApi());
  return { blocked, text: blocked ? (REASON[a.decideBlockedReason ?? ''] ?? (a.canDecide === undefined ? 'Waiting for the server to say whether you may decide' : 'You cannot decide this')) : '' };
}

/**
 * Props for a decision control. A blocked control stays focusable (aria-disabled, not disabled) so keyboard and screen-reader users reach
 * it and hear the reason through aria-describedby; its click does nothing and sends nothing.
 */
export function useGate(a: Pick<Approval, 'canDecide' | 'decideBlockedReason'>) {
  const id = useId();
  const g = gateOf(a);
  const bind = (onClick: () => void, extra = ''): ButtonHTMLAttributes<HTMLButtonElement> => g.blocked
    ? { 'aria-disabled': true, 'aria-describedby': id, className: `${extra} is-gated`.trim(), onClick: (e) => { e.preventDefault(); e.stopPropagation(); } }
    : { className: extra, onClick };
  return { ...g, id, bind };
}

/** The reason in words, plus the `?`. Rendered next to the buttons a user cannot press; its id is what those buttons point at. */
export function GateNote({ id, text, compact, tipSide = 'bottom' }: { id: string; text: string; compact?: boolean; tipSide?: 'top' | 'bottom' }) {
  return (
    <span className="row appr-gate" style={{ gap: 4 }}>
      <span id={id} className={compact ? 'sr-only' : 'appr-gate-text'} data-testid="approval-gate-reason"><Lock size={11} aria-hidden />{text}</span>
      <HelpTrigger k="approval.gate" tipSide={tipSide} />
    </span>
  );
}

/** What exactly is being approved: tier, effect, target and origin (spec §13.2). Shown only when the server supplied them. */
export function ApprovalFacts({ a }: { a: Approval }) {
  const tier = a.riskTier;
  if (!tier && !a.target && !a.origin) return null;
  return (
    <div className="appr-facts row wrap" data-testid="approval-facts">
      {tier && <span className="appr-fact" title={a.effectWhy ?? undefined}><Zap size={12} aria-hidden />{tier} · {a.effect ? (EFFECT[a.effect] ?? a.effect) : 'effect set by policy'}</span>}
      {a.target && <span className="appr-fact mono"><Crosshair size={12} aria-hidden /><span className="sr-only">Target </span>{a.target}</span>}
      {a.origin && <span className="appr-fact mono"><Globe2 size={12} aria-hidden /><span className="sr-only">Origin </span>{a.origin}</span>}
      {a.approver === 'admin' || a.approver === 'owner' ? <span className="appr-fact"><Lock size={12} aria-hidden />Administrator decides</span> : null}
      {tier && <HelpTrigger k="approval.tiers" />}
    </div>
  );
}

/** The three words-for-flags. Order and wording are the mapping the help entry explains. */
const FLAG_ROWS = [
  { key: 'untrustedInput', Icon: Globe2, yes: 'Reads content nobody vetted', no: 'Reads no untrusted content' },
  { key: 'sensitiveAccess', Icon: Database, yes: 'Reaches live systems or sensitive data', no: 'Reaches no sensitive system' },
  { key: 'canChangeState', Icon: Send, yes: 'Can change things or contact the outside', no: 'Changes nothing outside' },
] as const;

/**
 * Why approval was asked (c58). The flags are the server's, derived from the agent's configuration; nothing here computes or edits one.
 * Plain words, a tick or a dash, the sources on hover, and a `?` that says the rule is a heuristic.
 */
export function RuleOfTwoNote({ a }: { a: Pick<Approval, 'ruleOfTwo'> }) {
  const r = a.ruleOfTwo;
  if (!r) return null;
  return (
    <div className={`appr-r2${r.fired ? ' is-fired' : ''}`} data-testid="approval-rule-of-two" data-fired={r.fired ? 'yes' : 'no'}>
      <div className="row appr-r2-head">
        <ShieldAlert size={13} aria-hidden />
        <b>Why approval was asked</b>
        <span className="dim">{r.fired ? 'All three at once: a person must decide' : 'Not all three at once'}</span>
        <span className="spacer" />
        <HelpTrigger k="approval.ruleOfTwo" />
      </div>
      <ul className="appr-r2-list">
        {FLAG_ROWS.map(({ key, Icon, yes, no }) => {
          const on = r.flags[key];
          const why = r.because[key].join('; ');
          return (
            <li key={key} className={`appr-r2-flag${on ? ' is-on' : ''}`} data-flag={key} data-on={on ? 'yes' : 'no'} title={why || undefined}>
              <Icon size={12} aria-hidden />
              <span>{on ? yes : no}</span>
              {on ? <Check size={12} aria-label="holds" /> : <Minus size={12} aria-label="does not hold" />}
              {why && <span className="sr-only"> because {why}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
