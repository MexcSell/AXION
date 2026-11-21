import { motion } from 'motion/react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { isApi } from '@/api/mode';
import { ClipboardList, MessagesSquare, Zap, ShieldCheck, Dna, Sparkles, Bell, Search, Sun, Moon, Monitor, Menu as MenuIcon, LogOut, UserCog, Palette, Keyboard } from 'lucide-react';
import { LogoGlyph } from '@/components/art/CoreArt';
import { BRAND } from '@/config/brand';
import { IconButton } from '@/components/ui/IconButton';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Tip } from '@/components/ui/Tip';
import { Menu } from '@/components/ui/Menu';
import { DemoTag } from '@/components/ui/Chips';
import { useSettings } from '@/store/settings';
import { useUI, openDialog, toast } from '@/store/ui';
import { useData, allApprovals, useVisibleMissions } from '@/store/data';
import { useMemo } from 'react';
import { useVisibleNotices } from '@/data/useNotices';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { useChatUnread } from '@/features/chat/chatHooks';
import { useAuth, useMe, isAdmin, usePendingApprovals } from '@/store/auth';

const PIPELINE = [
  { key: 'plan', label: 'Plan', icon: ClipboardList, path: '/missions', color: '#38bdf8', tip: 'Plan — define missions & success criteria' },
  { key: 'execute', label: 'Execute', icon: Zap, path: '/missions?tab=hierarchy', color: '#22d3ee', tip: 'Execute — watch agents work in the mission hierarchy' },
  { key: 'verify', label: 'Verify', icon: ShieldCheck, path: '/results', color: '#60a5fa', tip: 'Verify — inspect verified results & versions' },
  { key: 'evolve', label: 'Evolve', icon: Dna, path: '/agents?tab=development', color: '#a78bfa', tip: 'Evolve — agents learn, grow through stages and share knowledge' },
  { key: 'sustain', label: 'Sustain', icon: Sparkles, path: '/operations', color: '#fbbf24', tip: 'Sustain — health, recovery and operations' },
];

const EXEC_TABS = ['hierarchy', 'task-flow', 'browser', 'conversations'];

const CONN = {
  live: { label: 'Live', hint: 'Live updates from the AXION server', icon: Wifi, cls: 'good' },
  reconnecting: { label: 'Reconnecting', hint: 'The live link dropped. Retrying…', icon: RefreshCw, cls: 'warn' },
  stale: { label: 'Stale', hint: 'No live updates for 30 s. What you see may be out of date.', icon: WifiOff, cls: 'bad' },
  off: { label: 'Connecting', hint: 'Connecting to the AXION server…', icon: RefreshCw, cls: 'dim' },
} as const;

/** Stage 5: live / reconnecting / stale (spec §12.2). */
function ConnectionBadge() {
  const c = useData((s) => s.connection);
  const m = CONN[c];
  return (
    <span className={`conn-badge ${m.cls}`} data-conn={c} role="status" aria-live="polite">
      <Tip label={m.hint}><span className="conn-badge-in"><m.icon size={13} className={c === 'reconnecting' || c === 'off' ? 'spin' : undefined} />{m.label}</span></Tip>
      <HelpTrigger k="app.connection" />
    </span>
  );
}

