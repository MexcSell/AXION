import { useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Tags, Check, X, Loader2, ShieldAlert, Info, Bot, UserRound, ListChecks, BarChart3 } from 'lucide-react';
import { ATTRIBUTION_HELP, FAILURE_TAXONOMY, FAILURE_TAXONOMY_VERSION, failureModeOf, type FailureSubjectKind, type FailureTagDto } from '@contracts';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Form';
import { Chip, DemoTag } from '@/components/ui/Chips';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { EmptyState } from '@/components/ui/EmptyState';
import { isApi } from '@/api/mode';
import { decideFailureTag, newKey, tagFailure, useFailureModes, useFailureTags } from '@/api/failures';
import { toast } from '@/store/ui';
import { cx } from '@/lib/format';
import type { DialogComponentProps } from '@/dialogs/DialogHost';
import '@/theme/pages/overview-org-agent.css';

const STATUS: Record<FailureTagDto['status'], { label: string; hue: number }> = {
  proposed: { label: 'Proposed', hue: 45 }, confirmed: { label: 'Confirmed', hue: 150 }, rejected: { label: 'Rejected', hue: 0 },
};
const KIND_LABEL: Record<FailureSubjectKind, string> = { task: 'task', task_attempt: 'attempt', message: 'message', mission: 'mission' };
const since = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

/** DEMO mode shows labelled samples only: nothing is stored and no count is claimed. */
const SAMPLES = [
  { modeId: 'FM-1.3', status: 'confirmed' as const, by: 'Mina (sample)', note: 'Rebuilt the same header three times.' },
  { modeId: 'FM-3.2', status: 'proposed' as const, by: 'Tester-01 (sample agent)', note: '' },
];

/** WAI-ARIA radio group: one tab stop (the selected item, else the first), arrow keys move the selection and focus. */
function RadioList<T extends string>({ label, value, items, onSelect, children }: { label: string; value: T | ''; items: T[]; onSelect: (k: T) => void; children: (k: T, p: { tabIndex: number; selected: boolean; ref: (e: HTMLElement | null) => void; onKeyDown: (e: React.KeyboardEvent) => void }, i: number) => React.ReactNode }) {
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const stop = items.includes(value as T) ? value : items[0];
  const onKey = (i: number) => (e: React.KeyboardEvent) => {
    const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : e.key === 'Home' ? 'home' : e.key === 'End' ? 'end' : 0;
    if (!d) return;
    e.preventDefault(); e.stopPropagation();
    const n = d === 'home' ? 0 : d === 'end' ? items.length - 1 : (i + d + items.length) % items.length;
    onSelect(items[n]); refs.current[items[n]]?.focus();
  };
  return <div className="col" style={{ gap: 4 }} role="radiogroup" aria-label={label}>{items.map((k, i) => children(k, { tabIndex: k === stop ? 0 : -1, selected: k === value, ref: (e) => { refs.current[k] = e; }, onKeyDown: onKey(i) }, i))}</div>;
}

/* DL-78: Tag a failure (improvement cycle 33). MAST taxonomy (arXiv 2503.13657v3): pick a category, then a mode; the ? beside each
   mode gives AXION's one-sentence description and the source (the paper is CC BY-NC-ND: names and ids only are the paper's). Every tag starts proposed; a person confirms or rejects it once; only confirmed tags are counted. */
