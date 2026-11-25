import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, AlertTriangle, Radio, Bot, Target, CheckCheck, Info, CheckCircle2, ArrowRight, ShieldCheck, XCircle, Inbox, Hourglass, Archive, Layers, Gauge, Zap, Timer } from 'lucide-react';
import { TopBoard, FrameBody, BottomBoard } from '@/components/layout/PageFrame';
import { ApprovalFacts, GateNote, useGate } from '@/features/approvals/ApprovalBinding';
import { UserRequests } from '@/features/notifications/News';
import { isApi } from '@/api/mode';
import { useMe, isAdmin, usePendingApprovals } from '@/store/auth';
import { Panel } from '@/components/ui/Panel';
import { Tabs } from '@/components/ui/Tabs';
import { Chip } from '@/components/ui/Chips';
import { EmptyState } from '@/components/ui/EmptyState';
import { CountUp } from '@/components/ui/CountUp';
import { Donut } from '@/components/viz/Charts';
import { CoreCube } from '@/components/art/CoreArt';
import { useTab } from '@/hooks/useTab';
import { useData, allApprovals, useVisibleMissions } from '@/store/data';
import { fmtDuration } from '@/features/approvals/quality';
import '@/theme/pages/c58-approval-quality.css';
import type { Notice } from '@/data/notifications';
import type { Approval } from '@/data/types';
import { useVisibleNotices } from '@/data/useNotices';
import { RISK_TIER } from '@/data/users-governance';
import { openDialog } from '@/store/ui';
import { ago, cx } from '@/lib/format';
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
  const resolved = useData((s) => s.readNotifications);
  const missions = useVisibleMissions();
  const decisions = useData((s) => s.approvalDecisions);
  const pendingAppr = useMemo(() => allApprovals(missions, decisions).filter((a) => a.status === 'pending').length, [missions, decisions]);
  const unread = ALL_NOTICES.filter((n) => !read[n.id]).length;
  const pendingNotices = ALL_NOTICES.filter((n) => n.actionable && !resolved[n.id]).length;
  const icons = [Inbox, Hourglass, Archive];
  const me = useMe();
  const userReq = usePendingApprovals();
  const counts: Record<string, number | undefined> = { Inbox: unread, Pending: pendingNotices + pendingAppr + (isAdmin(me) ? userReq.total : 0) };
  return (
    <div className="page ug-page">
      <TopBoard id="notifications" icon={Bell} title="Notifications & Activity" help="nt.page" sub="Real-time alerts, system events, agent updates, and execution activity." className="nt-head"
        tabs={{ tabs, value: tab, onChange: setTab, icons, ariaLabel: 'Notification views', counts }}
        toolbar={<span>{{ Inbox: 'Everything new, newest first.', News: 'News from users, and new URLs and content found by the research agents.', Pending: 'Items that need a decision from you.', Resolved: 'Handled items, kept for audit.', Rules: 'What notifies whom, and how.' }[tab]}</span>}>
        <div className="nt-hero" aria-hidden><CoreCube width={150} /></div>
      </TopBoard>
      <FrameBody tab={tab} panel={false} className="col fb-gap">
        {tab === 'Inbox' && <InboxTab />}
        {tab === 'Pending' && <PendingTab />}
        {tab === 'Resolved' && <ResolvedTab />}
      </FrameBody>
      <BottomBoard id="notifications" title="Notification boards" cols="repeat(2, minmax(0, 1fr))">
        <NoticeBoards />
      </BottomBoard>
    </div>
  );
}

