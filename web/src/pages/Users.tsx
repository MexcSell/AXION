import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Users as UsersIcon, UserPlus, Search, LayoutGrid, List, ShieldCheck, Mail, Monitor, Smartphone, Laptop, Tablet, KeyRound, Download, Ban, RotateCw, Trash2, MoreHorizontal, Crown, Lock, Check, Minus, UserCheck, Fingerprint, Network, ScrollText, Plus } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Tabs } from '@/components/ui/Tabs';
import { Chip, DemoTag, Dot } from '@/components/ui/Chips';
import { IconButton } from '@/components/ui/IconButton';
import { Menu } from '@/components/ui/Menu';
import { Tip } from '@/components/ui/Tip';
import { EmptyState } from '@/components/ui/EmptyState';
import { CountUp } from '@/components/ui/CountUp';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Donut } from '@/components/viz/Charts';
import { useTab } from '@/hooks/useTab';
import { toast, openDialog } from '@/store/ui';
import { ago, cx } from '@/lib/format';
import { HUMAN_ROLES, INVITES, MEMBERS, PERM_ROWS, ROLE_HUE, SESSIONS, TEAMS, USER_AUDIT, useUG, type HumanRole, type Member } from '@/data/users-governance';
import '@/theme/pages/users-governance-notifications.css';

const STATUS: Record<Member['status'], { label: string; tone: 'good' | 'warn' | 'muted' | 'bad' }> = {
  active: { label: 'Active', tone: 'good' }, away: { label: 'Away', tone: 'warn' }, offline: { label: 'Offline', tone: 'muted' }, suspended: { label: 'Suspended', tone: 'bad' },
};

export function UserAvatar({ m, size = 52 }: { m: Pick<Member, 'initials' | 'hue' | 'name'>; size?: number }) {
  return (
    <span className="ug-avatar" style={{ ['--h' as string]: m.hue, width: size, height: size, fontSize: size * 0.34 }} role="img" aria-label={`${m.name} avatar`}>
      <span className="ug-avatar-in">{m.initials}</span>
    </span>
  );
}

function useMembers() {
  const roles = useUG((s) => s.roleOverrides);
  const susp = useUG((s) => s.suspended);
  return useMemo(() => MEMBERS.map((m) => ({ ...m, role: roles[m.id] ?? m.role, status: susp[m.id] ? ('suspended' as const) : m.status })), [roles, susp]);
}

export default function UsersPage() {
  const [tab, setTab, tabs] = useTab('users');
  const icons = [UsersIcon, ShieldCheck, Network, Mail, Monitor, ScrollText];
  const members = useMembers();
  const extra = useUG((s) => s.extraInvites);
  const revoked = useUG((s) => s.revokedSessions);
  const liveSessions = SESSIONS.filter((s) => !revoked[s.id]).length;
  const pending = INVITES.filter((i) => i.state === 'pending').length + extra.length;
  const kpis = [
    { icon: UsersIcon, v: members.length, label: 'Members', hint: `${members.filter((m) => m.status === 'active').length} active now`, c: '#22d3ee' },
    { icon: UserCheck, v: members.filter((m) => m.mfa).length, label: 'MFA enabled', hint: `of ${members.length}`, c: '#2ee98a' },
    { icon: Mail, v: pending, label: 'Pending invites', hint: 'masked contacts', c: '#fbbf24' },
    { icon: Monitor, v: liveSessions, label: 'Live sessions', hint: `${SESSIONS.length - liveSessions} revoked`, c: '#a78bfa' },
  ];
  return (
    <div className="page ug-page">
      <Panel icon={UsersIcon} titleSize="lg" title="Users" help="ug.users" sub="Humans, roles and access. Agents are managed in Agents, not here." delay={.05}
        actions={<div className="row" style={{ gap: 8 }}><DemoTag /><button className="btn primary" onClick={() => openDialog('user-invite')}><UserPlus size={16} />Invite user</button></div>}>
        <div className="ug-kpis">
          {kpis.map((k, i) => (
            <motion.div key={k.label} className="kpi" style={{ ['--kc' as string]: k.c }} initial={{ opacity: 0, y: 12, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: .08 + i * .06 }}>
              <k.icon size={34} strokeWidth={1.6} className="kpi-ico" aria-hidden />
              <div style={{ minWidth: 0 }}><div className="kpi-val"><CountUp value={k.v} /></div><div className="kpi-label">{k.label}</div><div className="dim" style={{ fontSize: 12 }}>{k.hint}</div></div>
            </motion.div>
          ))}
        </div>
        <div className="row wrap" style={{ margin: '14px 0 12px' }}>
          <Tabs size="sm" variant="underline" tabs={tabs.map((t, i) => ({ key: t, label: t, icon: icons[i] }))} value={tab} onChange={setTab} ariaLabel="Users views" />
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .2 }} role="tabpanel" aria-label={tab}>
            {tab === 'Members' && <Members members={members} />}
            {tab === 'Roles' && <Roles />}
            {tab === 'Teams & Access' && <Teams members={members} />}
            {tab === 'Invitations' && <Invitations />}
            {tab === 'Sessions' && <Sessions members={members} />}
            {tab === 'Audit' && <Audit />}
          </motion.div>
        </AnimatePresence>
      </Panel>
    </div>
  );
}

