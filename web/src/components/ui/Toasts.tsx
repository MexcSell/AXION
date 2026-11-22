import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from 'lucide-react';
import { useUI } from '@/store/ui';

const ICON = { success: CheckCircle2, info: Info, warning: AlertTriangle, error: XCircle };
const TONE = { success: 'var(--good)', info: 'var(--info)', warning: 'var(--warn)', error: 'var(--bad)' };

/** One toast. data-exiting is set while it animates out, so layout checks can tell a leaving toast from one at rest. */
function ToastCard({ t, dismiss }: { t: ReturnType<typeof useUI.getState>['toasts'][number]; dismiss: (id: number) => void }) {
  const Icon = ICON[t.tone];
  const present = useIsPresent();
  return (
    <motion.div layout className="toast" data-exiting={present ? undefined : 'true'}
      style={{ ['--tone' as string]: TONE[t.tone] }}
      initial={{ opacity: 0, y: 14, scale: .97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, transition: { duration: .18 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
    >
      <Icon size={18} style={{ color: TONE[t.tone], flex: 'none', marginTop: 1 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 700 }}>{t.title}</div>
        {t.body && <div className="muted" style={{ fontSize: 12.5 }}>{t.body}</div>}
      </div>
      {t.action && <button className="btn sm" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
      <button className="icon-btn xs" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}><X size={13} /></button>
      <motion.i className="toast-timer" initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ duration: t.tone === 'error' ? 8 : 5.2, ease: 'linear' }} />
    </motion.div>
  );
}

export function ToastStack() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);
  const live = useUI((s) => s.liveAnnouncement);
  return (
    <>
      <div className="sr-only" aria-live="polite" role="status">{live}</div>
      <div className="toast-stack">
        <AnimatePresence initial={false}>
          {toasts.map((t) => <ToastCard key={t.id} t={t} dismiss={dismiss} />)}
        </AnimatePresence>
      </div>
    </>
  );
}
