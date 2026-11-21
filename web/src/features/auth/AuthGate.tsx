import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Eye, EyeOff, KeyRound, Loader2, LogOut, ShieldCheck, UserRound, Crown, CheckCircle2, Smartphone, Ban, Clock3, Sparkles } from 'lucide-react';
import { LogoGlyph, CoreCube } from '@/components/art/CoreArt';
import { ParticleField } from '@/components/art/ParticleField';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { BRAND } from '@/config/brand';
import { useApplyPreferences } from '@/components/layout/usePreferences';
import { useAuth, useGate, useAuthPoll, type Gate } from '@/store/auth';
import { isApi, switchMode } from '@/api/mode';
import { useAgentsVersion, loadAgentsOnce, resetAgentsCatalog } from '@/api/agents';
import { WifiOff } from 'lucide-react';
import { cx } from '@/lib/format';
import '@/theme/pages/auth.css';

/**
 * Sign-in gate (owner update 2026-11-20 u1). Nothing behind it renders until this tab is connected:
 * name + password + Connect → (first user: admin, connected) | (others: wait for admin approval → auto-connect).
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { motionEff } = useApplyPreferences();
  const gate = useGate();
  const server = useAuth((s) => s.server);
  const boot = useAuth((s) => s.boot);
  useEffect(() => { void boot(); }, [boot]);
  // offline: retry every 3 s until the server answers
  useEffect(() => {
    if (!isApi() || server.phase !== 'offline') return;
    const t = window.setInterval(() => { void boot(); }, 3000);
    return () => window.clearInterval(t);
  }, [server.phase, boot]);
  const waiting = gate.state === 'waiting-user' || gate.state === 'waiting-device';
  useAuthPoll(waiting);
  // Show a short "approved" moment when a waiting tab gets connected.
  const [celebrate, setCelebrate] = useState(false);
  const wasWaiting = useRef(waiting);
  useEffect(() => {
    if (wasWaiting.current && gate.state === 'connected') { setCelebrate(true); const t = window.setTimeout(() => setCelebrate(false), 1600); return () => window.clearTimeout(t); }
    wasWaiting.current = waiting;
  }, [gate.state, waiting]);

  // Stage 6: in api mode the agent catalog comes from the server; the shell opens once it is loaded
  const catalog = useAgentsVersion((s) => s.loaded);
  useEffect(() => { if (isApi() && server.phase === 'connected' && !catalog) void loadAgentsOnce(); }, [server.phase, catalog]);
  // signed out (or another user signed in in this tab): the next session loads the catalog again
  const meNow = server.phase === 'connected' ? server.meId : '';
  const lastMe = useRef('');
  useEffect(() => {
    if (!isApi()) return;
    const ended = server.phase === 'signed-out' || server.phase === 'denied' || server.phase === 'waiting';
    if ((ended && lastMe.current) || (meNow && lastMe.current && lastMe.current !== meNow)) resetAgentsCatalog();
    if (ended) lastMe.current = '';
    if (meNow) lastMe.current = meNow;
  }, [server.phase, meNow]);
  const waitCatalog = isApi() && gate.state === 'connected' && !catalog;

  if (gate.state === 'connected' && !celebrate && !waitCatalog) return <>{children}</>;
  const apiPhase = isApi() ? (waitCatalog && !celebrate ? 'booting' : server.phase) : null;
  return (
    <div className="auth-screen">
      <div className="app-bg-grid" aria-hidden />
      {motionEff !== 'reduced' && <ParticleField />}
      <div className="auth-glow" aria-hidden />
      <AnimatePresence mode="wait">
        {apiPhase === 'booting' ? <BootCard key="boot" />
          : apiPhase === 'offline' ? <OfflineCard key="off" />
          : gate.state === 'signed-out' ? <ConnectCard key="connect" />
          : gate.state === 'connected' ? <ApprovedCard key="ok" gate={gate} />
          : <WaitCard key={gate.state} gate={gate} />}
      </AnimatePresence>
      <div className="auth-foot dim">{isApi() ? 'Accounts are kept on the AXION server. Passwords are stored only as argon2id hashes.' : 'DEMO · accounts are kept in this browser only. Open without ?data=demo to use the server.'}</div>
    </div>
  );
}

const cardMotion = { initial: { opacity: 0, y: 18, scale: .97 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: -12, scale: .98 }, transition: { duration: .35, ease: [0.2, 0.8, 0.2, 1] as const } };

function Brand() {
  return (
    <div className="auth-brand">
      <motion.span initial={{ rotate: -14, scale: .7, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 240, damping: 16 }}><LogoGlyph size={54} /></motion.span>
      <div><div className="auth-word">{BRAND.name}</div><div className="dim auth-tag">{BRAND.title}</div></div>
    </div>
  );
}

function BootCard() {
  return (
    <motion.div className="auth-card panel" {...cardMotion} role="status" aria-live="polite">
      <Brand />
      <p className="auth-sub dim"><Loader2 size={15} className="spin" /> Connecting to the AXION server…</p>
    </motion.div>
  );
}

/** The API can't be reached: keep retrying, and offer the offline demo (Stage 5 plan, "How the owner views it"). */
function OfflineCard() {
  return (
    <motion.div className="auth-card panel" {...cardMotion} role="alert" aria-live="assertive" data-testid="server-offline">
      <Brand />
      <div className="auth-radar bad" aria-hidden><span className="auth-radar-ico"><WifiOff size={16} /></span></div>
      <h1 className="auth-h bad">Server not reachable</h1>
      <p className="auth-sub dim"><Loader2 size={14} className="spin" /> Retrying every 3 seconds. Start it with <span className="kbd" style={{ whiteSpace: 'nowrap' }}>cd server &amp;&amp; npm run dev</span>.</p>
      <button className="btn ghost block" onClick={() => switchMode('demo')}>Open the offline demo instead</button>
    </motion.div>
  );
}

