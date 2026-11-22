import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ScrollText, Plus, X, ShieldAlert, Info, Loader2, Save, RefreshCw, GitMerge } from 'lucide-react';
import { diffLedgers, FACT_GROUPS, FACT_LABEL, type LedgerChange, LEDGER_LIMITS, STEP_STATUSES, type Fact, type FactGroup, type LedgerDto, type LedgerKind, type ProgressBody, type Step, type TaskBody } from '@contracts';
import { Modal } from '@/components/ui/Modal';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Field, Switch } from '@/components/ui/Form';
import { isApi } from '@/api/mode';
import { fetchLedgerBody, latestLedger, saveLedger } from '@/api/ledgers';
import { toast } from '@/store/ui';
import type { DialogComponentProps } from '@/dialogs/DialogHost';
import '@/theme/pages/c39-ledgers.css';

/* DL-91: edit a mission ledger (cycle 39). A save is a new version made from the version you loaded (baseVersion). If someone
   saved meanwhile the server answers 409 and this dialog offers to load their version or to keep yours on top of it. */
const L = LEDGER_LIMITS;
const toLines = (fs: Fact[]) => fs.map((f) => (f.source ? `${f.text} | ${f.source}` : f.text)).join('\n');
const fromLines = (s: string): Fact[] => s.split('\n').map((x) => x.trim()).filter(Boolean).map((x) => {
  const i = x.indexOf(' | ');
  return i > 0 && x.slice(i + 3).trim() ? { text: x.slice(0, i).trim(), source: x.slice(i + 3).trim() } : { text: x };
});
interface TaskForm { facts: Record<FactGroup, string>; steps: Step[] }
const emptyTask = (): TaskForm => ({ facts: { given: '', to_look_up: '', to_derive: '', guesses: '' }, steps: [] });
const taskForm = (b: TaskBody): TaskForm => ({ facts: Object.fromEntries(FACT_GROUPS.map((g) => [g, toLines(b.facts[g])])) as Record<FactGroup, string>, steps: b.steps.map((s) => ({ ...s })) });
const taskBody = (f: TaskForm): TaskBody => ({
  facts: Object.fromEntries(FACT_GROUPS.map((g) => [g, fromLines(f.facts[g])])) as Record<FactGroup, Fact[]>,
  steps: f.steps.filter((s) => s.text.trim()).map((s) => ({ id: s.id, text: s.text.trim(), ...(s.owner?.trim() ? { owner: s.owner.trim() } : {}), status: s.status })),
});
type ProgForm = { satisfied: boolean; looping: boolean; progressing: boolean; next_speaker: string; next_instruction: string; notes: string };
const emptyProg = (): ProgForm => ({ satisfied: false, looping: false, progressing: true, next_speaker: '', next_instruction: '', notes: '' });
const progForm = (b: ProgressBody): ProgForm => ({ satisfied: b.satisfied, looping: b.looping, progressing: b.progressing, next_speaker: b.next_speaker ?? '', next_instruction: b.next_instruction ?? '', notes: b.notes });
const progBody = (f: ProgForm) => ({ satisfied: f.satisfied, looping: f.looping, progressing: f.progressing, ...(f.next_speaker.trim() ? { next_speaker: f.next_speaker.trim() } : {}), ...(f.next_instruction.trim() ? { next_instruction: f.next_instruction.trim() } : {}), notes: f.notes.trim() });

