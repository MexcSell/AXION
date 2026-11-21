import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, AlertTriangle, Radio, Bot, Target, CheckCheck, Activity, Info, CheckCircle2, ArrowRight, Database, Workflow, GitMerge, BookOpen, ShieldCheck, Settings2, RefreshCw, Clock, XCircle,
  Plus, Inbox, Hourglass, Archive, SlidersHorizontal, Newspaper, Play, Pause, Layers, Cpu, Trash2,
} from 'lucide-react';
import { TopBoard, FrameBody, BottomBoard } from '@/components/layout/PageFrame';
import { NewsTab, UserRequests } from '@/features/notifications/News';
import { useNews } from '@/store/news';
import { isApi } from '@/api/mode';
import { useMe, isAdmin, usePendingApprovals } from '@/store/auth';
import { Panel } from '@/components/ui/Panel';
import { Tabs } from '@/components/ui/Tabs';
import { Chip, DemoTag } from '@/components/ui/Chips';
import { IconButton } from '@/components/ui/IconButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { CountUp } from '@/components/ui/CountUp';
import { Field, Segmented, Switch } from '@/components/ui/Form';
import { Donut } from '@/components/viz/Charts';
import { CoreCube } from '@/components/art/CoreArt';
import { useTab } from '@/hooks/useTab';
import { useData, allApprovals, useVisibleMissions } from '@/store/data';
import type { Notice } from '@/data/notifications';
import { ACTIVITY, LIVE_POOL, type ActivityEvent } from '@/data/notifications-extra';
import { useVisibleNotices } from '@/data/useNotices';
import { RISK_TIER, useUG } from '@/data/users-governance';
import { toast, openDialog } from '@/store/ui';
import { ago, clock, cx } from '@/lib/format';
import '@/theme/pages/users-governance-notifications.css';

const SEV = {
  critical: { Icon: AlertTriangle, label: 'Critical', c: 'var(--bad)', h: 350 },
  warning: { Icon: AlertTriangle, label: 'Warning', c: 'var(--warn)', h: 45 },
  info: { Icon: Info, label: 'Info', c: 'var(--info)', h: 205 },
  success: { Icon: CheckCircle2, label: 'Done', c: 'var(--good)', h: 150 },
} as const;
const CAT_LABEL: Record<Notice['category'], string> = { mission: 'Mission', agent: 'Update', system: 'System', approval: 'Approval', evolution: 'Evolve' };
type Filter = 'all' | 'alerts' | 'system' | 'agent' | 'mission';

const matches = (n: Notice, f: Filter) => f === 'all' || (f === 'alerts' && (n.severity === 'critical' || n.severity === 'warning')) || (f === 'system' && n.category === 'system') || (f === 'agent' && (n.category === 'agent' || n.category === 'evolution')) || (f === 'mission' && (n.category === 'mission' || n.category === 'approval'));

export default function NotificationsPage() {
  const ALL_NOTICES = useVisibleNotices();
  const [tab, setTab, tabs] = useTab('notifications');
  const read = useData((s) => s.readNotifications);
  const resolved = useUG((s) => s.resolvedNotices);
  const missions = useVisibleMissions();
  const decisions = useData((s) => s.approvalDecisions);
  const pendingAppr = useMemo(() => allApprovals(missions, decisions).filter((a) => a.status === 'pending').length, [missions, decisions]);
  const unread = ALL_NOTICES.filter((n) => !read[n.id]).length;
  const pendingNotices = ALL_NOTICES.filter((n) => n.actionable && !resolved[n.id]).length;
  const icons = [Inbox, Newspaper, Hourglass, Archive, SlidersHorizontal];
  const me = useMe();
  const userReq = usePendingApprovals();
  const news = useNews((s) => s.items);
  const freshNews = news.filter((n) => Date.now() - n.at < 6 * 3_600_000).length;
  const counts: Record<string, number | undefined> = { Inbox: unread, News: freshNews || undefined, Pending: pendingNotices + pendingAppr + (isAdmin(me) ? userReq.total : 0) };
  return (
    <div className="page ug-page">
      <TopBoard id="notifications" icon={Bell} title="Notifications & Activity" help="nt.page" sub="Real-time alerts, system events, agent updates, and execution activity." className="nt-head"
        actions={<DemoTag />}
        tabs={{ tabs, value: tab, onChange: setTab, icons, ariaLabel: 'Notification views', counts }}
        toolbar={<span>{{ Inbox: 'Everything new, newest first.', News: 'News from users, and new URLs and content found by the research agents.', Pending: 'Items that need a decision from you.', Resolved: 'Handled items, kept for audit.', Rules: 'What notifies whom, and how.' }[tab]}</span>}>
        <div className="nt-hero" aria-hidden><CoreCube width={150} /></div>
      </TopBoard>
      <FrameBody tab={tab} panel={false} className="col fb-gap">
        {tab === 'Inbox' && <InboxTab />}
        {tab === 'News' && <NewsTab />}
        {tab === 'Pending' && <PendingTab />}
        {tab === 'Resolved' && <ResolvedTab />}
        {tab === 'Rules' && <RulesTab />}
      </FrameBody>
      <BottomBoard id="notifications" title="Notification boards" cols="repeat(3, minmax(0, 1fr))">
        <NoticeBoards />
      </BottomBoard>
    </div>
  );
}

