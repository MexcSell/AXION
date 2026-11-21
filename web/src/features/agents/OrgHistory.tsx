import { LiveStatus } from '@/components/ui/LiveStatus';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  History, GitCommitVertical, GitPullRequest, UserPlus, Sprout, CircleDot, ArrowRight, Undo2, AlertOctagon, Lock, Target, ShieldCheck, Shuffle,
} from 'lucide-react';
import type { OrgDiffDto, OrgRevisionSummaryDto } from '@contracts';
import { Panel } from '@/components/ui/Panel';
import { Chip, DemoTag } from '@/components/ui/Chips';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAgentsCatalog } from '@/api/agents';
import { useOrgRevisions, useRevisionDiff, proposeRollback, newKey } from '@/api/orgProposals';
import { AGENT_BY_ID } from '@/data/agents';
import { isAdmin, useMe } from '@/store/auth';
import { toast } from '@/store/ui';
import { ago, cx } from '@/lib/format';
import { Line } from './OrgLine';
import '@/theme/pages/overview-org-agent.css';

/* Improvement cycle 4 (api mode): the organisation's history. One card per stored revision (newest first) with who made it
   and its source; the selected revision's diff against the one before it (moved, added and removed lines) and the active
   missions it touches, which are only listed: running missions keep their teams. An administrator can propose a rollback,
   which is a new ordinary proposal that another administrator decides. Only stored facts are shown. */

const name = (id: string) => AGENT_BY_ID[id]?.name ?? id;
const SOURCE: Record<OrgRevisionSummaryDto['source']['kind'], { icon: typeof Sprout; hue: number }> = {
  proposal: { icon: GitPullRequest, hue: 260 }, agent: { icon: UserPlus, hue: 190 }, seed: { icon: Sprout, hue: 145 }, other: { icon: CircleDot, hue: 225 },
};
function sourceText(r: OrgRevisionSummaryDto) {
  const s = r.source;
  return s.kind === 'proposal' ? s.title : s.kind === 'agent' ? `agent created: ${name(s.agentId)}` : s.kind === 'seed' ? 'seed' : (r.note || 'other');
}
const minutesSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 60_000;

function RevisionCard({ r, latest, selected, onSelect, index }: { r: OrgRevisionSummaryDto; latest: boolean; selected: boolean; onSelect: () => void; index: number }) {
  const S = SOURCE[r.source.kind];
  return (
    <motion.button type="button" layout className={cx('oa-rev', selected && 'on')} onClick={onSelect} aria-pressed={selected}
      data-revision={r.seq} data-source={r.source.kind} data-changed={r.changed} aria-label={`Revision ${r.seq}: ${sourceText(r)}`}
      initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(index, 10) * .04 }}>
      <span className="oa-rev-dot" style={{ ['--h' as string]: S.hue }}><S.icon size={13} aria-hidden /></span>
      <span className="oa-rev-main">
        <span className="row" style={{ gap: 6 }}>
          <b>Revision {r.seq}</b>
          {latest && <Chip hue={145} size="sm" className="oa-pulse">active</Chip>}
          <span className="spacer" />
          <Chip hue={r.changed ? 38 : 225} size="sm" title="Reporting lines changed against the revision before it">{r.changed} {r.changed === 1 ? 'line' : 'lines'} changed</Chip>
        </span>
        <span className="oa-rev-src" title={sourceText(r)}>{sourceText(r)}</span>
        <span className="dim" style={{ fontSize: 11.5 }}>by {r.createdByName === 'system' ? 'the system' : r.createdByName} · <span title={new Date(r.activeFrom).toLocaleString()}>{ago(minutesSince(r.activeFrom))}</span></span>
      </span>
    </motion.button>
  );
}

function Section({ title, help, count, children }: { title: string; help: string; count?: number; children: ReactNode }) {
  return (
    <div className="oa-hsec">
      <div className="row" style={{ gap: 6, marginBottom: 6 }}>
        <b style={{ fontSize: 12.5 }}>{title}</b>{count !== undefined && <span className="dim" style={{ fontSize: 12 }}>({count})</span>}<HelpTrigger k={help} />
      </div>
      {children}
    </div>
  );
}

