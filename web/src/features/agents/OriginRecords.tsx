import { useState } from 'react';
import { Bot, User, Wrench, Gauge, History, Archive, ShieldQuestion, Check, AlertOctagon } from 'lucide-react';
import type { ContributionDto, OriginChannel, OriginClass } from '@contracts';
import { Chip } from '@/components/ui/Chips';
import { LiveStatus } from '@/components/ui/LiveStatus';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { useContributions, useRetirementProposals, retireSkill, keepSkill } from '@/api/playbooks';
import { isApi } from '@/api/mode';
import { toast } from '@/store/ui';
import { ago } from '@/lib/format';

/* Improvement cycle 59 (R2-5): where a record came from, how many items a role may keep active, the contribution log of a record, and
   fixture-only retirement proposals. Records only: nothing executes, and no agent reads a playbook or a skill yet. */

const CLASS: Record<OriginClass, { label: string; hue: number; icon: typeof User; why: string }> = {
  human: { label: 'human', hue: 145, icon: User, why: 'Typed by a person.' },
  agent: { label: 'agent', hue: 265, icon: Bot, why: 'Written by an agent, or a summary that rests on agent-written items.' },
  tool: { label: 'tool', hue: 38, icon: Wrench, why: 'Came from tool output, or a summary that rests on tool output.' },
};
const CHANNEL: Record<OriginChannel, string> = { human_entry: 'human entry', agent_output: 'agent output', tool_output: 'tool output', derived: 'derived from other records' };

/** The origin class (tool < agent < human) and, for a derived record, that it is derived. Review never raises it. */
export function OriginChip({ cls, channel }: { cls: OriginClass; channel: OriginChannel }) {
  const C = CLASS[cls];
  return (
    <span className="row" style={{ gap: 3 }} data-origin={cls} data-origin-channel={channel}>
      <Chip hue={C.hue} icon={C.icon} size="sm" title={`Origin: ${C.why} Channel: ${CHANNEL[channel]}. A derived record is never above its weakest source; review never raises the origin.`}>
        {C.label}{channel === 'derived' ? ' · derived' : ''}
      </Chip>
    </span>
  );
}

/** Active items against the cap of the role. */
export function CapChip({ count, cap }: { count: number; cap: number }) {
  const full = count >= cap;
  return (
    <span className="row" style={{ gap: 4 }} data-cap={cap} data-active-count={count} data-at-cap={full ? '1' : '0'}>
      <Chip hue={full ? 0 : 225} icon={Gauge} size="sm" solid={full} title="Active items in this playbook against the cap for the role">active {count} of {cap}</Chip>
      <HelpTrigger k="playbook.cap" />
    </span>
  );
}

const ACTION: Record<ContributionDto['action'], string> = {
  proposed: 'proposed', accepted: 'accepted', rejected: 'rejected', closed_duplicate: 'closed as a duplicate', withdrawn: 'withdrawn by a rollback', restored: 'restored by a rollback',
  approved: 'approved', retired: 'retired', replaced: 'replaced by a newer version', retirement_kept: 'kept after a retirement proposal',
};
const since = (iso: string) => ago((Date.now() - new Date(iso).getTime()) / 60_000);

