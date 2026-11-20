import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { GitBranch, Lock, ArrowUp, ArrowDown, Share2, BookOpen, Undo2, ArrowUpRight } from 'lucide-react';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { Panel } from '@/components/ui/Panel';
import { Chip } from '@/components/ui/Chips';
import { Tip } from '@/components/ui/Tip';
import { IconButton } from '@/components/ui/IconButton';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { AGENTS, AGENT_BY_ID } from '@/data/agents';
import type { Agent } from '@/data/types';
import { useLineage, lineageRoots, knowledgeOf, type Lesson } from '@/data/lineage';
import { toast } from '@/store/ui';
import { cx } from '@/lib/format';
import '@/theme/pages/lineage.css';

const NW = 128, NH = 78, GX = 16, GY = 28;

/** Tidy layout: leaves left→right, parents centred over their children. */
function layout(root: Agent) {
  const pos: Record<string, { x: number; y: number }> = {};
  let leaf = 0;
  const walk = (a: Agent, d: number): number => {
    const kids = AGENTS.filter((c) => c.parentId === a.id);
    const x = kids.length ? kids.map((k) => walk(k, d + 1)).reduce((s, v, _, arr) => s + v / arr.length, 0) : leaf++;
    pos[a.id] = { x, y: d };
    return x;
  };
  walk(root, 0);
  const depth = Math.max(...Object.values(pos).map((p) => p.y)) + 1;
  return { pos, w: leaf * (NW + GX) - GX, h: depth * (NH + GY) - GY };
}

