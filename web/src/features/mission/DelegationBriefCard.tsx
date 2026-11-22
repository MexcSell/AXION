import { CalendarClock, ChevronRight, Dot, Globe, HandHelping, ListChecks, ShieldCheck, Wallet } from 'lucide-react';
import type { DelegationBriefDto, BriefTier } from '@contracts';
import { Chip, DemoTag } from '@/components/ui/Chips';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { AGENT_BY_ID } from '@/data/agents';
import '@/theme/pages/c42-delegation.css';

/** Tier colours: calm for observation, warmer as the approval gate rises (same hues as the policy help). */
export const TIER_HUE: Record<BriefTier, number> = { R0: 150, R1: 190, R2: 70, R3: 30, R4: 0 };
const agentName = (id: string) => AGENT_BY_ID[id]?.name ?? id;
const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Owner > lead > ... > this agent: the chain of briefs this one was handed down. */
export function briefChain(b: DelegationBriefDto, all: DelegationBriefDto[]): DelegationBriefDto[] {
  const byId = new Map(all.map((x) => [x.id, x]));
  const out: DelegationBriefDto[] = [b];
  for (let p = b.parentBriefId ? byId.get(b.parentBriefId) : undefined; p && out.length < 6; p = p.parentBriefId ? byId.get(p.parentBriefId) : undefined) out.unshift(p);
  return out;
}

export function DelegationBriefCard({ brief, all }: { brief: DelegationBriefDto; all: DelegationBriefDto[] }) {
  const b = brief.brief;
  const chain = briefChain(brief, all);
  return (
    <div className="dbrief" data-testid="delegation-brief">
      <nav className="dbrief-crumb" aria-label="Delegation chain">
        <span className="dbrief-step"><ShieldCheck size={12} aria-hidden />{chain[0].fromId === 'system' ? 'System' : 'Owner'}</span>
        {chain.map((c) => (<span key={c.id} className="dbrief-step"><ChevronRight size={12} aria-hidden />{agentName(c.toAgentId)}</span>))}
        <span className="dbrief-depth">depth {brief.depth}</span>
      </nav>
      <div className="dbrief-goal"><HandHelping size={15} aria-hidden /><b>{b.goal}</b>{brief.simulated && <DemoTag />}</div>
      <div className="dbrief-sec"><span className="section-label"><ListChecks size={12} aria-hidden /> Acceptance</span></div>
      <ul className="dbrief-accept">{b.acceptance.map((a, i) => <li key={i}><Dot size={16} aria-hidden /><span>{a}</span></li>)}</ul>
      <div className="dbrief-sec"><span className="section-label"><ShieldCheck size={12} aria-hidden /> Allowed capabilities</span></div>
      <div className="dbrief-caps">
        {b.capabilities.length ? b.capabilities.map((c) => {
          const tier = brief.tiers[c.kind] ?? null;
          return <Chip key={c.kind + (c.origin ?? '')} hue={tier ? TIER_HUE[tier] : 260} size="sm" icon={c.origin ? Globe : undefined} title={tier ? `${c.kind}: tier ${tier}` : c.kind}>{c.kind}{c.origin ? ` @ ${c.origin.replace(/^https?:\/\//, '')}` : ''}{tier ? ` · ${tier}` : ''}</Chip>;
        }) : <span className="dim">none</span>}
      </div>
      {brief.effective && (
        <div className="dbrief-eff" data-testid="brief-effective">
          <span className="section-label">Effective now</span>{' '}
          <span>{brief.effective.capabilities.length ? brief.effective.capabilities.map((c) => (c.origin ? `${c.kind} @ ${c.origin.replace(/^https?:\/\//, '')}` : c.kind)).join(', ') : 'none'}</span>
          {brief.effective.narrowedBy.map((n) => <span key={n.briefId} className="dbrief-narrow"> · narrowed by {agentName(n.toAgentId)} (not {n.dropped.join(', ')})</span>)}
          {brief.effective.deadline && brief.effective.deadline !== b.deadline && <span className="dbrief-narrow"> · deadline {when(brief.effective.deadline)}</span>}
          {brief.effective.budget !== null && brief.effective.budget !== (b.budget ?? null) && <span className="dbrief-narrow"> · budget {brief.effective.budget}</span>}
        </div>
      )}
      <div className="dbrief-meta">
        <span title="Deadline"><CalendarClock size={13} aria-hidden />{b.deadline ? when(b.deadline) : 'no deadline'}</span>
        {b.budget !== undefined && <span title="Budget"><Wallet size={13} aria-hidden />{b.budget} units</span>}
        <span className="dim" title="Escalation: when to ask a human">Ask a human: {b.escalation}</span>
        <span className="dbrief-help"><HelpTrigger k="delegation.brief" /></span>
      </div>
      <div className="dbrief-sha mono dim" title="sha256 over the canonical JSON of the brief">sha256:{brief.sha256.slice(0, 12)}</div>
    </div>
  );
}

export function NoBrief({ demo }: { demo: boolean }) {
  return <div className="dbrief-none" data-testid="no-brief"><HandHelping size={14} aria-hidden /><span className="dim">No brief (legacy){demo ? ' · demo data has no brief' : ''}</span><HelpTrigger k="delegation.brief" /></div>;
}
