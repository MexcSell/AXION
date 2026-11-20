import { memo, useMemo } from 'react';
import { seeded } from '@/data/agents';

/**
 * Header hero art (spec: 40-4 reference): glowing glass dome with a tree of light,
 * floating island, neon skyline on both sides, drones and stars. Pure SVG, no raster.
 */
export const HeroScene = memo(function HeroScene({ animated = true }: { animated?: boolean }) {
  const { towers, stars, branches, leaves } = useMemo(() => {
    const r = seeded('axion-hero');
    const towers: { x: number; w: number; h: number; hue: number; spire: boolean; lit: number }[] = [];
    // left & right skylines on the island edges
    for (let side = 0; side < 2; side++) {
      let x = side === 0 ? 290 : 760;
      const end = side === 0 ? 462 : 905;
      while (x < end) {
        const w = 8 + Math.round(r() * 16);
        const dist = side === 0 ? (462 - x) / 172 : (x - 760) / 145; // farther from dome = shorter
        const h = 30 + Math.round((1 - dist * 0.65) * (40 + r() * 60));
        towers.push({ x, w, h, hue: r() > .5 ? 265 : 195, spire: r() > .6, lit: r() });
        x += w + 2 + Math.round(r() * 5);
      }
    }
    const stars = Array.from({ length: 70 }, () => ({ x: r() * 1200, y: r() * 150, s: .5 + r() * 1.3, d: 1.5 + r() * 3, delay: r() * 3 }));
    // fractal-ish light tree
    const branches: { d: string; w: number; o: number }[] = [];
    const leaves: { x: number; y: number; r: number }[] = [];
    const grow = (x: number, y: number, ang: number, len: number, depth: number) => {
      if (depth === 0) { leaves.push({ x, y, r: 1.5 + r() * 2.5 }); return; }
      const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
      const cx = (x + x2) / 2 + (r() - .5) * 8, cy = (y + y2) / 2;
      branches.push({ d: `M${x.toFixed(1)} ${y.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`, w: depth * 1.25, o: .55 + depth * .08 });
      const spread = .42 + r() * .25;
      grow(x2, y2, ang - spread, len * .74, depth - 1);
      grow(x2, y2, ang + spread, len * .74, depth - 1);
      if (depth > 3 && r() > .5) grow(x2, y2, ang + (r() - .5) * .3, len * .6, depth - 2);
    };
    grow(600, 150, -Math.PI / 2, 40, 7);
    return { towers, stars, branches, leaves };
  }, []);

  const A = animated;
  return (
    <svg className="hero-svg" viewBox="0 0 1200 230" preserveAspectRatio="xMidYMin slice" aria-hidden>
      <defs>
        <radialGradient id="h-sky" cx="50%" cy="30%" r="60%">
          <stop offset="0" stopColor="#3b82f6" stopOpacity=".5" />
          <stop offset=".45" stopColor="#1e3a8a" stopOpacity=".28" />
          <stop offset="1" stopColor="#0b1030" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="h-dome" cx="50%" cy="78%" r="70%">
          <stop offset="0" stopColor="#f0abfc" stopOpacity=".55" />
          <stop offset=".35" stopColor="#6366f1" stopOpacity=".26" />
          <stop offset=".8" stopColor="#3b82f6" stopOpacity=".12" />
          <stop offset="1" stopColor="#22d3ee" stopOpacity=".35" />
        </radialGradient>
        <linearGradient id="h-domeEdge" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#22d3ee" /><stop offset=".5" stopColor="#c4b5fd" /><stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
        <linearGradient id="h-tree" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#c084fc" /><stop offset=".5" stopColor="#f0abfc" /><stop offset="1" stopColor="#67e8f9" />
        </linearGradient>
        <linearGradient id="h-island" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1e1b4b" /><stop offset="1" stopColor="#0b1030" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="h-tower-v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6d28d9" stopOpacity=".95" /><stop offset="1" stopColor="#1e1b4b" stopOpacity=".4" /></linearGradient>
        <linearGradient id="h-tower-c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0e7490" stopOpacity=".95" /><stop offset="1" stopColor="#172554" stopOpacity=".4" /></linearGradient>
        <filter id="h-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        <filter id="h-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9" /></filter>
        <radialGradient id="h-canopy" cx="50%" cy="55%" r="55%">
          <stop offset="0" stopColor="#f5f3ff" stopOpacity=".95" />
          <stop offset=".3" stopColor="#c4b5fd" stopOpacity=".75" />
          <stop offset=".65" stopColor="#60a5fa" stopOpacity=".35" />
          <stop offset="1" stopColor="#3b82f6" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="h-trunk" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#a855f7" /><stop offset=".6" stopColor="#e9d5ff" /><stop offset="1" stopColor="#fdf4ff" /></linearGradient>
        <linearGradient id="h-rock" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1e293b" /><stop offset=".5" stopColor="#0f172a" /><stop offset="1" stopColor="#020617" stopOpacity="0" /></linearGradient>
        <radialGradient id="h-fade" cx="50%" cy="20%" r="65%"><stop offset=".55" stopColor="#fff" /><stop offset="1" stopColor="#000" /></radialGradient>
        <mask id="h-mask"><rect width="1200" height="230" fill="url(#h-fade)" /></mask>
      </defs>

      <g mask="url(#h-mask)">
        <rect width="1200" height="230" fill="url(#h-sky)" />
        {/* stars */}
        {stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.s} fill="#e0e7ff" opacity=".7" style={A ? { animation: `twinkle ${s.d}s ease-in-out ${s.delay}s infinite` } : undefined} />
        ))}
        {/* aurora beams */}
        <g opacity=".35" filter="url(#h-soft)">
          <path d="M420 0 L520 170 L470 170 L380 0Z" fill="#8b5cf6" />
          <path d="M780 0 L680 170 L730 170 L820 0Z" fill="#22d3ee" />
        </g>

        {/* island base */}
        <path d="M200 170 Q600 140 1000 170 Q860 214 600 222 Q340 214 200 170Z" fill="url(#h-island)" />
        <path d="M455 170 Q600 158 745 170 L700 196 L640 214 L600 226 L560 213 L500 196Z" fill="url(#h-rock)" />
        <ellipse cx="600" cy="169" rx="150" ry="13" fill="#134e4a" opacity=".85" />
        <ellipse cx="600" cy="168" rx="150" ry="13" fill="none" stroke="#5eead4" strokeOpacity=".55" strokeWidth="1.2" />
        <ellipse cx="600" cy="168" rx="400" ry="16" fill="none" stroke="#38bdf8" strokeOpacity=".5" strokeWidth="1.2" filter="url(#h-glow)" />
        <ellipse cx="600" cy="170" rx="300" ry="11" fill="none" stroke="#a78bfa" strokeOpacity=".55" strokeDasharray="6 8" strokeWidth="1" style={A ? { animation: 'dash-flow 3s linear infinite' } : undefined} />

        {/* skyline */}
        {towers.map((t, i) => (
          <g key={i}>
            <rect x={t.x} y={168 - t.h} width={t.w} height={t.h} fill={t.hue === 265 ? 'url(#h-tower-v)' : 'url(#h-tower-c)'} />
            <rect x={t.x} y={168 - t.h} width={t.w} height="1.4" fill={t.hue === 265 ? '#e9d5ff' : '#a5f3fc'} opacity=".9" />
            {t.spire && <line x1={t.x + t.w / 2} y1={168 - t.h} x2={t.x + t.w / 2} y2={168 - t.h - 14} stroke={t.hue === 265 ? '#d8b4fe' : '#67e8f9'} strokeWidth="1" />}
            {Array.from({ length: Math.floor(t.h / 9) }, (_, k) => (
              <rect key={k} x={t.x + 2} y={168 - t.h + 5 + k * 9} width={t.w - 4} height="1.6" fill={t.hue === 265 ? '#f0abfc' : '#67e8f9'} opacity={((k * 7 + i) % 5) / 6 * t.lit + .1} />
            ))}
          </g>
        ))}

        {/* dome glow + glass */}
        <ellipse cx="600" cy="140" rx="170" ry="70" fill="#a855f7" opacity=".25" filter="url(#h-soft)" />
        <path d="M478 168 A122 132 0 0 1 722 168 Z" fill="url(#h-dome)" />
        <path d="M478 168 A122 132 0 0 1 722 168" fill="none" stroke="url(#h-domeEdge)" strokeWidth="2" filter="url(#h-glow)" />
        <path d="M505 160 A96 112 0 0 1 560 58" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="3" strokeLinecap="round" />
        {/* dome meridians */}
        <g fill="none" stroke="#c4b5fd" strokeOpacity=".22" strokeWidth=".8">
          <path d="M600 36 Q540 100 520 168" /><path d="M600 36 Q660 100 680 168" /><path d="M600 36 V168" />
          <path d="M500 120 Q600 104 700 120" /><path d="M486 150 Q600 136 714 150" />
        </g>

        {/* tree of light */}
        <ellipse cx="600" cy="74" rx="118" ry="64" fill="url(#h-canopy)" filter="url(#h-soft)" />
        <path d="M588 170 C592 150 594 128 596 104 L604 104 C606 128 608 150 612 170 Z" fill="url(#h-trunk)" filter="url(#h-glow)" />
        <path d="M588 170 Q570 172 552 178 M612 170 Q630 172 648 178 M596 168 Q585 176 575 184 M604 168 Q615 176 625 184" stroke="#d8b4fe" strokeWidth="2" fill="none" opacity=".8" filter="url(#h-glow)" />
        <g filter="url(#h-glow)" style={A ? { animation: 'glow-breathe 4s ease-in-out infinite' } : undefined}>
          {branches.map((b, i) => <path key={i} d={b.d} stroke="url(#h-tree)" strokeWidth={b.w} strokeOpacity={b.o} fill="none" strokeLinecap="round" />)}
        </g>
        <ellipse cx="600" cy="80" rx="92" ry="46" fill="#f0abfc" opacity=".42" filter="url(#h-soft)" />
        <ellipse cx="600" cy="76" rx="56" ry="28" fill="#fdf4ff" opacity=".28" filter="url(#h-soft)" />
        <g>
          {leaves.map((l, i) => <circle key={i} cx={l.x} cy={l.y} r={l.r} fill={i % 3 ? '#f5d0fe' : '#a5f3fc'} opacity=".9" style={A ? { animation: `twinkle ${2 + (i % 5) * .5}s ease-in-out ${(i % 7) * .3}s infinite` } : undefined} />)}
        </g>
        <path d="M594 168 Q598 150 596 132 L604 132 Q602 150 606 168Z" fill="#e9d5ff" opacity=".8" filter="url(#h-glow)" />

        {/* orbit ring */}
        <ellipse cx="600" cy="166" rx="215" ry="26" fill="none" stroke="#22d3ee" strokeOpacity=".85" strokeWidth="2.2" filter="url(#h-glow)" />
        <ellipse cx="600" cy="170" rx="250" ry="32" fill="none" stroke="#e879f9" strokeOpacity=".6" strokeWidth="1.6" filter="url(#h-glow)" style={A ? { animation: 'glow-breathe 3.4s ease-in-out infinite' } : undefined} />
        <ellipse cx="600" cy="164" rx="175" ry="19" fill="none" stroke="#a5f3fc" strokeOpacity=".5" strokeWidth="1" strokeDasharray="10 14" style={A ? { animation: 'dash-flow 2.2s linear infinite' } : undefined} />

        {/* drones */}
        {[{ x: 330, y: 52, d: 0 }, { x: 860, y: 70, d: 1.4 }, { x: 990, y: 40, d: .6 }, { x: 250, y: 96, d: 2 }].map((dr, i) => (
          <g key={i} style={A ? { animation: `float-y ${3.6 + i * .7}s ease-in-out ${dr.d}s infinite` } : undefined}>
            <g transform={`translate(${dr.x} ${dr.y})`}>
              <ellipse cx="0" cy="0" rx="12" ry="3.6" fill="#c7d2fe" />
              <rect x="-4" y="-5" width="8" height="5" rx="2" fill="#e0e7ff" />
              <line x1="-18" y1="-4" x2="-6" y2="-4" stroke="#c7d2fe" strokeWidth="1.2" /><line x1="6" y1="-4" x2="18" y2="-4" stroke="#c7d2fe" strokeWidth="1.2" />
              <circle cx="0" cy="3" r="1.6" fill="#22d3ee" filter="url(#h-glow)" />
              <path d="M-5 4 L-14 34 L14 34 L5 4Z" fill="#22d3ee" opacity=".07" />
            </g>
          </g>
        ))}
      </g>
    </svg>
  );
});
