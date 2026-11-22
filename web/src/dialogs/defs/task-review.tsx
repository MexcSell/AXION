import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ClipboardCheck, Plus, X, ShieldAlert, Info, Loader2, Link2, FileText, MessageSquare, Check, Minus } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Segmented } from '@/components/ui/Form';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { isApi } from '@/api/mode';
import { useTaskReviews, submitTaskReview, newKey } from '@/api/taskReviews';
import { toast } from '@/store/ui';
import { VERDICT } from '@/features/review/TaskReviews';
import type { DialogComponentProps } from '@/dialogs/DialogHost';
import type { EvidenceRef, ReviewVerdict, RubricResult } from '@contracts';
import '@/theme/pages/overview-org-agent.css';
import '@/theme/pages/task-review.css';

interface Row { criterion: string; result: RubricResult | null; note: string; fixed: boolean }
const RESULTS: { key: RubricResult; label: string; icon: typeof Check }[] = [{ key: 'pass', label: 'Pass', icon: Check }, { key: 'fail', label: 'Fail', icon: X }, { key: 'na', label: 'N/A', icon: Minus }];
const KIND_ICON = { file: FileText, message: MessageSquare, url: Link2 } as const;
const key_ = (e: { kind: string; ref: string }) => `${e.kind}:${e.ref}`;

/* DL-80: Review a task (improvement cycle 38, api mode). A person who is neither the producer nor the commissioner records
   a verdict against the mission's acceptance criteria (or free ones) and cites evidence. The server derives who produced
   the work; an accepted review needs at least one piece of evidence. */
