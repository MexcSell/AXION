import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Layers, Building2, Plus, AlertTriangle, Crown, Briefcase, CheckCircle2, XCircle, RotateCcw, GitCommitHorizontal, Loader, Hourglass } from 'lucide-react';
import { DEPT_MIN_SAMPLE, type DepartmentFacts, type ScorecardWindow } from '@contracts';
import { Panel } from '@/components/ui/Panel';
import { Segmented, Switch } from '@/components/ui/Form';
import { DemoTag } from '@/components/ui/Chips';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Tip } from '@/components/ui/Tip';
import { EmptyState } from '@/components/ui/EmptyState';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { useCanEditAgents } from '@/hooks/useCanEditAgents';
import { useAgentsCatalog } from '@/api/agents';
import { useDepartments } from '@/api/departments';
import { AGENT_BY_ID } from '@/data/agents';
import { DEPTS, DEPT_BY_NAME } from '@/data/orgdemo';
import { ROLES } from '@/data/roles';
import { openDialog, toast } from '@/store/ui';
import { agoFromTs, cx } from '@/lib/format';
import '@/theme/pages/c06-departments.css';

/**
 * Agents › Departments in api mode (improvement cycle 6): every number on a card is a count the server recorded for the
 * missions you can see (GET /departments), each with its sample and window. The prototype capacity ring, skill coverage
 * and KPI deltas are not shown here (they stay in demo mode). Re-read live on instance/task/org/agent/mission events.
 */
const WINDOW_LABEL: Record<ScorecardWindow, string> = { '7d': 'last 7 days', '30d': 'last 30 days', '90d': 'last 90 days' };
const MAX_AVATARS = 6;

export function ServerDepartments() {
  useAgentsCatalog(); // names and roles of members (and DEPTS for hue and charter)
  const canEdit = useCanEditAgents();
  const [win, setWin] = useState<ScorecardWindow>('30d');
  const [demo, setDemo] = useState(false);
  const { data, error } = useDepartments(win, demo);
  const shown = data && data.window === win && data.includeDemo === demo ? data : null;
  const order = (n: string) => { const i = DEPTS.findIndex((d) => d.name === n); return i < 0 ? DEPTS.length : i; };
  const list = shown ? [...shown.departments].sort((a, b) => order(a.name) - order(b.name) || (a.name < b.name ? -1 : 1)) : [];
  return (
    <Panel icon={Building2} titleSize="lg" title="Departments" help="dept.api" delay={.05}
      sub="Members, head, staffing and task outcomes, counted by the server from missions you can see."
      actions={<div className="row dpa-actions" data-departments={shown ? 'ready' : error ? 'error' : 'loading'} data-window={win} data-demo={demo ? '1' : '0'}>
        <AnimatePresence>{demo && <motion.span key="demo" initial={{ opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .8 }}><DemoTag title="DEMO missions and simulated tasks are included in these counts" /></motion.span>}</AnimatePresence>
        <label className="row sc-demo"><span>include DEMO</span><Switch checked={demo} onChange={setDemo} label="Include DEMO missions" /></label>
        <button className="btn sm" data-six-dimensions onClick={() => openDialog('six-dimensions')}><Layers size={14} />Six dimensions</button>
        <Segmented size="sm" ariaLabel="Outcome window" value={win} onChange={setWin} options={(['7d', '30d', '90d'] as const).map((k) => ({ key: k, label: k, title: WINDOW_LABEL[k] }))} />
        {canEdit && <button className="btn primary" onClick={() => openDialog('department-create')}><Plus size={15} />New department</button>}
      </div>}>
      {!shown ? <div className="dim dpa-empty" data-state={error ? 'error' : 'loading'}>{error ?? 'Counting department facts…'}</div>
        : list.length === 0 ? <EmptyState icon={Building2} title="No departments" body="Departments come from the agents' catalog department." />
          : <div className="oa-dept-grid">{list.map((d, i) => <DeptCard key={d.name} d={d} i={i} win={win} demo={demo} canEdit={canEdit} />)}</div>}
    </Panel>
  );
}

