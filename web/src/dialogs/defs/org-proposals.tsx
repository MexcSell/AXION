import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { GitPullRequest, ArrowRight, Plus, Minus, ShieldAlert, Loader2, Info } from 'lucide-react';
import type { OrgDryRun, OrgEdgeDto } from '@contracts';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Form';
import { Chip } from '@/components/ui/Chips';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { AGENTS, AGENT_BY_ID } from '@/data/agents';
import { isApi } from '@/api/mode';
import { useAgentsCatalog, useOrgGraph } from '@/api/agents';
import { createProposal, dryRunProposal, newKey } from '@/api/orgProposals';
import { DryRunView } from '@/features/agents/ServerProposals';
import { toast } from '@/store/ui';
import type { DialogComponentProps } from '@/dialogs/DialogHost';
import '@/theme/pages/overview-org-agent.css';

interface Change { agentId: string; managerId: string }
const name = (id: string) => AGENT_BY_ID[id]?.name ?? id;
/** api mode: the server's lifecycle (active | retired) rides along on the catalog's agents */
const active = (a: object) => (a as { lifecycle?: string }).lifecycle !== 'retired';

/* DL-66 — New organisation proposal (improvement cycle 1, api mode). Starts from the active org graph; each change
   gives one agent a new manager. The server's dry run (POST ?dryRun=1, stores nothing) is shown before submitting. */
