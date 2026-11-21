import { motion, useReducedMotion } from 'motion/react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Crown } from 'lucide-react';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { Tip } from '@/components/ui/Tip';
import { AGENT_BY_ID } from '@/data/agents';
import { INSTANCE_STATE } from '@/data/roles';
import type { EdgeKind, Mission, MissionEdge, MissionNode } from '@/data/types';
import { cx } from '@/lib/format';

/*
 * Compact hierarchy graph for the Mission agents pane (owner 2026-11-20 (e): "there is no way to view the hierarchy graph" in Conversations).
 * Tidy tree: GM on top, delegates below, parents centered over their teams. Delegation links flow while the child is working;
 * consult / verify / mentor links are colored dotted arcs. The whole graph scales down to fit the pane width.
 */

const W = 70, H = 74, GX = 8, GY = 38, AV = 36;
const NODE_BOTTOM = 70; // avatar 44 + name + progress bar: links leave below the bar, never through the name
const LINK: Record<Exclude<EdgeKind, 'reports'>, { color: string; label: string }> = {
  delegated: { color: 'var(--accent-2)', label: 'delegates' },
  consults: { color: 'var(--info)', label: 'consults' },
  verifies: { color: 'var(--good)', label: 'verifies' },
  mentors: { color: 'var(--gold)', label: 'mentors' },
};

const stateTone = (s: string) => (s === 'working' ? 'good' : s === 'waiting' ? 'warn' : s === 'blocked' ? 'bad' : s === 'done' ? 'violet' : 'info') as 'good' | 'warn' | 'bad' | 'violet' | 'info';

function layout(nodes: MissionNode[]) {
  const kids: Record<string, MissionNode[]> = {};
  nodes.forEach((n) => { if (n.parent) (kids[n.parent] ??= []).push(n); });
  const pos: Record<string, { x: number; y: number }> = {};
  let leaf = 0;
  const walk = (n: MissionNode, d: number): number => {
    const ch = kids[n.instanceId] ?? [];
    const x = ch.length ? (() => { const xs = ch.map((c) => walk(c, d + 1)); return (xs[0] + xs[xs.length - 1]) / 2; })() : (leaf++) * (W + GX);
    pos[n.instanceId] = { x, y: d * (H + GY) };
    return x;
  };
  const ids = new Set(nodes.map((n) => n.instanceId));
  nodes.filter((n) => !n.parent || !ids.has(n.parent)).forEach((r) => walk(r, 0));
  const ps = Object.values(pos);
  if (!ps.length) return { pos, w: W, h: H };
  return { pos, w: Math.max(...ps.map((p) => p.x)) + W, h: Math.max(...ps.map((p) => p.y)) + H };
}

