import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import {
  Dna, FlaskConical, GitBranch, GraduationCap, Trophy, History as HistoryIcon, Lightbulb, BarChart3, ShieldCheck, Plus, Search, CheckCircle2, XCircle, Crown,
  Layers, Rocket, RotateCcw, Users2, Eye, Lock, Gauge, AlertTriangle, Sparkles, ArrowRight, Undo2, BookOpen, Flag, Activity,
} from 'lucide-react';
import { TopBoard, FrameBody, BottomBoard } from '@/components/layout/PageFrame';
import { Panel } from '@/components/ui/Panel';
import { Chip, Dot } from '@/components/ui/Chips';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { Tip } from '@/components/ui/Tip';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { AreaChart, Donut, RingGauge, Sparkline } from '@/components/viz/Charts';
import { useTab } from '@/hooks/useTab';
import { toast, openDialog } from '@/store/ui';
import type { RoleKey } from '@/data/types';
import {
  LADDER, PROPOSALS, EXPERIMENTS, FAILURE_CLASSES, BENCH_LABELS, benchSeries, BENCH_SUITES, MENTORING, STAGES, PROMOTIONS, DAG_NODES, DAG_EDGES, HISTORY_LOG, usePromos,
  type Tier, type Proposal, type Experiment, type Promotion, type DagNode,
} from '@/data/evolution';

const TAB_ICONS = [Lightbulb, FlaskConical, BarChart3, GraduationCap, Trophy, HistoryIcon];
const RISK_HUE = { low: 150, medium: 40, high: 350 } as const;
const STATUS_HUE: Record<Proposal['status'], number> = { draft: 230, queued: 200, testing: 275, review: 40, promoted: 150, rejected: 350 };
const tierHue = (t: Tier) => LADDER.find((l) => l.tier === t)!.hue;

