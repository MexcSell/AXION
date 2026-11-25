import { useRef, useState } from 'react';
import { Bot, PencilLine, ShieldAlert } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Form';
import { Chip } from '@/components/ui/Chips';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { AGENTS, AGENT_BY_ID } from '@/data/agents';
import { ROLES } from '@/data/roles';
import type { RoleKey, Agent } from '@/data/types';
import { toast } from '@/store/ui';
import { ModelRouteField } from '@/features/agents/ModelRouteField';
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
  const holder = (label: string) => AGENTS.find(a => a.duty.toLowerCase() === label.trim().toLowerCase());
  const role: RoleKey = 'optimize';
  const [desc, setDesc] = useState('');
  const [model, setModel] = useState('');
  const [tools, setTools] = useState<string[]>(['Mission messaging']);
  const [touched, setTouched] = useState(false);
  // api mode (Stage 6): the agent is created on the server: it needs a role, a duty and a department
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
    if (!roleKey.trim() || !model.trim() || busy) return;
    setBusy(true); setSrv(null);
    const r = await createAgent({
      name: name.trim(), role: roleKey.trim(), dept: dept.trim(), duty: roleName.trim(), description: desc.trim(), model: model.trim(),
      skills: spec.split(',').map((x) => x.trim()).filter(Boolean), tools,
    }, submitKey.current);
    setBusy(false);
    if (!r.ok) { setSrv({ message: r.message, fields: r.fieldErrors ?? {} }); if (r.code !== 'ROLE_TAKEN' && r.code !== 'DUTY_TAKEN') submitKey.current = newKey(); return; }
    toast({ tone: 'success', title: `${r.agent.name} created`, body: `Role ${r.agent.role}, ${r.agent.versionLabel}. It has no instances yet and shows "not enough evidence" until its tasks are measured.` });
    close();
  };
  return (
    <Modal title="Create agent" icon={Bot} help="dialog.agentCreate" dialogId="DL-34" size="lg" onClose={close}  sub="Register the agent and its first version." footer={<Footer close={close} label={busy ? 'Creating…' : 'Create agent'} disabled={busy || !model.trim() || !dept.trim()} onOk={() => void submit()} />}>
      <div className="oa-form-grid">
        <div className="col" style={{ gap: 12 }}>
          <Field label="Name" required error={touched ? err : undefined} hint="Convention: Role-01, for example Marketer-01" help="dialog.agentName"><input data-autofocus className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Marketer-01" /></Field>
          <Field label="Role" required error={srv?.fields.role ? srv.message : touched && !roleKey.trim() ? 'Name the role' : undefined} hint="One active agent per role, for example marketing." help="dialog.agentRoleKey"><input className="input" aria-label="Role" value={roleKey} onChange={(e) => { setRoleKey(e.target.value); if (srv) setSrv(null); }} placeholder="marketing" /></Field>
          <Field label="New duty" required error={srv?.fields.duty ? srv.message : touched || roleName ? roleErr || undefined : undefined} hint="Every agent owns a unique duty." help="dialog.agentRole"><input className="input" value={roleName} onChange={(e) => { setRoleName(e.target.value); if (srv) setSrv(null); }} placeholder="e.g. Marketing" /></Field>
          <Field label="Department" required><input className="input" aria-label="Department" value={dept} onChange={e => setDept(e.target.value)} list="agent-departments" /><datalist id="agent-departments">{[...new Set(AGENTS.map(a => a.dept))].sort().map(d => <option key={d} value={d} />)}</datalist></Field>
          <div className="dim" style={{fontSize: 11.5}}>Existing roles: {AGENTS.map(a => a.role).join(' · ')}</div>
          <Field label="Skills" hint="Comma separated."><input className="input" value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="copywriting, SEO" /></Field>
          <Field label="Description"><textarea className="textarea" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What should this agent be trusted to do?" /></Field>
          <ModelRouteField value={model} onChange={setModel} required />
        </div>
        <div className="col" style={{ gap: 12 }}>
          {srv && !srv.fields.role && !srv.fields.duty && <div className="oa-banner" role="alert"><ShieldAlert size={15} /><span>{srv.message}</span></div>}
          <div className="oa-preview"><RobotAvatar role={role} size={120} faceMode="face" animated /><b className="display">{name || 'New agent'}</b><Chip hue={ROLES[role].hue}>{roleName.trim() || 'New role'}</Chip><span className="dim" style={{ fontSize: 12 }}>First version</span></div>
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
  const a = AGENT_BY_ID[props.agentId ?? ''];
  if (!a) return <Modal title="Agent not found" onClose={close}><p>This agent is no longer in the catalog.</p></Modal>;
  return <AgentEditForm a={a} close={close} />;
}

