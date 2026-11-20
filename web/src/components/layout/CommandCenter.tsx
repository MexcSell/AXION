import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { Target, Users, ClipboardList, Trophy, Database, HeartPulse, CheckCircle2 } from 'lucide-react';
import { useMemo } from 'react';
import type { KpiItem } from './PageFrame';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Tip } from '@/components/ui/Tip';
import { RingGauge } from '@/components/viz/Charts';
import { useData, allApprovals } from '@/store/data';
import { AGENTS } from '@/data/agents';

/** Company-wide KPI tiles (40-4 command center) — rendered through the shared TopBoard. */
export function useCompanyKpis(): KpiItem[] {
  const nav = useNavigate();
  const missions = useData((s) => s.missions);
  const decisions = useData((s) => s.approvalDecisions);
  const active = missions.filter((m) => ['running', 'planning', 'verifying', 'waiting'].includes(m.status)).length;
  const pending = useMemo(() => allApprovals(missions, decisions).filter((a) => a.status === 'pending').length, [missions, decisions]);
  const activeAgents = AGENTS.filter((a) => a.status === 'active' || a.status === 'in-mission').length;
  return [
    { key: 'missions', icon: Target, value: active, label: 'Active Missions', delta: '+2', color: '#22d3ee', help: 'kpi.activeMissions', onClick: () => nav('/missions?filter=active') },
    { key: 'agents', icon: Users, value: activeAgents, label: 'Active Agents', hint: `of ${AGENTS.length} · one per role`, color: '#3b82f6', help: 'kpi.activeAgents', onClick: () => nav('/agents') },
    { key: 'approvals', icon: ClipboardList, value: pending, label: 'Pending Approvals', color: '#fbbf24', help: 'kpi.approvals', onClick: () => nav('/governance?tab=approvals') },
    { key: 'success', icon: Trophy, value: 96.4, decimals: 1, suffix: '%', label: 'Mission Success', delta: '+2.1%', color: '#facc15', help: 'kpi.success', onClick: () => nav('/usage') },
    { key: 'spend', icon: Database, value: 2840, prefix: '$', label: 'This Month Spend', hint: '76% of Budget', bar: 76, color: '#a78bfa', help: 'kpi.spend', onClick: () => nav('/usage?tab=overview') },
  ];
}

/** "Company Health" ring board — the aside of the Overview top board. */
export function CompanyHealth() {
  return (
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
  );
}
