import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { GitBranchPlus, RotateCcw, Plus, X, Info, ShieldAlert, Loader2, ArrowRight } from 'lucide-react';
import type { VersionConfig } from '@contracts';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Form';
import { Chip } from '@/components/ui/Chips';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { AGENT_BY_ID, AGENTS } from '@/data/agents';
import { ROLES } from '@/data/roles';
import { isApi } from '@/api/mode';
import { useAgentsCatalog } from '@/api/agents';
import { useAgentDetail, createVersionProposal, rollbackAgent, versionDiff, newKey } from '@/api/versionProposals';
import { VersionDiffView, NoEvaluation } from '@/features/agents/VersionProposals';
import { toast } from '@/store/ui';
import type { DialogComponentProps } from '@/dialogs/DialogHost';
import '@/theme/pages/overview-org-agent.css';

const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'local/llama-4-70b'];

/** Chips with a remove button, plus an input that adds one on Enter or with the + button. */
function ListEditor({ label, items, onChange, help }: { label: string; items: string[]; onChange: (xs: string[]) => void; help: string }) {
  const [draft, setDraft] = useState('');
  const add = () => { const v = draft.trim(); if (v && !items.includes(v)) onChange([...items, v]); setDraft(''); };
  const one = label.replace(/s$/, '').toLowerCase();
  return (
    <div className="col" style={{ gap: 6 }} data-list-editor={label.toLowerCase()}>
      <div className="row" style={{ gap: 6 }}><div className="section-label" style={{ margin: 0 }}>{label}</div><HelpTrigger k={help} /></div>
      <div className="row wrap" style={{ gap: 5 }}>
        {items.map((x) => (
          <motion.span key={x} layout initial={{ opacity: 0, scale: .9 }} animate={{ opacity: 1, scale: 1 }} className="oa-line" data-item={x}>
            <b>{x}</b><button type="button" className="icon-btn" style={{ width: 18, height: 18 }} aria-label={`Remove ${one} ${x}`} onClick={() => onChange(items.filter((y) => y !== x))}><X size={11} /></button>
          </motion.span>
        ))}
        {items.length === 0 && <span className="dim" style={{ fontSize: 12 }}>none</span>}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <input className="input" style={{ flex: 1, minWidth: 0, height: 32 }} value={draft} maxLength={80} placeholder={`Add a ${one}…`} aria-label={`New ${one}`}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" className="btn sm" onClick={add} disabled={!draft.trim()} aria-label={`Add ${one}`}><Plus size={13} />Add</button>
      </div>
    </div>
  );
}

/* DL-75: Propose a change (improvement cycle 5, api mode). Starts from the agent's active version; edits the model,
   skills and tools; asks for a hypothesis; shows the base → candidate diff live. Another administrator promotes it. */
