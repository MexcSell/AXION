import { StaffingCard, MissionContent } from './StaffingCard';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import {
  Package, Gavel, FileText, History, Target, CheckCircle2, Circle, Sparkles, Eye, Download, PlayCircle, GitCompare, Layers,
  FileJson, FileDown, ShieldCheck, AlertTriangle, Filter, BadgeCheck, Globe, Workflow, Users, Paperclip, Pencil,
} from 'lucide-react';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { IconButton } from '@/components/ui/IconButton';
import { Chip, InstanceStateChip, DemoTag, Dot } from '@/components/ui/Chips';
import { EmptyState } from '@/components/ui/EmptyState';
import { Tip } from '@/components/ui/Tip';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { useTab } from '@/hooks/useTab';
import { useData, allApprovals } from '@/store/data';
import { openDialog, toast } from '@/store/ui';
import { AGENT_BY_ID } from '@/data/agents';
import { getMissionControl } from '@/data/missions';
import type { Artifact, Mission, TimelineEvent } from '@/data/types';
import { ago, clock, cx } from '@/lib/format';
import { PhaseStepper } from './MissionBits';
import { EvidenceThumb } from './Messenger';
import { ApprovalMini, EventIcon } from './Shared';
import { useLive } from './live';
import { isApi } from '@/api/mode';
import { useAuth } from '@/store/auth';
import { useMissionControl } from '@/api/missionControl';

/** api mode, real missions: results and the timeline are produced by execution, which arrives in Stage 8. */
const stage8 = (m: Mission) => isApi() && !m.demo;

/** Workspace tabs of the merged Missions page (formerly Mission Control). */

const stateTone = (s: string) => (s === 'working' ? 'good' : s === 'waiting' ? 'warn' : s === 'blocked' ? 'bad' : s === 'done' ? 'violet' : 'info') as 'good' | 'warn' | 'bad' | 'violet' | 'info';

