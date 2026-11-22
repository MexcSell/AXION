import { Crosshair, Globe2, Lock, Zap } from 'lucide-react';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
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
  const blocked = a.canDecide === false;
  return { blocked, text: blocked ? (REASON[a.decideBlockedReason ?? ''] ?? 'You cannot decide this') : '' };
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
export function GateNote({ id, text, compact }: { id: string; text: string; compact?: boolean }) {
  return (
    <span className="row appr-gate" style={{ gap: 4 }}>
      <span id={id} className={compact ? 'sr-only' : 'appr-gate-text'} data-testid="approval-gate-reason"><Lock size={11} aria-hidden />{text}</span>
      <HelpTrigger k="approval.gate" />
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
