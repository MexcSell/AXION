import { motion } from 'motion/react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { HelpTrigger } from './HelpTrigger';
import { cx } from '@/lib/format';

export function Field({ label, help, hint, error, children, required, htmlFor }: { label: string; help?: string; hint?: ReactNode; error?: string; children: ReactNode; required?: boolean; htmlFor?: string }) {
  const labelId = useId();
  const box = useRef<HTMLDivElement>(null);
  // a11y: when the control inside carries no name of its own (no id/htmlFor, aria-label, aria-labelledby), name it by this label
  useEffect(() => {
    if (htmlFor) return;
    const c = box.current?.querySelector<HTMLElement>('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea,select,[role=combobox],[role=slider]');
    if (c && !c.id && !c.hasAttribute('aria-label') && !c.hasAttribute('aria-labelledby')) c.setAttribute('aria-labelledby', labelId);
  });
  return (
    <div className="field" ref={box}>
      <label className="field-label" htmlFor={htmlFor}>
        <span id={labelId}>{label}</span>{required && <span className="bad" aria-hidden>*</span>}
        {help && <HelpTrigger k={help} />}
      </label>
      {children}
      {error ? <span className="field-error" role="alert">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!checked)} />
  );
}

export function SwitchRow({ label, desc, checked, onChange, help }: { label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void; help?: string }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', gap: 12, padding: '6px 0' }}>
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ fontWeight: 600, fontSize: 13 }}>{label}{help && <HelpTrigger k={help} />}</div>
        {desc && <div className="dim" style={{ fontSize: 12 }}>{desc}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

/** Segmented control with sliding thumb. */
export function Segmented<K extends string>({ options, value, onChange, ariaLabel, size }: { options: { key: K; label: ReactNode; title?: string }[]; value: K; onChange: (k: K) => void; ariaLabel: string; size?: 'sm' }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cx('segmented', size)}
      onKeyDown={(e) => {
        // WAI-ARIA radio group: Left/Up and Right/Down move to the previous/next option (wrapping) and select it; Home/End jump to the ends
        const keys = ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Home', 'End'];
        if (!keys.includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
        const i = options.findIndex((o) => o.key === value);
        const n = options.length;
        const to = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + n) % n;
        e.preventDefault();
        const group = e.currentTarget; // React clears currentTarget after the handler
        onChange(options[to].key);
        requestAnimationFrame(() => (group.querySelectorAll('[role="radio"]')[to] as HTMLElement | undefined)?.focus());
      }}>
      {options.map((o) => {
        const sel = o.key === value;
        return (
          <button key={o.key} type="button" role="radio" aria-checked={sel} tabIndex={sel ? 0 : -1} title={o.title} onClick={() => onChange(o.key)} className="seg-btn">
            {sel && <motion.span layoutId={`seg-${ariaLabel}`} className="seg-thumb" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
            <span style={{ position: 'relative', zIndex: 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
