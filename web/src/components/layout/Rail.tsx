import { motion, AnimatePresence } from 'motion/react';
import { NavLink, useLocation } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { useMemo } from 'react';
import { NAV } from '@/config/nav';
import { BRAND } from '@/config/brand';
import { CoreCube } from '@/components/art/CoreArt';
import { Tip } from '@/components/ui/Tip';
import { Dot } from '@/components/ui/Chips';
import { useSettings } from '@/store/settings';
import { useData, allApprovals } from '@/store/data';
import { useUI } from '@/store/ui';
import { AGENTS } from '@/data/agents';
import { ALL_NOTICES as NOTIFICATIONS } from '@/data/notifications-extra';
import { useMediaQuery } from '@/hooks/useTab';

export function Rail() {
  const collapsedPref = useSettings((s) => s.railCollapsed);
  const set = useSettings((s) => s.set);
  const loc = useLocation();
  const missions = useData((s) => s.missions);
  const decisions = useData((s) => s.approvalDecisions);
  const read = useData((s) => s.readNotifications);
  const mobileOpen = useUI((s) => s.mobileNavOpen);
  const setMobile = useUI((s) => s.setMobileNav);
  const isMobile = useMediaQuery('(max-width: 800px)');
  const isNarrow = useMediaQuery('(max-width: 1200px)');
  const collapsed = !isMobile && (collapsedPref || isNarrow);

  const pending = useMemo(() => allApprovals(missions, decisions).filter((a) => a.status === 'pending').length, [missions, decisions]);
  const unread = NOTIFICATIONS.filter((n) => !read[n.id]).length;
  const active = missions.filter((m) => ['running', 'planning', 'verifying', 'waiting'].includes(m.status)).length;
  const online = AGENTS.filter((a) => a.status !== 'offline').length;

  const isActive = (path: string) => (path === '/control' ? loc.pathname.startsWith('/control') : loc.pathname.startsWith(path));

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
      <nav className="rail-nav" aria-label="Primary">
        {NAV.map((n, i) => {
          const sel = isActive(n.path);
          const badge = n.badge === 'approvals' ? pending : n.badge === 'notifications' ? unread : 0;
          const link = (
            <NavLink to={n.path} className={'nav-item' + (sel ? ' active' : '')} aria-current={sel ? 'page' : undefined} onClick={() => setMobile(false)}>
              {sel && <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: 'spring', stiffness: 480, damping: 38 }} />}
              <motion.span className="nav-ico" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.03 * i }}>
                <n.icon size={20} strokeWidth={1.8} />
              </motion.span>
              {!collapsed && <span className="nav-label">{n.label}</span>}
              {badge > 0 && <span className={'badge nav-badge' + (collapsed ? ' floating' : '')} aria-label={`${badge} pending`}>{badge}</span>}
            </NavLink>
          );
          return collapsed ? <Tip key={n.key} label={n.label} side="right">{link}</Tip> : <div key={n.key}>{link}</div>;
        })}
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
