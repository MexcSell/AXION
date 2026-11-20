import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp } from 'lucide-react';
import { CountUp } from '@/components/ui/CountUp';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Tabs } from '@/components/ui/Tabs';
import { cx } from '@/lib/format';
import '@/theme/frame.css';

/* ================================================================== */
/* Shared page frame — the parts that are identical on every screen.   */
/*   TopBoard    : icon · title · ? · subtitle · actions               */
/*                 KPI tiles (KpiTile, one design everywhere)          */
/*                 tab row (+ per-tab toolbar on the right)            */
/*   BottomBoard : a row of summary boards, collapsible                */
/* Pages only supply their numbers and their tab content.              */
/* ================================================================== */

export interface KpiItem {
  key: string; icon: LucideIcon; value: number; label: string; color: string;
  prefix?: string; suffix?: string; decimals?: number;
  /** trend under the value; `down` shows a down arrow (still green: lower is better) */
  delta?: string; down?: boolean;
  /** small grey line under the label */
  hint?: ReactNode;
  /** 0–100: thin progress bar under the label */
  bar?: number;
  /** any extra node (rare) */
  foot?: ReactNode;
  help?: string;
  onClick?: () => void;
}

/** One KPI tile design for the whole app (40-4 command-center style). */
export function KpiTile({ k, i = 0 }: { k: KpiItem; i?: number }) {
  const click = k.onClick;
  return (
    <motion.div
      className={cx('kpi kt', click && 'kt-click')}
      role={click ? 'button' : undefined}
      tabIndex={click ? 0 : undefined}
      onClick={click}
      onKeyDown={click ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); click(); } } : undefined}
      style={{ ['--kc' as string]: k.color }}
      initial={{ opacity: 0, y: 12, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: .06 + i * .05, duration: .35 }}
      aria-label={`${k.label}: ${k.prefix ?? ''}${k.value}${k.suffix ?? ''}`}
    >
      <k.icon size={32} strokeWidth={1.6} className="kpi-ico" aria-hidden />
      <div className="kt-body">
        <div className="kt-top">
          <span className="kpi-val"><CountUp value={k.value} decimals={k.decimals} prefix={k.prefix} suffix={k.suffix} /></span>
          {k.delta && <span className="kpi-delta">{k.down ? <ArrowDown size={13} strokeWidth={3} /> : <ArrowUp size={13} strokeWidth={3} />}{k.delta}</span>}
        </div>
        <div className="kpi-label">{k.label}</div>
        {k.hint != null && <div className="kt-hint">{k.hint}</div>}
        {k.bar != null && <div className="bar thin good kt-bar"><motion.i initial={{ width: 0 }} animate={{ width: `${k.bar}%` }} transition={{ duration: 1.1, delay: .35 }} /></div>}
        {k.foot}
      </div>
      {k.help && <span className="kt-help" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}><HelpTrigger k={k.help} /></span>}
    </motion.div>
  );
}

export function KpiBoard({ items }: { items: KpiItem[] }) {
  return (
    <div className="kt-row" style={{ ['--kt-n' as string]: items.length }}>
      {items.map((k, i) => <KpiTile key={k.key} k={k} i={i} />)}
    </div>
  );
}

export interface FrameTabs {
  tabs: string[]; value: string; onChange: (t: string) => void;
  icons?: LucideIcon[]; counts?: Record<string, number | string | undefined>; ariaLabel: string;
}

const FOLD_EASE = [0.2, 0.8, 0.2, 1] as const;
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const readTopOpen = (k: string) => {
  try { return localStorage.getItem(`axion.top.${k}`) !== '0'; } catch { return true; }
};

/** The top board shown on every page. It folds (like the bottom board) into one compact row:
 *  icon · title · tabs · toolbar · actions. Subtitle, KPI tiles, extras and the aside are hidden. */
