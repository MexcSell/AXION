import { memo, useId } from 'react';
import { ROLES } from '@/data/roles';
import type { RoleKey } from '@/data/types';
import { useSettings, type AvatarPrefs } from '@/store/settings';

interface Props {
  role: RoleKey;
  size?: number;
  /** override global avatar prefs (used by the face customizer preview) */
  prefs?: Partial<AvatarPrefs>;
  faceMode?: AvatarPrefs['faceMode'];
  animated?: boolean;
  status?: 'good' | 'warn' | 'bad' | 'info' | 'violet' | 'muted';
  title?: string;
  hue?: number;
  /** role-specific silhouettes (40-4 reference) in emblem mode; set false to force the standard robot */
  variant?: boolean;
}

/**
 * Parametric synthetic robot avatar (spec §7.5). Purely decorative art — no identity semantics.
 * Shape: chrome helmet, dark visor showing either the role emblem or an expressive face.
 */
export const RobotAvatar = memo(function RobotAvatar({ role, size = 72, prefs, faceMode, animated = false, status, title, hue: hueOverride, variant = true }: Props) {
  const global = useSettings((s) => s.avatar);
  const p = { ...global, ...prefs };
  const mode = faceMode ?? p.faceMode;
  const uid = useId().replace(/:/g, '');
  const r = ROLES[role] ?? ROLES.manager;
  const h = (hueOverride ?? r.hue) + p.hueShift;
  const h2 = r.hue2 + p.hueShift;
  const neon = `hsl(${h} 95% 66%)`;
  const neon2 = `hsl(${h2} 95% 62%)`;
  const deep = `hsl(${h} 80% 30%)`;
  const Icon = r.icon;
  const glow = p.glow;
  const statusColor = status ? (status === 'muted' ? 'var(--text-dim)' : `var(--${status})`) : null;

  const special = variant && mode === 'emblem' && (role === 'knowledge' || role === 'integration' || role === 'qa' || role === 'planning');
  if (special) {
    return (
      <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={title ?? `${r.label} agent avatar`}
        style={{ overflow: 'visible', animation: animated ? 'float-y 4.5s ease-in-out infinite' : undefined }}>
        <defs>
          <radialGradient id={`base-${uid}`} cx="50%" cy="50%" r="50%"><stop offset="0" stopColor={neon} stopOpacity={0.9 * glow} /><stop offset="1" stopColor={neon} stopOpacity="0" /></radialGradient>
          <filter id={`glow-${uid}`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation={2.2 * glow + 0.3} result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <linearGradient id={`plate-${uid}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={neon} stopOpacity=".95" /><stop offset="1" stopColor={neon2} stopOpacity=".55" /></linearGradient>
          <radialGradient id={`metal-${uid}`} cx="38%" cy="28%" r="80%"><stop offset="0" stopColor="var(--robot-metal-1)" /><stop offset=".45" stopColor="var(--robot-metal-2)" /><stop offset="1" stopColor="var(--robot-metal-3)" /></radialGradient>
        </defs>
        <ellipse cx="60" cy="108" rx="40" ry="9" fill={`url(#base-${uid})`} />
        <ellipse cx="60" cy="108" rx="30" ry="5" fill="none" stroke={neon} strokeOpacity={0.55 * glow} strokeWidth="1" />
        {role === 'knowledge' && (
          <g filter={`url(#glow-${uid})`}>
            {[0, 1, 2, 3].map((i) => (
              <g key={i} transform={`translate(0 ${78 - i * 17})`}>
                <polygon points="60,0 100,12 60,24 20,12" fill={`url(#plate-${uid})`} opacity={0.35 + i * 0.18} />
                <polygon points="60,0 100,12 60,24 20,12" fill="none" stroke="#e0f2fe" strokeWidth="1.2" strokeOpacity=".85" />
                <polygon points="20,12 60,24 60,28 20,16" fill={neon2} opacity=".5" /><polygon points="100,12 60,24 60,28 100,16" fill={neon} opacity=".35" />
              </g>
            ))}
            <polygon points="60,21 74,25 60,29 46,25" fill="#fff" opacity=".9" />
          </g>
        )}
        {role === 'integration' && (
          <g filter={`url(#glow-${uid})`} stroke={neon} strokeWidth="1.6" fill="none">
            <circle cx="60" cy="56" r="36" strokeOpacity=".35" />
            {(() => {
              const pts = [[60, 20], [92, 38], [92, 74], [60, 92], [28, 74], [28, 38], [60, 56], [76, 46], [44, 66]];
              const links = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [0, 6], [6, 3], [1, 6], [6, 4], [5, 7], [7, 2], [8, 1], [8, 5], [7, 8]];
              return (<>
                {links.map(([a, b2], i) => <line key={i} x1={pts[a][0]} y1={pts[a][1]} x2={pts[b2][0]} y2={pts[b2][1]} strokeOpacity=".8" />)}
                {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i === 6 ? 5 : 3.4} fill={i === 6 ? '#fff' : neon} stroke="none">{animated && <animate attributeName="opacity" values="1;.4;1" dur={`${2 + i * .3}s`} repeatCount="indefinite" />}</circle>)}
              </>);
            })()}
          </g>
        )}
        {role === 'qa' && (
          <g filter={`url(#glow-${uid})`}>
            <polygon points="60,18 96,36 60,54 24,36" fill={neon} opacity=".28" />
            <polygon points="24,36 60,54 60,96 24,78" fill={neon2} opacity=".22" />
            <polygon points="96,36 60,54 60,96 96,78" fill={neon} opacity=".16" />
            <g fill="none" stroke="#e0f2fe" strokeWidth="1.4" strokeOpacity=".9"><polygon points="60,18 96,36 60,54 24,36" /><path d="M24 36 V78 L60 96 L96 78 V36" /><path d="M60 54 V96" /></g>
            <path d="M42 54 L56 68 L82 40" fill="none" stroke={neon} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M42 54 L56 68 L82 40" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        )}
        {role === 'planning' && (
          <g>
            <rect x="20" y="26" width="80" height="66" rx="14" fill={`url(#metal-${uid})`} />
            <rect x="20" y="26" width="80" height="18" rx="9" fill={neon} opacity=".9" filter={`url(#glow-${uid})`} />
            {[38, 60, 82].map((x) => <rect key={x} x={x - 3} y="16" width="6" height="16" rx="3" fill="var(--robot-metal-3)" />)}
            <rect x="27" y="48" width="66" height="38" rx="8" fill="var(--robot-visor)" stroke={neon} strokeOpacity=".7" />
            <g filter={`url(#glow-${uid})`}>
              {[0, 1, 2].map((rr) => [0, 1, 2, 3, 4].map((c) => (
                <rect key={`${rr}${c}`} x={32 + c * 12} y={53 + rr * 10} width="8" height="6" rx="1.5" fill={(rr * 5 + c) % 4 === 1 ? '#fff' : neon} opacity={(rr * 5 + c) % 3 === 0 ? .45 : .95} />
              )))}
            </g>
            <rect x="12" y="50" width="9" height="22" rx="4.5" fill={`url(#metal-${uid})`} /><rect x="99" y="50" width="9" height="22" rx="4.5" fill={`url(#metal-${uid})`} />
          </g>
        )}
        {statusColor && <g><circle cx="94" cy="92" r="8" fill="var(--panel-solid)" /><circle cx="94" cy="92" r="5.5" fill={statusColor} /></g>}
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label={title ?? `${r.label} agent avatar`}
      style={{ overflow: 'visible', animation: animated ? 'float-y 4.5s ease-in-out infinite' : undefined }}
    >
      <defs>
        <radialGradient id={`metal-${uid}`} cx="38%" cy="28%" r="80%">
          <stop offset="0" stopColor="var(--robot-metal-1)" />
          <stop offset=".45" stopColor="var(--robot-metal-2)" />
          <stop offset="1" stopColor="var(--robot-metal-3)" />
        </radialGradient>
        <linearGradient id={`visor-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={`hsl(${h} 70% 14%)`} />
          <stop offset=".6" stopColor="var(--robot-visor)" />
          <stop offset="1" stopColor={`hsl(${h2} 70% 18%)`} />
        </linearGradient>
        <radialGradient id={`base-${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor={neon} stopOpacity={0.9 * glow} />
          <stop offset="1" stopColor={neon} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`rim-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={neon} />
          <stop offset="1" stopColor={neon2} />
        </linearGradient>
        <filter id={`glow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={2.2 * glow + 0.3} result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* floor glow + holo ring */}
      <ellipse cx="60" cy="108" rx="40" ry="9" fill={`url(#base-${uid})`} />
      <ellipse cx="60" cy="108" rx="30" ry="5" fill="none" stroke={neon} strokeOpacity={0.55 * glow} strokeWidth="1" />

      {/* shoulders */}
      <path d="M26 104 C30 86 44 82 60 82 C76 82 90 86 94 104 Z" fill={`url(#metal-${uid})`} opacity=".92" />
      <path d="M40 100 C44 90 52 88 60 88 C68 88 76 90 80 100" fill="none" stroke={neon} strokeWidth="1.6" strokeOpacity=".8" filter={`url(#glow-${uid})`} />

      {/* antenna */}
      {p.antenna && (
        <g>
          <line x1="60" y1="20" x2="60" y2="9" stroke="var(--robot-metal-3)" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="60" cy="8" r="3.6" fill={neon} filter={`url(#glow-${uid})`}>
            {animated && <animate attributeName="opacity" values="1;.35;1" dur="2.4s" repeatCount="indefinite" />}
          </circle>
        </g>
      )}

      {/* ear pods */}
      <rect x="15" y="44" width="12" height="26" rx="6" fill={`url(#metal-${uid})`} />
      <rect x="93" y="44" width="12" height="26" rx="6" fill={`url(#metal-${uid})`} />
      <rect x="18" y="49" width="5" height="16" rx="2.5" fill={neon} filter={`url(#glow-${uid})`} opacity=".95" />
      <rect x="97" y="49" width="5" height="16" rx="2.5" fill={neon2} filter={`url(#glow-${uid})`} opacity=".95" />

      {/* head */}
      <circle cx="60" cy="57" r="37" fill={`url(#metal-${uid})`} />
      {p.outline && <circle cx="60" cy="57" r="37" fill="none" stroke={`url(#rim-${uid})`} strokeWidth="1.6" strokeOpacity=".85" filter={`url(#glow-${uid})`} />}
      <ellipse cx="46" cy="32" rx="14" ry="6" fill="#fff" opacity=".55" transform="rotate(-24 46 32)" />

      {/* visor */}
      <rect x="28" y="40" width="64" height="38" rx="17" fill={`url(#visor-${uid})`} stroke={neon} strokeOpacity=".75" strokeWidth="1.4" />
      <rect x="31" y="42" width="58" height="8" rx="4" fill="#fff" opacity=".06" />

      {mode === 'emblem' ? (
        <g filter={`url(#glow-${uid})`} style={{ color: neon }}>
          <Icon x={46} y={45} width={28} height={28} strokeWidth={2.1} color={neon} />
        </g>
      ) : (
        <Face eyes={p.eyes} expression={p.expression} color={neon} filter={`url(#glow-${uid})`} animated={animated} deep={deep} />
      )}

      {/* chest emblem in face mode */}
      {mode === 'face' && (
        <g style={{ color: neon }} opacity=".95">
          <Icon x={53} y={89} width={14} height={14} strokeWidth={2.4} color={neon} />
        </g>
      )}

      {variant && mode === 'emblem' && role === 'finance' && (
        <g filter={`url(#glow-${uid})`}>
          {[0, 1, 2, 3].map((i) => <g key={i}><ellipse cx="92" cy={104 - i * 7} rx="16" ry="5.5" fill="#b45309" /><ellipse cx="92" cy={101 - i * 7} rx="16" ry="5.5" fill="#fbbf24" stroke="#fde68a" strokeWidth=".8" /></g>)}
          {[0, 1].map((i) => <g key={'b' + i}><ellipse cx="70" cy={108 - i * 7} rx="13" ry="4.5" fill="#b45309" /><ellipse cx="70" cy={105 - i * 7} rx="13" ry="4.5" fill="#facc15" stroke="#fde68a" strokeWidth=".8" /></g>)}
        </g>
      )}
      {statusColor && (
        <g>
          <circle cx="94" cy="92" r="8" fill="var(--panel-solid)" />
          <circle cx="94" cy="92" r="5.5" fill={statusColor} style={{ filter: `drop-shadow(0 0 4px ${statusColor})` }} />
        </g>
      )}
    </svg>
  );
});

function Face({ eyes, expression, color, filter, animated, deep }: { eyes: AvatarPrefs['eyes']; expression: AvatarPrefs['expression']; color: string; filter: string; animated: boolean; deep: string }) {
  const blink = animated ? <animate attributeName="ry" values="5;5;0.6;5;5" keyTimes="0;.9;.94;.98;1" dur="4.2s" repeatCount="indefinite" /> : null;
  let eyeEls;
  switch (eyes) {
    case 'visor':
      eyeEls = <rect x="38" y="53" width="44" height="7" rx="3.5" fill={color} filter={filter} />;
      break;
    case 'arc':
      eyeEls = (
        <g fill="none" stroke={color} strokeWidth="3.4" strokeLinecap="round" filter={filter}>
          <path d="M40 59 Q47 50 54 59" /><path d="M66 59 Q73 50 80 59" />
        </g>
      );
      break;
    case 'pixel':
      eyeEls = (
        <g fill={color} filter={filter}>
          {[0, 1, 2].map((r) => [0, 1].map((c) => <rect key={`l${r}${c}`} x={42 + c * 5} y={51 + r * 4} width="4" height="3.4" rx=".6" />))}
          {[0, 1, 2].map((r) => [0, 1].map((c) => <rect key={`r${r}${c}`} x={70 + c * 5} y={51 + r * 4} width="4" height="3.4" rx=".6" />))}
        </g>
      );
      break;
    default:
      eyeEls = (
        <g fill={color} filter={filter}>
          <ellipse cx="47" cy="56" rx={expression === 'focused' ? 6 : 5} ry="5">{blink}</ellipse>
          <ellipse cx="73" cy="56" rx={expression === 'focused' ? 6 : 5} ry="5">{blink}</ellipse>
          <circle cx="49" cy="54" r="1.6" fill="#fff" /><circle cx="75" cy="54" r="1.6" fill="#fff" />
        </g>
      );
  }
  const mouth = expression === 'happy'
    ? <path d="M51 67 Q60 74 69 67" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" filter={filter} />
    : expression === 'focused'
      ? <path d="M53 69 H67" stroke={color} strokeWidth="2.6" strokeLinecap="round" filter={filter} />
      : <path d="M53 68 Q60 71 67 68" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" filter={filter} />;
  return (
    <g>
      {expression === 'focused' && <g stroke={deep} strokeWidth="0" />}
      {eyeEls}
      {mouth}
      {expression === 'happy' && <g fill={color} opacity=".35"><ellipse cx="38" cy="66" rx="4" ry="2" /><ellipse cx="82" cy="66" rx="4" ry="2" /></g>}
    </g>
  );
}
