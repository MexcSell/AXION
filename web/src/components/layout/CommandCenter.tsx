import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { Landmark, Target, Users, ClipboardList, Trophy, Database, ArrowUp, HeartPulse, CheckCircle2 } from 'lucide-react';
import { useMemo } from 'react';
import type { LucideIcon } from 'lucide-react';
import { CountUp } from '@/components/ui/CountUp';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Tip } from '@/components/ui/Tip';
import { RingGauge } from '@/components/viz/Charts';
import { useData, allApprovals } from '@/store/data';
import { AGENTS } from '@/data/agents';

interface Kpi { key: string; icon: LucideIcon; value: number; decimals?: number; prefix?: string; suffix?: string; label: string; delta?: string; color: string; path: string; help: string; budget?: number; }

/** "Company Command Center" header with KPI tiles and Company Health ring (40-4 reference). */
export function CommandCenter({ title = 'Company Command Center', sub = 'Run, build, verify, evolve, and grow your AI company.' }: { title?: string; sub?: string }) {
  const nav = useNavigate();
  const missions = useData((s) => s.missions);
  const decisions = useData((s) => s.approvalDecisions);
  const active = missions.filter((m) => ['running', 'planning', 'verifying', 'waiting'].includes(m.status)).length;
  const pending = useMemo(() => allApprovals(missions, decisions).filter((a) => a.status === 'pending').length, [missions, decisions]);
  const activeAgents = AGENTS.filter((a) => a.status === 'active' || a.status === 'in-mission').length;

  const kpis: Kpi[] = [
    { key: 'missions', icon: Target, value: active, label: 'Active Missions', delta: '+2', color: '#22d3ee', path: '/missions?tab=active', help: 'kpi.activeMissions' },
    { key: 'agents', icon: Users, value: activeAgents, label: 'Active Agents', delta: '+4', color: '#3b82f6', path: '/agents', help: 'kpi.activeAgents' },
    { key: 'approvals', icon: ClipboardList, value: pending, label: 'Pending Approvals', color: '#fbbf24', path: '/governance?tab=approvals', help: 'kpi.approvals' },
    { key: 'success', icon: Trophy, value: 96.4, decimals: 1, suffix: '%', label: 'Mission Success', delta: '+2.1%', color: '#facc15', path: '/usage', help: 'kpi.success' },
    { key: 'spend', icon: Database, value: 2840, prefix: '$', label: 'This Month Spend', color: '#a78bfa', path: '/usage?tab=overview', help: 'kpi.spend', budget: 76 },
  ];

  return (
    <div className="cc-grid">
      <motion.section className="panel cc-main" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .4 }}>
        <header className="panel-head" style={{ marginBottom: 10 }}>
          <Landmark size={30} className="ph-icon" aria-hidden />
          <div style={{ minWidth: 0 }}>
            <div className="row"><h1 className="panel-title" style={{ fontSize: 20 }}>{title}</h1></div>
            <div className="panel-sub" style={{ color: 'var(--text-2)' }}>{sub}</div>
          </div>
        </header>
        <div className="cc-kpis">
          {kpis.map((k, i) => (
            <motion.button key={k.key} className="kpi" style={{ ['--kc' as string]: k.color }} onClick={() => nav(k.path)}
              initial={{ opacity: 0, y: 12, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: .08 + i * .06, duration: .35 }}
              aria-label={`${k.label}: ${k.prefix ?? ''}${k.value}${k.suffix ?? ''}. Open details`}>
              <k.icon size={34} strokeWidth={1.6} className="kpi-ico" aria-hidden />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="kpi-val"><CountUp value={k.value} decimals={k.decimals} prefix={k.prefix} suffix={k.suffix} /></div>
                <div className="kpi-label">{k.label}</div>
                {k.delta && <div className="kpi-delta"><ArrowUp size={14} strokeWidth={3} />{k.delta}</div>}
                {k.budget != null && (
                  <div style={{ marginTop: 2 }}>
                    <div className="kpi-label" style={{ fontSize: 12 }}>{k.budget}% of Budget</div>
                    <div className="bar thin good" style={{ marginTop: 3 }}><motion.i initial={{ width: 0 }} animate={{ width: `${k.budget}%` }} transition={{ duration: 1.2, delay: .4 }} /></div>
                  </div>
                )}
              </div>
            </motion.button>
          ))}
        </div>
      </motion.section>

      <motion.section className="panel cc-health" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .4, delay: .08 }} aria-label="Company health">
        <header className="panel-head" style={{ marginBottom: 6 }}>
          <HeartPulse size={20} className="ph-icon" aria-hidden />
          <h2 className="panel-title">Company Health</h2>
          <HelpTrigger k="company.health" />
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
    </div>
  );
}
