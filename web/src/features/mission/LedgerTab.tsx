import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ScrollText, ListChecks, CheckCircle2, XCircle, Repeat2, TrendingUp, OctagonAlert, Pencil, GitCompare, ExternalLink, UserRound, Loader2, ArrowRight, Minus, Plus, RefreshCw } from 'lucide-react';
import { diffLedgers, FACT_GROUPS, FACT_LABEL, type LedgerChange, type LedgerDto, type LedgerKind, type LedgersDto, type LedgerVersionDto, type ProgressBody, type TaskBody } from '@contracts';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Chip, DemoTag } from '@/components/ui/Chips';
import { Segmented } from '@/components/ui/Form';
import { EmptyState } from '@/components/ui/EmptyState';
import { Tip } from '@/components/ui/Tip';
import { openDialog } from '@/store/ui';
import { fetchLedgerVersion, fetchVersionsPage, useLedgers } from '@/api/ledgers';
import type { Mission } from '@/data/types';
import { agoFromTs, cx } from '@/lib/format';
import '@/theme/pages/c39-ledgers.css';

const STEP_HUE: Record<string, number> = { todo: 220, doing: 205, done: 150, blocked: 25 };
const PAPER = 'https://arxiv.org/abs/2411.04468';
const when = (iso: string) => agoFromTs(new Date(iso).getTime());

function Flag({ on, label, icon: Icon, bad, help }: { on: boolean; label: string; icon: typeof CheckCircle2; bad?: boolean; help: string }) {
  const tone = on ? (bad ? 'bad' : 'good') : 'off';
  return (
    <div className={cx('ld-flag', tone)} data-flag={label} data-on={on ? 'yes' : 'no'}>
      <Icon size={16} aria-hidden /><div><b>{on ? 'Yes' : 'No'}</b><span>{label}</span></div><HelpTrigger k={help} />
    </div>
  );
}

function TaskPanel({ l }: { l: LedgerDto<TaskBody> | null }) {
  if (!l) return <EmptyState icon={ListChecks} title="No task ledger yet" body="Facts and a plan appear here once someone writes the first version." />;
  const b = l.body;
  return (
    <div className="ld-task" data-ledger="task">
      <div className="ld-facts">
        {FACT_GROUPS.map((g) => (
          <div key={g} className="ld-fgroup" data-fact-group={g}>
            <div className="ld-fhead"><span>{FACT_LABEL[g]}</span><span className="tnum">{b.facts[g].length}</span></div>
            {b.facts[g].length === 0 ? <div className="dim ld-none">none</div> : (
              <ul>{b.facts[g].map((f, i) => <li key={i} title={f.source ? `${f.text} (source: ${f.source})` : f.text}><span className="ld-ft">{f.text}</span>{f.source && <em>{f.source}</em>}</li>)}</ul>
            )}
          </div>
        ))}
      </div>
      <div className="ld-plan">
        <div className="ld-fhead"><span>Plan</span><span className="tnum">{b.steps.filter((s) => s.status === 'done').length}/{b.steps.length} done</span></div>
        {b.steps.length === 0 ? <div className="dim ld-none">no steps yet</div> : (
          <ol>{b.steps.map((s) => (
            <li key={s.id} data-step={s.id} data-status={s.status} title={s.text}>
              <Chip hue={STEP_HUE[s.status]} size="sm">{s.status}</Chip><span className="ld-ft">{s.text}</span>{s.owner && <em><UserRound size={10} aria-hidden /> {s.owner}</em>}
            </li>))}
          </ol>
        )}
      </div>
    </div>
  );
}

function ProgressPanel({ l, stall, policy }: { l: LedgerDto<ProgressBody> | null; stall: LedgersDto['stall']; policy: LedgersDto['policy'] }) {
  if (!l) return <EmptyState icon={TrendingUp} title="No progress ledger yet" body="Whether the work is moving is recorded here once the first check-in is saved." />;
  const b = l.body;
  return (
    <div className="ld-prog" data-ledger="progress">
      <div className="ld-flags">
        <Flag on={b.satisfied} label="Satisfied" icon={b.satisfied ? CheckCircle2 : XCircle} help="ledger.satisfied" />
        <Flag on={b.looping} label="Looping" icon={Repeat2} bad help="ledger.looping" />
        <Flag on={b.progressing} label="Making progress" icon={TrendingUp} help="ledger.progressing" />
      </div>
      <div className={cx('ld-stall', stall.stalled && 'on')} data-stall={stall.stalled ? 'stalled' : 'ok'}>
        {stall.stalled ? <OctagonAlert size={15} aria-hidden /> : <CheckCircle2 size={15} aria-hidden />}
        <b>{stall.stalled ? 'Stalled' : 'Not stalled'}</b>
        <span className="dim">{stall.stalled ? (stall.reason === 'looping' ? `looping ${policy.loopingInARow} check-ins in a row` : `${stall.counter} check-ins without progress`) : `${stall.counter} of ${policy.nonProgressing} check-ins without progress`}</span>
        <HelpTrigger k="ledger.stall" />
      </div>
      <dl className="ld-next">
        <dt>Next speaker</dt><dd>{b.next_speaker ?? <span className="dim">not set</span>}</dd>
        <dt>Instruction</dt><dd title={b.next_instruction}>{b.next_instruction ?? <span className="dim">not set</span>}</dd>
        {b.notes && <><dt>Notes</dt><dd title={b.notes}>{b.notes}</dd></>}
      </dl>
    </div>
  );
}

