import { AnimatePresence, motion } from 'motion/react';
import { isApi } from '@/api/mode';
import { useMe, isAdmin } from '@/store/auth';
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Pencil, Trash2, Play, Pause, Square, RotateCcw, LayoutTemplate, Paperclip, Bot, GitBranch, ListChecks, Info,
  Image as ImageIcon, FileText, X, Check, ChevronRight, ShieldCheck, Users, AlertTriangle, Archive, Upload, MessageSquare, Send, Copy, Tags, Layers } from 'lucide-react';
import type { DialogComponentProps } from '@/dialogs/DialogHost';
import { Modal } from '@/components/ui/Modal';
import { Field, Segmented } from '@/components/ui/Form';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Chip, MissionStatusChip, InstanceStateChip, TaskStateChip, RoleChip } from '@/components/ui/Chips';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { useData, useMission, attachMissionFiles } from '@/store/data';
import { toast, openDialog } from '@/store/ui';
import { AGENTS, AGENT_BY_ID } from '@/data/agents';
import { getMissionControl } from '@/data/missionControl';
import { useMissionControl, sendMissionMessage, taskAction } from '@/api/missionControl';
import { useFailureTags } from '@/api/failures';
import { useTaskReviews } from '@/api/taskReviews';
import { ReviewAction, ReviewList } from '@/features/review/TaskReviews';
import { TaskForecast } from '@/features/review/TaskForecast';
import { ROLES } from '@/data/roles';
import type { Mission, Attachment } from '@/data/types';
import { KIND_META } from '@/features/mission/MissionBits';
import { ago, clock, cx } from '@/lib/format';
import '@/theme/pages/missions.css';
import { Messenger } from '@/features/mission/Messenger';
import '@/theme/pages/c72-skills.css';
import { DelegationBriefCard, NoBrief, TIER_HUE } from '@/features/mission/DelegationBriefCard';
import { useDelegationBriefs } from '@/api/delegationBriefs';
import { TASK_CLASS_IDS, TASK_CLASSES, DIFFICULTY_LEVELS, DIFFICULTY_LABELS, type DelegationBriefDto } from '@contracts';