function TagFailure({ close, props }: DialogComponentProps<{ missionId?: string; taskId?: string; subjectKind?: FailureSubjectKind; subjectId?: string; label?: string }>) {
  const api_ = isApi();
  const kind: FailureSubjectKind = props.subjectKind ?? 'task';
  const subjectId = props.subjectId ?? props.taskId ?? '';
  const { data, error, retry } = useFailureTags(kind, subjectId);
  const counts = useFailureModes('30d', !!data?.subject.demo);
  const [cat, setCat] = useState(FAILURE_TAXONOMY[0].id);
  const [modeId, setModeId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [srvErr, setSrvErr] = useState<string | null>(null);
  const submitKey = useRef(newKey());
  const category = FAILURE_TAXONOMY.find((c) => c.id === cat)!;
  const chosen = failureModeOf(modeId);
  const tags = data?.tags ?? [];
  const err = !api_ ? 'Failure tags are stored on the server' : !subjectId ? 'Open a task first' : !modeId ? 'Choose a failure mode' : '';
  const touch = () => { setSrvErr(null); };

  const submit = async () => {
    if (err || busy) return;
    setBusy('tag'); touch();
    const r = await tagFailure({ subjectKind: kind, subjectId, modeId, ...(note.trim() ? { note: note.trim() } : {}) }, submitKey.current);
    setBusy(null);
    if (!r.ok) { setSrvErr(r.fieldErrors?.modeId ?? r.message); submitKey.current = newKey(); return; }
    toast({ tone: 'success', title: 'Failure tagged', body: `${r.value.modeId} ${r.value.modeName}: proposed. A person confirms it before it is counted.` });
    submitKey.current = newKey(); setModeId(''); setNote('');
  };
  const decide = async (t: FailureTagDto, d: 'confirm' | 'reject') => {
    if (busy) return;
    setBusy(t.id); touch();
    const r = await decideFailureTag(t.id, d);
    setBusy(null);
    if (!r.ok) { setSrvErr(r.message); return; }
    toast({ tone: d === 'confirm' ? 'success' : 'warning', title: d === 'confirm' ? 'Tag confirmed' : 'Tag rejected', body: `${t.modeId} ${t.modeName}. This decision is final.` });
  };

  const c = counts.data;
  const modeCount = c && modeId ? c.categories.flatMap((x) => x.modes).find((m) => m.id === modeId)?.count ?? null : null;
  const header = useMemo(() => (props.label ? `${subjectId} · ${props.label}` : `${KIND_LABEL[kind]} ${subjectId}`.trim()), [props.label, kind, subjectId]);
  return (
    <Modal title="Tag a failure" icon={Tags} help="failure.tag" dialogId="DL-78" size="lg" onClose={close}
      sub={`Why did ${subjectId ? header : 'this task'} fail? Names are the MAST taxonomy; a person confirms each tag.`}
      footer={<><button className="btn" onClick={close}>Close</button>
        <button className="btn primary" disabled={!!err || !!busy} title={err || undefined} onClick={submit} data-tag-submit>{busy === 'tag' ? <Loader2 size={14} className="spin" /> : <Tags size={14} />}Tag failure</button></>}>
      <div className="col" style={{ gap: 12 }}>
        {!api_ && <div className="oa-banner"><Info size={15} /><span>Failure tags are stored on the server. In demo mode only labelled samples are shown, and nothing can be tagged.</span></div>}
        {api_ && !subjectId && <EmptyState icon={ListChecks} title="No subject" body="Open a failed or retried task and choose Tag failure." />}
        {api_ && subjectId && error && !data && <div className="oa-banner" role="alert"><ShieldAlert size={15} /><span>{error}</span><button className="btn sm" onClick={retry}>Retry</button></div>}
        <div className="oa-diff-cols">
          <div className="col" style={{ gap: 10 }} data-mode-picker>
            <div className="row" style={{ gap: 6 }}><div className="section-label" style={{ margin: 0 }}>Category</div><HelpTrigger k="failure.category" /></div>
            <RadioList label="Failure category" value={cat} items={FAILURE_TAXONOMY.map((x) => x.id)} onSelect={(id) => { setCat(id); setModeId((m) => (failureModeOf(m)?.category.id === id ? m : '')); touch(); }}>
              {(id, rp) => { const x = FAILURE_TAXONOMY.find((y) => y.id === id)!; return (
                <button key={id} type="button" role="radio" aria-checked={rp.selected} tabIndex={rp.tabIndex} ref={rp.ref} onKeyDown={rp.onKeyDown} title={x.definition} className={cx('oa-mem', rp.selected && 'on')} style={{ justifyContent: 'flex-start', padding: '5px 10px', borderRadius: 10 }}
                  onClick={() => { setCat(id); setModeId((m) => (failureModeOf(m)?.category.id === id ? m : '')); touch(); }}>
                  <b className="mono" style={{ fontSize: 11 }}>{x.id}</b><span>{x.name}</span><span className="dim tnum" style={{ marginLeft: 'auto', fontSize: 11 }}>{x.modes.length} modes</span>
                </button>); }}
            </RadioList>
            <div className="row" style={{ gap: 6 }}><div className="section-label" style={{ margin: 0 }}>Failure mode ({category.modes.length})</div><HelpTrigger k={`failure.cat.${cat}`} /></div>
            <RadioList label={`Failure modes in ${category.name}`} value={modeId} items={category.modes.map((m) => m.id)} onSelect={(id) => { setModeId(id); touch(); }}>
              {(id, rp, i) => { const m = category.modes.find((y) => y.id === id)!; return (
                <motion.div key={id} className="row" style={{ gap: 4 }} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * .03 }}>
                  <button type="button" role="radio" aria-checked={rp.selected} tabIndex={rp.tabIndex} ref={rp.ref} onKeyDown={rp.onKeyDown} data-mode={id} className={cx('oa-mem', rp.selected && 'on')} style={{ flex: 1, justifyContent: 'flex-start', padding: '6px 10px', borderRadius: 10 }}
                    onClick={() => { setModeId(id); touch(); }}>
                    <span className="mono dim" style={{ fontSize: 11 }}>{id}</span><span>{m.name}</span>
                  </button>
                  <HelpTrigger k={`failure.mode.${id}`} />
                </motion.div>); }}
            </RadioList>
          </div>
          <div className="col" style={{ gap: 10 }}>
            <Field label="Note (optional)" htmlFor="ft-note" hint={chosen ? <><b>{chosen.mode.id}</b> {chosen.mode.name}: {chosen.mode.definition}</> : 'Say what you saw, in your own words. The definition of the chosen mode appears here.'}>
              <textarea id="ft-note" className="input" rows={3} maxLength={1000} value={note} onChange={(e) => { touch(); setNote(e.target.value); }} placeholder="e.g. The header was rebuilt three times" style={{ resize: 'vertical', minHeight: 64 }} />
            </Field>
            {srvErr && <div className="oa-banner" role="alert" data-dialog-error><ShieldAlert size={15} /><span>{srvErr}</span></div>}
            <div className="row" style={{ gap: 6 }}><div className="section-label" style={{ margin: 0 }}>Tags on this {KIND_LABEL[kind]}</div><HelpTrigger k="failure.status" />{!api_ && <DemoTag />}</div>
            <div className="col" style={{ gap: 6 }} data-tag-list data-count={api_ ? tags.length : SAMPLES.length}>
              {api_ ? (!data && !error ? <span className="dim" style={{ fontSize: 12 }}>Reading the tags…</span>
                : tags.length === 0 ? <span className="dim" style={{ fontSize: 12 }}>No tags yet.</span>
                : tags.map((t) => (
                  <motion.div key={t.id} className="oa-move" layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} data-tag={t.id} data-status={t.status} data-mode-id={t.modeId}>
                    <Chip hue={STATUS[t.status].hue} size="sm">{STATUS[t.status].label}</Chip>{t.selfConfirmed && <Chip hue={45} size="sm" title="Confirmed by the person who made the tag">self-confirmed</Chip>}
                    <span className="mono dim" style={{ fontSize: 11 }}>{t.modeId}</span><b style={{ fontSize: 12.5 }}>{t.modeName}</b>
                    <span className="dim row" style={{ gap: 3, fontSize: 11.5 }}>{t.taggedByKind === 'agent' ? <Bot size={12} /> : <UserRound size={12} />}{t.taggedByName} · {since(t.createdAt)}</span>
                    {t.note && <span className="dim" style={{ fontSize: 11.5, flexBasis: '100%' }}>“{t.note}”</span>}
                    {t.attributions.length > 0 && (
                      <span className="col dim" style={{ flexBasis: '100%', gap: 2, fontSize: 11.5 }} data-attributions={t.attributions.length} data-disagreements={t.attributionDisagreements}>
                        <span className="row" style={{ gap: 6 }}>
                          <b>Where it came from</b>
                          {t.attributionDisagreements > 0 ? <Chip hue={45} size="sm" title={ATTRIBUTION_HELP}>{t.attributionDisagreements + 1} different views</Chip>
                            : t.attributions.length > 1 ? <Chip hue={150} size="sm">views agree</Chip> : null}
                        </span>
                        {t.attributions.map((a) => (
                          <span key={a.id} data-attribution className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                            {a.attributedByKind === 'agent' ? <Bot size={11} aria-hidden /> : <UserRound size={11} aria-hidden />}
                            {a.attributedByName} {a.agentId ? <>named agent <span className="mono">{a.agentId}</span></> : 'named no agent'}{a.stepRef ? <> at step <span className="mono">{a.stepRef}</span></> : null}
                            {' · '}{a.fullTraceAvailable ? 'says the full trace is available' : 'full trace not claimed'} · {since(a.createdAt)}
                          </span>))}
                      </span>)}
                    {t.status === 'proposed' ? (
                      <span className="row" style={{ gap: 4, marginLeft: 'auto' }}>
                        <button className="btn sm primary" disabled={!!busy} data-decide="confirm" onClick={() => decide(t, 'confirm')}>{busy === t.id ? <Loader2 size={12} className="spin" /> : <Check size={12} />}Confirm</button>
                        <button className="btn sm ghost" disabled={!!busy} data-decide="reject" onClick={() => decide(t, 'reject')}><X size={12} />Reject</button>
                      </span>
                    ) : <span className="dim" style={{ fontSize: 11.5, marginLeft: 'auto' }}>{t.decidedByName} · {t.decidedAt ? since(t.decidedAt) : ''}</span>}
                  </motion.div>))
              ) : SAMPLES.map((s) => {
                const m = failureModeOf(s.modeId)!;
                return (
                  <div key={s.modeId} className="oa-move"><Chip hue={STATUS[s.status].hue} size="sm">{STATUS[s.status].label}</Chip><span className="mono dim" style={{ fontSize: 11 }}>{s.modeId}</span><b style={{ fontSize: 12.5 }}>{m.mode.name}</b>
                    <span className="dim" style={{ fontSize: 11.5 }}>{s.by}</span>{s.note && <span className="dim" style={{ fontSize: 11.5, flexBasis: '100%' }}>“{s.note}”</span>}</div>);
              })}
            </div>
            <div className="oa-move" data-failure-counts={api_ ? (c ? 'ready' : counts.error ? 'error' : 'loading') : 'demo'} data-failure-n={c ? c.n : ''} data-mode-count={modeCount ?? ''}
              style={{ gap: 8 }}>
              <BarChart3 size={14} className="info" aria-hidden />
              {!api_ ? <><b>Counts</b><span className="dim">Nothing is counted in demo mode.</span><DemoTag /></>
                : c ? <>
                  <b>Confirmed, last 30 days</b>
                  <span className="tnum" data-n>n={c.n}</span>
                  <span className="dim tnum" data-n-demo={c.demo} title="Of n, tags on DEMO sample missions">{c.demo} DEMO</span>
                  <span className="dim tnum" data-n-self={c.selfConfirmed} title="Of n, confirmed by the person who made the tag">{c.selfConfirmed} self-confirmed</span>
                  {c.categories.map((x) => <span key={x.id} className="dim tnum" title={x.name}>{x.id} {x.count ?? '—'}</span>)}
                  {modeId && <span className="tnum"><span className="dim">{modeId}</span> <b data-mode-total>{modeCount ?? '—'}</b></span>}
                  {c.proposed > 0 && <span className="dim">· {c.proposed} proposed, not counted</span>}
                  {data?.subject.demo && <DemoTag title="This mission is a DEMO sample; DEMO tags are included in these counts" />}
                </> : <span className="dim">{counts.error ?? 'Reading the counts…'}</span>}
              <span className="spacer" /><HelpTrigger k="failure.counts" />
            </div>
          </div>
        </div>
        <span className="dim" style={{ fontSize: 11 }}>Taxonomy {FAILURE_TAXONOMY_VERSION}: names and ids from Cemri, Pan, Yang, Agrawal et al., “Why Do Multi-Agent LLM Systems Fail?”, arXiv:2503.13657v3, CC BY-NC-ND 4.0, arxiv.org/abs/2503.13657. Descriptions are AXION’s own.</span>
      </div>
    </Modal>
  );
}

export const dialogs = { 'failure-tag': TagFailure };
