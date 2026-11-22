import { useState } from 'react';
import { motion } from 'motion/react';
import { Hourglass, Timer, ListOrdered, Inbox, Hourglass as Wait, ShieldCheck, ShieldAlert, Users, Lock, RefreshCw, Network, Gauge, Building2 } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Form';
import { DemoTag } from '@/components/ui/Chips';
import { IconButton } from '@/components/ui/IconButton';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { LiveStatus } from '@/components/ui/LiveStatus';
import { isApi } from '@/api/mode';
import { useReviewCapacity } from '@/api/reviewCapacity';
import { demoCapacity } from '@/data/reviewCapacityDemo';
import { useMe, isAdmin } from '@/store/auth';
import { fmtDuration } from '@/features/approvals/quality';
import { cx } from '@/lib/format';
import '@/theme/pages/c65-review-capacity.css';

/* c65 (R3-10): review capacity. Records and display only; a measurement of how long people take and how much waits, never a target.
   Everyone sees aggregates (a cell shows numbers from 5 items and 3 different people); per-person rows are for administrators only and
   there is no sort control anywhere. Utilisation is not measured in v1 (no handling time, no hours setting). */
const WINDOWS = [7, 30, 90] as const;
const two = (x: number) => (x < 1 ? x.toFixed(2) : x.toFixed(1));
const perDay = (x: number) => (x >= 10 ? x.toFixed(0) : x >= 1 ? x.toFixed(1) : x.toFixed(2));

/** A column heading with its own ? (every number in the tables has one). */
const Th = ({ children, k, right = true }: { children: string; k: string; right?: boolean }) => <th scope="col" className={right ? 'r' : undefined}><span className="rc-th">{children}<HelpTrigger k={k} /></span></th>;

function Cell({ icon: Icon, label, help, value, n, ok, note, testid, i }: { icon: typeof Gauge; label: string; help: string; value: string; n: number | null; ok: boolean; note?: string; testid: string; i: number }) {
  return (
    <motion.div className={cx('rc-cell', !ok && 'none')} data-cell={testid} data-enough={ok ? 'yes' : 'no'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .04 + i * .04 }}>
      <span className="rc-cl"><Icon size={13} aria-hidden /><span className="ellipsis">{label}</span><HelpTrigger k={help} /></span>
      {ok ? <span className="rc-cv tnum">{value}</span> : <span className="rc-cv rc-none"><Wait size={12} aria-hidden />{note ?? 'not enough evidence'}</span>}
      <span className="rc-cm tnum">n = {n ?? '–'}</span>
    </motion.div>
  );
}

