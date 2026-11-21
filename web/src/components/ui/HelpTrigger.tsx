import * as P from '@radix-ui/react-popover';
import { BookOpen, Lightbulb, Lock, Sparkles, Keyboard, Cog, X, PanelRightOpen } from 'lucide-react';
import { openDialog } from '@/store/ui';
import { Link } from 'react-router-dom';
import type { HelpEntry } from '@/help/registry';
import { LOADING_HELP, loadHelp, useHelpRegistry } from '@/help/load';
import { Tip } from './Tip';

/** The universal "?" (spec §9.1). Opens an anchored popover with What / Why / How / Example / Permission. */
export function HelpTrigger({ k, entry, label }: { k?: string; entry?: HelpEntry; label?: string }) {
  const reg = useHelpRegistry();
  const e = entry ?? (reg ? reg.getHelp(k ?? '') : LOADING_HELP);
  const warm = () => { void loadHelp(); };
  return (
    <P.Root>
      <Tip label={label ?? `Help: ${e.title}`}>
        <P.Trigger asChild>
          <button type="button" className="help-btn" aria-label={`Help: ${e.title}`} data-help-key={k} onPointerEnter={warm} onFocus={warm} onClick={warm}>?</button>
        </P.Trigger>
      </Tip>
      <P.Portal>
        <P.Content className="popover help-pop" sideOffset={8} collisionPadding={12} align="start">
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="center" style={{ width: 26, height: 26, borderRadius: 8, background: 'rgba(var(--accent-2-rgb),.15)', color: 'var(--accent-2)' }}><Lightbulb size={15} /></span>
            <strong style={{ fontSize: 15 }}>{e.title}</strong>
            <span className="spacer" />
            {k && <P.Close className="icon-btn xs" aria-label="Open help in side drawer" title="Open in drawer" onClick={() => openDialog('help-drawer', { k })}><PanelRightOpen size={13} /></P.Close>}
            <P.Close className="icon-btn xs" aria-label="Close help"><X size={13} /></P.Close>
          </div>
          <HelpBody e={e} />
          <P.Arrow width={12} height={6} style={{ fill: 'var(--border-strong)' }} />
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

export function HelpBody({ e }: { e: HelpEntry }) {
  return (
    <div className="col" style={{ gap: 9, fontSize: 13, lineHeight: 1.5 }}>
      <p style={{ color: 'var(--text-2)' }}>{e.what}</p>
      {e.why && <Section icon={Sparkles} label="Why it matters">{e.why}</Section>}
      {e.how && <Section icon={Cog} label="How it works">{e.how}</Section>}
      {e.example && <Section icon={BookOpen} label="Example">{e.example}</Section>}
      {e.permission && <Section icon={Lock} label="Permission / limits">{e.permission}</Section>}
      {e.shortcut && <Section icon={Keyboard} label="Shortcut"><span className="kbd">{e.shortcut}</span></Section>}
      {e.route && <Link to={e.route} style={{ fontWeight: 600 }}>More detail →</Link>}
    </div>
  );
}

function Section({ icon: Icon, label, children }: { icon: typeof Lock; label: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--panel-2)', border: '1px solid var(--border-soft)' }}>
      <div className="row" style={{ gap: 6, fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--accent-2)', marginBottom: 3 }}>
        <Icon size={12} /> {label}
      </div>
      <div style={{ color: 'var(--text-2)' }}>{children}</div>
    </div>
  );
}
