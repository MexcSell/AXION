import { create } from 'zustand';
import type { EdgeKind } from '@/data/types';

/** Tiny event bus for real-time-looking mission events (DEMO simulation + user-triggered). */
export interface Pulse { id: number; from: string; to: string; kind: EdgeKind; at: number; }
export interface LiveLine { id: number; at: number; text: string; kind: EdgeKind | 'command' | 'ack'; missionId: string; }

interface LiveState {
  pulses: Pulse[];
  lines: LiveLine[];
  simulate: boolean;
  emit: (missionId: string, from: string, to: string, kind: EdgeKind, text?: string) => void;
  log: (missionId: string, text: string, kind: LiveLine['kind']) => void;
  setSimulate: (v: boolean) => void;
}

let n = 1;
export const useLive = create<LiveState>()((set, get) => ({
  pulses: [],
  lines: [],
  simulate: true,
  emit: (missionId, from, to, kind, text) => {
    const p: Pulse = { id: n++, from, to, kind, at: Date.now() };
    set((s) => ({ pulses: [...s.pulses.slice(-12), p] }));
    window.setTimeout(() => set((s) => ({ pulses: s.pulses.filter((x) => x.id !== p.id) })), 1700);
    if (text) get().log(missionId, text, kind);
  },
  log: (missionId, text, kind) => set((s) => ({ lines: [{ id: n++, at: Date.now(), text, kind, missionId }, ...s.lines].slice(0, 40) })),
  setSimulate: (v) => set({ simulate: v }),
}));