export function MiniHierarchy({ m, nodes, edges, agentId, onSelect }: { m: Mission; nodes: MissionNode[]; edges: MissionEdge[]; agentId: string; onSelect: (id: string) => void }) {
  const reduce = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  const { pos, w, h } = useMemo(() => layout(nodes), [nodes]);
  const byInst = useMemo(() => Object.fromEntries(nodes.map((n) => [n.instanceId, n])), [nodes]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAvail(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const k = avail ? Math.min(1, avail / w) : 1;

  // anchor points: bottom / top of the avatar, side links curve between avatar centers
  const cx0 = (id: string) => pos[id].x + W / 2;
  const links = edges.filter((e) => e.kind !== 'reports' && pos[e.from] && pos[e.to]).map((e) => {
    const a = pos[e.from], b = pos[e.to];
    let d: string;
    if (e.kind === 'delegated') {
      const x1 = cx0(e.from), y1 = a.y + NODE_BOTTOM, x2 = cx0(e.to), y2 = b.y - 2, my = (y1 + y2) / 2;
      d = `M${x1} ${y1} C${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
    } else {
      const x1 = cx0(e.from), y1 = a.y + AV / 2, x2 = cx0(e.to), y2 = b.y + AV / 2;
      const lift = Math.max(18, Math.abs(x2 - x1) * .35);
      d = `M${x1} ${y1} C${x1} ${y1 - lift}, ${x2} ${y2 - lift}, ${x2} ${y2}`;
    }
    const live = byInst[e.to]?.state === 'working' || byInst[e.from]?.state === 'working';
    return { e, d, live };
  });
  const kinds = [...new Set(links.map((l) => l.e.kind as keyof typeof LINK))];

  return (
    <div className="mini-hier" ref={box}>
      <div className="mini-hier-stage" style={{ width: w * k, height: h * k }}>
        <div style={{ width: w, height: h, transform: `scale(${k})`, transformOrigin: '0 0', position: 'relative' }}>
          <svg width={w} height={h} className="mini-hier-links" aria-hidden>
            {links.map(({ e, d, live }, i) => {
              const st = LINK[e.kind as keyof typeof LINK];
              const sel = AGENT_BY_ID[byInst[e.from]?.agentId]?.id === agentId || AGENT_BY_ID[byInst[e.to]?.agentId]?.id === agentId;
              return (
                <g key={i}>
                  <motion.path d={d} fill="none" stroke={st.color} strokeWidth={e.kind === 'delegated' ? 1.6 : 1.2} strokeLinecap="round"
                    strokeDasharray={e.kind === 'delegated' ? '5 4' : '1.5 4'} opacity={sel ? 1 : e.kind === 'delegated' ? .7 : .55}
                    initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: sel ? 1 : e.kind === 'delegated' ? .7 : .55 }}
                    transition={{ delay: .1 + i * .04, duration: .5 }}
                    style={{ filter: sel ? `drop-shadow(0 0 3px ${st.color})` : undefined }} />
                  {live && !reduce && e.kind === 'delegated' && (
                    <path d={d} fill="none" stroke={st.color} strokeWidth={1.6} strokeDasharray="5 4" className="mini-hier-flow" />
                  )}
                </g>
              );
            })}
          </svg>
          {nodes.map((n, i) => {
            const a = AGENT_BY_ID[n.agentId];
            if (!a) return null;
            const p = pos[n.instanceId];
            const sel = a.id === agentId;
            return (
              <Tip key={n.instanceId} label={<><b>{a.name}</b> · {INSTANCE_STATE[n.state].label}<br /><span className="dim">{n.task}</span></>}>
                <motion.button type="button" role="option" aria-selected={sel} aria-label={`${a.name}, ${INSTANCE_STATE[n.state].label}`}
                  className={cx('mini-node', sel && 'selected')} style={{ left: p.x, top: p.y, width: W }} onClick={() => onSelect(a.id)}
                  initial={{ opacity: 0, scale: .7 }} animate={{ opacity: 1, scale: 1 }} whileHover={{ y: -2 }}
                  transition={{ delay: i * .04, type: 'spring', stiffness: 420, damping: 26 }}>
                  <span className="mini-node-av">
                    {sel && <motion.span layoutId={`mini-hier-sel-${m.id}`} className="mini-node-ring" transition={{ type: 'spring', stiffness: 480, damping: 36 }} />}
                    <RobotAvatar role={a.role} size={AV} status={stateTone(n.state)} animated={sel} />
                    {n.agentId === m.leadId && <Crown size={12} className="warn mini-node-crown" />}
                    {n.pending > 0 && <span className="badge mini-node-badge">{n.pending}</span>}
                  </span>
                  <span className="mini-node-name ellipsis">{a.name}</span>
                  <span className="mini-node-bar" style={{ ['--h' as string]: INSTANCE_STATE[n.state].hue }}><i style={{ width: `${n.progress}%` }} /></span>
                </motion.button>
              </Tip>
            );
          })}
        </div>
      </div>
      <div className="mini-hier-legend" aria-label="Link legend">
        {kinds.map((kd) => <span key={kd}><svg width="16" height="6" aria-hidden><line x1="1" y1="3" x2="15" y2="3" stroke={LINK[kd].color} strokeWidth="1.6" strokeDasharray={kd === 'delegated' ? '5 3' : '1.5 3'} strokeLinecap="round" /></svg>{LINK[kd].label}</span>)}
      </div>
    </div>
  );
}
