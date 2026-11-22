import { useRef, useState } from 'react';
import { motion } from 'motion/react';
import { BookMarked, Check, X, Plus, Wand2, Undo2, ShieldAlert, Info, Loader2, AlertOctagon, Minus } from 'lucide-react';
import type { LessonCandidateDto, SourceKind, SourceRef } from '@contracts';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Form';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { AGENT_BY_ID, AGENTS } from '@/data/agents';
import { isApi } from '@/api/mode';
import { useAgentsCatalog } from '@/api/agents';
import { usePlaybook, usePlaybookDiff, proposeLesson, decideLesson, rollbackPlaybook, proposeSkill, newKey } from '@/api/playbooks';
import { SourceChips, SRC_LABEL } from '@/features/agents/Playbooks';
import { toast } from '@/store/ui';
import type { DialogComponentProps } from '@/dialogs/DialogHost';
import '@/theme/pages/overview-org-agent.css';

/* Improvement cycle 41: dialogs of the playbook panel (DL-92 propose a lesson, DL-93 accept or reject, DL-94 roll back, DL-95
   propose a skill). Each opens with no props (demo mode shows the form only) and checks nothing the server does not check again. */

const KINDS = Object.keys(SRC_LABEL) as SourceKind[];

/** One to ten sources: a kind and an id each (a mission id is checked by the server against what you can see). */
function SourcesEditor({ rows, onChange, error }: { rows: SourceRef[]; onChange: (r: SourceRef[]) => void; error?: string }) {
  const set = (i: number, p: Partial<SourceRef>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <div className="col" style={{ gap: 6 }} data-sources-editor>
      <div className="row" style={{ gap: 6 }}><div className="section-label" style={{ margin: 0 }}>Sources ({rows.filter((r) => r.id.trim()).length}, at least 1)</div><HelpTrigger k="playbook.sources" /></div>
      {rows.map((r, i) => (
        <motion.div key={i} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="row" style={{ gap: 6 }}>
          <select className="select" style={{ width: 130, height: 32 }} aria-label={`Source ${i + 1} kind`} value={r.kind} onChange={(e) => set(i, { kind: e.target.value as SourceKind })}>
            {KINDS.map((k) => <option key={k} value={k}>{SRC_LABEL[k]}</option>)}
          </select>
          <input className="input" style={{ flex: 1, minWidth: 0, height: 32 }} aria-label={`Source ${i + 1} id`} maxLength={80} value={r.id} placeholder={r.kind === 'mission' ? 'M-126' : 'an id or short name'} onChange={(e) => set(i, { id: e.target.value })} />
          <button type="button" className="icon-btn" style={{ width: 24, height: 24 }} aria-label={`Remove source ${i + 1}`} disabled={rows.length === 1} onClick={() => onChange(rows.filter((_, j) => j !== i))}><X size={12} /></button>
        </motion.div>
      ))}
      <div><button type="button" className="btn sm" disabled={rows.length >= 10} onClick={() => onChange([...rows, { kind: 'note', id: '' }])} aria-label="Add source"><Plus size={13} />Add source</button></div>
      {error && <span className="dim" style={{ fontSize: 12 }}>{error}</span>}
    </div>
  );
}
const cleanSources = (rows: SourceRef[]): SourceRef[] => rows.filter((r) => r.id.trim()).map((r) => ({ kind: r.kind, id: r.id.trim() }));
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

