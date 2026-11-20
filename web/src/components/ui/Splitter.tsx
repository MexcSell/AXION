import { useCallback, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { cx } from '@/lib/format';

/*
 * Draggable vertical divider between two panes (owner request 2026-11-20 (c)).
 * The parent owns the width of ONE neighbouring pane (`pane="prev"` = the pane left of the divider,
 * `"next"` = the pane to its right) and applies it as a CSS width / variable.
 * Widths are per-viewer conveniences, persisted in localStorage under `axion.split.<key>`.
 * Drag clamps against the live container (min px … maxFrac of the parent). The pane's CSS must use the
 * SAME rule — clamp(<min>px, var(--w), <maxFrac>%) — so a width saved on a large screen cannot crush
 * the neighbour on a small one, and the rendered width never exceeds what a drag can reach.
 * Keyboard: ←/→ move 16 px (Shift = 64 px), Home/End = min/max, Enter or double-click = reset.
 */

const PREFIX = 'axion.split.';

export function usePaneWidth(key: string, initial: number): [number, (w: number, persist?: boolean) => void, () => void] {
  const [w, setW] = useState<number>(() => {
    try { const v = Number(localStorage.getItem(PREFIX + key)); return Number.isFinite(v) && v > 0 ? v : initial; } catch { return initial; }
  });
  const set = useCallback((next: number, persist = true) => {
    const r = Math.round(next);
    setW(r);
    if (persist) { try { localStorage.setItem(PREFIX + key, String(r)); } catch { /* storage blocked: width just won't persist */ } }
  }, [key]);
  const reset = useCallback(() => {
    setW(initial);
    try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
  }, [key, initial]);
  return [w, set, reset];
}

export function Splitter({ pane, width, onChange, onReset, min = 200, maxFrac = .6, reserve = 0, label, className, style }: {
  pane: 'prev' | 'next';
  width: number;
  onChange: (w: number, persist?: boolean) => void;
  onReset?: () => void;
  min?: number;
  /** maximum share of the parent's width the controlled pane may take */
  maxFrac?: number;
  /** px the other pane(s) must keep — tightens the max further */
  reserve?: number;
  label: string;
  className?: string;
  style?: CSSProperties;
}) {
  const el = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; start: number; max: number } | null>(null);
  const [active, setActive] = useState(false);

  const target = () => (pane === 'prev' ? el.current?.previousElementSibling : el.current?.nextElementSibling) as HTMLElement | null | undefined;
  const maxFor = () => {
    const parent = el.current?.parentElement?.clientWidth ?? 2000;
    return Math.max(min, Math.min(parent * maxFrac, parent - reserve));
  };
  const clamp = (v: number, max = maxFor()) => Math.max(min, Math.min(max, v));
  const dir = pane === 'prev' ? 1 : -1;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.current?.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, start: target()?.getBoundingClientRect().width ?? width, max: maxFor() };
    setActive(true);
    document.body.classList.add('is-resizing');
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d) return;
    onChange(clamp(d.start + dir * (e.clientX - d.x), d.max), false);
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d) return;
    drag.current = null;
    setActive(false);
    document.body.classList.remove('is-resizing');
    try { el.current?.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (Math.abs(e.clientX - d.x) < 2) return; // a click is not a resize: never change or persist
    onChange(clamp(d.start + dir * (e.clientX - d.x), d.max), true);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    const cur = target()?.getBoundingClientRect().width ?? width;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); onChange(clamp(cur + (e.key === 'ArrowRight' ? step : -step) * dir)); }
    else if (e.key === 'Home') { e.preventDefault(); onChange(min); }
    else if (e.key === 'End') { e.preventDefault(); onChange(maxFor()); }
    else if (e.key === 'Enter' && onReset) { e.preventDefault(); onReset(); }
  };

  return (
    <div
      ref={el}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      tabIndex={0}
      title={`${label} — drag to resize, double-click to reset`}
      className={cx('splitter', active && 'active', className)}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    >
      <span className="splitter-line" />
      <span className="splitter-grip"><i /><i /><i /></span>
    </div>
  );
}
