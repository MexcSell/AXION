import { Crosshair, Globe2, Lock, Zap } from 'lucide-react';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { useMe, isAdmin, type Account } from '@/store/auth';
import { isApi } from '@/api/mode';
import type { Approval } from '@/data/types';

const EFFECT: Record<string, string> = { read: 'Reads only', prepare: 'Prepares a reversible change', external: 'Acts outside the company', infra: 'Changes live infrastructure', critical: 'Critical, hard to reverse' };

/** R3 and R4 are decided by an administrator (policy approver; the server enforces it, this only explains it). Only api mode with a signed-in non-administrator is gated: the demo mode has no policy server. */
export const isGated = (a: Pick<Approval, 'risk'>, me: Account | undefined): boolean => isApi() && !!me && !isAdmin(me) && (a.risk === 'high' || a.risk === 'critical');
export const useGated = (a: Pick<Approval, 'risk'>): boolean => isGated(a, useMe());

/** Disabled-button explanation: a `?` next to the buttons a member cannot press. */
export function GateHelp() { return <HelpTrigger k="approval.gate" />; }

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
    </div>
  );
}