function DiffView({ d }: { d: OrgDiffDto }) {
  const none = !d.moved.length && !d.added.length && !d.removed.length;
  return (
    <>
      <Section title="Reporting lines" help="org.history.diff" count={d.moved.length + d.added.length + d.removed.length}>
        {none ? <div className="dim" style={{ fontSize: 12.5 }}>No reporting line changed.</div> : (
          <div className="oa-hmoves">
            {d.moved.map((m, i) => (
              <motion.div key={'m' + m.subordinate} className="oa-hmove" data-moved={m.subordinate} data-from={m.from} data-to={m.to}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .04 }}>
                <Shuffle size={13} aria-label="moved" /><b>{name(m.subordinate)}</b><span className="dim">:</span>
                <span className="oa-old">{name(m.from)}</span><ArrowRight size={12} aria-hidden /><span className="oa-new">{name(m.to)}</span>
              </motion.div>
            ))}
            {(d.added.length > 0 || d.removed.length > 0) && (
              <div className="oa-lines">
                {d.added.map((e) => <Line key={'a' + e.subordinateId} e={e} kind="add" />)}
                {d.removed.map((e) => <Line key={'r' + e.subordinateId} e={e} kind="rm" />)}
              </div>
            )}
          </div>
        )}
      </Section>
      <Section title="Active missions affected" help="org.history.impact" count={d.impact.length}>
        {d.impact.length === 0 ? <div className="dim" style={{ fontSize: 12.5 }} data-impact="none">{d.against === 0 ? 'The first revision: every line is new, so no agent\'s manager changed.' : 'No active mission you can see has an agent whose manager changed.'}</div> : (
          <ul className="oa-impact" data-impact={d.impact.length}>
            {d.impact.map((x) => (
              <li key={x.instanceId} data-impact-mission={x.missionId} data-impact-agent={x.agentId}>
                <Target size={13} aria-hidden />
                <Link to={`/missions/${x.missionId}`} className="oa-impact-link" title={x.title}><span className="mono">{x.missionId}</span> {x.title}</Link>
                <span className="dim" style={{ whiteSpace: 'nowrap' }}>· {name(x.agentId)}</span>
                {x.demo && <DemoTag title="A DEMO mission" />}
              </li>
            ))}
          </ul>
        )}
        <div className="row dim" style={{ gap: 5, fontSize: 11.5, marginTop: 6 }}><ShieldCheck size={12} aria-hidden style={{ flex: 'none' }} /><span>Listed only: running missions keep their teams and managers.</span></div>
      </Section>
    </>
  );
}

function Rollback({ seq, onDone }: { seq: number; onDone: (proposalId: string) => void }) {
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const key = useRef(newKey());
  useEffect(() => { key.current = newKey(); setErr(null); setWhy(''); }, [seq]);
  const go = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    const r = await proposeRollback(seq, why, key.current);
    setBusy(false);
    if (!r.ok) { key.current = newKey(); setErr(r.message); toast({ tone: 'warning', title: `Rollback to revision ${seq}: not proposed`, body: r.message }); return; }
    toast({ tone: 'success', title: `Rollback to revision ${seq} proposed`, body: 'Another administrator decides it in Proposals.' });
    onDone(r.value.id);
  };
  return (
    <div className="oa-hsec oa-rollback" data-rollback={seq}>
      <div className="row" style={{ gap: 8 }}>
        <input className="input" style={{ flex: 1, minWidth: 0, height: 32 }} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={2000}
          placeholder="Why (optional)" aria-label={`Why roll back to revision ${seq}`} />
        <button className="btn sm primary" disabled={busy} onClick={go}><Undo2 size={13} />Propose rollback to this revision</button>
        <HelpTrigger k="org.history.rollback" />
      </div>
      {err && <div className="oa-banner" role="alert" style={{ marginTop: 8 }}><AlertOctagon size={15} /><span>{err}</span></div>}
    </div>
  );
}

