import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '@/store/data';
import { useMe } from '@/store/auth';
import { channelId } from '@/store/chat';
import { useStaffingDriver } from '@/features/mission/staffing';
import { isApi } from '@/api/mode';
import { useServerSync } from '@/api/events';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { TopBar } from './TopBar';
import { Rail } from './Rail';
import { HeroScene } from '@/components/art/HeroScene';
import { ToastStack } from '@/components/ui/Toasts';
import { DialogHost } from '@/dialogs/DialogHost';
import { useSettings } from '@/store/settings';
import { useMotionEff } from './usePreferences';
import { useUI } from '@/store/ui';
import { ParticleField } from '@/components/art/ParticleField';
import { ErrorBoundary } from './ErrorBoundary';
import { ChevronsDown } from 'lucide-react';
import { Tip } from '@/components/ui/Tip';

// The command palette and the chat window are not part of the first screen: their chunks load when first wanted
// (and are fetched when idle, see App's preloader), then stay mounted so their exit animations still play.
const loadPalette = () => import('./CommandPalette').then((m) => ({ default: m.CommandPalette }));
const loadChat = () => import('@/features/chat/ChatDock').then((m) => ({ default: m.ChatDock }));
export const lazyShellParts = [loadPalette, loadChat];
const CommandPalette = lazy(loadPalette);
const ChatDock = lazy(loadChat);
/** True from the first moment `on` is true, for the rest of the component's life. */
function useEverTrue(on: boolean) { const r = useRef(false); if (on) r.current = true; return r.current; }

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

/** Moves every newly added mission through GM → executor → agents (owner update u1). */
function StaffingDriver() {
  const missions = useData((s) => s.missions);
  const update = useData((s) => s.updateMission);
  const me = useMe();
  // Only the owner's tab advances its missions: with several tabs open (several users), each step happens once.
  const staffing = useMemo(() => missions.filter((m) => m.staffing && m.staffing.stage !== 'working' && m.ownerId === me?.id), [missions, me?.id]);
  useStaffingDriver(staffing, update);
  return null;
}

/** api mode: the server runs staffing; this tab follows its events (Stage 5). */
function ServerSync() { useServerSync(); return null; }

export function AppShell() {
  const motionEff = useMotionEff();
  useGlobalShortcuts();
  const loc = useLocation();
  const me = useMe();
  const nav = useNavigate();
  const collapsed = useSettings((s) => s.railCollapsed);
  const skin = useSettings((s) => s.skin);
  const particles = useSettings((s) => s.particles);
  const fullGfx = useSettings((s) => s.graphics) === 'full';
  const pageTransition = useSettings((s) => s.pageTransition);
  const headerBanner = useSettings((s) => s.headerBanner);
  const setSettings = useSettings((s) => s.set);
  const routeKey = loc.pathname.split('/')[1] || 'overview';
  const mainRef = useRef<HTMLElement>(null);
  const paletteOpen = useUI((s) => s.paletteOpen);
  const chatOpen = useUI((s) => s.chat.open);
  const showPalette = useEverTrue(paletteOpen);
  const showChat = useEverTrue(chatOpen);
  // a notification's route (/?chat=admin) opens the line to the administrators (handled here, so the chat chunk need not be loaded to see it)
  const openChat = useUI((s) => s.openChat);
  const wantsAdminChat = new URLSearchParams(loc.search).get('chat') === 'admin';
  useEffect(() => {
    if (!me || !wantsAdminChat) return;
    openChat(channelId.admin(me.id));
    nav(loc.pathname, { replace: true });
  }, [me, wantsAdminChat, loc.pathname, openChat, nav]);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); setScrolled(false); }, [routeKey]);

  const page = (
    <ErrorBoundary resetKey={loc.pathname}>
      <Suspense fallback={<PageSkeleton />}>
        <Outlet />
      </Suspense>
    </ErrorBoundary>
  );

  return (
    <MotionConfig reducedMotion={motionEff === 'reduced' ? 'always' : 'never'} transition={motionEff === 'subtle' ? { duration: 0.15 } : undefined}>
      <div className="app" data-rail={collapsed ? 'collapsed' : 'expanded'} data-route={routeKey} data-scrolled={scrolled || undefined} data-header={headerBanner ? 'shown' : 'hidden'}>
        <div className="app-bg-grid" aria-hidden />
        {fullGfx && (skin === 'fancy' || skin === 'luminous') && particles && motionEff !== 'reduced' && <ParticleField />}
        {headerBanner && <div className="hero-layer" aria-hidden><HeroScene animated={fullGfx && motionEff !== 'reduced'} /></div>}
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
          {pageTransition === 'smooth' ? (
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
                {page}
              </motion.div>
            </AnimatePresence>
          ) : (
            // Instant / Fast: the new page mounts at once (no exit wait); Fast adds a 90 ms opacity-only fade.
            <div key={routeKey} className={'route-view' + (pageTransition === 'fast' ? ' route-in' : '')} style={{ minHeight: '100%' }}>{page}</div>
          )}
        </main>
        <ToastStack />
        <DialogHost />
        {showPalette && <Suspense fallback={null}><CommandPalette /></Suspense>}
        {isApi() ? <ServerSync /> : <StaffingDriver />}
        {showChat && <Suspense fallback={null}><ChatDock /></Suspense>}
      </div>
    </MotionConfig>
  );
}

export function PageSkeleton() {
  return (
    <div className="page" role="status" aria-label="Loading">
      <div className="skeleton" style={{ height: 120 }} />
      <div className="grid g-3"><div className="skeleton" style={{ height: 220 }} /><div className="skeleton" style={{ height: 220 }} /><div className="skeleton" style={{ height: 220 }} /></div>
    </div>
  );
}