function DeptCard({ d, i, win, demo, canEdit }: { d: DepartmentFacts; i: number; win: ScorecardWindow; demo: boolean; canEdit: boolean }) {
  const nav = useNavigate();
  const meta = DEPT_BY_NAME[d.name];
  const hue = meta?.hue ?? 210;
  const R = ROLES[meta?.role ?? 'manager'] ?? ROLES.manager;
  const head = d.headAgentId ? AGENT_BY_ID[d.headAgentId] : undefined;
  const members = d.memberIds.length;
  const o = d.outcomes;
  const few = o.n < DEPT_MIN_SAMPLE;
  const scope = `${WINDOW_LABEL[win]} · missions you can see${demo ? ' · DEMO included' : ''}`;
  return (
    <motion.article className="subpanel glass-card hoverable oa-dcard dpa-card" style={{ ['--h' as string]: hue }} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .05 }}
      data-dept={d.name} data-staffed={d.staffedAgents} data-missions={d.activeMissions} data-members={members} data-head={d.headAgentId ?? ''}
      data-open={`${d.openTasks.running}/${d.openTasks.waiting}/${d.openTasks.failed}`} data-outcomes-n={o.n} data-org-rev={d.lastOrgChange?.revision ?? ''}>
      <div className="row" style={{ gap: 10 }}>
        <span className="oa-hex lg"><R.icon size={22} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <Tip label={d.evidence}><b className="display ellipsis" style={{ fontSize: 17, display: 'block' }}>{d.name}</b></Tip>
          <div className="dpa-members" aria-label={`${members} ${members === 1 ? 'member' : 'members'}`}>
            {d.memberIds.slice(0, MAX_AVATARS).map((id, k) => (
              <Tip key={id} label={AGENT_BY_ID[id]?.name ?? id}>
                <motion.button className="dpa-av" onClick={() => nav(`/agents/${id}`)} aria-label={AGENT_BY_ID[id]?.name ?? id} initial={{ opacity: 0, scale: .6 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: .1 + k * .03 }}>
                  <RobotAvatar role={AGENT_BY_ID[id]?.role ?? 'manager'} size={22} />
                </motion.button>
              </Tip>
            ))}
            {members > MAX_AVATARS && <span className="dpa-more">+{members - MAX_AVATARS}</span>}
            <HelpTrigger k="dept.members" />
          </div>
        </div>
        <StaffRing staffed={d.staffedAgents} of={members} hue={hue} />
      </div>
      {d.headAgentId ? (
        <div className="oa-mgr dpa-head" data-head-state={d.gmReports.length > 1 ? 'several' : 'one'}>
          <button className="dpa-head-btn" onClick={() => nav(`/agents/${d.headAgentId}`)} aria-label={`Head: ${head?.name ?? d.headAgentId}`}>
            <RobotAvatar role={head?.role ?? 'manager'} size={30} />
            <div style={{ textAlign: 'left', minWidth: 0 }}><div className="dim" style={{ fontSize: 11 }}><Crown size={11} /> Head</div><b className="ellipsis" style={{ fontSize: 13, display: 'block' }}>{head?.name ?? d.headAgentId}</b></div>
          </button>
          <span className="spacer" />
          {d.gmReports.length > 1 && <Tip label={`${d.gmReports.length} members report to the GM; the head is the one with the most of the department under it.`}><span className="dpa-warn-chip" tabIndex={0}>1 of {d.gmReports.length} → GM</span></Tip>}
          <HelpTrigger k="dept.head" />
        </div>
      ) : (
        <div className="oa-mgr dpa-head dpa-nohead" data-head-state="none"><AlertTriangle size={18} /><b style={{ fontSize: 13 }}>No head</b><span className="dim" style={{ fontSize: 11.5 }}>no member reports to the GM</span><span className="spacer" /><HelpTrigger k="dept.head" /></div>
      )}
      <div className="dpa-facts">
        <div className="dpa-fact" data-fact="staffed">
          <span className="dpa-fl">Staffed<HelpTrigger k="dept.staffed" /></span>
          <span><b className="tnum" data-v="staffed">{d.staffedAgents}</b><span className="dim"> of {members}</span></span>
          <Link to="/missions?filter=active" className="dpa-link" data-v="missions" aria-label={`${d.activeMissions} active missions`}><Briefcase size={11} />{d.activeMissions} {d.activeMissions === 1 ? 'mission' : 'missions'}</Link>
        </div>
        <div className="dpa-fact" data-fact="open">
          <span className="dpa-fl">Open tasks<HelpTrigger k="dept.openTasks" /></span>
          <span className="dpa-open">
            <Tip label="running or verifying"><span className={cx(d.openTasks.running > 0 && 'on')}><Loader size={11} />{d.openTasks.running}</span></Tip>
            <Tip label="waiting for an agent or a person"><span className={cx(d.openTasks.waiting > 0 && 'warn')}><Hourglass size={11} />{d.openTasks.waiting}</span></Tip>
            <Tip label="failed (can be retried)"><span className={cx(d.openTasks.failed > 0 && 'bad')}><XCircle size={11} />{d.openTasks.failed}</span></Tip>
          </span>
          <span className="dim dpa-sub">now</span>
        </div>
        <div className="dpa-fact" data-fact="outcomes">
          <span className="dpa-fl">Outcomes<HelpTrigger k="dept.outcomes" /></span>
          <Tip label={<span>{d.evidence}<br /><span className="dim">{scope}</span></span>}>
            <span className="dpa-open">
              <span className={cx(o.passed > 0 && 'good')}><CheckCircle2 size={11} />{o.passed}</span>
              <span className={cx(o.failed > 0 && 'bad')}><XCircle size={11} />{o.failed}</span>
              <span><RotateCcw size={11} />{o.retried}</span>
            </span>
          </Tip>
          <span className="dim dpa-sub"><span className="tnum" data-v="n">n={o.n}</span> · {win}{few && <em className="dpa-few"> · too few to rate</em>}</span>
        </div>
      </div>
      <div className="row dpa-foot">
        <Tip label={d.lastOrgChange ? `Org revision ${d.lastOrgChange.revision}, ${new Date(d.lastOrgChange.at).toLocaleString()}` : 'No reporting line of this department has been recorded'}>
          <span className="dim dpa-rev" data-v="org"><GitCommitHorizontal size={12} />{d.lastOrgChange ? <>rev {d.lastOrgChange.revision} · {agoFromTs(Date.parse(d.lastOrgChange.at))}</> : 'no org change'}</span>
        </Tip>
        <HelpTrigger k="dept.lastOrgChange" />
        <span className="dpa-btns">
          {canEdit && <button className="btn sm" onClick={() => openDialog('department-create', { dept: d.name })}>Edit draft</button>}
          <button className="btn sm ghost" onClick={() => toast({ tone: 'info', title: `Assign manager for ${d.name} (demo)`, body: 'Manager changes are proposals: they appear in Proposals for review.' })}>Assign manager</button>
        </span>
      </div>
    </motion.article>
  );
}

/** Staffed members out of all members, as counts (no percentage is shown). */
function StaffRing({ staffed, of, hue }: { staffed: number; of: number; hue: number }) {
  const size = 54, stroke = 6, r = (size - stroke) / 2 - 2, c = 2 * Math.PI * r;
  const frac = of > 0 ? Math.min(1, staffed / of) : 0;
  return (
    <Tip label={`${staffed} of ${of} members staffed on active missions now`}>
      <div className="dpa-ring" role="img" aria-label={`${staffed} of ${of} members staffed`} style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--panel-3)" strokeWidth={stroke} />
          <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`hsl(${hue} 90% 62%)`} strokeWidth={stroke} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`}
            strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - frac) }} transition={{ duration: 1, ease: [0.2, 0.8, 0.2, 1] }} />
        </svg>
        <div className="dpa-ring-t"><b className="tnum">{staffed}</b><span>/{of}</span></div>
      </div>
    </Tip>
  );
}
