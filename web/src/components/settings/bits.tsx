import type { ReactNode } from 'react';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import '@/theme/pages/settings-ops-help.css';

/** Labelled setting row: label + ? + description on the left, control on the right. */
export function Row({ label, desc, help, children }: { label: string; desc?: ReactNode; help?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ fontWeight: 600, fontSize: 13 }}>{label}{help && <HelpTrigger k={help} />}</div>
        {desc && <div className="dim" style={{ fontSize: 12 }}>{desc}</div>}
      </div>
      <div className="set-ctl">{children}</div>
    </div>
  );
}

export function MiniStat({ label, value, tone = 'info', sub, help }: { label: string; value: ReactNode; tone?: 'good' | 'warn' | 'bad' | 'info' | 'violet'; sub?: ReactNode; help?: string }) {
  return (
    <div className="mini-stat" style={{ ['--kc' as string]: `var(--${tone})`, ['--kc-rgb' as string]: `var(--${tone}-rgb)` }}>
      <div className="dim row" style={{ fontSize: 11.5, gap: 4 }}>{label}{help && <HelpTrigger k={help} />}</div>
      <div className="display" style={{ fontSize: 24, fontWeight: 700, color: 'var(--kc)' }}>{value}</div>
      {sub && <div className="dim" style={{ fontSize: 11.5 }}>{sub}</div>}
    </div>
  );
}

export const SHORTCUTS: [string[], string, string][] = [
  [['Ctrl', 'K'], 'Open the command palette', 'Global'],
  [['Ctrl', 'B'], 'Collapse or expand the side rail', 'Global'],
  [['?'], 'Open the shortcut list', 'Global'],
  [['Esc'], 'Close dialog, drawer or palette', 'Global'],
  [['Ctrl', 'Enter'], 'Send a command in the composer', 'Mission Control'],
  [['←', '→'], 'Move between tabs', 'Tabs'],
  [['Tab'], 'Move focus; Shift + Tab goes back', 'Global'],
];