export function OrgHistory({ switcher, onRolledBack }: { switcher: ReactNode; onRolledBack: (proposalId: string) => void }) {
  useAgentsCatalog(); // names follow the live catalog
  const me = useMe();
  const admin = isAdmin(me);
  const { data, error, retry } = useOrgRevisions();
  const revs = [...(data?.revisions ?? [])].reverse(); // newest first
  const latest = revs[0]?.seq ?? null;
  const [picked, setPicked] = useState<number | null>(null);
  const seq = picked !== null && revs.some((r) => r.seq === picked) ? picked : latest;
  const cur = revs.find((r) => r.seq === seq) ?? null;
  const diff = useRevisionDiff(seq);
  return (
    <Panel icon={History} titleSize="lg" title="Organization History" help="org.history" sub="Every org revision, newest first. Select one to see what it changed and which active missions it touches." delay={.05} data-org-history=""
      actions={<div className="row wrap" style={{ gap: 8 }}>
        {switcher}
        {latest !== null && <Chip hue={145} size="sm" title="The active organisation revision">active rev <b data-history-latest={latest}>{latest}</b></Chip>}
        {!admin && <Chip hue={225} icon={Lock} size="sm" title="Only administrators propose a rollback">Read only</Chip>}
      </div>}>
      {error && <div className="oa-banner" role="alert" style={{ marginBottom: 10 }}><AlertOctagon size={15} /><span>History not loaded: {error}</span><button className="btn sm" onClick={retry}>Retry</button></div>}
      {!data && !error ? <LiveStatus className="dim" style={{ padding: 20 }}>Loading history…</LiveStatus>
        : revs.length === 0 ? <EmptyState icon={History} title="No revisions yet" body="The organisation chart has no stored revision." />
        : (
          <div className="oa-hist">
            <div className="oa-htimeline" role="list" aria-label="Org revisions">
              <AnimatePresence initial={false}>
                {revs.map((r, i) => <div role="listitem" key={r.seq}><RevisionCard r={r} latest={r.seq === latest} selected={r.seq === seq} onSelect={() => setPicked(r.seq)} index={i} /></div>)}
              </AnimatePresence>
            </div>
            <AnimatePresence mode="wait">
              {cur && (
                <motion.div key={cur.seq} className="subpanel glass-card oa-hdiff" data-diff={cur.seq} data-diff-state={diff.data ? 'ready' : 'loading'}
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: .25 }}>
                  <div className="row" style={{ gap: 10, marginBottom: 10 }}>
                    <span className="oa-hex" style={{ ['--h' as string]: SOURCE[cur.source.kind].hue }}><GitCommitVertical size={18} /></span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <b style={{ fontSize: 14 }}>Revision {cur.seq}{diff.data ? <span className="dim" style={{ fontWeight: 500 }}> compared with {diff.data.against === 0 ? 'no revision (all lines new)' : `revision ${diff.data.against}`}</span> : null}</b>
                      <div className="dim" style={{ fontSize: 11.5 }}>{sourceText(cur)} · by {cur.createdByName === 'system' ? 'the system' : cur.createdByName} · {new Date(cur.activeFrom).toLocaleString()}</div>
                    </div>
                    {cur.appliedFromProposal && <Chip hue={260} icon={GitPullRequest} size="sm" title={cur.appliedFromProposal}>from a proposal</Chip>}
                  </div>
                  {diff.error ? <div className="oa-banner" role="alert"><AlertOctagon size={15} /><span>Diff not loaded: {diff.error}</span></div>
                    : !diff.data ? <div className="dim" style={{ padding: 12 }}>Comparing…</div> : <DiffView d={diff.data} />}
                  {admin && cur.seq !== latest && <Rollback seq={cur.seq} onDone={onRolledBack} />}
                  {admin && cur.seq === latest && <div className="dim" style={{ fontSize: 11.5, marginTop: 8 }}>This is the active revision: pick an earlier one to propose a rollback.</div>}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
    </Panel>
  );
}
