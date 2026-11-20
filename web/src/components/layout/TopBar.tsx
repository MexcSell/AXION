import { motion } from 'motion/react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ClipboardList, Zap, ShieldCheck, Dna, Sparkles, Bell, Search, Sun, Moon, Monitor, Menu as MenuIcon, LogOut, UserCog, Palette, Keyboard } from 'lucide-react';
import { LogoGlyph } from '@/components/art/CoreArt';
import { BRAND } from '@/config/brand';
import { IconButton } from '@/components/ui/IconButton';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Tip } from '@/components/ui/Tip';
import { Menu } from '@/components/ui/Menu';
import { DemoTag } from '@/components/ui/Chips';
import { useSettings } from '@/store/settings';
import { useUI, openDialog, toast } from '@/store/ui';
import { useData, allApprovals } from '@/store/data';
import { useMemo } from 'react';
import { ALL_NOTICES as NOTIFICATIONS } from '@/data/notifications-extra';

const PIPELINE = [
  { key: 'plan', label: 'Plan', icon: ClipboardList, path: '/missions', color: '#38bdf8', tip: 'Plan — define missions & success criteria' },
  { key: 'execute', label: 'Execute', icon: Zap, path: '/control', color: '#22d3ee', tip: 'Execute — watch agents work in Mission Control' },
  { key: 'verify', label: 'Verify', icon: ShieldCheck, path: '/results', color: '#60a5fa', tip: 'Verify — inspect verified results & versions' },
  { key: 'evolve', label: 'Evolve', icon: Dna, path: '/evolution', color: '#a78bfa', tip: 'Evolve — proposals, experiments, promotions' },
  { key: 'sustain', label: 'Sustain', icon: Sparkles, path: '/operations', color: '#fbbf24', tip: 'Sustain — health, recovery and operations' },
];

export function TopBar() {
  const nav = useNavigate();
  const loc = useLocation();
  const { themeMode, set } = useSettings();
  const setPalette = useUI((s) => s.setPalette);
  const setMobileNav = useUI((s) => s.setMobileNav);
  const read = useData((s) => s.readNotifications);
  const missions = useData((s) => s.missions);
  const decisions = useData((s) => s.approvalDecisions);
  const unread = NOTIFICATIONS.filter((n) => !read[n.id]).length;
  const pending = useMemo(() => allApprovals(missions, decisions).filter((a) => a.status === 'pending').length, [missions, decisions]);

  const nextTheme = themeMode === 'dark' ? 'light' : themeMode === 'light' ? 'system' : 'dark';
  const ThemeIcon = themeMode === 'dark' ? Moon : themeMode === 'light' ? Sun : Monitor;

  return (
    <header className="topbar topbar-inner" role="banner">
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
          const active = loc.pathname.startsWith(p.path);
          return (
            <Tip key={p.key} label={p.tip} side="bottom">
              <motion.button
                className={'pipe-btn' + (active ? ' active' : '')}
                style={{ ['--pc' as string]: p.color }}
                onClick={() => nav(p.path)}
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
        <DemoTag title="Prototype: all data is deterministic DEMO data. No backend or real browser automation is connected." />
        <IconButton icon={Search} label="Search & commands" shortcut="Ctrl K" onClick={() => setPalette(true)} tipSide="bottom" />
        <IconButton icon={ThemeIcon} label={`Theme: ${themeMode} (switch to ${nextTheme})`} tipSide="bottom"
          onClick={() => { set({ themeMode: nextTheme }); toast({ tone: 'info', title: `Theme: ${nextTheme}` }); }} />
        <IconButton icon={Bell} label={`Notifications (${unread} unread, ${pending} approvals)`} badge={unread || undefined} tipSide="bottom" onClick={() => nav('/notifications')} />
        <Menu
          trigger={<button className="avatar-btn" aria-label="Account menu"><span>LU</span></button>}
          items={[
            { label: 'Profile & role (Owner)', icon: UserCog, onSelect: () => nav('/users') },
            { label: 'Appearance studio', icon: Palette, onSelect: () => openDialog('appearance') },
            { label: 'Keyboard shortcuts', icon: Keyboard, onSelect: () => nav('/help?tab=shortcuts') },
            { label: 'Sign out (demo)', icon: LogOut, sep: true, onSelect: () => toast({ tone: 'info', title: 'Demo prototype', body: 'Authentication arrives in Stage 5.' }) },
          ]}
        />
      </div>
    </header>
  );
}