/** Foldable bottom boards (owner update u1: top and bottom of Notifications can be minimized). */
function NoticeBoards() {
  const ALL_NOTICES = useVisibleNotices();
  const read = useData((s) => s.readNotifications);
  const me = useMe();
  const req = usePendingApprovals();
  const bySev = (['critical', 'warning', 'info', 'success'] as const).map((k) => ({ label: SEV[k].label, value: ALL_NOTICES.filter((n) => n.severity === k).length, color: SEV[k].c }));
  return <>
    <Panel icon={Layers} title="By severity" help="nt.page" className="bottom-panel">
      <div className="row" style={{ gap: 14 }}><Donut segs={bySev} size={96} center={String(ALL_NOTICES.length)} sub="notices" /><div className="col" style={{ gap: 4, fontSize: 12.5 }}>{bySev.map((s) => <span key={s.label} className="row" style={{ gap: 6 }}><i style={{ width: 9, height: 9, borderRadius: 3, background: s.color }} />{s.label}<b className="tnum" style={{ marginLeft: 'auto' }}>{s.value}</b></span>)}</div></div>
    </Panel>
    <Panel icon={Inbox} title="Unread" help="nt.page" className="bottom-panel">
      <div className="display tnum" style={{ fontSize: 34 }}><CountUp value={ALL_NOTICES.filter((n) => !read[n.id]).length} /></div>
      <div className="dim" style={{ fontSize: 12 }}>of {ALL_NOTICES.length} notifications</div>
      {isAdmin(me) && <div className="row warn" style={{ gap: 6, marginTop: 8, fontSize: 12.5 }}><Hourglass size={13} />{req.total} user / device request{req.total === 1 ? '' : 's'}</div>}
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
  const tiles: { key: Filter; icon: typeof Bell; v: number; label: string; c: string }[] = [
    { key: 'alerts', icon: AlertTriangle, v: ALL_NOTICES.filter((n) => n.severity === 'critical').length, label: 'Active Alerts', c: '#fb4d6a' },
    { key: 'system', icon: Radio, v: c('system'), label: 'System Events', c: '#38bdf8' },
    { key: 'agent', icon: Bot, v: c('agent'), label: 'Agent Updates', c: '#a78bfa' },
    { key: 'mission', icon: Target, v: c('mission'), label: 'Mission Updates', c: '#2ee98a' },
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
            <div><div className="kpi-val"><CountUp value={t.v} /></div><div className="kpi-label">{t.label}</div></div>
          </motion.button>))}
      </div>
      <div className="nt-mid">
        <Panel icon={Bell} title={<>Notifications <span className="dim" style={{ fontSize: 13, fontWeight: 500 }}>({unread} New)</span></>} help="nt.inbox" delay={.1}
          actions={<button className="btn sm" disabled={unread === 0} onClick={() => { markAll(ALL_NOTICES.map((n) => n.id)); }}><CheckCheck size={14} />Mark all as read</button>}>
          <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
            <Tabs size="sm" ariaLabel="Filter notifications" value={f} onChange={setF} tabs={[{ key: 'all', label: 'All', count: ALL_NOTICES.length }, { key: 'alerts', label: 'Alerts', count: c('alerts') }, { key: 'system', label: 'System' }, { key: 'agent', label: 'Agent' }, { key: 'mission', label: 'Mission' }]} />
          </div>
          <div className="col nt-list" style={{ gap: 7 }}>
            <AnimatePresence mode="popLayout" initial={false}>{list.map((n, i) => <NoticeRow key={n.id} n={n} i={i} onOpen={open} />)}</AnimatePresence>
            {list.length === 0 && <EmptyState icon={Bell} title="Nothing here" body="No notifications match this filter." action={<button className="btn" onClick={() => setF('all')}>Show all</button>} />}
          </div>
          <button className="nt-more" onClick={() => nav('/notifications?tab=resolved')}>View all notifications <ArrowRight size={15} /></button>
        </Panel>
      </div>
      <div className="nt-bottom">
        <Panel icon={Layers} title="Alert Summary" help="nt.summary" delay={.2}>
          <div className="row" style={{ gap: 22, justifyContent: 'center' }}>
            <Donut segs={sevSegs} size={150} stroke={20} center={String(sevSegs.reduce((s, x) => s + x.value, 0))} sub="Total" />
            <div className="col" style={{ gap: 9, fontSize: 13.5, minWidth: 130 }}>{sevSegs.map((s) => <div key={s.label} className="row" style={{ justifyContent: 'space-between' }}><span className="row" style={{ gap: 8 }}><span className="dot sm" style={{ color: s.color }} />{s.label}</span><b className="tnum">{s.value}</b></div>)}</div>
          </div>
        </Panel>
      </div>
    </>
  );
}

function PendingDecide({ a, decide }: { a: Approval; decide: (id: string, d: 'approved' | 'denied') => void }) {
  const gate = useGate(a);
  return (
    <div className="row" style={{ gap: 6, marginTop: 6 }}>
      <button className="btn sm ghost" onClick={() => openDialog('approval-decision', { approvalId: a.id })}>Details</button><span className="spacer" />
      {gate.blocked && <GateNote id={gate.id} text={gate.text} />}
      <button type="button" {...gate.bind(() => openDialog('approval-decision', { approvalId: a.id }), 'btn sm danger')}>Deny</button>
      <button type="button" {...gate.bind(() => { if (a.risk === 'critical') { openDialog('approval-decision', { approvalId: a.id }); return; } decide(a.id, 'approved'); }, 'btn sm good')}>Approve</button>
    </div>
  );
}