/* DL-92 */
function LessonPropose({ close, props }: DialogComponentProps<{ agentId?: string }>) {
  useAgentsCatalog();
  const api_ = isApi();
  const a = AGENT_BY_ID[props.agentId ?? ''] ?? AGENT_BY_ID['coder-01'] ?? AGENTS[0];
  const [text, setText] = useState('');
  const [rows, setRows] = useState<SourceRef[]>([{ kind: 'review', id: '' }]);
  const [reviewBy, setReviewBy] = useState('');
  const [busy, setBusy] = useState(false);
  const [srvErr, setSrvErr] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const key = useRef(newKey());
  const src = cleanSources(rows);
  const err = !api_ ? 'Lessons are stored on the server' : !text.trim() ? 'Write the lesson' : src.length === 0 ? 'Add at least one source' : '';
  const touch = () => { setSrvErr(null); setFields({}); };
  const submit = async () => {
    if (err || busy) return;
    setBusy(true); touch();
    const r = await proposeLesson(a.id, { text: text.trim(), sources: src, ...(reviewBy ? { reviewBy } : {}) }, key.current);
    setBusy(false);
    if (!r.ok) { setSrvErr(r.message); setFields(r.fieldErrors ?? {}); key.current = newKey(); return; }
    toast({ tone: 'success', title: 'Lesson proposed', body: `It waits in Candidates for ${a.name}. A different administrator accepts or rejects it.` });
    close();
  };
  return (
    <Modal title={`Propose a lesson for ${a.name}`} icon={BookMarked} help="playbook.propose" dialogId="DL-92" size="lg" onClose={close}
      sub="One or two sentences, with the evidence behind them. A different person accepts it before it counts."
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={!!err || busy} title={err || undefined} onClick={submit}>{busy ? <Loader2 size={14} className="spin" /> : <BookMarked size={14} />}Submit lesson</button></>}>
      <div className="col" style={{ gap: 12 }}>
        {!api_ && <div className="oa-banner"><Info size={15} /><span>Lessons are stored on the server. In demo mode this dialog only shows the form.</span></div>}
        <Field label="Lesson" help="playbook.propose" htmlFor="lc-text" required error={fields.text} hint={`${text.length} of 600 characters`}>
          <textarea id="lc-text" data-autofocus className="input" rows={3} maxLength={600} value={text} onChange={(e) => { touch(); setText(e.target.value); }} placeholder="e.g. Keep pull requests under 300 changed lines." />
        </Field>
        <div className="oa-diff-cols">
          <SourcesEditor rows={rows} onChange={(r) => { touch(); setRows(r); }} error={fields.sources} />
          <Field label="Review by (optional)" help="playbook.reviewBy" htmlFor="lc-review" error={fields.reviewBy} hint="After this date the item shows “needs re-review”. The server checks the date.">
            <input id="lc-review" className="input" type="date" value={reviewBy} onChange={(e) => { touch(); setReviewBy(e.target.value); }} />
          </Field>
        </div>
        {srvErr && <div className="oa-banner" role="alert" data-dialog-error><ShieldAlert size={15} /><span>{srvErr}</span></div>}
      </div>
    </Modal>
  );
}

/* DL-93 */
function LessonDecide({ close, props }: DialogComponentProps<{ lesson?: LessonCandidateDto; mode?: 'accept' | 'reject'; baseVersion?: number }>) {
  const l = props.lesson;
  const accept = props.mode !== 'reject';
  const [note, setNote] = useState('');
  const [override, setOverride] = useState('');
  const [busy, setBusy] = useState(false);
  const [srvErr, setSrvErr] = useState<string | null>(null);
  const flagged = (l?.conflicts.length ?? 0) > 0;
  const err = !l ? 'Open this dialog from a candidate in Playbooks and skills' : accept && flagged && !override.trim() ? 'An override note is required: this contradicts an existing item' : !accept && !note.trim() ? 'Say why it is rejected' : '';
  const submit = async () => {
    if (err || busy || !l) return;
    setBusy(true); setSrvErr(null);
    const r = await decideLesson(l.id, accept ? { decision: 'accept', baseVersion: props.baseVersion ?? 0, ...(note.trim() ? { note: note.trim() } : {}), ...(flagged ? { overrideNote: override.trim() } : {}) } : { decision: 'reject', note: note.trim() });
    setBusy(false);
    if (!r.ok) { setSrvErr(r.message); return; }
    toast({ tone: 'success', title: accept ? `Lesson accepted: playbook v${r.value.playbook?.version ?? ''}` : 'Lesson rejected' });
    close();
  };
  return (
    <Modal title={accept ? 'Accept this lesson' : 'Reject this lesson'} icon={accept ? Check : X} help="playbook.accept" dialogId="DL-93" size="md" onClose={close}
      sub={accept ? `Adds it to the playbook of ${l?.agentName ?? 'the agent'} as version ${(props.baseVersion ?? 0) + 1}.` : 'The lesson stays in the history with your reason.'}
      footer={<><button className="btn" onClick={close}>Cancel</button><button className={accept ? 'btn primary' : 'btn'} disabled={!!err || busy} title={err || undefined} onClick={submit}>{busy ? <Loader2 size={14} className="spin" /> : accept ? <Check size={14} /> : <X size={14} />}{accept ? 'Accept lesson' : 'Reject lesson'}</button></>}>
      <div className="col" style={{ gap: 12 }}>
        {l ? <div className="subpanel glass-card" style={{ padding: 10 }} data-decide-lesson={l.id}>
          <div style={{ fontSize: 13.5 }}>{l.text}</div>
          <div className="row wrap" style={{ gap: 6, marginTop: 6 }}><span className="dim" style={{ fontSize: 11.5 }}>by {l.proposedByName}</span><SourceChips sources={l.sources} /></div>
        </div> : <div className="oa-banner"><Info size={15} /><span>Choose Accept or Reject on a candidate lesson to decide it.</span></div>}
        {flagged && accept && (
          <div className="oa-banner" role="alert" data-contradiction-banner><AlertOctagon size={15} /><span>This seems to contradict “{l!.conflicts[0].text}”{l!.conflicts.length > 1 ? ` and ${l!.conflicts.length - 1} more` : ''}.</span><HelpTrigger k="playbook.contradiction" /></div>
        )}
        {flagged && accept && (
          <Field label="Override note" help="playbook.override" htmlFor="ld-override" required hint="Why both can stand, or why this one wins. Stored with the item.">
            <input id="ld-override" className="input" maxLength={1000} value={override} onChange={(e) => setOverride(e.target.value)} />
          </Field>
        )}
        <Field label={accept ? 'Note (optional)' : 'Reason'} htmlFor="ld-note" required={!accept}>
          <input id="ld-note" data-autofocus className="input" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {srvErr && <div className="oa-banner" role="alert" data-dialog-error><ShieldAlert size={15} /><span>{srvErr}</span></div>}
      </div>
    </Modal>
  );
}

