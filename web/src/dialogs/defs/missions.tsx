import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Target, Pencil, Trash2, Play, Pause, Square, RotateCcw, LayoutTemplate, Paperclip, Sparkles, Bot, GitBranch, ListChecks, Info,
  Image as ImageIcon, FileText, X, Plus, Check, ChevronRight, ChevronLeft, Globe, ShieldCheck, Wallet, Users, AlertTriangle, Archive, Upload, MessageSquare, Send, Copy,
} from 'lucide-react';
import type { DialogComponentProps } from '@/dialogs/DialogHost';
import { Modal } from '@/components/ui/Modal';
import { Field, Segmented, SwitchRow } from '@/components/ui/Form';
import { Chip, MissionStatusChip, InstanceStateChip, TaskStateChip, RoleChip } from '@/components/ui/Chips';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { useData, useMission } from '@/store/data';
import { toast, openDialog } from '@/store/ui';
import { AGENTS, AGENT_BY_ID } from '@/data/agents';
import { getMissionControl } from '@/data/missions';
import { ROLES } from '@/data/roles';
import type { Mission, Attachment } from '@/data/types';
import { KIND_META } from '@/features/mission/MissionBits';
import { ago, clock, cx, money } from '@/lib/format';
import '@/theme/pages/missions.css';
import { EvidenceThumb } from '@/features/mission/EvidenceThumb';
import { Messenger } from '@/features/mission/Messenger';

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
        <div><b>Drop images, documents or data</b><div className="dim" style={{ fontSize: 12 }}>or click to browse · paste a screenshot (Ctrl V) · image text can be extracted (OCR opt-in)</div></div>
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

