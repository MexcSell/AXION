import { useState } from 'react';
import { motion } from 'motion/react';
import { Gauge, Timer, ListOrdered, Zap, Percent, Lock, Users, Hourglass } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Segmented } from '@/components/ui/Form';
import { DemoTag } from '@/components/ui/Chips';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { LiveStatus } from '@/components/ui/LiveStatus';
import { isApi } from '@/api/mode';
import { useApprovalQuality } from '@/api/approvalQuality';
import { demoQuality } from '@/data/approvalQualityDemo';
import { useMe, isAdmin } from '@/store/auth';
import { fmtDuration } from '@/features/approvals/quality';
import { cx } from '@/lib/format';
import type { DialogComponentProps } from '@/dialogs/DialogHost';
import '@/theme/pages/c58-approval-quality.css';

/* DL-100: Approval quality (improvement cycle 58, research R2-9). How decisions were made: records and display only. Nothing on this
   screen approves, denies or blocks anything, and no flag here changes a decision. Everyone sees aggregates; the per-approver table
   is for administrators (it describes a person). Below five decisions a cell says "not enough evidence" and shows no number. */
const pct = (r: number) => `${Math.round(r * 100)}%`;
const WINDOWS = [7, 30, 90] as const;

function Cell({ icon: Icon, label, value, n, enough, i, testid }: { icon: typeof Gauge; label: string; value: string; n: number; enough: boolean; i: number; testid: string }) {
  return (
    <motion.div className={cx('aq-cell', !enough && 'none')} data-cell={testid} data-enough={enough ? 'yes' : 'no'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .05 + i * .04 }}
      aria-label={enough ? `${label}: ${value}, n = ${n}` : `${label}: not enough evidence, n = ${n}`}>
      <span className="aq-cl"><Icon size={13} aria-hidden />{label}</span>
      {enough ? <span className="aq-cv tnum">{value}</span> : <span className="aq-cv aq-none"><Hourglass size={13} aria-hidden />not enough evidence</span>}
      <span className="aq-cm tnum">n = {n}</span>
    </motion.div>
  );
}

function ApprovalQuality({ close }: DialogComponentProps) {
  const api_ = isApi();
  const admin = isAdmin(useMe());
  const [w, setW] = useState<number>(30);
  const live = useApprovalQuality(w, admin);
  const demo = !api_ ? demoQuality(w) : null;
  const agg = api_ ? live.agg : demo!.agg;
  const approvers = api_ ? live.approvers : admin ? demo!.approvers : null;
  return (
    <Modal title="Approval quality" icon={Gauge} help="approval.quality" dialogId="DL-100" size="lg" onClose={close}
      sub="How decisions were made. Records only: nothing here approves, denies or blocks anything.">
      <div data-approval-quality={agg ? 'ready' : live.error ? 'error' : 'loading'} data-window={w}>
        <div className="aq-bar">
          <Segmented size="sm" ariaLabel="Window" value={String(w)} onChange={(k) => setW(Number(k))} options={WINDOWS.map((d) => ({ key: String(d), label: `${d}d`, title: `last ${d} days` }))} />
          <span className="spacer" />
          {!api_ && <DemoTag title="SAMPLE numbers: invented, only to show the layout. The server version shows recorded decisions." />}
          <span className="dim aq-win">{agg ? `last ${agg.windowDays} days, from ${new Date(agg.windowStart).toLocaleDateString()}` : ' '}</span>
        </div>
        {!agg ? (live.error ? <LiveStatus kind="error" className="dim">{live.error} <button type="button" className="btn sm ghost" onClick={live.retry}>Retry</button></LiveStatus> : <LiveStatus className="dim">Reading the decision records…</LiveStatus>) : (
          <>
            <div className="aq-cells" role="list" aria-label="All approvers together">
              <Cell i={0} testid="n" icon={ListOrdered} label="Decisions" value={String(agg.n)} n={agg.n} enough />
              <Cell i={1} testid="rate" icon={Percent} label="Approval rate" value={agg.approvalRate === null ? '' : pct(agg.approvalRate)} n={agg.n} enough={agg.enough} />
              <Cell i={2} testid="latency" icon={Timer} label="Median time" value={agg.medianLatencyMs === null ? '' : fmtDuration(agg.medianLatencyMs)} n={agg.n} enough={agg.enough} />
              <Cell i={3} testid="queue" icon={ListOrdered} label="Median queue" value={agg.medianQueueSize === null ? '' : String(agg.medianQueueSize)} n={agg.n} enough={agg.enough} />
              <Cell i={4} testid="fast" icon={Zap} label="Quick runs flagged" value={agg.fastBulk === null ? '' : String(agg.fastBulk)} n={agg.n} enough={agg.enough} />
            </div>
            <div className="aq-people">
              <div className="row aq-ph"><Users size={14} aria-hidden /><b>Per approver</b><HelpTrigger k="approval.quality.approvers" /><span className="spacer" />{!admin && <span className="dim row" style={{ gap: 4, fontSize: 12 }}><Lock size={12} aria-hidden />administrators only</span>}</div>
              {!admin ? <p className="dim aq-note" data-approvers="hidden">Per-person numbers describe an individual, so only administrators see them. You see the totals above.</p>
                : !approvers ? <LiveStatus className="dim">Reading approvers…</LiveStatus>
                  : approvers.approvers.length === 0 ? <p className="dim aq-note" data-approvers="empty">No recorded decisions in this window.</p> : (
                    <table className="aq-table" data-approvers="table">
                      <thead><tr><th scope="col">Approver</th><th scope="col" className="r">n</th><th scope="col" className="r">Approval rate</th><th scope="col" className="r">Median time</th><th scope="col" className="r">Quick runs</th></tr></thead>
                      <tbody>{approvers.approvers.map((p) => (
                        <tr key={p.userId} data-approver={p.name} data-enough={p.enough ? 'yes' : 'no'}>
                          <th scope="row">{p.name}</th>
                          <td className="r tnum">{p.n}</td>
                          {p.enough ? <><td className="r tnum">{pct(p.approvalRate ?? 0)}</td><td className="r tnum">{fmtDuration(p.medianLatencyMs ?? 0)}</td><td className="r tnum">{p.fastBulk}</td></>
                            : <td colSpan={3} className="r aq-none"><Hourglass size={12} aria-hidden /> not enough evidence (n = {p.n}, needs {approvers.minEvidence})</td>}
                        </tr>))}</tbody>
                    </table>)}
            </div>
            <p className="dim aq-foot">A quick run means three or more decisions at R2 or above by one person within a minute. It is a prompt to look again, never a block.</p>
          </>
        )}
      </div>
    </Modal>
  );
}

export const dialogs = { 'approval-quality': ApprovalQuality };
