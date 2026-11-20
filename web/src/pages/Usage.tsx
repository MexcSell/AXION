import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3, Database, Target, TrendingUp, Gauge, Bell, LineChart, Boxes, Target as MissionIcon, SlidersHorizontal, CheckCircle2, AlertTriangle, Info, XCircle, Download,
  ArrowRight, Eye, Settings2, Leaf, PiggyBank, RotateCcw, Check,
} from 'lucide-react';
import { TopBoard, FrameBody } from '@/components/layout/PageFrame';
import { Chip } from '@/components/ui/Chips';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { RingGauge, Donut, Legend, AreaChart, ColumnBars, MeterRow } from '@/components/viz/Charts';
import { useTab } from '@/hooks/useTab';
import { useData } from '@/store/data';
import { toast, openDialog } from '@/store/ui';
import { money, cx } from '@/lib/format';
import { SPEND, BUDGET, DAYS, dailySpend, cumulative, BY_MODEL, BY_DEPT, LIMITS, ALERTS, DEFAULT_SCENARIO, project, useLimits, VERIFIED_OUTCOMES, type Scenario } from '@/data/usage';

const TAB_ICONS = [BarChart3, MissionIcon, Boxes, Gauge, Bell, LineChart];

export default function UsagePage() {
  const [tab, setTab, tabs] = useTab('usage');
  const alertsOpen = ALERTS.filter((a) => a.sev === 'warn' || a.sev === 'bad').length;
  const cpo = SPEND / VERIFIED_OUTCOMES;
  const proj = useMemo(() => project(DEFAULT_SCENARIO), []);
  return (
    <div className="page">
      <TopBoard icon={BarChart3} title="Usage & Budgets" help="usage.page" sub="What the company spends, what it gets for it, and how long the budget lasts. Cost is judged per verified outcome."
        actions={<><select className="select" style={{ width: 150 }} aria-label="Date range" defaultValue="mtd" onChange={() => toast({ tone: 'info', title: 'Range changed (demo)', body: 'Charts keep the demo month.' })}><option value="mtd">Month to date</option><option value="30">Last 30 days</option><option value="q">This quarter</option></select>
          <button className="btn primary" onClick={() => openDialog('budget-limit', { key: 'Monthly spend' })}><Settings2 size={15} />Edit limits</button></>}
        kpis={[
        { key: 'spend', icon: Database, value: SPEND, prefix: '$', label: 'This Month Spend', color: '#a78bfa', help: 'usage.kpi.spend', onClick: () => setTab('Overview'), hint: `76% of ${money(BUDGET, 0)} Budget`, bar: 76 },
        { key: 'cpo', icon: Target, value: cpo, decimals: 2, prefix: '$', label: 'Cost / Verified Outcome', color: '#22d3ee', delta: '-11%', down: true, help: 'usage.kpi.cpo', onClick: () => setTab('Mission Costs') },
        { key: 'out', icon: CheckCircle2, value: VERIFIED_OUTCOMES, label: 'Verified Outcomes', color: '#2ee98a', delta: '+9.4%', help: 'usage.kpi.outcomes', onClick: () => setTab('Mission Costs') },
        { key: 'fc', icon: TrendingUp, value: proj.end, prefix: '$', label: 'Projected Month End', color: '#facc15', hint: proj.end > BUDGET ? 'above budget' : 'within budget', help: 'usage.kpi.forecast', onClick: () => setTab('Forecast') },
        { key: 'al', icon: Bell, value: alertsOpen, label: 'Open Alerts', color: '#fbbf24', hint: '1 critical', help: 'usage.kpi.alerts', onClick: () => setTab('Alerts') },
      ]}
        tabs={{ tabs, value: tab, onChange: setTab, icons: TAB_ICONS, ariaLabel: 'Usage views' }}
        toolbar={<span>{{ Overview: 'Spend, mix and efficiency at a glance.', 'Mission Costs': 'Cost, budget burn and cost per verified task.', 'Model Usage': 'Where the money goes by model and department.', Limits: 'Soft and hard caps with their consequences.', Alerts: 'Quota, anomaly and provider notices.', Forecast: 'Scenario sliders with live projection.' }[tab]}</span>} />
      <FrameBody tab={tab}>
        {tab === 'Overview' && <Overview />}
        {tab === 'Mission Costs' && <MissionCosts />}
        {tab === 'Model Usage' && <ModelUsage />}
        {tab === 'Limits' && <Limits />}
        {tab === 'Alerts' && <Alerts />}
        {tab === 'Forecast' && <Forecast />}
      </FrameBody>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function useDaily() { return useMemo(() => { const d = dailySpend(); return { d, cum: cumulative(d) }; }, []); }

function Overview() {
  const { d } = useDaily();
  const nav = useNavigate();
  const missions = useData((s) => s.missions).filter((m) => m.status !== 'archived');
  const avg7 = d.map((_, i) => Math.round(d.slice(Math.max(0, i - 6), i + 1).reduce((a, b) => a + b, 0) / Math.min(i + 1, 7)));
  const cpoDaily = d.map((v, i) => Math.round((v / (62 + i * 1.2 + (i % 4) * 3)) * 100) / 100);
  const segs = BY_MODEL.map((m) => ({ label: m.label, value: m.value, color: m.color }));
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="grid emu-usage-top">
        <div className="subpanel">
          <div className="row" style={{ gap: 8, marginBottom: 6 }}><b>Daily spend</b><HelpTrigger k="usage.daily" /><span className="spacer" />
            <span className="row" style={{ gap: 5, fontSize: 12 }}><span className="dot sm" style={{ color: 'var(--accent-2)' }} />Spend</span><span className="row" style={{ gap: 5, fontSize: 12 }}><span className="dot sm" style={{ color: 'var(--violet)' }} />7-day average</span></div>
          <AreaChart series={[{ label: 'Spend', data: d, color: 'var(--accent-2)' }, { label: '7-day avg', data: avg7, color: 'var(--violet)' }]} labels={DAYS} h={200} unit=" $" min={0} />
        </div>
        <div className="subpanel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div className="row" style={{ gap: 6, alignSelf: 'stretch' }}><b>Budget used</b><HelpTrigger k="usage.budget" /></div>
          <RingGauge value={76} size={140} stroke={13} sub={`${money(SPEND, 0)} of ${money(BUDGET, 0)}`} />
          <div className="row" style={{ gap: 6, fontSize: 12 }}><Chip hue={40} size="sm">soft cap $3,000</Chip><Chip hue={350} size="sm">hard cap $3,750</Chip></div>
          <div className="dim" style={{ fontSize: 12 }}>$910 left · 10 days remaining</div>
        </div>
      </div>
      <div className="grid g-3">
        <div className="subpanel"><div className="row" style={{ gap: 6, marginBottom: 8 }}><b>Spend by model</b><HelpTrigger k="usage.byModel" /></div>
          <div className="row" style={{ gap: 14 }}><Donut segs={segs} size={118} center="$2,840" sub="MTD" /><Legend segs={segs} /></div></div>
        <div className="subpanel"><div className="row" style={{ gap: 6, marginBottom: 8 }}><b>Cost per verified outcome</b><HelpTrigger k="usage.cpo" /></div>
          <ColumnBars data={cpoDaily} h={104} color="var(--good)" labels={cpoDaily.map((_, i) => (i % 5 === 0 ? String(i + 1) : ''))} />
          <div className="row" style={{ marginTop: 6, fontSize: 12 }}><span className="dim">Today</span><b className="good" style={{ marginLeft: 6 }}>{money(cpoDaily[cpoDaily.length - 1])}</b><span className="spacer" /><span className="dim">Cache savings this week <b className="good">$212</b></span></div></div>
        <div className="subpanel"><div className="row" style={{ gap: 6, marginBottom: 8 }}><b>Spend by department</b><HelpTrigger k="usage.byDept" /></div>
          <div className="col" style={{ gap: 9 }}>{BY_DEPT.map((x) => <MeterRow key={x.label} label={x.label} value={x.value} max={1000} right={money(x.value, 0)} />)}</div></div>
      </div>
      <div className="subpanel">
        <div className="row" style={{ gap: 8, marginBottom: 8 }}><b>Cost per mission</b><HelpTrigger k="usage.missionTable" /><span className="spacer" /><button className="btn sm ghost" onClick={() => nav('/usage?tab=mission-costs')}>Open details<ArrowRight size={13} /></button></div>
        <MissionTable rows={missions.slice(0, 6)} />
      </div>
    </div>
  );
}

function MissionTable({ rows }: { rows: ReturnType<typeof useData.getState>['missions'] }) {
  const nav = useNavigate();
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Mission</th><th>Status</th><th>Cost</th><th>Budget burn</th><th>Verified tasks</th><th>Cost / verified task</th><th /></tr></thead>
        <tbody>
          {rows.map((m, i) => {
            const burn = Math.min(100, (m.cost / m.budget) * 100);
            const per = m.tasksVerified ? m.cost / m.tasksVerified : null;
            return (
              <motion.tr key={m.id} onClick={() => nav(`/missions/${m.id}`)} style={{ cursor: 'pointer' }} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * .04 }}>
                <td><b>{m.title}</b> <span className="mono dim" style={{ fontSize: 11 }}>{m.id}</span></td>
                <td><Chip hue={m.status === 'running' ? 150 : m.status === 'failed' ? 350 : 215} size="sm">{m.status}</Chip></td>
                <td className="tnum"><b>{money(m.cost)}</b> <span className="dim">/ {money(m.budget, 0)}</span></td>
                <td style={{ width: 150 }}><div className={cx('bar thin', burn > 85 ? 'bad' : burn > 60 ? 'warn' : 'good')}><motion.i initial={{ width: 0 }} animate={{ width: `${burn}%` }} transition={{ duration: .9, delay: .1 + i * .04 }} /></div></td>
                <td className="tnum">{m.tasksVerified} / {m.tasksTotal}</td>
                <td className="tnum">{per == null ? <span className="dim">no verified output</span> : <b>{money(per)}</b>}</td>
                <td><Eye size={14} className="dim" /></td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MissionCosts() {
  const missions = useData((s) => s.missions).filter((m) => m.status !== 'archived');
  const [sort, setSort] = useState<'cost' | 'eff' | 'burn'>('eff');
  const rows = useMemo(() => [...missions].sort((a, b) => sort === 'cost' ? b.cost - a.cost : sort === 'burn' ? b.cost / b.budget - a.cost / a.budget : (a.tasksVerified ? a.cost / a.tasksVerified : 1e9) - (b.tasksVerified ? b.cost / b.tasksVerified : 1e9)), [missions, sort]);
  const eff = rows.filter((m) => m.tasksVerified).map((m) => m.cost / m.tasksVerified);
  const best = rows.find((m) => m.tasksVerified);
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="segmented sm" role="radiogroup" aria-label="Sort missions">
          {([['eff', 'Most efficient'], ['cost', 'Highest cost'], ['burn', 'Budget burn']] as const).map(([k, l]) => <button key={k} role="radio" aria-checked={sort === k} className="seg-btn" onClick={() => setSort(k)} style={sort === k ? { background: 'rgba(var(--accent-rgb), .28)' } : undefined}>{l}</button>)}
        </div>
        <span className="spacer" />
        {best && <Chip hue={150} icon={Leaf}>Best: {best.id} at {money(best.cost / best.tasksVerified)} per verified task</Chip>}
        <button className="btn" onClick={() => toast({ tone: 'success', title: 'Comparison exported (demo)' })}><Download size={14} />Export</button>
      </div>
      <div className="subpanel">
        <div className="row" style={{ gap: 6, marginBottom: 8 }}><b>Cost per verified task, by mission ($)</b><HelpTrigger k="usage.cpvt" /></div>
        <ColumnBars data={eff.map((v) => Math.round(v * 100) / 100)} h={120} color="var(--accent)" labels={rows.filter((m) => m.tasksVerified).map((m) => m.id.replace('M-', ''))} />
      </div>
      <div className="row emu-note"><Info size={15} className="info" /><span>Attribution basis: model calls are charged to the mission, task and agent instance that made them. Shared overhead (indexing, health checks) is excluded and shown under Model Usage.</span></div>
      <MissionTable rows={rows} />
    </div>
  );
}

function ModelUsage() {
  const total = BY_MODEL.reduce((a, b) => a + b.value, 0);
  return (
    <div className="grid emu-bench-top">
      <div className="subpanel">
        <div className="row" style={{ gap: 6, marginBottom: 10 }}><b>Spend, calls and tokens by model</b><HelpTrigger k="usage.byModel" /></div>
        <div className="col" style={{ gap: 12 }}>
          {BY_MODEL.map((m, i) => (
            <div key={m.label} className="emu-usage-row">
              <span className="row" style={{ gap: 7 }}><span className="dot sm" style={{ color: m.color }} /><span className="mono" style={{ fontSize: 12.5 }}>{m.label}</span></span>
              <div className="bar thin"><motion.i style={{ background: m.color }} initial={{ width: 0 }} animate={{ width: `${(m.value / BY_MODEL[0].value) * 100}%` }} transition={{ duration: .9, delay: i * .07 }} /></div>
              <span className="dim tnum" style={{ fontSize: 11.5 }}>{m.calls.toLocaleString()} calls · {m.tokens}</span>
              <b className="tnum">{money(m.value, 0)}</b>
            </div>
          ))}
        </div>
      </div>
      <div className="subpanel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <div className="row" style={{ gap: 6, alignSelf: 'stretch' }}><b>Share of spend</b></div>
        <Donut segs={BY_MODEL.map((m) => ({ label: m.label, value: m.value, color: m.color }))} size={150} stroke={16} center={money(total, 0)} sub="all models" />
        <div className="row emu-note" style={{ alignSelf: 'stretch' }}><PiggyBank size={15} className="good" /><span>Routing planner fallbacks to Sonnet 5.5 for low-risk plans would save about <b>$140</b> a month.</span></div>
        <button className="btn sm" onClick={() => toast({ tone: 'info', title: 'Routing suggestion opened (demo)', body: 'Goes to Models > Routing as a proposal, not an automatic change.' })}>Review suggestion</button>
      </div>
    </div>
  );
}

function Limits() {
  const over = useLimits((s) => s.over);
  const rev = useLimits((s) => s.revisions);
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row wrap emu-note"><Gauge size={16} className="info" /><span>Soft caps warn. Hard caps enforce the consequence shown. Limit revision <b className="mono">r{rev}</b>; every change is logged.</span><span className="spacer" /><button className="btn sm" onClick={() => openDialog('budget-limit')}>New limit</button></div>
      <div className="grid g-3">
        {LIMITS.map((l, i) => {
          const o = over[l.key]; const cap = o?.cap ?? l.cap, soft = o?.soft ?? l.soft;
          const pct = Math.min(100, (l.used / cap) * 100); const tone = l.used >= cap ? 'bad' : l.used >= soft ? 'warn' : 'good';
          return (
            <motion.div key={l.key} className="subpanel glass-card hoverable" style={{ padding: 14 }} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .05 }}>
              <div className="row" style={{ gap: 8 }}><b>{l.key}</b><span className="spacer" /><Chip hue={215} size="sm">{l.scope}</Chip></div>
              <div className="row" style={{ gap: 8, margin: '10px 0 6px', alignItems: 'baseline' }}><b className="display" style={{ fontSize: 24 }}>{l.unit === '$' ? '$' : ''}{l.used.toLocaleString()}{l.unit !== '$' ? l.unit : ''}</b><span className="dim">of {l.unit === '$' ? '$' : ''}{cap.toLocaleString()}{l.unit !== '$' ? l.unit : ''}</span><span className="spacer" /><b className={tone}>{Math.round(pct)}%</b></div>
              <div className={'bar ' + tone} style={{ position: 'relative' }}><motion.i initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 1 }} /><span className="emu-soft" style={{ left: `${(soft / cap) * 100}%` }} title="Soft cap" /></div>
              <div className="dim" style={{ fontSize: 11.5, margin: '6px 0 10px' }}>Soft at {l.unit === '$' ? '$' : ''}{soft.toLocaleString()} · {l.consequence}</div>
              <button className="btn sm" onClick={() => openDialog('budget-limit', { key: l.key })}><Settings2 size={13} />Adjust</button>
              {o && <Chip hue={150} size="sm" icon={Check} style={{ marginLeft: 8 }}>revised</Chip>}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function Alerts() {
  const [ack, setAck] = useState<Record<string, boolean>>({});
  const ico = { warn: AlertTriangle, bad: XCircle, info: Info, good: CheckCircle2 } as const;
  const hue = { warn: 40, bad: 352, info: 205, good: 150 } as const;
  return (
    <div className="col" style={{ gap: 10 }}>
      <AnimatePresence initial={false}>
        {ALERTS.map((a, i) => {
          const I = ico[a.sev]; const done = ack[a.id];
          return (
            <motion.div key={a.id} layout className={'subpanel emu-alert' + (done ? ' ack' : '')} style={{ ['--h' as string]: hue[a.sev] }} initial={{ opacity: 0, x: -14 }} animate={{ opacity: done ? .55 : 1, x: 0 }} transition={{ delay: i * .05 }}>
              <span className="emu-alert-ico"><I size={20} /></span>
              <div style={{ minWidth: 0, flex: 1 }}><div className="row" style={{ gap: 8 }}><b>{a.title}</b><Chip hue={215} size="sm">{a.scope}</Chip></div><div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{a.body}</div></div>
              <span className="dim" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{a.ago}</span>
              <button className="btn sm ghost" onClick={() => toast({ tone: 'info', title: `${a.id} evidence (demo)`, body: 'Opens the underlying cost events.' })}>Inspect</button>
              <button className="btn sm" disabled={done} onClick={() => { setAck((s) => ({ ...s, [a.id]: true })); toast({ tone: 'success', title: 'Alert acknowledged (demo)' }); }}>{done ? <><Check size={13} />Acknowledged</> : 'Acknowledge'}</button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
const PRESETS: { label: string; s: Scenario }[] = [
  { label: 'Current pace', s: DEFAULT_SCENARIO },
  { label: 'Growth', s: { agents: 52, missions: 20, opusShare: 26, cache: 58, budget: BUDGET } },
  { label: 'Frugal', s: { agents: 34, missions: 10, opusShare: 8, cache: 74, budget: BUDGET } },
];
function Forecast() {
  const [s, setS] = useState<Scenario>(DEFAULT_SCENARIO);
  const r = useMemo(() => project(s), [s]);
  const set = (p: Partial<Scenario>) => setS((x) => ({ ...x, ...p }));
  const over = r.end > s.budget;
  const cross = r.proj.findIndex((v) => v > s.budget);
  const sl: { k: keyof Scenario; label: string; min: number; max: number; step: number; fmt: (v: number) => string; help: string }[] = [
    { k: 'agents', label: 'Active agents', min: 20, max: 70, step: 1, fmt: (v) => String(v), help: 'usage.fc.agents' },
    { k: 'missions', label: 'Concurrent missions', min: 4, max: 26, step: 1, fmt: (v) => String(v), help: 'usage.fc.missions' },
    { k: 'opusShare', label: 'Opus 5.5 share of calls', min: 0, max: 50, step: 1, fmt: (v) => `${v}%`, help: 'usage.fc.opus' },
    { k: 'cache', label: 'Prompt cache hit rate', min: 20, max: 85, step: 1, fmt: (v) => `${v}%`, help: 'usage.fc.cache' },
    { k: 'budget', label: 'Monthly budget cap', min: 2500, max: 5000, step: 50, fmt: (v) => money(v, 0), help: 'usage.fc.budget' },
  ];
  // custom chart
  const W = 640, H = 230, P = 8, N = 30;
  const ymax = Math.max(s.budget * 1.08, ...r.hi, 3000);
  const X = (i: number) => P + (i / (N - 1)) * (W - 2 * P);
  const Y = (v: number) => H - 20 - (v / ymax) * (H - 34);
  const line = (arr: number[], off: number) => arr.map((v, i) => `${i ? 'L' : 'M'}${X(i + off)},${Y(v)}`).join(' ');
  const actual = line(r.cum, 0);
  const projPath = line([r.cum[r.cum.length - 1], ...r.proj], r.cum.length - 1);
  const band = `${r.hi.map((v, i) => `${i ? 'L' : 'M'}${X(r.cum.length + i)},${Y(v)}`).join(' ')} ${[...r.lo].reverse().map((v, i) => `L${X(N - 1 - i)},${Y(v)}`).join(' ')}Z`;
  return (
    <div className="emu-split wide fc">
      <div className="col" style={{ gap: 12 }}>
        <div className="subpanel">
          <div className="row wrap" style={{ gap: 8, marginBottom: 6 }}><b>Cumulative spend, month end projection</b><HelpTrigger k="usage.fc.chart" /><span className="spacer" />
            <span className="row" style={{ gap: 5, fontSize: 12 }}><span className="dot sm" style={{ color: 'var(--accent-2)' }} />Actual</span>
            <span className="row" style={{ gap: 5, fontSize: 12 }}><span className="dot sm" style={{ color: 'var(--violet)' }} />Projection</span>
            <span className="row" style={{ gap: 5, fontSize: 12 }}><span className="dot sm" style={{ color: 'var(--bad)' }} />Budget cap</span></div>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="emu-fc" role="img" aria-label={`Projected month-end spend ${money(r.end, 0)} versus cap ${money(s.budget, 0)}`}>
            <defs>
              <linearGradient id="fcA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent-2)" stopOpacity=".3" /><stop offset="1" stopColor="var(--accent-2)" stopOpacity="0" /></linearGradient>
            </defs>
            {[0, .25, .5, .75, 1].map((t) => <line key={t} x1={P} x2={W - P} y1={Y(ymax * t)} y2={Y(ymax * t)} stroke="var(--border-soft)" strokeDasharray="3 5" />)}
            {[0, 1, 2, 3, 4].map((t) => <text key={t} x={P + 2} y={Y((ymax * t) / 4) - 3} fontSize="9.5" fill="var(--text-dim)">{t ? money((ymax * t) / 4, 0) : ''}</text>)}
            <path d={`${actual} L${X(r.cum.length - 1)},${Y(0)} L${X(0)},${Y(0)}Z`} fill="url(#fcA)" />
            <motion.path d={band} fill="var(--violet)" initial={false} animate={{ d: band, opacity: .18 }} transition={{ type: 'spring', stiffness: 160, damping: 22 }} />
            <motion.path d={actual} fill="none" stroke="var(--accent-2)" strokeWidth="2.4" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2 }} style={{ filter: 'drop-shadow(0 0 4px var(--accent-2))' }} />
            <motion.path fill="none" stroke="var(--violet)" strokeWidth="2.4" strokeDasharray="7 5" strokeLinecap="round" initial={false} animate={{ d: projPath }} transition={{ type: 'spring', stiffness: 160, damping: 22 }} style={{ filter: 'drop-shadow(0 0 4px var(--violet))' }} />
            <motion.line x1={P} x2={W - P} stroke="var(--bad)" strokeWidth="1.6" strokeDasharray="2 4" initial={false} animate={{ y1: Y(s.budget), y2: Y(s.budget) }} />
            <motion.text x={W - P - 2} textAnchor="end" fontSize="10.5" fontWeight="700" fill="var(--bad)" initial={false} animate={{ y: Y(s.budget) - 5 }}>Cap {money(s.budget, 0)}</motion.text>
            <line x1={X(r.cum.length - 1)} x2={X(r.cum.length - 1)} y1="6" y2={H - 20} stroke="var(--border-strong)" strokeDasharray="2 3" />
            <text x={X(r.cum.length - 1) - 4} y="14" textAnchor="end" fontSize="9.5" fill="var(--text-dim)">today</text>
            <motion.circle r="5" fill={over ? 'var(--bad)' : 'var(--good)'} initial={false} animate={{ cx: X(N - 1), cy: Y(r.end) }} style={{ filter: 'drop-shadow(0 0 6px currentColor)' }} />
            <text x={P} y={H - 4} fontSize="10" fill="var(--text-dim)">Nov 1</text><text x={W - P} y={H - 4} fontSize="10" textAnchor="end" fill="var(--text-dim)">Nov 30</text>
          </svg>
        </div>
        <div className="grid g-4">
          {[
            { l: 'Projected month end', v: money(r.end, 0), c: over ? 'bad' : 'good', sub: over ? `${money(r.end - s.budget, 0)} over cap` : `${money(s.budget - r.end, 0)} headroom` },
            { l: 'Daily run rate', v: money(r.daily, 0), c: '', sub: 'modelled, next 10 days' },
            { l: 'Cap reached', v: cross < 0 ? 'Not this month' : `Nov ${21 + cross}`, c: cross < 0 ? 'good' : 'bad', sub: cross < 0 ? 'stays under cap' : 'non-critical missions pause' },
            { l: 'Confidence', v: `${Math.max(62, 88 - Math.abs(s.agents - 38) - Math.abs(s.missions - 12))}%`, c: '', sub: 'widens with bigger changes' },
          ].map((x, i) => (
            <motion.div key={x.l} className="subpanel glass-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .05 }}>
              <div className="dim" style={{ fontSize: 12 }}>{x.l}</div><div className={'display ' + x.c} style={{ fontSize: 22, fontWeight: 800, margin: '2px 0' }}>{x.v}</div><div className="dim" style={{ fontSize: 11.5 }}>{x.sub}</div>
            </motion.div>
          ))}
        </div>
      </div>
      <div className="subpanel" style={{ padding: 14 }}>
        <div className="row" style={{ gap: 8, marginBottom: 10 }}><SlidersHorizontal size={16} className="violet" /><b>Scenario</b><HelpTrigger k="usage.fc.scenario" /><span className="spacer" /><button className="btn sm ghost" onClick={() => setS(DEFAULT_SCENARIO)}><RotateCcw size={13} />Reset</button></div>
        <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>{PRESETS.map((p) => <button key={p.label} className="btn sm" onClick={() => setS(p.s)}>{p.label}</button>)}</div>
        <div className="col" style={{ gap: 14 }}>
          {sl.map((x) => (
            <div key={x.k} className="col" style={{ gap: 4 }}>
              <div className="row" style={{ fontSize: 12.5 }}>{x.label}<HelpTrigger k={x.help} /><span className="spacer" /><b className="tnum">{x.fmt(s[x.k])}</b></div>
              <input type="range" className="range" min={x.min} max={x.max} step={x.step} value={s[x.k]} onChange={(e) => set({ [x.k]: +e.target.value })} aria-label={x.label} />
            </div>
          ))}
        </div>
        <div className="row" style={{ gap: 6, marginTop: 14 }}>
          <button className="btn sm" onClick={() => toast({ tone: 'success', title: 'Forecast exported (demo)', body: 'Assumptions and the projection series, as CSV.' })}><Download size={13} />Export</button>
          <button className="btn sm primary" onClick={() => openDialog('budget-limit', { key: 'Monthly spend', cap: s.budget })}>Set this cap</button>
        </div>
        <div className="dim" style={{ fontSize: 11.5, marginTop: 10 }}>Modelled from the last 7 days. Assumptions: linear mission growth, constant mix otherwise.</div>
      </div>
    </div>
  );
}