function LedgerEdit({ close, props }: DialogComponentProps<{ missionId?: string; kind?: LedgerKind }>) {
  const api_ = isApi();
  const kind: LedgerKind = props.kind === 'progress' ? 'progress' : 'task';
  const missionId = props.missionId ?? '';
  const [loaded, setLoaded] = useState(!api_ || !missionId);
  const [base, setBase] = useState(0);
  const [task, setTask] = useState<TaskForm>(emptyTask);
  const [prog, setProg] = useState<ProgForm>(emptyProg);
  const [orig, setOrig] = useState('');
  const [busy, setBusy] = useState(false);
  const [srvErr, setSrvErr] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<LedgerDto | null | 'gone'>(null);
  const [rebased, setRebased] = useState(false);
  const [theirChanges, setTheirChanges] = useState<LedgerChange[] | null>(null);
  const adopt = (l: LedgerDto | null) => {
    if (kind === 'task') { const f = l ? taskForm(l.body as TaskBody) : emptyTask(); setTask(f); setOrig(JSON.stringify(taskBody(f))); }
    else { const f = l ? progForm(l.body as ProgressBody) : emptyProg(); setProg(f); setOrig(JSON.stringify(progBody(f))); }
    setBase(l?.version ?? 0);
  };
  useEffect(() => {
    if (!api_ || !missionId) return;
    let live = true;
    latestLedger(missionId).then((r) => { if (!live) return; if (r) adopt(r[kind]); else setSrvErr('Could not load the current ledger. Close this dialog and try again.'); setLoaded(true); });
    return () => { live = false; };
  }, [missionId, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const body = useMemo(() => (kind === 'task' ? taskBody(task) : progBody(prog)), [kind, task, prog]);
  const changed = JSON.stringify(body) !== orig;
  const stepTextBad = kind === 'task' && task.steps.some((s) => !s.text.trim() && s.owner?.trim());
  const err = !api_ ? 'Ledgers are stored on the server' : !missionId ? 'No mission selected' : !loaded ? 'Loading the current version' : !changed && !rebased ? 'Nothing changed' : stepTextBad ? 'A step needs its text' : conflict && !rebased ? 'Someone saved meanwhile: choose how to continue' : '';
  const touch = () => { setSrvErr(null); setFields({}); };
  const submit = async () => {
    if (err || busy) return;
    setBusy(true); touch();
    const r = await saveLedger(missionId, kind, base, body);
    setBusy(false);
    if (r.ok) { toast({ tone: 'success', title: `${kind === 'task' ? 'Task' : 'Progress'} ledger saved`, body: `Version ${r.value.version} is now the current one.` }); close(); return; }
    if (r.code === 'LEDGER_CONFLICT') {
      const l = await latestLedger(missionId);
      const their = l ? l[kind] : null;
      setConflict(their ?? 'gone'); setRebased(false); setTheirChanges(null);
      // what the other session changed since the version I started from
      const mine = base > 0 ? await fetchLedgerBody(missionId, kind, base) : null;
      const none = kind === 'task' ? { facts: { given: [], to_look_up: [], to_derive: [], guesses: [] }, steps: [] } : { satisfied: false, looping: false, progressing: false, notes: '', stall: 0 };
      if (their) setTheirChanges(diffLedgers(kind, (mine?.body ?? none) as never, their.body as never));
      return;
    }
    setSrvErr(r.message); setFields(r.fieldErrors ?? {});
  };
  const loadTheirs = () => { if (conflict && conflict !== 'gone') adopt(conflict); setConflict(null); setRebased(false); };
  const keepMine = () => { setBase(conflict && conflict !== 'gone' ? conflict.version : 0); setRebased(true); };
  const theirs = conflict && conflict !== 'gone' ? conflict : null;
  const setStep = (i: number, p: Partial<Step>) => { touch(); setTask((t) => ({ ...t, steps: t.steps.map((s, j) => (j === i ? { ...s, ...p } : s)) })); };
  const addStep = () => setTask((t) => {
    const used = new Set(t.steps.map((s) => s.id)); let n = t.steps.length + 1; while (used.has(`s${n}`)) n++;
    return { ...t, steps: [...t.steps, { id: `s${n}`, text: '', status: 'todo' }] };
  });
  const title = kind === 'task' ? 'Edit the task ledger' : 'Check in on progress';
  return (
    <Modal title={title} icon={ScrollText} help="ledger.edit" dialogId="DL-91" size="lg" onClose={close}
      sub={kind === 'task' ? 'Facts the team holds and the plan. Saving makes a new version; older versions stay.' : 'Is the request satisfied, is the team looping, is it moving, and who acts next. The stall counter is worked out by the server.'}
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={!!err || busy} title={err || undefined} onClick={submit}>{busy ? <Loader2 size={14} className="spin" /> : <Save size={14} />}Save version {base + 1}</button></>}>
      <div className="ld-ed" data-ledger-editor={kind}>
        {!api_ && <div className="oa-banner"><Info size={15} /><span>Ledgers are stored on the server. In demo mode this dialog only shows the form.</span></div>}
        {conflict && (
          <div className="oa-banner ld-conflict" role="alert" data-ledger-conflict>
            <div className="row"><ShieldAlert size={15} /><span>{theirs ? <>Someone saved <b>version {theirs.version}</b> ({theirs.authorName}) while you were editing.</> : 'The ledger changed while you were editing.'}</span></div>
            {theirChanges && theirChanges.length > 0 && (
              <ul className="ld-conf-diff" data-ledger-conflict-diff aria-label="What the other session changed">
                {theirChanges.slice(0, 8).map((c, i) => <li key={i} data-change={c.change}><b>{c.label}</b> {c.change === 'changed' ? <>{c.from || 'empty'} to {c.to || 'empty'}</> : c.change === 'added' ? <>added: {c.to}</> : <>removed: {c.from}</>}</li>)}
                {theirChanges.length > 8 && <li className="dim">and {theirChanges.length - 8} more</li>}
              </ul>
            )}
            {!rebased && <div className="row">
              <button className="btn sm" onClick={loadTheirs}><RefreshCw size={13} />Load their version (drop my edit)</button>
              <button className="btn sm" onClick={keepMine}><GitMerge size={13} />Save mine as the next version</button>
            </div>}
            {rebased && <span className="dim" style={{ fontSize: 12 }}>Your form will become version {(theirs?.version ?? 0) + 1}. Version {theirs?.version ?? 0} stays in History, but its changes are not in yours.</span>}
          </div>
        )}
        {kind === 'task' ? (<>
          <div className="ld-groups">
            {FACT_GROUPS.map((g) => (
              <Field key={g} label={FACT_LABEL[g]} help={`ledger.fact.${g}`} htmlFor={`ld-${g}`} error={fields[`body.facts.${g}`]} hint={g === 'given' ? 'One per line. Add a source after " | ".' : undefined}>
                <textarea id={`ld-${g}`} className="textarea" value={task.facts[g]} disabled={!loaded} maxLength={L.factsPerGroup * (L.factText + L.factSource + 4)} onChange={(e) => { touch(); setTask((t) => ({ ...t, facts: { ...t.facts, [g]: e.target.value } })); }} />
              </Field>
            ))}
          </div>
          <div className="col" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 6 }}><div className="section-label" style={{ margin: 0 }}>Plan ({task.steps.length} of {L.steps} steps)</div></div>
            <div className="ld-steps" data-ledger-steps>
              {task.steps.map((s, i) => (
                <motion.div key={s.id} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="ld-step">
                  <span className="dim tnum">{s.id}</span>
                  <input className="input" value={s.text} maxLength={L.stepText} aria-label={`Step ${s.id} text`} placeholder="What needs to happen" onChange={(e) => setStep(i, { text: e.target.value })} />
                  <input className="input owner" value={s.owner ?? ''} maxLength={L.stepOwner} aria-label={`Step ${s.id} owner`} placeholder="Owner (optional)" onChange={(e) => setStep(i, { owner: e.target.value })} />
                  <select className="select" value={s.status} aria-label={`Step ${s.id} status`} onChange={(e) => setStep(i, { status: e.target.value as Step['status'] })}>{STEP_STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}</select>
                  <button type="button" className="icon-btn" style={{ width: 24, height: 24 }} aria-label={`Remove step ${s.id}`} onClick={() => { touch(); setTask((t) => ({ ...t, steps: t.steps.filter((_, j) => j !== i) })); }}><X size={12} /></button>
                </motion.div>
              ))}
            </div>
            <div><button type="button" className="btn sm" disabled={task.steps.length >= L.steps || !loaded} onClick={addStep} aria-label="Add step"><Plus size={13} />Add step</button></div>
          </div>
        </>) : (<>
          <div className="ld-switches">
            {([['satisfied', 'Request satisfied', 'ledger.satisfied'], ['looping', 'Team is looping', 'ledger.looping'], ['progressing', 'Making progress', 'ledger.progressing']] as const).map(([k, label, help]) => (
              <div key={k} className="ld-sw"><Switch checked={prog[k]} label={label} disabled={!loaded} onChange={(v) => { touch(); setProg((p) => ({ ...p, [k]: v })); }} /><span>{label}</span><HelpTrigger k={help} /></div>
            ))}
          </div>
          <div className="ld-groups">
            <Field label="Next speaker" help="ledger.next" htmlFor="ld-speaker" error={fields['body.next_speaker']}><input id="ld-speaker" className="input" value={prog.next_speaker} maxLength={L.nextSpeaker} disabled={!loaded} onChange={(e) => { touch(); setProg((p) => ({ ...p, next_speaker: e.target.value })); }} placeholder="e.g. gm" /></Field>
            <Field label="Instruction" help="ledger.next" htmlFor="ld-instr" error={fields['body.next_instruction']}><input id="ld-instr" className="input" value={prog.next_instruction} maxLength={L.nextInstruction} disabled={!loaded} onChange={(e) => { touch(); setProg((p) => ({ ...p, next_instruction: e.target.value })); }} placeholder="What should they do next" /></Field>
          </div>
          <Field label="Notes" help="ledger.progress" htmlFor="ld-notes" error={fields['body.notes']}><textarea id="ld-notes" className="textarea" value={prog.notes} maxLength={L.notes} disabled={!loaded} onChange={(e) => { touch(); setProg((p) => ({ ...p, notes: e.target.value })); }} /></Field>
        </>)}
        {err && api_ && loaded && <span className="dim" style={{ fontSize: 12 }} data-dialog-hint>{err}</span>}
        {srvErr && <div className="oa-banner" role="alert" data-dialog-error><ShieldAlert size={15} /><span>{srvErr}{Object.entries(fields).length > 0 && <> {Object.entries(fields).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join('; ')}</>}</span></div>}
      </div>
    </Modal>
  );
}

export const dialogs = { 'ledger-edit': LedgerEdit };
