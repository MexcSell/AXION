import { useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Bot, PencilLine, Target, GraduationCap, Gauge, KeyRound, GitPullRequest, Building2, ArrowRight, Plus, Minus, ShieldAlert } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Field, Segmented } from '@/components/ui/Form';
import { Chip } from '@/components/ui/Chips';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { Radar } from '@/components/viz/Charts';
import { AGENTS, AGENT_BY_ID } from '@/data/agents';
import { ROLES } from '@/data/roles';
import { DEPTS, DEPT_BY_NAME, METRIC_KEYS, METRIC_LABELS, metricSample, toolsFor } from '@/data/orgdemo';
import type { RoleKey, AgentMetrics } from '@/data/types';
import { useVisibleMissions } from '@/store/data';
import { toast } from '@/store/ui';
import { isApi } from '@/api/mode';
import { createAgent, newKey, updateAgent } from '@/api/agents';
import { cx } from '@/lib/format';
import type { DialogComponentProps } from '@/dialogs/DialogHost';
import '@/theme/pages/overview-org-agent.css';

const Footer = ({ close, label, onOk, disabled, tone }: { close: () => void; label: string; onOk: () => void; disabled?: boolean; tone?: 'danger' }) => (
  <><button className="btn" onClick={close}>Cancel</button><button className={cx('btn', tone ?? 'primary')} disabled={disabled} onClick={onOk}>{label}</button></>
);

