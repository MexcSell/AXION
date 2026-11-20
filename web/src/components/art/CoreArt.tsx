import { memo, useId } from 'react';

/** Neon "A" brand glyph (gradient triangle with cut-out). */
export const LogoGlyph = memo(function LogoGlyph({ size = 44 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={`lg-${id}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset=".55" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
        <filter id={`lf-${id}`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.4" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <g filter={`url(#lf-${id})`}>
        <path d="M32 3 L62 60 H47 L32 30 L17 60 H2 Z" fill={`url(#lg-${id})`} />
        <path d="M32 3 L62 60 H47 L32 30 L17 60 H2 Z" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth=".8" />
        <path d="M24 47 H40 L32 31Z" fill="#a5f3fc" opacity=".85" />
      </g>
    </svg>
  );
});

/** Isometric glowing core cube on a holo platform (sidebar & AXION Core card). */
export const CoreCube = memo(function CoreCube({ width = 180, animated = true }: { width?: number; animated?: boolean }) {
  const id = useId().replace(/:/g, '');
  const h = width * 0.72;
  return (
    <svg width={width} height={h} viewBox="0 0 250 180" aria-hidden style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={`top-${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7dd3fc" stopOpacity=".95" /><stop offset="1" stopColor="#6366f1" stopOpacity=".75" /></linearGradient>
        <linearGradient id={`left-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3b82f6" stopOpacity=".65" /><stop offset="1" stopColor="#1e1b4b" stopOpacity=".85" /></linearGradient>
        <linearGradient id={`right-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8b5cf6" stopOpacity=".6" /><stop offset="1" stopColor="#1e1b4b" stopOpacity=".85" /></linearGradient>
        <radialGradient id={`plat-${id}`} cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#22d3ee" stopOpacity=".55" /><stop offset=".6" stopColor="#6366f1" stopOpacity=".2" /><stop offset="1" stopColor="#6366f1" stopOpacity="0" /></radialGradient>
        <filter id={`g-${id}`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        <pattern id={`grid-${id}`} width="8" height="8" patternUnits="userSpaceOnUse"><path d="M8 0H0V8" fill="none" stroke="#a5f3fc" strokeOpacity=".35" strokeWidth=".6" /></pattern>
      </defs>
      {/* platform */}
      <ellipse cx="125" cy="146" rx="112" ry="30" fill={`url(#plat-${id})`} />
      <ellipse cx="125" cy="146" rx="96" ry="24" fill="none" stroke="#38bdf8" strokeOpacity=".7" strokeWidth="1.4" filter={`url(#g-${id})`} />
      <ellipse cx="125" cy="146" rx="74" ry="17" fill="none" stroke="#a78bfa" strokeOpacity=".6" strokeWidth="1" strokeDasharray="4 6" style={animated ? { animation: 'dash-flow 2.4s linear infinite' } : undefined} />
      {/* circuit traces */}
      <g stroke="#38bdf8" strokeOpacity=".55" strokeWidth="1" fill="none">
        <path d="M30 150 L60 150 L72 140" /><path d="M220 150 L190 150 L178 140" /><path d="M125 176 L125 166" />
        <circle cx="30" cy="150" r="2" fill="#38bdf8" /><circle cx="220" cy="150" r="2" fill="#38bdf8" />
      </g>
      {/* cube */}
      <g style={animated ? { animation: 'float-y 5s ease-in-out infinite' } : undefined}>
        <polygon points="125,30 185,60 125,90 65,60" fill={`url(#top-${id})`} />
        <polygon points="65,60 125,90 125,140 65,110" fill={`url(#left-${id})`} />
        <polygon points="185,60 125,90 125,140 185,110" fill={`url(#right-${id})`} />
        <polygon points="65,60 125,90 125,140 65,110" fill={`url(#grid-${id})`} opacity=".7" />
        <polygon points="185,60 125,90 125,140 185,110" fill={`url(#grid-${id})`} opacity=".7" />
        <g fill="none" stroke="#e0f2fe" strokeWidth="1.5" filter={`url(#g-${id})`}>
          <polygon points="125,30 185,60 125,90 65,60" />
          <path d="M65 60 V110 L125 140 L185 110 V60" /><path d="M125 90 V140" />
        </g>
        {/* inner core */}
        <polygon points="125,62 145,72 125,82 105,72" fill="#e0f2fe" opacity=".9" filter={`url(#g-${id})`}>
          {animated && <animate attributeName="opacity" values=".95;.5;.95" dur="3s" repeatCount="indefinite" />}
        </polygon>
        <line x1="125" y1="10" x2="125" y2="30" stroke="#a5f3fc" strokeOpacity=".6" />
      </g>
      {/* particles */}
      {[[40, 70], [210, 52], [196, 100], [52, 112], [160, 22], [88, 18]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={1.6} fill="#a5f3fc" style={animated ? { animation: `twinkle ${2 + i * .4}s ease-in-out ${i * .3}s infinite` } : undefined} />
      ))}
    </svg>
  );
});