/** Foldable bottom boards (owner update u1: top and bottom of Notifications can be minimized). */
function NoticeBoards() {
  const ALL_NOTICES = useVisibleNotices();
  const read = useData((s) => s.readNotifications);
  const news = useNews((s) => s.items);
  const me = useMe();
  const req = usePendingApprovals();
  const bySev = (['critical', 'warning', 'info', 'success'] as const).map((k) => ({ label: SEV[k].label, value: ALL_NOTICES.filter((n) => n.severity === k).length, color: SEV[k].c }));
  const latest = [...news].sort((a, b) => b.at - a.at).slice(0, 3);
  return <>
    <Panel icon={Layers} title="By severity" help="nt.page" className="bottom-panel">
      <div className="row" style={{ gap: 14 }}><Donut segs={bySev} size={96} center={String(ALL_NOTICES.length)} sub="notices" /><div className="col" style={{ gap: 4, fontSize: 12.5 }}>{bySev.map((s) => <span key={s.label} className="row" style={{ gap: 6 }}><i style={{ width: 9, height: 9, borderRadius: 3, background: s.color }} />{s.label}<b className="tnum" style={{ marginLeft: 'auto' }}>{s.value}</b></span>)}</div></div>
    </Panel>
    <Panel icon={Inbox} title="Unread" help="nt.page" className="bottom-panel">
      <div className="display tnum" style={{ fontSize: 34 }}><CountUp value={ALL_NOTICES.filter((n) => !read[n.id]).length} /></div>
      <div className="dim" style={{ fontSize: 12 }}>of {ALL_NOTICES.length} notifications</div>
      {isAdmin(me) && <div className="row warn" style={{ gap: 6, marginTop: 8, fontSize: 12.5 }}><Hourglass size={13} />{req.total} user / device request{req.total === 1 ? '' : 's'}</div>}
    </Panel>
    <Panel icon={Newspaper} title="Latest news" help="nt.news" className="bottom-panel">
      <div className="col" style={{ gap: 6 }}>{latest.map((n) => <div key={n.id} className="ellipsis" style={{ fontSize: 12.5 }} title={n.title}><span className="dim tnum" style={{ marginRight: 6 }}>{clock(0, n.at)}</span>{n.title}</div>)}</div>
    </Panel>
  </>;
}

/* ------------------------------------------------------------------ */
function NoticeRow({ n, i, onOpen, children }: { n: Notice; i: number; onOpen: (n: Notice) => void; children?: React.ReactNode }) {
  const read = useData((s) => !!s.readNotifications[n.id]);
  const s = SEV[n.severity];
  return (
    <motion.div layout className={cx('nt-row', !read && 'unread')} style={{ ['--h' as string]: s.h }} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 60 }} transition={{ delay: Math.min(i, 8) * .045 }}>
      <button className="nt-row-main" onClick={() => onOpen(n)} aria-label={`${n.title}. ${read ? 'Read' : 'Unread'}. Open`}>
        <span className="nt-sev"><s.Icon size={20} /></span>
        <Chip hue={s.h} size="sm" solid>{n.severity === 'critical' ? 'Critical' : n.severity === 'warning' ? 'Warning' : CAT_LABEL[n.category]}</Chip>
        <span className="nt-body"><b className="ellipsis">{n.title}</b><span className="dim ellipsis">{n.body}</span></span>
        <span className="dim nt-ago">{ago(n.agoMin)}</span>
        <span className={cx('nt-dot', !read && 'on')} style={{ color: s.c }} aria-hidden />
      </button>
      {children}
    </motion.div>
  );
}

