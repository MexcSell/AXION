import { motion } from 'motion/react';
import { useAgentsCatalog } from '@/api/agents';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ZoomIn, ZoomOut, Maximize2, Crown, Move, RotateCcw } from 'lucide-react';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { IconButton } from '@/components/ui/IconButton';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { AGENTS } from '@/data/agents';
import { AGENT_STATUS, ROLES } from '@/data/roles';
import { DEPTS } from '@/data/orgdemo';
import type { Agent } from '@/data/types';
import { cx } from '@/lib/format';
import { GrowthBadge, LevelPips, EvoTrack, GROWTH } from './Growth';

/* ------------------------------------------------------------------ */
/* ZoomCanvas — wheel zooms toward the cursor, drag pans, buttons fit.  */
/* ------------------------------------------------------------------ */
interface View { x: number; y: number; k: number }
const KMIN = 0.3, KMAX = 2.2;
const clampK = (k: number) => Math.min(KMAX, Math.max(KMIN, k));

export function ZoomCanvas({ width, height, children, label }: { width: number; height: number; children: ReactNode; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [v, setV] = useState<View>({ x: 0, y: 0, k: 1 });
  const vRef = useRef(v); vRef.current = v;
  const pan = useRef<{ px: number; py: number; x: number; y: number; id: number } | null>(null);
  const [panning, setPanning] = useState(false);

  /** whole tree on screen */
  const fit = useCallback(() => {
    const el = host.current; if (!el) return;
    const cw = el.clientWidth, ch = el.clientHeight;
    const k = clampK(Math.min((cw - 32) / width, (ch - 32) / height, 1.05));
    setV({ k, x: (cw - width * k) / 2, y: Math.max(12, (ch - height * k) / 2) });
  }, [width, height]);
  /** readable start: fit the width (never below 60%), top aligned — scroll/drag for the rest */
  const fitWidth = useCallback(() => {
    const el = host.current; if (!el) return;
    const cw = el.clientWidth;
    const k = clampK(Math.max(.6, Math.min((cw - 40) / width, 1)));
    setV({ k, x: Math.max(20, (cw - width * k) / 2), y: 18 });
  }, [width]);

  useLayoutEffect(() => { fitWidth(); }, [fitWidth]);
  const touched = useRef(false);
  useEffect(() => {
    const el = host.current; if (!el) return;
    const ro = new ResizeObserver(() => { if (!touched.current) fitWidth(); }); ro.observe(el);
    return () => ro.disconnect();
  }, [fitWidth]);

  /* zoom toward a point (in host coordinates) */
  const zoomAt = useCallback((mx: number, my: number, factor: number) => {
    touched.current = true;
    const c = vRef.current; const k = clampK(c.k * factor); const r = k / c.k;
    setV({ k, x: mx - (mx - c.x) * r, y: my - (my - c.y) * r });
  }, []);

  /* native, non-passive wheel listener so the page never scrolls while zooming */
  useEffect(() => {
    const el = host.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const b = el.getBoundingClientRect();
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(e.clientX - b.left, e.clientY - b.top, Math.exp(-d * 0.0016));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const onDown = (e: React.PointerEvent) => {
    const hit = (e.target as HTMLElement).closest('button, a, [tabindex="0"]');
    if (hit && hit !== e.currentTarget) return;
    touched.current = true;
    pan.current = { px: e.clientX, py: e.clientY, x: v.x, y: v.y, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setPanning(true);
  };
  const onMove = (e: React.PointerEvent) => {
    const p = pan.current; if (!p) return;
    setV((c) => ({ ...c, x: p.x + e.clientX - p.px, y: p.y + e.clientY - p.py }));
  };
  const onUp = () => { pan.current = null; setPanning(false); };
  const center = (f: number) => { const el = host.current; if (el) zoomAt(el.clientWidth / 2, el.clientHeight / 2, f); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const step = 60;
    if (e.key === '+' || e.key === '=') center(1.2);
    else if (e.key === '-') center(1 / 1.2);
    else if (e.key === '0') fit();
    else if (e.key === 'Home') { touched.current = false; fitWidth(); }
    else if (e.key === 'ArrowLeft') setV((c) => ({ ...c, x: c.x + step }));
    else if (e.key === 'ArrowRight') setV((c) => ({ ...c, x: c.x - step }));
    else if (e.key === 'ArrowUp') setV((c) => ({ ...c, y: c.y + step }));
    else if (e.key === 'ArrowDown') setV((c) => ({ ...c, y: c.y - step }));
    else return;
    e.preventDefault();
  };

  return (
    <div ref={host} className={cx('zc-host fit-scroll', panning && 'panning')} tabIndex={0} role="application" aria-label={`${label}. Scroll to zoom at the pointer, drag to pan, + and - to zoom, 0 to fit, arrows to move.`}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}>
      <div className="zc-grid" aria-hidden style={{ backgroundPosition: `${v.x}px ${v.y}px`, backgroundSize: `${32 * v.k}px ${32 * v.k}px` }} />
      <div className="zc-stage" style={{ width, height, transform: `translate(${v.x}px, ${v.y}px) scale(${v.k})` }}>
        {children}
      </div>
      <div className="zc-ctrl" onPointerDown={(e) => e.stopPropagation()}>
        <IconButton icon={ZoomIn} label="Zoom in" size="sm" onClick={() => center(1.2)} />
        <span className="zc-pct tnum" aria-live="polite">{Math.round(v.k * 100)}%</span>
        <IconButton icon={ZoomOut} label="Zoom out" size="sm" onClick={() => center(1 / 1.2)} />
        <IconButton icon={Maximize2} label="Fit whole tree" size="sm" onClick={fit} />
        <IconButton icon={RotateCcw} label="Reset view" size="sm" onClick={() => { touched.current = false; fitWidth(); }} />
        <HelpTrigger k="agents.hierarchy" />
      </div>
      <div className="zc-hint" aria-hidden><Move size={12} />Scroll to zoom · drag to pan</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Agent hierarchy: GM → departments → every agent (no duplicates).    */
/* ------------------------------------------------------------------ */
const COL = 236, GAP = 28, NODE_H = 118, NODE_GAP = 18, DEPT_Y = 200, DEPT_H = 76, AG_Y = DEPT_Y + DEPT_H + 46, GM_H = 128;

export function AgentHierarchy({ agents = AGENTS, highlight }: { agents?: Agent[]; highlight?: (a: Agent) => boolean }) {
  const nav = useNavigate();
  const catalog = useAgentsCatalog(); // api mode: the server's catalog, live (Stage 6)
  const gm = agents.find((a) => a.id === 'gm') ?? AGENTS[0];
  const depts = useMemo(() => DEPTS.filter((d) => d.name !== 'Executive').map((d) => ({
    d, members: AGENTS.filter((a) => a.id !== 'gm' && a.dept === d.name).sort((a, b) => (a.id === d.managerId ? -1 : b.id === d.managerId ? 1 : b.success - a.success)),
  })).filter((x) => x.members.length > 0), [catalog]); // eslint-disable-line react-hooks/exhaustive-deps
  const W = depts.length * COL + (depts.length - 1) * GAP;
  const maxN = Math.max(...depts.map((x) => x.members.length));
  const H = AG_Y + maxN * (NODE_H + NODE_GAP) + 10;
  const gx = W / 2;
  const colX = (i: number) => i * (COL + GAP) + COL / 2;
  const dim = (a: Agent) => highlight && !highlight(a);

  return (
    <ZoomCanvas width={W} height={H} label="Agent hierarchy">
      <svg className="ah-links" width={W} height={H} aria-hidden>
        <defs>
          <filter id="ah-glow"><feGaussianBlur stdDeviation="2.4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        {depts.map(({ d, members }, i) => {
          const x = colX(i);
          const main = `M${gx} ${GM_H} C${gx} ${GM_H + 46} ${x} ${DEPT_Y - 46} ${x} ${DEPT_Y}`;
          const trunkX = x - COL / 2 + 14;
          const lastY = AG_Y + (members.length - 1) * (NODE_H + NODE_GAP) + NODE_H / 2;
          return (
            <g key={d.name} style={{ ['--h' as string]: d.hue }}>
              <motion.path d={main} className="ah-link" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: .9, delay: .1 + i * .06 }} />
              <circle r="3.5" className="ah-pulse" filter="url(#ah-glow)"><animateMotion dur={`${2.4 + (i % 3) * .4}s`} begin={`${i * .35}s`} repeatCount="indefinite" path={main} /></circle>
              <motion.path d={`M${x} ${DEPT_Y + DEPT_H} V${DEPT_Y + DEPT_H + 20} H${trunkX} V${lastY}`} className="ah-link sub" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: .7, delay: .5 + i * .05 }} />
              {members.map((a, k) => {
                const y = AG_Y + k * (NODE_H + NODE_GAP) + NODE_H / 2;
                return <motion.path key={a.id} d={`M${trunkX} ${y} H${trunkX + 16}`} className="ah-link sub" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: .8 + k * .05 }} />;
              })}
            </g>
          );
        })}
      </svg>

      {/* GM */}
      <motion.button className={cx('ah-gm', dim(gm) && 'dim')} style={{ left: gx - 130, top: 0, width: 260, height: GM_H }} onClick={() => nav('/agents/gm')}
        initial={{ scale: .6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 18 }} aria-label="Open GM profile">
        <span className="ah-gm-halo" aria-hidden />
        <RobotAvatar role="manager" size={64} animated faceMode="face" status="good" />
        <div style={{ textAlign: 'left', minWidth: 0 }}>
          <div className="row" style={{ gap: 6 }}><Crown size={14} className="warn" /><b className="display" style={{ fontSize: 18 }}>GM</b><span className="mono dim" style={{ fontSize: 11 }}>{gm.version}</span></div>
          <div className="dim" style={{ fontSize: 11.5 }}>General Manager · {AGENTS.length} agents</div>
          <div style={{ marginTop: 5 }}><LevelPips level={gm.level} xp={gm.xp} /></div>
        </div>
      </motion.button>

      {depts.map(({ d, members }, i) => {
        const x = colX(i) - COL / 2;
        const R = ROLES[d.role];
        return (
          <div key={d.name}>
            <motion.div className="ah-dept" style={{ left: x, top: DEPT_Y, width: COL, height: DEPT_H, ['--h' as string]: d.hue }}
              initial={{ opacity: 0, y: -10, scale: .85 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: .25 + i * .05, type: 'spring', stiffness: 260, damping: 20 }}>
              <span className="ah-hex"><R.icon size={20} strokeWidth={1.8} /></span>
              <div style={{ minWidth: 0 }}><b>{d.name}</b><div className="dim" style={{ fontSize: 11.5 }}>{members.length} {members.length === 1 ? 'agent' : 'agents'} · {d.capacity}% load</div></div>
            </motion.div>
            {members.map((a, k) => {
              const st = AGENT_STATUS[a.status];
              return (
                <motion.button key={a.id} className={cx('ah-node', a.growth, dim(a) && 'dim')} onClick={() => nav(`/agents/${a.id}`)}
                  style={{ left: x + 30, top: AG_Y + k * (NODE_H + NODE_GAP), width: COL - 30, height: NODE_H, ['--rh' as string]: ROLES[a.role].hue, ['--gh' as string]: GROWTH[a.growth].hue }}
                  initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .55 + i * .04 + k * .05 }}
                  aria-label={`${a.name}, ${ROLES[a.role].label}, ${st.label}, ${GROWTH[a.growth].label}. Open profile`}>
                  <div className="row" style={{ gap: 8, minWidth: 0 }}>
                    <RobotAvatar role={a.role} size={42} animated={a.growth === 'evolving'} status={st.tone === 'violet' ? 'violet' : st.tone === 'neutral' ? 'muted' : 'good'} />
                    <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                      <div className="row" style={{ gap: 5 }}>
                        <b className="ellipsis" style={{ fontSize: 13.5 }}>{a.name}</b>
                        {a.id === d.managerId && <Crown size={12} className="warn" aria-label="Department head" />}
                      </div>
                      <div className="dim ellipsis" style={{ fontSize: 11 }}>{ROLES[a.role].label} · {st.label}</div>
                    </div>
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
                    <GrowthBadge agent={a} size="sm" />
                    <EvoTrack agent={a} compact />
                  </div>
                  <LevelPips level={a.level} xp={a.xp} />
                </motion.button>
              );
            })}
          </div>
        );
      })}
    </ZoomCanvas>
  );
}
