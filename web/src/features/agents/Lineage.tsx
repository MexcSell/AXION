import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { GitBranch } from 'lucide-react';
import { useAgentsCatalog } from '@/api/agents';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { EmptyState } from '@/components/ui/EmptyState';
import { AGENTS, AGENT_BY_ID } from '@/data/agents';
import type { Agent } from '@/data/types';
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

export function Lineage() {
  useAgentsCatalog();
  const roots = AGENTS.filter(a => !a.parentId && AGENTS.some(child => child.parentId === a.id));
  if (!roots.length) return <EmptyState icon={GitBranch} title="No derived agents" />;
  return <div className="lin-trees">{roots.map((root, i) => <Tree key={root.id} root={root} delay={i * .05} />)}</div>;
}

function Tree({ root, delay }: { root: Agent; delay: number }) {
  const { pos, w, h } = layout(root);
  const nav = useNavigate();
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
            return <path key={id} d={d} className="lin-edge" />;
          })}
        </svg>
        {ids.map((id, i) => {
          const a = AGENT_BY_ID[id]; const p = px(id);
          return (
            <motion.button key={id} className={cx('lin-node', !a.parentId && 'root')} style={{ left: p.x, top: p.y, width: NW, height: NH }}
              initial={{ opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: delay + i * .05 }} onClick={() => nav(`/agents/${id}`)}>
              <RobotAvatar role={a.role} size={32} />
              <b className="ellipsis">{a.name}</b>
              <span className="ellipsis dim">{a.site ?? a.duty}</span>
            </motion.button>
          );
        })}
      </div>
    </motion.div>
  );
}