/* ------------------------------------------------------------------ */
export function OverviewTab({ m, onSelectAgent }: { m: Mission; onSelectAgent: (agentId: string) => void }) {
  useMissionControl(m.id);
  const mc = getMissionControl(m);
  const [, setTab] = useTab('missions');
  const decisions = useData((s) => s.approvalDecisions);
  const lastTs = useData((s) => s.lastEventAt);
  const pend = allApprovals([m], decisions).filter((a) => a.status === 'pending');
  const blockers = mc.nodes.filter((n) => n.state === 'blocked' || n.state === 'waiting');
  const lines = useLive((s) => s.lines).filter((l) => l.missionId === m.id).slice(0, 4);
  const running = ['running', 'planning', 'verifying'].includes(m.status);
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
            <IconButton icon={Paperclip} label="Add resource" size="sm" onClick={() => openDialog('attach-files', { onAttach: (a: unknown[]) => toast({ tone: 'success', title: `${a.length} resource(s) added to ${m.id}`, body: 'Stored with checksum; agents see them in the next planning step.' }) })} />
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
          <div className="row" style={{ marginBottom: 6 }}><Sparkles size={15} className="violet" /><b>AI progress summary</b><HelpTrigger k="mission.aiSummary" /><span className="spacer" /><span className="dim" style={{ fontSize: 11.5 }}>{ago(m.summaryAgoMin)}</span></div>
          <p style={{ fontSize: 13.5, lineHeight: 1.55 }}>{m.summary}</p>
          <div className="ov-pnn">
            {[['Plan', `${m.tasksTotal} tasks · ${m.phases.length} phases · ${m.agentIds.length} agents`], ['Now', m.lastEvent], ['Next', pend.length ? 'Waiting for your decision' : 'QA verifies each task before it counts']].map(([k, v]) => (
              <div key={k}><span className="section-label">{k}</span><span className="ellipsis" title={v}>{v}</span></div>
            ))}
          </div>
          <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => openDialog('ai-summary', { missionId: m.id })}>Review provenance</button>
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
          <div className="row" style={{ marginBottom: 8 }}><Package size={15} className="info" /><b>Recent artifacts</b><span className="spacer" /><button className="btn sm ghost" onClick={() => setTab('Results')}>All results</button></div>
          {mc.artifacts.length === 0 && <span className="dim" style={{ fontSize: 12.5 }}>Nothing produced yet.{stage8(m) && ' Results arrive in Stage 8, when agents execute.'}</span>}
          {mc.artifacts.slice(0, 3).map((a) => (
            <div key={a.id} className="list-row" style={{ cursor: 'pointer' }} onClick={() => openDialog('artifact-preview', { missionId: m.id, artifactId: a.id })}>
              <ArtifactIcon a={a} /><span className="ellipsis grow">{a.name}</span><Chip hue={a.versions[0].verified ? 145 : 38} size="sm">{a.versions[0].v}</Chip>
            </div>
          ))}
        </div>
      </div>
      <div className="subpanel">
        <div className="row" style={{ marginBottom: 8 }}><History size={15} className="info" /><b>Live activity</b>
          {running && <span className="row good" style={{ gap: 5, fontSize: 11.5, fontWeight: 700 }}><Dot tone="good" pulse />Live · last event {clock(0, lastTs)}</span>}
          <span className="spacer" /><DemoTag /><button className="btn sm ghost" onClick={() => setTab('Timeline')}>Open timeline</button></div>
        <AnimatePresence initial={false}>
          {lines.map((l) => (
            <motion.div key={l.id} className="event-row" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
              <span className="mono dim" style={{ width: 44 }}>{clock(0, l.at)}</span><Dot tone="info" /><span className="ellipsis">{l.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
        {stage8(m) && mc.timeline.length === 0 && lines.length === 0 && <div className="dim" style={{ fontSize: 12.5 }}>No agent activity yet. The timeline of a real mission arrives in Stage 8, when agents execute.</div>}
        {mc.timeline.slice(0, Math.max(0, 5 - lines.length)).map((e) => <div key={e.id} className="event-row"><span className="mono dim" style={{ width: 44 }}>{clock(e.agoMin)}</span><EventIcon type={e.type} /><span className="ellipsis grow">{e.text}</span><span className="mono dim" style={{ fontSize: 10.5 }}>{e.trace}</span></div>)}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
export const ART_ICON: Record<Artifact['type'], typeof Package> = { website: Globe, document: FileText, image: Eye, dataset: Layers, code: FileJson, report: FileText, recipe: Workflow, screenshot: Eye, video: PlayCircle };
export function ArtifactIcon({ a }: { a: Artifact }) {
  const I = ART_ICON[a.type];
  return <span className="ev-ico" style={{ width: 30, height: 30, color: 'var(--accent-2)' }}><I size={15} /></span>;
}

export function downloadBlob(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function ResultsTab({ m }: { m: Mission }) {
  const mc = getMissionControl(m);
  const [ver, setVer] = useState<Record<string, string>>({});
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 8 }}><Package size={16} className="info" /><b>Mission results</b><span className="dim" style={{ fontSize: 12 }}>Every version is immutable; old versions stay downloadable.</span><HelpTrigger k="release.version" /><span className="spacer" />
        <button className="btn sm" onClick={() => openDialog('download-bundle', { missionId: m.id })}><Download size={14} />Bundle</button></div>
      {mc.artifacts.length === 0 && isApi() && <EmptyState icon={Package} title="No results yet" body={stage8(m) ? 'Results arrive in Stage 8: agents do not execute yet, so nothing has been produced for this mission.' : 'Nothing has been produced for this mission yet.'} />}
      <div className="grid g-2">
        {mc.artifacts.map((a, i) => {
          const v = a.versions.find((x) => x.v === ver[a.id]) ?? a.versions[0];
          return (
            <motion.div key={a.id} className="glass-card hoverable result-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .05 }}>
              <div className="row" style={{ gap: 10 }}>
                {a.type === 'website' || a.type === 'screenshot' || a.type === 'image' ? <EvidenceThumb seed={a.name} w={74} h={48} /> : <ArtifactIcon a={a} />}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <b className="ellipsis" style={{ display: 'block' }}>{a.name}</b>
                  <div className="row" style={{ gap: 6, fontSize: 11.5 }}>
                    <span className="dim" style={{ textTransform: 'capitalize' }}>{a.type}</span>
                    {v.verified ? <Chip hue={145} size="sm" icon={BadgeCheck}>verified</Chip> : <Chip hue={38} size="sm">pending QA</Chip>}
                  </div>
                </div>
                <select className="select" style={{ width: 92, height: 30 }} value={v.v} onChange={(e) => setVer({ ...ver, [a.id]: e.target.value })} aria-label={`Version of ${a.name}`}>
                  {a.versions.map((x, k) => <option key={x.v} value={x.v}>{x.v}{k === 0 ? ' (latest)' : ''}</option>)}
                </select>
              </div>
              <div className="mono dim ellipsis" style={{ fontSize: 10.5, margin: '8px 0 4px' }}>{v.hash} · {v.size} · {ago(v.agoMin)} by {AGENT_BY_ID[v.by]?.name}</div>
              <div className="dim" style={{ fontSize: 12 }}>{v.notes}</div>
              <div className="row" style={{ gap: 4, marginTop: 8 }}>
                <IconButton icon={Eye} label="Preview" size="sm" onClick={() => openDialog('artifact-preview', { missionId: m.id, artifactId: a.id, version: v.v })} />
                <IconButton icon={History} label="All versions" size="sm" onClick={() => openDialog('artifact-versions', { missionId: m.id, artifactId: a.id })} />
                <IconButton icon={GitCompare} label="Compare versions" size="sm" disabled={a.versions.length < 2} onClick={() => openDialog('compare-versions', { missionId: m.id, artifactId: a.id })} />
                {a.runnable && <IconButton icon={PlayCircle} label="Run in safe preview" size="sm" onClick={() => openDialog('artifact-run', { missionId: m.id, artifactId: a.id, version: v.v })} />}
                <HelpTrigger k="artifact.execute" />
                <span className="spacer" />
                <button className="btn sm" onClick={() => { downloadBlob(`${a.name.replace(/[^\w.-]+/g, '_')}-${v.v}.manifest.json`, JSON.stringify({ artifact: a.id, name: a.name, version: v.v, sha256: v.hash, size: v.size, mission: m.id, createdBy: v.by, verified: v.verified, note: 'DEMO manifest — artifact bytes are produced by the backend in Stage 8' }, null, 2)); toast({ tone: 'success', title: `Downloaded ${a.name} ${v.v}`, body: 'Manifest with checksum (demo bytes).' }); }}>
                  <Download size={14} />{v.v}
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
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
  useMissionControl(m.id, ['hierarchy', 'tasks']);
  const mc = getMissionControl(m);
  const lead = AGENT_BY_ID[m.leadId];
  const [rev, setRev] = useState('r3');
  const owner = useAuth((st) => st.accounts.find((a) => a.id === m.ownerId));
  const ownerName = owner?.name ?? m.owner;
  const claims = [
    { t: `${m.tasksVerified} of ${m.tasksTotal} tasks are independently verified.`, ev: mc.tasks.filter((t) => t.state === 'passed').slice(0, 2).map((t) => t.id) },
    { t: m.criteria.filter((c) => c.done).map((c) => c.text).join('; ') || 'No criteria met yet.', ev: ['T-evidence'] },
    { t: m.summary, ev: mc.timeline.slice(0, 2).map((e) => e.trace) },
  ];
  const md = `# ${m.title} — report ${rev}\n\nLead: ${lead?.name}\nVerified progress: ${m.progress}%\n\n${claims.map((c, i) => `${i + 1}. ${c.t} [evidence: ${c.ev.join(', ')}]`).join('\n')}\n\nQA verdict: ${m.status === 'completed' ? 'PASS' : 'PENDING'}\n`;
  if (stage8(m)) return <EmptyState icon={FileText} title="No report yet" body="Reports arrive when agents start working. Agents do not execute yet, so nobody has written one for this mission." />;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <FileText size={16} className="info" /><b>Lead synthesized report</b>{isApi() && <DemoTag title="Sample report from the prototype (DEMO mission)." />}
        <select className="select" style={{ width: 150, height: 30 }} value={rev} onChange={(e) => setRev(e.target.value)} aria-label="Report revision"><option value="r3">Revision 3 (latest)</option><option value="r2">Revision 2</option><option value="r1">Revision 1</option></select>
        <span className="spacer" />
        <button className="btn sm" onClick={() => downloadBlob(`${m.id}-report-${rev}.md`, md, 'text/markdown')}><FileDown size={14} />Markdown</button>
        <button className="btn sm" onClick={() => downloadBlob(`${m.id}-report-${rev}.json`, JSON.stringify({ mission: m.id, revision: rev, claims }, null, 2))}><FileJson size={14} />JSON</button>
        <button className="btn sm" onClick={() => { toast({ tone: 'info', title: 'Print to PDF', body: 'Use the browser print dialog → Save as PDF.' }); window.setTimeout(() => window.print(), 300); }}><FileDown size={14} />PDF</button>
      </div>
      <div className="report-doc">
        <div className="row" style={{ gap: 10 }}><RobotAvatar role={lead?.role ?? 'manager'} size={40} faceMode="face" /><div><b>{lead?.name}</b> → {ownerName} (Owner)<div className="dim" style={{ fontSize: 12 }}>Executive result · {rev} · {ago(m.summaryAgoMin)}</div></div>
          <span className="spacer" /><div className={cx('qa-verdict', m.status === 'completed' ? 'pass' : m.status === 'failed' ? 'fail' : 'pending')}><ShieldCheck size={16} />QA {m.status === 'completed' ? 'PASS' : m.status === 'failed' ? 'FAIL' : 'PENDING'}</div></div>
        <div className="divider" />
        <ol className="claims">
          {claims.map((c, i) => (
            <motion.li key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * .08 }}>
              <span>{c.t}</span>
              <span className="row wrap" style={{ gap: 4, marginTop: 4 }}>{c.ev.map((e) => <Tip key={e} label="Trace this claim to its evidence"><button className="chip sm" style={{ ['--h' as string]: 190, cursor: 'pointer' }} onClick={() => toast({ tone: 'info', title: `Evidence ${e}`, body: 'Linked event/task opened in Timeline (demo).' })}>⛓ {e}</button></Tip>)}</span>
            </motion.li>
          ))}
        </ol>
        <div className="divider" />
        <div className="section-label" style={{ marginBottom: 6 }}>Agent → manager deliveries</div>
        {mc.nodes.filter((n) => n.parent && AGENT_BY_ID[n.agentId]).map((n) => (
          <div key={n.instanceId} className="list-row">
            <RobotAvatar role={AGENT_BY_ID[n.agentId].role} size={26} /><span className="ellipsis grow" style={{ fontSize: 12.5 }}><b>{AGENT_BY_ID[n.agentId].name}</b> → {AGENT_BY_ID[mc.nodes.find((x) => x.instanceId === n.parent)?.agentId ?? '']?.name ?? 'its manager'}: “{n.task}”</span>
            <InstanceStateChip state={n.state} size="sm" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TimelineTab({ m }: { m: Mission }) {
  const mc = getMissionControl(m);
  const [type, setType] = useState<TimelineEvent['type'] | 'all'>('all');
  const [actor, setActor] = useState('all');
  const evs = mc.timeline.filter((e) => (type === 'all' || e.type === type) && (actor === 'all' || e.actor === actor));
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <History size={16} className="info" /><b>Immutable timeline</b><span className="dim" style={{ fontSize: 12 }}>{evs.length} events</span>
        <span className="spacer" /><Filter size={14} className="dim" />
        <select className="select" style={{ width: 130, height: 30 }} value={type} onChange={(e) => setType(e.target.value as TimelineEvent['type'] | 'all')} aria-label="Filter by type">
          <option value="all">All types</option>{['create', 'delegate', 'browser', 'model', 'message', 'artifact', 'verify', 'report', 'approval'].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="select" style={{ width: 150, height: 30 }} value={actor} onChange={(e) => setActor(e.target.value)} aria-label="Filter by actor">
          <option value="all">All actors</option>{Array.from(new Set(mc.timeline.map((e) => e.actor))).map((a) => <option key={a} value={a}>{AGENT_BY_ID[a]?.name ?? 'Luca (Owner)'}</option>)}
        </select>
        <button className="btn sm" onClick={() => downloadBlob(`${m.id}-timeline.json`, JSON.stringify(evs, null, 2))}><Download size={14} />Export</button>
      </div>
      <div className="timeline">
        {evs.length === 0 && (mc.timeline.length === 0 && stage8(m)
          ? <EmptyState icon={History} title="No timeline yet" body="The timeline of a real mission arrives in Stage 8, when agents execute. Conversations and the hierarchy are live now." />
          : <EmptyState icon={Filter} title="No events match" body="Clear the filters to see the full log." />)}
        {evs.map((e, i) => (
          <motion.div key={e.id} className="tl-item" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 15) * .025 }}>
            <span className="tl-time mono">{clock(e.agoMin)}</span>
            <span className="tl-node"><EventIcon type={e.type} /></span>
            <div className="tl-body">
              <div className="row" style={{ gap: 6 }}>{AGENT_BY_ID[e.actor] ? <RobotAvatar role={AGENT_BY_ID[e.actor].role} size={20} /> : <span className="human-av" style={{ width: 20, height: 20, fontSize: 8 }}>LU</span>}<span>{e.text}</span></div>
              <div className="row dim" style={{ gap: 10, fontSize: 11 }}><span>{ago(e.agoMin)}</span><span className="mono">{e.trace}</span><span style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>{e.type}</span></div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
