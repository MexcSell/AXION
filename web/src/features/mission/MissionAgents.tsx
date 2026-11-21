import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Crown, GitFork, Layers, List, Network, Activity, Share2, Maximize2 } from 'lucide-react';
import { MiniHierarchy } from './MiniHierarchy';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { IconButton } from '@/components/ui/IconButton';
import { Tip } from '@/components/ui/Tip';
import { InstanceStateChip } from '@/components/ui/Chips';
import { AGENT_BY_ID } from '@/data/agents';
import { getMissionControl } from '@/data/missions';
import { INSTANCE_STATE } from '@/data/roles';
import type { InstanceState, Mission, MissionNode } from '@/data/types';
import { cx } from '@/lib/format';
import { useMissionControl } from '@/api/missionControl';
import { usePartStatus } from './PartStatus';

export const stateTone = (s: string) => (s === 'working' ? 'good' : s === 'waiting' ? 'warn' : s === 'blocked' ? 'bad' : s === 'done' ? 'violet' : 'info') as 'good' | 'warn' | 'bad' | 'violet' | 'info';

/* View modes of the Mission agents pane (owner 2026-11-20: "add hierarchy, let the viewing methods appear in various ways"). */
type View = 'graph' | 'tree' | 'levels' | 'status' | 'list';
const VIEWS: { key: View; icon: typeof List; label: string }[] = [
  { key: 'graph', icon: Share2, label: 'Hierarchy graph — nodes and links' },
  { key: 'tree', icon: GitFork, label: 'Hierarchy tree — who delegates to whom (fold branches)' },
  { key: 'levels', icon: Layers, label: 'Levels — lead, managers, specialists' },
  { key: 'status', icon: Activity, label: 'By status — blocked and waiting first' },
  { key: 'list', icon: List, label: 'Flat list — A to Z' },
];
const VIEW_KEY = 'axion.missions.agentsView';
const readView = (): View => { try { const v = localStorage.getItem(VIEW_KEY); return VIEWS.some((x) => x.key === v) ? (v as View) : 'graph'; } catch { return 'graph'; } };
const writeView = (v: View) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage blocked: per-viewer convenience only */ } };

const STATE_ORDER: InstanceState[] = ['blocked', 'waiting', 'working', 'verifying', 'reporting', 'idle', 'done'];
const LEVEL_NAME = ['Lead', 'Managers', 'Specialists'];

interface Row { n: MissionNode; d: number; kids: number; last: boolean; rails: boolean[] }

/** The mission's agents, viewable as hierarchy tree, levels, status groups or a flat list. Left pane of Missions › Conversations. */
type AgentsProps = { m: Mission; agentId: string; onSelectAgent: (id: string) => void; onOpenGraph?: () => void };
export function MissionAgents(props: AgentsProps) {
  const status = usePartStatus(props.m.id, 'hierarchy', "the mission's agents");
  return status ?? <MissionAgentsView {...props} />;
}

