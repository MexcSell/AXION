import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { TopBar } from './TopBar';
import { Rail } from './Rail';
import { HeroScene } from '@/components/art/HeroScene';
import { ToastStack } from '@/components/ui/Toasts';
import { DialogHost } from '@/dialogs/DialogHost';
import { CommandPalette } from './CommandPalette';
import { ACCENTS, useSettings } from '@/store/settings';
import { useUI } from '@/store/ui';
import { useMediaQuery } from '@/hooks/useTab';
import { ParticleField } from '@/components/art/ParticleField';
import { ErrorBoundary } from './ErrorBoundary';
import { ChevronsDown } from 'lucide-react';
import { Tip } from '@/components/ui/Tip';

/** Applies theme / skin / motion / density preferences to <html> (spec §7–8). */
function useApplyPreferences() {
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
    el.lang = s.language;
    const a = s.accent !== 'default' ? ACCENTS[s.accent] : null;
    for (const [k, v] of Object.entries({ '--accent': a?.accent, '--accent-rgb': a?.rgb, '--accent-grad': a?.grad })) {
      if (v) el.style.setProperty(k, v); else el.style.removeProperty(k);
    }
  }, [theme, s.skin, s.density, s.textScale, s.highContrast, motionEff, s.accent, s.language]);

  return { theme, motionEff };
}

function useGlobalShortcuts() {
  const setPalette = useUI((s) => s.setPalette);
  const set = useSettings((s) => s.set);
  const nav = useNavigate();
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); }
      else if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); set({ railCollapsed: !useSettings.getState().railCollapsed }); }
      else if (!typing && e.key === '?' && !mod) { nav('/help?tab=shortcuts'); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [setPalette, set, nav]);
}

export function AppShell() {
  const { motionEff } = useApplyPreferences();
  useGlobalShortcuts();
  const loc = useLocation();
  const collapsed = useSettings((s) => s.railCollapsed);
  const skin = useSettings((s) => s.skin);
  const particles = useSettings((s) => s.particles);
  const headerBanner = useSettings((s) => s.headerBanner);
  const setSettings = useSettings((s) => s.set);
  const routeKey = loc.pathname.split('/')[1] || 'overview';
  const mainRef = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); setScrolled(false); }, [routeKey]);

  return (
    <MotionConfig reducedMotion={motionEff === 'reduced' ? 'always' : 'never'} transition={motionEff === 'subtle' ? { duration: 0.15 } : undefined}>
      <div className="app" data-rail={collapsed ? 'collapsed' : 'expanded'} data-route={routeKey} data-scrolled={scrolled || undefined} data-header={headerBanner ? 'shown' : 'hidden'}>
        <div className="app-bg-grid" aria-hidden />
        {(skin === 'fancy' || skin === 'luminous') && particles && motionEff !== 'reduced' && <ParticleField />}
        {headerBanner && <div className="hero-layer" aria-hidden><HeroScene animated={motionEff !== 'reduced'} /></div>}
        <a href="#main" className="skip-link">Skip to content</a>
        <AnimatePresence initial={false}>
          {headerBanner ? <TopBar key="topbar" /> : (
            <motion.div key="header-restore" className="header-restore"
              initial={{ y: -32, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -32, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 26 }}>
              <Tip label="Show header banner (Settings › Appearance)" side="bottom">
                <button type="button" aria-label="Show header banner" onClick={() => setSettings({ headerBanner: true })}>
                  <ChevronsDown size={14} />
                </button>
              </Tip>
            </motion.div>
          )}
        </AnimatePresence>
        <Rail />
        <main id="main" className="main" ref={mainRef} tabIndex={-1} onScroll={(e) => { const v = e.currentTarget.scrollTop > 6; if (v !== scrolled) setScrolled(v); }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={routeKey}
              className="route-view"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
              transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
              style={{ minHeight: '100%' }}
            >
              <ErrorBoundary resetKey={loc.pathname}>
                <Suspense fallback={<PageSkeleton />}>
                  <Outlet />
                </Suspense>
              </ErrorBoundary>
            </motion.div>
          </AnimatePresence>
        </main>
        <ToastStack />
        <DialogHost />
        <CommandPalette />
      </div>
    </MotionConfig>
  );
}

export function PageSkeleton() {
  return (
    <div className="page" aria-busy="true" aria-label="Loading">
      <div className="skeleton" style={{ height: 120 }} />
      <div className="grid g-3"><div className="skeleton" style={{ height: 220 }} /><div className="skeleton" style={{ height: 220 }} /><div className="skeleton" style={{ height: 220 }} /></div>
    </div>
  );
}