export default function EvolutionPage() {
  const [tab, setTab, tabs] = useTab('evolution');
  const [tier, setTier] = useState<Tier | 'all'>('all');
  const decisions = usePromos((s) => s.decisions);
  const pending = PROMOTIONS.filter((p) => !decisions[p.id]).length;

  return (
    <div className="page">
      <TopBoard icon={Dna} title="Evolution Lab" help="evo.lab" sub="Agents propose improvements. Independent evaluators test them. Owners promote them. Nothing approves its own candidate."
        actions={<button className="btn primary" onClick={() => openDialog('evolution-experiment')}><Plus size={16} />New experiment</button>}
        kpis={[
        { key: 'prop', icon: Lightbulb, value: PROPOSALS.filter((p) => !['promoted', 'rejected'].includes(p.status)).length, label: 'Open Proposals', color: '#a78bfa', delta: '+2 this week', help: 'evo.kpi.proposals', onClick: () => setTab('Proposals') },
        { key: 'exp', icon: FlaskConical, value: EXPERIMENTS.filter((e) => e.status === 'running').length, label: 'Running Experiments', color: '#22d3ee', help: 'evo.kpi.experiments', onClick: () => setTab('Experiments') },
        { key: 'gain', icon: Gauge, value: 3.7, decimals: 1, prefix: '+', suffix: ' pp', label: 'Verified Pass-rate Gain', color: '#2ee98a', delta: 'vs v2.3.0', help: 'evo.kpi.gain', onClick: () => setTab('Benchmarks') },
        { key: 'sec', icon: ShieldCheck, value: 0, label: 'Security Regressions', color: '#facc15', hint: 'in promoted candidates', help: 'evo.kpi.security', onClick: () => setTab('Benchmarks') },
        { key: 'pend', icon: Trophy, value: pending, label: 'Awaiting Promotion', color: '#fbbf24', hint: '2 need Owner', help: 'evo.kpi.promotions', onClick: () => setTab('Promotions') },
      ]}
        tabs={{ tabs, value: tab, onChange: setTab, icons: TAB_ICONS, ariaLabel: 'Evolution views' }}
        toolbar={<span>{{ Proposals: 'Candidate improvements and their risk tier.', Experiments: 'Isolated baseline vs candidate runs.', Benchmarks: 'Pass rate, cost, latency and failure modes.', Mentoring: 'Coaching plans and verified skill growth.', Promotions: 'Staged pipeline with independent review.', History: 'Lineage of every agent version.' }[tab]}</span>} />
      <FrameBody tab={tab}>
        {tab === 'Proposals' && <Proposals tier={tier} setTier={setTier} />}
        {tab === 'Experiments' && <Experiments />}
        {tab === 'Benchmarks' && <Benchmarks />}
        {tab === 'Mentoring' && <Mentoring />}
        {tab === 'Promotions' && <Promotions />}
        {tab === 'History' && <History />}
      </FrameBody>
      <BottomBoard id="evolution" title="Evolution boards" cols="minmax(0, 1fr)">
        <Ladder tier={tier} setTier={(t) => { setTier(t); setTab('Proposals'); }} />
      </BottomBoard>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* L0-L4 ladder                                                         */
/* ------------------------------------------------------------------ */
function Ladder({ tier, setTier }: { tier: Tier | 'all'; setTier: (t: Tier | 'all') => void }) {
  return (
    <Panel icon={Layers} title="Evolution Ladder" help="evo.ladder" delay={.08} className="emu-ladder-panel"
      sub={<span className="muted">Each rung adds stricter independent tests. L3 and L4 require Owner approval.</span>}
      actions={tier !== 'all' ? <button className="btn sm ghost" onClick={() => setTier('all')}>Clear filter ({tier})</button> : undefined}>
      <div className="emu-ladder">
        <div className="emu-ladder-line" aria-hidden><motion.i initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 1.4, ease: [.2, .8, .2, 1] }} /></div>
        {LADDER.map((l, i) => (
          <motion.button key={l.tier} className={'emu-rung' + (tier === l.tier ? ' on' : '')} style={{ ['--h' as string]: l.hue }} onClick={() => setTier(tier === l.tier ? 'all' : l.tier)}
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .15 + i * .08, type: 'spring', stiffness: 260, damping: 20 }} aria-pressed={tier === l.tier}
            aria-label={`${l.tier} ${l.name}: ${l.scope}. ${l.active} active.`}>
            <span className="emu-rung-ring"><b>{l.tier}</b></span>
            <span className="emu-rung-body">
              <b>{l.name}</b>
              <span className="dim">{l.scope}</span>
              <span className="row" style={{ gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                {l.owner ? <Chip hue={40} size="sm" icon={Crown}>Owner gate</Chip> : <Chip hue={150} size="sm" icon={ShieldCheck}>Policy gate</Chip>}
                <Chip hue={l.hue} size="sm">{l.active} active</Chip>
              </span>
            </span>
          </motion.button>
        ))}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
function Proposals({ tier, setTier }: { tier: Tier | 'all'; setTier: (t: Tier | 'all') => void }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Proposal['status'] | 'all'>('all');
  const list = useMemo(() => PROPOSALS.filter((p) => (tier === 'all' || p.tier === tier) && (status === 'all' || p.status === status) && (p.title + p.target + p.hypothesis).toLowerCase().includes(q.toLowerCase())), [tier, q, status]);
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="input-wrap" style={{ width: 260 }}><Search size={15} /><input className="input" placeholder="Search proposals..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search proposals" /></div>
        <select className="select" style={{ width: 150 }} value={status} onChange={(e) => setStatus(e.target.value as Proposal['status'] | 'all')} aria-label="Filter by status">
          <option value="all">All statuses</option>{(['draft', 'queued', 'testing', 'review', 'promoted', 'rejected'] as const).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="select" style={{ width: 130 }} value={tier} onChange={(e) => setTier(e.target.value as Tier | 'all')} aria-label="Filter by tier">
          <option value="all">All tiers</option>{LADDER.map((l) => <option key={l.tier} value={l.tier}>{l.tier} {l.name}</option>)}
        </select>
        <span className="spacer" />
        <span className="dim" style={{ fontSize: 12.5 }}>{list.length} of {PROPOSALS.length} proposals</span>
        <button className="btn" onClick={() => openDialog('evolution-experiment')}><FlaskConical size={15} />Submit candidate</button>
      </div>
      {list.length === 0 ? <EmptyState icon={Lightbulb} title="No proposals match" body="Clear a filter to see more candidates." action={<button className="btn" onClick={() => { setQ(''); setStatus('all'); setTier('all'); }}>Clear filters</button>} /> : (
        <div className="grid g-3">
          <AnimatePresence mode="popLayout">
            {list.map((p, i) => (
              <motion.div key={p.id} layout className="subpanel glass-card hoverable emu-prop" style={{ ['--h' as string]: tierHue(p.tier) }}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: .96 }} transition={{ delay: i * .04 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span className="emu-tier">{p.tier}</span>
                  <span className="mono dim" style={{ fontSize: 11.5 }}>{p.id}</span>
                  <span className="spacer" />
                  <Chip hue={STATUS_HUE[p.status]} size="sm">{p.status}</Chip>
                </div>
                <b style={{ fontSize: 14.5, lineHeight: 1.3, marginTop: 8, display: 'block' }}>{p.title}</b>
                <div className="row" style={{ gap: 8, margin: '8px 0' }}>
                  <RobotAvatar role={p.role as RoleKey} size={30} /><div style={{ minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 600 }}>{p.target}</div><div className="dim" style={{ fontSize: 11.5 }}>author {p.author}</div></div>
                </div>
                <p className="muted clamp-2" style={{ fontSize: 12.5, margin: 0, minHeight: 36 }}>{p.hypothesis}</p>
                <div className="row" style={{ gap: 6, margin: '10px 0', flexWrap: 'wrap' }}>
                  <Chip hue={RISK_HUE[p.risk]} size="sm">{p.risk} risk</Chip>
                  <Chip hue={200} size="sm">{p.baseline} <ArrowRight size={9} /> {p.candidate}</Chip>
                  <Chip hue={150} size="sm">{p.expected}</Chip>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm" onClick={() => openDialog('evolution-experiment', { proposalId: p.id })} disabled={p.status === 'promoted' || p.status === 'rejected'}><FlaskConical size={14} />Choose experiment</button>
                  <button className="btn sm ghost" onClick={() => toast({ tone: 'info', title: `${p.id} opened (demo)`, body: 'The full diff, hypothesis and provenance would open in a side drawer.' })}>Details</button>
                  <span className="spacer" /><span className="dim" style={{ fontSize: 11 }}>{p.ageH} h ago</span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Experiments() {
  const [sel, setSel] = useState(EXPERIMENTS[0].id);
  const e = EXPERIMENTS.find((x) => x.id === sel)!;
  return (
    <div className="emu-split">
      <div className="col" style={{ gap: 8 }}>
        {EXPERIMENTS.map((x, i) => (
          <motion.button key={x.id} className={'subpanel glass-card hoverable emu-exp-row' + (sel === x.id ? ' selected' : '')} onClick={() => setSel(x.id)}
            initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * .05 }} aria-pressed={sel === x.id}>
            <div className="row" style={{ gap: 8 }}>
              <span className="mono dim" style={{ fontSize: 11.5 }}>{x.id}</span><span className="spacer" />
              <Chip size="sm" hue={x.status === 'running' ? 200 : x.status === 'complete' ? 150 : 350}>{x.status === 'running' && <Dot tone="info" pulse />}{x.status}</Chip>
            </div>
            <b style={{ fontSize: 13.5, display: 'block', margin: '4px 0 6px', textAlign: 'left' }}>{x.name}</b>
            <div className={'bar thin ' + (x.verdict === 'loss' ? 'bad' : x.verdict === 'neutral' ? 'warn' : 'good')}><motion.i initial={{ width: 0 }} animate={{ width: `${x.progress}%` }} transition={{ duration: 1 }} /></div>
            <div className="row dim" style={{ fontSize: 11.5, marginTop: 5 }}>{x.baseline.n + x.candidate.n} samples <span className="spacer" />{x.progress}%</div>
          </motion.button>
        ))}
        <button className="btn" onClick={() => openDialog('evolution-experiment')}><Plus size={15} />Start isolated experiment</button>
      </div>
      <AnimatePresence mode="wait"><ExperimentDetail key={e.id} e={e} /></AnimatePresence>
    </div>
  );
}

function ExperimentDetail({ e }: { e: Experiment }) {
  const rows: { k: string; b: number; c: number; unit: string; better: 'up' | 'down'; max: number }[] = [
    { k: 'Pass rate', b: e.baseline.pass, c: e.candidate.pass, unit: '%', better: 'up', max: 100 },
    { k: 'Quality score', b: e.baseline.quality, c: e.candidate.quality, unit: '', better: 'up', max: 100 },
    { k: 'Cost / task', b: e.baseline.cost, c: e.candidate.cost, unit: '$', better: 'down', max: Math.max(e.baseline.cost, e.candidate.cost) * 1.25 },
    { k: 'Latency (s)', b: e.baseline.latency, c: e.candidate.latency, unit: 's', better: 'down', max: Math.max(e.baseline.latency, e.candidate.latency) * 1.25 },
  ];
  const vc = e.verdict === 'win' ? 150 : e.verdict === 'loss' ? 350 : 40;
  return (
    <motion.div className="col" style={{ gap: 12 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .22 }}>
      <div className="subpanel" style={{ padding: 14 }}>
        <div className="row wrap" style={{ gap: 10 }}>
          <FlaskConical size={20} className="accent-2" style={{ color: 'var(--accent-2)' }} /><b style={{ fontSize: 16 }}>{e.name}</b>
          <Chip hue={vc} icon={e.verdict === 'loss' ? XCircle : CheckCircle2}>{e.verdict === 'win' ? 'candidate ahead' : e.verdict === 'loss' ? 'candidate worse' : 'inconclusive'}</Chip>
          <span className="spacer" />
          <Tip label="Author and evaluator are different agents. The pass threshold was locked before results."><span className="emu-sep"><Lock size={13} />Evaluator {e.evaluator} <span className="dim">≠ author {e.author}</span></span></Tip>
        </div>
        <div className="emu-cmp">
          <div className="emu-arm"><div className="emu-arm-h"><Chip hue={215}>Baseline</Chip><span className="mono dim">n = {e.baseline.n}</span></div>
            <b className="display emu-big">{e.baseline.pass}%</b><span className="dim">pass rate</span></div>
          <div className="emu-vs"><motion.span animate={{ scale: [1, 1.12, 1] }} transition={{ repeat: Infinity, duration: 2.4 }}>VS</motion.span></div>
          <div className="emu-arm cand"><div className="emu-arm-h"><Chip hue={285}>Candidate</Chip><span className="mono dim">n = {e.candidate.n}</span></div>
            <b className="display emu-big">{e.candidate.pass}%</b><span className={e.candidate.pass >= e.baseline.pass ? 'good' : 'bad'} style={{ fontWeight: 700 }}>{e.candidate.pass >= e.baseline.pass ? '+' : ''}{(e.candidate.pass - e.baseline.pass).toFixed(1)} pp</span></div>
          <div className="emu-conf">
            <RingGauge value={e.confidence} size={104} stroke={10} sub="confidence" colors={e.confidence >= 90 ? ['#22d3ee', '#2ee98a'] : ['#fbbf24', '#f97316']} />
            <span className="dim" style={{ fontSize: 11.5 }}>p = {e.pValue.toFixed(2)} · needs 90%</span>
          </div>
        </div>
        <div className="col" style={{ gap: 10, marginTop: 14 }}>
          {rows.map((r, i) => {
            const good = r.better === 'up' ? r.c >= r.b : r.c <= r.b;
            return (
              <div key={r.k} className="emu-metric">
                <span className="muted" style={{ fontSize: 12.5 }}>{r.k}</span>
                <div className="col" style={{ gap: 4 }}>
                  <div className="bar thin"><motion.i style={{ background: 'linear-gradient(90deg,#3b82f6,#22d3ee)' }} initial={{ width: 0 }} animate={{ width: `${(r.b / r.max) * 100}%` }} transition={{ duration: .9, delay: i * .07 }} /></div>
                  <div className="bar thin"><motion.i style={{ background: 'linear-gradient(90deg,#7c3aed,#c084fc)' }} initial={{ width: 0 }} animate={{ width: `${(r.c / r.max) * 100}%` }} transition={{ duration: .9, delay: .1 + i * .07 }} /></div>
                </div>
                <span className="tnum" style={{ fontSize: 12.5, textAlign: 'right' }}>{r.unit === '$' ? '$' : ''}{r.b} <ArrowRight size={10} style={{ display: 'inline' }} /> <b className={good ? 'good' : 'bad'}>{r.unit === '$' ? '$' : ''}{r.c}{r.unit === '%' ? '%' : r.unit === 's' ? 's' : ''}</b></span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="grid g-2">
        <div className="subpanel">
          <div className="section-label row" style={{ gap: 6 }}>Test suites (n per suite) <HelpTrigger k="evo.suites" /></div>
          <div className="col" style={{ gap: 8, marginTop: 8 }}>
            {e.suites.map((s) => (
              <div key={s.key} className="emu-suite"><span style={{ fontSize: 12.5 }}>{s.key}</span><span className="mono dim" style={{ fontSize: 11 }}>n={s.n}</span>
                <div className="emu-duo"><motion.i className="b" initial={{ width: 0 }} animate={{ width: `${s.base}%` }} /><motion.i className="c" initial={{ width: 0 }} animate={{ width: `${s.cand}%` }} /></div>
                <span className="tnum" style={{ fontSize: 12 }}>{s.base} / <b className={s.cand >= s.base ? 'good' : 'bad'}>{s.cand}</b></span></div>
            ))}
          </div>
        </div>
        <div className="subpanel">
          <div className="section-label">Isolation and caps</div>
          <dl className="kv" style={{ marginTop: 6 }}>
            <dt>Resource caps</dt><dd>{e.caps}</dd>
            <dt>Tested revisions</dt><dd className="mono">exact hashes pinned</dd>
            <dt>Security regressions</dt><dd className={e.candidate.secReg ? 'bad' : 'good'}>{e.candidate.secReg}</dd>
            <dt>Linked proposal</dt><dd className="mono">{e.proposal}</dd>
          </dl>
          <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
            <button className="btn sm" onClick={() => toast({ tone: 'info', title: 'Trace viewer (demo)', body: `Full traces for ${e.id} would open here.` })}><Eye size={14} />Inspect traces</button>
            <button className="btn sm primary" disabled={e.verdict !== 'win' || e.status !== 'complete'} title={e.status !== 'complete' ? 'Experiment still running' : undefined}
              onClick={() => toast({ tone: 'success', title: 'Sent to promotion pipeline (demo)', body: `${e.proposal} now waits for security review.` })}><Rocket size={14} />Send to promotion</button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
function Benchmarks() {
  const { base, cand } = useMemo(benchSeries, []);
  const [mode, setMode] = useState<'cand' | 'base'>('cand');
  const totB = FAILURE_CLASSES.reduce((s, f) => s + f.base, 0), totC = FAILURE_CLASSES.reduce((s, f) => s + f.cand, 0);
  const segs = FAILURE_CLASSES.map((f) => ({ label: f.key, value: mode === 'cand' ? f.cand : f.base, color: f.color }));
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="grid emu-bench-top">
        <div className="subpanel">
          <div className="row" style={{ gap: 8, marginBottom: 6 }}><b>Pass rate by run</b><HelpTrigger k="evo.passTrend" /><span className="spacer" />
            <span className="row" style={{ gap: 5, fontSize: 12 }}><span className="dot sm" style={{ color: 'var(--info)' }} />Baseline v2.4.0</span>
            <span className="row" style={{ gap: 5, fontSize: 12 }}><span className="dot sm" style={{ color: 'var(--violet)' }} />Candidate</span></div>
          <AreaChart series={[{ label: 'Baseline', data: base, color: 'var(--info)' }, { label: 'Candidate', data: cand, color: 'var(--violet)' }]} labels={BENCH_LABELS} h={190} min={89} max={99} unit="%" />
        </div>
        <div className="subpanel">
          <div className="row" style={{ gap: 8, marginBottom: 10 }}><b>Failure classification</b><HelpTrigger k="evo.failures" /><span className="spacer" />
            <div className="segmented sm" role="radiogroup" aria-label="Arm">{(['base', 'cand'] as const).map((k) => <button key={k} role="radio" aria-checked={mode === k} className="seg-btn" onClick={() => setMode(k)} style={mode === k ? { background: 'rgba(var(--accent-rgb), .25)' } : undefined}>{k === 'base' ? 'Baseline' : 'Candidate'}</button>)}</div></div>
          <div className="row" style={{ gap: 16 }}>
            <Donut segs={segs} size={130} center={String(mode === 'cand' ? totC : totB)} sub="failures" />
            <div className="col" style={{ gap: 7, flex: 1, minWidth: 0 }}>
              {FAILURE_CLASSES.map((f, i) => (
                <div key={f.key} className="emu-fail"><span className="row" style={{ gap: 6, fontSize: 12.5 }}><span className="dot sm" style={{ color: f.color }} />{f.key}</span>
                  <div className="emu-duo"><motion.i className="b" initial={{ width: 0 }} animate={{ width: `${(f.base / 35) * 100}%` }} transition={{ delay: i * .05 }} /><motion.i className="c" initial={{ width: 0 }} animate={{ width: `${(f.cand / 35) * 100}%` }} transition={{ delay: .08 + i * .05 }} /></div>
                  <span className="tnum" style={{ fontSize: 12 }}>{f.base} <ArrowRight size={9} style={{ display: 'inline' }} /> <b className={f.cand <= f.base ? 'good' : 'bad'}>{f.cand}</b></span></div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="grid g-4">
        {BENCH_SUITES.map((s, i) => (
          <motion.div key={s.key} className="subpanel glass-card hoverable" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .06 }}>
            <div className="row" style={{ gap: 8 }}><b>{s.key}</b><span className="spacer" /><span className="mono dim" style={{ fontSize: 11 }}>n={s.n}</span></div>
            <div className="row" style={{ gap: 12, margin: '8px 0' }}><RingGauge value={s.pass} size={74} stroke={8} decimals={s.pass % 1 ? 1 : 0} colors={s.kind === 'good' ? ['#22d3ee', '#2ee98a'] : ['#fbbf24', '#f97316']} />
              <span className="dim" style={{ fontSize: 12 }}>{s.desc}</span></div>
            <button className="btn sm ghost" onClick={() => toast({ tone: 'info', title: `${s.key} traces (demo)`, body: 'Opens the trace table filtered to this suite.' })}><Eye size={13} />Inspect traces</button>
          </motion.div>
        ))}
      </div>
      <div className="row wrap emu-note"><ShieldCheck size={16} className="good" /><span><b>Security regressions: 0.</b> Evaluation is independent: authors cannot read or tune the fresh challenge set, and thresholds are frozen before a run starts.</span><span className="spacer" />
        <button className="btn sm" onClick={() => toast({ tone: 'info', title: 'Independent re-evaluation queued (demo)', body: 'Tester-01 will re-run the fresh set with new seeds.' })}><Activity size={14} />Request independent evaluation</button></div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Mentoring() {
  const [done, setDone] = useState<Record<string, boolean>>({});
  return (
    <div className="grid g-3">
      {MENTORING.map((m, i) => (
        <motion.div key={m.agent} className="subpanel glass-card hoverable" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .05 }} style={{ padding: 14 }}>
          <div className="row" style={{ gap: 10 }}>
            <RobotAvatar role={m.role as RoleKey} size={46} faceMode="face" />
            <div style={{ minWidth: 0 }}><b>{m.agent}</b><div className="dim" style={{ fontSize: 12 }}>Mentor: {m.mentor}</div></div>
            <span className="spacer" /><RingGauge value={m.progress} size={54} stroke={6} />
          </div>
          <div style={{ margin: '10px 0 4px', fontSize: 13 }}><GraduationCap size={14} style={{ display: 'inline', verticalAlign: -2 }} className="violet" /> <b>{m.curriculum}</b></div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div><div className="dim" style={{ fontSize: 11.5 }}>Gained capability</div><div className="good" style={{ fontWeight: 700, fontSize: 13 }}>{m.gained}</div></div>
            <Sparkline data={m.trend} w={100} h={34} color="var(--good)" />
          </div>
          <div className="row" style={{ gap: 6, marginTop: 10 }}>
            <button className="btn sm" onClick={() => toast({ tone: 'info', title: 'Mentor assignment (demo)', body: `${m.agent} would be paired with a new mentor after Owner review.` })}><Users2 size={13} />Assign mentor</button>
            <button className="btn sm ghost" disabled={done[m.agent]} onClick={() => { setDone((d) => ({ ...d, [m.agent]: true })); toast({ tone: 'success', title: 'Re-evaluation scheduled (demo)', body: `${m.agent}: ${m.reeval}, fresh practice set.` }); }}>
              {done[m.agent] ? <><CheckCircle2 size={13} />Scheduled</> : <>Re-eval {m.reeval}</>}</button>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Promotions() {
  const decisions = usePromos((s) => s.decisions);
  const reset = usePromos((s) => s.reset);
  const done = Object.keys(decisions).length;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row wrap emu-note" style={{ gap: 10 }}>
        <Lock size={16} className="info" />
        <span><b>Reviewer independence is enforced.</b> A candidate author can never approve, evaluate or tune the gate for their own change. Source and org changes need the Owner.</span>
        <span className="spacer" />{done > 0 && <button className="btn sm ghost" onClick={reset}><RotateCcw size={13} />Reset demo ({done})</button>}
      </div>
      <div className="grid g-2">
        {PROMOTIONS.map((p, i) => <PromoCard key={p.id} p={p} i={i} />)}
      </div>
    </div>
  );
}

function PromoCard({ p, i }: { p: Promotion; i: number }) {
  const dec = usePromos((s) => s.decisions[p.id]);
  const approved = dec?.verdict === 'approved', rejected = dec?.verdict === 'rejected';
  const stage = approved ? STAGES.length - 1 : rejected ? 4 : p.stage;
  const blocked = p.reviewers.some((r) => r.kind !== 'owner' && r.independent && !r.done);
  const hue = approved ? 150 : rejected ? 350 : tierHue(p.tier);
  return (
    <motion.div layout className={'subpanel glass-card emu-promo' + (approved ? ' ok' : rejected ? ' no' : '')} style={{ ['--h' as string]: hue }}
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .07 }}>
      <div className="row" style={{ gap: 8 }}>
        <span className="emu-tier" style={{ ['--h' as string]: tierHue(p.tier) }}>{p.tier}</span>
        <b style={{ fontSize: 15 }}>{p.title}</b><span className="spacer" />
        <Chip hue={RISK_HUE[p.risk]} size="sm">{p.risk} risk</Chip>
        {p.needsOwner && <Chip hue={40} size="sm" icon={Crown}>Owner</Chip>}
      </div>
      <div className="row" style={{ gap: 8, margin: '6px 0 12px', fontSize: 12.5 }}>
        <span className="mono dim">{p.id} · {p.proposal}</span><span className="mono"><b>{p.from}</b> <ArrowRight size={11} style={{ display: 'inline' }} /> <b style={{ color: 'var(--accent-2)' }}>{p.to}</b></span>
      </div>
      <div className="emu-stages">
        {STAGES.map((s, k) => {
          const st = k < stage || (approved && k === stage) ? 'done' : k === stage && !rejected ? 'now' : rejected && k === 4 ? 'rej' : 'next';
          return (
            <div key={s} className={'emu-stage ' + st}>
              <motion.span className="emu-stage-dot" initial={false} animate={{ scale: st === 'now' ? [1, 1.18, 1] : 1 }} transition={st === 'now' ? { repeat: Infinity, duration: 1.8 } : undefined}>
                {st === 'done' ? <CheckCircle2 size={13} /> : st === 'rej' ? <XCircle size={13} /> : k + 1}
              </motion.span>
              <span className="emu-stage-l">{s}</span>
            </div>
          );
        })}
        <div className="emu-stage-track"><motion.i initial={false} animate={{ width: `${(Math.min(stage, 5) / 5) * 100}%` }} transition={{ type: 'spring', stiffness: 120, damping: 22 }} /></div>
      </div>
      <div className="grid g-3" style={{ gap: 8, margin: '12px 0' }}>
        <div className="emu-mini"><span className="dim">Metric delta</span><b className="good">{p.delta}</b></div>
        <div className="emu-mini"><span className="dim">Confidence</span><b>{p.confidence}%</b></div>
        <div className="emu-mini"><span className="dim">Security regr.</span><b className={p.secRegressions ? 'bad' : 'good'}>{p.secRegressions}</b></div>
      </div>
      <div className="section-label row" style={{ gap: 6 }}>Reviewers <HelpTrigger k="evo.independence" /></div>
      <div className="col" style={{ gap: 5, margin: '6px 0 10px' }}>
        {p.reviewers.map((r) => (
          <div key={r.name} className="emu-rev">
            <span className={'emu-rev-ico ' + r.kind}>{r.kind === 'owner' ? <Crown size={12} /> : r.kind === 'security' ? <ShieldCheck size={12} /> : r.kind === 'author' ? <Sparkles size={12} /> : <Eye size={12} />}</span>
            <b style={{ fontSize: 12.5 }}>{r.name}</b><span className="dim" style={{ fontSize: 11.5 }}>{r.kind}</span><span className="spacer" />
            {r.kind === 'author' ? <Chip hue={30} size="sm" icon={Lock}>cannot approve</Chip> : <Chip hue={150} size="sm" icon={ShieldCheck}>independent</Chip>}
            {r.kind === 'owner' ? (approved || rejected ? <Chip hue={approved ? 150 : 350} size="sm">{approved ? 'approved' : 'rejected'}</Chip> : <Chip hue={40} size="sm">pending</Chip>) : r.done ? <CheckCircle2 size={14} className="good" /> : <Dot tone="warn" pulse />}
          </div>
        ))}
      </div>
      <div className="row" style={{ gap: 6, fontSize: 12 }}>
        <span className="dim">Staged rollout</span>{p.rollout.map((r, k) => <span key={k} className={'emu-roll' + (approved ? ' on' : '')} style={{ transitionDelay: `${k * .25}s` }}>{r}%</span>)}
        <span className="spacer" /><span className="dim ellipsis" style={{ maxWidth: 220 }} title={p.rollback}><Undo2 size={11} style={{ display: 'inline' }} /> {p.rollback}</span>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {dec ? (
          <motion.div key="res" className={'emu-resolved ' + dec.verdict} initial={{ opacity: 0, scale: .94, height: 0 }} animate={{ opacity: 1, scale: 1, height: 'auto' }} transition={{ type: 'spring', stiffness: 220, damping: 22 }}>
            {approved ? <CheckCircle2 size={22} /> : <XCircle size={22} />}
            <div><b>{approved ? 'Approved by Owner' : 'Rejected by Owner'}</b><div className="dim" style={{ fontSize: 12 }}>{approved ? `Staged rollout ${p.rollout.join(' / ')}% started. Monitoring with rollback armed.` : `Candidate stays unpromoted; ${p.from} remains stable.`}{dec.comment ? ` "${dec.comment}"` : ''}</div></div>
          </motion.div>
        ) : (
          <motion.div key="act" className="row" style={{ gap: 8, marginTop: 12 }} exit={{ opacity: 0 }}>
            <button className="btn good" disabled={blocked} title={blocked ? 'Waiting for independent reviewers to finish' : undefined} onClick={() => openDialog('evolution-promotion', { id: p.id, mode: 'approve' })}><Crown size={14} />Approve (Owner)</button>
            <button className="btn danger" onClick={() => openDialog('evolution-promotion', { id: p.id, mode: 'reject' })}><XCircle size={14} />Reject</button>
            {blocked && <span className="warn" style={{ fontSize: 12 }}><AlertTriangle size={13} style={{ display: 'inline', verticalAlign: -2 }} /> reviews pending</span>}
            <span className="spacer" />
            <IconButton icon={Eye} label="Open evidence" size="sm" onClick={() => toast({ tone: 'info', title: 'Evidence bundle (demo)', body: `${p.id}: experiment, traces and reviewer notes.` })} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
const KIND_META: Record<DagNode['kind'], { label: string; hue: number; icon: typeof Flag }> = {
  stable: { label: 'Stable', hue: 150, icon: ShieldCheck },
  current: { label: 'Current', hue: 205, icon: Rocket },
  'last-good': { label: 'Last good', hue: 45, icon: Flag },
  candidate: { label: 'Candidate', hue: 285, icon: FlaskConical },
  failed: { label: 'Failed', hue: 352, icon: XCircle },
  archived: { label: 'Archived', hue: 230, icon: GitBranch },
};

function History() {
  const [sel, setSel] = useState<string>('v2.4.0');
  const [restored, setRestored] = useState<string | null>(null);
  const W = 900, H = 330, X0 = 70, DX = 150, Y0 = 55, DY = 100;
  const pos = (n: DagNode) => ({ x: X0 + n.col * DX, y: Y0 + n.row * DY });
  const byId = Object.fromEntries(DAG_NODES.map((n) => [n.id, n]));
  const cur = byId[sel];
  return (
    <div className="emu-split wide">
      <div className="subpanel" style={{ padding: 12 }}>
        <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
          <b>Lineage DAG</b><HelpTrigger k="evo.lineage" /><span className="spacer" />
          {(Object.keys(KIND_META) as DagNode['kind'][]).map((k) => <Chip key={k} hue={KIND_META[k].hue} size="sm" icon={KIND_META[k].icon}>{KIND_META[k].label}</Chip>)}
        </div>
        <div className="emu-dag-wrap">
          <svg viewBox={`0 0 ${W} ${H}`} className="emu-dag" role="img" aria-label="Agent version lineage graph">
            <defs><filter id="dagglow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
            {DAG_EDGES.map(([a, b], i) => {
              const A = pos(byId[a]), B = pos(byId[b]);
              const bad = byId[b].kind === 'failed', cand = byId[b].kind === 'candidate';
              const d = `M${A.x + 38},${A.y} C${A.x + 70},${A.y} ${B.x - 70},${B.y} ${B.x - 38},${B.y}`;
              const col = bad ? 'var(--bad)' : cand ? 'var(--violet)' : 'var(--accent-2)';
              return (
                <g key={i}>
                  <motion.path d={d} fill="none" stroke={col} strokeWidth="2.2" strokeDasharray={bad || cand ? '6 6' : undefined} opacity=".85" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: .9, delay: .15 + i * .08 }} />
                  {!bad && !cand && <circle r="3.2" fill={col} style={{ filter: `drop-shadow(0 0 4px ${col})` }}><animateMotion dur={`${3 + (i % 3) * .5}s`} repeatCount="indefinite" path={d} /></circle>}
                </g>
              );
            })}
            {DAG_NODES.map((n, i) => {
              const p = pos(n), m = KIND_META[n.kind], on = sel === n.id;
              return (
                <g key={n.id} transform={`translate(${p.x},${p.y})`}><motion.g style={{ cursor: 'pointer', ['--h' as string]: m.hue }} onClick={() => setSel(n.id)} tabIndex={0} role="button" aria-label={`${n.label}: ${m.label}`}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSel(n.id); }} initial={{ opacity: 0, scale: .5 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: .1 + i * .06, type: 'spring', stiffness: 260, damping: 18 }}>
                  {(n.kind === 'current' || n.kind === 'stable') && <circle r="34" fill="none" stroke={`hsl(${m.hue} 90% 60%)`} strokeOpacity=".35" className="emu-pulse" />}
                  <rect x="-38" y="-20" width="76" height="40" rx="12" className="emu-dag-node" style={{ stroke: `hsl(${m.hue} 90% 62%)`, strokeWidth: on ? 3 : 1.6, filter: on || n.kind === 'current' ? 'url(#dagglow)' : undefined }}
                    strokeDasharray={n.kind === 'candidate' ? '4 3' : undefined} />
                  <text textAnchor="middle" y="4" fontSize="11.5" fontWeight="700" className="emu-dag-t">{n.label}</text>
                  <text textAnchor="middle" y="-26" fontSize="9.5" fontWeight="700" style={{ fill: `hsl(${m.hue} 100% var(--chip-l))` }}>{n.kind === 'archived' ? '' : m.label.toUpperCase()}</text>
                  {n.kind === 'failed' && <text textAnchor="middle" y="35" fontSize="13" style={{ fill: 'var(--bad)' }}>✕</text>}
                  {n.kind === 'last-good' && <text textAnchor="middle" y="35" fontSize="12" style={{ fill: `hsl(${m.hue} 100% var(--chip-l))` }}>⚑</text>}
                </motion.g></g>
              );
            })}
          </svg>
        </div>
      </div>
      <div className="col" style={{ gap: 12 }}>
        <AnimatePresence mode="wait">
          <motion.div key={cur.id} className="subpanel emu-node-detail" style={{ ['--h' as string]: KIND_META[cur.kind].hue }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .2 }}>
            <div className="row" style={{ gap: 8 }}><Chip hue={KIND_META[cur.kind].hue} icon={KIND_META[cur.kind].icon}>{KIND_META[cur.kind].label}</Chip><b className="mono" style={{ fontSize: 15 }}>{cur.label}</b></div>
            <p className="muted" style={{ fontSize: 13, margin: '8px 0 10px' }}>{cur.note}</p>
            <div className="row wrap" style={{ gap: 6 }}>
              {cur.kind === 'failed'
                ? <button className="btn sm" onClick={() => toast({ tone: 'info', title: 'Why it failed (demo)', body: 'Evaluator notes: security probe set caught unrestricted retries leaking a scoped token to a log line. Lesson stored in Knowledge.' })}><BookOpen size={14} />Explain failed promotion</button>
                : <button className="btn sm" disabled={['candidate', 'current'].includes(cur.kind) || restored === cur.id} onClick={() => { setRestored(cur.id); toast({ tone: 'success', title: `Restore of ${cur.label} routed (demo)`, body: 'New instances would use this version. Running missions stay pinned. Recorded as a new audited decision.' }); }}><RotateCcw size={14} />{restored === cur.id ? 'Restore requested' : 'Restore this version'}</button>}
              <button className="btn sm ghost" onClick={() => toast({ tone: 'info', title: 'Audit trail (demo)', body: `Immutable events for ${cur.label}.` })}>Audit</button>
            </div>
          </motion.div>
        </AnimatePresence>
        <div className="subpanel" style={{ flex: 1 }}>
          <div className="section-label">Audit and learning retained</div>
          <div className="emu-log">
            {HISTORY_LOG.map((l, i) => (
              <motion.div key={i} className="emu-log-row" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .2 + i * .06 }}>
                <span className={'dot sm ' + (l.kind === 'violet' ? 'violet' : l.kind)} /><div style={{ minWidth: 0 }}><div style={{ fontSize: 12.5 }}>{l.e}</div><div className="dim" style={{ fontSize: 11 }}>{l.t} · {l.who}</div></div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
