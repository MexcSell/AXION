import type { CSSProperties, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AGENT_STATUS, INSTANCE_STATE, MISSION_STATUS, ROLES, TASK_STATE } from '@/data/roles';
import type { AgentStatus, InstanceState, MissionStatus, RoleKey, TaskState } from '@/data/types';
import { cx } from '@/lib/format';

export function Chip({ hue = 260, icon: Icon, children, solid, size, pill, className, style, title }: {
  hue?: number; icon?: LucideIcon; children: ReactNode; solid?: boolean; size?: 'sm'; pill?: boolean; className?: string; style?: CSSProperties; title?: string;
}) {
  return (
    <span className={cx('chip', solid && 'solid', size, pill && 'pill', className)} style={{ ['--h' as string]: hue, ...style }} title={title}>
      {Icon && <Icon size={size === 'sm' ? 10 : 12} aria-hidden />}
      {children}
    </span>
  );
}

export function RoleChip({ role, size }: { role: RoleKey; size?: 'sm' }) {
  const r = ROLES[role];
  return <Chip hue={r.hue} icon={r.icon} size={size}>{r.label}</Chip>;
}

export function AgentStatusChip({ status, size }: { status: AgentStatus; size?: 'sm' }) {
  const s = AGENT_STATUS[status];
  return <Chip hue={s.hue} solid size={size}>{s.label}</Chip>;
}

export function MissionStatusChip({ status, size }: { status: MissionStatus; size?: 'sm' }) {
  const s = MISSION_STATUS[status];
  return <Chip hue={s.hue} size={size}><span className="dot sm" />{s.label}</Chip>;
}

export function InstanceStateChip({ state, size }: { state: InstanceState; size?: 'sm' }) {
  const s = INSTANCE_STATE[state];
  return <Chip hue={s.hue} size={size}><span className="dot sm" />{s.label}</Chip>;
}

export function TaskStateChip({ state, size }: { state: TaskState; size?: 'sm' }) {
  const s = TASK_STATE[state];
  return <Chip hue={s.hue} size={size}>{s.label}</Chip>;
}

export function DemoTag({ title = 'Demonstration data — not live' }: { title?: string }) {
  return <span className="demo-tag" title={title}>DEMO</span>;
}

export function Dot({ tone = 'good', pulse }: { tone?: 'good' | 'warn' | 'bad' | 'info' | 'violet' | 'muted'; pulse?: boolean }) {
  const color = tone === 'muted' ? 'var(--text-dim)' : `var(--${tone})`;
  return (
    <span style={{ position: 'relative', display: 'inline-block', width: 8, height: 8, color, flex: 'none' }} aria-hidden>
      <span className="dot" style={{ position: 'absolute', inset: 0 }} />
      {pulse && <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid currentColor', animation: 'pulse-ring 1.8s ease-out infinite' }} />}
    </span>
  );
}
