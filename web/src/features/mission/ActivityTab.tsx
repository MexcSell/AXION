import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { Cpu, MemoryStick, Clock3, Coins as TokenIcon, GitMerge, MessageSquare, Server, Brain, Wrench, Globe, PenLine, Send, Users, Layers } from 'lucide-react';
import { Link } from 'react-router-dom';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { Sparkline } from '@/components/viz/Charts';
import { Chip } from '@/components/ui/Chips';
import { Tip } from '@/components/ui/Tip';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { IconButton } from '@/components/ui/IconButton';
import { AGENT_BY_ID } from '@/data/agents';
import { ROLES } from '@/data/roles';
import { agentInstances, fmtMb, fmtMin, fmtTokens, missionActivity, type ActivityLogLine, type AgentActivity } from '@/data/activity';
import { useVisibleMissions } from '@/store/data';
import type { Mission } from '@/data/types';
import { executorOf } from './staffing';
import { ago, cx } from '@/lib/format';
import '@/theme/pages/mission-activity.css';

const LOG_ICON: Record<ActivityLogLine['kind'], typeof Brain> = { think: Brain, tool: Wrench, browse: Globe, write: PenLine, merge: GitMerge, message: Send };
const RUNNING = ['running', 'planning', 'verifying', 'waiting'];

/** Live jitter for running missions (DEMO): CPU/RAM wobble, tokens grow, merge countdowns tick. */
function useTick(active: boolean, ms = 2000) {
  const [t, setT] = useState(0);
  useEffect(() => { if (!active) return; const i = window.setInterval(() => setT((x) => x + 1), ms); return () => window.clearInterval(i); }, [active, ms]);
  return t;
}
function live(a: AgentActivity, t: number, running: boolean): AgentActivity {
  if (!running || t === 0) return a;
  const w = Math.sin(t * 1.7 + a.agentId.length) * 0.5 + Math.cos(t * .9 + a.tokens % 7) * 0.5;
  const grow = Math.round(t * (180 + (a.tokens % 400)));
  return {
    ...a, tokens: a.tokens + grow, tokensIn: a.tokensIn + Math.round(grow * .8), tokensOut: a.tokensOut + Math.round(grow * .2),
    activeMin: a.activeMin + Math.floor(t / 30),
    cpu: Math.max(2, Math.min(97, Math.round(a.cpu + w * 12))), ramMb: Math.max(120, Math.round(a.ramMb + w * 90)),
    spark: [...a.spark.slice(t % 4), ...Array.from({ length: t % 4 }, (_, i) => Math.round(400 + Math.abs(Math.sin(t + i)) * 1500))].slice(-16),
    merge: { ...a.merge, nextInMin: Math.max(0, a.merge.nextInMin - Math.floor(t / 30)) },
  };
}

