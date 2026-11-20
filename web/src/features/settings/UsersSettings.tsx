import { AnimatePresence, motion } from 'motion/react';
import { isApi } from '@/api/mode';
import { useMemo, useRef, useState } from 'react';
import {
  UserRound, KeyRound, MonitorSmartphone, ShieldCheck, Users as UsersIcon, Check, X, Trash2, Ban, Monitor, Laptop, Smartphone, Tablet,
  ImagePlus, Bot, Type, Crown, Plus, CheckCircle2, Eye, EyeOff, Save, UserCheck, Power,
} from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Field, Segmented } from '@/components/ui/Form';
import { Chip } from '@/components/ui/Chips';
import { Tip } from '@/components/ui/Tip';
import { IconButton } from '@/components/ui/IconButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { ROLES } from '@/data/roles';
import type { RoleKey } from '@/data/types';
import { useAuth, useMe, useSession, isAdmin, usePendingApprovals, type Account, type AvatarSpec, type Device, type DeviceKind } from '@/store/auth';
import { useData } from '@/store/data';
import { toast } from '@/store/ui';
import { agoFromTs, cx } from '@/lib/format';

export const DEVICE_ICON: Record<DeviceKind, typeof Monitor> = { desktop: Monitor, laptop: Laptop, phone: Smartphone, tablet: Tablet };
const DEV_HUE = { approved: 150, pending: 38, blocked: 350 } as const;
const STATUS_HUE = { approved: 150, pending: 38, rejected: 350, disabled: 225 } as const;

/** Settings › Users (owner update 2026-11-20 u1): avatar, name, password, devices; administrators approve users and devices. */
export function UsersSettings() {
  const me = useMe();
  if (!me) return null;
  const admin = isAdmin(me);
  return (
    <div className={cx('us-grid', admin && 'admin')}>
      <ProfilePanel me={me} />
      <div className="us-col">
        <PasswordPanel me={me} />
        <DevicesPanel me={me} />
      </div>
      {admin && <div className="us-col us-admin"><ApprovalsPanel me={me} /><AllUsersPanel me={me} /></div>}
    </div>
  );
}

