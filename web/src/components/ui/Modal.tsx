import { motion } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, type LucideIcon } from 'lucide-react';
import { HelpTrigger } from './HelpTrigger';
import { IconButton } from './IconButton';
import { cx } from '@/lib/format';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]):not([disabled])';

export interface ModalProps {
  title: ReactNode;
  icon?: LucideIcon;
  help?: string;
  sub?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  tone?: 'default' | 'danger' | 'warn';
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  dialogId?: string;
  drawer?: boolean;
}

/** Accessible modal (spec §5): focus trap, Escape, focus restore, mobile full-screen, AN-45/46. */
export function Modal({ title, icon: Icon, help, sub, size = 'md', tone = 'default', onClose, footer, children, dialogId, drawer }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    prevFocus.current = document.activeElement as HTMLElement;
    const el = ref.current!;
    const first = (el.querySelector('[data-autofocus]:not([disabled])') as HTMLElement) ?? (el.querySelector('.modal-body ' + FOCUSABLE) as HTMLElement) ?? el;
    // never steal focus from a field the user (or a fast typist) already focused inside the dialog (cycle 43)
    window.setTimeout(() => { if (!el.contains(document.activeElement) || document.activeElement === el) first?.focus(); }, 30);
    // Escape closes the top-most modal even before focus has moved inside it
    const onEsc = (e: KeyboardEvent) => {
      if ((e.key !== 'Escape' && e.key !== 'Tab') || e.defaultPrevented) return;
      const layers = document.querySelectorAll('.modal-layer');
      if (layers[layers.length - 1] !== el.closest('.modal-layer')) return;
      const a = document.activeElement;
      if (el.contains(a)) return; // handled by onKeyDown below
      // focus inside a popover/menu/tooltip (Radix portal) or another dialog: leave it alone
      if (a && a !== document.body && a.closest('[data-radix-popper-content-wrapper], [role="dialog"], [role="menu"]')) return;
      e.preventDefault();
      if (e.key === 'Escape') onCloseRef.current();
      else ((el.querySelector('.modal-body ' + FOCUSABLE) as HTMLElement) ?? el).focus(); // pull focus into the trap
    };
    window.addEventListener('keydown', onEsc);
    return () => { window.removeEventListener('keydown', onEsc); window.setTimeout(() => prevFocus.current?.focus?.(), 0); };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // React events bubble through portals: ignore keys from popovers/menus rendered outside the dialog box
    if (!ref.current?.contains(e.target as Node)) return;
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const items = Array.from(ref.current!.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return createPortal(
    <div className={cx('modal-layer', drawer && 'drawer-layer')} onKeyDown={onKeyDown}>
      <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        data-dialog={dialogId}
        className={cx('modal', `modal-${size}`, tone !== 'default' && `modal-${tone}`, drawer && 'modal-drawer')}
        initial={drawer ? { opacity: 0, x: 40 } : { opacity: 0, scale: 0.965, y: 12 }}
        animate={drawer ? { opacity: 1, x: 0 } : { opacity: 1, scale: 1, y: 0 }}
        exit={drawer ? { opacity: 0, x: 40 } : { opacity: 0, scale: 0.98, y: 6 }}
        transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <header className="modal-head">
          {Icon && <span className={cx('modal-icon', tone !== 'default' && tone)}><Icon size={20} aria-hidden /></span>}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="row"><h2 id="modal-title" className="modal-title">{title}</h2>{help && <HelpTrigger k={help} />}</div>
            {sub && <div className="dim" style={{ fontSize: 12.5, marginTop: 2 }}>{sub}</div>}
          </div>
          <IconButton icon={X} label="Close (Esc)" onClick={onClose} size="sm" />
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </motion.div>
    </div>,
    document.body,
  );
}