export function ActivityTab({ m, onOpenChat }: { m: Mission; onOpenChat: (agentId: string) => void }) {
  const running = RUNNING.includes(m.status);
  const t = useTick(running);
  const missions = useVisibleMissions();
  const exec = executorOf(m);
  const rows = useMemo(() => missionActivity(m).map((a) => live(a, t, running)), [m, t, running]);
  const tot = rows.reduce((s, a) => ({ tokens: s.tokens + a.tokens, min: s.min + a.activeMin, cpu: s.cpu + a.cpu, ram: s.ram + a.ramMb }), { tokens: 0, min: 0, cpu: 0, ram: 0 });
  const nextMerge = rows.length ? Math.min(...rows.map((r) => r.merge.nextInMin)) : 0;
  const log = useMemo(() => rows.flatMap((a) => a.log.map((l) => ({ ...l, agentId: a.agentId }))).sort((x, y) => x.agoMin - y.agoMin).slice(0, 40), [rows]);
  const [focus, setFocus] = useState<string | null>(null);

  return (
    <div className="act">
      <div className="act-kpis">
        {[
          { i: TokenIcon, l: 'Tokens', v: fmtTokens(tot.tokens), s: `${fmtTokens(rows.reduce((s, a) => s + a.tokensIn, 0))} in · ${fmtTokens(rows.reduce((s, a) => s + a.tokensOut, 0))} out`, c: '#a78bfa' },
          { i: Clock3, l: 'Active time', v: fmtMin(tot.min), s: `${rows.length} agents working`, c: '#22d3ee' },
          { i: Cpu, l: 'CPU now', v: `${rows.length ? Math.round(tot.cpu / rows.length) : 0}%`, s: 'average across agents', c: '#2ee98a' },
          { i: MemoryStick, l: 'RAM now', v: fmtMb(tot.ram), s: 'sum of agent instances', c: '#fbbf24' },
          { i: GitMerge, l: 'Next merge', v: running ? `${nextMerge} min` : '—', s: 'into the original agents', c: '#60a5fa' },
        ].map((k, i) => (
          <motion.div key={k.l} className="kpi act-kpi" style={{ ['--kc' as string]: k.c }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .04 }}>
            <k.i size={22} className="kpi-ico" />
            <div style={{ minWidth: 0 }}><div className="kpi-val tnum" style={{ fontSize: 19 }}>{k.v}</div><div className="kpi-label">{k.l}</div><div className="dim ellipsis" style={{ fontSize: 11 }}>{k.s}</div></div>
          </motion.div>
        ))}
        <HelpTrigger k="mission.activity" />
      </div>

      <div className="act-body">
        <div className="act-cards">
          {rows.map((a, i) => (
            <AgentCardLive key={a.agentId} a={a} i={i} running={running} lead={a.agentId === m.leadId} executor={a.agentId === exec}
              others={agentInstances(a.agentId, missions).filter((x) => x.missionId !== m.id)} focused={focus === a.agentId}
              onFocus={() => setFocus(focus === a.agentId ? null : a.agentId)} onChat={() => onOpenChat(a.agentId)} />
          ))}
        </div>
        <aside className="act-log" aria-label="Activity log">
          <div className="act-log-head"><Layers size={15} className="info" /><b>Activity log</b>{running && <span className="act-live"><i />live</span>}<span className="spacer" />{focus && <button className="btn ghost sm" onClick={() => setFocus(null)}>All agents</button>}</div>
          <div className="act-log-list">
            <AnimatePresence initial={false}>
              {log.filter((l) => !focus || l.agentId === focus).map((l, i) => {
                const I = LOG_ICON[l.kind]; const ag = AGENT_BY_ID[l.agentId];
                return (
                  <motion.div key={l.agentId + l.agoMin + l.text + i} className={cx('act-line', l.kind)} layout initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 12) * .02 }}>
                    <span className="act-line-ico"><I size={13} /></span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="ellipsis"><b>{ag?.name ?? l.agentId}</b> {l.text.toLowerCase()}</div>
                      <div className="dim tnum" style={{ fontSize: 11 }}>{ago(l.agoMin)} · {fmtTokens(l.tokens)} tokens</div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Meter({ icon: I, label, value, max, text, tone }: { icon: typeof Cpu; label: string; value: number; max: number; text: string; tone: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="act-meter" title={`${label}: ${text}`}>
      <I size={13} /><span className="act-meter-l">{label}</span>
      <div className={cx('bar thin', pct > 80 ? 'warn' : tone)} style={{ flex: 1 }}><motion.i animate={{ width: `${pct}%` }} transition={{ duration: .8 }} /></div>
      <b className="tnum">{text}</b>
    </div>
  );
}

function AgentCardLive({ a, i, running, lead, executor, others, focused, onFocus, onChat }: {
  a: AgentActivity; i: number; running: boolean; lead: boolean; executor: boolean; others: AgentActivity[]; focused: boolean; onFocus: () => void; onChat: () => void;
}) {
  const ag = AGENT_BY_ID[a.agentId];
  if (!ag) return null;
  const pctMerge = 1 - a.merge.nextInMin / a.merge.everyMin;
  return (
    <motion.div className={cx('act-card glass-card hoverable', focused && 'selected')} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 10) * .04 }}
      onClick={onFocus} role="button" tabIndex={0} aria-pressed={focused} onKeyDown={(e) => { if (e.key === 'Enter') onFocus(); }}>
      <div className="row" style={{ gap: 10 }}>
        <RobotAvatar role={ag.role} size={42} animated={running} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 6 }}><b className="ellipsis">{ag.name}</b>{lead && <Chip hue={45} size="sm">GM</Chip>}{executor && !lead && <Chip hue={268} size="sm">executor</Chip>}</div>
          <div className="dim ellipsis" style={{ fontSize: 11.5 }}>{ROLES[ag.role].label}</div>
        </div>
        <IconButton size="xs" icon={MessageSquare} label={`Chat with ${ag.name} in this mission`} onClick={(e) => { e.stopPropagation(); onChat(); }} />
      </div>
      <div className={cx('act-now', running && 'on')}><span className="act-now-dot" />{a.action}</div>
      <div className="act-tokens">
        <div><b className="tnum">{fmtTokens(a.tokens)}</b><span className="dim"> tokens</span><div className="dim tnum" style={{ fontSize: 10.5 }}>{fmtTokens(a.tokensIn)} in · {fmtTokens(a.tokensOut)} out · {fmtMin(a.activeMin)} active</div></div>
        <Sparkline data={a.spark} w={96} h={30} color="var(--violet)" />
      </div>
      <Meter icon={Cpu} label="CPU" value={a.cpu} max={100} text={`${a.cpu}%`} tone="good" />
      <Meter icon={MemoryStick} label="RAM" value={a.ramMb} max={2048} text={fmtMb(a.ramMb)} tone="info" />
      <div className="act-foot">
        <Tip label={`Runs on ${a.vm}`}><Link to="/operations?tab=vms" className="act-vm" onClick={(e) => e.stopPropagation()}><Server size={12} />{a.vm}</Link></Tip>
        <Tip label={`Merges this mission's experience into ${ag.name} every ${a.merge.everyMin} min · ${a.merge.pending} lessons waiting · ${a.merge.merged} merged so far`}>
          <span className="act-merge">
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden><circle cx="10" cy="10" r="8" fill="none" stroke="var(--panel-3)" strokeWidth="3" /><motion.circle cx="10" cy="10" r="8" fill="none" stroke="var(--info)" strokeWidth="3" strokeLinecap="round" transform="rotate(-90 10 10)" strokeDasharray={50.3} animate={{ strokeDashoffset: 50.3 * (1 - pctMerge) }} /></svg>
            {running ? <>merge in <b className="tnum">{a.merge.nextInMin}m</b></> : <>{a.merge.merged} merged</>}
          </span>
        </Tip>
        {others.length > 0 && (
          <Tip label={`${ag.name} also works ${others.map((o) => o.missionId).join(', ')} at the same time; every instance merges back into ${ag.name}.`}>
            <span className="act-others"><Users size={12} />+{others.length}</span>
          </Tip>
        )}
      </div>
    </motion.div>
  );
}
