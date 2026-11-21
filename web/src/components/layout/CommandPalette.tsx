import { AnimatePresence, motion } from 'motion/react';
import { useAgentsCatalog } from '@/api/agents';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search, CornerDownLeft, Plus, SunMoon, Palette, Bot, Target, Hash, Sparkles, UserPlus, Boxes, RotateCcw, PanelTop, Crown, ShieldCheck, Server, Newspaper, Briefcase, Puzzle, PanelLeft, LogOut, MessagesSquare, UserRound, Globe, Bell, BookOpen, LifeBuoy } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { NAV, ROUTE_TABS, slug } from '@/config/nav';
import { PLUGINS } from '@/config/plugins';
import { useUI, openDialog, toast } from '@/store/ui';
import { useData, useVisibleMissions } from '@/store/data';
import { isApi } from '@/api/mode';
import { useAuth, useMe, isAdmin } from '@/store/auth';
import { channelId, useChat, parseChannel } from '@/store/chat';
import { useNews, domainOf } from '@/store/news';
import { useJobs } from '@/store/jobs';
import { useVms } from '@/features/ops/VMs';
import { useLineage } from '@/data/lineage';
import { MODELS, useRoutes } from '@/data/models';
import { useVisibleNotices } from '@/data/useNotices';
import { HELP } from '@/help/registry';
import { useSettings } from '@/store/settings';
import { AGENTS, AGENT_BY_ID } from '@/data/agents';

interface Cmd { id: string; group: string; label: string; hint?: string; /** searchable, not shown */ body?: string; icon: LucideIcon; run: () => void; }
const GROUP_ORDER = ['Actions', 'Go to', 'Tabs', 'Missions', 'Agents', 'Chats', 'Models', 'VMs', 'Users', 'Job Search', 'News', 'Notifications', 'Knowledge', 'Help'];

