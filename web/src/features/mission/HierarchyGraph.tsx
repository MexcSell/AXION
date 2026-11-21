import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Network, List, Radio, MessageSquare, Move } from 'lucide-react';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { IconButton } from '@/components/ui/IconButton';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Segmented, Switch } from '@/components/ui/Form';
import { DemoTag, InstanceStateChip } from '@/components/ui/Chips';
import { AGENT_BY_ID } from '@/data/agents';
import { ROLES } from '@/data/roles';
import type { EdgeKind, Mission, MissionEdge, MissionNode } from '@/data/types';
import { getMissionControl } from '@/data/missions';
import { useLive } from './live';
import { isApi } from '@/api/mode';
import { useMissionControl } from '@/api/missionControl';
import { usePartStatus } from './PartStatus';
import { cx, clock } from '@/lib/format';

const NODE_W = 172, NODE_H = 128, GAP_X = 26, GAP_Y = 96;

/** Links are dotted lines: dead black when idle, colored + flowing (source → target) while data is transmitted. */
const EDGE_STYLE: Record<EdgeKind, { color: string; label: string }> = {
  delegated: { color: 'var(--accent-2)', label: 'delegated' },
  reports: { color: 'var(--violet)', label: 'reports to' },
  consults: { color: 'var(--info)', label: 'consults' },
  verifies: { color: 'var(--good)', label: 'verifies' },
  mentors: { color: 'var(--gold)', label: 'mentors' },
};

interface Pos { x: number; y: number; depth: number; }

/** Tidy-tree layout: leaves spaced evenly, parents centered over children. */
function layout(nodes: MissionNode[]) {
  const kids: Record<string, MissionNode[]> = {};
  nodes.forEach((n) => { if (n.parent) (kids[n.parent] ??= []).push(n); });
  const ids = new Set(nodes.map((n) => n.instanceId));
  // roots: no manager, or a manager not in this mission's list (never drop a node from the drawing)
  const roots = nodes.filter((n) => !n.parent || !ids.has(n.parent));
  const pos: Record<string, Pos> = {};
  if (!roots.length) return { pos, w: NODE_W, h: NODE_H };
  let leaf = 0;
  const walk = (n: MissionNode, depth: number): number => {
    const ch = kids[n.instanceId] ?? [];
    let x: number;
    if (!ch.length) { x = leaf * (NODE_W + GAP_X); leaf++; }
    else { const xs = ch.map((c) => walk(c, depth + 1)); x = (xs[0] + xs[xs.length - 1]) / 2; }
    pos[n.instanceId] = { x, y: depth * (NODE_H + GAP_Y), depth };
    return x;
  };
  for (const r of roots) walk(r, 0);
  const maxX = Math.max(...Object.values(pos).map((p) => p.x)) + NODE_W;
  const maxY = Math.max(...Object.values(pos).map((p) => p.y)) + NODE_H;
  return { pos, w: maxX, h: maxY };
}

function edgePath(e: MissionEdge, pos: Record<string, Pos>) {
  const a = pos[e.from], b = pos[e.to];
  if (!a || !b) return '';
  if (e.kind === 'delegated') {
    const x1 = a.x + NODE_W / 2 - 10, y1 = a.y + NODE_H, x2 = b.x + NODE_W / 2 - 10, y2 = b.y;
    const my = (y1 + y2) / 2;
    return `M${x1} ${y1} C${x1} ${my}, ${x2} ${my}, ${x2} ${y2 - 4}`;
  }
  if (e.kind === 'reports') {
    const x1 = a.x + NODE_W / 2 + 10, y1 = a.y, x2 = b.x + NODE_W / 2 + 10, y2 = b.y + NODE_H;
    const my = (y1 + y2) / 2;
    return `M${x1} ${y1} C${x1} ${my}, ${x2} ${my}, ${x2} ${y2 + 4}`;
  }
  // lateral / cross edges: arc above/below
  const sameRow = Math.abs(a.y - b.y) < 2;
  if (sameRow) {
    const left = a.x < b.x;
    const x1 = left ? a.x + NODE_W : a.x, x2 = left ? b.x : b.x + NODE_W;
    const y = a.y + NODE_H * (e.kind === 'consults' ? 0.42 : 0.7);
    const bend = e.kind === 'consults' ? -18 : 18;
    return `M${x1} ${y} C${(x1 + x2) / 2} ${y + bend}, ${(x1 + x2) / 2} ${y + bend}, ${x2 + (left ? -4 : 4)} ${y}`;
  }
  const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x + NODE_W, y2 = b.y + NODE_H / 2;
  const cx = Math.max(x1, x2) + 50;
  return `M${x1} ${y1} C${cx} ${y1}, ${cx} ${y2}, ${x2 + 4} ${y2}`;
}

