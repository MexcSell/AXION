import { animate, useInView, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useSettings } from '@/store/settings';

/** Animated number (AN-49 counters). Honors reduced motion. */
export function CountUp({ value, decimals = 0, prefix = '', suffix = '', duration = 1.1 }: { value: number; decimals?: number; prefix?: string; suffix?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const pref = useSettings((s) => s.motion);
  const reduce = useReducedMotion() || pref === 'reduced';
  const [v, setV] = useState(reduce ? value : 0);
  const prev = useRef(0);
  useEffect(() => {
    if (!inView) return;
    if (reduce) { setV(value); return; }
    const c = animate(prev.current, value, { duration, ease: [0.2, 0.8, 0.2, 1], onUpdate: setV });
    prev.current = value;
    return () => c.stop();
  }, [value, inView, reduce, duration]);
  return <span ref={ref} className="tnum">{prefix}{v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</span>;
}
