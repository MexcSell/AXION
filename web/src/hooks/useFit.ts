import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * "Show only what fits" — for no-scroll screens. The container must get its height from layout
 * (flex/grid, min-height 0, overflow hidden), not from its content. Returns how many items of
 * `total` fit whole: rows that fit × grid columns. Items are assumed roughly uniform in height;
 * the first rendered item (or `item` selector) is the yardstick. Always at least 1.
 */
export function useFitCount<T extends HTMLElement = HTMLDivElement>(total: number, opts: { item?: string; reserve?: string; min?: number } = {}) {
  const ref = useRef<T>(null);
  const [n, setN] = useState(total);
  const { item, reserve, min = 1 } = opts;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // only clip when the layout clips (desktop fit mode); elsewhere the box grows with content
      if (getComputedStyle(el).overflowY !== 'hidden') { setN(total); return; }
      const unit = (item ? el.querySelector(item) : el.firstElementChild) as HTMLElement | null;
      if (!unit) return;
      const grid = (item ? unit.parentElement : el) ?? el;
      const cs = getComputedStyle(grid);
      const gap = parseFloat(cs.rowGap) || 0;
      const cols = cs.display.includes('grid') ? cs.gridTemplateColumns.split(' ').filter(Boolean).length : 1;
      const res = reserve ? (el.querySelector(reserve) as HTMLElement | null)?.offsetHeight ?? 0 : 0;
      const ih = unit.offsetHeight;
      if (!ih) return;
      const own = getComputedStyle(el);
      const inner = el.clientHeight - parseFloat(own.paddingTop) - parseFloat(own.paddingBottom) - res;
      const rows = Math.floor((inner + gap + 0.5) / (ih + gap));
      setN(Math.max(min, Math.min(total, rows * cols)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [total, item, reserve, min]);
  return [ref, Math.min(n, total)] as const;
}

/** Live height of an element (for charts that take a pixel height). */
export function useHeight<T extends HTMLElement = HTMLDivElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [h, setH] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight || fallback));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, h] as const;
}

/** Live media-query match. */
export function useMedia(q: string) {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia(q); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); },
    () => window.matchMedia(q).matches,
    () => false,
  );
}