/** Agents › Lineage: derived agents and how their knowledge flows (owner update 2026-11-20 u1). */
export function Lineage() {
  const lessons = useLineage((s) => s.lessons);
  const roots = lineageRoots();
  const [sel, setSel] = useState('mobile-dev-01');
  const a = AGENT_BY_ID[sel];
  const k = useMemo(() => knowledgeOf(sel, lessons), [sel, lessons]);
  return (
    <div className="lin">
      <div className="lin-trees">
        {roots.map((r, i) => <Tree key={r.id} root={r} sel={sel} onSel={setSel} delay={i * .1} lessons={lessons} />)}
        <p className="dim lin-note"><GitBranch size={13} /> A derived agent keeps experience that is specific to it and shares general lessons with the agent it was derived from. Those lessons then reach every agent in the same family. Each agent still has its own, unique duty.</p>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={sel} className="lin-detail" initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: .2 }}>
          <Panel icon={BookOpen} title={`${a.name} · knowledge`} help="agents.lineage" actions={<Tip label="Open profile"><Link className="icon-btn sm" to={`/agents/${a.id}`} aria-label={`Open ${a.name}`}><ArrowUpRight size={15} /></Link></Tip>}>
            <div className="lin-head">
              <RobotAvatar role={a.role} size={52} animated />
              <div style={{ minWidth: 0 }}>
                <b className="ellipsis">{a.duty}</b>
                <div className="dim" style={{ fontSize: 12 }}>{a.parentId ? <>derived from <button className="lin-link" onClick={() => setSel(a.parentId!)}>{AGENT_BY_ID[a.parentId]?.name}</button></> : 'root of its family'}{a.site && <> · <span className="mono">{a.site}</span></>}</div>
              </div>
            </div>
            <LessonList title="Keeps (specialised)" icon={Lock} hue={268} items={k.own} empty="Nothing private yet."
              action={(l) => a.parentId && <IconButton size="xs" icon={ArrowUp} label={`Share "${l.title}" up to ${AGENT_BY_ID[a.parentId]?.name}`} onClick={() => { useLineage.getState().shareUp(l.id); toast({ tone: 'success', title: 'Shared up', body: `${AGENT_BY_ID[a.parentId!]?.name} now passes “${l.title}” to its whole family.` }); }} />} />
            <LessonList title={a.parentId ? `Shares up to ${AGENT_BY_ID[a.parentId]?.name}` : 'Shares with its family'} icon={Share2} hue={190} items={k.sharedUp} empty="No shared lessons yet."
              action={(l) => <IconButton size="xs" icon={Undo2} label={`Keep "${l.title}" private`} onClick={() => { useLineage.getState().keepOwn(l.id); toast({ tone: 'info', title: 'Kept private', body: `Only ${a.name} uses “${l.title}” now.` }); }} />} />
            <LessonList title="Inherited from the family" icon={ArrowDown} hue={150} items={k.inherited} empty="No family lessons." showFrom />
          </Panel>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Tree({ root, sel, onSel, delay, lessons }: { root: Agent; sel: string; onSel: (id: string) => void; delay: number; lessons: Lesson[] }) {
  const { pos, w, h } = layout(root);
  const ids = Object.keys(pos);
  const px = (id: string) => ({ x: pos[id].x * (NW + GX), y: pos[id].y * (NH + GY) });
  return (
    <motion.div className="lin-tree subpanel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <div className="row" style={{ gap: 6, marginBottom: 8 }}><GitBranch size={15} className="violet" /><b>{root.name} family</b><span className="dim" style={{ fontSize: 12 }}>{ids.length} agents</span></div>
      <div className="lin-canvas" style={{ width: w, height: h }}>
        <svg width={w} height={h} className="lin-svg" aria-hidden>
          {ids.filter((id) => AGENT_BY_ID[id].parentId && pos[AGENT_BY_ID[id].parentId!]).map((id) => {
            const c = px(id), p = px(AGENT_BY_ID[id].parentId!);
            const x1 = c.x + NW / 2, y1 = c.y, x2 = p.x + NW / 2, y2 = p.y + NH, my = (y1 + y2) / 2;
            const d = `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
            const n = lessons.filter((l) => l.agentId === id && l.scope === 'shared').length;
            return <g key={id}><path d={d} className="lin-edge" /><path d={d} className="lin-flow" style={{ animationDuration: `${Math.max(1.2, 3.2 - n * .4)}s` }} /></g>;
          })}
        </svg>
        {ids.map((id, i) => {
          const a = AGENT_BY_ID[id]; const p = px(id);
          const own = lessons.filter((l) => l.agentId === id && l.scope === 'own').length;
          const up = lessons.filter((l) => l.agentId === id && l.scope === 'shared').length;
          return (
            <motion.button key={id} className={cx('lin-node', sel === id && 'on', !a.parentId && 'root')} style={{ left: p.x, top: p.y, width: NW, height: NH }}
              initial={{ opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: delay + i * .05 }} onClick={() => onSel(id)} aria-pressed={sel === id}>
              <RobotAvatar role={a.role} size={32} />
              <b className="ellipsis">{a.name}</b>
              <span className="ellipsis dim">{a.site ?? a.duty}</span>
              <span className="lin-counts"><Tip label={`${own} kept`}><span><Lock size={9} />{own}</span></Tip><Tip label={`${up} shared up`}><span className="info"><ArrowUp size={9} />{up}</span></Tip></span>
            </motion.button>
          );
        })}
      </div>
    </motion.div>
  );
}

function LessonList({ title, icon: I, hue, items, empty, action, showFrom }: { title: string; icon: typeof Lock; hue: number; items: Lesson[]; empty: string; action?: (l: Lesson) => React.ReactNode; showFrom?: boolean }) {
  return (
    <div className="lin-list" style={{ ['--h' as string]: hue }}>
      <div className="lin-list-h"><I size={13} />{title}<span className="dim">{items.length}</span>{title.startsWith('Keeps') && <HelpTrigger k="agents.lineage.share" />}</div>
      <AnimatePresence initial={false}>
        {items.length === 0 && <div className="dim" style={{ fontSize: 12, padding: '4px 2px' }}>{empty}</div>}
        {items.map((l) => (
          <motion.div key={l.id} layout className="lin-item" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}>
            <span className="grow ellipsis" title={l.title}>{l.title}</span>
            {showFrom && l.from && <Chip hue={225} size="sm">{AGENT_BY_ID[l.from]?.name}</Chip>}
            <span className="dim tnum" style={{ fontSize: 11 }}>{l.uses}×</span>
            {action?.(l)}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