function AgentVersionPropose({ close, props }: DialogComponentProps<{ agentId?: string }>) {
  useAgentsCatalog();
  const api_ = isApi();
  const a = AGENT_BY_ID[props.agentId ?? ''] ?? AGENTS[1];
  const detail = useAgentDetail(api_ ? a.id : null);
  // demo mode has no server versions: the dialog shows the editor from the catalog and cannot submit
  const base: (VersionConfig & { versionId: string; label: string }) | null = useMemo(() => {
    if (!api_) return { model: a.model, skills: a.skills, tools: (a as { tools?: string[] }).tools ?? [], versionId: '', label: a.version };
    const d = detail.data;
    return d ? { model: d.model, skills: d.skills, tools: d.tools, versionId: d.versionId, label: d.versionLabel } : null;
  }, [api_, a, detail.data]);
  const [cand, setCand] = useState<VersionConfig | null>(null);
  const opened = useRef<string | null>(null);
  useEffect(() => { if (base && opened.current === null) { opened.current = base.versionId; setCand({ model: base.model, skills: [...base.skills], tools: [...base.tools] }); } }, [base]);
  const [title, setTitle] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [busy, setBusy] = useState(false);
  const [srvErr, setSrvErr] = useState<string | null>(null);
  const submitKey = useRef(newKey());
  const diff = base && cand ? versionDiff(base, cand) : null;
  const autoTitle = !diff || !diff.changed ? `New version of ${a.name}`
    : diff.model && !diff.skillsAdded.length && !diff.skillsRemoved.length ? `${a.name} on ${diff.model.to}`
    : diff.skillsAdded.length === 1 && !diff.skillsRemoved.length ? `${a.name}: add ${diff.skillsAdded[0]}`
    : `${a.name}: ${[diff.skillsAdded.length + diff.toolsAdded.length && `+${diff.skillsAdded.length + diff.toolsAdded.length}`, diff.skillsRemoved.length + diff.toolsRemoved.length && `−${diff.skillsRemoved.length + diff.toolsRemoved.length}`, diff.model && 'model'].filter(Boolean).join(' ')}`;
  const moved = api_ && base && opened.current && base.versionId !== opened.current; // someone changed the agent while this was open
  const err = !api_ ? 'Version proposals are stored on the server' : !base || !cand ? 'Loading the active version…' : !diff?.changed ? 'Change the model, a skill or a tool' : !hypothesis.trim() ? 'Say why it should be better (hypothesis)' : '';
  const set = (p: Partial<VersionConfig>) => { setSrvErr(null); setCand((c) => (c ? { ...c, ...p } : c)); };
  const submit = async () => {
    if (err || busy || !cand || !opened.current) return;
    setBusy(true); setSrvErr(null);
    const r = await createVersionProposal(a.id, { title: (title.trim() || autoTitle).slice(0, 120), hypothesis: hypothesis.trim(), candidate: cand, baseVersionId: opened.current }, submitKey.current);
    setBusy(false);
    if (!r.ok) { setSrvErr(r.message); submitKey.current = newKey(); return; }
    toast({ tone: 'success', title: 'Version proposal submitted', body: `${r.value.title}. Another administrator can now promote it.` });
    close();
  };
  return (
    <Modal title={`Propose a change to ${a.name}`} icon={GitBranchPlus} help="agent.version.propose" dialogId="DL-75" size="xl" onClose={close}
      sub="A candidate version from the active one. Another administrator reviews and promotes it; running missions stay on their pinned version."
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={!!err || busy} title={err || undefined} onClick={submit}>{busy ? <Loader2 size={14} className="spin" /> : <GitBranchPlus size={14} />}Submit proposal</button></>}>
      <div className="oa-diff-cols">
        <div className="col" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 10 }}>
            <RobotAvatar role={a.role} size={44} faceMode="face" />
            <div style={{ minWidth: 0 }}><b>{a.name}</b><div className="dim" style={{ fontSize: 12 }}>{ROLES[a.role]?.label ?? a.role} · {a.dept}</div></div>
            <span className="spacer" />
            {base ? <Chip hue={225} size="sm" className="mono" title="The active version this proposal starts from">from {base.label}</Chip> : <span role="status"><Chip hue={38} size="sm">loading…</Chip></span>}
          </div>
          {!api_ && <div className="oa-banner"><Info size={15} /><span>Version proposals are stored on the server. In demo mode this dialog only shows the editor.</span></div>}
          {detail.error && <div className="oa-banner" role="alert"><ShieldAlert size={15} /><span>The active version could not be read: {detail.error}</span><button className="btn sm" onClick={detail.retry}>Retry</button></div>}
          {moved && <div className="oa-banner" role="alert"><ShieldAlert size={15} /><span>{a.name} changed while this was open ({base!.label} is active now). Submitting will be refused: close and start again.</span></div>}
          {cand && <>
            <Field label="Model route" help="models.route"><select className="select" aria-label="Model route" value={cand.model} onChange={(e) => set({ model: e.target.value })}>{Array.from(new Set([base?.model ?? cand.model, ...MODELS])).map((m) => <option key={m}>{m}</option>)}</select></Field>
            <ListEditor label="Skills" items={cand.skills} onChange={(skills) => set({ skills })} help="agent.version.skills" />
            <ListEditor label="Tools" items={cand.tools} onChange={(tools) => set({ tools })} help="agent.version.tools" />
          </>}
        </div>
        <div className="col" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 8 }}><div className="section-label" style={{ margin: 0 }}>Before → after</div>{base && <Chip hue={225} size="sm" className="mono">{base.label}</Chip>}<ArrowRight size={12} className="dim" aria-hidden /><Chip hue={290} size="sm">candidate</Chip><HelpTrigger k="agent.version.diff" /></div>
          <div data-dialog-diff>{diff ? <VersionDiffView d={diff} empty="No change yet: edit the model, a skill or a tool." /> : <span className="dim" style={{ fontSize: 12.5 }} role="status">Loading…</span>}</div>
          <NoEvaluation />
          <Field label="Hypothesis" htmlFor="vp-hyp" required hint="Why should the candidate be better? Shown to the administrator who decides."><textarea id="vp-hyp" data-autofocus className="textarea" rows={3} maxLength={2000} value={hypothesis} onChange={(e) => { setSrvErr(null); setHypothesis(e.target.value); }} placeholder="e.g. Fewer review rounds on frontend tasks." /></Field>
          <Field label="Title" htmlFor="vp-title" hint={`Optional. Default: “${autoTitle}”`}><input id="vp-title" className="input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={autoTitle} /></Field>
          {err && api_ && base && <span className="dim" style={{ fontSize: 12 }} data-dialog-hint>{err}</span>}
          {srvErr && <div className="oa-banner" role="alert" data-dialog-error><ShieldAlert size={15} /><span>{srvErr}</span></div>}
        </div>
      </div>
    </Modal>
  );
}

