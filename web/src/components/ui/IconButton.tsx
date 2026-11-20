import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Tip } from './Tip';
import { cx } from '@/lib/format';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;          // accessible name + tooltip (mandatory, spec §3.2 IconAction)
  size?: 'xs' | 'sm' | 'md';
  variant?: 'default' | 'bordered' | 'active' | 'danger';
  badge?: ReactNode;
  tipSide?: 'top' | 'bottom' | 'left' | 'right';
  shortcut?: string;
  iconSize?: number;
}

export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { icon: Icon, label, size = 'md', variant = 'default', badge, tipSide, shortcut, iconSize, className, ...rest }, ref,
) {
  const px = iconSize ?? (size === 'xs' ? 13 : size === 'sm' ? 15 : 18);
  return (
    <Tip label={label} side={tipSide} shortcut={shortcut}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        className={cx('icon-btn', size !== 'md' && size, variant !== 'default' && variant, className)}
        {...rest}
      >
        <Icon size={px} strokeWidth={2} aria-hidden />
        {badge != null && badge !== 0 && <span className="badge badge-dot" style={{ position: 'absolute', top: -5, right: -6 }}>{badge}</span>}
      </button>
    </Tip>
  );
});