/* DL-34 ------------------------------------------------------------ */
function AgentCreate({ close }: DialogComponentProps) {
  const [name, setName] = useState('');
  /** One agent per duty: an existing duty is taken, so a new agent defines a new, unique duty (owner rule, u1). */
  const [roleName, setRoleName] = useState('');
  const [spec, setSpec] = useState('');
  const holder = (label: string) => AGENTS.find((a) => a.duty.toLowerCase() === label.trim().toLowerCase() || ROLES[a.role].label.toLowerCase() === label.trim().toLowerCase());
  const role: RoleKey = 'optimize';
  const [desc, setDesc] = useState('');
  const [model, setModel] = useState('claude-sonnet-5-5');
  const [tools, setTools] = useState<string[]>(['Mission messaging']);
  const [touched, setTouched] = useState(false);
  // api mode (Stage 6): the agent is created on the server: it needs a role, a duty and a department
  const api_ = isApi();
  const [roleKey, setRoleKey] = useState('');
  const [dept, setDept] = useState('Operations');
  const [busy, setBusy] = useState(false);
  const [srv, setSrv] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const submitKey = useRef(newKey()); // one key per dialog: a double click or a retry creates one agent
  const err = !name.trim() ? 'Name is required' : AGENTS.some((a) => a.name.toLowerCase() === name.trim().toLowerCase()) ? 'An agent with this name exists' : '';
  const roleErr = !roleName.trim() ? 'Name the new duty' : holder(roleName) ? `“${holder(roleName)!.duty}” is already the duty of ${holder(roleName)!.name}. No agent holds a duty twice: assign ${holder(roleName)!.name} to more missions, or derive a specialist from it.` : '';
  const toolList = ['Mission messaging', 'Test runner', 'Managed browser', 'Web search', 'Git branch', 'Knowledge read'];
  const submit = async () => {
    setTouched(true);
    if (err || roleErr) return;
    if (api_) {
      if (!roleKey.trim() || busy) return;
      setBusy(true); setSrv(null);
      const r = await createAgent({
        name: name.trim(), role: roleKey.trim(), dept, duty: roleName.trim(), description: desc.trim(), model,
        skills: spec.split(',').map((x) => x.trim()).filter(Boolean), tools,
      }, submitKey.current);
      setBusy(false);
      if (!r.ok) { setSrv({ message: r.message, fields: r.fieldErrors ?? {} }); if (r.code !== 'ROLE_TAKEN' && r.code !== 'DUTY_TAKEN') submitKey.current = newKey(); return; }
      toast({ tone: 'success', title: `${r.agent.name} created`, body: `Role ${r.agent.role}, ${r.agent.versionLabel}. It has no instances yet and shows "not enough evidence" until its tasks are measured.` });
      close();
      return;
    }
    toast({ tone: 'success', title: `Draft agent "${name.trim()}" (${roleName.trim()}) saved (demo)`, body: 'It is a draft: no grants, no instances. Run its evaluation before assigning it.' });
    close();
  };
  return (
    <Modal title="Create agent" icon={Bot} help="dialog.agentCreate" dialogId="DL-34" size="lg" onClose={close}  sub={api_ ? 'Created on the server with its first version. Nothing runs until agents execute (a later stage).' : 'Saves a draft. Nothing runs until it is evaluated and staffed.'} footer={<Footer close={close} label={api_ ? (busy ? 'Creating…' : 'Create agent') : 'Save draft agent'} disabled={busy} onOk={() => void submit()} />}>
      <div className="oa-form-grid">
        <div className="col" style={{ gap: 12 }}>
          <Field label="Name" required error={touched ? err : undefined} hint="Convention: Role-01, for example Marketer-01" help="dialog.agentName"><input data-autofocus className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Marketer-01" /></Field>
          {api_ && <Field label="Role" required error={srv?.fields.role ? srv.message : touched && !roleKey.trim() ? 'Name the role' : undefined} hint="One active agent per role, for example marketing." help="dialog.agentRoleKey"><input className="input" aria-label="Role" value={roleKey} onChange={(e) => { setRoleKey(e.target.value); if (srv) setSrv(null); }} placeholder="marketing" /></Field>}
          <Field label="New duty" required error={srv?.fields.duty ? srv.message : touched || roleName ? roleErr || undefined : undefined} hint="Every agent owns a unique duty." help="dialog.agentRole"><input className="input" value={roleName} onChange={(e) => { setRoleName(e.target.value); if (srv) setSrv(null); }} placeholder="e.g. Marketing" /></Field>
          {api_ && <Field label="Department"><select className="select" aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)}>{DEPTS.filter((d) => d.name !== 'Executive').map((d) => <option key={d.name}>{d.name}</option>)}</select></Field>}
          <div className="dim" style={{ fontSize: 11.5, marginTop: -6 }}>Taken: {Object.values(ROLES).map((r) => r.label).join(' · ')}</div>
          <Field label={api_ ? 'Skills' : 'Specialty'} hint={api_ ? 'Comma separated.' : undefined}><input className="input" value={spec} onChange={(e) => setSpec(e.target.value)} placeholder={api_ ? 'copywriting, SEO' : 'e.g. Checkout-flow forms'} /></Field>
          <Field label="Description"><textarea className="textarea" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What should this agent be trusted to do?" /></Field>
          <Field label="Model route" help="models.route"><select className="select" value={model} onChange={(e) => setModel(e.target.value)}>{['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'local/llama-4-70b'].map((m) => <option key={m}>{m}</option>)}</select></Field>
        </div>
        <div className="col" style={{ gap: 12 }}>
          {srv && !srv.fields.role && !srv.fields.duty && <div className="oa-banner" role="alert"><ShieldAlert size={15} /><span>{srv.message}</span></div>}
          <div className="oa-preview"><RobotAvatar role={role} size={120} faceMode="face" animated /><b className="display">{name || 'New agent'}</b><Chip hue={ROLES[role].hue}>{roleName.trim() || 'New role'}</Chip><span className="dim" style={{ fontSize: 12 }}>{api_ ? 'First version v1.0.0' : 'Owner: Luca · v0.1.0 draft'}</span></div>
          <Field label="Bounded tools" help="agent.tools" hint="Capabilities only. Grants are requested separately.">
            <div className="row wrap" style={{ gap: 6 }}>{toolList.map((t) => { const on = tools.includes(t); return <button key={t} type="button" className={cx('oa-filter', on && 'on')} aria-pressed={on} onClick={() => setTools(on ? tools.filter((x) => x !== t) : [...tools, t])}>{t}</button>; })}</div>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/* DL-35 ------------------------------------------------------------ */
function AgentEdit({ close, props }: DialogComponentProps<{ agentId?: string }>) {
  const a = AGENT_BY_ID[props.agentId ?? ''] ?? AGENTS[1];
  const [desc, setDesc] = useState(a.description);
  const [goals, setGoals] = useState(a.skills.slice(0, 2).join(', '));
  const [pin, setPin] = useState(a.version);
  const [hue, setHue] = useState(0);
  // api mode: description, model and skills are saved on the server; a changed model or skills makes the next version
  const api_ = isApi();
  const [model, setModel] = useState(a.model);
  const [skills, setSkills] = useState(a.skills.join(', '));
  const startVersion = useRef(a.version); // the catalog objects are refreshed in place, so remember the version I opened
  const openedAt = useRef(a.rowVersion ?? 1); // the version I started editing: a change by someone else meanwhile answers 409, never overwritten
  const [busy, setBusy] = useState(false);
  const [srvErr, setSrvErr] = useState('');
  const save = async () => {
    if (busy) return;
    setBusy(true); setSrvErr('');
    const list = skills.split(',').map((x) => x.trim()).filter(Boolean);
    const r = await updateAgent(a.id, openedAt.current, { description: desc.trim(), model, skills: list });
    setBusy(false);
    if (!r.ok) { setSrvErr(r.message); return; }
    const changed = r.agent.versionLabel !== startVersion.current;
    toast({ tone: 'success', title: `${a.name} saved`, body: changed ? `New version ${r.agent.versionLabel}. Running instances stay on ${startVersion.current}; new instances use ${r.agent.versionLabel}.` : 'Profile updated. No new version was needed.' });
    close();
  };
  const err = !api_ && desc.trim().length < 10 ? 'Describe the agent in at least 10 characters' : '';
  return (
    <Modal title={`Edit ${a.name}`} icon={PencilLine} help="dialog.agentEdit" dialogId="DL-35" size="md" onClose={close} sub="Non-privileged fields only. Tools and grants are not editable here." footer={<Footer close={close} label={api_ ? (busy ? 'Saving…' : 'Save') : 'Save profile revision'} disabled={!!err || busy} onOk={() => { if (api_) { void save(); return; } toast({ tone: 'success', title: `${a.name}: profile revision saved (demo)`, body: `Version ${pin} pinned for new instances only.` }); close(); }} />}>
      <div className="row" style={{ gap: 14, marginBottom: 12 }}><RobotAvatar role={a.role} size={70} hue={ROLES[a.role].hue + hue} faceMode="face" /><div><b>{a.name}</b><div className="dim" style={{ fontSize: 12 }}>{ROLES[a.role].label} · {a.dept}</div></div></div>
      <div className="col" style={{ gap: 12 }}>
        {srvErr && <div className="oa-banner" role="alert"><ShieldAlert size={15} /><span>{srvErr}</span></div>}
        <Field label="Description" error={err || undefined} required={!api_}><textarea data-autofocus className="textarea" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        {api_ ? <>
          <Field label="Skills" hint="Comma separated. Changing the skills or the model creates the next version; running instances keep theirs."><input className="input" aria-label="Skills" value={skills} onChange={(e) => setSkills(e.target.value)} /></Field>
          <Field label="Model route" help="models.route"><select className="select" aria-label="Model route" value={model} onChange={(e) => setModel(e.target.value)}>{Array.from(new Set([a.model, 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'local/llama-4-70b'])).map((m) => <option key={m}>{m}</option>)}</select></Field>
        </> : <>
        <Field label="Skill goals" hint="Comma separated. Goals feed mentoring plans."><input className="input" value={goals} onChange={(e) => setGoals(e.target.value)} /></Field>
        <div className="grid g-2">
          <Field label="Pinned version" help="evolution.promotion"><select className="select" value={pin} onChange={(e) => setPin(e.target.value)}>{[a.version, 'v2.3.0', 'v2.2.0'].filter((v, i, x) => x.indexOf(v) === i).map((v) => <option key={v}>{v}</option>)}</select></Field>
          <Field label="Avatar hue shift" help="settings.faces"><input type="range" min={-60} max={60} value={hue} onChange={(e) => setHue(+e.target.value)} aria-label="Avatar hue shift" /></Field>
        </div></>}
      </div>
    </Modal>
  );
}

/* DL-37 ------------------------------------------------------------ */
function AgentAssign({ close, props }: DialogComponentProps<{ agentId?: string }>) {
  const missions = useVisibleMissions().filter((m) => ['running', 'planning', 'verifying', 'waiting', 'paused'].includes(m.status));
  const [agentId, setAgentId] = useState(props.agentId ?? 'coder-01');
  const a = AGENT_BY_ID[agentId];
  const [mid, setMid] = useState(missions[0]?.id ?? '');
  const m = missions.find((x) => x.id === mid);
  const [mgr, setMgr] = useState('gm');
  const [ver, setVer] = useState(a.version);
  const dup = !!m?.agentIds.includes(agentId);
  const err = !m ? 'Choose a mission' : dup ? `${a.name} is already on ${m.id}` : '';
  return (
    <Modal title="Assign agent to mission" icon={Target} help="agent.instance" dialogId="DL-37" onClose={close} sub="Creates an isolated instance with its own memory and grants." footer={<Footer close={close} label="Create instance" disabled={!!err} onOk={() => { toast({ tone: 'success', title: `Instance ${m!.id}:${agentId} created (demo)`, body: `Pinned ${ver}, isolated memory. It merges experience back into ${a.name} every 15 min.` }); close(); }} />}>
      <div className="col" style={{ gap: 12 }}>
        <div className="grid g-2">
          <Field label="Agent"><select data-autofocus className="select" value={agentId} onChange={(e) => { setAgentId(e.target.value); setVer(AGENT_BY_ID[e.target.value].version); }}>{AGENTS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          <Field label="Version" help="evolution.promotion"><select className="select" value={ver} onChange={(e) => setVer(e.target.value)}>{[a.version, 'v2.3.0'].filter((v, i, x) => x.indexOf(v) === i).map((v) => <option key={v}>{v}</option>)}</select></Field>
        </div>
        <Field label="Mission" required error={err || undefined}><select className="select" value={mid} onChange={(e) => setMid(e.target.value)}>{missions.map((x) => <option key={x.id} value={x.id}>{x.id} · {x.title}</option>)}</select></Field>
        <div className="grid g-2">
          <Field label="Reports to"><select className="select" value={mgr} onChange={(e) => setMgr(e.target.value)}>{(m?.agentIds ?? ['gm']).map((id) => <option key={id} value={id}>{AGENT_BY_ID[id]?.name}</option>)}</select></Field>
          <Field label="Merge experience every" help="agent.merge"><select className="select" defaultValue="15">{[10, 15, 20, 30].map((v) => <option key={v} value={v}>{v} min</option>)}</select></Field>
        </div>
        <div className="oa-banner"><ShieldAlert size={15} /><span>Memory and grants are isolated per instance. Running instances of {a.name} elsewhere are unaffected.</span></div>
      </div>
    </Modal>
  );
}

/* DL-38 ------------------------------------------------------------ */
function MentoringSession({ close, props }: DialogComponentProps<{ agentId?: string }>) {
  const learners = AGENTS.filter((x) => x.role !== 'mentor' && x.id !== 'gm');
  const [learner, setLearner] = useState(props.agentId && props.agentId !== 'mentor-01' ? props.agentId : (learners.find((x) => x.status === 'training') ?? learners[0]).id);
  const [metric, setMetric] = useState<keyof AgentMetrics>('toolPrecision');
  const [exercise, setExercise] = useState('');
  const [rubric, setRubric] = useState('pass-rate');
  const [n, setN] = useState(30);
  const l = AGENT_BY_ID[learner];
  const err = exercise.trim().length < 4 ? 'Name the exercise' : n < 10 ? 'Checkpoint needs at least 10 evaluated tasks' : '';
  const [touched, setTouched] = useState(false);
  return (
    <Modal title="Mentoring session" icon={GraduationCap} help="agent.mentoring" dialogId="DL-38" onClose={close} sub="A coaching exercise with independent before/after evidence." footer={<Footer close={close} label="Schedule exercise" onOk={() => { setTouched(true); if (err) return; toast({ tone: 'success', title: 'Exercise scheduled (demo)', body: `${l.name}: "${exercise}". Mentor-01 coaches; Tester-01 verifies independently.` }); close(); }} />}>
      <div className="row" style={{ gap: 10, marginBottom: 12 }}><RobotAvatar role="mentor" size={44} /><ArrowRight size={16} className="dim" /><RobotAvatar role={l.role} size={44} /><div><b>Mentor-01 coaching {l.name}</b><div className="dim" style={{ fontSize: 12 }}>current {METRIC_LABELS[metric]}: {l.metrics[metric]}</div></div></div>
      <div className="col" style={{ gap: 12 }}>
        <div className="grid g-2">
          <Field label="Learner"><select className="select" value={learner} onChange={(e) => setLearner(e.target.value)}>{learners.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          <Field label="Target metric"><select className="select" value={metric} onChange={(e) => setMetric(e.target.value as keyof AgentMetrics)}>{METRIC_KEYS.map((k) => <option key={k} value={k}>{METRIC_LABELS[k]}</option>)}</select></Field>
        </div>
        <Field label="Exercise" required error={touched && err ? err : undefined}><input data-autofocus className="input" value={exercise} onChange={(e) => setExercise(e.target.value)} placeholder="e.g. Locator recipes for address forms" /></Field>
        <div className="grid g-2">
          <Field label="Rubric" help="agent.exercises"><select className="select" value={rubric} onChange={(e) => setRubric(e.target.value)}><option value="pass-rate">Fixture pass-rate</option><option value="precision">Tool precision</option><option value="cost">Cost per task</option></select></Field>
          <Field label="Checkpoint (evaluated tasks)"><input className="input" type="number" value={n} min={1} onChange={(e) => setN(+e.target.value)} /></Field>
        </div>
      </div>
    </Modal>
  );
}

/* Evidence inspector ------------------------------------------------ */
function AgentEvidence({ close, props }: DialogComponentProps<{ agentId?: string; metric?: string }>) {
  const a = AGENT_BY_ID[props.agentId ?? ''] ?? AGENTS[1];
  const [k, setK] = useState<keyof AgentMetrics>((METRIC_KEYS.includes(props.metric as keyof AgentMetrics) ? props.metric : props.metric === 'success' ? 'reliability' : 'reliability') as keyof AgentMetrics);
  const v = a.metrics[k], n = metricSample(a, k);
  const rows = useMemo(() => Array.from({ length: 6 }, (_, i) => ({ id: `EV-${k.slice(0, 3).toUpperCase()}-${i + 1}`, mission: `M-${126 + ((i * 3) % 8)}`, when: `${i * 2 + 1}d ago`, pass: i !== 3 || v > 90, note: ['Visual diff on checkout', 'Locator recipe fixture', 'Independent QA replay', 'Edge-case regression', 'Cost-capped run', 'Peer review'][i] })), [k, v]);
  return (
    <Modal title={`${a.name}: ${METRIC_LABELS[k]} evidence`} icon={Gauge} help="agent.metricEvidence" dialogId="evidence" size="lg" drawer onClose={close} sub="Scores are explained by recorded tasks, never by an unexplained grade."
      footer={<><button className="btn" data-autofocus onClick={close}>Close</button><button className="btn primary" onClick={() => { toast({ tone: 'info', title: 'Evidence bundle export queued (demo)' }); }}>Export evidence</button></>}>
      <div style={{ overflowX: 'auto', paddingBottom: 4 }}><Segmented ariaLabel="Metric" size="sm" value={k} onChange={setK} options={METRIC_KEYS.map((x) => ({ key: x, label: METRIC_LABELS[x] }))} /></div>
      <div className="row" style={{ gap: 18, margin: '16px 0' }}>
        <Radar axes={METRIC_KEYS.map((x) => METRIC_LABELS[x].replace('Tool precision', 'Precision').slice(0, 9))} values={METRIC_KEYS.map((x) => a.metrics[x])} size={200} />
        <div className="col" style={{ gap: 8 }}>
          <div><b className="display" style={{ fontSize: 38 }}>{v}</b><span className="dim"> / 100</span></div>
          <div className="dim" style={{ fontSize: 13 }}>{Math.round(n * v / 100)} of {n} evaluated tasks passed verification</div>
          <Chip hue={n >= 60 ? 145 : n >= 30 ? 38 : 350}>{n >= 60 ? 'High' : n >= 30 ? 'Medium' : 'Low'} confidence (n={n})</Chip>
          <div className="dim" style={{ fontSize: 12 }}>Window: last 30 days · rubric v3 · scorer Tester-01</div>
        </div>
      </div>
      <div className="section-label" style={{ marginBottom: 6 }}>Supporting evidence</div>
      <div className="table-wrap"><table className="table"><thead><tr><th>Evidence</th><th>Mission</th><th>Case</th><th>Result</th><th>When</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td className="mono" style={{ whiteSpace: 'nowrap' }}>{r.id}</td><td>{r.mission}</td><td>{r.note}</td><td><Chip hue={r.pass ? 145 : 350} size="sm">{r.pass ? 'pass' : 'fail'}</Chip></td><td className="dim">{r.when}</td></tr>)}</tbody></table></div>
    </Modal>
  );
}

/* DL-36 ------------------------------------------------------------ */
function ToolsPermission({ close, props }: DialogComponentProps<{ agentId?: string; tool?: string }>) {
  const a = AGENT_BY_ID[props.agentId ?? ''] ?? AGENTS[1];
  const tools = toolsFor(a);
  const [tool, setTool] = useState(props.tool ?? tools[0].name);
  const [scopes, setScopes] = useState<string[]>(['read']);
  const [sites, setSites] = useState('');
  const [hours, setHours] = useState(2);
  const [actions, setActions] = useState('Navigate and read. No form submissions.');
  const needsSite = /browser|screenshot|form/i.test(tool);
  const sitesOk = !needsSite || /^[a-z0-9.-]+\.[a-z]{2,}(,\s*[a-z0-9.-]+\.[a-z]{2,})*$/i.test(sites.trim());
  const err = scopes.length === 0 ? 'Select at least one scope' : !sitesOk ? 'Enter exact hostnames, comma separated (no wildcards)' : hours < 1 || hours > 72 ? 'Expiry must be 1 to 72 hours' : '';
  const [touched, setTouched] = useState(false);
  return (
    <Modal title={`Request tool grant: ${a.name}`} icon={KeyRound} help="browser.originGrant" dialogId="DL-36" onClose={close} sub="Exact scopes, sites, expiry and action bounds. Reviewed before use." footer={<Footer close={close} label="Request grant" onOk={() => { setTouched(true); if (err) return; toast({ tone: 'success', title: 'Grant requested (demo)', body: `${tool} · ${scopes.join(', ')}${needsSite ? ` · ${sites}` : ''} · ${hours}h. Awaiting Security-01 review.` }); close(); }} />}>
      <div className="col" style={{ gap: 12 }}>
        <Field label="Tool"><select data-autofocus className="select" value={tool} onChange={(e) => setTool(e.target.value)}>{tools.map((t) => <option key={t.id}>{t.name}</option>)}</select></Field>
        <Field label="Scopes" help="browser.originGrant"><div className="row wrap" style={{ gap: 6 }}>{['read', 'write', 'execute'].map((s) => { const on = scopes.includes(s); return <button key={s} type="button" className={cx('oa-filter', on && 'on')} aria-pressed={on} onClick={() => setScopes(on ? scopes.filter((x) => x !== s) : [...scopes, s])}>{s}</button>; })}</div></Field>
        {needsSite && <Field label="Exact sites" required error={touched && !sitesOk ? err : undefined} hint="Hostnames only. New sites need a separate grant."><input className="input" value={sites} onChange={(e) => setSites(e.target.value)} placeholder="status.example.com" /></Field>}
        <div className="grid g-2">
          <Field label="Expiry (hours)" error={touched && hours < 1 ? err : undefined}><input className="input" type="number" value={hours} onChange={(e) => setHours(+e.target.value)} /></Field>
          <Field label="Mission"><select className="select"><option>M-126</option><option>M-132</option></select></Field>
        </div>
        <Field label="Action bounds"><textarea className="textarea" rows={2} value={actions} onChange={(e) => setActions(e.target.value)} /></Field>
        {touched && err && !needsSite && <span className="field-error" role="alert">{err}</span>}
      </div>
    </Modal>
  );
}

/* DL-39 ------------------------------------------------------------ */
interface Move { agentId: string; from: string; to: string; }
function OrgReorg({ close, props }: DialogComponentProps<{ moves?: Move[]; readOnly?: boolean; title?: string; rebalance?: string }>) {
  const missions = useVisibleMissions();
  const initial: Move[] = props.moves?.length ? props.moves : props.rebalance ? [{ agentId: props.rebalance, from: AGENT_BY_ID[props.rebalance].dept, to: 'QA' }] : [{ agentId: 'browser-01', from: 'Engineering', to: 'QA' }];
  const [moves, setMoves] = useState<Move[]>(initial);
  const [reason, setReason] = useState(props.title ?? '');
  const ro = !!props.readOnly;
  const before = (d: string) => AGENTS.filter((a) => a.id !== 'gm' && a.dept === d);
  const after = (d: string) => AGENTS.filter((a) => a.id !== 'gm' && (moves.find((m) => m.agentId === a.id)?.to ?? a.dept) === d);
  const touched = Array.from(new Set(moves.flatMap((m) => [m.from, m.to])));
  const affected = missions.filter((m) => ['running', 'planning', 'verifying', 'waiting'].includes(m.status) && m.agentIds.some((id) => moves.some((x) => x.agentId === id)));
  const err = moves.length === 0 ? 'Add at least one change' : !ro && reason.trim().length < 5 ? 'Give a short reason for reviewers' : '';
  const setMove = (i: number, p: Partial<Move>) => setMoves(moves.map((m, k) => k === i ? { ...m, ...p, from: AGENT_BY_ID[p.agentId ?? m.agentId].dept } : m));
  return (
    <Modal title={ro ? `Proposal diff: ${props.title}` : 'Reorganization proposal'} icon={GitPullRequest} help="org.reorganization" dialogId="DL-39" size="xl" onClose={close} sub="Before and after structure. A proposal only: nothing changes until reviewed and approved."
      footer={ro ? <button className="btn primary" data-autofocus onClick={close}>Close</button> : <Footer close={close} label="Submit proposal" disabled={!!err} onOk={() => { toast({ tone: 'success', title: 'Reorganization proposal submitted (demo)', body: `${moves.length} change(s) · ${affected.length} active missions affected · applies to new missions first.` }); close(); }} />}>
      <div className="oa-diff-cols">
        <div className="col" style={{ gap: 10 }}>
          <div className="section-label">Changes</div>
          {moves.map((m, i) => (
            <div key={i} className="oa-move">
              {ro ? <><RobotAvatar role={AGENT_BY_ID[m.agentId].role} size={28} /><b style={{ flex: 1 }}>{AGENT_BY_ID[m.agentId].name}</b></> : <select className="select" aria-label="Agent" value={m.agentId} onChange={(e) => setMove(i, { agentId: e.target.value })}>{AGENTS.filter((a) => a.id !== 'gm').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}
              <Chip hue={DEPT_BY_NAME[m.from]?.hue ?? 225} size="sm">{m.from}</Chip><ArrowRight size={13} className="dim" />
              {ro ? <Chip hue={DEPT_BY_NAME[m.to]?.hue ?? 225} size="sm">{m.to}</Chip> : <select className="select" aria-label="New department" value={m.to} onChange={(e) => setMove(i, { to: e.target.value, agentId: m.agentId })} style={{ width: 130 }}>{DEPTS.map((d) => <option key={d.name}>{d.name}</option>)}</select>}
              {!ro && <button className="icon-btn" aria-label="Remove change" onClick={() => setMoves(moves.filter((_, k) => k !== i))}><Minus size={14} /></button>}
            </div>
          ))}
          {!ro && <button className="btn sm" onClick={() => setMoves([...moves, { agentId: 'coder-01', from: AGENT_BY_ID['coder-01'].dept, to: 'QA' }])}><Plus size={14} />Add change</button>}
          {!ro && <Field label="Reason" required error={reason && err ? err : undefined}><input data-autofocus className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this better?" /></Field>}
          <div className="section-label" style={{ marginTop: 4 }}>Affected active missions ({affected.length})</div>
          <div className="col" style={{ gap: 4 }}>{affected.length === 0 ? <span className="dim" style={{ fontSize: 12.5 }}>None. Safe to apply to new missions.</span> : affected.map((m) => <div key={m.id} className="row" style={{ gap: 8, fontSize: 12.5 }}><span className="mono dim">{m.id}</span><span className="ellipsis">{m.title}</span></div>)}</div>
          <div className="oa-banner"><ShieldAlert size={15} /><span>Reporting lines and permissions are re-evaluated. Running instances stay pinned. A rollback point is created.</span></div>
        </div>
        <div className="oa-diff">
          <div className="oa-diff-head"><b>Before</b><b>After</b></div>
          {touched.map((d, i) => {
            const b = before(d), a2 = after(d);
            return (
              <motion.div key={d} className="oa-diff-row" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .06 }}>
                <div className="oa-diff-title"><b>{d}</b><span className="dim" style={{ fontSize: 11.5 }}>{b.length} → {a2.length}</span></div>
                <div className="oa-diff-side">{b.slice(0, 8).map((a) => <span key={a.id} className={cx('oa-dchip', !a2.includes(a) && 'rm')}>{!a2.includes(a) && <Minus size={10} />}{a.name}</span>)}{b.length > 8 && <span className="dim" style={{ fontSize: 11 }}>+{b.length - 8}</span>}</div>
                <div className="oa-diff-side">{a2.slice(0, 8).map((a) => <span key={a.id} className={cx('oa-dchip', !b.includes(a) && 'add')}>{!b.includes(a) && <Plus size={10} />}{a.name}</span>)}{a2.length > 8 && <span className="dim" style={{ fontSize: 11 }}>+{a2.length - 8}</span>}</div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

/* DL-40 ------------------------------------------------------------ */
function DepartmentCreate({ close, props }: DialogComponentProps<{ dept?: string }>) {
  const ex = props.dept ? DEPT_BY_NAME[props.dept] : undefined;
  const [name, setName] = useState(ex?.name ?? '');
  const [charter, setCharter] = useState(ex?.charter ?? '');
  const [mgr, setMgr] = useState(ex?.managerId ?? 'planner-01');
  const [members, setMembers] = useState<string[]>(ex?.memberIds.slice(0, 3) ?? []);
  const [policy, setPolicy] = useState(['C-4']);
  const [touched, setTouched] = useState(false);
  const err = name.trim().length < 3 ? 'Name must be at least 3 characters' : !ex && DEPTS.some((d) => d.name.toLowerCase() === name.trim().toLowerCase()) ? 'A department with this name exists' : charter.trim().length < 15 ? 'Charter needs at least 15 characters' : '';
  return (
    <Modal title={ex ? `Edit draft: ${ex.name}` : 'Create department'} icon={Building2} help="org.departments" dialogId="DL-40" size="lg" onClose={close} sub="Saved as a draft. It takes effect only after the reorganization is approved." footer={<Footer close={close} label="Save draft" onOk={() => { setTouched(true); if (err) return; toast({ tone: 'success', title: `Department draft "${name}" saved (demo)`, body: `${members.length} members. Review it in Agents › Proposals.` }); close(); }} />}>
      <div className="oa-form-grid">
        <div className="col" style={{ gap: 12 }}>
          <Field label="Name" required error={touched && err.includes('name') ? err : undefined}><input data-autofocus className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Growth" /></Field>
          <Field label="Charter" required error={touched && err.startsWith('Charter') ? err : undefined} hint="What the department owns and does not own."><textarea className="textarea" rows={4} value={charter} onChange={(e) => setCharter(e.target.value)} /></Field>
          <div className="grid g-2">
            <Field label="Manager"><select className="select" value={mgr} onChange={(e) => setMgr(e.target.value)}>{AGENTS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
            <Field label="Members"><input className="input" readOnly value={`${members.length} selected`} aria-label="Member count" /></Field>
          </div>
        </div>
        <div className="col" style={{ gap: 12 }}>
          <Field label="Members" hint={`${members.length} selected`}>
            <div className="oa-members">{AGENTS.filter((a) => a.id !== 'gm').map((a) => { const on = members.includes(a.id); return <button key={a.id} type="button" className={cx('oa-mem', on && 'on')} aria-pressed={on} onClick={() => setMembers(on ? members.filter((x) => x !== a.id) : [...members, a.id])}><RobotAvatar role={a.role} size={22} />{a.name}</button>; })}</div>
          </Field>
          <Field label="Policy references" help="org.constitution"><div className="row wrap" style={{ gap: 6 }}>{['C-1', 'C-2', 'C-3', 'C-4', 'C-5'].map((c) => { const on = policy.includes(c); return <button key={c} type="button" className={cx('oa-filter', on && 'on')} aria-pressed={on} onClick={() => setPolicy(on ? policy.filter((x) => x !== c) : [...policy, c])}>{c}</button>; })}</div></Field>
        </div>
      </div>
    </Modal>
  );
}

export const dialogs = {
  'agent-create': AgentCreate, 'agent-edit': AgentEdit, 'agent-assign': AgentAssign, 'mentoring-session': MentoringSession,
  'agent-evidence': AgentEvidence, 'tools-permission': ToolsPermission, 'org-reorg-proposal': OrgReorg, 'department-create': DepartmentCreate,
};
