/** Stylized "screenshot" thumbnail for fixture evidence (no real image bytes in DEMO data). */
export function EvidenceThumb({ seed, w = 92, h = 58 }: { seed: string; w?: number; h?: number }) {
  const hue = [...seed].reduce((s, c) => s + c.charCodeAt(0), 0) % 360;
  return (
    <svg width={w} height={h} viewBox="0 0 92 58" aria-hidden style={{ borderRadius: 6, flex: 'none' }}>
      <rect width="92" height="58" fill={`hsl(${hue} 40% 14%)`} />
      <rect width="92" height="8" fill={`hsl(${hue} 30% 22%)`} />
      <circle cx="5" cy="4" r="1.5" fill="#f87171" /><circle cx="10" cy="4" r="1.5" fill="#fbbf24" /><circle cx="15" cy="4" r="1.5" fill="#34d399" />
      <rect x="6" y="13" width="40" height="5" rx="2" fill={`hsl(${hue} 80% 70%)`} opacity=".9" />
      <rect x="6" y="21" width="60" height="3" rx="1.5" fill="#cbd5e1" opacity=".4" />
      <rect x="6" y="27" width="52" height="3" rx="1.5" fill="#cbd5e1" opacity=".3" />
      <rect x="6" y="36" width="24" height="16" rx="3" fill={`hsl(${(hue + 60) % 360} 70% 55%)`} opacity=".7" />
      <rect x="34" y="36" width="24" height="16" rx="3" fill={`hsl(${(hue + 120) % 360} 70% 55%)`} opacity=".6" />
      <rect x="62" y="36" width="24" height="16" rx="3" fill={`hsl(${(hue + 180) % 360} 70% 55%)`} opacity=".5" />
    </svg>
  );
}
