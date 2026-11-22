import { AnimatePresence, motion } from 'motion/react';
import { LiveStatus } from '@/components/ui/LiveStatus';
import { useAgentsCatalog, useAgentInstances } from '@/api/agents';
import { useNavigate } from 'react-router-dom';
import { Layers, Target, Users, ClipboardList, Trophy, Database, HeartPulse, CheckCircle2, Scale, PlayCircle, Flag, BadgeCheck, ShieldQuestion, Timer, XCircle, RotateCcw, Hourglass, UserCheck, ClipboardCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ScorecardRow, ScorecardWindow } from '@contracts';
import type { KpiItem } from './PageFrame';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Tip } from '@/components/ui/Tip';
import { RingGauge } from '@/components/viz/Charts';
import { cx } from '@/lib/format';
import { useData, allApprovals, useVisibleMissions } from '@/store/data';
import { AGENTS } from '@/data/agents';
import { DemoTag } from '@/components/ui/Chips';
import { Segmented, Switch } from '@/components/ui/Form';
import { isApi } from '@/api/mode';
import { useScorecard, rowOf, fmtRow, trendOf } from '@/api/scorecard';
import { useThroughput } from '@/api/throughput';
import { ThroughputChart } from '@/components/viz/ThroughputChart';
import { IconButton } from '@/components/ui/IconButton';
import { openDialog } from '@/store/ui';

/** Company-wide KPI tiles (40-4 command center) — rendered through the shared TopBoard. */
export function useCompanyKpis(): KpiItem[] {
  useAgentsCatalog();
  const nav = useNavigate();
  const missions = useVisibleMissions();
  const decisions = useData((s) => s.approvalDecisions);
  const active = missions.filter((m) => ['running', 'planning', 'verifying', 'waiting'].includes(m.status)).length;
  const pending = useMemo(() => allApprovals(missions, decisions).filter((a) => a.status === 'pending').length, [missions, decisions]);
  const activeAgents = AGENTS.filter((a) => a.status === 'active' || a.status === 'in-mission').length;
  const score = useScorecard('30d', false); // api mode only (no request in demo mode)
  const instances = useAgentInstances(); // api mode only (no request in demo mode); re-read on instance/task/mission events
  if (isApi()) {
    // improvement cycle 2: no invented company numbers in api mode. Success comes from the server scorecard (30 days, DEMO
    // missions excluded) with its sample size; no trend delta; no token tile (tokens are recorded from Stage 9).
    const r = rowOf(score.data, 'verified_success_rate');
    const success: KpiItem = r && r.state === 'ok' && r.value !== null
      ? { key: 'success', icon: Trophy, value: r.value, decimals: 1, suffix: '%', label: 'Verified Success', color: '#facc15', help: 'kpi.success.api', onClick: () => nav('/missions'),
          badge: <Tip label={r.evidence}><span data-kpi-n={r.n}>n={r.n}</span></Tip>, hint: 'finished missions · 30 days' }
      : { key: 'success', icon: Trophy, value: 0, text: r ? 'not enough evidence' : score.error ? 'unavailable' : 'loading…', ...(r ? {} : { live: score.error ? 'alert' as const : 'status' as const }), label: 'Verified Success', color: '#facc15', help: 'kpi.success.api', onClick: () => nav('/missions'),
          ...(r ? { badge: <Tip label={r.evidence}><span data-kpi-n={r.n}>n={r.n}</span></Tip> } : {}),
          hint: <Tip label={r?.evidence ?? score.error ?? 'Reading the scorecard'}><span>{r ? 'finished missions · 30 days' : '30 days'}</span></Tip> };
    // fix round I1: agent statuses in api mode are prototype fixtures, so the tile counts what the server recorded instead:
    // agents with a live, non-simulated instance on a real (non-DEMO) active mission. Nothing executes yet.
    const liveMissions = new Set(missions.filter((m) => !m.demo && ['running', 'planning', 'verifying', 'waiting'].includes(m.status)).map((m) => m.id));
    const staffed = instances.data ? new Set(instances.data.filter((i) => !i.simulated && !i.endedAt && liveMissions.has(i.missionId)).map((i) => i.agentId)).size : null;
    const agentsTile: KpiItem = staffed === null
      ? { key: 'agents', icon: Users, value: 0, text: instances.error ? 'unavailable' : 'loading…', live: instances.error ? 'alert' as const : 'status' as const, label: 'Staffed Agents', hint: 'real missions', color: '#3b82f6', help: 'kpi.staffedAgents', onClick: () => nav('/agents') }
      : { key: 'agents', icon: Users, value: staffed, label: 'Staffed Agents', hint: <span data-kpi-staffed={staffed}>of {AGENTS.length} · on real active missions</span>, color: '#3b82f6', help: 'kpi.staffedAgents', onClick: () => nav('/agents') };
    return [
      { key: 'missions', icon: Target, value: active, label: 'Active Missions', color: '#22d3ee', help: 'kpi.activeMissions', onClick: () => nav('/missions?filter=active') },
      agentsTile,
      { key: 'approvals', icon: ClipboardList, value: pending, label: 'Pending Approvals', color: '#fbbf24', help: 'kpi.approvals', onClick: () => nav('/notifications?tab=pending') },
      success,
    ];
  }
  return [
    { key: 'missions', icon: Target, value: active, label: 'Active Missions', delta: '+2', color: '#22d3ee', help: 'kpi.activeMissions', onClick: () => nav('/missions?filter=active') },
    { key: 'agents', icon: Users, value: activeAgents, label: 'Active Agents', hint: `of ${AGENTS.length} · one per role`, color: '#3b82f6', help: 'kpi.activeAgents', onClick: () => nav('/agents') },
    { key: 'approvals', icon: ClipboardList, value: pending, label: 'Pending Approvals', color: '#fbbf24', help: 'kpi.approvals', onClick: () => nav('/notifications?tab=pending') },
    { key: 'success', icon: Trophy, value: 96.4, decimals: 1, suffix: '%', label: 'Mission Success', delta: '+2.1%', color: '#facc15', help: 'kpi.success', onClick: () => nav('/results') },
    { key: 'tokens', icon: Database, value: 1.84, decimals: 2, suffix: 'M', label: 'Tokens Today', hint: 'all agents · all missions', color: '#a78bfa', help: 'kpi.tokens', onClick: () => nav('/operations') },
  ];
}

