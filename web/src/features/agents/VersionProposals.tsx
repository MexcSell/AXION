import { AnimatePresence, motion } from 'motion/react';
import { LiveStatus } from '@/components/ui/LiveStatus';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  GitBranchPlus, Plus, Minus, ArrowRight, Check, X, Undo2, Clock, CheckCircle2, XCircle, Hourglass, AlertOctagon, AlertTriangle, Lock, Sprout, FlaskConical, Cpu, Wrench, Sparkles, ShieldCheck, TrendingDown, CircleHelp,
} from 'lucide-react';
import type { EvalOutcome, ProposalEvaluationDto, VersionDiff, VersionProposalDto, VersionProposalStatus } from '@contracts';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Form';
import { Chip } from '@/components/ui/Chips';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { EmptyState } from '@/components/ui/EmptyState';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { useAgentsCatalog } from '@/api/agents';
import { useVersionProposals, decideVersionProposal, withdrawVersionProposal } from '@/api/versionProposals';
import { AGENT_BY_ID } from '@/data/agents';
import { isAdmin, useMe } from '@/store/auth';
import { toast } from '@/store/ui';
import { ago, cx } from '@/lib/format';
import { ServerMentoringList } from '@/features/agents/Mentoring';
import { PlaybookPanel } from '@/features/agents/Playbooks';
import '@/theme/pages/overview-org-agent.css';

/* Improvement cycle 5 (api mode): agent version proposals. Only stored facts are shown: base → candidate (skills and
   tools added or removed, the model change), the hypothesis, the author, age and status. c47: when stored runs exist the
   card shows the server's evaluation (outcome, n, refusals); otherwise it says there is none. Nothing is invented. */

export const VP_STATUS: Record<VersionProposalStatus, { label: string; hue: number; icon: typeof Clock }> = {
  pending: { label: 'Pending', hue: 38, icon: Clock },
  promoted: { label: 'Promoted', hue: 145, icon: CheckCircle2 },
  rejected: { label: 'Rejected', hue: 0, icon: XCircle },
  expired: { label: 'Expired', hue: 225, icon: Hourglass },
  withdrawn: { label: 'Withdrawn', hue: 225, icon: Undo2 },
};

/** base → candidate: one chip per added (+) or removed (−) skill or tool, and the model change. */
export function VersionDiffView({ d, empty = 'No change' }: { d: VersionDiff; empty?: string }) {
  const item = (kind: 'add' | 'rm', what: 'skill' | 'tool', v: string) => (
    <span key={kind + what + v} className={cx('oa-line', kind)} data-diff={`${what}-${kind}`} data-value={v}>
      {kind === 'add' ? <Plus size={11} aria-label="added" /> : <Minus size={11} aria-label="removed" />}
      {what === 'tool' ? <Wrench size={11} aria-label="tool" /> : <Sparkles size={11} aria-label="skill" />}<b>{v}</b>
    </span>
  );
  const lines = [
    ...d.skillsAdded.map((v) => item('add', 'skill', v)), ...d.skillsRemoved.map((v) => item('rm', 'skill', v)),
    ...d.toolsAdded.map((v) => item('add', 'tool', v)), ...d.toolsRemoved.map((v) => item('rm', 'tool', v)),
  ];
  return (
    <div className="oa-lines" data-version-diff={d.changed ? 'changed' : 'none'}>
      {d.model && <span className="oa-line add" data-diff="model" data-from={d.model.from} data-to={d.model.to}><Cpu size={11} aria-label="model" /><span className="dim">{d.model.from}</span><ArrowRight size={11} aria-hidden /><b>{d.model.to}</b></span>}
      {lines}
      {!d.changed && <span className="dim" style={{ fontSize: 11.5 }}>{empty}</span>}
    </div>
  );
}

