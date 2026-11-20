import { useLayoutEffect, useRef } from 'react';
import { ACCENTS, useSettings } from '@/store/settings';
import { useMediaQuery } from '@/hooks/useTab';

/** Applies theme / skin / motion / density preferences to <html> (spec §7–8). */
export function useApplyPreferences() {
  const s = useSettings();
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const prefersReduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const theme = s.themeMode === 'system' ? (prefersDark ? 'dark' : 'light') : s.themeMode;
  const motionEff = s.motion === 'system' ? (prefersReduced ? 'reduced' : 'full') : s.motion;
  const first = useRef(true);

  useLayoutEffect(() => {
    const el = document.documentElement;
    if (!first.current) {
      el.classList.add('theme-anim');
      window.setTimeout(() => el.classList.remove('theme-anim'), 450);
    }
    first.current = false;
    el.dataset.theme = theme;
    el.dataset.skin = s.skin;
    el.dataset.density = s.density;
    el.dataset.textscale = s.textScale;
    el.dataset.contrast = s.highContrast ? 'high' : 'normal';
    el.dataset.motion = motionEff;
    el.dataset.gfx = s.graphics;
    el.lang = s.language;
    const a = s.accent !== 'default' ? ACCENTS[s.accent] : null;
    for (const [k, v] of Object.entries({ '--accent': a?.accent, '--accent-rgb': a?.rgb, '--accent-grad': a?.grad })) {
      if (v) el.style.setProperty(k, v); else el.style.removeProperty(k);
    }
  }, [theme, s.skin, s.density, s.textScale, s.highContrast, motionEff, s.accent, s.language, s.graphics]);

  return { theme, motionEff };
}

/** Effective motion preference (for MotionConfig) without re-applying the document attributes. */
export function useMotionEff() {
  const motion = useSettings((s) => s.motion);
  const prefersReduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  return motion === 'system' ? (prefersReduced ? 'reduced' : 'full') : motion;
}
