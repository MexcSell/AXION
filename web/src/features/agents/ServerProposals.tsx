import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import {
  GitPullRequest, Plus, Minus, ArrowRight, Check, X, Undo2, Clock, CheckCircle2, XCircle, Hourglass, AlertOctagon, AlertTriangle, ShieldCheck, Lock, Lightbulb,
} from 'lucide-react';
import type { OrgDryRun, OrgEdgeDto, OrgProposalDto, OrgProposalStatus } from '@contracts';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Form';
import { Chip } from '@/components/ui/Chips';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAgentsCatalog } from '@/api/agents';
import { useOrgProposals, decideProposal, withdrawProposal } from '@/api/orgProposals';
import { AGENT_BY_ID } from '@/data/agents';
import { isAdmin, useMe } from '@/store/auth';
import { openDialog, toast } from '@/store/ui';
import { ago, cx } from '@/lib/format';
import '@/theme/pages/overview-org-agent.css';

/* Improvement cycle 1 (api mode): the server's organisation proposals. Only stored facts are shown: the lines a
   proposal adds and removes, the dry-run errors and warnings, its base revision and its status. No estimates. */

const name = (id: string) => AGENT_BY_ID[id]?.name ?? id;
const STATUS: Record<OrgProposalStatus, { label: string; hue: number; icon: typeof Clock }> = {
  pending: { label: 'Pending', hue: 38, icon: Clock },
  approved: { label: 'Approved', hue: 145, icon: CheckCircle2 },
  applied: { label: 'Applied', hue: 145, icon: CheckCircle2 },
  rejected: { label: 'Rejected', hue: 0, icon: XCircle },
  failed: { label: 'Failed', hue: 0, icon: AlertOctagon },
  expired: { label: 'Expired', hue: 225, icon: Hourglass },
  withdrawn: { label: 'Withdrawn', hue: 225, icon: Undo2 },
};

function Line({ e, kind }: { e: OrgEdgeDto; kind: 'add' | 'rm' }) {
  return (
    <span className={cx('oa-line', kind)} data-line={kind} data-from={e.supervisorId} data-to={e.subordinateId}>
      {kind === 'add' ? <Plus size={11} aria-label="added" /> : <Minus size={11} aria-label="removed" />}
      <b>{name(e.supervisorId)}</b><ArrowRight size={11} aria-hidden /><b>{name(e.subordinateId)}</b>
    </span>
  );
}

/** The server's dry run: errors (red), warnings (amber), and the reporting lines added and removed as "A → B". */
export function DryRunView({ r, max = 6 }: { r: OrgDryRun; max?: number }) {
  const lines = [...r.added.map((e) => ({ e, kind: 'add' as const })), ...r.removed.map((e) => ({ e, kind: 'rm' as const }))];
  return (
    <div className="oa-dry" data-dry-run={r.ok ? 'ok' : 'errors'}>
      <div className="row wrap" style={{ gap: 6 }}>
        {r.ok ? <Chip hue={145} icon={ShieldCheck} size="sm">Checks passed</Chip> : <Chip hue={0} icon={AlertOctagon} size="sm">{r.errors.length} {r.errors.length === 1 ? 'error' : 'errors'}</Chip>}
        {r.warnings.length > 0 && <Chip hue={38} icon={AlertTriangle} size="sm">{r.warnings.length} {r.warnings.length === 1 ? 'warning' : 'warnings'}</Chip>}
        <span className="dim" style={{ fontSize: 11.5 }}>{r.added.length} added · {r.removed.length} removed</span>
      </div>
      {r.errors.map((x, i) => <div key={'e' + i} className="oa-issue bad" data-issue={x.code}><AlertOctagon size={13} aria-hidden /><span>{x.message}</span></div>)}
      {r.warnings.map((x, i) => <div key={'w' + i} className="oa-issue warn" data-issue={x.code}><AlertTriangle size={13} aria-hidden /><span>{x.message}</span></div>)}
      {lines.length > 0 && (
        <div className="oa-lines">
          {lines.slice(0, max).map(({ e, kind }) => <Line key={kind + e.subordinateId + e.supervisorId} e={e} kind={kind} />)}
          {lines.length > max && <span className="dim" style={{ fontSize: 11.5 }}>+{lines.length - max} more</span>}
        </div>
      )}
    </div>
  );
}