/* ------------------------------------------------------------ profile */
function ProfilePanel({ me }: { me: Account }) {
  const update = useAuth((s) => s.updateProfile);
  const [name, setName] = useState(me.name);
  const [av, setAv] = useState<AvatarSpec>(me.avatar);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = name.trim() !== me.name || JSON.stringify(av) !== JSON.stringify(me.avatar);
  const save = async () => {
    const r = await update(me.id, { name, avatar: av });
    if (!r.ok) { toast({ tone: 'error', title: 'Profile not saved', body: r.error }); return; }
    toast({ tone: 'success', title: 'Profile saved', body: 'Your name and avatar are updated everywhere.' });
  };
  const onFile = (f?: File) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) { toast({ tone: 'error', title: 'Choose an image file' }); return; }
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const s = Math.min(img.width, img.height); const ctx = c.getContext('2d')!;
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 128, 128);
      setAv({ ...av, kind: 'image', image: c.toDataURL('image/jpeg', .85) });
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
  };
  return (
    <Panel icon={UserRound} title="My profile" help="settings.users.profile" delay={.04} className="us-profile">
      <div className="us-hero">
        <motion.button type="button" className="us-av-btn" whileHover={{ scale: 1.04 }} onClick={() => av.kind === 'image' ? fileRef.current?.click() : undefined} aria-label="Avatar preview">
          <UserAvatar avatar={av} name={name || me.name} size={96} ring="accent" />
        </motion.button>
        <div className="col" style={{ gap: 4, minWidth: 0 }}>
          <b className="us-name ellipsis">{me.name}</b>
          <div className="row wrap" style={{ gap: 6 }}>
            {me.role === 'admin' ? <Chip hue={45} icon={Crown}>Administrator</Chip> : <Chip hue={210} icon={UserRound}>Member</Chip>}
            <Chip hue={STATUS_HUE[me.status]}>{me.status}</Chip>
          </div>
          <span className="dim" style={{ fontSize: 12 }}>Joined {agoFromTs(me.createdAt)} · approved by {me.approvedBy === 'first sign-up' ? 'first sign-up' : me.approvedBy ? 'an administrator' : '—'}</span>
        </div>
      </div>
      <Field label="Avatar" help="settings.users.avatar">
        <Segmented ariaLabel="Avatar kind" size="sm" value={av.kind} onChange={(k) => { if (k === 'image' && !av.image) fileRef.current?.click(); setAv({ ...av, kind: k, robot: av.robot ?? 'manager' }); }}
          options={[{ key: 'initials', label: <><Type size={13} />Initials</> }, { key: 'image', label: <><ImagePlus size={13} />Image</> }, { key: 'robot', label: <><Bot size={13} />Robot</> }]} />
      </Field>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} aria-label="Upload avatar image" />
      <AnimatePresence mode="wait">
        {av.kind === 'initials' && (
          <motion.div key="i" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Field label={`Colour · hue ${av.hue}`}><input className="range us-hue" type="range" min={0} max={359} value={av.hue} onChange={(e) => setAv({ ...av, hue: +e.target.value })} aria-label="Avatar colour" /></Field>
          </motion.div>
        )}
        {av.kind === 'image' && (
          <motion.div key="m" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="row" style={{ gap: 8 }}>
            <button className="btn sm" onClick={() => fileRef.current?.click()}><ImagePlus size={14} />{av.image ? 'Replace image' : 'Upload image'}</button>
            <span className="dim" style={{ fontSize: 12 }}>Cropped to a square, 128 px.</span>
          </motion.div>
        )}
        {av.kind === 'robot' && (
          <motion.div key="r" className="us-robots" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {(Object.keys(ROLES) as RoleKey[]).slice(0, 12).map((k) => (
              <Tip key={k} label={ROLES[k].label}><button className={cx('us-robot', av.robot === k && 'on')} aria-pressed={av.robot === k} aria-label={ROLES[k].label} onClick={() => setAv({ ...av, robot: k, hue: ROLES[k].hue })}><RobotAvatar role={k} size={34} /></button></Tip>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <Field label="Name" help="settings.users.name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" /></Field>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn ghost sm" disabled={!dirty} onClick={() => { setName(me.name); setAv(me.avatar); }}>Undo</button>
        <button className="btn primary sm" disabled={!dirty} onClick={save}><Save size={14} />Save profile</button>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------ password */
function strength(p: string) {
  let s = 0;
  if (p.length >= 8) s++; if (p.length >= 12) s++; if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++; if (/\d/.test(p)) s++; if (/[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(4, s);
}
function PasswordPanel({ me }: { me: Account }) {
  const change = useAuth((s) => s.changePassword);
  const [cur, setCur] = useState(''); const [nx, setNx] = useState(''); const [cf, setCf] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const st = strength(nx);
  const mismatch = cf.length > 0 && cf !== nx;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mismatch) { setErr('The two new passwords differ.'); return; }
    const r = await change(me.id, cur, nx);
    if (!r.ok) { setErr(r.error ?? 'Not changed'); return; }
    setErr(''); setCur(''); setNx(''); setCf('');
    toast({ tone: 'success', title: 'Password changed', body: 'Use the new password the next time you connect.' });
  };
  const t = show ? 'text' : 'password';
  return (
    <Panel icon={KeyRound} title="Password" help="settings.users.password" delay={.08} actions={<IconButton size="xs" icon={show ? EyeOff : Eye} label={show ? 'Hide passwords' : 'Show passwords'} onClick={() => setShow(!show)} />}>
      <form className="col" style={{ gap: 8 }} onSubmit={submit}>
        <input className="input" type={t} autoComplete="current-password" placeholder="Current password" value={cur} onChange={(e) => { setCur(e.target.value); setErr(''); }} aria-label="Current password" />
        <input className="input" type={t} autoComplete="new-password" placeholder="New password (8+ characters)" value={nx} onChange={(e) => { setNx(e.target.value); setErr(''); }} aria-label="New password" />
        <div className="us-strength" aria-label={`Strength ${st} of 4`}>{[0, 1, 2, 3].map((i) => <motion.i key={i} className={cx(i < st && ['bad', 'warn', 'info', 'good'][st - 1])} animate={{ scaleX: i < st ? 1 : .3 }} />)}<span className="dim">{['too short', 'weak', 'fair', 'good', 'strong'][st]}</span></div>
        <input className="input" type={t} autoComplete="new-password" placeholder="Repeat new password" value={cf} onChange={(e) => { setCf(e.target.value); setErr(''); }} aria-label="Repeat new password" aria-invalid={mismatch || undefined} />
        <AnimatePresence>{(err || mismatch) && <motion.div className="bad" style={{ fontSize: 12.5, fontWeight: 600 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="alert">{err || 'The two new passwords differ.'}</motion.div>}</AnimatePresence>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="dim" style={{ fontSize: 12 }}>{me.passwordChangedAt ? `Changed ${agoFromTs(me.passwordChangedAt)}` : 'Never changed'}</span>
          <button className="btn primary sm" disabled={!cur || nx.length < 8 || mismatch}><KeyRound size={14} />Change password</button>
        </div>
      </form>
    </Panel>
  );
}

/* ------------------------------------------------------------ devices */
function DeviceRow({ d, current, onRemove, children, i = 0 }: { d: Device; current?: boolean; onRemove?: () => void; children?: React.ReactNode; i?: number }) {
  const I = DEVICE_ICON[d.kind];
  return (
    <motion.div layout className={cx('us-dev', d.status)} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} transition={{ delay: i * .03 }}>
      <span className="us-dev-ico"><I size={17} /></span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 6 }}><b className="ellipsis">{d.name}</b>{current && <Chip hue={200}>this device</Chip>}</div>
        <div className="dim" style={{ fontSize: 11.5 }}>added {agoFromTs(d.addedAt)} · seen {agoFromTs(d.lastSeenAt)}</div>
      </div>
      <Chip hue={DEV_HUE[d.status]}>{d.status}</Chip>
      {children}
      {onRemove && !current && <IconButton size="xs" icon={Trash2} label={`Remove ${d.name}`} onClick={onRemove} />}
    </motion.div>
  );
}

function DevicesPanel({ me }: { me: Account }) {
  const session = useSession();
  const { removeDevice, simulateNewDevice } = useAuth();
  return (
    <Panel icon={MonitorSmartphone} title="My devices" help="settings.users.devices" delay={.12}
      actions={isApi() ? undefined : <Tip label="Demo: pretend you signed in from another device. It waits for an administrator."><button className="btn ghost sm" onClick={() => { const d = simulateNewDevice(me.id); toast({ tone: 'info', title: `${d.name} is waiting for approval`, body: isAdmin(me) ? 'Approve it in the Approvals queue.' : 'An administrator must approve it.' }); }}><Plus size={14} />New device</button></Tip>}>
      <div className="col" style={{ gap: 6 }}>
        <AnimatePresence initial={false}>
          {me.devices.map((d, i) => <DeviceRow key={d.id} d={d} i={i} current={d.id === session?.deviceId} onRemove={() => { removeDevice(me.id, d.id); toast({ tone: 'success', title: `${d.name} removed`, body: 'It must be approved again to connect.' }); }} />)}
        </AnimatePresence>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------ admin: approvals */
function ApprovalsPanel({ me }: { me: Account }) {
  const { approveUser, rejectUser, approveDevice, blockDevice } = useAuth();
  const { users, devices, total } = usePendingApprovals();
  return (
    <Panel icon={ShieldCheck} title="Approvals" help="settings.users.approvals" delay={.06} className="us-approvals" actions={<Chip hue={total ? 38 : 150}>{total} waiting</Chip>}>
      {total === 0 ? <EmptyState icon={CheckCircle2} title="All clear" body="New users and new devices appear here. They connect automatically when you approve them." /> : (
        <div className="col" style={{ gap: 8 }}>
          <AnimatePresence initial={false}>
            {users.map((u, i) => (
              <motion.div layout key={u.id} className="us-req" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 30, transition: { duration: .2 } }} transition={{ delay: i * .04 }}>
                <span className="us-req-pulse" aria-hidden />
                <UserAvatar account={u} size={38} ring="warn" />
                <div className="grow" style={{ minWidth: 0 }}>
                  <b className="ellipsis">{u.name}</b>
                  <div className="dim ellipsis" style={{ fontSize: 11.5 }}>new user · {u.devices[0]?.name ?? 'unknown device'} · {agoFromTs(u.createdAt)}</div>
                </div>
                <IconButton size="sm" variant="danger" icon={X} label={`Decline ${u.name}`} onClick={() => { rejectUser(u.id, me.id); toast({ tone: 'warning', title: `${u.name} declined` }); }} />
                <button className="btn good sm" onClick={() => { approveUser(u.id, me.id); toast({ tone: 'success', title: `${u.name} approved`, body: 'Their waiting screen connects automatically.' }); }}><Check size={14} />Approve</button>
              </motion.div>
            ))}
            {devices.map(({ account: a, device: d }, i) => {
              const I = DEVICE_ICON[d.kind];
              return (
                <motion.div layout key={a.id + d.id} className="us-req dev" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 30, transition: { duration: .2 } }} transition={{ delay: (users.length + i) * .04 }}>
                  <span className="us-req-pulse" aria-hidden />
                  <span className="us-req-dev"><UserAvatar account={a} size={38} /><span><I size={12} /></span></span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <b className="ellipsis">{d.name}</b>
                    <div className="dim ellipsis" style={{ fontSize: 11.5 }}>new device for {a.name} · {agoFromTs(d.addedAt)}</div>
                  </div>
                  <IconButton size="sm" variant="danger" icon={Ban} label={`Block ${d.name}`} onClick={() => { blockDevice(a.id, d.id); toast({ tone: 'warning', title: `${d.name} blocked for ${a.name}` }); }} />
                  <button className="btn good sm" onClick={() => { approveDevice(a.id, d.id); toast({ tone: 'success', title: `${d.name} approved`, body: `${a.name} can connect from it now.` }); }}><Check size={14} />Approve</button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------ admin: all users */
function AllUsersPanel({ me }: { me: Account }) {
  const accounts = useAuth((s) => s.accounts);
  const { setRole, setStatus } = useAuth();
  const missions = useData((s) => s.missions);
  const admins = accounts.filter((a) => a.role === 'admin' && a.status === 'approved').length;
  const owned = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, missions.filter((m) => m.ownerId === a.id).length])), [accounts, missions]);
  return (
    <Panel icon={UsersIcon} title="All users" help="settings.users.all" delay={.1} actions={<Chip hue={210}>{accounts.length}</Chip>}>
      <div className="col" style={{ gap: 6 }}>
        {accounts.map((a, i) => {
          const lastAdmin = a.role === 'admin' && admins <= 1;
          const ok = a.devices.filter((d) => d.status === 'approved').length;
          return (
            <motion.div key={a.id} className={cx('us-user', a.status)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .03 }}>
              <UserAvatar account={a} size={32} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}><b className="ellipsis">{a.name}</b>{a.id === me.id && <span className="dim" style={{ fontSize: 11 }}>(you)</span>}</div>
                <div className="dim" style={{ fontSize: 11.5 }}>{ok}/{a.devices.length} devices · {owned[a.id] ?? 0} missions</div>
              </div>
              <Chip hue={STATUS_HUE[a.status]}>{a.status}</Chip>
              <Tip label={lastAdmin ? 'The last administrator cannot be demoted' : a.role === 'admin' ? 'Make member' : 'Make administrator'}>
                <button className={cx('us-role', a.role)} disabled={lastAdmin || a.status !== 'approved'} onClick={() => { setRole(a.id, a.role === 'admin' ? 'member' : 'admin'); toast({ tone: 'success', title: `${a.name} is now ${a.role === 'admin' ? 'a member' : 'an administrator'}` }); }} aria-label={`Role of ${a.name}: ${a.role}`}>
                  {a.role === 'admin' ? <Crown size={13} /> : <UserRound size={13} />}{a.role === 'admin' ? 'Admin' : 'Member'}
                </button>
              </Tip>
              {a.id !== me.id && (a.status === 'approved' || a.status === 'disabled') && (
                <IconButton size="xs" icon={a.status === 'disabled' ? UserCheck : Power} label={a.status === 'disabled' ? `Enable ${a.name}` : `Disable ${a.name}`}
                  onClick={() => { setStatus(a.id, a.status === 'disabled' ? 'approved' : 'disabled'); toast({ tone: 'info', title: `${a.name} ${a.status === 'disabled' ? 'enabled' : 'disabled'}` }); }} />
              )}
            </motion.div>
          );
        })}
      </div>
    </Panel>
  );
}