const ROW_ICON: Record<ScorecardRow['key'], LucideIcon> = {
  started: PlayCircle, finished: Flag, verified_success_rate: BadgeCheck, completed_unverified: ShieldQuestion,
  median_cycle_time_h: Timer, failure_rate: XCircle, task_recovery_rate: RotateCcw, waiting_approval_median_h: Hourglass,
  approved_by_non_owner: UserCheck, tasks_verified_by_review: ClipboardCheck,
};
const WINDOW_LABEL: Record<ScorecardWindow, string> = { '7d': 'last 7 days', '30d': 'last 30 days', '90d': 'last 90 days' };
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const range = (d: { from: string; to: string }) => `${day(d.from)} – ${day(d.to)}`;

/** "Company Scorecard" (api mode): the server's rows, each with its value or "—", n, window and evidence. Replaces the
 *  DEMO health ring as the Overview aside in api mode. */
export function CompanyScorecard() {
  const [win, setWin] = useState<ScorecardWindow>('30d');
  const [demo, setDemo] = useState(false);
  const { data, error } = useScorecard(win, demo);
  const tput = useThroughput(8, demo).data;
  const shown = data && data.window === win && data.includeDemo === demo ? data : null;
  return (
    <motion.section className="panel cc-health cc-score" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .4, delay: .08 }}
      aria-label="Company scorecard" data-scorecard={shown ? 'ready' : error ? 'error' : 'loading'} data-window={win} data-demo={demo ? '1' : '0'}>
      <header className="panel-head sc-head">
        <Scale size={18} className="ph-icon" aria-hidden />
        <h2 className="panel-title">Company Scorecard</h2>
        <HelpTrigger k="company.scorecard" />
        <AnimatePresence>{demo && <motion.span key="demo" initial={{ opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .8 }}><DemoTag title="DEMO missions are included in these numbers" /></motion.span>}</AnimatePresence>
        <span className="spacer" />
        <IconButton icon={Layers} size="sm" variant="bordered" label="Six dimensions" data-six-dimensions onClick={() => openDialog('six-dimensions')} />
        <Segmented size="sm" ariaLabel="Scorecard window" value={win} onChange={setWin}
          options={(['7d', '30d', '90d'] as const).map((k) => ({ key: k, label: k, title: shown && k === win ? `${WINDOW_LABEL[k]}: ${range(shown)}` : WINDOW_LABEL[k] }))} />
      </header>
      <div className="sc-rows" role="table" aria-label={`Company scorecard, ${WINDOW_LABEL[win]}${shown ? ` (${range(shown)})` : ''}`}>
        {(shown?.rows ?? []).map((r, i) => {
          const Icon = ROW_ICON[r.key];
          return (
            <Tip key={r.key} side="left" label={<span>{r.evidence}<br /><span className="dim">{WINDOW_LABEL[win]} ({range(shown!)}) · missions you can see{demo ? ' · DEMO included' : ''}</span></span>}>
              <motion.div className={cx('sc-row', r.state === 'none' && 'none')} role="row" tabIndex={0} data-row={r.key} data-state={r.state} data-value={r.value ?? ''} data-n={r.n}
                initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .15 + i * .04 }}>
                <Icon size={14} className="sc-ico" aria-hidden />
                <span role="cell" className="sc-label ellipsis">{r.label}</span>
                <motion.b role="cell" key={`${r.value}`} className="sc-val tnum" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>{fmtRow(r)}</motion.b>
                {(() => { const t = trendOf(r); return (
                  <span role="cell" className={cx('sc-prev tnum', t && 'on', t && `tr-${r.trend}`)} data-trend={r.trend ?? ''} title={t ? `${t.word} ${t.prev} in the previous ${WINDOW_LABEL[win].replace('last ', '')} (n=${r.previous.n})` : undefined}>
                    {t ? `${t.arrow} ${t.prev}` : ''}</span>); })()}
                <span role="cell" className="sc-n tnum" title="sample size">n={r.n}</span>
                <span onClick={(e) => e.stopPropagation()}><HelpTrigger k={`scorecard.${r.key}`} /></span>
              </motion.div>
            </Tip>
          );
        })}
        {tput && (
          <div className="sc-tput" data-tput-ready="1" aria-label="Weekly throughput">
            <span className="dim sc-tput-l"><span>weekly</span><span>8 wk</span></span>
            <ThroughputChart weeks={tput.weeks} />
            <span onClick={(e) => e.stopPropagation()}><HelpTrigger k="scorecard.throughput" /></span>
          </div>
        )}
        {!shown && (error ? <LiveStatus key="err" kind="error" className="dim sc-empty">{error}</LiveStatus> : <LiveStatus key="load" className="dim sc-empty">Reading the scorecard…</LiveStatus>)}
      </div>
      <footer className="sc-foot">
        <span className="dim ellipsis">{shown ? range(shown) : WINDOW_LABEL[win]} · visible missions</span>
        <span className="spacer" />
        <label className="row sc-demo"><span>include DEMO missions</span><Switch checked={demo} onChange={setDemo} label="Include DEMO missions" /></label>
      </footer>
    </motion.section>
  );
}