type GraphProps = { mission: Mission; selected?: string; onSelect: (agentId: string) => void; onOpenChat?: (agentId: string) => void };
export function HierarchyGraph(props: GraphProps) {
  const status = usePartStatus(props.mission.id, 'hierarchy', 'the hierarchy');
  return status ?? <HierarchyGraphView {...props} />;
}

function HierarchyGraphView({ mission, selected, onSelect, onOpenChat }: GraphProps) {
  useMissionControl(mission.id, ['hierarchy']);
  const mc = getMissionControl(mission);
  const { pos, w, h } = useMemo(() => layout(mc.nodes), [mc.nodes]);
  const pad = 40;
  const vw = w + pad * 2 + 60, vh = h + pad * 2;
  const wrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [mode, setMode] = useState<'graph' | 'list'>('graph');
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const reduce = useReducedMotion();
  const pulses = useLive((s) => s.pulses);
  const simulate = useLive((s) => s.simulate);
  const setSimulate = useLive((s) => s.setSimulate);
  const emit = useLive((s) => s.emit);
  const lines = useLive((s) => s.lines).filter((l) => l.missionId === mission.id).slice(0, 3);

  const fit = () => {
    const el = wrap.current; if (!el) return;
    const k = Math.min(1.15, (el.clientWidth - 20) / vw, (el.clientHeight - 20) / vh);
    setView({ k, x: (el.clientWidth - vw * k) / 2, y: (el.clientHeight - vh * k) / 2 });
  };
  useLayoutEffect(fit, [vw, vh, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const ro = new ResizeObserver(fit); if (wrap.current) ro.observe(wrap.current); return () => ro.disconnect(); }, [vw, vh]); // eslint-disable-line react-hooks/exhaustive-deps

  // DEMO live simulation: emit a real-direction pulse every few seconds
  // api mode: only DEMO missions get the invented pulses; a real mission shows only what the server reports
  const active = !['completed', 'archived', 'paused', 'draft', 'failed'].includes(mission.status) && (!isApi() || !!mission.demo);
  useEffect(() => {
    if (!simulate || !active || mc.edges.length === 0) return;
    const name = (inst: string) => AGENT_BY_ID[mc.nodes.find((n) => n.instanceId === inst)?.agentId ?? '']?.name ?? '?';
    let i = 0;
    const t = window.setInterval(() => {
      if (document.hidden) return;
      const e = mc.edges[(i * 7 + 3) % mc.edges.length];
      i++;
      const verb = { delegated: 'delegated a subtask to', reports: 'reported progress to', consults: 'consulted', verifies: 'verified evidence from', mentors: 'coached' }[e.kind];
      emit(mission.id, e.from, e.to, e.kind, `${name(e.from)} ${verb} ${name(e.to)}`);
    }, 3200);
    return () => window.clearInterval(t);
  }, [simulate, active, mission.id, mc.edges, mc.nodes, emit]);

  /* zoom by factor f toward a point in canvas coordinates (default: center) */
  const zoomAt = (f: number, px?: number, py?: number) => setView((v) => {
    const el = wrap.current; if (!el) return v;
    const cx = px ?? el.clientWidth / 2, cy = py ?? el.clientHeight / 2;
    const k = Math.max(.35, Math.min(2.2, v.k * f));
    return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
  });
  const zoom = (f: number) => zoomAt(f);

  /* mouse-wheel zoom toward the pointer — native non-passive listener so the page never scrolls */
  useEffect(() => {
    const el = wrap.current; if (!el || mode !== 'graph') return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const b = el.getBoundingClientRect();
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * el.clientHeight : e.deltaY;
      // trackpad pinch arrives as ctrl+wheel with small deltas → boost its sensitivity
      zoomAt(Math.exp(-d * (e.ctrlKey ? 0.01 : 0.0016)), e.clientX - b.left, e.clientY - b.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedInst = mc.nodes.find((n) => n.agentId === selected)?.instanceId;
  const nodeMap = Object.fromEntries(mc.nodes.map((n) => [n.instanceId, n]));

  return (
    <div className="hgraph">
      <div className="hgraph-bar">
        <span className="section-label" style={{ color: 'var(--accent-2)' }}>Live organization</span>
        <span className="dim hg-count" style={{ fontSize: 12 }}>{mc.nodes.length} agent instances · {mc.edges.length} links</span>
        <HelpTrigger k="hierarchy.delegation" />
        <span className="spacer" />
        <label className="row" style={{ gap: 6, fontSize: 12 }} title="Simulated events for this prototype">
          <Radio size={14} className={simulate && active ? 'good' : 'dim'} /> Live events <DemoTag />
          <Switch checked={simulate} onChange={setSimulate} label="Simulate live events" />
        </label>
        <Segmented ariaLabel="Graph or list" size="sm" value={mode} onChange={setMode} options={[{ key: 'graph', label: <><Network size={13} />Graph</> }, { key: 'list', label: <><List size={13} />List</> }]} />
        {mode === 'graph' && <>
          <IconButton icon={ZoomOut} label="Zoom out" size="sm" onClick={() => zoom(1 / 1.2)} />
          <IconButton icon={ZoomIn} label="Zoom in" size="sm" onClick={() => zoom(1.2)} />
          <IconButton icon={Maximize2} label="Fit to view" size="sm" onClick={fit} />
        </>}
      </div>

      {mode === 'list' ? (
        <div className="hlist" role="list" aria-label="Hierarchy relationships">
          {mc.edges.map((e, i) => {
            const a = AGENT_BY_ID[nodeMap[e.from]?.agentId], b = AGENT_BY_ID[nodeMap[e.to]?.agentId];
            if (!a || !b) return null;
            return (
              <motion.div key={i} role="listitem" className="list-row" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * .02 }}>
                <RobotAvatar role={a.role} size={26} /><button className="btn ghost sm" onClick={() => onSelect(a.id)}>{a.name}</button>
                <span className="chip sm" style={{ ['--h' as string]: e.kind === 'delegated' ? 190 : e.kind === 'reports' ? 268 : e.kind === 'verifies' ? 145 : e.kind === 'mentors' ? 45 : 210 }}>{EDGE_STYLE[e.kind].label} →</span>
                <RobotAvatar role={b.role} size={26} /><button className="btn ghost sm" onClick={() => onSelect(b.id)}>{b.name}</button>
                <span className="spacer" /><span className="dim ellipsis" style={{ fontSize: 12, maxWidth: 260 }}>{nodeMap[e.to].task}</span>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div
          ref={wrap}
          className="hgraph-canvas"
          onPointerDown={(e) => { if ((e.target as HTMLElement).closest('.hnode')) return; drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => { const d = drag.current; if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y })); }}
          onPointerUp={() => { drag.current = null; }}
        >
          <div className="hg-hint" aria-hidden><Move size={12} />Scroll to zoom · drag to pan · {Math.round(view.k * 100)}%</div>
          <div className="hgraph-world" style={{ width: vw, height: vh, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
            <svg width={vw} height={vh} className="hgraph-svg" aria-hidden>
              <defs>
                <filter id="hg-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
              </defs>
              <g transform={`translate(${pad} ${pad})`}>
                {mc.edges.map((e, i) => {
                  const st = EDGE_STYLE[e.kind];
                  const d = edgePath(e, pos);
                  const hot = pulses.some((p) => p.from === e.from && p.to === e.to && p.kind === e.kind);
                  const touchesSel = !!selectedInst && (e.from === selectedInst || e.to === selectedInst);
                  return (
                    <motion.g key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .6, delay: .2 + i * .04 }}>
                      {/* idle: dead black dotted line */}
                      <path d={d} className={cx('hg-edge', touchesSel && 'sel')} />
                      {/* transmitting: colored dots flowing from source to target */}
                      <motion.path d={d} className={cx('hg-edge-flow', !reduce && 'run')} stroke={st.color} filter="url(#hg-glow)"
                        initial={false} animate={{ opacity: hot ? 1 : 0 }} transition={{ duration: hot ? .25 : .6 }} />
                      {e.kind === 'delegated' && <EdgeLabel d={d} text={`${nodeMap[e.to]?.tasks ?? 1} tasks`} />}
                    </motion.g>
                  );
                })}
              </g>
            </svg>
            {mc.nodes.map((n, i) => {
              const p = pos[n.instanceId];
              const a = AGENT_BY_ID[n.agentId];
              if (!p || !a) return null;
              const sel = n.agentId === selected;
              const hot = pulses.some((x) => x.to === n.instanceId);
              return (
                <motion.div
                  key={n.instanceId}
                  className={cx('hnode', sel && 'selected', hot && 'hot', `st-${n.state}`)}
                  style={{ left: p.x + pad, top: p.y + pad, width: NODE_W, height: NODE_H, ['--h' as string]: ROLES[a.role].hue }}
                  initial={{ opacity: 0, scale: .8, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ delay: p.depth * .12 + i * .03, type: 'spring', stiffness: 260, damping: 22 }}
                  role="button"
                  data-agent={n.agentId}
                  data-parent={n.parent ? nodeMap[n.parent]?.agentId ?? '' : ''}
                  tabIndex={0}
                  aria-pressed={sel}
                  aria-label={`${a.name}, ${ROLES[a.role].label}, ${n.state}, task: ${n.task}`}
                  onClick={() => onSelect(a.id)}
                  onDoubleClick={() => onOpenChat?.(a.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(a.id); } }}
                >
                  {sel && <motion.span layoutId={`hsel-${mission.id}`} className="hnode-halo" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
                  <div className="hnode-top">
                    <RobotAvatar role={a.role} size={46} faceMode="face" status={n.state === 'working' ? 'good' : n.state === 'waiting' ? 'warn' : n.state === 'blocked' ? 'bad' : n.state === 'done' ? 'violet' : 'info'} animated={sel} />
                    <div style={{ minWidth: 0 }}>
                      <div className="hnode-name ellipsis">{a.name}</div>
                      <div className="hnode-role ellipsis">{ROLES[a.role].label}</div>
                      <span className="mono dim hnode-ver" style={{ fontSize: 10 }} title={n.versionLabel ? `Pinned to ${a.name} ${n.versionLabel} for this mission` : undefined}>{n.versionLabel ?? a.version}</span>
                    </div>
                    {n.pending > 0 && <span className="badge" style={{ position: 'absolute', top: -6, right: -6 }} aria-label={`${n.pending} pending`}>{n.pending}</span>}
                  </div>
                  <div className="hnode-task ellipsis" title={n.task}>{n.task}</div>
                  <div className="row" style={{ gap: 6 }}>
                    <InstanceStateChip state={n.state} size="sm" />
                    <div className="bar thin" style={{ flex: 1 }}><i style={{ width: `${n.progress}%` }} /></div>
                  </div>
                  {onOpenChat && <button className="hnode-chat" aria-label={`Open chat with ${a.name}`} onClick={(e) => { e.stopPropagation(); onOpenChat(a.id); }}><MessageSquare size={12} /></button>}
                </motion.div>
              );
            })}
          </div>
          <div className="hgraph-legend">
            <span className="row" style={{ gap: 5 }}>
              <svg width="26" height="8"><line x1="2" y1="4" x2="24" y2="4" className="hg-edge" /></svg>idle
            </span>
            {(Object.keys(EDGE_STYLE) as EdgeKind[]).map((k) => (
              <span key={k} className="row" style={{ gap: 5 }}>
                <svg width="26" height="8"><line x1="2" y1="4" x2="24" y2="4" className={cx('hg-edge-flow', !reduce && 'run')} stroke={EDGE_STYLE[k].color} /></svg>
                {EDGE_STYLE[k].label}
              </span>
            ))}
          </div>
          <div className="hgraph-ticker" aria-live="polite">
            {lines.map((l) => (
              <motion.div key={l.id} className="row" style={{ gap: 6 }} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}>
                <span className="mono dim">{clock(0, l.at)}</span>
                <span className="dot sm" style={{ color: EDGE_STYLE[(l.kind in EDGE_STYLE ? l.kind : 'delegated') as EdgeKind].color }} />
                <span className="ellipsis">{l.text}</span>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EdgeLabel({ d, text }: { d: string; text: string }) {
  // midpoint of cubic from the "M x1 y1 C ... x2 y2" string
  const nums = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  if (nums.length < 8) return null;
  const [x1, y1, , , , , x2, y2] = nums;
  const x = (x1 + x2) / 2, y = (y1 + y2) / 2;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={-24} y={-9} width={48} height={18} rx={9} fill="var(--panel-solid)" stroke="var(--border)" />
      <text textAnchor="middle" dominantBaseline="central" fontSize="10" fill="var(--text-muted)" fontWeight="600">{text}</text>
    </g>
  );
}
