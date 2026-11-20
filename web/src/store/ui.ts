import { create } from 'zustand';
import type { ReactNode } from 'react';

export type ToastTone = 'success' | 'info' | 'warning' | 'error';
export interface Toast { id: number; tone: ToastTone; title: string; body?: string; action?: { label: string; run: () => void }; }

export interface DialogEntry { key: number; id: string; props?: Record<string, unknown>; }

interface UIState {
  toasts: Toast[];
  dialogs: DialogEntry[];
  paletteOpen: boolean;
  mobileNavOpen: boolean;
  liveAnnouncement: string;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  openDialog: (id: string, props?: Record<string, unknown>) => void;
  closeDialog: (key?: number) => void;
  setPalette: (open: boolean) => void;
  setMobileNav: (open: boolean) => void;
  announce: (msg: string) => void;
}

let seq = 1;

export const useUI = create<UIState>()((set, get) => ({
  toasts: [],
  dialogs: [],
  paletteOpen: false,
  mobileNavOpen: false,
  liveAnnouncement: '',
  toast: (t) => {
    const id = seq++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }], liveAnnouncement: `${t.title}${t.body ? '. ' + t.body : ''}` }));
    window.setTimeout(() => get().dismissToast(id), t.tone === 'error' ? 8000 : 5200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
  openDialog: (id, props) => set((s) => ({ dialogs: [...s.dialogs, { key: seq++, id, props }] })),
  closeDialog: (key) => set((s) => ({ dialogs: key == null ? s.dialogs.slice(0, -1) : s.dialogs.filter((d) => d.key !== key) })),
  setPalette: (open) => set({ paletteOpen: open }),
  setMobileNav: (open) => set({ mobileNavOpen: open }),
  announce: (msg) => set({ liveAnnouncement: msg }),
}));

/** convenience for non-component code */
export const toast = (t: Omit<Toast, 'id'>) => useUI.getState().toast(t);
export const openDialog = (id: string, props?: Record<string, unknown>) => useUI.getState().openDialog(id, props);
export type { ReactNode };
