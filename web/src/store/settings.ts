import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ThemeMode = 'dark' | 'light' | 'system';
export type Skin = 'luminous' | 'flat' | 'pretty' | 'fancy';
export type MotionPref = 'full' | 'subtle' | 'reduced' | 'system';
export type Density = 'comfortable' | 'compact' | 'spacious';
export type TextScale = 'md' | 'lg' | 'xl';
/** Fast = no glass blur, no particle canvas, still hero art (low GPU). Full = every effect. */
export type Graphics = 'fast' | 'full';
/** How a page switch looks: Instant = no animation, Fast = 90 ms fade, Smooth = the old exit + slide-in (~340 ms). */
export type PageTransition = 'instant' | 'fast' | 'smooth';
export type Accent = 'default' | 'violet' | 'cyan' | 'emerald' | 'rose' | 'amber';

export interface AvatarPrefs {
  faceMode: 'emblem' | 'face';
  eyes: 'round' | 'visor' | 'arc' | 'pixel';
  expression: 'neutral' | 'happy' | 'focused';
  antenna: boolean;
  outline: boolean;
  glow: number; // 0..1
  hueShift: number; // -60..60
}

export interface SettingsState {
  themeMode: ThemeMode;
  skin: Skin;
  motion: MotionPref;
  density: Density;
  textScale: TextScale;
  highContrast: boolean;
  accent: Accent;
  railCollapsed: boolean;
  particles: boolean;
  graphics: Graphics;
  pageTransition: PageTransition;
  /** Show the top header banner (brand, hero art, Plan→Sustain loop, actions). */
  headerBanner: boolean;
  language: 'en' | 'ja';
  timezone: string;
  companyName: string;
  avatar: AvatarPrefs;
  /** rail visibility overrides per nav/plug-in key (Settings › Navigation); missing = the item's default */
  navShown: Record<string, boolean>;
  set: (p: Partial<Omit<SettingsState, 'set' | 'setAvatar' | 'reset'>>) => void;
  setAvatar: (p: Partial<AvatarPrefs>) => void;
  reset: () => void;
}

const DEFAULTS = {
  themeMode: 'dark' as ThemeMode,
  skin: 'luminous' as Skin,
  motion: 'system' as MotionPref,
  density: 'comfortable' as Density,
  textScale: 'md' as TextScale,
  highContrast: false,
  accent: 'default' as Accent,
  railCollapsed: false,
  particles: true,
  graphics: 'fast' as Graphics,
  pageTransition: 'instant' as PageTransition,
  headerBanner: true,
  language: 'en' as const,
  timezone: 'UTC',
  companyName: 'AXION AI Company',
  navShown: {} as Record<string, boolean>,
  avatar: { faceMode: 'emblem', eyes: 'round', expression: 'happy', antenna: true, outline: true, glow: 0.8, hueShift: 0 } as AvatarPrefs,
};

const safeStorage = createJSONStorage(() => {
  try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return localStorage; }
  catch { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; }
});

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (p) => set(p),
      setAvatar: (p) => set((s) => ({ avatar: { ...s.avatar, ...p } })),
      reset: () => set({ ...DEFAULTS }),
    }),
    { name: 'axion.settings.v1', storage: safeStorage },
  ),
);

export const ACCENTS: Record<Exclude<Accent, 'default'>, { accent: string; rgb: string; grad: string }> = {
  violet:  { accent: '#8b5cf6', rgb: '139, 92, 246', grad: 'linear-gradient(90deg, #7c3aed, #8b5cf6 50%, #a78bfa)' },
  cyan:    { accent: '#06b6d4', rgb: '6, 182, 212', grad: 'linear-gradient(90deg, #0891b2, #06b6d4 50%, #22d3ee)' },
  emerald: { accent: '#10b981', rgb: '16, 185, 129', grad: 'linear-gradient(90deg, #059669, #10b981 50%, #34d399)' },
  rose:    { accent: '#f43f5e', rgb: '244, 63, 94', grad: 'linear-gradient(90deg, #e11d48, #f43f5e 50%, #fb7185)' },
  amber:   { accent: '#f59e0b', rgb: '245, 158, 11', grad: 'linear-gradient(90deg, #d97706, #f59e0b 50%, #fbbf24)' },
};

/** Is a rail item (nav key or plug-in key) shown? Overrides from Settings › Navigation win over the default. */
export function useRailShown() {
  const over = useSettings((s) => s.navShown);
  return (key: string, def: boolean) => over[key] ?? def;
}