export function TopBar() {
  const nav = useNavigate();
  const loc = useLocation();
  const { themeMode, set } = useSettings();
  const setPalette = useUI((s) => s.setPalette);
  const setMobileNav = useUI((s) => s.setMobileNav);
  const read = useData((s) => s.readNotifications);
  const missions = useVisibleMissions();
  const decisions = useData((s) => s.approvalDecisions);
  const notices = useVisibleNotices();
  const unread = notices.filter((n) => !read[n.id]).length;
  const pending = useMemo(() => allApprovals(missions, decisions).filter((a) => a.status === 'pending').length, [missions, decisions]);

  const me = useMe();
  const admin = isAdmin(me);
  const approvals = usePendingApprovals();
  const signOut = useAuth((s) => s.signOut);
  const chatUnread = useChatUnread();
  const chatOpen = useUI((s) => s.chat.open);
  const openChat = useUI((s) => s.openChat);
  const closeChat = useUI((s) => s.closeChat);
  const nextTheme = themeMode === 'dark' ? 'light' : themeMode === 'light' ? 'system' : 'dark';
  const ThemeIcon = themeMode === 'dark' ? Moon : themeMode === 'light' ? Sun : Monitor;

  return (
    <motion.header className="topbar topbar-inner" role="banner"
      initial={{ opacity: 0, y: -24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -28, transition: { duration: .2 } }}
      transition={{ duration: .3, ease: [0.2, 0.8, 0.2, 1] }}>
      <button className="icon-btn mobile-only" aria-label="Open navigation" onClick={() => setMobileNav(true)}><MenuIcon size={20} /></button>
      <button className="brand" onClick={() => nav('/overview')} aria-label={`${BRAND.name} home`}>
        <motion.span initial={{ rotate: -12, scale: .7, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }}>
          <LogoGlyph size={46} />
        </motion.span>
        <span className="brand-word">{BRAND.name}<sup>™</sup></span>
      </button>
      <span className="brand-divider" aria-hidden />
      <div className="brand-title">
        <div className="brand-h">{BRAND.title}</div>
        <div className="brand-tag">{BRAND.tagline}</div>
      </div>

      <span className="spacer" />

      <nav className="pipeline" aria-label="Company loop">
        {PIPELINE.map((p, i) => {
          // Plan and Execute both live on the merged Missions page: Execute = the live-work tabs of the open mission
          const onMissions = loc.pathname.startsWith('/missions');
          const execTab = EXEC_TABS.includes(new URLSearchParams(loc.search).get('tab') ?? '');
          const active = p.key === 'plan' ? onMissions && !execTab : p.key === 'execute' ? onMissions && execTab : loc.pathname.startsWith(p.path);
          const target = p.key === 'execute' && onMissions ? `${loc.pathname}?tab=hierarchy` : p.key === 'plan' && onMissions ? `${loc.pathname}?tab=overview` : p.path;
          return (
            <Tip key={p.key} label={p.tip} side="bottom">
              <motion.button
                className={'pipe-btn' + (active ? ' active' : '')}
                style={{ ['--pc' as string]: p.color }}
                onClick={() => nav(target)}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.05 }}
                aria-current={active ? 'page' : undefined}
              >
                <span className="pipe-ico"><p.icon size={20} strokeWidth={1.8} /></span>
                <span className="pipe-label">{p.label}</span>
              </motion.button>
            </Tip>
          );
        })}
        <HelpTrigger k="shell.pipeline" />
      </nav>

      <div className="top-actions">
        {isApi() ? <ConnectionBadge /> : <DemoTag title="Prototype: all data is deterministic DEMO data, kept in this browser. Open without ?data=demo to use the AXION server." />}
        <IconButton icon={Search} label="Search & commands" shortcut="Ctrl K" onClick={() => setPalette(true)} tipSide="bottom" />
        <IconButton icon={ThemeIcon} label={`Theme: ${themeMode} (switch to ${nextTheme})`} tipSide="bottom"
          onClick={() => { set({ themeMode: nextTheme }); toast({ tone: 'info', title: `Theme: ${nextTheme}` }); }} />
        <IconButton icon={Bell} label={`Notifications (${unread} unread, ${pending} approvals)`} badge={unread || undefined} tipSide="bottom" onClick={() => nav('/notifications')} />
        <IconButton icon={MessagesSquare} label={`Chat with the General Manager and administrators${chatUnread ? ` (${chatUnread} unread)` : ''}`} badge={chatUnread || undefined} tipSide="bottom"
          variant={chatOpen ? 'active' : undefined} onClick={() => (chatOpen ? closeChat() : openChat())} />
        <Menu
          trigger={<button className="avatar-btn uav-btn" aria-label={`Account menu: ${me?.name ?? 'signed out'}`}>{me ? <UserAvatar account={me} size={36} ring={admin && approvals.total ? 'warn' : undefined} /> : <span>?</span>}{admin && approvals.total > 0 && <span className="badge avatar-badge">{approvals.total}</span>}</button>}
          items={[
            { label: `${me?.name ?? ''} · ${admin ? 'Administrator' : 'Member'}`, icon: UserCog, onSelect: () => nav('/settings?tab=users') },
            ...(admin ? [{ label: `Approvals (${approvals.total} waiting)`, icon: ShieldCheck, onSelect: () => nav('/settings?tab=users') }] : []),
            { label: 'Appearance studio', icon: Palette, onSelect: () => openDialog('appearance') },
            { label: 'Keyboard shortcuts', icon: Keyboard, onSelect: () => nav('/help?tab=shortcuts') },
            { label: 'Sign out', icon: LogOut, sep: true, onSelect: () => { signOut(); toast({ tone: 'info', title: 'Signed out', body: 'Connect again with your name and password.' }); } },
          ]}
        />
      </div>
    </motion.header>
  );
}