/* ---------------- Members ---------------- */
function Members({ members }: { members: Member[] }) {
  const [q, setQ] = useState('');
  const [role, setRole] = useState<HumanRole | 'all'>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const toggle = useUG((s) => s.toggleSuspend);
  const list = members.filter((m) => (role === 'all' || m.role === role) && (m.name + m.title + m.team).toLowerCase().includes(q.toLowerCase()));
  const segs = HUMAN_ROLES.map((r) => ({ label: r.key, value: members.filter((m) => m.role === r.key).length, color: `hsl(${r.hue} 85% 60%)` })).filter((s) => s.value);
  const actions = (m: Member) => [
    { label: 'Edit role', icon: ShieldCheck, onSelect: () => openDialog('role-edit', { userId: m.id }), disabled: m.role === 'Owner' },
    { label: 'View sessions', icon: Monitor, onSelect: () => toast({ tone: 'info', title: `${m.name}: ${m.sessions} active session(s)`, body: 'Open the Sessions tab for devices.' }) },
    { label: m.status === 'suspended' ? 'Reinstate' : 'Suspend', icon: Ban, danger: m.status !== 'suspended', disabled: m.role === 'Owner', sep: true, onSelect: () => { toggle(m.id); toast({ tone: 'success', title: m.status === 'suspended' ? 'Reinstated (demo)' : 'Suspended (demo)', body: m.name }); } },
  ];
  return (
    <div className="ug-split">
      <div className="col" style={{ gap: 12, minWidth: 0 }}>
        <div className="row wrap" style={{ gap: 10 }}>
          <div className="input-wrap" style={{ width: 240 }}><Search size={15} /><input className="input" placeholder="Search members..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search members" /></div>
          <Tabs size="sm" ariaLabel="Role filter" value={role} onChange={(k) => setRole(k as HumanRole | 'all')} tabs={[{ key: 'all', label: 'All' }, ...HUMAN_ROLES.map((r) => ({ key: r.key, label: r.key }))]} />
          <span className="spacer" />
          <div className="row" style={{ gap: 2, padding: 2, borderRadius: 10, border: '1px solid var(--border-soft)', background: 'var(--panel-2)' }}>
            <IconButton icon={LayoutGrid} label="Grid view" size="sm" variant={view === 'grid' ? 'active' : 'default'} onClick={() => setView('grid')} aria-pressed={view === 'grid'} />
            <IconButton icon={List} label="List view" size="sm" variant={view === 'list' ? 'active' : 'default'} onClick={() => setView('list')} aria-pressed={view === 'list'} />
          </div>
        </div>
        {list.length === 0 ? <EmptyState icon={UsersIcon} title="No members match" body="Try a different role or search." action={<button className="btn" onClick={() => { setQ(''); setRole('all'); }}>Clear filters</button>} /> : view === 'grid' ? (
          <div className="ug-member-grid">
            <AnimatePresence mode="popLayout">
              {list.map((m, i) => {
                const st = STATUS[m.status];
                return (
                  <motion.div key={m.id} layout className={cx('glass-card hoverable ug-member', m.status === 'suspended' && 'is-suspended')} style={{ ['--h' as string]: m.hue }}
                    initial={{ opacity: 0, y: 14, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: .94 }} transition={{ delay: i * .04, type: 'spring', stiffness: 260, damping: 24 }}>
                    <div className="row" style={{ alignItems: 'flex-start' }}>
                      <span style={{ position: 'relative' }}><UserAvatar m={m} size={56} /><span className="ug-presence"><Dot tone={st.tone} pulse={m.status === 'active'} /></span></span>
                      <span className="spacer" />
                      <Menu trigger={<IconButton icon={MoreHorizontal} label={`Actions for ${m.name}`} size="xs" />} items={actions(m)} />
                    </div>
                    <div style={{ marginTop: 10, minWidth: 0 }}>
                      <b className="ellipsis" style={{ display: 'block', fontSize: 14.5 }}>{m.role === 'Owner' && <Crown size={13} className="warn" style={{ display: 'inline', verticalAlign: -1, marginRight: 4 }} />}{m.name}</b>
                      <div className="dim ellipsis" style={{ fontSize: 12 }}>{m.title}</div>
                    </div>
                    <div className="row wrap" style={{ gap: 5, marginTop: 8 }}>
                      <Chip hue={ROLE_HUE[m.role]} size="sm" solid={m.role === 'Owner'}>{m.role}</Chip>
                      <Chip hue={m.status === 'active' ? 150 : m.status === 'away' ? 45 : m.status === 'suspended' ? 0 : 230} size="sm">{st.label}</Chip>
                      {!m.mfa && <Chip hue={30} size="sm" title="MFA not enabled">no MFA</Chip>}
                    </div>
                    <div className="ug-member-foot"><span>{m.lastMin === 0 ? 'Active now' : ago(m.lastMin)}</span><span>{m.sessions} sess · {m.grants} grants</span></div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Member</th><th>Role</th><th>Status</th><th>Team</th><th>Last active</th><th>Sessions</th><th>Grants</th><th /></tr></thead>
              <tbody>{list.map((m) => (
                <tr key={m.id}>
                  <td><span className="row"><UserAvatar m={m} size={30} /><span><b>{m.name}</b><div className="dim" style={{ fontSize: 11.5 }}>{m.title}</div></span></span></td>
                  <td><Chip hue={ROLE_HUE[m.role]} size="sm">{m.role}</Chip></td>
                  <td><span className="row" style={{ gap: 6 }}><Dot tone={STATUS[m.status].tone} />{STATUS[m.status].label}</span></td>
                  <td>{m.team}</td><td className="dim">{m.lastMin === 0 ? 'now' : ago(m.lastMin)}</td><td className="tnum">{m.sessions}</td><td className="tnum">{m.grants}</td>
                  <td><Menu trigger={<IconButton icon={MoreHorizontal} label={`Actions for ${m.name}`} size="xs" />} items={actions(m)} /></td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </div>
      <div className="col" style={{ gap: 12 }}>
        <div className="subpanel glass-card">
          <div className="row" style={{ marginBottom: 10 }}><b>Role distribution</b><HelpTrigger k="ug.distribution" /></div>
          <div className="row" style={{ gap: 14 }}>
            <Donut segs={segs} size={110} stroke={13} center={String(members.length)} sub="members" />
            <div className="col" style={{ gap: 6, fontSize: 12.5 }}>{segs.map((s) => <span key={s.label} className="row" style={{ gap: 7 }}><span className="dot sm" style={{ color: s.color }} />{s.label} <b className="tnum">{s.value}</b></span>)}</div>
          </div>
        </div>
        <div className="subpanel glass-card">
          <div className="row" style={{ marginBottom: 8 }}><Fingerprint size={16} className="info" /><b>Access hygiene</b><HelpTrigger k="ug.hygiene" /></div>
          {[['MFA coverage', Math.round(members.filter((m) => m.mfa).length / members.length * 100), 'good'], ['Grants with expiry', 82, 'good'], ['Stale (30d+) accounts', 12, 'warn']].map(([l, v, c], i) => (
            <div key={l as string} style={{ marginBottom: 8 }}>
              <div className="row" style={{ justifyContent: 'space-between', fontSize: 12.5 }}><span className="muted">{l}</span><b className="tnum">{v}%</b></div>
              <div className={`bar thin ${c}`}><motion.i initial={{ width: 0 }} animate={{ width: `${v}%` }} transition={{ duration: 1, delay: .2 + i * .1 }} /></div>
            </div>))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Roles ---------------- */
function Roles() {
  const [sel, setSel] = useState<HumanRole | null>(null);
  let lastGroup = '';
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <span className="muted" style={{ fontSize: 13 }}>Role matrix. Owner-only rows are highlighted and cannot be delegated by any UI setting.</span><HelpTrigger k="ug.roles" /><span className="spacer" />
        <button className="btn" onClick={() => toast({ tone: 'info', title: 'Custom role proposal (demo)', body: 'Custom roles are proposals reviewed by an Owner. Nothing is created in this prototype.' })}><Plus size={15} />Propose custom role</button>
      </div>
      <div className="table-wrap">
        <table className="table ug-matrix">
          <thead><tr><th>Permission</th>{HUMAN_ROLES.map((r) => (
            <th key={r.key} className="ug-matrix-col"><button className={cx('ug-colhead', sel === r.key && 'on')} style={{ ['--h' as string]: r.hue }} onClick={() => setSel(sel === r.key ? null : r.key)} aria-pressed={sel === r.key}><Chip hue={r.hue} size="sm" solid={sel === r.key}>{r.key}</Chip></button></th>))}</tr></thead>
          <tbody>
            {PERM_ROWS.map((p, i) => {
              const head = p.group !== lastGroup; lastGroup = p.group;
              return [
                head && <tr key={'g' + p.group} className="ug-group"><td colSpan={6}>{p.group === 'Owner-only' && <Lock size={12} style={{ display: 'inline', verticalAlign: -1, marginRight: 5 }} />}{p.group}</td></tr>,
                <motion.tr key={p.label} className={cx(p.ownerOnly && 'ug-owner-row')} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * .025 }}>
                  <td>{p.label}{p.ownerOnly && <Chip hue={45} size="sm" className="ug-oo">Owner-only</Chip>}</td>
                  {p.grants.map((g, c) => (
                    <td key={c} className={cx('ug-cell', sel === HUMAN_ROLES[c].key && 'sel')}>{g ? <Check size={16} className="good" strokeWidth={3} /> : <Minus size={14} className="dim" />}</td>))}
                </motion.tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
      <div className="grid g-5 ug-role-cards">
        {HUMAN_ROLES.map((r, i) => (
          <motion.button key={r.key} className="subpanel glass-card hoverable ug-rolecard" style={{ ['--h' as string]: r.hue, textAlign: 'left' }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .2 + i * .05 }}
            onClick={() => toast({ tone: 'info', title: `${r.key} (demo)`, body: r.desc })}>
            <Chip hue={r.hue} size="sm" solid>{r.key}</Chip>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>{r.desc}</p>
            <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>{MEMBERS.filter((m) => m.role === r.key).length} member(s) · {PERM_ROWS.filter((p) => p.grants[i]).length}/{PERM_ROWS.length} permissions</div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Teams ---------------- */
function Teams({ members }: { members: Member[] }) {
  const [open, setOpen] = useState<string | null>('T-3');
  return (
    <div className="grid g-3">
      {TEAMS.map((t, i) => {
        const ms = t.members.map((id) => members.find((m) => m.id === id)!).filter(Boolean);
        return (
          <motion.div key={t.id} className={cx('subpanel glass-card hoverable ug-team', open === t.id && 'selected')} style={{ ['--h' as string]: t.hue }} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .05 }}>
            <div className="row"><Network size={16} style={{ color: `hsl(${t.hue} 85% 62%)` }} /><b>{t.name}</b><span className="spacer" /><Chip hue={t.hue} size="sm">{t.access}</Chip></div>
            <div className="ug-stack">{ms.map((m) => <Tip key={m.id} label={`${m.name} · ${m.role}`}><span tabIndex={0}><UserAvatar m={m} size={34} /></span></Tip>)}</div>
            <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>Scope: {t.scope}</div>
            <AnimatePresence>{open === t.id && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
                <div className="col" style={{ gap: 4, marginTop: 10, fontSize: 12.5 }}>{ms.map((m) => <div key={m.id} className="row" style={{ justifyContent: 'space-between' }}><span>{m.name}</span><Chip hue={ROLE_HUE[m.role]} size="sm">{m.role}</Chip></div>)}</div>
              </motion.div>)}</AnimatePresence>
            <div className="row" style={{ marginTop: 10, gap: 6 }}>
              <button className="btn sm" onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? 'Hide members' : 'Members'}</button>
              <button className="btn sm ghost" onClick={() => toast({ tone: 'info', title: 'Grant scoped access (demo)', body: `Would open a grant request for ${t.name}. Scope: ${t.scope}.` })}>Grant access</button>
              <button className="btn sm ghost" onClick={() => toast({ tone: 'warning', title: 'Revoke access (demo)', body: `${t.name} loses ${t.scope} on confirmation.` })}>Revoke</button>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

/* ---------------- Invitations ---------------- */
function Invitations() {
  const extra = useUG((s) => s.extraInvites);
  const over = useUG((s) => s.inviteOverride);
  const setState = useUG((s) => s.setInviteState);
  const rows = [...extra, ...INVITES].map((i) => ({ ...i, state: (over[i.id] ?? i.state) as string }));
  const hue: Record<string, number> = { pending: 45, expired: 0, accepted: 150, revoked: 230 };
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row"><span className="muted" style={{ fontSize: 13 }}>Contact addresses are masked. The full address is visible only in the invite dialog at creation.</span><HelpTrigger k="ug.invitations" /><span className="spacer" /><button className="btn primary" onClick={() => openDialog('user-invite')}><UserPlus size={15} />New invite</button></div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Contact</th><th>Role</th><th>Scope</th><th>By</th><th>Sent</th><th>Expiry</th><th>State</th><th /></tr></thead>
        <tbody>{rows.map((i, k) => (
          <motion.tr key={i.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: k * .04 }}>
            <td><span className="row"><Mail size={15} className="dim" /><span className="mono">{i.masked}</span></span></td>
            <td><Chip hue={ROLE_HUE[i.role]} size="sm">{i.role}</Chip></td><td className="dim">{i.scope}</td><td>{i.invitedBy}</td><td className="dim">{ago(i.sentMin)}</td>
            <td className="dim">{i.state === 'accepted' ? 'n/a' : i.expiresMin > 0 ? `in ${ago(i.expiresMin).replace(' ago', '')}` : 'expired'}</td>
            <td><Chip hue={hue[i.state]} size="sm"><span className="dot sm" />{i.state}</Chip></td>
            <td><span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
              {(i.state === 'pending' || i.state === 'expired') && <IconButton icon={RotateCw} label="Resend invite" size="xs" onClick={() => { setState(i.id, 'pending'); toast({ tone: 'success', title: 'Invite re-sent (demo)', body: `${i.masked}. No email leaves this prototype.` }); }} />}
              {i.state === 'pending' && <IconButton icon={Trash2} label="Revoke invite" size="xs" variant="danger" onClick={() => { setState(i.id, 'revoked'); toast({ tone: 'info', title: 'Invite revoked (demo)', body: i.masked }); }} />}
            </span></td>
          </motion.tr>))}</tbody>
      </table></div>
    </div>
  );
}

/* ---------------- Sessions ---------------- */
const DEV = { laptop: Laptop, phone: Smartphone, desktop: Monitor, tablet: Tablet };
function Sessions({ members }: { members: Member[] }) {
  const revoked = useUG((s) => s.revokedSessions);
  const live = SESSIONS.filter((s) => !revoked[s.id]);
  const gone = SESSIONS.filter((s) => revoked[s.id]);
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row"><span className="muted" style={{ fontSize: 13 }}>{live.length} signed-in devices. Revoking signs the device out at once.</span><HelpTrigger k="ug.sessions" /><span className="spacer" />
        <button className="btn" onClick={() => toast({ tone: 'warning', title: 'Re-authentication required (demo)', body: 'All members would be asked to sign in again with MFA.' })}><KeyRound size={15} />Require re-auth for all</button></div>
      <div className="grid g-3">
        <AnimatePresence mode="popLayout">
          {live.map((s, i) => {
            const u = members.find((m) => m.id === s.userId)!; const I = DEV[s.kind];
            return (
              <motion.div key={s.id} layout className="subpanel glass-card hoverable ug-session" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40, scale: .95 }} transition={{ delay: i * .04 }}>
                <div className="row"><span className="ug-dev"><I size={20} /></span><div style={{ minWidth: 0 }}><b className="ellipsis" style={{ display: 'block' }}>{s.device}</b><span className="dim" style={{ fontSize: 12 }}>{s.browser}</span></div><span className="spacer" />{s.current && <Chip hue={150} size="sm">This device</Chip>}</div>
                <div className="row" style={{ marginTop: 10, gap: 8 }}><UserAvatar m={u} size={26} /><span style={{ fontSize: 13 }}>{u.name}</span></div>
                <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>{s.place} · {s.ip}<br />{s.lastMin === 0 ? 'Active now' : `Last seen ${ago(s.lastMin)}`}</div>
                <div className="row" style={{ marginTop: 10 }}><button className="btn sm danger" onClick={() => openDialog('session-revoke', { sessionId: s.id })}>Revoke</button></div>
              </motion.div>);
          })}
        </AnimatePresence>
      </div>
      <div className="section-label">Revocation history</div>
      {gone.length === 0 ? <div className="dim" style={{ fontSize: 12.5 }}>No sessions revoked in this demo session yet.</div> : gone.map((s) => <div key={s.id} className="list-row"><Ban size={14} className="bad" />{s.device} ({members.find((m) => m.id === s.userId)?.name}) revoked just now</div>)}
    </div>
  );
}

/* ---------------- Audit ---------------- */
function Audit() {
  const [q, setQ] = useState('');
  const [f, setF] = useState<'all' | 'allowed' | 'denied' | 'review'>('all');
  const rows = USER_AUDIT.filter((r) => (f === 'all' || r.result === f) && (r.actor + r.action + r.target).toLowerCase().includes(q.toLowerCase()));
  const hue = { allowed: 150, denied: 0, review: 45 };
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="input-wrap" style={{ width: 260 }}><Search size={15} /><input className="input" placeholder="Filter actor, action, target..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter audit" /></div>
        <Tabs size="sm" ariaLabel="Result filter" value={f} onChange={setF} tabs={[{ key: 'all', label: 'All' }, { key: 'allowed', label: 'Allowed' }, { key: 'review', label: 'Review' }, { key: 'denied', label: 'Denied' }]} />
        <HelpTrigger k="ug.audit" /><span className="spacer" />
        <button className="btn" onClick={() => toast({ tone: 'info', title: 'Export (demo)', body: `${rows.length} sanitized rows would be exported. No file is created.` })}><Download size={15} />Export</button>
      </div>
      <div className="table-wrap" style={{ maxHeight: 440 }}><table className="table">
        <thead><tr><th>When</th><th>Actor</th><th>Event</th><th>Target</th><th>Result</th><th>Trace</th></tr></thead>
        <tbody>{rows.map((r, i) => (
          <motion.tr key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 12) * .02 }}>
            <td className="dim">{ago(r.agoMin)}</td><td><b>{r.actor}</b></td><td className="mono">{r.action}</td><td className="dim ellipsis" style={{ maxWidth: 200 }}>{r.target}</td>
            <td><Chip hue={hue[r.result]} size="sm">{r.result}</Chip></td><td className="mono dim">{r.trace}</td>
          </motion.tr>))}</tbody>
      </table>{rows.length === 0 && <EmptyState icon={ScrollText} title="No events match" body="Adjust the filter." />}</div>
    </div>
  );
}
