import { motion } from 'motion/react';
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from '@/lib/format';

export interface TabDef<K extends string = string> { key: K; label: string; icon?: LucideIcon; count?: number | string; }

/** Accessible tabs: roving focus, Home/End/arrows; shared animated pill/underline (AN-05). */
export function Tabs<K extends string>({ tabs, value, onChange, variant = 'pill', className, ariaLabel, size }: {
  tabs: TabDef<K>[]; value: K; onChange: (k: K) => void; variant?: 'pill' | 'underline'; className?: string; ariaLabel?: string; size?: 'sm';
}) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = tabs.length - 1;
    if (n >= 0) { e.preventDefault(); refs.current[n]?.focus(); onChange(tabs[n].key); }
  };
  return (
    <div role="tablist" aria-label={ariaLabel} className={cx('tabs', variant === 'underline' && 'underline', className)}>
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
            data-tab={t.key}
          >
            {sel && <motion.span layoutId={`tabpill-${id}`} className="tab-pill" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
            <span className="tab-label">
              {Icon && <Icon size={15} aria-hidden />}
              {t.label}
              {t.count != null && <span style={{ opacity: .8 }}>({t.count})</span>}
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
