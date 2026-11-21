import { motion, AnimatePresence } from 'motion/react';
import { useAgentsCatalog } from '@/api/agents';
import { NavLink, useLocation } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen, X, Plus, Puzzle, Eye } from 'lucide-react';
import { useMemo } from 'react';
import { NAV, type NavItem } from '@/config/nav';
import { PLUGINS } from '@/config/plugins';
import { BRAND } from '@/config/brand';
import { CoreCube } from '@/components/art/CoreArt';
import { Tip } from '@/components/ui/Tip';
import { Dot } from '@/components/ui/Chips';
import { useSettings, useRailShown } from '@/store/settings';
import { useData, allApprovals, useVisibleMissions } from '@/store/data';
import { useUI, openDialog } from '@/store/ui';
import { useMe, isAdmin, usePendingApprovals } from '@/store/auth';
import { AGENTS } from '@/data/agents';
import { useVisibleNotices } from '@/data/useNotices';
import { useMediaQuery } from '@/hooks/useTab';

export function Rail() {
  useAgentsCatalog(); // agent counts follow the catalog (api mode)
  const collapsedPref = useSettings((s) => s.railCollapsed);
  const set = useSettings((s) => s.set);
  const loc = useLocation();
  const missions = useVisibleMissions();
  const decisions = useData((s) => s.approvalDecisions);
  const read = useData((s) => s.readNotifications);
  const mobileOpen = useUI((s) => s.mobileNavOpen);
  const setMobile = useUI((s) => s.setMobileNav);
  const isMobile = useMediaQuery('(max-width: 800px)');
  const isNarrow = useMediaQuery('(max-width: 1200px)');
  const collapsed = !isMobile && (collapsedPref || isNarrow);

  const pending = useMemo(() => allApprovals(missions, decisions).filter((a) => a.status === 'pending').length, [missions, decisions]);
  const notices = useVisibleNotices();
  const unread = notices.filter((n) => !read[n.id]).length;
  const active = missions.filter((m) => ['running', 'planning', 'verifying', 'waiting'].includes(m.status)).length;
  const online = AGENTS.filter((a) => a.status !== 'offline').length;

  const isActive = (path: string) => loc.pathname.startsWith(path);
  const shown = useRailShown();
  const admin = isAdmin(useMe());
  const userApprovals = usePendingApprovals();
  // Top section: the shown items, plus the screen you are on when it is hidden (dashed, so you know where you are).
  const isNavActive = (n: NavItem) => isActive(n.path) || (n.also ?? []).some((p) => loc.pathname.startsWith(p));
  const topItems = NAV.filter((n) => shown(n.key, n.shown) || isNavActive(n));
  const pluginItems: NavItem[] = PLUGINS.filter((p) => shown('plugin:' + p.key, true) || isActive(p.path))
    .map((p) => ({ key: p.key, label: p.label, path: p.path, icon: p.icon, shown: true, note: p.description }));

  const renderItem = (n: NavItem, i: number, pillId: string, visiting: boolean) => {
    const sel = isNavActive(n);
    const badge = n.badge === 'approvals' ? pending : n.badge === 'notifications' ? unread : n.badge === 'users' ? (admin ? userApprovals.total : 0) : 0;
    const link = (
      <NavLink to={n.path} className={'nav-item' + (sel ? ' active' : '') + (visiting ? ' visiting' : '')} aria-current={sel ? 'page' : undefined} onClick={() => setMobile(false)}>
        {sel && <motion.span layoutId={pillId} className="nav-pill" transition={{ type: 'spring', stiffness: 480, damping: 38 }} />}
        <motion.span className="nav-ico" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.03 * i }}>
          <n.icon size={20} strokeWidth={1.8} />
        </motion.span>
        {!collapsed && <span className="nav-label">{n.label}</span>}
        {visiting && !collapsed && <Tip label="Hidden from the rail — shown while you are here. Settings › Navigation can pin it." side="right"><span className="nav-visit" aria-label="Hidden screen"><Eye size={13} /></span></Tip>}
        {badge > 0 && <span className={'badge nav-badge' + (collapsed ? ' floating' : '')} aria-label={`${badge} pending`}>{badge}</span>}
      </NavLink>
    );
    return collapsed ? <Tip key={n.key} label={n.label + (visiting ? ' (hidden screen)' : '')} side="right">{link}</Tip> : <motion.div key={n.key} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}>{link}</motion.div>;
  };

  const content = (
    <div className="rail-inner" data-collapsed={collapsed || undefined}>
      <div className="rail-hero">
        <span aria-hidden><CoreCube width={collapsed ? 64 : 170} /></span>
        {!isMobile && !collapsed && (
          <Tip label="Collapse navigation" shortcut="Ctrl B" side="right">
            <button className="icon-btn sm rail-toggle-top" onClick={() => set({ railCollapsed: true })} aria-label="Collapse navigation"><PanelLeftClose size={15} /></button>
          </Tip>
        )}
      </div>
      <nav className="rail-nav rail-top" aria-label="Primary">
        {topItems.map((n, i) => renderItem(n, i, 'nav-pill', !shown(n.key, n.shown)))}
      </nav>
      <div className="rail-gap" aria-hidden />
      <nav className="rail-nav rail-plugins" aria-label="Plug-in apps">
        {!collapsed ? (
          <div className="rail-sec-head">
            <Puzzle size={13} /> <span>Plug-ins</span>
            <Tip label="Create a plug-in through a mission" side="right">
              <button className="icon-btn xs" aria-label="Create a plug-in through a mission" onClick={() => { setMobile(false); openDialog('mission-create', { text: 'Build a plug-in app for the rail that …' }); }}><Plus size={13} /></button>
            </Tip>
          </div>
        ) : <div className="rail-sec-rule" aria-hidden />}
        {pluginItems.length ? pluginItems.map((n, i) => renderItem(n, i, 'nav-pill-plugin', false))
          : !collapsed && <div className="rail-empty">No plug-ins shown. <NavLink to="/settings?tab=navigation" onClick={() => setMobile(false)}>Choose in Settings</NavLink></div>}
      </nav>
      <div className="rail-foot">
        {!collapsed ? (
          <div className="core-card">
            <div className="core-title">{BRAND.coreName}</div>
            <div className="core-art"><CoreCube width={120} /></div>
            <div className="core-rows">
              <div><Dot tone="good" pulse /> <span>System</span><b className="good">Online</b></div>
              <div><Dot tone="good" /> <span>Agents</span><b>{online} / {AGENTS.length}</b></div>
              <div><Dot tone="good" /> <span>Missions</span><b>{active} Active</b></div>
            </div>
          </div>
        ) : (
          <>
            <Tip label={`System online · ${online}/${AGENTS.length} agents · ${active} missions`} side="right">
              <div className="core-mini" tabIndex={0}><Dot tone="good" pulse /></div>
            </Tip>
            {!isNarrow && (
              <Tip label="Expand navigation" shortcut="Ctrl B" side="right">
                <button className="rail-toggle" onClick={() => set({ railCollapsed: false })} aria-label="Expand navigation"><PanelLeftOpen size={16} /></button>
              </Tip>
            )}
          </>
        )}
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <AnimatePresence>
        {mobileOpen && (
          <div className="mobile-nav-layer">
            <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobile(false)} />
            <motion.aside className="rail mobile" initial={{ x: -260 }} animate={{ x: 0 }} exit={{ x: -260 }} transition={{ type: 'spring', stiffness: 380, damping: 36 }}>
              <button className="icon-btn" style={{ position: 'absolute', right: 8, top: 8, zIndex: 3 }} aria-label="Close navigation" onClick={() => setMobile(false)}><X size={18} /></button>
              {content}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    );
  }
  return <aside className="rail">{content}</aside>;
}