export const EVAL_OUTCOME: Record<EvalOutcome, { label: string; hue: number; icon: typeof Clock; hint: string }> = {
  verified_better: { label: 'Verified better', hue: 145, icon: ShieldCheck, hint: 'Measured better than the active version on a frozen holdout, with no refusal' },
  inconclusive: { label: 'Inconclusive', hue: 38, icon: CircleHelp, hint: 'The evidence cannot establish a difference. This is not a loss.' },
  worse: { label: 'Worse', hue: 0, icon: TrendingDown, hint: 'Measured significantly worse than the active version' },
};
const pts = (x: number | null) => (x === null ? 'n/a' : `${x > 0 ? '+' : ''}${x.toFixed(1)}`);
const pct = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `${Math.round(x * 100)}%`);

/** The measured evidence for a candidate, compact: outcome chip, n, wins/losses and the mean gain on one line; the interval,
    pass^1, dataset and every refusal reason sit behind "Details" (the reasons are named on the summary line). Only server values. */
export function EvaluationView({ e, sample }: { e: ProposalEvaluationDto; sample?: boolean }) {
  const O = EVAL_OUTCOME[e.outcome];
  const codes = e.refusals.map((r) => r.code);
  return (
    <div className="col" style={{ gap: 3, fontSize: 12, padding: '6px 10px', borderRadius: 10, background: 'var(--panel-3)', border: '1px solid var(--border-soft)' }} data-evaluation={e.outcome} data-evaluation-sample={sample ? '1' : undefined}>
      <div className="row wrap" style={{ gap: 6 }}>
        <FlaskConical size={14} className="dim" aria-hidden />
        <span data-eval-outcome={e.outcome}><Chip hue={O.hue} icon={O.icon} size="sm" solid={e.outcome === 'verified_better'} title={O.hint}>{O.label}</Chip></span>
        <span className="tnum" data-eval-n={e.n} title="Cases scored on both the active version and the candidate">n = {e.n}</span>
        <span className="dim tnum">{e.wins} won · {e.losses} lost · mean {pts(e.delta)} pts</span>
        {e.grading.regrade && <Chip hue={260} size="sm" title={`One run's grades were replaced by a re-grade recorded by ${e.grading.regrade.byName}, so the two runs are compared under one grader`} data-eval-regraded={e.grading.regrade.id}>re-graded by {e.grading.regrade.byName}</Chip>}
        {e.validity.unvalidated && <><Chip hue={38} size="sm" title={e.validity.status === 'failing' ? `The dataset checklist has "no" answers: ${e.validity.failedItems.join(', ')}` : e.validity.canBeAttested ? 'The holdout dataset was not attested (checklist) before it was frozen, so this evidence is unvalidated' : 'This dataset was created before its author was recorded, so it can never be attested. Freeze a new dataset to get validated evidence'} data-eval-unvalidated={e.validity.status} data-eval-attestable={e.validity.canBeAttested ? '1' : '0'}>unvalidated</Chip><HelpTrigger k="agent.version.unvalidated" /></>}
        {e.runCount > 1 && <Chip hue={38} size="sm" title="More than one run on this holdout">{e.runCount} runs</Chip>}
        {sample && <Chip hue={225} size="sm" title="Demo data: nothing was measured">Sample</Chip>}
        <span className="spacer" /><HelpTrigger k="agent.version.evaluation" />
      </div>
      <details data-eval-details>
        <summary className="dim" style={{ cursor: 'pointer', fontSize: 11.5 }} data-eval-summary>
          {codes.length ? <>Not trusted: <span className="mono">{codes.slice(0, 2).join(', ')}{codes.length > 2 ? ` +${codes.length - 2}` : ''}</span></> : e.outcome === 'verified_better' ? 'Details' : (e.reasons[0] ?? 'Details')}
        </summary>
        <div className="col" style={{ gap: 3, marginTop: 4 }}>
          <div className="row wrap dim tnum" style={{ gap: 10 }}>
            <span>{e.ties} tied</span>
            <span>{e.ci.low !== null && e.ci.high !== null ? `95% interval ${pts(e.ci.low)} to ${pts(e.ci.high)}` : 'no interval'}</span>
            {e.passHatK.baseline[0] !== undefined && <span>pass^1 {pct(e.passHatK.baseline[0])} → {pct(e.passHatK.candidate[0])}</span>}
            <span data-eval-graded title={`Graded attempts of each run (an ungraded attempt is not a failure). Grader: base ${e.grading.baseline?.graderName ? `${e.grading.baseline.graderName} ${e.grading.baseline.graderVersion}` : 'not recorded'}, candidate ${e.grading.candidate.graderName ? `${e.grading.candidate.graderName} ${e.grading.candidate.graderVersion}` : 'not recorded'}`}>
              graded {e.grading.baseline ? `${e.grading.baseline.graded}/${e.grading.baseline.attempted}` : 'n/a'} → {e.grading.candidate.graded}/{e.grading.candidate.attempted}
            </span>
            <span className="mono" title={e.datasetSha ?? ''}>holdout {e.datasetId}{e.datasetSha ? ` · ${e.datasetSha.slice(0, 8)}` : ''}</span>
          </div>
          {e.refusals.length > 0 && (
            <ul className="col" style={{ gap: 2, margin: 0, paddingLeft: 16 }} data-eval-refusals aria-label="Why this evaluation is not trusted">
              {e.refusals.map((r) => <li key={r.code + r.detail} data-refusal={r.code}><b className="mono">{r.code}</b>: {r.detail}</li>)}
            </ul>
          )}
          {e.refusals.length === 0 && e.reasons.length > 0 && e.outcome !== 'verified_better' && <div className="dim" data-eval-reason>{e.reasons.join(' ')}</div>}
        </div>
      </details>
    </div>
  );
}

