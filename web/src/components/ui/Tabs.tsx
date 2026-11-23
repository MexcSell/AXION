import { motion } from 'motion/react';
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from '@/lib/format';

export interface TabDef<K extends string = string> { key: K; label: string; icon?: LucideIcon; count?: number | string; }

/** Accessible tabs: roving focus, Home/End/arrows; shared animated pill/underline (AN-05). */
export function Tabs<K extends string>({ tabs, value, onChange, variant = 'pill', className, ariaLabel, size, collapse }: {
  tabs: TabDef<K>[]; value: K; onChange: (k: K) => void; variant?: 'pill' | 'underline'; className?: string; ariaLabel?: string; size?: 'sm';
  /** icon-first: unselected tabs shrink to their icon (label kept as accessible name + tooltip) when the strip is narrow */
  collapse?: boolean;
}) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const strip = useRef<HTMLDivElement | null>(null);
  // a clipped strip must never be invisible: data-fade says which edge hides tabs (CSS draws the fade), and the selected tab is kept in view
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const measure = () => {
      const l = el.scrollLeft > 1, r = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      const v = l && r ? 'lr' : l ? 'l' : r ? 'r' : '';
      if (v) el.setAttribute('data-fade', v); else el.removeAttribute('data-fade');
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    Array.from(el.children).forEach((c) => ro?.observe(c));
    // webfonts swap in after first paint and change every tab's width
    void document.fonts?.ready.then(measure);
    return () => { el.removeEventListener('scroll', measure); ro?.disconnect(); };
  }, [tabs.length]);
  // c82: the strip scrolls to the selected tab only when the selection or the tab ids change. `tabs` is a new array on every parent
  // render, so keying on it snapped a scrolled-away strip back; the joined ids are a stable string.
  const idKey = tabs.map((t) => t.key).join('\u0001');
  /** Scroll a tab fully out of the 28 px edge fade (a 4 px breath beyond it). scrollLeft clamps at both ends, where no fade is drawn. */
  const reveal = (b: HTMLElement | null | undefined) => {
    const el = strip.current;
    if (!el || !b) return;
    const m = 32;
    if (b.offsetLeft < el.scrollLeft + m) el.scrollLeft = b.offsetLeft - m;
    else if (b.offsetLeft + b.offsetWidth > el.scrollLeft + el.clientWidth - m) el.scrollLeft = b.offsetLeft + b.offsetWidth - el.clientWidth + m;
  };
  useEffect(() => {
    reveal(refs.current[tabs.findIndex((t) => t.key === value)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, idKey]);
  const onKey = (e: KeyboardEvent, i: number) => {
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = tabs.length - 1;
    if (n >= 0) { e.preventDefault(); refs.current[n]?.focus(); onChange(tabs[n].key); }
  };
  return (
    <div ref={strip} role="tablist" aria-label={ariaLabel} className={cx('tabs', variant === 'underline' && 'underline', collapse && 'tabs-collapse', className)}>
      {tabs.map((t, i) => {
        const sel = t.key === value;
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            ref={(el) => { refs.current[i] = el; }}
            role="tab"
            type="button"
            id={`${id}-${t.key}`}
            aria-selected={sel}
            tabIndex={sel ? 0 : -1}
            className="tab"
            style={size === 'sm' ? { height: 28, padding: '0 10px', fontSize: 12 } : undefined}
            onClick={() => onChange(t.key)}
            onKeyDown={(e) => onKey(e, i)}
            onFocus={(e) => reveal(e.currentTarget)}
            data-tab={t.key}
            title={collapse && !sel ? t.label : undefined}
            aria-label={collapse ? (t.count != null ? `${t.label} (${t.count})` : t.label) : undefined}
          >
            {sel && <motion.span layoutId={`tabpill-${id}`} className="tab-pill" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
            <span className="tab-label">
              {Icon && <Icon size={15} aria-hidden />}
              <span className="tab-text">{t.label}</span>
              {t.count != null && <span className="tab-count" style={{ opacity: .8 }}>({t.count})</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ k, children }: { k: string; children: ReactNode }) {
  return (
    <motion.div key={k} role="tabpanel" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }} style={{ minWidth: 0 }}>
      {children}
    </motion.div>
  );
}