function ConnectCard() {
  const connect = useAuth((s) => s.connect);
  const accounts = useAuth((s) => s.accounts);
  const server = useAuth((s) => s.server);
  const firstEver = isApi() ? server.phase === 'signed-out' && server.firstEver === true : accounts.filter((a) => !a.fixture).length === 0;
  const notice = isApi() && server.phase === 'signed-out' ? server.notice : undefined;
  const [name, setName] = useState('');
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const known = accounts.find((a) => a.name.toLowerCase() === name.trim().toLowerCase());
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    window.setTimeout(async () => { const r = await connect(name, pass); setBusy(false); if (!r.ok) setErr(r.error); }, isApi() ? 0 : 650);
  };
  return (
    <motion.form className="auth-card panel" onSubmit={submit} {...cardMotion} aria-label="Connect">
      <Brand />
      <div className="auth-cube" aria-hidden><CoreCube width={150} /></div>
      <h1 className="auth-h">Connect</h1>
      <p className="auth-sub dim">
        {firstEver ? <><Crown size={14} className="warn" /> You are the first to connect: you become the <b>administrator</b>.</>
          : known ? <><UserRound size={14} /> Welcome back, <b>{known.name}</b>. Enter your password.</>
          : <><ShieldCheck size={14} className="info" /> New names are registered and wait for the administrator to approve them.</>}
      </p>
      <label className="auth-field">
        <span>Name</span>
        <div className="input-wrap"><UserRound size={16} /><input className="input" autoFocus autoComplete="username" value={name} onChange={(e) => { setName(e.target.value); setErr(''); }} placeholder="Your name" aria-label="Name" /></div>
      </label>
      <label className="auth-field">
        <span>Password</span>
        <div className="input-wrap"><KeyRound size={16} />
          <input className="input" type={show ? 'text' : 'password'} autoComplete={known ? 'current-password' : 'new-password'} value={pass} onChange={(e) => { setPass(e.target.value); setErr(''); }} placeholder={known ? 'Your password' : 'Choose a password'} aria-label="Password" />
          <button type="button" className="icon-btn xs auth-eye" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={14} /> : <Eye size={14} />}</button>
        </div>
      </label>
      {notice && !err && <div className="auth-err" role="status">{notice}</div>}
      <AnimatePresence>{err && <motion.div className="auth-err" role="alert" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>{err}</motion.div>}</AnimatePresence>
      <motion.button type="submit" className="btn primary lg block auth-go" disabled={busy || !name.trim() || !pass} whileTap={{ scale: .97 }}>
        {busy ? <><Loader2 size={17} className="spin" />Connecting…</> : <>Connect<ArrowRight size={17} /></>}
      </motion.button>
      {!firstEver && !isApi() && <p className="dim auth-hint">Demo members (Mina Park, Kenji Sato, Sara Lind) use the password <span className="kbd">demo</span>.</p>}
    </motion.form>
  );
}

