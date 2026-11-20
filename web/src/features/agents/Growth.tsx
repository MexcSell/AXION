import { motion } from 'motion/react';
import { GraduationCap, Dna, CheckCircle2, type LucideIcon } from 'lucide-react';
import { Tip } from '@/components/ui/Tip';
import { DEV_LEVELS, EVO_PHASES, devLevelName } from '@/data/agents';
import type { Agent, DevLevel, GrowthState } from '@/data/types';
import { cx } from '@/lib/format';
import '@/theme/pages/agents.css';

/* Development stage UI — kept separate from operational status (Active / In Mission / Idle). */

export const GROWTH: Record<GrowthState, { label: string; icon: LucideIcon; hue: number; verb: string }> = {
  learning: { label: 'Learning', icon: GraduationCap, hue: 195, verb: 'is learning' },
  evolving: { label: 'Evolving', icon: Dna, hue: 290, verb: 'is evolving' },
  stable: { label: 'Stable', icon: CheckCircle2, hue: 150, verb: 'is stable' },
};

/** "Learning" / "Evolving" / "Stable" badge. Animated while growth is in progress. */
export function GrowthBadge({ agent, size = 'md' }: { agent: Agent; size?: 'sm' | 'md' }) {
  const g = GROWTH[agent.growth];
  return (
    <Tip label={`${agent.name} ${g.verb}: ${agent.growthNote}`}>
      <span tabIndex={0} className={cx('gr-badge', agent.growth, size)} style={{ ['--gh' as string]: g.hue }}>
        <g.icon size={size === 'sm' ? 11 : 13} className={agent.growth !== 'stable' ? 'gr-spin' : undefined} aria-hidden />
        {g.label}
        {agent.growth !== 'stable' && <b className="tnum">{agent.growthPct}%</b>}
      </span>
    </Tip>
  );
}

/** Development stage: 5 pips (Seed … Master) + name. */
export function LevelPips({ level, xp, showName = true, short }: { level: DevLevel; xp?: number; showName?: boolean; short?: boolean }) {
  return (
    <Tip label={`Development stage ${level}/5 · ${devLevelName(level)}${xp != null && level < 5 ? ` · ${xp}% to ${DEV_LEVELS[Math.min(level, 4)]}` : ''}`}>
      <span tabIndex={0} className="lv" aria-label={`Development stage ${level} of 5, ${devLevelName(level)}`}>
        <span className="lv-pips" aria-hidden>
          {[1, 2, 3, 4, 5].map((i) => (
            <i key={i} className={cx(i <= level && 'on', i === level + 1 && 'next')} style={i === level + 1 && xp != null ? { ['--xp' as string]: `${xp}%` } : undefined} />
          ))}
        </span>
        {showName && <span className="lv-name">{short ? `Lv ${level}` : devLevelName(level)}</span>}
      </span>
    </Tip>
  );
}

/** Evolution stage: generation + 4-step pipeline (only lit while evolving). */
export function EvoTrack({ agent, compact }: { agent: Agent; compact?: boolean }) {
  const cur = agent.evoPhase ? EVO_PHASES.findIndex((p) => p.key === agent.evoPhase) : -1;
  return (
    <Tip label={cur >= 0 ? `Evolution: generation ${agent.generation} → candidate ${agent.candidate} in ${EVO_PHASES[cur].label}` : `Evolution: generation ${agent.generation}, no candidate in progress`}>
      <span tabIndex={0} className={cx('evo-track', compact && 'compact')}>
        <span className="evo-gen">Gen {agent.generation}</span>
        <span className="evo-steps" aria-hidden>
          {EVO_PHASES.map((p, i) => <i key={p.key} className={cx(i < cur && 'done', i === cur && 'cur')} title={p.label} />)}
        </span>
        {!compact && <span className="evo-ph">{cur >= 0 ? EVO_PHASES[cur].label : '—'}</span>}
      </span>
    </Tip>
  );
}

/** Compact development block used on cards & hierarchy nodes. */
export function DevStrip({ agent }: { agent: Agent }) {
  return (
    <div className="dev-strip">
      <div className="row" style={{ gap: 6, justifyContent: 'space-between' }}>
        <GrowthBadge agent={agent} size="sm" />
        <LevelPips level={agent.level} xp={agent.xp} short />
      </div>
      {agent.growth !== 'stable' && (
        <div className="dev-bar" style={{ ['--gh' as string]: GROWTH[agent.growth].hue }}>
          <motion.i initial={{ width: 0 }} animate={{ width: `${agent.growthPct}%` }} transition={{ duration: 1, delay: .2 }} />
        </div>
      )}
    </div>
  );
}