export function TopBoard({ id, icon: Icon, title, help, sub, actions, kpis, tabs, toolbar, aside, children, className }: {
  /** storage key for the fold state; defaults to the title */
  id?: string;
  icon: LucideIcon; title: ReactNode; help?: string; sub?: ReactNode; actions?: ReactNode;
  kpis?: KpiItem[]; tabs?: FrameTabs; toolbar?: ReactNode; aside?: ReactNode; children?: ReactNode; className?: string;
}) {
  const name = typeof title === 'string' ? title : 'page header';
  const key = id ?? slug(name);
  const [open, setOpen] = useState(() => readTopOpen(key));
  /* `compact` (single-row layout) switches on only after the fold animation has finished */
  const [compact, setCompact] = useState(() => !open);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const toggle = () => {
    const n = !open;
    window.clearTimeout(timer.current);
    setOpen(n);
    if (n) setCompact(false); else timer.current = window.setTimeout(() => setCompact(true), 260);
    try { localStorage.setItem(`axion.top.${key}`, n ? '1' : '0'); } catch { /* storage blocked */ }
  };
  const fold = { initial: { height: 0, opacity: 0 }, animate: { height: 'auto', opacity: 1 }, exit: { height: 0, opacity: 0 }, transition: { duration: .26, ease: FOLD_EASE } };
  const showAside = aside && open;
  return (
    <div className={cx('tb-wrap', showAside ? 'has-aside' : false, className)}>
      <div className={cx('tb-main', compact && 'folded')}>
        <motion.section className="panel topboard" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .35 }}
          aria-label={typeof title === 'string' ? title : undefined}>
          <header className="tb-head">
            <span className="tb-icon"><Icon size={compact ? 20 : 24} aria-hidden /></span>
            <div className="tb-titles">
              <div className="row" style={{ gap: 8 }}><h1 className="tb-title">{title}</h1>{help && <HelpTrigger k={help} />}</div>
              <AnimatePresence initial={false}>
                {sub && open && <motion.p key="sub" className="tb-sub" style={{ overflow: 'hidden' }} {...fold}>{sub}</motion.p>}
              </AnimatePresence>
            </div>
            <span className="spacer" />
            {actions && <div className="tb-actions">{actions}</div>}
          </header>
          <AnimatePresence initial={false}>
            {open && kpis && kpis.length > 0 && (
              <motion.div key="kpis" className="tb-fold" {...fold}><KpiBoard items={kpis} /></motion.div>
            )}
          </AnimatePresence>
          {open && children}
          {tabs && (
            <div className="tb-tabs">
              <Tabs tabs={tabs.tabs.map((t, i) => ({ key: t, label: t, icon: tabs.icons?.[i], count: tabs.counts?.[t] }))}
                value={tabs.value} onChange={tabs.onChange} ariaLabel={tabs.ariaLabel} />
              <span className="spacer" />
              {toolbar && <div className="tb-toolbar">{toolbar}</div>}
            </div>
          )}
        </motion.section>
        <button type="button" className="tb-toggle" onClick={toggle} aria-expanded={open}
          aria-label={open ? `Minimize ${name} header` : `Expand ${name} header`} title={open ? 'Minimize header' : 'Expand header'}>
          <motion.span animate={{ rotate: open ? 0 : 180 }} style={{ display: 'inline-flex' }}><ChevronUp size={13} /></motion.span>
        </button>
      </div>
      {showAside && aside}
    </div>
  );
}

/** Standard tab body: animated swap + the page's single scroll region. */
export function FrameBody({ tab, children, className, panel = true, head, scroll = true }: {
  tab: string; children: ReactNode; className?: string; panel?: boolean;
  /** fixed row above the scrolling region (filters, chips) */
  head?: ReactNode;
  /** false: the child manages its own viewport (e.g. a zoom canvas) */
  scroll?: boolean;
}) {
  const body = (
    <AnimatePresence mode="wait">
      <motion.div key={tab} className={cx(scroll ? 'fit-scroll' : 'fit-fill', className)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .2 }}
        role="tabpanel" aria-label={tab}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
  return panel ? <section className="panel tight fit-fill frame-body">{head && <div className="fb-head">{head}</div>}{body}</section> : body;
}

/** Viewer's choice wins; otherwise the board starts folded on short screens so the tab content keeps its room. */
const readOpen = (k: string) => {
  let v: string | null = null;
  try { v = localStorage.getItem(`axion.bottom.${k}`); } catch { /* storage blocked */ }
  return v != null ? v !== '0' : typeof window === 'undefined' || window.innerHeight >= 880;
};

/** The bottom board: a row of summary boards that can be folded away to give the content more room. */
export function BottomBoard({ id, title, children, cols }: { id: string; title: string; children: ReactNode; cols?: string }) {
  const [open, setOpen] = useState(() => readOpen(id));
  const toggle = () => { const n = !open; setOpen(n); try { localStorage.setItem(`axion.bottom.${id}`, n ? '1' : '0'); } catch { /* ignore */ } };
  return (
    <section className={cx('bottomboard', !open && 'folded')} aria-label={title}>
      <button type="button" className="bb-toggle" onClick={toggle} aria-expanded={open} aria-label={open ? `Hide ${title}` : `Show ${title}`}>
        <span>{title}</span><motion.span animate={{ rotate: open ? 0 : 180 }} style={{ display: 'inline-flex' }}><ChevronDown size={14} /></motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="bb-grid" style={cols ? { gridTemplateColumns: cols } : undefined}
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: .28, ease: [0.2, 0.8, 0.2, 1] }}>
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
