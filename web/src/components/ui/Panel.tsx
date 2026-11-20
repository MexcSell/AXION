import { motion, type HTMLMotionProps } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { HelpTrigger } from './HelpTrigger';
import { cx } from '@/lib/format';

interface PanelProps extends Omit<HTMLMotionProps<'section'>, 'title' | 'children'> {
  children?: ReactNode;
  title?: ReactNode;
  sub?: ReactNode;
  icon?: LucideIcon;
  help?: string;
  actions?: ReactNode;
  tight?: boolean;
  flush?: boolean;
  delay?: number;
  titleSize?: 'md' | 'lg';
  headExtra?: ReactNode;
}

/** Glass panel with neon edge + standard head (icon · title · ? · sub · actions). Staggered entrance. */
export function Panel({ title, sub, icon: Icon, help, actions, tight, flush, delay = 0, className, children, titleSize = 'md', headExtra, ...rest }: PanelProps) {
  return (
    <motion.section
      className={cx('panel', tight && 'tight', flush && 'flush', className)}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38, delay, ease: [0.2, 0.8, 0.2, 1] }}
      aria-label={typeof title === 'string' ? title : undefined}
      {...rest}
    >
      {(title || actions) && (
        <header className="panel-head" style={flush ? { padding: '12px 14px 0' } : undefined}>
          {Icon && <Icon size={titleSize === 'lg' ? 26 : 19} className="ph-icon" aria-hidden />}
          {title && <h2 className={cx('panel-title', titleSize === 'lg' && 'lg')}>{title}</h2>}
          {help && <HelpTrigger k={help} />}
          {sub && <span className="panel-sub">{sub}</span>}
          {headExtra}
          <span className="spacer" />
          {actions}
        </header>
      )}
      {children}
    </motion.section>
  );
}

export function PageHeader({ icon: Icon, title, sub, help, actions, children }: { icon: LucideIcon; title: string; sub?: string; help?: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <motion.div className="page-header" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      <div className="row-3" style={{ minWidth: 0 }}>
        <span className="page-header-icon"><Icon size={26} aria-hidden /></span>
        <div style={{ minWidth: 0 }}>
          <div className="row"><h1 className="page-title">{title}</h1>{help && <HelpTrigger k={help} />}</div>
          {sub && <p className="page-sub">{sub}</p>}
        </div>
        <span className="spacer" />
        {actions}
      </div>
      {children}
    </motion.div>
  );
}