function useOpen() {
  const nav = useNavigate();
  const markRead = useData((s) => s.markRead);
  return (n: Notice) => { markRead(n.id); if (n.route) nav(n.route); };
}

function InboxTab() {
  const ALL_NOTICES = useVisibleNotices();
  const [f, setF] = useState<Filter>('all');
  const open = useOpen();
  const read = useData((s) => s.readNotifications);
  const markAll = useData((s) => s.markAllRead);
  const nav = useNavigate();
  const list = ALL_NOTICES.filter((n) => matches(n, f)).sort((a, b) => a.agoMin - b.agoMin);
  const unread = ALL_NOTICES.filter((n) => !read[n.id]).length;
  const c = (x: Filter) => ALL_NOTICES.filter((n) => matches(n, x)).length;
  const tiles: { key: Filter; icon: typeof Bell; v: number; label: string; d: string; c: string }[] = [
    { key: 'alerts', icon: AlertTriangle, v: ALL_NOTICES.filter((n) => n.severity === 'critical').length, label: 'Active Alerts', d: '+1', c: '#fb4d6a' },
    { key: 'system', icon: Radio, v: c('system') * 6, label: 'System Events', d: '+5', c: '#38bdf8' },
    { key: 'agent', icon: Bot, v: c('agent') * 6, label: 'Agent Updates', d: '+8', c: '#a78bfa' },
    { key: 'mission', icon: Target, v: c('mission') + 2, label: 'Mission Updates', d: '+2', c: '#2ee98a' },
  ];
  const sevSegs = [
    { label: 'Critical', value: ALL_NOTICES.filter((n) => n.severity === 'critical').length, color: 'var(--bad)' },
    { label: 'Warning', value: ALL_NOTICES.filter((n) => n.severity === 'warning').length, color: 'var(--warn)' },
    { label: 'Info', value: ALL_NOTICES.filter((n) => n.severity === 'info').length, color: 'var(--info)' },
    { label: 'Resolved', value: ALL_NOTICES.filter((n) => n.severity === 'success').length, color: 'var(--text-dim)' },
  ];
  return (
    <>
      <div className="nt-tiles">
        {tiles.map((t, i) => (
          <motion.button key={t.key} className={cx('kpi nt-tile', f === t.key && 'on')} style={{ ['--kc' as string]: t.c }} onClick={() => setF(f === t.key ? 'all' : t.key)} aria-pressed={f === t.key}
            initial={{ opacity: 0, y: 12, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: .06 + i * .06 }}>
            <t.icon size={42} strokeWidth={1.5} className="kpi-ico" aria-hidden />
            <div><div className="kpi-val"><CountUp value={t.v} /></div><div className="kpi-label">{t.label}</div><div className="kpi-delta">↑ {t.d}</div></div>
          </motion.button>))}
      </div>
      <div className="nt-mid">
        <Panel icon={Bell} title={<>Notifications <span className="dim" style={{ fontSize: 13, fontWeight: 500 }}>({unread} New)</span></>} help="nt.inbox" delay={.1}
          actions={<button className="btn sm" disabled={unread === 0} onClick={() => { markAll(ALL_NOTICES.map((n) => n.id)); toast({ tone: 'success', title: 'All marked as read', body: 'Top bar and rail badges are updated.' }); }}><CheckCheck size={14} />Mark all as read</button>}>
          <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
            <Tabs size="sm" ariaLabel="Filter notifications" value={f} onChange={setF} tabs={[{ key: 'all', label: 'All', count: ALL_NOTICES.length }, { key: 'alerts', label: 'Alerts', count: c('alerts') }, { key: 'system', label: 'System' }, { key: 'agent', label: 'Agent' }, { key: 'mission', label: 'Mission' }]} />
          </div>
          <div className="col nt-list" style={{ gap: 7 }}>
            <AnimatePresence mode="popLayout" initial={false}>{list.map((n, i) => <NoticeRow key={n.id} n={n} i={i} onOpen={open} />)}</AnimatePresence>
            {list.length === 0 && <EmptyState icon={Bell} title="Nothing here" body="No notifications match this filter." action={<button className="btn" onClick={() => setF('all')}>Show all</button>} />}
          </div>
          <button className="nt-more" onClick={() => nav('/notifications?tab=resolved')}>View all notifications <ArrowRight size={15} /></button>
        </Panel>
        <ActivityStream />
      </div>
      <div className="nt-bottom">
        <Panel icon={Layers} title="Alert Summary" help="nt.summary" delay={.2}>
          <div className="row" style={{ gap: 22, justifyContent: 'center' }}>
            <Donut segs={sevSegs} size={150} stroke={20} center={String(sevSegs.reduce((s, x) => s + x.value, 0))} sub="Total" />
            <div className="col" style={{ gap: 9, fontSize: 13.5, minWidth: 130 }}>{sevSegs.map((s) => <div key={s.label} className="row" style={{ justifyContent: 'space-between' }}><span className="row" style={{ gap: 8 }}><span className="dot sm" style={{ color: s.color }} />{s.label}</span><b className="tnum">{s.value}</b></div>)}</div>
          </div>
        </Panel>
        <Panel icon={Bot} title={<>Agent Updates <span className="dim" style={{ fontSize: 13, fontWeight: 500 }}>(24)</span></>} help="nt.agentUpdates" delay={.25}>
          <div className="col" style={{ gap: 8 }}>
            {[['Researcher-01', 'v2.3.1', 'v2.4.0', '+18.6%', 'researcher-01'], ['Tester-01', 'v2.3.0', 'v2.4.0', '+12.9%', 'tester-01'], ['Release-01', 'v2.3.2', 'v2.4.0', '+15.4%', 'release-01']].map(([n, a, b, g, id]) => (
              <div key={n} className="nt-agent-row"><span className="nt-mini-bot"><Bot size={18} /></span><b>{n}</b><span className="dim mono" style={{ fontSize: 11.5 }}>{a} → {b}</span><span className="spacer" /><b className="good tnum">{g}</b>
                <IconButton icon={Play} label={`Open ${n} versions`} size="xs" variant="bordered" onClick={() => nav(`/agents/${id}?tab=versions`)} /></div>))}
          </div>
          <button className="nt-more" onClick={() => nav('/agents?tab=development')}>View all agent updates <ArrowRight size={15} /></button>
        </Panel>
        <Panel icon={Settings2} title={<>System Events <span className="dim" style={{ fontSize: 13, fontWeight: 500 }}>(18)</span></>} help="nt.system" delay={.3}>
          <div className="col" style={{ gap: 8 }}>
            {[[CheckCircle2, 'All services operational', '10:22', 'good'], [RefreshCw, 'Nightly backup verified', '10:07', 'info'], [Database, 'Knowledge sync +128 entries', '09:56', 'info'], [GitMerge, 'Code merged: feature/evolution', '09:41', 'info']].map(([I, t, tm, tone]) => {
              const Ic = I as typeof Info; return <div key={t as string} className="nt-sys-row"><Ic size={17} className={tone as string} /><span className="ellipsis">{t as string}</span><span className="spacer" /><span className="dim tnum">{tm as string}</span></div>; })}
          </div>
          <button className="nt-more" onClick={() => nav('/operations')}>View all system events <ArrowRight size={15} /></button>
        </Panel>
        <MissionUpdates />
      </div>
    </>
  );
}