/** The append-only log of one record, read when opened. In demo mode the log lives on the server only. */
export function ContribLog({ kind, id, label }: { kind: 'lessons' | 'skills'; id: string; label: string }) {
  const [open, setOpen] = useState(false);
  const r = useContributions(kind, open && isApi() ? id : null);
  return (
    <span className="col" style={{ gap: 4, display: 'inline-flex' }}>
      <span className="row" style={{ gap: 4 }}>
        <button className="btn sm ghost" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} the contribution log of ${label}`} onClick={() => setOpen((o) => !o)}><History size={13} />Log</button>
        {open && <HelpTrigger k="playbook.log" />}
      </span>
      {open && (!isApi()
        ? <span className="dim" style={{ fontSize: 11.5 }}>DEMO: contribution logs are stored on the server.</span>
        : r.error ? <span className="oa-banner" role="alert"><AlertOctagon size={14} /><span>Log not loaded: {r.error}</span></span>
        : !r.data ? <LiveStatus className="dim" style={{ fontSize: 11.5 }}>Loading the log…</LiveStatus>
        : <ol className="col" style={{ gap: 2, margin: 0, paddingLeft: 16, fontSize: 11.5 }} aria-label={`Contribution log of ${label}`} data-contrib-log={id}>
          {r.data.map((c) => (
            <li key={c.seq} data-contrib={c.action}>
              <b>{c.actorName}</b>{c.actorKind === 'system' ? ' (system)' : c.actorKind === 'agent' ? ' (agent)' : ''} {ACTION[c.action]}{c.version ? ` · v${c.version}` : ''} · <span className="dim">{since(c.at)}</span>
              {c.sources.length > 0 && <span className="dim"> · {c.sources.length} source{c.sources.length === 1 ? '' : 's'}</span>}
              {c.note && <span className="dim"> · “{c.note}”</span>}
            </li>))}
        </ol>)}
    </span>
  );
}

/** Retirement proposals from FIXTURE outcome scores. A person decides: nothing retires by itself. Labelled "no outcome data yet" until agents use skills. */
export function RetirementStrip({ admin }: { admin: boolean }) {
  const api_ = isApi();
  const r = useRetirementProposals(api_ && admin);
  const [busy, setBusy] = useState<string | null>(null);
  const d = r.data;
  const none = !api_ || !d || d.dataState === 'none';
  const act = async (id: string, name: string, kind: 'retire' | 'keep', detail: string) => {
    if (busy) return;
    setBusy(id);
    const res = kind === 'retire' ? await retireSkill(id, `Retired after a retirement proposal (${detail}, fixture)`) : await keepSkill(id, `Kept after a retirement proposal (${detail}, fixture)`);
    setBusy(null);
    toast(res.ok ? { tone: 'success', title: kind === 'retire' ? `${name} retired` : `${name} kept` } : { tone: 'warning', title: 'Retirement: not done', body: res.message });
  };
  if (api_ && !admin) return null; // proposals are for administrators, who decide
  return (
    <div className="subpanel glass-card" style={{ padding: '8px 12px' }} data-retirement={none ? 'none' : String(d?.proposals.length ?? 0)}>
      <div className="row wrap" style={{ gap: 8 }}>
        <Archive size={15} aria-hidden />
        <b style={{ fontSize: 13 }}>Retirement proposals</b>
        <Chip hue={38} icon={ShieldQuestion} size="sm" title="No agent uses a skill yet, so the only scores are test fixtures">fixture only</Chip>
        <Chip hue={225} size="sm" title={`No agent has used a skill yet, so there is no outcome data from real use. A proposal appears when a skill's latest fixture score is below ${d?.floor ?? 0.4} with at least ${d?.minN ?? 5} observations`}>no outcome data yet</Chip>
        {!none && d && <Chip hue={d.proposals.length ? 0 : 145} size="sm">{d.proposals.length} proposed · floor {d.floor}, n ≥ {d.minN}</Chip>}
        <span className="spacer" />
        <HelpTrigger k="skills.retirement" />
      </div>
      {!none && d && d.proposals.length > 0 && (
        <ul className="col" style={{ gap: 4, margin: '6px 0 0', padding: 0, listStyle: 'none' }} aria-label="Retirement proposals">
          {d.proposals.map((p) => (
            <li key={p.skillId} className="row wrap" style={{ gap: 8, fontSize: 12.5 }} data-retirement-proposal={p.skillId}>
              <b>{p.name}</b><Chip hue={225} size="sm" className="tnum">v{p.version}</Chip>
              <span className="dim">score {p.score.toFixed(2)} over {p.n} (fixture)</span><span className="spacer" />
              <button className="btn sm" disabled={busy !== null} aria-label={`Keep skill ${p.name}`} onClick={() => act(p.skillId, p.name, 'keep', `${p.score.toFixed(2)} over ${p.n}`)}><Check size={13} />Keep</button>
              <button className="btn sm primary" disabled={busy !== null} aria-label={`Retire skill ${p.name}`} onClick={() => act(p.skillId, p.name, 'retire', `${p.score.toFixed(2)} over ${p.n}`)}><Archive size={13} />Retire</button>
            </li>))}
        </ul>)}
    </div>
  );
}