/* DL-76: Roll back (improvement cycle 5, api mode). A NEW version with the chosen version's configuration becomes
   active; nothing is deleted. Asks for the reason (audited). */
function AgentRollback({ close, props }: DialogComponentProps<{ agentId?: string; versionId?: string }>) {
  useAgentsCatalog();
  const api_ = isApi();
  const a = AGENT_BY_ID[props.agentId ?? ''] ?? AGENTS[1];
  const detail = useAgentDetail(api_ ? a.id : null);
  const versions = detail.data?.versions ?? [];
  const target = versions.find((v) => v.id === props.versionId);
  const active = versions.find((v) => v.id === detail.data?.versionId);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [srvErr, setSrvErr] = useState<string | null>(null);
  const submitKey = useRef(newKey());
  const diff = active && target ? versionDiff(active, target) : null;
  const err = !api_ ? 'Rollbacks happen on the server' : !detail.data ? 'Loading versions…' : !target ? 'Choose a version in the Versions list' : target.id === active?.id ? 'This version is already active' : !why.trim() ? 'Give the reason (it is audited)' : '';
  const submit = async () => {
    if (err || busy || !target) return;
    setBusy(true); setSrvErr(null);
    const r = await rollbackAgent(a.id, target.id, why.trim(), submitKey.current);
    setBusy(false);
    if (!r.ok) { setSrvErr(r.message); submitKey.current = newKey(); return; }
    toast({ tone: 'success', title: `${a.name} rolled back`, body: `New version ${r.value.version.label} has the configuration of ${target.label}. Running instances keep their pinned versions.` });
    close();
  };
  return (
    <Modal title={`Roll back ${a.name}`} icon={RotateCcw} help="agent.version.rollback" dialogId="DL-76" size="md" tone="warn" onClose={close}
      sub="Adds a new version with the configuration of the one you chose and makes it active. No version is changed or deleted."
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={!!err || busy} title={err || undefined} onClick={submit}>{busy ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />}Roll back</button></>}>
      <div className="col" style={{ gap: 12 }}>
        {!api_ && <div className="oa-banner"><Info size={15} /><span>Rollbacks happen on the server. In demo mode this dialog only shows the form.</span></div>}
        {detail.error && <div className="oa-banner" role="alert"><ShieldAlert size={15} /><span>The versions could not be read: {detail.error}</span><button className="btn sm" onClick={detail.retry}>Retry</button></div>}
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="dim" style={{ fontSize: 12.5 }}>Active</span><Chip hue={145} size="sm" className="mono">{active?.label ?? a.version}</Chip>
          <ArrowRight size={13} className="dim" aria-hidden />
          <span className="dim" style={{ fontSize: 12.5 }}>configuration of</span><Chip hue={190} size="sm" className="mono">{target?.label ?? '—'}</Chip>
          <ArrowRight size={13} className="dim" aria-hidden />
          <span className="dim" style={{ fontSize: 12.5 }}>a new version</span>
        </div>
        <div data-dialog-diff>{diff ? <VersionDiffView d={diff} empty="Same configuration as the active version." /> : null}</div>
        <Field label="Reason" htmlFor="rb-why" required hint="Stored in the audit log with the rollback."><textarea id="rb-why" data-autofocus className="textarea" rows={3} maxLength={1000} value={why} onChange={(e) => { setSrvErr(null); setWhy(e.target.value); }} placeholder="e.g. The new skills made reviews slower." /></Field>
        {srvErr && <div className="oa-banner" role="alert" data-dialog-error><ShieldAlert size={15} /><span>{srvErr}</span></div>}
      </div>
    </Modal>
  );
}

export const dialogs = { 'agent-version-propose': AgentVersionPropose, 'agent-rollback': AgentRollback };