function ProposalCard({ p, active, meId, admin, index }: { p: OrgProposalDto; active: number; meId?: string; admin: boolean; index: number }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const S = STATUS[p.status];
  const pending = p.status === 'pending';
  const mine = p.createdBy === meId;
  const stale = pending && p.baseRevision !== active;
  const run = async (f: () => ReturnType<typeof withdrawProposal>, done: string) => {
    if (busy) return;
    setBusy(true); setErr(null);
    const r = await f();
    setBusy(false);
    if (!r.ok) { setErr(r.message); return; }
    toast({ tone: 'success', title: done });
  };
  const ageMin = (Date.now() - new Date(p.createdAt).getTime()) / 60_000;
  const leftH = Math.max(0, (new Date(p.expiresAt).getTime() - Date.now()) / 3_600_000);
  return (
    <motion.article layout className="subpanel glass-card hoverable oa-pcard" data-proposal={p.id} data-status={p.status}
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: .97 }} transition={{ delay: Math.min(index, 8) * .05 }}>
      <div className="row" style={{ gap: 10 }}>
        <span className="oa-hex" style={{ ['--h' as string]: S.hue }}><GitPullRequest size={18} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <b style={{ fontSize: 14 }}>{p.title}</b>
          <div className="dim" style={{ fontSize: 11.5 }}>{p.id} · by {p.createdByName} · {ago(ageMin)}</div>
        </div>
        <Chip hue={S.hue} icon={S.icon} size="sm" solid={pending} className={cx(pending && 'oa-pulse')}>{S.label}</Chip>
      </div>
      {p.why && <p className="muted" style={{ fontSize: 12.5, margin: '8px 0 0' }}>{p.why}</p>}
      <div className="row wrap" style={{ gap: 6, margin: '8px 0' }}>
        <Chip hue={225} size="sm" title="The org revision that was active when this was proposed">base rev {p.baseRevision}</Chip>
        {stale && <Chip hue={0} icon={AlertTriangle} size="sm" title="The organisation changed since: this proposal can only be rejected or withdrawn">stale: rev {active} is active</Chip>}
        {p.appliedRevision !== null && <Chip hue={145} icon={CheckCircle2} size="sm">applied as rev {p.appliedRevision}</Chip>}
        {pending && <Chip hue={260} icon={Hourglass} size="sm" title={new Date(p.expiresAt).toLocaleString()}>expires in {leftH >= 48 ? `${Math.round(leftH / 24)} d` : `${Math.ceil(leftH)} h`}</Chip>}
      </div>
      <DryRunView r={p.result} />
      {p.decidedByName && p.status !== 'pending' && (
        <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>{S.label} by {p.decidedByName}{p.decidedAt ? ` · ${ago((Date.now() - new Date(p.decidedAt).getTime()) / 60_000)}` : ''}{p.decisionNote ? <> · “{p.decisionNote}”</> : null}</div>
      )}
      {err && <div className="oa-banner" role="alert" style={{ marginTop: 8 }}><AlertOctagon size={15} /><span>{err}</span></div>}
      {pending && admin && (mine ? (
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <span className="dim" style={{ fontSize: 12 }}>Your proposal: another administrator decides it.</span><span className="spacer" />
          <button className="btn sm" disabled={busy} onClick={() => run(() => withdrawProposal(p), `Proposal ${p.id} withdrawn`)}><Undo2 size={13} />Withdraw</button>
          <HelpTrigger k="org.proposal.withdraw" />
        </div>
      ) : (
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <input className="input" style={{ flex: 1, minWidth: 0, height: 32 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label={`Decision note for ${p.title}`} maxLength={1000} />
          <button className="btn sm primary" disabled={busy || !p.result.ok || stale} onClick={() => run(() => decideProposal(p, 'approve', note), `Proposal ${p.id} applied`)}
            title={!p.result.ok ? 'The dry run found errors: it cannot be approved' : stale ? 'The organisation changed since: reject it or ask for a new one' : undefined}><Check size={13} />Approve</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => run(() => decideProposal(p, 'reject', note), `Proposal ${p.id} rejected`)}><X size={13} />Reject</button>
          <HelpTrigger k="org.proposal.decide" />
        </div>
      ))}
    </motion.article>
  );
}

type Filter = 'all' | 'pending' | 'decided';
export function ServerProposals() {
  useAgentsCatalog(); // names follow the live catalog
  const { data, error, retry } = useOrgProposals();
  const me = useMe();
  const admin = isAdmin(me);
  const [filter, setFilter] = useState<Filter>('pending');
  const all = data?.proposals ?? [];
  const list = all.filter((p) => filter === 'all' || (filter === 'pending' ? p.status === 'pending' : p.status !== 'pending'));
  const nPending = all.filter((p) => p.status === 'pending').length;
  return (
    <Panel icon={Lightbulb} titleSize="lg" title="Organization Proposals" help="org.proposals.server" sub="Reporting-line changes: checked by the server, approved by a second administrator, applied as a new org revision." delay={.05} data-proposals=""
      actions={<div className="row wrap" style={{ gap: 8 }}>
        <Segmented ariaLabel="Proposal filter" size="sm" value={filter} onChange={setFilter} options={[{ key: 'pending', label: `Pending (${nPending})` }, { key: 'decided', label: 'Decided' }, { key: 'all', label: 'All' }]} />
        {data && <Chip hue={145} size="sm" title="The active organisation revision">active rev <b data-active-revision={data.activeRevision}>{data.activeRevision}</b></Chip>}
        {admin ? <button className="btn primary" onClick={() => openDialog('org-proposal-new')}><Plus size={15} />New proposal</button>
          : <Chip hue={225} icon={Lock} size="sm" title="Only administrators propose and decide">Read only</Chip>}
        {admin && <HelpTrigger k="org.proposal.new" />}
      </div>}>
      {error && <div className="oa-banner" role="alert" style={{ marginBottom: 10 }}><AlertOctagon size={15} /><span>Proposals not loaded: {error}</span><button className="btn sm" onClick={retry}>Retry</button></div>}
      {!data && !error ? <div className="dim" style={{ padding: 20 }}>Loading proposals…</div>
        : list.length === 0 ? <EmptyState icon={GitPullRequest} title={filter === 'pending' ? 'No proposals waiting' : 'No proposals here'} body={admin ? 'Propose a new reporting line with “New proposal”. Another administrator approves it.' : 'Administrators propose reporting-line changes here.'} action={filter !== 'all' && all.length ? <button className="btn" onClick={() => setFilter('all')}>Show all</button> : undefined} />
        : (
          <div className="oa-prop-grid">
            <AnimatePresence>
              {list.map((p, i) => <ProposalCard key={p.id} p={p} active={data!.activeRevision} meId={me?.id} admin={admin} index={i} />)}
            </AnimatePresence>
          </div>
        )}
    </Panel>
  );
}
