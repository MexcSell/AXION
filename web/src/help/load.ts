import { useSyncExternalStore } from 'react';
import type { HelpEntry } from './registry';

/**
 * The help registry (all ? texts, ~75 kB of prose) is not needed for the first screen. It loads in its own chunk:
 * after the first paint (App's idle preloader), or earlier when a "?" is hovered, focused or opened.
 * Until then a "?" shows a neutral label; the text never appears wrong, it just arrives a moment later.
 */
type Registry = typeof import('./registry');
let reg: Registry | null = null;
let pending: Promise<Registry> | null = null;
const subs = new Set<() => void>();

export function loadHelp(): Promise<Registry> {
  return (pending ??= import('./registry').then((m) => { reg = m; subs.forEach((f) => f()); return m; }));
}
export const useHelpRegistry = (): Registry | null => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => reg);
export const LOADING_HELP: HelpEntry = { title: 'Help', what: 'Loading the help text…' };