function OrgProposalNew({ close }: DialogComponentProps) {
  useAgentsCatalog();
  const api_ = isApi();
  const org = useOrgGraph();
  // demo mode has no server graph: the dialog shows the fixture lines and cannot submit
  const base = useMemo(() => (api_ ? org.data : { revision: null, edges: AGENTS.filter((a) => a.managerId).map((a) => ({ supervisorId: a.managerId!, subordinateId: a.id, edgeType: 'reports_to' })) }), [api_, org.data]);
  const managerOf = (id: string) => base?.edges.find((e) => e.subordinateId === id)?.supervisorId;
  const [changes, setChanges] = useState<Change[]>([{ agentId: '', managerId: '' }]);
  const [title, setTitle] = useState('');
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [srvErr, setSrvErr] = useState<string | null>(null);
  const [dry, setDry] = useState<{ state: 'idle' | 'checking' | 'done' | 'error'; r?: OrgDryRun; msg?: string }>({ state: 'idle' });
  const submitKey = useRef(newKey());
  const staff = AGENTS.filter((a) => a.id !== 'gm' && active(a));

  const effective = changes.filter((c) => c.agentId && c.managerId && c.managerId !== managerOf(c.agentId));
  const edges: OrgEdgeDto[] = useMemo(() => {
    if (!base) return [];
    const over = new Map(effective.map((c) => [c.agentId, c.managerId]));
    const out = base.edges.map((e) => (over.has(e.subordinateId) ? { ...e, supervisorId: over.get(e.subordinateId)! } : e));
    for (const [sub, sup] of over) if (!base.edges.some((e) => e.subordinateId === sub)) out.push({ supervisorId: sup, subordinateId: sub, edgeType: 'reports_to' });
    return out;
  }, [base, JSON.stringify(effective)]); // eslint-disable-line react-hooks/exhaustive-deps
  const autoTitle = effective.length === 1 ? `Move ${name(effective[0].agentId)} under ${name(effective[0].managerId)}` : `${effective.length} reporting-line changes`;
  const body = () => ({ title: (title.trim() || autoTitle).slice(0, 120), why: why.trim(), baseRevision: base?.revision?.seq ?? 0, edges });

  // the server's dry run, re-run (debounced) whenever the proposed lines change
  const sig = JSON.stringify([base?.revision?.seq, edges]);
  useEffect(() => {
    if (!api_ || !base?.revision || effective.length === 0) { setDry({ state: 'idle' }); return; }
    const ac = new AbortController();
    setDry((d) => ({ ...d, state: 'checking' }));
    const t = window.setTimeout(async () => {
      const r = await dryRunProposal(body(), ac.signal);
      if (ac.signal.aborted) return;
      setDry(r.ok ? { state: 'done', r: r.value } : { state: 'error', msg: r.message });
    }, 300);
    return () => { ac.abort(); window.clearTimeout(t); };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (i: number, p: Partial<Change>) => { setSrvErr(null); setChanges(changes.map((c, k) => (k === i ? { ...c, ...p } : c))); };
  const err = !api_ ? 'Proposals are stored on the server' : !base?.revision ? 'The organisation chart is not loaded yet' : effective.length === 0 ? 'Choose an agent and a new manager' : '';
  const submit = async () => {
    if (err || busy) return;
    setBusy(true); setSrvErr(null);
    const r = await createProposal(body(), submitKey.current);
    setBusy(false);
    if (!r.ok) { setSrvErr(r.message); submitKey.current = newKey(); return; }
    toast({ tone: 'success', title: `Proposal ${r.value.id} submitted`, body: r.value.result.ok ? 'Another administrator can now approve it.' : 'Stored with its dry-run errors: it cannot be approved until they are fixed in a new proposal.' });
    close();
  };

  return (
    <Modal title="New organisation proposal" icon={GitPullRequest} help="org.proposal.new" dialogId="DL-66" size="xl" onClose={close}
      sub="Give agents a new manager. The server checks the whole chart now; another administrator approves it, which adds a new org revision. Running missions keep their teams."
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={!!err || busy} onClick={submit}>{busy ? <Loader2 size={14} className="spin" /> : <GitPullRequest size={14} />}Submit proposal</button></>}>
      <div className="oa-diff-cols">
        <div className="col" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <div className="section-label" style={{ margin: 0 }}>Changes</div>
            {base?.revision ? <Chip hue={225} size="sm">from org revision {base.revision.seq}</Chip> : api_ ? <Chip hue={38} size="sm">loading chart…</Chip> : null}
            <HelpTrigger k="org.proposal.changes" />
          </div>
          {!api_ && <div className="oa-banner"><Info size={15} /><span>Proposals are stored on the server. In demo mode this dialog only shows the pickers.</span></div>}
          {changes.map((c, i) => {
            const cur = c.agentId ? managerOf(c.agentId) : undefined;
            return (
              <motion.div key={i} className="oa-move oa-chg" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <select className="select" style={{ width: '100%' }} aria-label={`Agent ${i + 1}`} value={c.agentId} onChange={(e) => set(i, { agentId: e.target.value, managerId: '' })}>
                  <option value="">Agent…</option>
                  {staff.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <span className="dim" style={{ fontSize: 11 }}>now</span>
                <Chip hue={225} size="sm">{cur ? name(cur) : '—'}</Chip>
                <ArrowRight size={13} className="dim oa-chg-arrow" aria-hidden />
                <select className="select" style={{ width: '100%' }} aria-label={`New manager ${i + 1}`} value={c.managerId} disabled={!c.agentId} onChange={(e) => set(i, { managerId: e.target.value })}>
                  <option value="">New manager…</option>
                  {AGENTS.filter((a) => a.id !== c.agentId && active(a)).map((a) => <option key={a.id} value={a.id} disabled={a.id === cur}>{a.name}</option>)}
                </select>
                <button className="icon-btn" aria-label={`Remove change ${i + 1}`} disabled={changes.length === 1} onClick={() => setChanges(changes.filter((_, k) => k !== i))}><Minus size={14} /></button>
              </motion.div>
            );
          })}
          <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setChanges([...changes, { agentId: '', managerId: '' }])}><Plus size={14} />Add change</button>
          <Field label="Title" htmlFor="op-title" hint={`Optional. Default: “${autoTitle}”`}><input id="op-title" className="input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={autoTitle} /></Field>
          <Field label="Why" htmlFor="op-why" hint="Optional. Shown to the administrator who decides."><textarea id="op-why" className="textarea" rows={3} maxLength={2000} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="What gets better with this reporting line?" /></Field>
        </div>
        <div className="col" style={{ gap: 10 }} data-dialog-dry-run={dry.state}>
          <div className="row" style={{ gap: 8 }}><div className="section-label" style={{ margin: 0 }}>Server dry run</div><HelpTrigger k="org.proposal.dryRun" /></div>
          {dry.state === 'idle' && <span className="dim" style={{ fontSize: 12.5 }}>Pick a change: the server checks the whole chart (unknown agents, self-management, loops, two managers, agents left without a manager) and lists the lines added and removed.</span>}
          {dry.state === 'checking' && <span className="dim row" style={{ gap: 6, fontSize: 12.5 }}><Loader2 size={13} className="spin" />Checking on the server…</span>}
          {dry.state === 'error' && <div className="oa-banner" role="alert"><ShieldAlert size={15} /><span>{dry.msg}</span></div>}
          {dry.r && dry.state !== 'error' && <div style={{ opacity: dry.state === 'checking' ? .55 : 1, transition: 'opacity .2s' }}><DryRunView r={dry.r} max={20} /></div>}
          {effective.length > 0 && (
            <div className="col" style={{ gap: 6 }}>
              {effective.map((c) => (
                <div key={c.agentId} className="row" style={{ gap: 8, fontSize: 12.5 }}>
                  {AGENT_BY_ID[c.agentId] && <RobotAvatar role={AGENT_BY_ID[c.agentId].role} size={24} />}
                  <b>{name(c.agentId)}</b><span className="dim">will report to</span><b>{name(c.managerId)}</b>
                </div>
              ))}
            </div>
          )}
          {srvErr && <div className="oa-banner" role="alert"><ShieldAlert size={15} /><span>{srvErr}</span></div>}
        </div>
      </div>
    </Modal>
  );
}

export const dialogs = { 'org-proposal-new': OrgProposalNew };
