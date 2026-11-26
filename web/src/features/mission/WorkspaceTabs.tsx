import { StaffingCard, MissionContent } from './StaffingCard';
import { AnimatePresence, motion } from 'motion/react';
import {
  Package, Gavel, FileText, History, Target, CheckCircle2, Circle,
  ShieldCheck, AlertTriangle, BadgeCheck, Users, Paperclip, Pencil,
} from 'lucide-react';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { IconButton } from '@/components/ui/IconButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Tip } from '@/components/ui/Tip';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { useTab } from '@/hooks/useTab';
import { useData, allApprovals } from '@/store/data';
import { openDialog } from '@/store/ui';
import { AGENT_BY_ID } from '@/data/agents';
import { getMissionControl } from '@/data/missionControl';
import type { Mission } from '@/data/types';
import { ago } from '@/lib/format';
import { PhaseStepper } from './MissionBits';
import { ApprovalMini } from './Shared';
import { EvolveReport } from './EvolveReport';
import { useMissionControl } from '@/api/missionControl';


/** Workspace tabs of the merged Missions page (formerly Mission Control). */

const stateTone = (s: string) => (s === 'working' ? 'good' : s === 'waiting' ? 'warn' : s === 'blocked' ? 'bad' : s === 'done' ? 'violet' : 'info') as 'good' | 'warn' | 'bad' | 'violet' | 'info';

/* ------------------------------------------------------------------ */
export function OverviewTab({ m, onSelectAgent }: { m: Mission; onSelectAgent: (agentId: string) => void }) {
  useMissionControl(m.id);
  const mc = getMissionControl(m);
  const [, setTab] = useTab('missions');
  const decisions = useData((s) => s.approvalDecisions);
  const pend = allApprovals([m], decisions).filter((a) => a.status === 'pending');
  const blockers = mc.nodes.filter((n) => n.state === 'blocked' || n.state === 'waiting');
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="ov-grid">
        {[
          { l: 'Verified progress', v: `${m.progress}%`, s: `${m.tasksVerified}/${m.tasksTotal} tasks`, c: '#22d3ee', i: BadgeCheck },
          { l: 'Active blockers', v: String(blockers.length), s: blockers.length ? blockers.map((b) => AGENT_BY_ID[b.agentId]?.name).join(', ') : 'none', c: blockers.length ? '#fbbf24' : '#2ee98a', i: AlertTriangle },
          { l: 'Pending decisions', v: String(pend.length), s: pend[0]?.title ?? 'nothing waiting', c: '#a78bfa', i: Gavel },
          { l: 'Artifacts', v: String(mc.artifacts.length), s: `${mc.artifacts.reduce((s, a) => s + a.versions.length, 0)} immutable versions`, c: '#60a5fa', i: Package },
        ].map((k, i) => (
          <motion.div key={k.l} className="kpi" style={{ ['--kc' as string]: k.c }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .05 }}>
            <k.i size={26} className="kpi-ico" />
            <div style={{ minWidth: 0 }}><div className="kpi-val" style={{ fontSize: 21 }}>{k.v}</div><div className="kpi-label">{k.l}</div><div className="dim ellipsis" style={{ fontSize: 11 }}>{k.s}</div></div>
          </motion.div>
        ))}
      </div>
      {m.staffing ? <StaffingCard m={m} /> : <PhaseStepper phases={m.phases} />}
      {pend.length > 0 && (
        <motion.div className="next-action" initial={{ opacity: 0, scale: .98 }} animate={{ opacity: 1, scale: 1 }}>
          <Gavel size={20} />
          <div className="grow"><b>Next action is yours:</b> {pend[0].title}<div className="dim" style={{ fontSize: 12 }}>{pend[0].detail}</div></div>
          <button className="btn primary" onClick={() => setTab('Approvals')}>Review decision</button>
        </motion.div>
      )}
      <div className="grid g-2">
        <div className="subpanel">
          <div className="row" style={{ marginBottom: 6 }}><Target size={15} className="info" /><b>Mission content</b><HelpTrigger k="mission.content" /><span className="spacer" />
            {m.status !== 'archived' && <IconButton icon={Paperclip} label="Add resource" size="sm" onClick={() => openDialog('attach-files', { missionId: m.id })} />}
            <IconButton icon={Pencil} label="Edit mission" size="sm" onClick={() => openDialog('mission-edit', { missionId: m.id })} />
          </div>
          <MissionContent m={m} />
          <div className="col" style={{ gap: 5, marginTop: 8 }}>
            {m.criteria.map((c, i) => (
              <motion.div key={c.text} className="row" style={{ gap: 7, fontSize: 12.5 }} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * .05 }}>
                {c.done ? <CheckCircle2 size={14} className="good" /> : <Circle size={14} className="dim" />}<span style={{ color: c.done ? 'var(--text)' : 'var(--text-muted)' }}>{c.text}</span>
              </motion.div>
            ))}
          </div>
        </div>
        <div className="ai-summary">
          <div className="row" style={{ marginBottom: 6 }}><FileText size={15} className="violet" /><b>Mission summary</b><HelpTrigger k="mission.aiSummary" /><span className="spacer" /><span className="dim" style={{ fontSize: 11.5 }}>{ago(m.summaryAgoMin)}</span></div>
          <p style={{ fontSize: 13.5, lineHeight: 1.55 }}>{m.summary || 'No summary has been recorded.'}</p>
          <div className="ov-pnn">
            {[['Plan', `${m.tasksTotal} tasks · ${m.phases.length} phases · ${m.agentIds.length} agents`], ['Now', m.lastEvent], ['Decisions pending', String(pend.length)]].map(([k, v]) => (
              <div key={k}><span className="section-label">{k}</span><span className="ellipsis" title={v}>{v}</span></div>
            ))}
          </div>
          <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => openDialog('ai-summary', { missionId: m.id })}>View mission details</button>
        </div>
      </div>
      <div className="grid g-2">
        <div className="subpanel">
          <div className="row" style={{ marginBottom: 8 }}><Users size={15} className="info" /><b>Delegation</b><span className="dim" style={{ fontSize: 11.5 }}>{mc.nodes.length} instances</span><HelpTrigger k="agent.instance" /><span className="spacer" /><button className="btn sm ghost" onClick={() => setTab('Hierarchy')}>Hierarchy</button></div>
          <div className="team-strip">
            {mc.nodes.map((n, i) => {
              const a = AGENT_BY_ID[n.agentId];
              if (!a) return null;
              return (
                <Tip key={n.instanceId} label={`${a.name} — ${n.task}`}>
                  <motion.button className="team-dot" onClick={() => onSelectAgent(a.id)} initial={{ scale: .5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: .04 * i, type: 'spring', stiffness: 300, damping: 18 }} aria-label={`${a.name}: ${n.task}`}>
                    <RobotAvatar role={a.role} size={38} status={stateTone(n.state)} />
                    <span className="ellipsis">{a.name}</span>
                  </motion.button>
                </Tip>
              );
            })}
          </div>
        </div>
        <div className="subpanel">
          <div className="row" style={{ marginBottom: 8 }}><History size={15} className="info" /><b>Recent staffing activity</b><span className="spacer" /><button className="btn sm ghost" onClick={() => setTab('Timeline')}>Open timeline</button></div>
          {m.staffing?.log.length ? m.staffing.log.slice(-3).reverse().map(event => <div key={event.at + event.text} className="event-row">{event.text}</div>) : <span className="dim">No staffing events yet.</span>}
        </div>
      </div>
    </div>
  );
}