function MissionCreate({ close, props }: DialogComponentProps<{ cloneFrom?: string; template?: string }>) {
  const nav = useNavigate();
  const add = useData((s) => s.addMission);
  const clone = useMission(props.cloneFrom);
  const tpl = TEMPLATES.find((t) => t.key === props.template);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [title, setTitle] = useState(clone ? `${clone.title} (copy)` : tpl?.title ?? '');
  const [objective, setObjective] = useState(clone?.objective ?? tpl?.objective ?? '');
  const [kind, setKind] = useState<Mission['kind']>(clone?.kind ?? tpl?.kind ?? 'website');
  const [criteria, setCriteria] = useState<string[]>(clone?.criteria.map((c) => c.text) ?? tpl?.criteria ?? ['']);
  const [priority, setPriority] = useState<Mission['priority']>('normal');
  const [due, setDue] = useState(7);
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [origins, setOrigins] = useState<string[]>(['www.example.com']);
  const [originDraft, setOriginDraft] = useState('');
  const [team, setTeam] = useState<string[]>(clone?.agentIds ?? ['gm', 'planner-01', 'coder-01', 'browser-01', 'tester-01']);
  const [autonomy, setAutonomy] = useState<'read' | 'prepare' | 'review' | 'execute'>('prepare');
  const [budget, setBudget] = useState(50);
  const [retain, setRetain] = useState(true);
  const [touched, setTouched] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = !clone && !tpl && (title.trim() !== '' || objective.trim() !== '' || files.length > 0);
  const tryClose = () => (dirty && !confirmDiscard ? setConfirmDiscard(true) : close());

  const steps = [{ k: 'Goal', i: Target }, { k: 'Resources', i: Paperclip }, { k: 'Team, policy & budget', i: Users }, { k: 'Review & create', i: ListChecks }];
  const validCriteria = criteria.filter((c) => c.trim());
  const errors = { team: team.length === 0 ? 'Pick at least one agent to lead the mission' : '', title: !title.trim() ? 'A title is required' : '', criteria: validCriteria.length === 0 ? 'At least one measurable success criterion is required' : '', objective: objective.trim().length < 10 ? 'Describe the outcome (10+ characters)' : '' };
  const goalOk = !errors.title && !errors.criteria && !errors.objective && !errors.team;
  const dup = validCriteria.length !== new Set(validCriteria.map((c) => c.trim().toLowerCase())).size;

  const go = (n: number) => { if (n > step && step === 0 && !goalOk) { setTouched(true); return; } setDir(n > step ? 1 : -1); setStep(n); };
  const create = (start: boolean) => {
    if (!goalOk) { setTouched(true); setStep(0); return; }
    const m = add({ title: title.trim(), objective: objective.trim(), kind, priority, dueInDays: due, budget, agentIds: team, leadId: team[0] ?? 'gm', criteria: validCriteria.map((text) => ({ text, done: false })) }, start);
    toast({ tone: 'success', title: start ? `${m.id} created and started` : `${m.id} saved as draft`, body: start ? 'GM is planning and staffing. External actions still require approval.' : 'Nothing is running yet.', action: { label: 'Open', run: () => nav(`/missions?m=${m.id}`) } });
    close();
    nav(`/missions?m=${m.id}`);
  };

  return (
    <Modal title={clone ? 'Clone mission' : 'Create mission'} icon={Target} help="mission.create" dialogId="DL-01" size="lg" onClose={tryClose}
      sub="A mission is an outcome with measurable success criteria. Agents plan, delegate, execute and verify it."
      footer={
        <>
          {step > 0 && <button className="btn" onClick={() => go(step - 1)}><ChevronLeft size={15} />Back</button>}
          <span className="spacer" />
          <button className="btn ghost" onClick={tryClose}>Cancel</button>
          {step < 3 ? (
            <button className="btn primary" onClick={() => go(step + 1)}>Next<ChevronRight size={15} /></button>
          ) : (
            <>
              <button className="btn" onClick={() => create(false)}>Create Draft</button>
              <button className="btn primary" onClick={() => create(true)}><Play size={15} />Create &amp; Start</button>
            </>
          )}
        </>
      }>
      <AnimatePresence>
        {confirmDiscard && (
          <motion.div className="callout warn" data-dialog="DL-64" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} role="alertdialog" aria-label="Unsaved changes">
            <AlertTriangle size={16} />
            <div className="grow"><b>Discard this draft?</b> You changed the title, outcome or attachments.</div>
            <button className="btn sm" data-autofocus onClick={() => setConfirmDiscard(false)}>Continue Editing</button>
            <button className="btn sm danger" onClick={close}>Discard Changes</button>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="wizard-steps" role="tablist" aria-label="Wizard steps">
        {steps.map((s, i) => (
          <button key={s.k} role="tab" aria-selected={i === step} className={cx('wz-step', i === step && 'on', i < step && 'done')} onClick={() => go(i)}>
            <span className="wz-dot">{i < step ? <Check size={13} strokeWidth={3} /> : <s.i size={14} />}</span>
            <span className="wz-label">{s.k}</span>
            {i === step && <motion.span layoutId="wz-bar" className="wz-bar" />}
          </button>
        ))}
      </div>
      <div style={{ position: 'relative', minHeight: 360 }}>
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div key={step} custom={dir} initial={{ opacity: 0, x: 30 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 * dir }} transition={{ duration: .22 }} className="col" style={{ gap: 14 }}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); step < 3 ? go(step + 1) : create(false); } }}>
            {step === 0 && (
              <>
                <div className="row" style={{ gap: 8 }}>
                  <span className="section-label">Template</span>
                  <div className="row wrap" style={{ gap: 6 }}>
                    {TEMPLATES.map((t) => (
                      <button key={t.key} className={cx('chip neutral', kind === t.kind && title === t.title && 'solid')} style={{ cursor: 'pointer', ['--h' as string]: KIND_META[t.kind].hue }}
                        onClick={() => { setKind(t.kind); setTitle(t.title); setObjective(t.objective); setCriteria(t.criteria); }}>{t.title}</button>
                    ))}
                  </div>
                </div>
                <Field label="Title" required error={touched ? errors.title : ''} hint="Short and outcome-focused. AI may suggest a better title later.">
                  <input className="input" data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Modernize the customer portal" />
                </Field>
                <Field label="Requested outcome" required error={touched ? errors.objective : ''} hint="Enter adds a paragraph. Ctrl+Enter goes to the next step (it never starts anything).">
                  <textarea className="textarea" rows={3} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="What should be true when this mission is done?" />
                </Field>
                <Field label="Measurable success criteria" required help="mission.progress.verified" error={touched ? errors.criteria : ''} hint={dup ? '⚠ Duplicate criteria detected' : 'Each criterion becomes a verification check.'}>
                  <div className="col" style={{ gap: 6 }}>
                    <AnimatePresence initial={false}>
                      {criteria.map((c, i) => (
                        <motion.div key={i} className="row" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                          <Check size={15} className={c.trim() ? 'good' : 'dim'} />
                          <input className="input" value={c} onChange={(e) => setCriteria(criteria.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Criterion ${i + 1}, e.g. "Lighthouse accessibility ≥ 95"`} aria-label={`Criterion ${i + 1}`} />
                          <button className="icon-btn sm" aria-label={`Remove criterion ${i + 1}`} onClick={() => setCriteria(criteria.length > 1 ? criteria.filter((_, j) => j !== i) : [''])}><X size={14} /></button>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setCriteria([...criteria, ''])}><Plus size={14} />Add criterion</button>
                  </div>
                </Field>
                <div className="grid g-3">
                  <Field label="Type">
                    <select className="select" value={kind} onChange={(e) => setKind(e.target.value as Mission['kind'])}>{Object.entries(KIND_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
                  </Field>
                  <Field label="Priority">
                    <Segmented ariaLabel="Priority" size="sm" value={priority} onChange={setPriority} options={(['low', 'normal', 'high', 'critical'] as const).map((p) => ({ key: p, label: p }))} />
                  </Field>
                  <Field label={`Due in ${due} days`}>
                    <input className="range" type="range" min={1} max={60} value={due} onChange={(e) => setDue(+e.target.value)} aria-label="Due in days" />
                  </Field>
                </div>
              </>
            )}
            {step === 1 && (
              <>
                <Field label="Reference files, images and data" hint="Files are stored immutably with a SHA-256 checksum. Personal data is redacted in previews.">
                  <DropZone files={files} setFiles={setFiles} />
                </Field>
                <Field label="Approved website origins" help="browser.originGrant" hint="Agents can only browse these origins. New sites need a separate grant.">
                  <div className="row wrap" style={{ gap: 6 }}>
                    {origins.map((o) => <Chip key={o} hue={190} icon={Globe}>{o}<button aria-label={`Remove ${o}`} onClick={() => setOrigins(origins.filter((x) => x !== o))} style={{ marginLeft: 2 }}><X size={11} /></button></Chip>)}
                    <input className="input" style={{ width: 220, height: 28 }} placeholder="add origin, e.g. shop.example.com" value={originDraft} onChange={(e) => setOriginDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && originDraft.trim()) { e.preventDefault(); setOrigins([...origins, originDraft.trim().replace(/^https?:\/\//, '')]); setOriginDraft(''); } }} aria-label="Add origin" />
                  </div>
                </Field>
                <Field label="Git repository (optional)">
                  <input className="input" placeholder="https://github.com/org/repo  (read-only until approved)" />
                </Field>
              </>
            )}
            {step === 2 && (
              <>
                <Field label="Proposed team" error={errors.team} hint="GM suggested this team from required skills. Click to toggle members. The first member leads.">
                  <div className="row wrap" style={{ gap: 6 }}>
                    {AGENTS.filter((a) => ['gm', 'planner-01', 'coder-01', 'coder-02', 'browser-01', 'browser-02', 'designer-01', 'tester-01', 'tester-02', 'security-01', 'researcher-01', 'writer-01', 'release-01', 'mentor-01'].includes(a.id)).map((a) => {
                      const on = team.includes(a.id);
                      return (
                        <button key={a.id} className={cx('team-pick', on && 'on')} onClick={() => setTeam(on ? team.filter((x) => x !== a.id) : [...team, a.id])} aria-pressed={on}>
                          <RobotAvatar role={a.role} size={30} />
                          <span>{a.name}</span>
                          {on && <Check size={13} className="good" />}
                        </button>
                      );
                    })}
                  </div>
                </Field>
                <Field label="Autonomy level" help="gov.autonomy" hint="External effects (submit, publish, purchase) always require approval.">
                  <Segmented ariaLabel="Autonomy" value={autonomy} onChange={setAutonomy} options={[{ key: 'read', label: 'Safe read' }, { key: 'prepare', label: 'Prepare' }, { key: 'review', label: 'Review each' }, { key: 'execute', label: 'Execute (gated)' }]} />
                </Field>
                <div className="grid g-2">
                  <Field label={`Budget cap: ${money(budget, 0)}`} hint="Hard cap; the mission pauses at 100%.">
                    <input className="range" type="range" min={5} max={300} step={5} value={budget} onChange={(e) => setBudget(+e.target.value)} aria-label="Budget cap" />
                  </Field>
                  <Field label="Allowed model classes">
                    <div className="row wrap" style={{ gap: 6 }}>{['Reasoning (Opus)', 'Fast (Sonnet/Haiku)', 'Vision', 'Local'].map((m, i) => <Chip key={m} hue={[268, 200, 175, 40][i]}>{m}</Chip>)}</div>
                  </Field>
                </div>
                <SwitchRow label="Retain private data for 30 days, then purge" checked={retain} onChange={setRetain} desc="Screenshots and uploads are kept for audit, then deleted unless under legal hold." />
              </>
            )}
            {step === 3 && (
              <div className="col" style={{ gap: 12 }}>
                <div className="review-card">
                  <div className="row" style={{ gap: 8 }}><b style={{ fontSize: 16 }}>{title || 'Untitled mission'}</b><Chip hue={KIND_META[kind].hue}>{KIND_META[kind].label}</Chip><Chip hue={priority === 'critical' ? 350 : 220} size="sm">{priority}</Chip></div>
                  <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>{objective || '—'}</p>
                  <div className="divider" />
                  <div className="grid g-2" style={{ fontSize: 12.5 }}>
                    <div><div className="section-label">Criteria ({validCriteria.length})</div>{validCriteria.map((c) => <div key={c} className="row" style={{ gap: 6 }}><Check size={13} className="good" />{c}</div>)}</div>
                    <div><div className="section-label">Grants</div>{origins.map((o) => <div key={o} className="row" style={{ gap: 6 }}><Globe size={13} className="info" />{o} · read + prepare</div>)}<div className="row" style={{ gap: 6 }}><Paperclip size={13} />{files.length} attachments</div></div>
                  </div>
                  <div className="divider" />
                  <div className="section-label" style={{ marginBottom: 6 }}>Team preview</div>
                  <div className="review-tree">
                    {team[0] && <div className="rt-lead"><RobotAvatar role={AGENT_BY_ID[team[0]]?.role ?? 'manager'} size={40} faceMode="face" /><b>{AGENT_BY_ID[team[0]]?.name}</b></div>}
                    <svg width="100%" height="18" aria-hidden><line x1="50%" y1="0" x2="50%" y2="18" stroke="var(--border-strong)" /></svg>
                    <div className="row wrap" style={{ justifyContent: 'center', gap: 8 }}>{team.slice(1).map((id) => <div key={id} className="col" style={{ alignItems: 'center', gap: 0, fontSize: 11 }}><RobotAvatar role={AGENT_BY_ID[id]?.role ?? 'dev'} size={32} />{AGENT_BY_ID[id]?.name}</div>)}</div>
                  </div>
                </div>
                <div className="row" style={{ gap: 10, fontSize: 12.5 }}>
                  <span className="row" style={{ gap: 5 }}><Wallet size={14} className="info" />Budget {money(budget, 0)}</span>
                  <span className="row" style={{ gap: 5 }}><ShieldCheck size={14} className="good" />Autonomy: {autonomy}</span>
                  <span className="row" style={{ gap: 5 }}><AlertTriangle size={14} className="warn" />Projected risks: 1 (new origin needs grant)</span>
                </div>
                {!goalOk && <div className="field-error">Go back to Goal: {Object.values(errors).filter(Boolean).join(' · ')}</div>}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* DL-02 Edit Mission — creates a definition revision                   */
/* ------------------------------------------------------------------ */
function MissionEdit({ close, props }: DialogComponentProps<{ missionId: string }>) {
  const m = useMission(props.missionId);
  const update = useData((s) => s.updateMission);
  const [title, setTitle] = useState(m?.title ?? '');
  const [objective, setObjective] = useState(m?.objective ?? '');
  const [why, setWhy] = useState('');
  const [scope, setScope] = useState<'future' | 'all'>('future');
  if (!m) return <Missing close={close} />;
  const running = ['running', 'verifying', 'planning'].includes(m.status);
  const changed = title !== m.title || objective !== m.objective;
  const save = () => {
    if (!title.trim()) return;
    update(m.id, { title: title.trim(), objective, revision: m.revision + 1, lastEvent: `Definition revised to rev ${m.revision + 1} by Luca`, lastEventAgoMin: 0 });
    toast({ tone: 'success', title: `Saved revision ${m.revision + 1}`, body: running ? (scope === 'future' ? 'Applies to future tasks; running tasks keep their terms.' : 'Queued for all non-started tasks.') : undefined });
    close();
  };
  return (
    <Modal title="Edit mission" icon={Pencil} dialogId="DL-02" help="mission.revision" onClose={close} sub={`${m.id} · current revision ${m.revision}`}
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={!changed || !title.trim()} onClick={save}>Save Revision</button></>}>
      <Field label="Title" required error={!title.trim() ? 'Title is required' : ''}><input className="input" data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Outcome"><textarea className="textarea" rows={4} value={objective} onChange={(e) => setObjective(e.target.value)} /></Field>
      <Field label="Change explanation" hint="Recorded in the audit log and shown to the lead agent."><input className="input" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why are you changing this?" /></Field>
      {running && (
        <div className="callout warn"><Info size={16} /><div><b>This mission is running.</b> Editing creates revision {m.revision + 1}. Running tasks are never silently rewritten.
          <div style={{ marginTop: 8 }}><Segmented ariaLabel="Apply revision to" size="sm" value={scope} onChange={setScope} options={[{ key: 'future', label: 'Apply to future tasks' }, { key: 'all', label: 'All non-started tasks' }]} /></div></div></div>
      )}
      {changed && (
        <div className="diff-mini">
          <div className="section-label">Revision preview</div>
          {title !== m.title && <><div className="diff-del">− {m.title}</div><div className="diff-add">+ {title}</div></>}
          {objective !== m.objective && <><div className="diff-del clamp-2">− {m.objective}</div><div className="diff-add clamp-2">+ {objective}</div></>}
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
  const archive = useData((s) => s.archiveMission);
  const purge = useData((s) => s.purgeMission);
  const [mode, setMode] = useState<'archive' | 'purge'>(m?.status === 'archived' ? 'purge' : 'archive');
  const [typed, setTyped] = useState('');
  if (!m) return <Missing close={close} />;
  const mc = getMissionControl(m);
  const versions = mc.artifacts.reduce((s, a) => s + a.versions.length, 0);
  const ok = mode === 'archive' || typed.trim() === m.id;
  const run = () => {
    if (mode === 'archive') { archive(m.id); toast({ tone: 'success', title: `${m.id} archived`, body: 'Recoverable from the Archived tab until 2027-05-20.', action: { label: 'Undo', run: () => useData.getState().setMissionStatus(m.id, 'paused') } }); }
    else { purge(m.id); toast({ tone: 'warning', title: `Purge requested for ${m.id}`, body: 'DEMO: removed from this session. In production this needs Owner re-auth and a retention check.' }); }
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
    toast({ tone: kind === 'stop' ? 'warning' : 'success', title: `${cfg.btn}: ${m.id}`, body: kind === 'pause' ? 'Browsers pause before their next action; nothing is replayed on resume.' : kind === 'start' ? 'Pinned team and grants snapshot recorded.' : kind === 'retry' ? 'Restarting from the last verified checkpoint. Submits are never auto-replayed.' : 'In-flight actions finish safely; downstream tasks are canceled.' });
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
          <div className="row" style={{ gap: 10, fontSize: 12.5 }}><Wallet size={14} />Budget {money(m.budget, 0)}<ShieldCheck size={14} className="good" />Mode: prepare + gated execute</div>
        </div>
      )}
      {(kind === 'pause' || kind === 'stop') && (
        <>
          <div className="callout warn"><Info size={16} /><div>{mc.nodes.filter((n) => n.state === 'working').length} agents are working. {kind === 'pause' ? 'They stop before their next action and keep state. Browser sessions are paused, not closed.' : 'In-flight actions finish at a safe boundary; child jobs are canceled; data is retained.'}</div></div>
          <Field label="Reason (optional, audited)"><input className="input" data-autofocus={kind === 'pause' || undefined} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. reprioritizing budget" /></Field>
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
      {[['Website origins', 'www.example.com (read, prepare)'], ['Consequential actions', 'Require Owner approval, bound to action digest, 15 min expiry'], ['Models', 'claude-opus-5-5 (planning), claude-sonnet-5-5 (execution), local fallback'], ['Budget', `${money(m.budget, 0)} hard cap`], ['Data retention', '30 days, then purge'], ['Self-modification', 'Proposals only; no live source changes']].map(([k, v]) => (
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
              onClick={() => { close(); openDialog('mission-create', { template: t.key }); }}>
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

function AttachDialog({ close, props }: DialogComponentProps<{ onAttach?: (a: Attachment[]) => void }>) {
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [ocr, setOcr] = useState(false);
  return (
    <Modal title="Attach source, image or file" icon={Paperclip} dialogId="DL-09" onClose={close}
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={!files.length} onClick={() => { props.onAttach?.(files.map((f) => ({ id: f.id, name: f.name, kind: f.type.startsWith('image/') ? 'image' : 'file', size: `${(f.size / 1024).toFixed(0)} KB`, url: f.url }))); toast({ tone: 'success', title: `${files.length} file(s) attached` }); close(); }}>Attach</button></>}>
      <DropZone files={files} setFiles={setFiles} />
      <SwitchRow label="Extract text from images (OCR)" desc="Opt-in. Extracted text is shown to you before agents can use it." checked={ocr} onChange={setOcr} />
    </Modal>
  );
}

function AiSummary({ close, props }: DialogComponentProps<{ missionId: string }>) {
  const m = useMission(props.missionId);
  const [regen, setRegen] = useState(false);
  if (!m) return <Missing close={close} />;
  const ev = getMissionControl(m).timeline.slice(0, 6);
  return (
    <Modal title="AI summary — sources" icon={Sparkles} help="mission.aiSummary" dialogId="DL-10" size="lg" onClose={close} sub={`${m.id} · generated by claude-sonnet-5-5 · ${ago(m.summaryAgoMin)}`}
      footer={<><button className="btn" onClick={close}>Close</button><button className="btn primary" onClick={() => { setRegen(true); window.setTimeout(() => { setRegen(false); toast({ tone: 'info', title: 'Draft regenerated (demo)', body: 'Drafts are not published until you accept them.' }); }, 1400); }} disabled={regen}><Sparkles size={15} />{regen ? 'Regenerating…' : 'Regenerate Draft'}</button></>}>
      <div className="ai-summary"><p style={{ lineHeight: 1.6 }}>{m.summary}</p></div>
      <div className="section-label">Supporting events</div>
      <div className="col" style={{ gap: 4 }}>
        {ev.map((e) => <div key={e.id} className="event-row" style={{ background: 'var(--panel-2)' }}><span className="mono dim">{clock(e.agoMin)}</span><span className="grow ellipsis">{e.text}</span><span className="mono dim" style={{ fontSize: 11 }}>{e.trace}</span></div>)}
      </div>
      <div className="dim" style={{ fontSize: 12 }}>Summaries can omit details. Human edits are recorded separately and never overwrite the event log.</div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* DL-11 Agent inspector · DL-12 Reassign · DL-13 Task criteria         */
/* ------------------------------------------------------------------ */
function AgentInspector({ close, props }: DialogComponentProps<{ missionId: string; agentId: string; onOpenChat?: () => void }>) {
  const m = useMission(props.missionId);
  const nav = useNavigate();
  const a = AGENT_BY_ID[props.agentId];
  if (!m || !a) return <Missing close={close} />;
  const mc = getMissionControl(m);
  const n = mc.nodes.find((x) => x.agentId === a.id);
  const sup = n?.parent ? mc.nodes.find((x) => x.instanceId === n.parent) : undefined;
  return (
    <Modal title={`${a.name} · instance`} icon={Bot} help="agent.instance" dialogId="DL-11" onClose={close} drawer
      footer={<><button className="btn" onClick={close}>Close</button><button className="btn primary" onClick={() => { close(); props.onOpenChat ? props.onOpenChat() : nav(`/control/${m.id}?tab=conversations&agent=${a.id}`); }}><MessageSquare size={15} />Open Conversation</button></>}>
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
  const [to, setTo] = useState('');
  const [why, setWhy] = useState('');
  if (!m) return <Missing close={close} />;
  const tasks = getMissionControl(m).tasks;
  const taskId = props.taskId ?? tasks.find((t) => t.state !== 'passed')?.id ?? tasks[0]?.id;
  const task = tasks.find((t) => t.id === taskId);
  const candidates = AGENTS.filter((a) => a.id !== task?.owner && a.id !== 'gm').slice(0, 14);
  return (
    <Modal title="Delegate / reassign task" icon={GitBranch} dialogId="DL-12" help="hierarchy.delegation" onClose={close} sub={task ? `${task.id} · ${task.title}` : m.id}
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={!to || !why.trim()} onClick={() => { toast({ tone: 'success', title: 'Reassignment submitted', body: `${AGENT_BY_ID[to]?.name} will receive it after privilege checks. Audited.` }); close(); }}>Submit Reassignment</button></>}>
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
      {to && <div className="callout"><Info size={16} /><div>{AGENT_BY_ID[to].name} has load {AGENT_BY_ID[to].load}%. Subtasks of {task?.id} move with it; evidence stays attached.</div></div>}
    </Modal>
  );
}

function TaskCriteria({ close, props }: DialogComponentProps<{ missionId: string; taskId: string }>) {
  const m = useMission(props.missionId);
  if (!m) return <Missing close={close} />;
  const t = getMissionControl(m).tasks.find((x) => x.id === props.taskId);
  if (!t) return <Missing close={close} />;
  const owner = AGENT_BY_ID[t.owner];
  return (
    <Modal title={t.title} icon={ListChecks} dialogId="DL-13" help="mission.progress.verified" onClose={close} drawer sub={`${t.id} · weight ${t.weight}`}
      footer={<><button className="btn" onClick={() => openDialog('task-reassign', { missionId: m.id, taskId: t.id })}>Reassign</button><button className="btn primary" onClick={() => { toast({ tone: 'info', title: 'Verification requested', body: `QA will verify ${t.id} independently.` }); close(); }}>Request Verification</button></>}>
      <div className="row" style={{ gap: 8 }}><TaskStateChip state={t.state} /><span className="muted" style={{ fontSize: 12.5 }}>Owner</span><RobotAvatar role={owner?.role ?? 'dev'} size={26} /><b>{owner?.name}</b></div>
      <div className="section-label">Expected result</div>
      <p style={{ fontSize: 13 }}>“{t.title}” is complete when its output is attached, tests pass and an independent verifier accepts the evidence.</p>
      <div className="section-label">Dependencies</div>
      <div className="row wrap" style={{ gap: 6 }}>{t.deps.length ? t.deps.map((d) => <Chip key={d} hue={220} size="sm">{d}</Chip>) : <span className="dim">none</span>}</div>
      <div className="section-label">Evidence ({t.evidence})</div>
      {t.evidence ? Array.from({ length: t.evidence }, (_, i) => <div key={i} className="row" style={{ gap: 6, fontSize: 12.5 }}><ImageIcon size={14} className="info" />evidence-{i + 1}.png <span className="dim">· sha256:{(t.id + i).split('').map((c) => c.charCodeAt(0).toString(16)).join('').slice(0, 10)}</span></div>) : <span className="dim">No evidence yet — this task does not count toward verified progress.</span>}
      <div className="section-label">Verifier</div>
      <div className="row" style={{ gap: 6 }}><RobotAvatar role="qa" size={26} /><span>Tester-01 (independent)</span></div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* DL-16 Message details · DL-17 Send command · DL-18 Reply             */
/* ------------------------------------------------------------------ */
function MessageDetails({ close, props }: DialogComponentProps<{ message: { id: string; from: string; to: string; kind: string; text: string; taskId?: string; agoMin: number; ts?: number; attachments?: Attachment[]; replyTo?: string } }>) {
  const msg = props.message;
  if (!msg) return <Missing close={close} />;
  const name = (id: string) => (id.startsWith('human:') ? 'Luca (Owner) · HUMAN' : AGENT_BY_ID[id]?.name ?? id);
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
  const send = useData((s) => s.sendMessage);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<LocalFile[]>([]);
  const a = AGENT_BY_ID[props.agentId];
  const isReply = props.mode === 'reply';
  const impact = useMemo(() => (text.match(/publish|deploy|delete|submit|purchase|pay/i) ? 'This instruction mentions a consequential action — it will still require a separate approval.' : 'Within current mission scope. No new grants.'), [text]);
  if (!m || !a) return <Missing close={close} />;
  const go = () => {
    send(m.id, 'human:owner', a.id, { from: 'human:owner', to: a.id, kind: isReply ? 'reply' : 'command', text, replyTo: props.replyTo, attachments: files.map((f) => ({ id: f.id, name: f.name, kind: f.type.startsWith('image/') ? 'image' : 'file', url: f.url, size: `${(f.size / 1024).toFixed(0)} KB` })) });
    toast({ tone: 'success', title: isReply ? 'Reply submitted' : 'Command sent', body: `${a.name} will acknowledge receipt.` });
    close();
  };
  return (
    <Modal title={isReply ? 'Reply to agent question' : 'Send command'} icon={isReply ? MessageSquare : Send} dialogId={isReply ? 'DL-18' : 'DL-17'} help={isReply ? 'conversation.reply' : 'conversation.command'} onClose={close} sub={`To ${a.name} · ${m.id}`}
      footer={<><button className="btn" onClick={close}>{isReply ? 'Save Draft' : 'Edit'}</button><button className="btn primary" disabled={!text.trim() && !files.length} onClick={go}><Send size={15} />{isReply ? 'Submit Reply' : 'Send Command'}</button></>}>
      {isReply && props.question && <div className="callout warn"><MessageSquare size={16} /><div><b>Question {props.replyTo}</b><div>{props.question}</div></div></div>}
      <Field label={isReply ? 'Your reply' : 'Instruction'} required><textarea className="textarea" rows={4} data-autofocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) go(); }} placeholder={isReply ? 'Answer the question…' : `Tell ${a.name} what to do…`} /></Field>
      <DropZone files={files} setFiles={setFiles} compact />
      <div className="callout"><Info size={16} /><div><b>Impact preview:</b> {impact}</div></div>
    </Modal>
  );
}

function AttachmentPreview({ close, props }: DialogComponentProps<{ attachment: Attachment }>) {
  const at = props.attachment;
  return (
    <Modal title={at?.name ?? 'Attachment'} icon={ImageIcon} dialogId="DL-26b" size="lg" onClose={close} sub={`${at?.kind ?? ''} · ${at?.size ?? ''} · immutable evidence`}
      footer={<><button className="btn" onClick={close}>Close</button>{at?.url && <a className="btn primary" href={at.url} download={at.name}>Download</a>}</>}>
      <div className="center" style={{ minHeight: 260, borderRadius: 12, background: 'var(--panel-2)', border: '1px solid var(--border-soft)', overflow: 'hidden' }}>
        {at?.url ? <img src={at.url} alt={at.name} style={{ maxWidth: '100%', maxHeight: 460 }} /> : at?.kind === 'image' ? <EvidenceThumb seed={at.name} w={560} h={350} /> : <FileText size={48} className="info" />}
      </div>
      <div className="dim" style={{ fontSize: 12 }}>DEMO fixture evidence. Real screenshots are redacted server-side before display (credentials, payment data and secrets are masked).</div>
    </Modal>
  );
}

/* DL-14 Thread picker · DL-15 Conversation thread (drawer; used when the inspector pane is not visible) */
function ThreadPicker({ close, props }: DialogComponentProps<{ missionId: string }>) {
  const m = useMission(props.missionId);
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
  'mission-create': MissionCreate,
  'mission-edit': MissionEdit,
  'mission-delete': MissionDelete,
  'mission-start': (p: DialogComponentProps<{ missionId: string }>) => <Lifecycle {...p} kind="start" />,
  'mission-pause': (p: DialogComponentProps<{ missionId: string }>) => <Lifecycle {...p} kind="pause" />,
  'mission-stop': (p: DialogComponentProps<{ missionId: string }>) => <Lifecycle {...p} kind="stop" />,
  'mission-retry': (p: DialogComponentProps<{ missionId: string }>) => <Lifecycle {...p} kind="retry" />,
  'mission-policy': MissionPolicy,
  'mission-templates': TemplatePicker,
  'attach-files': AttachDialog,
  'ai-summary': AiSummary,
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