/** "Company Health" ring board — the aside of the Overview top board. */
export function CompanyHealth() {
  useAgentsCatalog();
  return (
    <motion.section className="panel cc-health" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .4, delay: .08 }} aria-label="Company health">
      <header className="panel-head" style={{ marginBottom: 6 }}>
        <HeartPulse size={20} className="ph-icon" aria-hidden />
        <h2 className="panel-title">Company Health</h2>
        <HelpTrigger k="company.health" />
        <span className="spacer" />
        <IconButton icon={Layers} size="sm" variant="bordered" label="Six dimensions (sample)" data-six-dimensions onClick={() => openDialog('six-dimensions')} />
      </header>
      <div className="row" style={{ gap: 18, alignItems: 'center' }}>
        <RingGauge value={98} size={112} label="Company health" />
        <div className="col" style={{ gap: 7, flex: 1, fontSize: 13.5 }}>
          {[['Agents', `${AGENTS.length} / ${AGENTS.length}`], ['Execution Jobs', '12 / 12'], ['Infrastructure', '99.9%'], ['Knowledge Sync', 'Up to date']].map(([k, v], i) => (
            <Tip key={k} label={`${k}: last check passed ${i + 1} min ago`} side="left">
              <motion.div className="row" tabIndex={0} style={{ justifyContent: 'space-between', gap: 10 }} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .3 + i * .08 }}>
                <span className="row" style={{ gap: 8 }}><CheckCircle2 size={17} className="good" style={{ filter: 'drop-shadow(0 0 5px rgba(var(--good-rgb),.7))' }} />{k}</span>
                <b style={{ fontWeight: 600 }}>{v}</b>
              </motion.div>
            </Tip>
          ))}
        </div>
      </div>
    </motion.section>
  );
}