function WaitCard({ gate }: { gate: Exclude<Gate, { state: 'signed-out' } | { state: 'connected' }> }) {
  const signOut = useAuth((s) => s.signOut);
  const a = gate.account;
  const device = 'device' in gate ? gate.device : undefined;
  const title = gate.state === 'waiting-user' ? 'Waiting for approval' : gate.state === 'waiting-device' ? 'New device needs approval'
    : gate.state === 'rejected' ? 'Request declined' : gate.state === 'blocked' ? 'This device is blocked' : 'User disabled';
  const bad = gate.state === 'rejected' || gate.state === 'blocked' || gate.state === 'disabled';
  const steps = gate.state === 'waiting-device'
    ? [{ l: 'Signed in', done: true }, { l: 'Admin approves this device', active: true }, { l: 'Connected', done: false }]
    : [{ l: 'Registered', done: true }, { l: 'Admin approves you', active: !bad }, { l: 'Connected', done: false }];
  return (
    <motion.div className="auth-card panel" {...cardMotion} role="status" aria-live="polite">
      <Brand />
      <div className={cx('auth-radar', bad && 'bad')} aria-hidden>
        {!bad && [0, 1, 2].map((i) => <motion.span key={i} className="auth-ring" initial={{ scale: .4, opacity: .8 }} animate={{ scale: 1.6, opacity: 0 }} transition={{ duration: 2.4, repeat: Infinity, delay: i * .8, ease: 'easeOut' }} />)}
        <UserAvatar account={a} size={74} ring={bad ? 'bad' : 'warn'} />
        <span className="auth-radar-ico">{bad ? <Ban size={16} /> : gate.state === 'waiting-device' ? <Smartphone size={16} /> : <Clock3 size={16} />}</span>
      </div>
      <h1 className={cx('auth-h', bad && 'bad')}>{title}</h1>
      <p className="auth-sub dim">
        {gate.state === 'waiting-user' && <>Hi <b>{a.name}</b>. The administrator has been notified. This screen connects you automatically as soon as you are approved — no need to reload.</>}
        {gate.state === 'waiting-device' && <><b>{device?.name ?? 'This browser'}</b> is new for <b>{a.name}</b>. An administrator must approve it; you connect automatically right after.</>}
        {gate.state === 'rejected' && <>The administrator declined the request for <b>{a.name}</b>. You can try again with another name.</>}
        {gate.state === 'blocked' && <>An administrator blocked <b>{device?.name}</b> for <b>{a.name}</b>. Use an approved device.</>}
        {gate.state === 'disabled' && <>The user <b>{a.name}</b> is disabled. Ask the administrator.</>}
      </p>
      {!bad && (
        <ol className="auth-steps">
          {steps.map((s, i) => (
            <li key={s.l} className={cx(s.done && 'done', s.active && 'active')}>
              <span className="auth-step-dot">{s.done ? <CheckCircle2 size={15} /> : s.active ? <Loader2 size={15} className="spin" /> : i + 1}</span>{s.l}
            </li>
          ))}
        </ol>
      )}
      <button className="btn ghost block" onClick={signOut}><LogOut size={15} />{bad ? 'Back' : 'Cancel and use another name'}</button>
    </motion.div>
  );
}

function ApprovedCard({ gate }: { gate: Extract<Gate, { state: 'connected' }> }) {
  return (
    <motion.div className="auth-card panel auth-ok" {...cardMotion} role="status" aria-live="polite">
      <motion.div className="auth-ok-badge" initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 14 }}><CheckCircle2 size={44} /></motion.div>
      <h1 className="auth-h good">Approved</h1>
      <p className="auth-sub dim"><Sparkles size={14} /> Connecting <b>{gate.account.name}</b>…</p>
    </motion.div>
  );
}
