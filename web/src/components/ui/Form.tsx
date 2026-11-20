import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { HelpTrigger } from './HelpTrigger';
import { cx } from '@/lib/format';

export function Field({ label, help, hint, error, children, required, htmlFor }: { label: string; help?: string; hint?: ReactNode; error?: string; children: ReactNode; required?: boolean; htmlFor?: string }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}{required && <span className="bad" aria-hidden>*</span>}
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
    <div role="radiogroup" aria-label={ariaLabel} className={cx('segmented', size)}>
      {options.map((o) => {
        const sel = o.key === value;
        return (
          <button key={o.key} type="button" role="radio" aria-checked={sel} title={o.title} onClick={() => onChange(o.key)} className="seg-btn">
            {sel && <motion.span layoutId={`seg-${ariaLabel}`} className="seg-thumb" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
            <span style={{ position: 'relative', zIndex: 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