/** Where a comparison would go: there is none, and the card says why. */
export function NoEvaluation() {
  return (
    <div className="row" style={{ gap: 8, fontSize: 12, padding: '7px 10px', borderRadius: 10, background: 'var(--panel-3)', border: '1px dashed var(--border-soft)' }} data-evaluation="none">
      <FlaskConical size={14} className="dim" aria-hidden /><span className="dim">No evaluation yet. Evaluations run once agents execute.</span>
      <span className="spacer" /><HelpTrigger k="agent.version.evaluation" />
    </div>
  );
}

export function VersionProposalCard({ p, meId, admin, index, err, setErr, showAgent = true }: { p: VersionProposalDto; meId?: string; admin: boolean; index: number; err?: string; setErr: (m: string | null) => void; showAgent?: boolean }) {
  const [note, setNote] = useState('');
  const [override, setOverride] = useState('');
  const [busy, setBusy] = useState(false);
  const S = VP_STATUS[p.status];
  const pending = p.status === 'pending';
  const mine = p.createdBy === meId;
  const worse = p.evaluation?.outcome === 'worse';
  /** not verified better (no evaluation, inconclusive): promoting needs a written reason; the server enforces it */
  const needsOverride = !worse && p.evaluation?.outcome !== 'verified_better';
  const a = AGENT_BY_ID[p.agentId];
  const run = async (f: () => ReturnType<typeof withdrawVersionProposal>, done: string) => {
    if (busy) return;
    setBusy(true); setErr(null);
    const r = await f();
    setBusy(false);
    if (!r.ok) { setErr(r.message); toast({ tone: 'warning', title: `${p.title}: not done`, body: r.message }); return; }
    toast({ tone: 'success', title: done });
  };
  const ageMin = (Date.now() - new Date(p.createdAt).getTime()) / 60_000;
  const leftH = Math.max(0, (new Date(p.expiresAt).getTime() - Date.now()) / 3_600_000);
  return (
    <motion.article layout className="subpanel glass-card hoverable oa-pcard" data-version-proposal={p.id} data-status={p.status} data-agent={p.agentId}
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: .97 }} transition={{ delay: Math.min(index, 8) * .05 }}>
      <div className="row" style={{ gap: 10 }}>
        {showAgent && a ? <Link to={`/agents/${p.agentId}?tab=evolution`} aria-label={`Open ${p.agentName}`}><RobotAvatar role={a.role} size={38} animated={pending} /></Link>
          : <span className="oa-hex" style={{ ['--h' as string]: S.hue }}><GitBranchPlus size={18} /></span>}
        <div style={{ minWidth: 0, flex: 1 }}>
          <b style={{ fontSize: 14 }}>{p.title}</b>
          <div className="dim" style={{ fontSize: 11.5 }}>{showAgent && <><b>{p.agentName}</b> · </>}by {p.createdByName} · {ago(ageMin)}</div>
        </div>
        <Chip hue={S.hue} icon={S.icon} size="sm" solid={pending} className={cx(pending && 'oa-pulse')}>{S.label}</Chip>
      </div>
      <p className="muted" style={{ fontSize: 12.5, margin: '6px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} data-hypothesis title={p.hypothesis}><span className="dim">Hypothesis: </span>{p.hypothesis}</p>
      <div className="row wrap" style={{ gap: 6, margin: '6px 0' }}>
        <Chip hue={225} size="sm" className="mono" title="The active version when this was proposed">{p.baseVersionLabel}</Chip>
        <ArrowRight size={12} className="dim" aria-hidden />
        {p.promotedVersionLabel ? <Chip hue={145} icon={CheckCircle2} size="sm" className="mono" title="The version this promotion created">{p.promotedVersionLabel}</Chip> : <Chip hue={290} size="sm" title="Becomes the next version when promoted">candidate</Chip>}
        {p.stale && <Chip hue={0} icon={AlertTriangle} size="sm" title="The agent changed since: this proposal can only be rejected or withdrawn">stale: base is no longer active</Chip>}
        {pending && <Chip hue={260} icon={Hourglass} size="sm" title={new Date(p.expiresAt).toLocaleString()}>expires in {leftH >= 48 ? `${Math.round(leftH / 24)} d` : `${Math.ceil(leftH)} h`}</Chip>}
        <VersionDiffView d={p.diff} />
      </div>
      <div>{p.evaluation ? <EvaluationView e={p.evaluation} /> : <NoEvaluation />}</div>
      {p.decidedByName && !pending && (
        <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>{S.label} by {p.decidedByName}{p.decidedAt ? ` · ${ago((Date.now() - new Date(p.decidedAt).getTime()) / 60_000)}` : ''}{p.note ? <> · “{p.note}”</> : null}</div>
      )}
      {p.overrideReason && <div className="dim" style={{ fontSize: 12, marginTop: 6 }} data-override-shown><b>Promoted without a verified evaluation.</b> Reason: “{p.overrideReason}”</div>}
      {err && <div className="oa-banner" role="alert" style={{ marginTop: 8 }} data-card-error><AlertOctagon size={15} /><span>{err}</span></div>}
      {pending && admin && (mine ? (
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <span className="dim" style={{ fontSize: 12 }}>Your proposal: another administrator decides it.</span><span className="spacer" />
          <button className="btn sm" disabled={busy} onClick={() => run(() => withdrawVersionProposal(p), `${p.title}: withdrawn`)}><Undo2 size={13} />Withdraw</button>
          <HelpTrigger k="agent.version.withdraw" />
        </div>
      ) : (
        <div className="col" style={{ gap: 8, marginTop: 10 }}>
        {needsOverride && (
          <div className="row" style={{ gap: 8 }}>
            <input className="input" style={{ flex: 1, minWidth: 0, height: 32 }} value={override} onChange={(e) => setOverride(e.target.value)} maxLength={1000} data-override-reason
              placeholder="Override reason: not verified better (10+ characters)" aria-label={`Override reason for ${p.title}`} />
            <span className="dim tnum" style={{ fontSize: 11.5 }} data-override-count>{override.trim().length}/10</span>
            <HelpTrigger k="agent.version.override" />
          </div>
        )}
        <div className="row" style={{ gap: 8 }}>
          <input className="input" style={{ flex: 1, minWidth: 0, height: 32 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label={`Decision note for ${p.title}`} maxLength={1000} />
          <button className="btn sm primary" disabled={busy || worse} onClick={() => run(() => decideVersionProposal(p, 'promote', note, override), `${p.agentName}: candidate promoted`)}
            title={worse ? 'Measured worse than the active version: it cannot be promoted, only rejected' : p.stale ? 'The agent changed since: the server will refuse; reject it or ask for a new one' : needsOverride ? 'Not verified better: write the override reason first' : undefined}><Check size={13} />Promote</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => run(() => decideVersionProposal(p, 'reject', note), `${p.title}: rejected`)}><X size={13} />Reject</button>
          <HelpTrigger k="agent.version.decide" />
        </div>
        </div>
      ))}
    </motion.article>
  );
}

type Filter = 'all' | 'pending' | 'decided';
/** A list of proposals (all agents, or one), with the pending/decided filter and per-card errors. */
export function VersionProposalList({ agentId, compact }: { agentId?: string; compact?: boolean }) {
  useAgentsCatalog(); // names follow the live catalog
  const { data, error, retry } = useVersionProposals(agentId);
  const me = useMe();
  const admin = isAdmin(me);
  const [filter, setFilter] = useState<Filter>(agentId ? 'all' : 'pending');
  // a card whose action the server refused keeps its message, and stays listed even if its status left the filter
  const [errs, setErrs] = useState<Record<string, string>>({});
  const setErr = (id: string) => (m: string | null) => setErrs((x) => { const n = { ...x }; if (m) n[id] = m; else delete n[id]; return n; });
  const all = data ?? [];
  const list = all.filter((p) => errs[p.id] || filter === 'all' || (filter === 'pending' ? p.status === 'pending' : p.status !== 'pending'));
  const nPending = all.filter((p) => p.status === 'pending').length;
  const head = (
    <div className="row wrap" style={{ gap: 8 }}>
      <Segmented ariaLabel="Version proposal filter" size="sm" value={filter} onChange={setFilter} options={[{ key: 'pending', label: `Pending (${nPending})` }, { key: 'decided', label: 'Decided' }, { key: 'all', label: 'All' }]} />
      {!admin && <Chip hue={225} icon={Lock} size="sm" title="Only administrators propose and decide">Read only</Chip>}
    </div>
  );
  return (
    <div className="col" style={{ gap: 10 }} data-version-proposals={data ? 'ready' : error ? 'error' : 'loading'}>
      {head}
      {error && <div className="oa-banner" role="alert"><AlertOctagon size={15} /><span>Version proposals not loaded: {error}</span><button className="btn sm" onClick={retry}>Retry</button></div>}
      {!data && !error ? <LiveStatus className="dim" style={{ padding: 12 }}>Loading proposals…</LiveStatus>
        : list.length === 0 ? <EmptyState icon={GitBranchPlus} title={filter === 'pending' ? 'No version proposals waiting' : 'No version proposals here'}
          body={admin ? (agentId ? 'Propose a change from the active version with “Propose a change”. Another administrator promotes it.' : 'Open an agent › Evolution › Versions and use “Propose a change”. Another administrator promotes it.') : 'Administrators propose new agent versions here.'}
          action={filter !== 'all' && all.length ? <button className="btn" onClick={() => setFilter('all')}>Show all</button> : undefined} />
        : (
          <div className={compact ? 'col' : 'oa-prop-grid'} style={compact ? { gap: 10 } : undefined}>
            <AnimatePresence>
              {list.map((p, i) => <VersionProposalCard key={p.id} p={p} meId={me?.id} admin={admin} index={i} err={errs[p.id]} setErr={setErr(p.id)} showAgent={!agentId} />)}
            </AnimatePresence>
          </div>
        )}
    </div>
  );
}

/** Agents › Development in api mode: every agent's version proposals. (Demo mode keeps the DEMO Development tab.) */
export function ServerDevelopment() {
  return (
    <div className="col" style={{ gap: 'var(--gap)' }}>
      <Panel icon={Sprout} titleSize="lg" title="Version proposals" help="agent.version.proposals" delay={.05} data-dev-proposals=""
        sub="Candidate versions of agents: proposed by an administrator, promoted by another, rolled back to the last good version in one step. Running missions stay on their pinned version.">
        <VersionProposalList />
      </Panel>
      <ServerMentoringList />
      <PlaybookPanel />
    </div>
  );
}