/* DL-94 */
function PlaybookRollback({ close, props }: DialogComponentProps<{ agentId?: string; toVersion?: number }>) {
  useAgentsCatalog();
  const api_ = isApi();
  const a = AGENT_BY_ID[props.agentId ?? ''] ?? AGENT_BY_ID['coder-01'] ?? AGENTS[0];
  const pb = usePlaybook(a.id);
  const cur = pb.data?.playbook.version ?? null;
  const to = props.toVersion ?? null;
  const diff = usePlaybookDiff(a.id, api_ && cur !== null && to !== null ? cur : null, api_ ? to : null);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [srvErr, setSrvErr] = useState<string | null>(null);
  const err = !api_ ? 'Playbooks are stored on the server' : to === null ? 'Choose a version in History' : cur === null ? 'Loading the playbook' : to >= cur ? 'Choose an older version' : !why.trim() ? 'Say why you roll back' : '';
  const submit = async () => {
    if (err || busy || to === null || cur === null) return;
    setBusy(true); setSrvErr(null);
    const r = await rollbackPlaybook(a.id, { toVersion: to, baseVersion: cur, why: why.trim() });
    setBusy(false);
    if (!r.ok) { setSrvErr(r.message); return; }
    toast({ tone: 'success', title: `Playbook rolled back: version ${r.value.playbook.version}`, body: `It holds the same items as version ${to}. Nothing was deleted.` });
    close();
  };
  return (
    <Modal title={`Roll back the playbook of ${a.name}`} icon={Undo2} help="playbook.rollback" dialogId="DL-94" size="md" onClose={close}
      sub={to !== null && cur !== null ? `Creates version ${cur + 1} with the items of version ${to}. The versions between stay in the history.` : 'Creates a new version with the items of an older one. Nothing is deleted.'}
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={!!err || busy} title={err || undefined} onClick={submit}>{busy ? <Loader2 size={14} className="spin" /> : <Undo2 size={14} />}Roll back</button></>}>
      <div className="col" style={{ gap: 12 }}>
        {!api_ && <div className="oa-banner"><Info size={15} /><span>Playbooks are stored on the server. In demo mode this dialog only shows the form.</span></div>}
        {diff.data && (
          <div className="oa-lines" data-rollback-diff style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
            {diff.data.added.map((i) => <span key={'a' + i.lessonId} className="oa-line add"><Plus size={11} aria-label="comes back" /><b>{i.text}</b></span>)}
            {diff.data.removed.map((i) => <span key={'r' + i.lessonId} className="oa-line rm"><Minus size={11} aria-label="goes away" /><b>{i.text}</b></span>)}
            {!diff.data.added.length && !diff.data.removed.length && <span className="dim" style={{ fontSize: 12 }}>No item changes.</span>}
          </div>
        )}
        <Field label="Why" htmlFor="pr-why" required hint="Kept in the audit trail.">
          <input id="pr-why" data-autofocus className="input" maxLength={1000} value={why} onChange={(e) => setWhy(e.target.value)} />
        </Field>
        {srvErr && <div className="oa-banner" role="alert" data-dialog-error><ShieldAlert size={15} /><span>{srvErr}</span></div>}
      </div>
    </Modal>
  );
}

