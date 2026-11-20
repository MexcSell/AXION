import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { List, Network, FileCheck2, Weight } from 'lucide-react';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Segmented } from '@/components/ui/Form';
import { TaskStateChip } from '@/components/ui/Chips';
import { AGENT_BY_ID } from '@/data/agents';
import { TASK_STATE, TONE_VAR } from '@/data/roles';
import { getMissionControl } from '@/data/missions';
import type { Mission, Task } from '@/data/types';
import { openDialog } from '@/store/ui';
import { cx } from '@/lib/format';

const CW = 200, CH = 98, GX = 64, GY = 18;

/** Executable task DAG with dependency arrows and verified-weight progress (spec §4.4 Task Flow). */
export function TaskFlow({ mission }: { mission: Mission }) {
  const mc = getMissionControl(mission);
  const [mode, setMode] = useState<'dag' | 'list'>('dag');
  const tasks = mc.tasks;
  const byId = useMemo(() => Object.fromEntries(tasks.map((t) => [t.id, t])), [tasks]);
  const cols = Math.max(...tasks.map((t) => t.col)) + 1;
  const rows = Math.max(...tasks.map((t) => t.row)) + 1;
  const W = cols * CW + (cols - 1) * GX, H = rows * CH + (rows - 1) * GY;
  const xy = (t: Task) => ({ x: t.col * (CW + GX), y: t.row * (CH + GY) });
  const totalW = tasks.reduce((s, t) => s + t.weight, 0);
  const verW = tasks.filter((t) => t.state === 'passed').reduce((s, t) => s + t.weight, 0);
  const pctV = Math.round((verW / totalW) * 100);

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="formula">
          <span className="dim">Verified progress =</span>
          <b className="good">{verW}</b><span className="dim">verified weight ÷</span><b>{totalW}</b><span className="dim">planned weight =</span>
          <b className="display" style={{ fontSize: 18, color: 'var(--accent-2)' }}>{pctV}%</b>
          <HelpTrigger k="mission.progress.verified" />
        </div>
        <span className="spacer" />
        <div className="row wrap" style={{ gap: 8, fontSize: 11.5 }}>
          {(['passed', 'running', 'verifying', 'waiting-user', 'ready', 'queued', 'failed'] as const).map((s) => (
            <span key={s} className="row" style={{ gap: 4 }}><span className="dot sm" style={{ color: TONE_VAR[TASK_STATE[s].tone] }} />{TASK_STATE[s].label}</span>
          ))}
        </div>
        <Segmented ariaLabel="DAG or list" size="sm" value={mode} onChange={setMode} options={[{ key: 'dag', label: <><Network size={13} />Graph</> }, { key: 'list', label: <><List size={13} />List</> }]} />
      </div>
      {mode === 'dag' ? (
        <div className="dag-wrap">
          <div style={{ position: 'relative', width: W, height: H, margin: '10px auto' }}>
            <svg width={W} height={H} style={{ position: 'absolute', inset: 0, overflow: 'visible' }} aria-hidden>
              <defs><marker id="dag-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="var(--border-strong)" /></marker>
                <marker id="dag-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="var(--good)" /></marker></defs>
              {tasks.flatMap((t) => t.deps.map((d) => {
                const a = byId[d]; if (!a) return null;
                const p1 = xy(a), p2 = xy(t);
                const x1 = p1.x + CW, y1 = p1.y + CH / 2, x2 = p2.x - 2, y2 = p2.y + CH / 2;
                const done = a.state === 'passed';
                return (
                  <motion.path key={d + t.id} d={`M${x1} ${y1} C${x1 + GX / 2} ${y1}, ${x2 - GX / 2} ${y2}, ${x2} ${y2}`} fill="none"
                    stroke={done ? 'var(--good)' : 'var(--border-strong)'} strokeWidth={done ? 2 : 1.5} strokeDasharray={done ? undefined : '5 5'}
                    markerEnd={done ? 'url(#dag-arrow-on)' : 'url(#dag-arrow)'} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: .7, delay: .2 + t.col * .15 }}
                    style={done ? { filter: 'drop-shadow(0 0 4px rgba(var(--good-rgb),.7))' } : undefined} />
                );
              }))}
            </svg>
            {tasks.map((t, i) => {
              const p = xy(t);
              const owner = AGENT_BY_ID[t.owner];
              const st = TASK_STATE[t.state];
              return (
                <motion.button key={t.id} className={cx('dag-card', `ts-${t.state}`)} style={{ left: p.x, top: p.y, width: CW, height: CH, ['--tone' as string]: TONE_VAR[st.tone] }}
                  initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: t.col * .12 + i * .02 }}
                  onClick={() => openDialog('task-criteria', { missionId: mission.id, taskId: t.id })} aria-label={`${t.id} ${t.title}, ${st.label}`}>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="mono dim" style={{ fontSize: 10.5 }}>{t.id}</span>
                    <span className="spacer" />
                    <span className="row dim" style={{ gap: 2, fontSize: 10.5 }} title="Weight"><Weight size={10} />{t.weight}</span>
                    {t.evidence > 0 && <span className="row good" style={{ gap: 2, fontSize: 10.5 }} title="Evidence items"><FileCheck2 size={10} />{t.evidence}</span>}
                  </div>
                  <div className="dag-title ellipsis">{t.title}</div>
                  <div className="row" style={{ gap: 6 }}>
                    {owner && <RobotAvatar role={owner.role} size={22} />}
                    <span className="ellipsis dim" style={{ fontSize: 11, flex: 1, textAlign: 'left' }}>{owner?.name}</span>
                    <TaskStateChip state={t.state} size="sm" />
                  </div>
                  {t.state === 'running' && <span className="dag-run" />}
                </motion.button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Task</th><th>Title</th><th>Owner</th><th>Depends on</th><th>Weight</th><th>Evidence</th><th>State</th></tr></thead>
            <tbody>{tasks.map((t) => (
              <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => openDialog('task-criteria', { missionId: mission.id, taskId: t.id })}>
                <td className="mono">{t.id}</td><td>{t.title}</td><td>{AGENT_BY_ID[t.owner]?.name}</td><td className="mono dim">{t.deps.join(', ') || '—'}</td><td>{t.weight}</td><td>{t.evidence}</td><td><TaskStateChip state={t.state} size="sm" /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
