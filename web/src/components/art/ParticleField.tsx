import { useEffect, useRef } from 'react';

/** Ambient star-dust for Luminous/Fancy skins. Cheap canvas, pauses when tab hidden; disabled in reduced motion. */
export function ParticleField({ count = 55 }: { count?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    let w = 0, h = 0, raf = 0, running = true;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => { w = window.innerWidth; h = window.innerHeight; c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize();
    const hues = [190, 265, 290, 210];
    const ps = Array.from({ length: count }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - .5) * .12, vy: -.04 - Math.random() * .14, r: .5 + Math.random() * 1.4, h: hues[Math.floor(Math.random() * hues.length)], a: .2 + Math.random() * .6, t: Math.random() * 6 }));
    const tick = () => {
      if (!running) return;
      ctx.clearRect(0, 0, w, h);
      for (const p of ps) {
        p.x += p.vx; p.y += p.vy; p.t += .015;
        if (p.y < -5) { p.y = h + 5; p.x = Math.random() * w; }
        if (p.x < -5) p.x = w + 5; else if (p.x > w + 5) p.x = -5;
        const a = p.a * (.55 + .45 * Math.sin(p.t));
        ctx.beginPath();
        ctx.fillStyle = `hsla(${p.h} 95% 72% / ${a})`;
        ctx.shadowColor = `hsla(${p.h} 95% 65% / ${a})`;
        ctx.shadowBlur = 6;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    const vis = () => { running = !document.hidden; if (running) { cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); } };
    raf = requestAnimationFrame(tick);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', vis);
    return () => { running = false; cancelAnimationFrame(raf); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', vis); };
  }, [count]);
  return <canvas ref={ref} className="app-bg-canvas" aria-hidden style={{ opacity: .8 }} />;
}