function TaskReview({ close, props }: DialogComponentProps<{ missionId?: string; taskId?: string }>) {
  const api_ = isApi();
  const rv = useTaskReviews(props.taskId);
  const d = rv.data;
  const [verdict, setVerdict] = useState<ReviewVerdict | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [picked, setPicked] = useState<EvidenceRef[]>([]);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [srvErr, setSrvErr] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const submitKey = useRef(newKey());
  // the rubric starts from the mission's acceptance criteria when it has them, else one free criterion
  useEffect(() => {
    if (!d || rows) return;
    setRows(d.criteria.length ? d.criteria.map((c) => ({ criterion: c, result: null, note: '', fixed: true })) : [{ criterion: '', result: null, note: '', fixed: false }]);
  }, [d, rows]);
  const list = rows ?? [];
  const filled = list.filter((r) => r.criterion.trim());
  const allowed = !!d?.canReview.allowed;
  const err = !api_ ? 'Reviews are stored on the server' : !d ? 'Reading the task' : !allowed ? (d.canReview.reason ?? 'You cannot review this task')
    : !verdict ? 'Choose a verdict' : filled.length === 0 ? 'Write at least one criterion' : filled.some((r) => !r.result) ? 'Mark every criterion pass, fail or n/a'
    : verdict === 'accepted' && filled.some((r) => r.result === 'fail') ? 'A failed criterion cannot be accepted'
    : verdict === 'accepted' && picked.length === 0 ? 'Cite at least one piece of evidence to accept' : '';
  const touch = () => { setSrvErr(null); setFields({}); };
  const toggle = (e: EvidenceRef) => { touch(); setPicked((xs) => (xs.some((x) => key_(x) === key_(e)) ? xs.filter((x) => key_(x) !== key_(e)) : [...xs, e])); };
  const urlOk = /^https?:\/\/\S+$/i.test(url.trim());
  const addUrl = () => { if (!urlOk) return; toggleOn({ kind: 'url', ref: url.trim() }); setUrl(''); };
  const toggleOn = (e: EvidenceRef) => { touch(); setPicked((xs) => (xs.some((x) => key_(x) === key_(e)) ? xs : [...xs, e])); };
  const submit = async () => {
    if (err || busy || !props.taskId || !verdict) return;
    setBusy(true); touch();
    const r = await submitTaskReview(props.taskId, { verdict, rubric: filled.map((x) => ({ criterion: x.criterion.trim(), result: x.result!, note: x.note.trim() })), evidence: picked }, submitKey.current);
    setBusy(false);
    if (!r.ok) { setSrvErr(r.message); setFields(r.fieldErrors ?? {}); submitKey.current = newKey(); return; }
    toast({ tone: 'success', title: `Review recorded: ${VERDICT[r.review.verdict].label}`, body: `${r.review.reviewer.name} reviewed work by ${r.review.producer.name}.` });
    close();
  };
  const options = d?.evidenceOptions ?? [];
  const urls = picked.filter((p) => p.kind === 'url');
  return (
    <Modal title={d ? `Review ${props.taskId}` : 'Review a task'} icon={ClipboardCheck} help="review.dialog" dialogId="DL-80" size="lg" onClose={close}
      sub={d?.producer ? `Produced by ${d.producer.name}${d.producer.modelFamily ? ` (${d.producer.modelFamily})` : ''}. You are checking it as someone else.` : 'A verdict against the criteria, with the evidence you checked.'}
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={!!err || busy} title={err || undefined} onClick={submit}>{busy ? <Loader2 size={14} className="spin" /> : <ClipboardCheck size={14} />}Record review</button></>}>
      <div className="col rv-dialog" style={{ gap: 10 }} data-review-dialog={d ? (allowed ? 'ready' : 'refused') : 'loading'}>
        {!api_ && <div className="oa-banner"><Info size={15} /><span>Reviews are stored on the server. In demo mode this dialog only shows the form.</span></div>}
        {api_ && rv.error && !d && <div className="oa-banner" role="alert"><ShieldAlert size={15} /><span>{rv.error}</span></div>}
        {d && !allowed && <div className="oa-banner" role="alert" data-dialog-error><ShieldAlert size={15} /><span>{d.canReview.reason}</span></div>}
        <div className="row" style={{ gap: 6 }}>
          <div className="section-label" style={{ margin: 0 }}>Verdict</div><HelpTrigger k="review.verdict" />
          <span className="spacer" />
          <Segmented ariaLabel="Verdict" size="sm" value={verdict ?? ('' as ReviewVerdict)} onChange={(v) => { touch(); setVerdict(v); }}
            options={(Object.keys(VERDICT) as ReviewVerdict[]).map((k) => { const I = VERDICT[k].icon; return { key: k, label: <><I size={13} />{VERDICT[k].label}</> }; })} />
        </div>
        <div className="oa-diff-cols">
          <div className="col" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 6 }}><div className="section-label" style={{ margin: 0 }}>{d?.criteria.length ? 'Acceptance criteria' : 'Criteria'}</div><HelpTrigger k="review.rubric" /></div>
            {!d?.criteria.length && d && <span className="dim" style={{ fontSize: 11.5 }}>This mission has no written acceptance criteria. Write the ones you checked.</span>}
            <div className="rv-rubric" role="group" aria-label="Rubric">
              {list.map((r, i) => (
                <motion.div key={i} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="rv-crit" data-crit={i}>
                  <div className="row" style={{ gap: 6 }}>
                    {r.fixed ? <span className="rv-crit-t" title={r.criterion}>{r.criterion}</span>
                      : <input className="input" style={{ flex: 1, minWidth: 0, height: 28 }} value={r.criterion} maxLength={400} aria-label={`Criterion ${i + 1}`} placeholder="e.g. The page loads without errors"
                          onChange={(e) => { touch(); setRows((xs) => (xs ?? []).map((x, j) => (j === i ? { ...x, criterion: e.target.value } : x))); }} />}
                    {!r.fixed && <button type="button" className="icon-btn" style={{ width: 22, height: 22 }} aria-label={`Remove criterion ${i + 1}`} disabled={list.length === 1} onClick={() => setRows((xs) => (xs ?? []).filter((_, j) => j !== i))}><X size={12} /></button>}
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <Segmented ariaLabel={`Result ${i + 1}`} size="sm" value={r.result ?? ('' as RubricResult)} onChange={(v) => { touch(); setRows((xs) => (xs ?? []).map((x, j) => (j === i ? { ...x, result: v } : x))); }}
                      options={RESULTS.map((o) => ({ key: o.key, label: <><o.icon size={12} />{o.label}</> }))} />
                    <input className="input rv-note" style={{ flex: 1, minWidth: 0 }} value={r.note} maxLength={1000} aria-label={`Note ${i + 1}`} placeholder="Note (optional)" onChange={(e) => { touch(); setRows((xs) => (xs ?? []).map((x, j) => (j === i ? { ...x, note: e.target.value } : x))); }} />
                  </div>
                </motion.div>
              ))}
            </div>
            <div><button type="button" className="btn sm" disabled={list.length >= 30} onClick={() => setRows((xs) => [...(xs ?? []), { criterion: '', result: null, note: '', fixed: false }])} aria-label="Add criterion"><Plus size={13} />Add criterion</button></div>
          </div>
          <div className="col" style={{ gap: 6 }} data-evidence-picker>
            <div className="row" style={{ gap: 6 }}><div className="section-label" style={{ margin: 0 }}>Evidence ({picked.length})</div><HelpTrigger k="review.evidence" /></div>
            <div className="rv-evid" role="group" aria-label="Evidence">
              {options.length === 0 && <span className="dim" style={{ fontSize: 12 }}>No files or messages are attached to this task yet. You can cite a web link.</span>}
              {options.map((o) => { const I = KIND_ICON[o.kind]; const on = picked.some((x) => key_(x) === key_(o)); return (
                <label key={key_(o)} className={`rv-opt${on ? ' on' : ''}`}><input type="checkbox" checked={on} onChange={() => toggle({ kind: o.kind, ref: o.ref })} /><I size={13} aria-hidden /><span className="ellipsis" title={o.label}>{o.label}</span></label>); })}
              {urls.map((u) => (
                <span key={u.ref} className="rv-opt on"><Link2 size={13} aria-hidden /><span className="ellipsis" title={u.ref}>{u.ref}</span>
                  <button type="button" className="icon-btn" style={{ width: 20, height: 20 }} aria-label={`Remove link ${u.ref}`} onClick={() => toggle(u)}><X size={11} /></button></span>))}
            </div>
            <div className="row" style={{ gap: 6 }}>
              <input className="input" style={{ flex: 1, minWidth: 0, height: 30 }} value={url} aria-label="Evidence link" placeholder="https:// link to cite" onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addUrl(); } }} />
              <button type="button" className="btn sm" disabled={!urlOk} onClick={addUrl} aria-label="Add link"><Plus size={13} />Add</button>
            </div>
            {fields.evidence && <span className="dim" style={{ fontSize: 12 }}>{fields.evidence}</span>}
          </div>
        </div>
        {err && api_ && d && allowed && <span className="dim" style={{ fontSize: 12 }} data-dialog-hint>{err}</span>}
        {srvErr && <div className="oa-banner" role="alert" data-dialog-error><ShieldAlert size={15} /><span>{srvErr}</span></div>}
      </div>
    </Modal>
  );
}

export const dialogs = { 'task-review': TaskReview };