/* ------------------------------------------------------------------ */
/* Shared: attachment drop zone (image/text/file) — DL-09               */
/* ------------------------------------------------------------------ */
import { filesFrom, type LocalFile } from '@/features/mission/files';
export { filesFrom, type LocalFile };
export function DropZone({ files, setFiles, compact }: { files: LocalFile[]; setFiles: (f: LocalFile[]) => void; compact?: boolean }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div
        className={cx('dropzone', over && 'over', compact && 'compact')}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); setFiles([...files, ...filesFrom(e.dataTransfer.files)]); }}
        onPaste={(e) => { if (e.clipboardData.files.length) setFiles([...files, ...filesFrom(e.clipboardData.files)]); }}
        tabIndex={0}
        role="button"
        aria-label="Attach files: drop, paste or browse"
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') input.current?.click(); }}
        onClick={() => input.current?.click()}
      >
        <Upload size={compact ? 18 : 26} className="info" />
        <div><b>Drop images, documents or data</b><div className="dim" style={{ fontSize: 12 }}>or click to browse · paste a screenshot (Ctrl V)</div></div>
        <input ref={input} type="file" multiple hidden onChange={(e) => { if (e.target.files) setFiles([...files, ...filesFrom(e.target.files)]); e.target.value = ''; }} />
      </div>
      <AnimatePresence>
        {files.length > 0 && (
          <motion.div className="thumbs" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            {files.map((f) => (
              <motion.div key={f.id} className="thumb" layout initial={{ scale: .6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: .6, opacity: 0 }}>
                {f.url ? <img src={f.url} alt={f.name} /> : <FileText size={22} className="info" />}
                <span className="ellipsis" title={f.name}>{f.name}</span>
                <span className="dim" style={{ fontSize: 10 }}>{(f.size / 1024).toFixed(0)} KB</span>
                <button className="thumb-x" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x.id !== f.id))}><X size={11} /></button>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* DL-01 Create Mission — four-step wizard                              */
/* ------------------------------------------------------------------ */
const TEMPLATES: { key: string; kind: Mission['kind']; title: string; objective: string; criteria: string[] }[] = [
  { key: 'site', kind: 'website', title: 'Update website section', objective: 'Update the selected website pages with the new content and design system; deliver a preview for review.', criteria: ['Preview deployed to sandbox', 'Visual regression passes', 'Owner approves publish'] },
  { key: 'train', kind: 'training', title: 'Train an agent on a skill', objective: 'Improve the selected agent on a measurable skill using mentor exercises and a fresh evaluation set.', criteria: ['Pass-rate improves ≥ 5pp (n ≥ 50)', 'No security regressions', 'Mentor sign-off'] },
  { key: 'struct', kind: 'structure', title: 'Restructure homepage / org', objective: 'Propose a new structure with a before/after diff and simulation; apply only after approval.', criteria: ['Diff reviewed', 'Simulation shows no gaps', 'Owner approval'] },
  { key: 'self', kind: 'self-update', title: 'Improve this dashboard (self-update)', objective: 'Agents propose a reviewed source patch with tests, preview and rollback plan.', criteria: ['All test suites pass', 'Independent QA pass', 'Owner approves merge and release separately'] },
  { key: 'research', kind: 'research', title: 'Research report', objective: 'Research the topic with cited sources and deliver a report with recommendations.', criteria: ['Every claim cited', '≥ 3 sources per section', 'Executive summary approved'] },
];

function MissionEdit({ close, props }: DialogComponentProps<{ missionId: string }>) {
  const m = useMission(props.missionId);
  const update = useData((s) => s.updateMission);
  const [title, setTitle] = useState(m?.title ?? '');
  const [objective, setObjective] = useState(m?.content?.text || m?.objective || '');
  const [why, setWhy] = useState('');
  const [scope, setScope] = useState<'future' | 'all'>('future');
  // review I2: the version this dialog was opened on travels with the save, so someone else's edit is never overwritten silently
  const [openedAt] = useState(m?.rowVersion);
  if (!m) return <Missing close={close} />;
  const running = ['running', 'verifying', 'planning'].includes(m.status);
  const changed = title !== m.title || objective !== (m.content?.text || m.objective);
  const save = () => {
    if (!title.trim()) return;
    update(m.id, { title: title.trim(), objective, content: { ...(m.content ?? { files: [] }), text: objective }, revision: m.revision + 1, lastEvent: `Content revised to rev ${m.revision + 1}`, lastEventAgoMin: 0, ...(isApi() ? { rowVersion: openedAt } : {}) });
    toast({ tone: 'success', title: isApi() ? `Saving revision ${m.revision + 1}…` : `Saved revision ${m.revision + 1}`, body: running ? (scope === 'future' ? 'Applies to future tasks; running tasks keep their terms.' : 'Queued for all non-started tasks.') : undefined });
    close();
  };
  return (
    <Modal title="Edit mission" icon={Pencil} dialogId="DL-02" help="mission.revision" onClose={close} sub={`${m.id} · current revision ${m.revision}`}
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={!changed || !title.trim()} onClick={save}>Save Revision</button></>}>
      <Field label="Title" required error={!title.trim() ? 'Title is required' : ''}><input className="input" data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Content" help="mission.content"><textarea className="textarea" rows={6} value={objective} onChange={(e) => setObjective(e.target.value)} /></Field>
      <Field label="Change explanation" hint="Recorded in the audit log and shown to the lead agent."><input className="input" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why are you changing this?" /></Field>
      {running && (
        <div className="callout warn"><Info size={16} /><div><b>This mission is running.</b> Editing creates revision {m.revision + 1}. Running tasks are never silently rewritten.
          <div style={{ marginTop: 8 }}><Segmented ariaLabel="Apply revision to" size="sm" value={scope} onChange={setScope} options={[{ key: 'future', label: 'Apply to future tasks' }, { key: 'all', label: 'All non-started tasks' }]} /></div></div></div>
      )}
      {changed && (
        <div className="diff-mini">
          <div className="section-label">Revision preview</div>
          {title !== m.title && <><div className="diff-del">− {m.title}</div><div className="diff-add">+ {title}</div></>}
          {objective !== (m.content?.text || m.objective) && <><div className="diff-del clamp-2">− {m.content?.text || m.objective}</div><div className="diff-add clamp-2">+ {objective}</div></>}
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* DL-03 Delete / Archive                                               */
/* ------------------------------------------------------------------ */
function MissionDelete({ close, props }: DialogComponentProps<{ missionId: string }>) {
  const m = useMission(props.missionId);
  useMissionControl(props.missionId); // api mode: fetch and follow this mission's server data
  const archive = useData((s) => s.archiveMission);
  const purge = useData((s) => s.purgeMission);
  const [mode, setMode] = useState<'archive' | 'purge'>(m?.status === 'archived' ? 'purge' : 'archive');
  const [typed, setTyped] = useState('');
  if (!m) return <Missing close={close} />;
  const mc = getMissionControl(m);
  const versions = mc.artifacts.reduce((s, a) => s + a.versions.length, 0);
  const ok = mode === 'archive' || typed.trim() === m.id;
  const run = () => {
    if (mode === 'archive') { archive(m.id); toast({ tone: 'success', title: `${m.id} archived`, body: isApi() && !['completed', 'canceled', 'failed'].includes(m.status) ? 'It was canceled first, then archived. Restore brings it back as canceled.' : 'Restore it from the Archived tab.', action: { label: 'Undo', run: () => useData.getState().restoreMission(m.id) } }); }
    else { purge(m.id); toast({ tone: 'warning', title: isApi() ? `${m.id} deleted` : `Purge requested for ${m.id}`, body: isApi() ? 'Removed for everyone. The server keeps the record and its audit trail.' : 'DEMO: removed from this session. In production this needs Owner re-auth and a retention check.' }); }
    close();
  };
  return (
    <Modal title={mode === 'archive' ? 'Archive mission' : 'Request permanent purge'} icon={mode === 'archive' ? Archive : Trash2} tone="danger" size="md" dialogId="DL-03" help="mission.delete" onClose={close}
      sub={<>{m.title} · <span className="mono">{m.id}</span></>}
      footer={<><button className="btn" data-autofocus onClick={close}>Cancel</button><button className={mode === 'archive' ? 'btn danger' : 'btn solid-danger'} disabled={!ok} onClick={run}>{mode === 'archive' ? 'Archive' : 'Request Purge'}</button></>}>
      <Segmented ariaLabel="Delete mode" value={mode} onChange={setMode} options={[{ key: 'archive', label: 'Archive (recoverable)' }, { key: 'purge', label: 'Purge (Owner only)' }]} />
      <div className="grid g-3">
        {[['Runs', m.revision], ['Artifacts', mc.artifacts.length], ['Versions', versions]].map(([k, v]) => <div key={k} className="subpanel" style={{ textAlign: 'center' }}><div className="display" style={{ fontSize: 22, fontWeight: 800 }}>{v}</div><div className="dim" style={{ fontSize: 12 }}>{k} affected</div></div>)}
      </div>
      {mode === 'archive'
        ? <div className="callout"><Info size={16} /><div>Archiving stops nothing that is mid-action: running tasks finish at a safe boundary first. History, conversations and all {versions} result versions stay downloadable until the retention date.</div></div>
        : <>
          <div className="callout bad"><AlertTriangle size={16} /><div>Purge permanently deletes conversations, screenshots and {versions} artifact versions after the retention check. This cannot be undone.</div></div>
          <Field label={`Type ${m.id} to confirm`}><input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={m.id} aria-label="Type mission id to confirm" /></Field>
        </>}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* DL-04 … DL-07 lifecycle controls                                     */
/* ------------------------------------------------------------------ */
function Lifecycle({ close, props, kind }: DialogComponentProps<{ missionId: string }> & { kind: 'start' | 'pause' | 'stop' | 'retry' }) {
  const m = useMission(props.missionId);
  useMissionControl(props.missionId); // api mode: fetch and follow this mission's server data
  const setStatus = useData((s) => s.setMissionStatus);
  const [reason, setReason] = useState('');
  if (!m) return <Missing close={close} />;
  const cfg = {
    start: { title: m.status === 'draft' ? 'Start mission' : 'Resume mission', icon: Play, id: 'DL-04', btn: m.status === 'draft' ? 'Start' : 'Resume', next: (m.status === 'draft' ? 'planning' : 'running') as Mission['status'], tone: 'default' as const },
    pause: { title: 'Pause mission', icon: Pause, id: 'DL-05', btn: 'Pause', next: 'paused' as Mission['status'], tone: 'warn' as const },
    stop: { title: 'Stop mission', icon: Square, id: 'DL-06', btn: 'Stop at Safe Boundary', next: 'paused' as Mission['status'], tone: 'danger' as const },
    retry: { title: 'Retry from checkpoint', icon: RotateCcw, id: 'DL-07', btn: 'Retry from Checkpoint', next: 'running' as Mission['status'], tone: 'default' as const },
  }[kind];
  const mc = getMissionControl(m);
  const go = () => {
    setStatus(m.id, cfg.next);
    toast({ tone: kind === 'stop' ? 'warning' : 'success', title: `${cfg.btn}: ${m.id}`, body: kind === 'pause' ? 'Browsers pause before their next action; nothing is replayed on resume.' : kind === 'start' ? 'Pinned agents and grants snapshot recorded.' : kind === 'retry' ? 'Restarting from the last verified checkpoint. Submits are never auto-replayed.' : 'In-flight actions finish safely; downstream tasks are canceled.' });
    close();
  };
  return (
    <Modal title={cfg.title} icon={cfg.icon} tone={cfg.tone} dialogId={cfg.id} help="mission.lifecycle" onClose={close} sub={`${m.title} · ${m.id}`}
      footer={<><button className="btn" data-autofocus={kind === 'stop' || undefined} onClick={close}>Cancel</button>{kind === 'start' && <button className="btn ghost" onClick={() => openDialog('mission-policy', { missionId: m.id })}>Review Policy</button>}<button className={kind === 'stop' ? 'btn solid-danger' : 'btn primary'} onClick={go}>{cfg.btn}</button></>}>
      {kind === 'start' && (
        <div className="col" style={{ gap: 8 }}>
          <div className="section-label">Effective terms (revision {m.revision})</div>
          {m.criteria.map((c) => <div key={c.text} className="row" style={{ gap: 6, fontSize: 13 }}><Check size={14} className="good" />{c.text}</div>)}
          <div className="divider" />
          <div className="row wrap" style={{ gap: 6 }}>{m.agentIds.map((id) => <Chip key={id} hue={ROLES[AGENT_BY_ID[id]?.role ?? 'dev'].hue} size="sm">{AGENT_BY_ID[id]?.name} {AGENT_BY_ID[id]?.version}</Chip>)}</div>
          <div className="row" style={{ gap: 10, fontSize: 12.5 }}><Users size={14} />{m.agentIds.length} agents<ShieldCheck size={14} className="good" />Mode: prepare + gated execute</div>
        </div>
      )}
      {(kind === 'pause' || kind === 'stop') && (
        <>
          <div className="callout warn"><Info size={16} /><div>{mc.nodes.filter((n) => n.state === 'working').length} agents are working. {kind === 'pause' ? 'They stop before their next action and keep state. Browser sessions are paused, not closed.' : 'In-flight actions finish at a safe boundary; child jobs are canceled; data is retained.'}</div></div>
          <Field label="Reason (optional, audited)"><input className="input" data-autofocus={kind === 'pause' || undefined} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. reprioritizing work" /></Field>
        </>
      )}
      {kind === 'retry' && (
        <div className="col" style={{ gap: 8, fontSize: 13 }}>
          <div className="kv" style={{ gridTemplateColumns: 'auto 1fr' }}>
            <dt>Attempt</dt><dd>#{m.revision + 1}</dd><dt>Last failure</dt><dd>{m.status === 'failed' ? m.lastEvent : 'none'}</dd><dt>Checkpoint</dt><dd>{m.phases.filter((p) => p.state === 'done').slice(-1)[0]?.label ?? 'Start'}</dd>
          </div>
          <div className="callout"><ShieldCheck size={16} /><div>Safe retry: idempotent steps only. Form submissions and publishes are never auto-replayed — they will ask for approval again.</div></div>
        </div>
      )}
    </Modal>
  );
}

function MissionPolicy({ close, props }: DialogComponentProps<{ missionId: string }>) {
  const m = useMission(props.missionId);
  if (!m) return <Missing close={close} />;
  return (
    <Modal title="Effective policy" icon={ShieldCheck} dialogId="DL-04b" onClose={close} sub={m.id} footer={<button className="btn primary" onClick={close}>Close</button>}>
      {[['Website origins', 'www.example.com (read, prepare)'], ['Consequential actions', 'Require Owner approval, bound to action digest, 15 min expiry'], ['Models', 'claude-opus-5-5 (planning), claude-sonnet-5-5 (execution), local fallback'], ['Experience merge', 'Every 15 min into the original agent'], ['Data retention', '30 days, then purge'], ['Self-modification', 'Proposals only; no live source changes']].map(([k, v]) => (
        <div key={k} className="row" style={{ justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border-soft)' }}><span className="muted">{k}</span><b style={{ textAlign: 'right' }}>{v}</b></div>
      ))}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* DL-08 Templates · DL-09 Attach · DL-10 AI summary sources            */
/* ------------------------------------------------------------------ */
function TemplatePicker({ close }: DialogComponentProps) {
  return (
    <Modal title="Mission templates" icon={LayoutTemplate} dialogId="DL-08" size="lg" onClose={close} footer={<button className="btn" onClick={close}>Back</button>}>
      <div className="grid g-2">
        {TEMPLATES.map((t, i) => {
          const K = KIND_META[t.kind];
          return (
            <motion.button key={t.key} className="glass-card hoverable" style={{ padding: 14, textAlign: 'left', color: 'var(--text)' }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .05 }}
              onClick={() => { close(); openDialog('mission-create', { text: t.objective }); }}>
              <div className="row" style={{ gap: 8 }}><K.icon size={18} style={{ color: `hsl(${K.hue} 90% 65%)` }} /><b>{t.title}</b></div>
              <p className="muted" style={{ fontSize: 12.5, margin: '6px 0' }}>{t.objective}</p>
              <div className="row wrap" style={{ gap: 4 }}>{t.criteria.map((c) => <Chip key={c} hue={K.hue} size="sm">{c}</Chip>)}</div>
            </motion.button>
          );
        })}
      </div>
    </Modal>
  );
}

function AttachDialog({ close, props }: DialogComponentProps<{ missionId: string }>) {
  const m = useMission(props.missionId);
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!m) return <Missing close={close} />;
  const tooMany = m.content.files.length + files.length > 10;
  const attach = async () => {
    if (busy || tooMany || !files.length || m.rowVersion === undefined) return;
    setBusy(true);
    setError('');
    try {
      await attachMissionFiles(m.id, files, m.rowVersion);
      toast({ tone: 'success', title: `Added ${files.length} file(s) to ${m.id}` });
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not attach the selected files.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Attach source, image or file" icon={Paperclip} dialogId="DL-09" onClose={busy ? () => undefined : close}
      footer={<><button className="btn" onClick={close} disabled={busy}>Cancel</button><button className="btn primary" disabled={busy || !files.length || tooMany} onClick={attach}>{busy ? 'Attaching…' : 'Attach'}</button></>}>
      <fieldset disabled={busy} style={{ margin: 0, padding: 0, border: 0 }}><DropZone files={files} setFiles={setFiles} /></fieldset>
      {(error || tooMany) && <p className="bad" role="alert">{error || 'A mission can have up to 10 attached files.'}</p>}
    </Modal>
  );
}

function MissionSummary({ close, props }: DialogComponentProps<{ missionId: string }>) {
  const m = useMission(props.missionId);
  if (!m) return <Missing close={close} />;
  return (
    <Modal title="Mission summary" icon={FileText} help="mission.aiSummary" dialogId="DL-10" onClose={close} sub={m.id}
      footer={<button className="btn" onClick={close}>Close</button>}>
      <p style={{ lineHeight: 1.6 }}>{m.summary || 'No summary has been recorded.'}</p>
      <dl className="kv"><dt>Status</dt><dd><MissionStatusChip status={m.status} /></dd><dt>Revision</dt><dd>{m.revision}</dd>
        <dt>Last event</dt><dd>{m.lastEvent || 'No events recorded.'}{m.lastEvent && ` · ${ago(m.lastEventAgoMin)}`}</dd></dl>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* DL-11 Agent inspector · DL-12 Reassign · DL-13 Task criteria         */
/* ------------------------------------------------------------------ */
function AgentInspector({ close, props }: DialogComponentProps<{ missionId: string; agentId: string; onOpenChat?: () => void }>) {
  const m = useMission(props.missionId);
  useMissionControl(props.missionId); // api mode: fetch and follow this mission's server data
  const nav = useNavigate();
  const a = AGENT_BY_ID[props.agentId];
  if (!m || !a) return <Missing close={close} />;
  const mc = getMissionControl(m);
  const n = mc.nodes.find((x) => x.agentId === a.id);
  const sup = n?.parent ? mc.nodes.find((x) => x.instanceId === n.parent) : undefined;
  return (
    <Modal title={`${a.name} · instance`} icon={Bot} help="agent.instance" dialogId="DL-11" onClose={close} drawer
      footer={<><button className="btn" onClick={close}>Close</button><button className="btn primary" onClick={() => { close(); props.onOpenChat ? props.onOpenChat() : nav(`/missions/${m.id}?tab=conversations&agent=${a.id}`); }}><MessageSquare size={15} />Open Conversation</button></>}>
      <div className="row-3"><RobotAvatar role={a.role} size={84} faceMode="face" animated /><div className="col" style={{ gap: 4 }}><b style={{ fontSize: 18 }}>{a.name}</b><RoleChip role={a.role} />{n && <InstanceStateChip state={n.state} />}</div></div>
      <dl className="kv">
        <dt>Instance</dt><dd className="mono">{n?.instanceId}</dd>
        <dt>Pinned version</dt><dd>{a.version}</dd>
        <dt>Superior</dt><dd>{sup ? AGENT_BY_ID[sup.agentId]?.name : 'Owner'}</dd>
        <dt>Current task</dt><dd>{n?.task}</dd>
        <dt>Tasks / pending</dt><dd>{n?.tasks} / {n?.pending}</dd>
        <dt>Model</dt><dd className="mono">{a.model}</dd>
        <dt>Grants</dt><dd>mission-scoped · www.example.com</dd>
      </dl>
      <div className="bar"><i style={{ width: `${n?.progress ?? 0}%` }} /></div>
    </Modal>
  );
}

function TaskReassign({ close, props }: DialogComponentProps<{ missionId: string; taskId?: string; agentId?: string }>) {
  const m = useMission(props.missionId);
  useMissionControl(props.missionId); // api mode: fetch and follow this mission's server data
  const [to, setTo] = useState('');
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [goal, setGoal] = useState('');
  const [accept, setAccept] = useState('');
  const [caps, setCaps] = useState<string[]>(['read']);
  const [deadline, setDeadline] = useState('');
  const [esc, setEsc] = useState('Ask the mission owner when scope is unclear');
  const [fe, setFe] = useState<Record<string, string>>({});
  const [taskClass, setTaskClass] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const kinds = useDelegationBriefs(props.missionId).data?.kinds;
  if (!m) return <Missing close={close} />;
  const tasks = getMissionControl(m).tasks;
  const taskId = props.taskId ?? tasks.find((t) => t.state !== 'passed')?.id ?? tasks[0]?.id;
  const task = tasks.find((t) => t.id === taskId);
  const criteria = accept.split('\n').map((x) => x.trim()).filter(Boolean);
  // api mode (c51): the reassignment always carries a typed brief, so at least one acceptance criterion is required (the server answers 400 BRIEF_REQUIRED otherwise)
  // api mode: only agents that joined this mission can take a task (the server decides; a stranger is 422)
  const joined = isApi() ? new Set(getMissionControl(m).nodes.map((n) => n.agentId)) : null;
  const candidates = AGENTS.filter((a) => a.id !== task?.owner && a.id !== 'gm' && (!joined || joined.has(a.id))).slice(0, 14);
  const submit = async () => {
    if (!isApi()) { toast({ tone: 'success', title: 'Reassignment submitted', body: `${AGENT_BY_ID[to]?.name} will receive it after privilege checks. Audited.` }); close(); return; }
    if (!task || busy) return;
    setBusy(true);
    const node = getMissionControl(m).nodes.find((n) => n.agentId === to);
    const brief = { goal: goal.trim() || task.title, acceptance: criteria, capabilities: (kinds ?? []).filter((k) => k.allowed && caps.includes(k.kind)).map((k) => ({ kind: k.kind })), escalation: esc.trim() || 'Ask the mission owner when scope is unclear', ...(deadline ? { deadline: new Date(deadline).toISOString() } : {}), ...(taskClass ? { taskClass } : {}), ...(difficulty ? { difficulty: Number(difficulty) } : {}) };
    const r = node ? await taskAction(m.id, task.id, 'reassign', { toInstanceId: node.instanceId, reason: why.trim(), brief }) : { ok: false as const, message: 'This agent has not joined the mission.' };
    setBusy(false);
    setFe(!r.ok && r.fieldErrors ? r.fieldErrors : {});
    if (r.ok) { toast({ tone: 'success', title: 'Task reassigned', body: `${AGENT_BY_ID[to]?.name} owns ${task.id} now. Audited.` }); close(); }
    else toast({ tone: 'error', title: 'Not reassigned', body: r.message });
  };
  return (
    <Modal title="Delegate / reassign task" icon={GitBranch} dialogId="DL-12" help="hierarchy.delegation" onClose={close} sub={task ? `${task.id} · ${task.title}` : m.id}
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={!to || !why.trim() || busy || (isApi() && criteria.length === 0)} title={isApi() && criteria.length === 0 ? 'Add at least one acceptance criterion to the hand-off brief' : undefined} onClick={() => void submit()}>Submit Reassignment</button></>}>
      <Field label="Assign to" required>
        <div className="pick-grid">
          {candidates.map((a) => (
            <button key={a.id} className={cx('team-pick', to === a.id && 'on')} onClick={() => setTo(a.id)} aria-pressed={to === a.id}>
              <RobotAvatar role={a.role} size={28} /><span>{a.name}</span><span className="dim" style={{ fontSize: 11 }}>{a.load}%</span>
            </button>
          ))}
        </div>
      </Field>
      <Field label="Reason" required><input className="input" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. needs browser specialist" /></Field>
      {isApi() && (
        <div className="dbrief-form" data-testid="brief-form">
          <div className="row" style={{ gap: 6 }}><span className="section-label">Hand-off brief</span><HelpTrigger k="delegation.brief" /></div>
          <input className="input" aria-label="Goal" aria-invalid={!!fe.goal} maxLength={500} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={task ? `Goal (default: ${task.title})` : 'Goal'} />
          <textarea className="input" aria-label="Acceptance criteria" aria-invalid={!!(fe.acceptance || Object.keys(fe).some((k) => k.startsWith('acceptance.')))} maxLength={3000} value={accept} onChange={(e) => setAccept(e.target.value)} placeholder="Acceptance criteria, one per line (required)." />
          <div className="dbrief-hint">Required: at least one line. Each line 3 to 300 characters, at most 20 lines.</div>
          {Object.entries(fe).filter(([k]) => k === 'goal' || k.startsWith('acceptance') || k === 'escalation' || k === 'deadline' || k === 'capabilities' || k === 'budget' || k === 'depth' || k === 'taskClass' || k === 'difficulty').map(([k, v]) => <div key={k} className="dbrief-err" role="alert">{k.replace(/\.\d+$/, '')}: {v}</div>)}
          <div className="dbrief-pick" role="group" aria-label="Allowed capabilities">
            {(kinds ?? []).filter((k) => k.tier === 'R0' || k.tier === 'R1' || k.tier === 'R2').map((k) => (
              <button key={k.kind} type="button" disabled={!k.allowed} aria-pressed={caps.includes(k.kind)} title={`${k.why} (${k.tier})`} onClick={() => setCaps((c) => (c.includes(k.kind) ? c.filter((x) => x !== k.kind) : [...c, k.kind]))}>
                <Chip hue={TIER_HUE[k.tier]} size="sm">{k.kind} · {k.tier}</Chip>
              </button>
            ))}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <input className="input" type="datetime-local" aria-label="Deadline" value={deadline} onChange={(e) => setDeadline(e.target.value)} style={{ maxWidth: 210 }} />
            <input className="input" aria-label="Escalation" maxLength={300} aria-invalid={!!fe.escalation} value={esc} onChange={(e) => setEsc(e.target.value)} />
          </div>
          <div className="row dbrief-class" style={{ gap: 8 }} data-testid="brief-class">
            <Layers size={14} aria-hidden className="dim" />
            <select className="select" aria-label="Task class" aria-invalid={!!fe.taskClass} value={taskClass} onChange={(e) => setTaskClass(e.target.value)}>
              <option value="">Task class (optional)</option>
              {TASK_CLASS_IDS.map((c) => <option key={c} value={c}>{TASK_CLASSES[c]}</option>)}
            </select>
            <select className="select" aria-label="Difficulty" aria-invalid={!!fe.difficulty} value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              <option value="">Difficulty (optional)</option>
              {DIFFICULTY_LEVELS.map((d) => <option key={d} value={d}>{d} · {DIFFICULTY_LABELS[d]}</option>)}
            </select>
            <HelpTrigger k="delegation.taskClass" />
          </div>
        </div>
      )}
      {to && <div className="callout"><Info size={16} /><div>{AGENT_BY_ID[to].name} has load {AGENT_BY_ID[to].load}%. Subtasks of {task?.id} move with it; evidence stays attached.</div></div>}
    </Modal>
  );
}

function TaskCriteria({ close, props }: DialogComponentProps<{ missionId: string; taskId: string }>) {
  const m = useMission(props.missionId);
  const [busy, setBusy] = useState(false);
  useMissionControl(props.missionId); // api mode: fetch and follow this mission's server data
  const tagInfo = useFailureTags('task', props.taskId).data?.subject; // cycle 33: the server knows whether the task was retried (a retried task is no longer 'failed')
  const rv = useTaskReviews(isApi() ? props.taskId : undefined); // cycle 38: the independent reviews of this task
  const bq = useDelegationBriefs(props.missionId);
  const me = useMe();
  if (!m) return <Missing close={close} />;
  // c51 fix F1: reassigning writes a root brief, which only an administrator or the mission owner may do (the server answers 403 otherwise)
  const canReassign = !isApi() || (!!me && (isAdmin(me) || me.id === m.ownerId));
  const t = getMissionControl(m).tasks.find((x) => x.id === props.taskId);
  if (!t) return <Missing close={close} />;
  const owner = AGENT_BY_ID[t.owner];
  const mine = bq.data ? ([...bq.data.briefs].reverse().find((b) => b.taskId === t.id) ?? [...bq.data.briefs].reverse().find((b) => b.toInstanceId === `${m.id}:${t.owner}`)) as DelegationBriefDto | undefined : undefined;
  const run = async (action: 'retry' | 'cancel') => {
    if (busy) return;
    setBusy(true);
    const r = await taskAction(m.id, t.id, action);
    setBusy(false);
    if (r.ok) { toast({ tone: action === 'cancel' ? 'warning' : 'success', title: action === 'cancel' ? `${t.id} canceled` : `${t.id} queued for retry`, body: action === 'retry' ? 'The failed attempt is kept in its history.' : 'Audited.' }); close(); }
    else toast({ tone: 'error', title: action === 'cancel' ? 'Not canceled' : 'Not retried', body: r.message });
  };
  const api_ = isApi();
  return (
    <Modal title={t.title} icon={ListChecks} dialogId="DL-13" help="mission.progress.verified" onClose={close} drawer sub={`${t.id} · weight ${t.weight}`}
      footer={<>{api_ && (t.state === 'failed' || tagInfo?.retried) && <button className="btn" data-tag-failure onClick={() => openDialog('failure-tag', { missionId: m.id, taskId: t.id, label: t.title })}><Tags size={15} />Tag failure</button>}{api_ && t.state === 'failed' && <button className="btn" disabled={busy} onClick={() => void run('retry')}><RotateCcw size={15} />Retry</button>}{api_ && t.state !== 'passed' && t.state !== 'canceled' && <button className="btn danger" disabled={busy} onClick={() => void run('cancel')}>Cancel task</button>}<button className="btn" disabled={!canReassign} aria-describedby={canReassign ? undefined : 'reassign-why'} data-testid="reassign-btn" onClick={() => { if (canReassign) openDialog('task-reassign', { missionId: m.id, taskId: t.id }); }}>Reassign</button>{api_ && <ReviewAction missionId={m.id} taskId={t.id} rv={rv} api_={api_} />}</>}>
      <div className="row" style={{ gap: 8 }}><TaskStateChip state={t.state} /><span className="muted" style={{ fontSize: 12.5 }}>Owner</span><RobotAvatar role={owner?.role ?? 'dev'} size={26} /><b>{owner?.name}</b></div>
      {!canReassign && <div id="reassign-why" className="dim" data-testid="reassign-why" style={{ fontSize: 12 }}>Only an administrator or the mission owner can reassign: reassigning writes the task's brief.</div>}
      <div className="section-label">Delegation brief</div>
      {mine && bq.data ? <DelegationBriefCard brief={mine} all={bq.data.briefs} /> : bq.loading ? <span className="dim">Loading…</span> : bq.error ? <span className="dim">{bq.error}</span> : <NoBrief demo={!api_} />}
      <div className="section-label">Expected result</div>
      <p style={{ fontSize: 13 }}>“{t.title}” is complete when its output is attached, tests pass and an independent verifier accepts the evidence.</p>
      <div className="section-label">Dependencies</div>
      <div className="row wrap" style={{ gap: 6 }}>{t.deps.length ? t.deps.map((d) => <Chip key={d} hue={220} size="sm">{d}</Chip>) : <span className="dim">none</span>}</div>
      <div className="section-label">Evidence ({t.evidence})</div>
      {t.evidence ? Array.from({ length: t.evidence }, (_, i) => <div key={i} className="row" style={{ gap: 6, fontSize: 12.5 }}><ImageIcon size={14} className="info" />evidence-{i + 1}.png <span className="dim">· sha256:{(t.id + i).split('').map((c) => c.charCodeAt(0).toString(16)).join('').slice(0, 10)}</span></div>) : <span className="dim">No evidence yet — this task does not count toward verified progress.</span>}
      {api_ && <TaskForecast taskId={t.id} rv={rv} canceled={t.state === 'canceled'} />}
      {api_ ? <ReviewList rv={rv} /> : <><div className="section-label">Verifier</div>
      <div className="row" style={{ gap: 6 }}><RobotAvatar role="qa" size={26} /><span>Tester-01 (independent)</span></div></>}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* DL-16 Message details · DL-17 Send command · DL-18 Reply             */
/* ------------------------------------------------------------------ */
function MessageDetails({ close, props }: DialogComponentProps<{ message: { id: string; from: string; to: string; kind: string; text: string; taskId?: string; agoMin: number; ts?: number; attachments?: Attachment[]; replyTo?: string } }>) {
  const msg = props.message;
  if (!msg) return <Missing close={close} />;
  const name = (id: string) => (id.startsWith('human:') ? 'User · HUMAN' : AGENT_BY_ID[id]?.name ?? id);
  return (
    <Modal title="Message details" icon={Info} dialogId="DL-16" onClose={close}
      footer={<><button className="btn" onClick={() => { navigator.clipboard?.writeText(msg.text); toast({ tone: 'success', title: 'Copied' }); }}><Copy size={14} />Copy</button><button className="btn" onClick={() => { navigator.clipboard?.writeText(msg.id); toast({ tone: 'success', title: 'Trace ID copied' }); }}>Copy trace</button><button className="btn primary" onClick={close}>Close</button></>}>
      <dl className="kv">
        <dt>Author</dt><dd>{name(msg.from)}</dd><dt>Recipient</dt><dd>{name(msg.to)}</dd><dt>Kind</dt><dd style={{ textTransform: 'uppercase' }}>{msg.kind}</dd>
        <dt>Time</dt><dd>{clock(msg.agoMin, msg.ts)}</dd><dt>Task</dt><dd className="mono">{msg.taskId ?? '—'}</dd><dt>Reply to</dt><dd className="mono">{msg.replyTo ?? '—'}</dd><dt>Message ID</dt><dd className="mono">{msg.id}</dd>
      </dl>
      <div className="subpanel" style={{ fontSize: 13.5 }}>{msg.text}</div>
      <div className="dim" style={{ fontSize: 12 }}>Messages are append-only. They cannot be edited or re-attributed.</div>
    </Modal>
  );
}

function SendCommand({ close, props }: DialogComponentProps<{ missionId: string; agentId: string; mode?: 'command' | 'reply'; replyTo?: string; question?: string }>) {
  const m = useMission(props.missionId);
  useMissionControl(props.missionId);
  const me = useMe();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const a = AGENT_BY_ID[props.agentId];
  const isReply = props.mode === 'reply';
  const impact = useMemo(() => (text.match(/publish|deploy|delete|submit|purchase|pay/i) ? 'This instruction mentions a consequential action — it will still require a separate approval.' : 'Within current mission scope. No new grants.'), [text]);
  if (!m || !a) return <Missing close={close} />;
  const go = () => {
    const attachments = files.map((f) => ({ id: f.id, name: f.name, kind: f.type.startsWith('image/') ? 'image' as const : 'file' as const, url: f.url, size: `${(f.size / 1024).toFixed(0)} KB`, blob: f.blob }));
    if (!me || busy) return;
    setBusy(true); setError('');
    void sendMissionMessage(m, a.id, { kind: isReply ? 'reply' : 'command', text: text.trim() || '(attachment)', replyTo: props.replyTo, attachments }, me).then((r) => {
      setBusy(false);
      if (r.ok) {
        toast({ tone: 'success', title: isReply ? 'Reply submitted' : 'Command sent', body: 'Saved to the mission conversation.' });
        close();
      } else if (r.gone) close();
      else setError(r.message);
    });
  };
  return (
    <Modal title={isReply ? 'Reply to agent question' : 'Send command'} icon={isReply ? MessageSquare : Send} dialogId={isReply ? 'DL-18' : 'DL-17'} help={isReply ? 'conversation.reply' : 'conversation.command'} onClose={close} sub={`To ${a.name} · ${m.id}`}
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={busy || (!text.trim() && !files.length)} onClick={go}><Send size={15} />{busy ? 'Sending…' : isReply ? 'Submit Reply' : 'Send Command'}</button></>}>
      {error && <div className="callout bad" role="alert"><AlertTriangle size={16} /><div><b>Not sent.</b> {error}</div></div>}
      {isReply && props.question && <div className="callout warn"><MessageSquare size={16} /><div><b>Question {props.replyTo}</b><div>{props.question}</div></div></div>}
      <Field label={isReply ? 'Your reply' : 'Instruction'} required><textarea className="textarea" rows={4} data-autofocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) go(); }} placeholder={isReply ? 'Answer the question…' : `Tell ${a.name} what to do…`} /></Field>
      <DropZone files={files} setFiles={setFiles} compact />
      <div className="callout"><Info size={16} /><div><b>Impact preview:</b> {impact}</div></div>
    </Modal>
  );
}

function AttachmentPreview({ close, props }: DialogComponentProps<{ attachment: Attachment }>) {
  const at = props.attachment;
  const [failed, setFailed] = useState(false);
  const url = at.url;
  const media = { src: url, onError: () => setFailed(true), style: { maxWidth: '100%', maxHeight: 460 } };
  return (
    <Modal title={at.name} icon={ImageIcon} dialogId="DL-26b" size="lg" onClose={close} sub={[at.kind, at.size].filter(Boolean).join(' · ')}
      footer={<><button className="btn" onClick={close}>Close</button>{url && <a className="btn primary" href={url} download={at.name}>Download</a>}</>}>
      <div className="center" style={{ minHeight: 160, overflow: 'hidden' }}>
        {!failed && url && at.kind === 'image' ? <img {...media} alt={at.name} /> :
          !failed && url && at.kind === 'video' ? <video {...media} controls aria-label={at.name} /> :
          !failed && url && at.kind === 'audio' ? <audio {...media} controls aria-label={at.name} /> :
          <p className="dim">{failed ? 'The preview could not be loaded.' : url ? 'Download this file to open it.' : 'File contents are unavailable.'}</p>}
      </div>
    </Modal>
  );
}

/* DL-14 Thread picker · DL-15 Conversation thread (drawer; used when the inspector pane is not visible) */
function ThreadPicker({ close, props }: DialogComponentProps<{ missionId: string }>) {
  const m = useMission(props.missionId);
  useMissionControl(props.missionId); // api mode: fetch and follow this mission's server data
  if (!m) return <Missing close={close} />;
  const mc = getMissionControl(m);
  return (
    <Modal title="Conversations" icon={MessageSquare} help="hierarchy.delegation" dialogId="DL-14" onClose={close} sub={`${m.id} · pick an agent to read its threads`} footer={<button className="btn" onClick={close}>Close</button>}>
      <div className="col" style={{ gap: 4 }}>
        {mc.nodes.map((n, i) => {
          const a = AGENT_BY_ID[n.agentId];
          const sup = n.parent ? AGENT_BY_ID[mc.nodes.find((x) => x.instanceId === n.parent)!.agentId] : undefined;
          return (
            <motion.button key={n.instanceId} className="list-row" style={{ width: '100%', textAlign: 'left', color: 'var(--text)' }} data-autofocus={i === 0 || undefined}
              initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * .03 }}
              onClick={() => { close(); openDialog('conversation-thread', { missionId: m.id, agentId: a.id }); }}>
              <RobotAvatar role={a.role} size={32} />
              <div className="grow"><b>{a.name}</b><div className="dim" style={{ fontSize: 12 }}>{sup ? `reports to ${sup.name}` : 'mission lead · reports to you'} · {n.task}</div></div>
              <InstanceStateChip state={n.state} size="sm" />
              <ChevronRight size={15} className="dim" />
            </motion.button>
          );
        })}
      </div>
    </Modal>
  );
}

function ConversationThread({ close, props }: DialogComponentProps<{ missionId: string; agentId: string }>) {
  const m = useMission(props.missionId);
  const a = AGENT_BY_ID[props.agentId];
  if (!m || !a) return <Missing close={close} />;
  return (
    <Modal title={`${a.name} · conversations`} icon={MessageSquare} help="conversation.command" dialogId="DL-15" size="lg" drawer onClose={close} sub={`${m.id} · partners → thread · Command / Reply`}>
      <div style={{ height: 'calc(100vh - 170px)', minHeight: 420, margin: '-16px -18px' }}>
        <Messenger mission={m} agentId={a.id} layout="narrow" />
      </div>
    </Modal>
  );
}

function Missing({ close }: { close: () => void }) {
  return <Modal title="Not found" icon={AlertTriangle} onClose={close} footer={<button className="btn" onClick={close}>Close</button>}><p>This item no longer exists (it may have been purged).</p></Modal>;
}

export const dialogs = {
  'mission-edit': MissionEdit,
  'mission-delete': MissionDelete,
  'mission-start': (p: DialogComponentProps<{ missionId: string }>) => <Lifecycle {...p} kind="start" />,
  'mission-pause': (p: DialogComponentProps<{ missionId: string }>) => <Lifecycle {...p} kind="pause" />,
  'mission-stop': (p: DialogComponentProps<{ missionId: string }>) => <Lifecycle {...p} kind="stop" />,
  'mission-retry': (p: DialogComponentProps<{ missionId: string }>) => <Lifecycle {...p} kind="retry" />,
  'mission-policy': MissionPolicy,
  'mission-templates': TemplatePicker,
  'attach-files': AttachDialog,
  'ai-summary': MissionSummary,
  'agent-inspector': AgentInspector,
  'task-reassign': TaskReassign,
  'task-criteria': TaskCriteria,
  'message-details': MessageDetails,
  'send-command': SendCommand,
  'attachment-preview': AttachmentPreview,
  'thread-picker': ThreadPicker,
  'conversation-thread': ConversationThread,
};

void MissionStatusChip;