export function ResultsTab({ m }: { m: Mission }) {
  if (m.evolve) return <EvolveReport evolve={m.evolve} view="results" />;
  return <EmptyState icon={Package} title="No mission results" body={`No output has been recorded for ${m.id}.`} />;
}

export function ApprovalsTab({ m }: { m: Mission }) {
  const decisions = useData((s) => s.approvalDecisions);
  const list = allApprovals([m], decisions);
  const pend = list.filter((a) => a.status === 'pending');
  const done = list.filter((a) => a.status !== 'pending');
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 8 }}><Gavel size={16} className="warn" /><b>Pending ({pend.length})</b><span className="dim" style={{ fontSize: 12 }}>Sorted by risk and deadline. Each decision is bound to one exact action.</span></div>
      {pend.length === 0 && <EmptyState icon={ShieldCheck} title="Nothing waiting for you" body="Agents ask here before consequential actions such as publishing, submitting forms or new website origins." />}
      <AnimatePresence>{pend.map((a) => <motion.div key={a.id} layout exit={{ opacity: 0, x: 40 }}><ApprovalMini id={a.id} /></motion.div>)}</AnimatePresence>
      {done.length > 0 && <><div className="section-label" style={{ marginTop: 6 }}>Resolved</div>{done.map((a) => <ApprovalMini key={a.id} id={a.id} />)}</>}
    </div>
  );
}

export function ReportsTab({ m }: { m: Mission }) {
  if (m.evolve) return <EvolveReport evolve={m.evolve} view="reports" />;
  return <EmptyState icon={FileText} title="No report yet" body={`No report has been recorded for ${m.id}.`} />;
}

export function TimelineTab({ m }: { m: Mission }) {
  const events = [...(m.staffing?.log ?? [])].reverse();
  if (!events.length) return <EmptyState icon={History} title="No staffing events yet" body="Recorded staffing events appear here." />;
  return (
    <div className="col" style={{ gap: 10 }}>
      <b>Staffing timeline</b>
      {events.map(event => <div key={event.at + event.text} className="event-row">
        <time dateTime={new Date(event.at).toISOString()}>{new Date(event.at).toLocaleString()}</time>
        <span>{event.text}</span>
      </div>)}
    </div>
  );
}