function Verb({ c }: { c: LedgerChange }) {
  const Ic = c.change === 'added' ? Plus : c.change === 'removed' ? Minus : ArrowRight;
  return (
    <li data-change={c.change}><Ic size={12} aria-hidden /><b>{c.label}</b>
      {c.change === 'changed' ? <span><s>{c.from || 'empty'}</s> <ArrowRight size={10} aria-hidden /> {c.to || 'empty'}</span> : <span>{c.change === 'added' ? c.to : c.from}</span>}
    </li>
  );
}

function History({ m, data }: { m: Mission; data: LedgersDto }) {
  const [kind, setKind] = useState<LedgerKind>('task');
  // older pages are fetched on request (keyset, 100 at a time) and merged under the newest page
  const [older, setOlder] = useState<{ key: string; list: LedgerVersionDto[]; cursor: number | null | undefined }>({ key: '', list: [], cursor: undefined });
  const okey = `${m.id}|${kind}`;
  const extra = older.key === okey ? older : { key: okey, list: [] as LedgerVersionDto[], cursor: undefined };
  const first = data.versions[kind];
  const list: LedgerVersionDto[] = [...first, ...extra.list.filter((v) => !first.some((x) => x.version === v.version))].sort((a, b) => b.version - a.version);
  const cursor = extra.cursor === undefined ? data.moreVersions[kind] : extra.cursor;
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const pg = await fetchVersionsPage(m.id, kind, cursor);
    setLoadingMore(false);
    if (pg) setOlder({ key: okey, list: [...extra.list, ...pg.versions], cursor: pg.next });
  };
  const latest = list[0]?.version ?? 0;
  const [to, setTo] = useState(0);
  const [from, setFrom] = useState(0);
  // follow the newest version unless the viewer picked an older one
  useEffect(() => { setTo(latest); setFrom(Math.max(1, latest - 1)); }, [kind, latest, m.id]);
  const [diff, setDiff] = useState<{ key: string; changes: LedgerChange[] | null }>({ key: '', changes: null });
  const key = `${m.id}|${kind}|${from}|${to}|${latest}`;
  useEffect(() => {
    if (!to || !from || from >= to) { setDiff({ key, changes: [] }); return; }
    let live = true;
    Promise.all([fetchLedgerVersion(m, kind, from), fetchLedgerVersion(m, kind, to)]).then(([a, b]) => {
      if (live) setDiff({ key, changes: a && b ? diffLedgers(kind, a.body, b.body) : null });
    });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = diff.key === key ? diff.changes : undefined;
  return (
    <div className="ld-hist" data-ledger-history>
      <div className="ld-hhead">
        <Segmented size="sm" ariaLabel="Ledger kind" value={kind} onChange={setKind}
          options={[{ key: 'task', label: <>Task <span className="tnum">{data.versions.task.length}</span></> }, { key: 'progress', label: <>Progress <span className="tnum">{data.versions.progress.length}</span></> }]} />
        <span className="spacer" />
        <label className="ld-cmp"><span>From</span>
          <select className="select" aria-label="Compare from version" value={from} onChange={(e) => setFrom(Number(e.target.value))}>{list.map((v) => <option key={v.version} value={v.version}>v{v.version}</option>)}</select>
        </label>
        <label className="ld-cmp"><span>To</span>
          <select className="select" aria-label="Compare to version" value={to} onChange={(e) => setTo(Number(e.target.value))}>{list.map((v) => <option key={v.version} value={v.version}>v{v.version}</option>)}</select>
        </label>
      </div>
      <div className="ld-hbody">
        <ul className="ld-versions" aria-label="Versions">
          {list.map((v) => (
            <li key={v.version}><button type="button" className={cx(v.version === to && 'on')} aria-pressed={v.version === to} onClick={() => { setTo(v.version); setFrom(Math.max(1, v.version - 1)); }} data-version={v.version}>
              <b>v{v.version}</b><span>{v.authorName}</span><em>{when(v.createdAt)}</em>{v.demo && <DemoTag title="DEMO sample version" />}
            </button></li>
          ))}
          {cursor && <li><button type="button" onClick={loadMore} disabled={loadingMore} data-load-older>{loadingMore ? <Loader2 size={12} className="spin" aria-hidden /> : <RefreshCw size={12} aria-hidden />}<span>Load older versions</span></button></li>}
          {list.length === 0 && <li className="dim ld-none">no versions yet</li>}
        </ul>
        <div className="ld-diff" data-ledger-diff aria-live="polite">
          <div className="ld-fhead"><span><GitCompare size={12} aria-hidden /> v{from || '–'} to v{to || '–'}</span></div>
          {list.length < 2 ? <div className="dim ld-none">Only one version so far. A diff needs two.</div>
            : from >= to ? <div className="dim ld-none">Pick an older version as From.</div>
            : cur === undefined ? <div className="dim ld-none"><Loader2 size={12} className="spin" aria-hidden /> Loading…</div>
            : cur === null ? <div className="dim ld-none">Could not load both versions.</div>
            : cur.length === 0 ? <div className="dim ld-none">No difference.</div>
            : <ul>{cur.map((c, i) => <Verb key={i} c={c} />)}</ul>}
        </div>
      </div>
    </div>
  );
}

/** Mission Ledger tab (cycle 39): the task ledger, the progress ledger with its stall badge, version history with a diff. */
export function LedgerTab({ m }: { m: Mission }) {
  const { data, error, retry, sample } = useLedgers(m);
  const demo = useMemo(() => !!data && [data.ledgers.task, data.ledgers.progress].some((l) => l?.demo), [data]);
  if (!data) return (
    <div className="ld-root" data-ledger-state={error ? 'error' : 'loading'}>
      {error ? <EmptyState icon={OctagonAlert} title="Could not load the ledgers" body={error} action={<button className="btn sm" onClick={retry}><RefreshCw size={13} />Retry</button>} /> : <div className="dim"><Loader2 size={14} className="spin" aria-hidden /> Loading the ledgers…</div>}
    </div>
  );
  const t = data.ledgers.task, p = data.ledgers.progress;
  const edit = (kind: LedgerKind) => openDialog('ledger-edit', { missionId: m.id, kind });
  return (
    <motion.div className="ld-root" data-ledger-state="ready" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="ld-top">
        <ScrollText size={18} className="info" aria-hidden /><b>Mission ledger</b><HelpTrigger k="ledger.overview" />
        {demo && <DemoTag title="DEMO sample ledger: illustrative, no agent wrote it" />}
        {sample && <span className="dim ld-note">Demo mode shows a sample. Ledgers are stored on the server.</span>}
        <span className="spacer" />
        <a className="ld-src" href={PAPER} target="_blank" rel="noreferrer noopener" aria-label="Magentic-One paper (opens arXiv)">after Magentic-One <ExternalLink size={11} aria-hidden /></a>
      </div>
      <div className="ld-grid">
        <section className="subpanel ld-card" aria-label="Task ledger">
          <div className="ld-chead"><ListChecks size={15} className="info" aria-hidden /><b>Task ledger</b><HelpTrigger k="ledger.task" />
            {t && <span className="ld-ver" data-version-label="task">v{t.version} · {t.authorName} · {when(t.createdAt)}</span>}<span className="spacer" />
            <Tip label={data.canEdit ? 'Save a new version of the task ledger' : sample ? 'Ledgers are stored on the server; demo mode is read only' : 'Only the owner or an administrator can edit'}>
              <button className="btn sm" disabled={!data.canEdit} onClick={() => edit('task')} aria-label="Edit task ledger"><Pencil size={13} />Edit</button>
            </Tip>
          </div>
          <TaskPanel l={t} />
        </section>
        <div className="ld-side">
          <section className="subpanel ld-card" aria-label="Progress ledger">
            <div className="ld-chead"><TrendingUp size={15} className="info" aria-hidden /><b>Progress ledger</b><HelpTrigger k="ledger.progress" />
              {p && <span className="ld-ver" data-version-label="progress">v{p.version} · {p.authorName} · {when(p.createdAt)}</span>}<span className="spacer" />
              <Tip label={data.canEdit ? 'Save a new check-in' : sample ? 'Ledgers are stored on the server; demo mode is read only' : 'Only the owner or an administrator can edit'}>
                <button className="btn sm" disabled={!data.canEdit} onClick={() => edit('progress')} aria-label="Edit progress ledger"><Pencil size={13} />Check in</button>
              </Tip>
            </div>
            <ProgressPanel l={p} stall={data.stall} policy={data.policy} />
          </section>
          <section className="subpanel ld-card ld-histcard" aria-label="Version history">
            <div className="ld-chead"><GitCompare size={15} className="info" aria-hidden /><b>History</b><HelpTrigger k="ledger.history" /></div>
            <History m={m} data={data} />
          </section>
        </div>
      </div>
    </motion.div>
  );
}