function AgentEditForm({ a, close }: { a: Agent; close: () => void }) {
  const [desc, setDesc] = useState(a.description);
  // api mode: description, model and skills are saved on the server; a changed model or skills makes the next version
  const [model, setModel] = useState(a.model);
  const [skills, setSkills] = useState(a.skills.join(', '));
  const original = useRef(a);
  const startVersion = useRef(a.version);
  const openedAt = useRef(a.rowVersion ?? 1); // the version I started editing: a change by someone else meanwhile answers 409, never overwritten
  const [busy, setBusy] = useState(false);
  const [srvErr, setSrvErr] = useState('');
  const save = async () => {
    if (busy) return;
    setBusy(true); setSrvErr('');
    const list = skills.split(',').map((x) => x.trim()).filter(Boolean);
    const changes = {
      ...(desc.trim() !== original.current.description && { description: desc.trim() }),
      ...(model.trim() !== original.current.model && { model: model.trim() }),
      ...(JSON.stringify(list) !== JSON.stringify(original.current.skills) && { skills: list }),
    };
    if (!Object.keys(changes).length) { setBusy(false); close(); return; }
    const r = await updateAgent(a.id, openedAt.current, changes);
    setBusy(false);
    if (!r.ok) {
      const current = AGENT_BY_ID[a.id];
      if (r.code === 'CONFLICT' && current?.rowVersion) {
        openedAt.current = current.rowVersion;
        startVersion.current = current.version;
        const conflicts = [];
        if (changes.description !== undefined && current.description !== original.current.description) conflicts.push(`Current description: ${current.description}`);
        if (changes.model !== undefined && current.model !== original.current.model) conflicts.push(`Current model: ${current.model}`);
        if (changes.skills !== undefined && JSON.stringify(current.skills) !== JSON.stringify(original.current.skills)) conflicts.push(`Current skills: ${current.skills.join(', ')}`);
        setSrvErr(['Someone changed this agent. Review your edits and save again.', ...conflicts].join(' '));
      } else setSrvErr(r.message);
      return;
    }
    const changed = r.agent.versionLabel !== startVersion.current;
    toast({ tone: 'success', title: `${a.name} saved`, body: changed ? `New version ${r.agent.versionLabel}. Running instances stay on ${startVersion.current}; new instances use ${r.agent.versionLabel}.` : 'Profile updated. No new version was needed.' });
    close();
  };
  return (
    <Modal title={`Edit ${a.name}`} icon={PencilLine} help="dialog.agentEdit" dialogId="DL-35" size="md" onClose={close} sub="Non-privileged fields only. Tools and grants are not editable here." footer={<Footer close={close} label={busy ? 'Saving…' : 'Save'} disabled={busy || !model.trim()} onOk={() => void save()} />}>
      <div className="row" style={{ gap: 14, marginBottom: 12 }}><RobotAvatar role={a.role} size={70} hue={ROLES[a.role].hue} faceMode="face" /><div><b>{a.name}</b><div className="dim" style={{ fontSize: 12 }}>{ROLES[a.role].label} · {a.dept}</div></div></div>
      <div className="col" style={{ gap: 12 }}>
        {srvErr && <div className="oa-banner" role="alert"><ShieldAlert size={15} /><span>{srvErr}</span></div>}
        <Field label="Description"><textarea data-autofocus className="textarea" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        <Field label="Skills" hint="Comma separated. Changing the skills or the model creates the next version; running instances keep theirs."><input className="input" aria-label="Skills" value={skills} onChange={(e) => setSkills(e.target.value)} /></Field>
        <ModelRouteField value={model} onChange={setModel} required />
      </div>
    </Modal>
  );
}

export const dialogs = { 'agent-create': AgentCreate, 'agent-edit': AgentEdit };