/** Ctrl/Cmd+K command palette (spec DL-63). */
export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const setOpen = useUI((s) => s.setPalette);
  const nav = useNavigate();
  const missions = useVisibleMissions();
  const me = useMe();
  const accounts = useAuth((s) => s.accounts);
  const vms = useVms((s) => s.vms);
  const sites = useJobs((s) => s.sites);
  const jobs = useJobs((s) => s.jobs);
  const news = useNews((s) => s.items);
  const lessons = useLineage((s) => s.lessons);
  const extraModels = useRoutes((s) => s.extra);
  const chats = useChat((s) => s.channels);
  const notices = useVisibleNotices();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) { setQ(''); setSel(0); window.setTimeout(() => inputRef.current?.focus(), 20); } }, [open]);

  const catalog = useAgentsCatalog(); // the search index follows the agent catalog (api mode, Stage 6)
  const all = useMemo<Cmd[]>(() => {
    const go = (p: string) => () => { nav(p); setOpen(false); };
    const act = (f: () => void) => () => { setOpen(false); f(); };
    const admin = isAdmin(me);
    const cmds: Cmd[] = [
      { id: 'a-new-mission', group: 'Actions', label: 'Add mission', hint: 'text + files · GM staffs it', icon: Plus, run: act(() => openDialog('mission-create')) },
      { id: 'a-chat-gm', group: 'Actions', label: 'Chat with the General Manager', icon: Crown, run: act(() => me && useUI.getState().openChat(channelId.gm(me.id))) },
      { id: 'a-chat-admin', group: 'Actions', label: 'Message the administrators', icon: ShieldCheck, run: act(() => me && useUI.getState().openChat(channelId.admin(me.id))) },
      { id: 'a-users', group: 'Actions', label: admin ? 'Approve users & devices' : 'My profile, password & devices', hint: 'Settings › Users', icon: UserPlus, run: go('/settings?tab=users') },
      ...(!isApi() || admin ? [{ id: 'a-new-agent', group: 'Actions', label: 'New agent', hint: 'a new, unique duty', icon: Bot, run: act(() => openDialog('agent-create')) }] : []),
      { id: 'a-add-model', group: 'Actions', label: 'Add model / provider', icon: Boxes, run: act(() => openDialog('model-add')) },
      { id: 'a-vm', group: 'Actions', label: 'Create VM', hint: 'System Operations › VMs', icon: Server, run: go('/operations?tab=vms') },
      { id: 'a-news', group: 'Actions', label: 'Add news / ask agents to search', icon: Newspaper, run: go('/notifications?tab=news') },
      { id: 'a-site', group: 'Actions', label: 'Add a job site', hint: 'Job Search plug-in', icon: Briefcase, run: go('/plugins/job-search?tab=investigate') },
      { id: 'a-plugin', group: 'Actions', label: 'Create a plug-in through a mission', icon: Puzzle, run: act(() => openDialog('mission-create', { text: 'Build a plug-in app for the rail that …' })) },
      { id: 'a-nav', group: 'Actions', label: 'Show / hide rail items', hint: 'Settings › Navigation', icon: PanelLeft, run: go('/settings?tab=navigation') },
      { id: 'a-theme', group: 'Actions', label: 'Toggle light / dark', icon: SunMoon, run: act(() => { const s = useSettings.getState(); s.set({ themeMode: s.themeMode === 'light' ? 'dark' : 'light' }); }) },
      { id: 'a-appearance', group: 'Actions', label: 'Appearance studio', hint: 'Skins, motion, density', icon: Palette, run: act(() => openDialog('appearance')) },
      { id: 'a-header', group: 'Actions', label: 'Show / hide header banner', hint: 'Top strip with logo and loop', icon: PanelTop, run: act(() => { const s = useSettings.getState(); s.set({ headerBanner: !s.headerBanner }); }) },
      { id: 'a-avatar', group: 'Actions', label: 'Customize agent faces', icon: Sparkles, run: act(() => openDialog('avatar-customizer')) },
      { id: 'a-signout', group: 'Actions', label: 'Sign out', icon: LogOut, run: act(() => useAuth.getState().signOut()) },
      ...(isApi() ? [] : [{ id: 'a-reset', group: 'Actions', label: 'Reset DEMO data', hint: 'Restore fixture missions, chats and approvals', icon: RotateCcw, run: act(() => { useData.getState().resetDemo(); toast({ tone: 'success', title: 'DEMO data reset', body: 'Fixture missions, conversations and approvals restored.' }); }) }]),
    ];
    // every screen (hidden ones too), every tab, every sub-tab
    for (const n of NAV) {
      cmds.push({ id: 'n-' + n.key, group: 'Go to', label: n.label, hint: n.note, icon: n.icon, run: go(n.path) });
      for (const t of ROUTE_TABS[n.key] ?? []) cmds.push({ id: `t-${n.key}-${t}`, group: 'Tabs', label: `${n.label} › ${t}`, icon: Hash, run: go(`${n.path}?tab=${slug(t)}`) });
    }
    for (const [sec, key] of [['Agents', 'agents'], ['Models', 'models']] as const) {
      for (const t of ROUTE_TABS[key] ?? []) cmds.push({ id: `ts-${key}-${t}`, group: 'Tabs', label: `System Operations › ${sec} › ${t}`, icon: Hash, run: go(`/operations?tab=${key}&sub=${slug(t)}`) });
    }
    for (const p of PLUGINS) {
      cmds.push({ id: 'p-' + p.key, group: 'Go to', label: p.label, hint: 'plug-in · ' + p.description, icon: p.icon, run: go(p.path) });
      for (const t of p.tabs) cmds.push({ id: `pt-${p.key}-${t}`, group: 'Tabs', label: `${p.label} › ${t}`, icon: Hash, run: go(`${p.path}?tab=${slug(t)}`) });
    }
    for (const m of missions) cmds.push({ id: 'm-' + m.id, group: 'Missions', label: `${m.id} · ${m.title}`, hint: `${m.status}${m.shared ? ' · shared' : ''}`, body: `${m.content?.text ?? ''} ${m.owner} ${m.kind}`, icon: Target, run: go(`/missions/${m.id}`) });
    for (const a of AGENTS) cmds.push({ id: 'g-' + a.id, group: 'Agents', label: a.name, hint: a.duty, body: `${a.dept} ${a.role} ${a.skills.join(' ')} ${a.site ?? ''}`, icon: Bot, run: go(`/agents/${a.id}`) });
    for (const a of AGENTS) cmds.push({ id: 'gc-' + a.id, group: 'Chats', label: `Chat with ${a.name}`, hint: 'direct chat & individual tasks', icon: MessagesSquare, run: act(() => me && useUI.getState().openChat(channelId.agent(a.id, me.id))) });
    // messages in my conversations (GM, administrators, agents, plug-ins)
    for (const [ch, msgs] of Object.entries(chats)) {
      const info = parseChannel(ch);
      if (!me || (info.userId !== me.id && !(admin && info.kind === 'admin'))) continue;
      const who = info.kind === 'gm' ? 'General Manager' : info.kind === 'admin' ? 'Administrators' : AGENT_BY_ID[info.agentId ?? '']?.name ?? 'Agent';
      for (const m of msgs.slice(-30)) cmds.push({ id: `cm-${ch}-${m.id}`, group: 'Chats', label: m.text.length > 80 ? m.text.slice(0, 79) + '…' : m.text, hint: `chat · ${who}`, body: m.text, icon: MessagesSquare, run: act(() => useUI.getState().openChat(ch)) });
    }
    for (const m of [...extraModels, ...MODELS]) cmds.push({ id: 'mo-' + m.id, group: 'Models', label: m.name, hint: `${m.kind} · ${m.provider}`, body: `${m.id} ${m.traits?.strengths.join(' ') ?? ''}`, icon: Boxes, run: act(() => { nav('/operations?tab=models&sub=manager'); window.setTimeout(() => openDialog('model-manage', { id: m.id }), 250); }) });
    for (const v of vms) cmds.push({ id: 'vm-' + v.id, group: 'VMs', label: v.name, hint: `${v.state} · ${v.vcpu} vCPU · ${v.ramGB} GB`, body: v.image, icon: Server, run: go('/operations?tab=vms') });
    for (const u of accounts.filter((x) => admin || x.id === me?.id)) cmds.push({ id: 'u-' + u.id, group: 'Users', label: u.name, hint: `${u.role} · ${u.status}`, icon: UserRound, run: go('/settings?tab=users') });
    for (const s of sites) cmds.push({ id: 'js-' + s.id, group: 'Job Search', label: s.domain, hint: `job site · ${s.state}`, icon: Globe, run: go(`/plugins/job-search?tab=investigate&site=${s.id}`) });
    for (const j of jobs.slice(0, 120)) cmds.push({ id: 'jj-' + j.id, group: 'Job Search', label: j.title, hint: `${j.company} · ${j.status}`, body: j.skills.join(' '), icon: Briefcase, run: go('/plugins/job-search?tab=jobs') });
    for (const n of news) cmds.push({ id: 'nw-' + n.id, group: 'News', label: n.title, hint: domainOf(n.url) || 'news', body: n.content + ' ' + n.tags.join(' '), icon: Newspaper, run: go('/notifications?tab=news') });
    for (const n of notices) cmds.push({ id: 'nt-' + n.id, group: 'Notifications', label: n.title, hint: n.severity, body: n.body, icon: Bell, run: go(n.route ?? '/notifications') });
    for (const l of lessons) cmds.push({ id: 'kn-' + l.id, group: 'Knowledge', label: l.title, hint: `${AGENT_BY_ID[l.agentId]?.name} · ${l.scope === 'own' ? 'kept' : 'shared up'}`, icon: BookOpen, run: go('/operations?tab=agents&sub=lineage') });
    for (const [k, e] of Object.entries(HELP)) cmds.push({ id: 'h-' + k, group: 'Help', label: e.title, hint: 'help', body: e.what, icon: LifeBuoy, run: go(`/help?tab=context-help&k=${encodeURIComponent(k)}`) });
    return cmds;
  }, [missions, nav, setOpen, me, accounts, vms, sites, jobs, news, lessons, extraModels, chats, notices, catalog]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Every word must match; rank label hits above hint/body hits; keep each group short so all kinds of elements show. */
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return all.filter((c) => c.group === 'Actions' || c.group === 'Go to');
    const words = s.split(/\s+/);
    const scored = all.map((c) => {
      const label = c.label.toLowerCase();
      const hay = `${label} ${(c.hint ?? '').toLowerCase()} ${c.group.toLowerCase()} ${(c.body ?? '').toLowerCase()}`;
      if (!words.every((w) => hay.includes(w))) return null;
      const score = (label.startsWith(s) ? 0 : label.includes(s) ? 1 : words.every((w) => label.includes(w)) ? 2 : 3) * 10 + GROUP_ORDER.indexOf(c.group);
      return { c, score };
    }).filter(Boolean) as { c: Cmd; score: number }[];
    scored.sort((x, y) => x.score - y.score);
    const perGroup: Record<string, number> = {};
    const out: Cmd[] = [];
    for (const { c } of scored) { perGroup[c.group] = (perGroup[c.group] ?? 0) + 1; if (perGroup[c.group] <= 6) out.push(c); }
    return out.sort((x, y) => GROUP_ORDER.indexOf(x.group) - GROUP_ORDER.indexOf(y.group)).slice(0, 80);
  }, [q, all]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(results.length - 1, x + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(0, x - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); results[sel]?.run(); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  };

  let lastGroup = '';
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="palette-layer" onKeyDown={onKey}>
          <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
          <motion.div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" data-dialog="DL-63"
            initial={{ opacity: 0, y: -16, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: .98 }} transition={{ duration: .2 }}>
            <div style={{ position: 'relative' }}>
              <Search size={18} style={{ position: 'absolute', left: 17, top: 18, color: 'var(--accent-2)' }} />
              <input ref={inputRef} className="palette-input" placeholder="Search everything: commands, screens, missions, agents, models, VMs, users, jobs, news, help…" value={q} onChange={(e) => setQ(e.target.value)}
                role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={results[sel] ? 'pc-' + results[sel].id : undefined} />
            </div>
            <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
              {results.length === 0 && <div className="empty" style={{ padding: 24 }}>No matches for “{q}”.</div>}
              {results.map((c, i) => {
                const head = c.group !== lastGroup ? (lastGroup = c.group) : null;
                return (
                  <div key={c.id}>
                    {head && <div className="palette-group">{head}</div>}
                    <button id={'pc-' + c.id} role="option" aria-selected={i === sel} className="palette-item" onMouseEnter={() => setSel(i)} onClick={c.run}>
                      <c.icon size={16} style={{ color: 'var(--accent-2)', flex: 'none' }} />
                      <span className="ellipsis">{c.label}</span>
                      {c.hint && <span className="dim" style={{ fontSize: 12, marginLeft: 'auto' }}>{c.hint}</span>}
                      {i === sel && <CornerDownLeft size={14} style={{ marginLeft: c.hint ? 8 : 'auto', color: 'var(--text-dim)' }} />}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="row" style={{ padding: '8px 14px', borderTop: '1px solid var(--border-soft)', fontSize: 11.5, color: 'var(--text-dim)', gap: 14 }}>
              <span><span className="kbd">↑↓</span> navigate</span><span><span className="kbd">Enter</span> open</span><span><span className="kbd">Esc</span> close</span>
              <span style={{ marginLeft: 'auto' }}>{results.length} results</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