function PendingTab() {
  const ALL_NOTICES = useVisibleNotices();
  const open = useOpen();
  const resolved = useData((s) => s.readNotifications);
  const acknowledge = useData((s) => s.markRead);
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
                  <button className="btn sm" onClick={() => { acknowledge(n.id); }}><CheckCircle2 size={14} />Resolve</button>
                </NoticeRow>))}</AnimatePresence></div></div>))}
          {notices.length === 0 && <EmptyState icon={CheckCircle2} title="All caught up" body="No unhandled alerts or mentions." />}
        </div>
      </Panel>
      <Panel icon={ShieldCheck} title={<>Approvals waiting <span className="dim" style={{ fontSize: 13, fontWeight: 500 }}>({appr.length})</span></>} help="nt.pendingApprovals" delay={.1}
        actions={<button type="button" className="btn sm aq-open" data-open-approval-quality onClick={() => openDialog('approval-quality', {})}><Gauge size={14} />Approval quality</button>}>
        <div className="col" style={{ gap: 8 }}>
          <AnimatePresence mode="popLayout">
            {appr.map((a) => (
              <motion.div key={a.id} layout className="nt-appr" style={{ ['--h' as string]: RISK_TIER[a.risk].hue }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 80 }}>
                <div className="row" style={{ gap: 6 }}><Chip hue={RISK_TIER[a.risk].hue} solid size="sm">{RISK_TIER[a.risk].tier}</Chip><b className="ellipsis" style={{ fontSize: 13 }}>{a.title}</b></div>
                <div className="dim" style={{ fontSize: 12, margin: '3px 0 6px' }}>{a.missionId} · expires in {a.expiresMin} min</div>
                <ApprovalFacts a={a} />
                <PendingDecide a={a} decide={decide} />
              </motion.div>))}
          </AnimatePresence>
          {appr.length === 0 && <EmptyState icon={ShieldCheck} title="No approvals waiting" />}
        </div>
      </Panel>
    </div>
  );
}

function ResolvedTab() {
  const ALL_NOTICES = useVisibleNotices();
  const resolved = useData((s) => s.readNotifications);
  const missions = useVisibleMissions();
  const decisions = useData((s) => s.approvalDecisions);
  const done = allApprovals(missions, decisions).filter((a) => a.status !== 'pending');
  const open = useOpen();
  const arch = ALL_NOTICES.filter((n) => n.severity === 'success' || (n.actionable && resolved[n.id]));
  return (
    <div className="nt-two">
      <Panel icon={Archive} title="Resolved and archived" help="nt.resolved" delay={.05} sub="Acknowledged notifications and completed events.">
        <div className="col" style={{ gap: 7 }}>
          {arch.map((n, i) => <NoticeRow key={n.id} n={n} i={i} onOpen={open}><Chip hue={150} size="sm">{resolved[n.id] ? 'Acknowledged' : 'Completed'}</Chip></NoticeRow>)}
          {arch.length === 0 && <EmptyState icon={Archive} title="Nothing archived yet" />}
        </div>
      </Panel>
      <Panel icon={ShieldCheck} title="Decisions" help="nt.decisions" delay={.1}>
        <div className="col" style={{ gap: 8 }}>
          <AnimatePresence>{done.map((a) => (
            <motion.div key={a.id} className="nt-appr" style={{ ['--h' as string]: a.status === 'approved' ? 150 : 0 }} initial={{ opacity: 0, x: -40 }} animate={{ opacity: 1, x: 0 }}>
              <div className="row" style={{ gap: 6 }}>{a.status === 'approved' ? <CheckCircle2 size={16} className="good" /> : <XCircle size={16} className="bad" />}<b className="ellipsis" style={{ fontSize: 13 }}>{a.title}</b></div>
              <div className="dim" style={{ fontSize: 12, marginTop: 3 }}>{a.status} by {isApi() ? a.decidedByName ?? 'someone' : 'Luca (Owner)'}{isApi() ? '' : ' just now'} · {a.missionId} · {RISK_TIER[a.risk].tier}</div>
              {a.decisionRecord && <div className={cx('appr-rec', a.decisionRecord.fastBulk && 'is-fast')} data-decision-record={a.decisionRecord.fastBulk ? 'fast' : 'normal'}><Timer size={11} aria-hidden />decided {fmtDuration(a.decisionRecord.latencyMs)} after it was asked · {a.decisionRecord.queueSize} waiting{a.decisionRecord.fastBulk && <> · <Zap size={11} aria-hidden />quick run (advisory only)</>}</div>}
            </motion.div>))}</AnimatePresence>
          {done.length === 0 && <div className="dim" style={{ fontSize: 12.5 }}>Decisions made in Pending appear here, with comment and hash.</div>}
        </div>
      </Panel>
    </div>
  );
}