function MissionAgentsView({ m, agentId, onSelectAgent, onOpenGraph }: AgentsProps) {
  useMissionControl(m.id, ['hierarchy']);
  const mc = getMissionControl(m);
  const [view, setViewState] = useState<View>(readView);
  const setView = (v: View) => { setViewState(v); writeView(v); };
  const [folded, setFolded] = useState<Set<string>>(() => new Set());

  const kids = useMemo(() => {
    const k: Record<string, MissionNode[]> = {};
    mc.nodes.forEach((n) => { if (n.parent) (k[n.parent] ??= []).push(n); });
    return k;
  }, [mc.nodes]);

  // depth-first walk with rail info so the tree can draw its guide lines
  const all = useMemo(() => {
    const out: Row[] = [];
    const walk = (parent: string | undefined, d: number, rails: boolean[]) => {
      const sibs = parent ? kids[parent] ?? [] : mc.nodes.filter((n) => !n.parent);
      sibs.forEach((n, i) => {
        const last = i === sibs.length - 1;
        out.push({ n, d, kids: (kids[n.instanceId] ?? []).length, last, rails });
        walk(n.instanceId, d + 1, [...rails, !last]);
      });
    };
    walk(undefined, 0, []);
    return out;
  }, [mc.nodes, kids]);

  const visible = useMemo(() => {
    const hidden = new Set<string>();
    return all.filter((r) => {
      if (r.n.parent && (hidden.has(r.n.parent) || folded.has(r.n.parent))) { hidden.add(r.n.instanceId); return false; }
      return true;
    });
  }, [all, folded]);

  const branches = all.filter((r) => r.kids > 0).map((r) => r.n.instanceId);
  const allFolded = branches.length > 0 && branches.every((b) => folded.has(b));
  const toggle = (id: string) => setFolded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const row = (n: MissionNode, i: number, extra?: { r?: Row }) => (
    <AgentRow key={n.instanceId} m={m} n={n} i={i} sel={n.agentId === agentId} onSelect={onSelectAgent}
      tree={extra?.r} folded={extra?.r ? folded.has(n.instanceId) : false} onToggle={() => toggle(n.instanceId)} />
  );

  return (
    <div className="conv-agents-inner">
      <div className="row conv-agents-head">
        <Network size={14} className="info" /><span>Mission agents</span><span className="dim">({mc.nodes.length})</span>
        <span className="spacer" /><HelpTrigger k="mission.agentViews" />
      </div>
      <div className="row conv-agents-tools">
        <div role="radiogroup" aria-label="Agent view" className="segmented sm conv-views">
          {VIEWS.map((v) => {
            const sel = v.key === view;
            const Icon = v.icon;
            return (
              <Tip key={v.key} label={v.label}>
                <button type="button" role="radio" aria-checked={sel} aria-label={v.label} className="seg-btn" onClick={() => setView(v.key)}>
                  {sel && <motion.span layoutId={`conv-view-${m.id}`} className="seg-thumb" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                  <Icon size={13} style={{ position: 'relative', zIndex: 1 }} aria-hidden />
                </button>
              </Tip>
            );
          })}
        </div>
        <span className="spacer" />
        {view === 'graph' && onOpenGraph && <IconButton size="xs" icon={Maximize2} label="Open the full hierarchy graph (Hierarchy tab)" onClick={onOpenGraph} />}
        {view === 'tree' && branches.length > 0 && (
          <IconButton size="xs" icon={allFolded ? ChevronsUpDown : ChevronsDownUp} label={allFolded ? 'Expand all branches' : 'Collapse all branches'}
            onClick={() => setFolded(allFolded ? new Set() : new Set(branches))} />
        )}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={view} className="conv-agents-list" role="listbox" aria-label={`Agents in ${m.title}`}
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: .16 }}>

          {view === 'graph' && <MiniHierarchy m={m} nodes={mc.nodes} edges={mc.edges} agentId={agentId} onSelect={onSelectAgent} />}

          {view === 'tree' && (
            <AnimatePresence initial={false}>
              {visible.map((r, i) => row(r.n, i, { r }))}
            </AnimatePresence>
          )}

          {view === 'levels' && [0, 1, 2].map((lvl) => {
            const at = all.filter((r) => Math.min(r.d, 2) === lvl);
            if (!at.length) return null;
            return (
              <section key={lvl} className="conv-level" aria-label={LEVEL_NAME[lvl]}>
                <div className="conv-group-head"><span className="conv-level-num">L{lvl}</span>{LEVEL_NAME[lvl]}<span className="dim">· {at.length}</span></div>
                <div className="conv-level-grid">
                  {at.map((r, i) => <LevelTile key={r.n.instanceId} m={m} n={r.n} i={i + lvl * 3} sel={r.n.agentId === agentId} onSelect={onSelectAgent} />)}
                </div>
              </section>
            );
          })}

          {view === 'status' && STATE_ORDER.map((st) => {
            const at = mc.nodes.filter((n) => n.state === st);
            if (!at.length) return null;
            const meta = INSTANCE_STATE[st];
            return (
              <section key={st} aria-label={meta.label}>
                <div className="conv-group-head" style={{ ['--h' as string]: meta.hue }}><span className="conv-state-dot" />{meta.label}<span className="dim">· {at.length}</span></div>
                {at.map((n, i) => row(n, i))}
              </section>
            );
          })}

          {view === 'list' && [...mc.nodes]
            .sort((a, b) => (AGENT_BY_ID[a.agentId]?.name ?? '').localeCompare(AGENT_BY_ID[b.agentId]?.name ?? ''))
            .map((n, i) => row(n, i))}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function AgentRow({ m, n, i, sel, onSelect, tree, folded, onToggle }: {
  m: Mission; n: MissionNode; i: number; sel: boolean; onSelect: (id: string) => void; tree?: Row; folded: boolean; onToggle: () => void;
}) {
  const a = AGENT_BY_ID[n.agentId];
  if (!a) return null;
  return (
    <motion.div layout="position" className={cx('team-row conv-row', sel && 'selected')} role="option" aria-selected={sel} tabIndex={0}
      onClick={() => onSelect(a.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(a.id); } }}
      title={`${a.name} — ${n.task}`}
      initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0 }}
      transition={{ delay: Math.min(i, 14) * .025, duration: .18 }}>
      {sel && <motion.span layoutId={`conv-agent-sel-${m.id}`} className="team-sel" transition={{ type: 'spring', stiffness: 480, damping: 40 }} />}
      {tree && tree.d > 0 && (
        <span className="tree-rails" aria-hidden>
          {tree.rails.slice(1).map((on, k) => <span key={k} className={cx('tree-rail', on && 'on')} />)}
          <span className={cx('tree-elbow', tree.last && 'last')} />
        </span>
      )}
      {tree && (tree.kids > 0
        ? <button type="button" className={cx('tree-fold', !folded && 'open')} aria-expanded={!folded} aria-label={`${folded ? 'Expand' : 'Collapse'} ${a.name}'s team`}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}><ChevronRight size={12} /></button>
        : <span className="tree-fold-gap" aria-hidden />)}
      <span style={{ position: 'relative', flex: 'none' }}><RobotAvatar role={a.role} size={30} status={stateTone(n.state)} animated={sel} /></span>
      <div style={{ minWidth: 0, flex: 1, position: 'relative', textAlign: 'left' }}>
        <div className="row" style={{ gap: 4 }}>
          {n.agentId === m.leadId && <Crown size={11} className="warn" style={{ flex: 'none' }} />}
          <b className="ellipsis" style={{ fontSize: 12.5 }}>{a.name}</b>
          {n.pending > 0 && <span className="badge">{n.pending}</span>}
          {tree && tree.kids > 0 && folded && <span className="tree-count">+{tree.kids}</span>}
        </div>
        <div className="dim ellipsis" style={{ fontSize: 11 }}>{n.task}</div>
      </div>
      <span className="conv-agent-state" style={{ position: 'relative' }}><InstanceStateChip state={n.state} size="sm" /></span>
    </motion.div>
  );
}