/* DL-95 */
function SkillPropose({ close }: DialogComponentProps<Record<string, never>>) {
  const api_ = isApi();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState('');
  const [pre, setPre] = useState('');
  const [rows, setRows] = useState<SourceRef[]>([{ kind: 'review', id: '' }]);
  const [busy, setBusy] = useState(false);
  const [srvErr, setSrvErr] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const key = useRef(newKey());
  const src = cleanSources(rows);
  const err = !api_ ? 'Skills are stored on the server' : !name.trim() ? 'Name the skill' : !description.trim() ? 'Describe the skill' : lines(steps).length === 0 ? 'Add at least one step' : src.length === 0 ? 'Add at least one source' : '';
  const touch = () => { setSrvErr(null); setFields({}); };
  const submit = async () => {
    if (err || busy) return;
    setBusy(true); touch();
    const r = await proposeSkill({ name: name.trim(), description: description.trim(), steps: lines(steps), preconditions: lines(pre), sources: src }, key.current);
    setBusy(false);
    if (!r.ok) { setSrvErr(r.message); setFields(r.fieldErrors ?? {}); key.current = newKey(); return; }
    toast({ tone: 'success', title: 'Skill proposed', body: `${r.value.skill.name} v${r.value.skill.version} is a draft until another administrator approves it.` });
    close();
  };
  return (
    <Modal title="Propose a skill" icon={Wand2} help="skills.panel" dialogId="DL-95" size="lg" onClose={close}
      sub="A named list of plain steps. It is only a description: text that looks like code is refused."
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={!!err || busy} title={err || undefined} onClick={submit}>{busy ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />}Submit skill</button></>}>
      <div className="col" style={{ gap: 12 }}>
        {!api_ && <div className="oa-banner"><Info size={15} /><span>Skills are stored on the server. In demo mode this dialog only shows the form.</span></div>}
        <div className="oa-diff-cols">
          <div className="col" style={{ gap: 12 }}>
            <Field label="Name" htmlFor="sk-name" required error={fields.name} hint="A new proposal with an existing name becomes its next version.">
              <input id="sk-name" data-autofocus className="input" maxLength={80} value={name} onChange={(e) => { touch(); setName(e.target.value); }} placeholder="e.g. Triage a failing check" />
            </Field>
            <Field label="Description" htmlFor="sk-desc" required error={fields.description}>
              <input id="sk-desc" className="input" maxLength={500} value={description} onChange={(e) => { touch(); setDescription(e.target.value); }} />
            </Field>
            <Field label="Preconditions (one per line, optional)" help="skills.preconditions" htmlFor="sk-pre" error={fields.preconditions}>
              <textarea id="sk-pre" className="input" rows={2} value={pre} onChange={(e) => { touch(); setPre(e.target.value); }} />
            </Field>
          </div>
          <div className="col" style={{ gap: 12 }}>
            <Field label={`Steps (one per line, ${lines(steps).length} of 20)`} help="skills.steps" htmlFor="sk-steps" required error={fields.steps}>
              <textarea id="sk-steps" className="input" rows={5} value={steps} onChange={(e) => { touch(); setSteps(e.target.value); }} placeholder={'Open the report\nName the failing selector'} />
            </Field>
            <SourcesEditor rows={rows} onChange={(r) => { touch(); setRows(r); }} error={fields.sources} />
          </div>
        </div>
        {srvErr && <div className="oa-banner" role="alert" data-dialog-error><ShieldAlert size={15} /><span>{srvErr}</span></div>}
      </div>
    </Modal>
  );
}

export const dialogs = { 'lesson-propose': LessonPropose, 'lesson-decide': LessonDecide, 'playbook-rollback': PlaybookRollback, 'skill-propose': SkillPropose };
