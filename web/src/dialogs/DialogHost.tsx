import { AnimatePresence } from 'motion/react';
import { Component, Suspense, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Modal } from '@/components/ui/Modal';
import { AlertOctagon } from 'lucide-react';
import { useUI } from '@/store/ui';

export interface DialogComponentProps<P = Record<string, unknown>> { close: () => void; props: P; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DialogComponent = ComponentType<DialogComponentProps<any>>;

/**
 * Every file in ./defs exports `dialogs: Record<id, Component>`. Modules are loaded lazily and
 * independently (allSettled) so one failing module never takes down the others.
 * The spec DL-xx id is recorded on each Modal via data-dialog.
 */
const loaders = import.meta.glob<{ dialogs: Record<string, DialogComponent> }>('./defs/*.tsx');
let registry: Record<string, DialogComponent> | null = null;
let loading: Promise<Record<string, DialogComponent>> | null = null;

export function loadDialogs() {
  if (registry) return Promise.resolve(registry);
  loading ??= Promise.allSettled(Object.entries(loaders).map(([path, l]) => l().catch((e) => { console.error('Dialog module failed', path, e); throw e; })))
    .then((rs) => (registry = Object.assign({}, ...rs.flatMap((r) => (r.status === 'fulfilled' ? [r.value.dialogs] : []))) as Record<string, DialogComponent>));
  return loading;
}

export function DialogHost() {
  const dialogs = useUI((s) => s.dialogs);
  const close = useUI((s) => s.closeDialog);
  const [reg, setReg] = useState(registry);
  useEffect(() => { if (dialogs.length && !reg) loadDialogs().then(setReg); }, [dialogs.length, reg]);
  return (
    <AnimatePresence>
      {reg && dialogs.map((d) => {
        const C = reg[d.id];
        if (!C) { console.warn('Unknown dialog', d.id); return null; }
        return (
          <DialogBoundary key={d.key} id={d.id} onClose={() => close(d.key)}>
            <Suspense fallback={null}>
              <C close={() => close(d.key)} props={d.props ?? {}} />
            </Suspense>
          </DialogBoundary>
        );
      })}
    </AnimatePresence>
  );
}

/** One failing dialog never blanks the app: it is replaced by a closable error modal. */
class DialogBoundary extends Component<{ id: string; onClose: () => void; children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { console.error(`Dialog "${this.props.id}" failed`, err); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <Modal title="This dialog could not open" icon={AlertOctagon} tone="danger" onClose={this.props.onClose} footer={<button className="btn" data-autofocus onClick={this.props.onClose}>Close</button>}>
        <p>Nothing was changed. Dialog <span className="mono">{this.props.id}</span> hit an error: <span className="mono">{this.state.err.message.slice(0, 160)}</span></p>
      </Modal>
    );
  }
}