export function ReviewCapacity() {
  const api_ = isApi();
  const admin = isAdmin(useMe());
  const [w, setW] = useState<number>(30);
  const [showPeople, setShowPeople] = useState(false);
  const live = useReviewCapacity(w, admin, showPeople);
  const demo = !api_ ? demoCapacity(w) : null;
  const r = api_ ? live.review : demo!.review;
  const people = api_ ? live.people : showPeople && admin ? demo!.people : null;
  const t = r?.total;
  const floor = r ? `Numbers show from ${r.minItems} items and ${r.minPeople} different people.` : '';
  const pctNote = r ? `needs ${r.minPercentileN} decisions` : '';
  return (
    <Panel icon={Hourglass} titleSize="lg" title="Review capacity" help="ops.reviewCapacity" delay={.02} className="ops-review-capacity"
      sub="How long people take to decide, and how much waits. A measurement, never a target."
      actions={<>
        <Segmented size="sm" ariaLabel="Window" value={String(w)} onChange={(k) => setW(Number(k))} options={WINDOWS.map((d) => ({ key: String(d), label: `${d}d`, title: `last ${d} days` }))} />
        {!api_ && <DemoTag title="SAMPLE numbers: invented, only to show the layout." />}
        {api_ && <IconButton size="xs" icon={RefreshCw} label="Refresh now" onClick={live.retry} className={live.loading ? 'spin' : undefined} />}
      </>}>
      <div data-review-capacity={r ? 'ready' : live.error ? 'error' : 'loading'} data-window={w}>
        {!r || !t ? (live.error ? <LiveStatus kind="error" className="dim">{live.error} <button type="button" className="btn sm ghost" onClick={live.retry}>Retry</button></LiveStatus> : <LiveStatus className="dim">Reading the review records…</LiveStatus>) : (
          <>
            <div className="rc-cells" role="list" aria-label="All items together">
              <Cell i={0} testid="arrivals" icon={Inbox} label="Arrivals per day" help="ops.reviewCapacity.arrivals" value={t.arrivalPerDay === null ? '' : perDay(t.arrivalPerDay)} n={t.n} ok={t.shown} />
              <Cell i={1} testid="median" icon={Timer} label="Median time" help="ops.reviewCapacity.median" value={t.p50Ms === null ? '' : fmtDuration(t.p50Ms)} n={t.decided} ok={t.shown && t.p50Ms !== null} note={t.shown ? pctNote : undefined} />
              <Cell i={2} testid="p95" icon={Gauge} label="Slowest 5%" help="ops.reviewCapacity.p95" value={t.p95Ms === null ? '' : fmtDuration(t.p95Ms)} n={t.decided} ok={t.shown && t.p95Ms !== null} note={t.shown ? pctNote : undefined} />
              <Cell i={3} testid="backlog" icon={ListOrdered} label="Waiting now" help="ops.reviewCapacity.backlog" value={t.openBacklog === null ? '' : String(t.openBacklog)} n={t.n} ok={t.shown} />
              <motion.div className={cx('rc-cell', r.littles.status === 'fail' && 'bad')} data-cell="littles" data-status={r.littles.status} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .2 }}>
                <span className="rc-cl">{r.littles.status === 'fail' ? <ShieldAlert size={13} aria-hidden /> : <ShieldCheck size={13} aria-hidden />}<span className="ellipsis">Data check</span><HelpTrigger k="ops.reviewCapacity.littles" /></span>
                <span className={cx('rc-cv', 'rc-small', r.littles.status === 'fail' && 'bad')} role={r.littles.status === 'fail' ? 'alert' : undefined}>
                  {r.littles.status === 'pass' ? 'No lost records' : r.littles.status === 'insufficient' ? 'Nothing to compare' : r.littles.reason === 'missing_close' ? `${r.littles.missingClose} item${r.littles.missingClose === 1 ? '' : 's'} lost a close record` : `${r.littles.missingOpen} waiting task${r.littles.missingOpen === 1 ? '' : 's'} lost a start record`}
                </span>
                <span className="rc-cm tnum">{r.littles.avgOpen !== null && r.littles.lambdaTimesW !== null ? `avg open ${two(r.littles.avgOpen)} · rate×time ${two(r.littles.lambdaTimesW)}` : `open now ${r.littles.openNow}`}</span>
              </motion.div>
            </div>
            {!t.shown && <p className="dim rc-note" data-floor="shown">{floor} {t.n} item{t.n === 1 ? '' : 's'} so far.</p>}
            <div className="rc-cols">
              <section className="rc-box" aria-label="By department">
                <div className="rc-h"><Building2 size={13} aria-hidden /><b>By department</b></div>
                {r.departments.length === 0 ? <p className="dim rc-note">No items in this window.</p> : (
                  <div className="rc-scroll"><table className="rc-table" data-table="departments">
                    <thead><tr><th scope="col"><span className="rc-th">Department<HelpTrigger k="ops.reviewCapacity.department" /></span></th><Th k="ops.reviewCapacity.n">n</Th><Th k="ops.reviewCapacity.arrivals">Per day</Th><Th k="ops.reviewCapacity.median">Median</Th><Th k="ops.reviewCapacity.p95">Slowest 5%</Th><Th k="ops.reviewCapacity.backlog">Waiting</Th></tr></thead>
                    <tbody>{r.departments.map((d) => (
                      <tr key={d.dept} data-dept={d.dept} data-shown={d.shown ? 'yes' : 'no'}>
                        <th scope="row" className="ellipsis">{d.dept}</th><td className="r tnum">{d.n}</td>
                        {d.shown ? <>
                          <td className="r tnum">{perDay(d.arrivalPerDay ?? 0)}</td>
                          <td className="r tnum">{d.p50Ms === null ? <span className="dim">–</span> : fmtDuration(d.p50Ms)}</td>
                          <td className="r tnum">{d.p95Ms === null ? <span className="dim">–</span> : fmtDuration(d.p95Ms)}</td>
                          <td className="r tnum">{d.openBacklog}</td></> : <td colSpan={4} className="r rc-none"><Wait size={11} aria-hidden /> not enough evidence</td>}
                      </tr>))}</tbody>
                  </table></div>)}
                <p className="dim rc-foot">– means fewer than {r.minPercentileN} decisions.</p>
              </section>
              <section className="rc-box" aria-label="Observed span">
                <div className="rc-h"><Network size={13} aria-hidden /><b>Observed span</b><HelpTrigger k="ops.reviewCapacity.span" /></div>
                {r.span.rows.length === 0 ? <p className="dim rc-note">No reporting lines yet.</p> : (
                  <table className="rc-table" data-table="span">
                    <thead><tr><th scope="col">Supervisor</th><th scope="col" className="r">Agents</th><Th k="ops.reviewCapacity.backlog">Open items</Th></tr></thead>
                    <tbody>{r.span.rows.map((s) => <tr key={s.supervisorId} data-supervisor={s.supervisorId}><th scope="row" className="ellipsis">{s.name}</th><td className="r tnum">{s.agents}</td><td className="r tnum">{s.openItems === null ? <span className="dim" title="Hidden: too few items or people behind it">–</span> : s.openItems}</td></tr>)}</tbody>
                  </table>)}
                <p className="dim rc-foot">{r.span.note}{!admin && r.span.rows.some((x) => x.openItems === null) ? ` – means hidden: fewer than ${r.minItems} items or ${r.minPeople} people behind it.` : ''}</p>
              </section>
            </div>
            <div className="rc-people">
              <div className="rc-h">
                <Users size={13} aria-hidden /><b>Per person</b><HelpTrigger k="ops.reviewCapacity.people" /><span className="spacer" />
                {!admin ? <span className="dim row" style={{ gap: 4, fontSize: 12 }} data-people="hidden"><Lock size={12} aria-hidden />administrators only</span>
                  : <button type="button" className="btn sm ghost" aria-expanded={showPeople} onClick={() => setShowPeople((v) => !v)}>{showPeople ? 'Hide' : 'Show'}</button>}
                <span className="dim row" style={{ gap: 4, fontSize: 12, marginLeft: 8 }}><Wait size={12} aria-hidden />Utilisation: not measured<HelpTrigger k="ops.reviewCapacity.utilisation" /></span>
              </div>
              {admin && showPeople && (!people ? <LiveStatus className="dim">Reading people…</LiveStatus> : people.people.length === 0 ? <p className="dim rc-note" data-people="empty">Nobody decided in this window.</p> : (
                <div className="rc-scroll"><table className="rc-table" data-table="people">
                  <thead><tr><th scope="col">Person (A to Z)</th><Th k="ops.reviewCapacity.decided">Decided</Th><Th k="ops.reviewCapacity.median">Median</Th><Th k="ops.reviewCapacity.p95">Slowest 5%</Th></tr></thead>
                  <tbody>{people.people.map((p) => <tr key={p.userId} data-person={p.name}><th scope="row">{p.name}</th><td className="r tnum">{p.decided}</td>
                    <td className="r tnum">{p.p50Ms === null ? <span className="dim">needs {people.minPercentileN}</span> : fmtDuration(p.p50Ms)}</td><td className="r tnum">{p.p95Ms === null ? <span className="dim">needs {people.minPercentileN}</span> : fmtDuration(p.p95Ms)}</td></tr>)}</tbody>
                </table></div>))}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