function LevelTile({ m, n, i, sel, onSelect }: { m: Mission; n: MissionNode; i: number; sel: boolean; onSelect: (id: string) => void }) {
  const a = AGENT_BY_ID[n.agentId];
  if (!a) return null;
  return (
    <Tip label={<><b>{a.name}</b> · {INSTANCE_STATE[n.state].label}<br /><span className="dim">{n.task}</span></>}>
      <motion.button type="button" role="option" aria-selected={sel} aria-label={`${a.name}, ${INSTANCE_STATE[n.state].label}`}
        className={cx('conv-tile', sel && 'selected')} onClick={() => onSelect(a.id)}
        initial={{ opacity: 0, scale: .85 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: Math.min(i, 14) * .03, type: 'spring', stiffness: 420, damping: 28 }}
        whileHover={{ y: -2 }}>
        {sel && <motion.span layoutId={`conv-agent-sel-${m.id}`} className="team-sel" transition={{ type: 'spring', stiffness: 480, damping: 40 }} />}
        <span style={{ position: 'relative' }}>
          <RobotAvatar role={a.role} size={34} status={stateTone(n.state)} animated={sel} />
          {n.agentId === m.leadId && <Crown size={11} className="warn conv-tile-crown" />}
          {n.pending > 0 && <span className="badge conv-tile-badge">{n.pending}</span>}
        </span>
        <span className="ellipsis conv-tile-name">{a.name}</span>
      </motion.button>
    </Tip>
  );
}