function MissionUpdates() {
  const nav = useNavigate();
  const rows = [['M-124', 'Pricing page rebuild', 'Completed', 'good', CheckCircle2], ['M-126', 'Marketing site migration', 'In Progress', 'info', Workflow], ['M-132', 'Status page automation', 'Waiting', 'warn', Clock]] as const;
  return (
    <Panel icon={Target} title={<>Mission Updates <span className="dim" style={{ fontSize: 13, fontWeight: 500 }}>(7)</span></>} help="nt.mission" delay={.35}>
      <div className="col" style={{ gap: 8 }}>
        {rows.map(([id, t, st, tone, I]) => <button key={id} className="nt-sys-row nt-btn" onClick={() => nav(`/missions/${id}`)}><I size={17} className={tone} /><b className="mono" style={{ fontSize: 12 }}>{id}</b><span className="ellipsis">{t}</span><span className="spacer" /><span className={tone}>{st}</span></button>)}
      </div>
      <button className="nt-more" onClick={() => nav('/missions')}>View all mission updates <ArrowRight size={15} /></button>
    </Panel>
  );
}

const ICON_MAP = { agent: Bot, data: Database, trade: Cpu, done: CheckCircle2, merge: GitMerge, know: BookOpen, health: ShieldCheck } as const;
function ActivityStream() {
  const [events, setEvents] = useState<(ActivityEvent & { ts: number })[]>(() => ACTIVITY.map((a) => ({ ...a, ts: Date.now() - a.agoSec * 1000 })));
  const [live, setLive] = useState(true);
  useEffect(() => {
    if (!live) return;
    let k = 0;
    const t = window.setInterval(() => {
      const p = LIVE_POOL[k++ % LIVE_POOL.length];
      setEvents((e) => [{ ...p, id: `L-${Date.now()}`, agoSec: 0, ts: Date.now() }, ...e].slice(0, 9));
    }, 4200);
    return () => window.clearInterval(t);
  }, [live]);
  return (
    <Panel icon={Activity} title="Live Activity Stream" help="nt.stream" delay={.15}
      actions={<button className={cx('nt-live', live && 'on')} onClick={() => { setLive(!live); toast({ tone: 'info', title: live ? 'Stream paused' : 'Stream live', body: 'Demo events are generated locally.' }); }} aria-pressed={live}>{live ? <><span className="nt-live-dot" />Live</> : <><Pause size={12} />Paused</>}</button>}>
      <ol className="nt-stream" aria-live="polite">
        <AnimatePresence initial={false}>
          {events.map((e) => { const I = ICON_MAP[e.icon]; return (
            <motion.li key={e.id} layout initial={{ opacity: 0, y: -18, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 28 }}>
              <span className="nt-node" /><span className="tnum nt-time">{clock(0, e.ts).padEnd(5)}:{String(new Date(e.ts).getSeconds()).padStart(2, '0')}</span>
              <span className="nt-ev-ico"><I size={18} /></span><span className="nt-ev-text">{e.text}</span>
            </motion.li>); })}
        </AnimatePresence>
      </ol>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
function PendingTab() {
  const ALL_NOTICES = useVisibleNotices();
  const open = useOpen();
  const resolved = useUG((s) => s.resolvedNotices);
  const resolve = useUG((s) => s.resolveNotice);
  const missions = useVisibleMissions();
  const decisions = useData((s) => s.approvalDecisions);
  const decide = useData((s) => s.decideApproval);
  const appr = allApprovals(missions, decisions).filter((a) => a.status === 'pending').sort((a, b) => RISK_TIER[a.risk].order - RISK_TIER[b.risk].order || a.expiresMin - b.expiresMin);
  const notices = ALL_NOTICES.filter((n) => n.actionable && !resolved[n.id]);
  const groups: [string, Notice[]][] = [['Critical', notices.filter((n) => n.severity === 'critical')], ['Needs attention', notices.filter((n) => n.severity !== 'critical')]];
  return (
    <div className="nt-two">
      <UserRequests />
      <Panel icon={Hourglass} title="Unhandled" help="nt.pending" delay={.05} sub="Grouped by urgency. Resolving moves an item to Resolved.">
        <div className="col" style={{ gap: 12 }}>
          {groups.map(([g, ns]) => ns.length > 0 && (
            <div key={g}><div className="section-label" style={{ marginBottom: 6 }}>{g} ({ns.length})</div>
              <div className="col" style={{ gap: 7 }}><AnimatePresence mode="popLayout">{ns.map((n, i) => (
                <NoticeRow key={n.id} n={n} i={i} onOpen={open}>
                  <button className="btn sm" onClick={() => { resolve(n.id, 'Acknowledged by Luca'); toast({ tone: 'success', title: 'Moved to Resolved', body: n.title }); }}><CheckCircle2 size={14} />Resolve</button>
                </NoticeRow>))}</AnimatePresence></div></div>))}
          {notices.length === 0 && <EmptyState icon={CheckCircle2} title="All caught up" body="No unhandled alerts or mentions." />}
        </div>
      </Panel>
      <Panel icon={ShieldCheck} title={<>Approvals waiting <span className="dim" style={{ fontSize: 13, fontWeight: 500 }}>({appr.length})</span></>} help="nt.pendingApprovals" delay={.1}>
        <div className="col" style={{ gap: 8 }}>
          <AnimatePresence mode="popLayout">
            {appr.map((a) => (
              <motion.div key={a.id} layout className="nt-appr" style={{ ['--h' as string]: RISK_TIER[a.risk].hue }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 80 }}>
                <div className="row" style={{ gap: 6 }}><Chip hue={RISK_TIER[a.risk].hue} solid size="sm">{RISK_TIER[a.risk].tier}</Chip><b className="ellipsis" style={{ fontSize: 13 }}>{a.title}</b></div>
                <div className="dim" style={{ fontSize: 12, margin: '3px 0 8px' }}>{a.missionId} · expires in {a.expiresMin} min</div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm ghost" onClick={() => openDialog('approval-decision', { approvalId: a.id })}>Details</button><span className="spacer" />
                  <button className="btn sm danger" onClick={() => openDialog('approval-decision', { approvalId: a.id })}>Deny</button>
                  <button className="btn sm good" onClick={() => { if (a.risk === 'critical') { openDialog('approval-decision', { approvalId: a.id }); return; } decide(a.id, 'approved'); toast({ tone: 'success', title: 'Approved (demo)', body: a.title }); }}>Approve</button>
                </div>
              </motion.div>))}
          </AnimatePresence>
          {appr.length === 0 && <EmptyState icon={ShieldCheck} title="No approvals waiting" />}
        </div>
      </Panel>
    </div>
  );
}

function ResolvedTab() {
  const me = useMe();
  const ALL_NOTICES = useVisibleNotices();
  const resolved = useUG((s) => s.resolvedNotices);
  const missions = useVisibleMissions();
  const decisions = useData((s) => s.approvalDecisions);
  const done = allApprovals(missions, decisions).filter((a) => a.status !== 'pending');
  const open = useOpen();
  const arch = ALL_NOTICES.filter((n) => n.severity === 'success' || resolved[n.id]);
  return (
    <div className="nt-two">
      <Panel icon={Archive} title="Resolved and archived" help="nt.resolved" delay={.05} sub="Immutable history: outcome, who and why.">
        <div className="col" style={{ gap: 7 }}>
          {arch.map((n, i) => <NoticeRow key={n.id} n={n} i={i} onOpen={open}><Chip hue={150} size="sm">{resolved[n.id] ?? 'Completed automatically'}</Chip></NoticeRow>)}
          {arch.length === 0 && <EmptyState icon={Archive} title="Nothing archived yet" />}
        </div>
      </Panel>
      <Panel icon={ShieldCheck} title="Decisions" help="nt.decisions" delay={.1}>
        <div className="col" style={{ gap: 8 }}>
          <AnimatePresence>{done.map((a) => (
            <motion.div key={a.id} className="nt-appr" style={{ ['--h' as string]: a.status === 'approved' ? 150 : 0 }} initial={{ opacity: 0, x: -40 }} animate={{ opacity: 1, x: 0 }}>
              <div className="row" style={{ gap: 6 }}>{a.status === 'approved' ? <CheckCircle2 size={16} className="good" /> : <XCircle size={16} className="bad" />}<b className="ellipsis" style={{ fontSize: 13 }}>{a.title}</b></div>
              <div className="dim" style={{ fontSize: 12, marginTop: 3 }}>{a.status} by {isApi() && me ? me.name : 'Luca (Owner)'} just now · {a.missionId} · {RISK_TIER[a.risk].tier}</div>
            </motion.div>))}</AnimatePresence>
          {done.length === 0 && <div className="dim" style={{ fontSize: 12.5 }}>Decisions made in Pending appear here, with comment and hash.</div>}
        </div>
      </Panel>
    </div>
  );
}

function RulesTab() {
  const rules = useUG((s) => s.rules);
  const toggle = useUG((s) => s.toggleRule);
  const [mode, setMode] = useState<'instant' | 'digest' | 'off'>('instant');
  const [sev, setSev] = useState<'all' | 'warning+' | 'critical'>('warning+');
  const [qs, setQs] = useState('22:00');
  const [qe, setQe] = useState('07:00');
  const [rate, setRate] = useState(12);
  const [subs, setSubs] = useState<Record<string, boolean>>({ 'M-126': true, 'M-128': true, 'M-132': false, 'M-127': true });
  return (
    <div className="nt-two">
      <Panel icon={SlidersHorizontal} title="Delivery preferences" help="nt.rules" delay={.05} sub="Personal scope. Critical alerts always break through quiet hours.">
        <div className="col" style={{ gap: 14 }}>
          <Field label="Delivery mode" help="nt.rules.mode"><Segmented ariaLabel="Delivery mode" value={mode} onChange={setMode} options={[{ key: 'instant', label: 'Instant' }, { key: 'digest', label: 'Daily digest' }, { key: 'off', label: 'Muted' }]} /></Field>
          <Field label="Minimum severity" help="nt.rules.severity"><Segmented ariaLabel="Severity" value={sev} onChange={setSev} options={[{ key: 'all', label: 'All' }, { key: 'warning+', label: 'Warning+' }, { key: 'critical', label: 'Critical only' }]} /></Field>
          <Field label="Quiet hours" help="nt.rules.quiet"><div className="row" style={{ gap: 8 }}><input type="time" className="input" style={{ width: 130 }} value={qs} onChange={(e) => setQs(e.target.value)} aria-label="Quiet hours start" /><span className="dim">to</span><input type="time" className="input" style={{ width: 130 }} value={qe} onChange={(e) => setQe(e.target.value)} aria-label="Quiet hours end" /></div></Field>
          <Field label={`Rate limit: ${rate} per hour`} help="nt.rules.rate"><input type="range" min={1} max={60} value={rate} onChange={(e) => setRate(+e.target.value)} aria-label="Rate limit per hour" style={{ accentColor: 'var(--accent-2)' }} /></Field>
          <Field label="Mission subscriptions" help="nt.rules.subs">
            <div className="grid g-2">{Object.entries(subs).map(([k, v]) => <div key={k} className="subpanel row" style={{ justifyContent: 'space-between' }}><span className="mono">{k}</span><Switch checked={v} onChange={(x) => setSubs({ ...subs, [k]: x })} label={`Subscribe to ${k}`} /></div>)}</div>
          </Field>
          <div className="row" style={{ gap: 8 }}><button className="btn primary" onClick={() => toast({ tone: 'success', title: 'Preferences saved (demo)', body: `${mode} · ${sev} · quiet ${qs}-${qe} · ${rate}/h` })}>Save preferences</button><button className="btn ghost" onClick={() => { setMode('instant'); setSev('warning+'); setRate(12); toast({ tone: 'info', title: 'Defaults restored' }); }}>Reset</button></div>
        </div>
      </Panel>
      <Panel icon={Bell} title="Rules" help="nt.rulesList" delay={.1} actions={<button className="btn sm primary" onClick={() => openDialog('notification-rule')}><Plus size={14} />New rule</button>}>
        <div className="col" style={{ gap: 8 }}>
          <AnimatePresence initial={false}>{rules.map((r) => (
            <motion.div key={r.id} layout className={cx('subpanel glass-card nt-rule', !r.on && 'off')} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <div className="row"><b>{r.name}</b><span className="spacer" /><Switch checked={r.on} onChange={() => toggle(r.id)} label={`Enable ${r.name}`} /></div>
              <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>{r.events.map((e) => <Chip key={e} hue={225} size="sm">{e}</Chip>)}<Chip hue={200} size="sm">{r.channel}</Chip><Chip hue={45} size="sm">{r.urgency}</Chip><Chip hue={165} size="sm">{r.freq}</Chip></div>
              <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>Quiet hours: {r.quiet}</div>
            </motion.div>))}</AnimatePresence>
        </div>
      </Panel>
    </div>
  );
}
void Trash2;
