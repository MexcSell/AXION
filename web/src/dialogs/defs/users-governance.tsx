import { useMemo, useRef, useState } from 'react';
import { ImagePlus, KeyRound, LogOut, Mail, ShieldAlert, ShieldCheck, UserPlus, Bell, FileDiff, X, CheckCircle2, XCircle, Fingerprint, Clock } from 'lucide-react';
import type { DialogComponentProps } from '@/dialogs/DialogHost';
import { Modal } from '@/components/ui/Modal';
import { Field, Segmented, SwitchRow } from '@/components/ui/Form';
import { Chip } from '@/components/ui/Chips';
import { toast } from '@/store/ui';
import { useData, allApprovals } from '@/store/data';
import { AGENT_BY_ID } from '@/data/agents';
import { HUMAN_ROLES, MEMBERS, PERM_ROWS, RISK_TIER, ROLE_HUE, SESSIONS, useUG, type HumanRole } from '@/data/users-governance';
import { ago } from '@/lib/format';
import '@/theme/pages/users-governance-notifications.css';

const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const maskEmail = (e: string) => { const [u, d] = e.split('@'); return `${u[0]}***@${d}`; };

/* DL-45 ------------------------------------------------------------- */
function UserInvite({ close }: DialogComponentProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<HumanRole>('Operator');
  const [scope, setScope] = useState('M-126, M-128');
  const [days, setDays] = useState('7');
  const [tried, setTried] = useState(false);
  const add = useUG((s) => s.addInvite);
  const err = tried && !emailOk(email) ? 'Enter a valid email address.' : undefined;
  const submit = () => {
    setTried(true);
    if (!emailOk(email)) return;
    add({ id: `I-${Date.now() % 10000}`, masked: maskEmail(email), role, invitedBy: 'Luca', sentMin: 0, expiresMin: +days * 1440, state: 'pending', scope });
    toast({ tone: 'success', title: 'Invite queued (demo)', body: `${maskEmail(email)} as ${role}. No email is actually sent in this prototype.` });
    close();
  };
  return (
    <Modal title="Invite user" icon={UserPlus} help="ug.dialog.invite" dialogId="DL-45" sub="The contact address is masked everywhere after this step." onClose={close}
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" onClick={submit}><Mail size={15} />Send Invite</button></>}>
      <div className="col" style={{ gap: 14 }}>
        <Field label="Email address" required error={err} help="ug.invite.email" htmlFor="inv-email">
          <input id="inv-email" data-autofocus className="input" type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </Field>
        <Field label="Role" help="ug.invite.role">
          <div className="ug-role-pick">
            {HUMAN_ROLES.filter((r) => r.key !== 'Owner').map((r) => (
              <button key={r.key} type="button" className={'ug-role-opt' + (role === r.key ? ' on' : '')} style={{ ['--h' as string]: r.hue }} onClick={() => setRole(r.key)} aria-pressed={role === r.key}>
                <b>{r.key}</b><span>{r.desc}</span>
              </button>
            ))}
          </div>
        </Field>
        <div className="grid g-2">
          <Field label="Scope (missions)" help="ug.invite.scope"><input className="input" value={scope} onChange={(e) => setScope(e.target.value)} /></Field>
          <Field label="Expires after" help="ug.invite.expiry">
            <select className="select" value={days} onChange={(e) => setDays(e.target.value)}><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option></select>
          </Field>
        </div>
        <p className="dim" style={{ fontSize: 12 }}>The Owner role cannot be granted by invitation. Role changes beyond Operator are logged and may need Owner review.</p>
      </div>
    </Modal>
  );
}

/* DL-46 ------------------------------------------------------------- */
function RoleEdit({ close, props }: DialogComponentProps<{ userId?: string }>) {
  const m = MEMBERS.find((x) => x.id === props.userId) ?? MEMBERS[2];
  const cur = useUG((s) => s.roleOverrides[m.id]) ?? m.role;
  const setRole = useUG((s) => s.setRole);
  const [role, setR] = useState<HumanRole>(cur);
  const [reason, setReason] = useState('');
  const [exp, setExp] = useState('never');
  const idx = (r: HumanRole) => HUMAN_ROLES.findIndex((x) => x.key === r);
  const delta = useMemo(() => PERM_ROWS.filter((p) => p.grants[idx(role)] !== p.grants[idx(cur)]).map((p) => ({ ...p, add: p.grants[idx(role)] })), [role, cur]);
  const dangerous = delta.some((d) => d.add && (d.ownerOnly || d.group === 'Admin'));
  const same = role === cur;
  const submit = () => {
    if (same) return;
    if (reason.trim().length < 5) { toast({ tone: 'warning', title: 'Add a reason', body: 'Role changes need a short written reason for the audit log.' }); return; }
    setRole(m.id, role);
    toast({ tone: 'success', title: 'Role change requested (demo)', body: `${m.name}: ${cur} to ${role}.` });
    close();
  };
  return (
    <Modal title={`Edit role: ${m.name}`} icon={ShieldCheck} help="ug.dialog.role" dialogId="DL-46" tone={dangerous ? 'warn' : 'default'} sub="Exact privilege delta is shown before you submit." onClose={close}
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={same} onClick={submit}>Request Role Change</button></>}>
      <div className="col" style={{ gap: 14 }}>
        <Field label="New role">
          <Segmented ariaLabel="New role" value={role} onChange={setR} options={HUMAN_ROLES.filter((r) => r.key !== 'Owner').map((r) => ({ key: r.key, label: r.key }))} />
        </Field>
        <div className="subpanel">
          <div className="section-label" style={{ marginBottom: 8 }}>Privilege changes ({delta.length})</div>
          {delta.length === 0 ? <span className="dim" style={{ fontSize: 12.5 }}>No change from {cur}.</span> : (
            <div className="col" style={{ gap: 5 }}>
              {delta.map((d) => (
                <div key={d.label} className={'ug-delta ' + (d.add ? 'add' : 'del')}>
                  <span>{d.add ? '+' : '-'}</span><span>{d.label}</span>
                  {d.ownerOnly && <Chip hue={45} size="sm">Owner-only</Chip>}
                </div>
              ))}
            </div>
          )}
        </div>
        {dangerous && <div className="ug-warn"><ShieldAlert size={16} />This adds Admin-level privileges. An Owner must confirm in Governance, and separation of duties applies.</div>}
        <div className="grid g-2">
          <Field label="Grant expires"><select className="select" value={exp} onChange={(e) => setExp(e.target.value)}><option value="never">No expiry</option><option value="30">30 days</option><option value="90">90 days</option></select></Field>
          <Field label="Reason" required><input data-autofocus className="input" placeholder="Why is this change needed?" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      </div>
    </Modal>
  );
}

/* DL-47 ------------------------------------------------------------- */
function SessionRevoke({ close, props }: DialogComponentProps<{ sessionId?: string }>) {
  const s = SESSIONS.find((x) => x.id === props.sessionId) ?? SESSIONS[1];
  const u = MEMBERS.find((m) => m.id === s.userId)!;
  const revoke = useUG((x) => x.revokeSession);
  const [reason, setReason] = useState('Lost or unrecognised device');
  const [reauth, setReauth] = useState(true);
  return (
    <Modal title="Revoke session" icon={LogOut} help="ug.dialog.session" dialogId="DL-47" tone="danger" sub="This signs the device out immediately." onClose={close}
      footer={<><button className="btn" data-autofocus onClick={close}>Cancel</button><button className="btn danger" onClick={() => { revoke(s.id); toast({ tone: 'success', title: 'Session revoked (demo)', body: `${s.device} for ${u.name} is signed out.` }); close(); }}>Revoke Session</button></>}>
      <div className="col" style={{ gap: 14 }}>
        <div className="subpanel kv-grid">
          <div><span className="dim">Device</span><b>{s.device}</b></div>
          <div><span className="dim">User</span><b>{u.name}</b></div>
          <div><span className="dim">Browser</span><b>{s.browser}</b></div>
          <div><span className="dim">Location</span><b>{s.place} · {s.ip}</b></div>
          <div><span className="dim">Last active</span><b>{s.lastMin === 0 ? 'now' : ago(s.lastMin)}</b></div>
        </div>
        {s.current && <div className="ug-warn"><ShieldAlert size={16} />This is your current session. You will be signed out of AXION.</div>}
        <Field label="Reason" help="ug.session.reason"><select className="select" value={reason} onChange={(e) => setReason(e.target.value)}><option>Lost or unrecognised device</option><option>Suspicious location</option><option>Offboarding</option><option>Routine hygiene</option></select></Field>
        <SwitchRow label="Require re-authentication" desc="All other sessions of this user must sign in again with MFA." checked={reauth} onChange={setReauth} />
        <p className="dim" style={{ fontSize: 12 }}>Impact: any running browser-agent approval started from this device stays pending and is not cancelled.</p>
      </div>
    </Modal>
  );
}

/* DL-48 ------------------------------------------------------------- */
function ApprovalDecision({ close, props }: DialogComponentProps<{ approvalId?: string }>) {
  const missions = useData((s) => s.missions);
  const decisions = useData((s) => s.approvalDecisions);
  const decide = useData((s) => s.decideApproval);
  const a = allApprovals(missions, decisions).find((x) => x.id === props.approvalId);
  const [comment, setComment] = useState('');
  const [img, setImg] = useState<{ name: string; url: string } | null>(null);
  const [tried, setTried] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  if (!a) {
    return <Modal title="Approval not found" icon={ShieldAlert} help="ug.dialog.approval" dialogId="DL-48" onClose={close} footer={<button className="btn" onClick={close}>Close</button>}><p className="muted">This approval no longer exists or was resolved.</p></Modal>;
  }
  const r = RISK_TIER[a.risk];
  const agent = AGENT_BY_ID[a.agentId];
  const hash = 'sha256:' + Array.from(a.id).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16).padStart(8, '0') + '…c41e';
  const done = a.status !== 'pending';
  const go = (d: 'approved' | 'denied') => {
    if (d === 'denied' && comment.trim().length < 3) { setTried(true); return; }
    decide(a.id, d);
    toast({ tone: d === 'approved' ? 'success' : 'info', title: d === 'approved' ? 'Approved (demo)' : 'Denied (demo)', body: `${a.title}. Recorded with hash ${hash.slice(0, 15)}…` });
    close();
  };
  const pick = (f?: File | null) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) { toast({ tone: 'warning', title: 'Images only', body: 'Attach a PNG, JPG or WebP screenshot as evidence.' }); return; }
    setImg({ name: f.name, url: URL.createObjectURL(f) });
  };
  return (
    <Modal title="Approval decision" icon={Fingerprint} help="ug.dialog.approval" dialogId="DL-48" size="lg" tone={a.risk === 'critical' ? 'danger' : a.risk === 'high' ? 'warn' : 'default'}
      sub="You decide on one exact action. This does not grant anything broader." onClose={close}
      footer={done ? <button className="btn" onClick={close}>Close</button> : <>
        <button className="btn" onClick={close}>Cancel</button>
        <span className="spacer" />
        <button className="btn danger" onClick={() => go('denied')}><XCircle size={15} />Deny</button>
        <button className="btn good" data-autofocus onClick={() => go('approved')}><CheckCircle2 size={15} />Approve</button>
      </>}>
      <div className="col" style={{ gap: 14 }}>
        <div className="ug-bound" style={{ ['--h' as string]: r.hue }}>
          <div className="row" style={{ gap: 8 }}><Chip hue={r.hue} solid>{r.tier} · {r.label}</Chip><Chip hue={225}>{a.kind}</Chip>{done && <Chip hue={a.status === 'approved' ? 145 : 0}>{a.status}</Chip>}<span className="spacer" /><span className="mono dim" style={{ fontSize: 11.5 }}>{a.id}</span></div>
          <h3 className="ug-bound-title">{a.title}</h3>
          <p className="muted" style={{ fontSize: 13 }}>{a.detail}</p>
          <dl className="ug-kv">
            <div><dt>Requested by</dt><dd>{agent?.name ?? a.agentId}</dd></div>
            <div><dt>Mission</dt><dd className="mono">{a.missionId}</dd></div>
            <div><dt>Bound hash</dt><dd className="mono">{hash}</dd></div>
            <div><dt>Expires</dt><dd><Clock size={12} style={{ display: 'inline', verticalAlign: -2 }} /> in {a.expiresMin} min</dd></div>
            <div><dt>Asked</dt><dd>{ago(a.agoMin)}</dd></div>
            <div><dt>On expiry</dt><dd>Denied automatically, no silent retry</dd></div>
          </dl>
        </div>
        {!done && <>
          <Field label="Comment" hint="Required when denying. Saved with the decision." error={tried ? 'A short reason is required to deny.' : undefined} help="ug.approval.comment">
            <textarea className="textarea" rows={3} placeholder="Why are you approving or denying this exact action?" value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <Field label="Evidence image (optional)" help="ug.approval.image">
            {img ? (
              <div className="ug-preview"><img src={img.url} alt={`Attached evidence: ${img.name}`} /><div style={{ minWidth: 0 }}><b className="ellipsis" style={{ display: 'block' }}>{img.name}</b><span className="dim" style={{ fontSize: 12 }}>Stored as evidence only, never as an instruction.</span></div><button className="icon-btn" aria-label="Remove image" onClick={() => setImg(null)}><X size={14} /></button></div>
            ) : (
              <button type="button" className="ug-drop" onClick={() => file.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
                <ImagePlus size={20} /><span>Drop an image or click to attach</span>
              </button>
            )}
            <input ref={file} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
          </Field>
        </>}
      </div>
    </Modal>
  );
}

/* DL-49 ------------------------------------------------------------- */
function PolicyRevision({ close, props }: DialogComponentProps<{ clause?: string }>) {
  const add = useUG((s) => s.addRevision);
  const [text, setText] = useState('Approvals expire after 2 hours (R3/R4) or 24 hours (R2); expired requests must be re-issued.');
  const [eff, setEff] = useState('on-approval');
  const [esc, setEsc] = useState(true);
  return (
    <Modal title="Policy revision" icon={FileDiff} help="ug.dialog.policy" dialogId="DL-49" size="lg" sub={`Clause ${props.clause ?? 'C-2 · Exact-action approval'}. No silent edits: this goes to Owner review.`} onClose={close}
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" onClick={() => { if (text.trim().length < 10) { toast({ tone: 'warning', title: 'Proposal is too short' }); return; } add(`${props.clause ?? 'C-2'} revision`); toast({ tone: 'success', title: 'Submitted for Owner review (demo)', body: 'The constitution is unchanged until approved.' }); close(); }}>Submit for Owner Review</button></>}>
      <div className="grid g-2" style={{ gap: 14 }}>
        <div className="col" style={{ gap: 12 }}>
          <Field label="Proposed text" required help="ug.policy.text"><textarea data-autofocus className="textarea" rows={7} value={text} onChange={(e) => setText(e.target.value)} /></Field>
          <Field label="Effective"><select className="select" value={eff} onChange={(e) => setEff(e.target.value)}><option value="on-approval">On Owner approval</option><option value="next-day">Next day 00:00 UTC</option><option value="next-mission">New missions only</option></select></Field>
          <SwitchRow label="Escalate to Owner immediately" desc="Policy changes are Owner-only. Leave on." checked={esc} onChange={setEsc} />
        </div>
        <div className="col" style={{ gap: 10 }}>
          <div className="section-label">Diff against v6</div>
          <div className="ug-diff">
            <div className="ug-diff-l del"><i>-</i>Approvals expire after 24 hours unless renewed by an Owner.</div>
            <div className="ug-diff-l add"><i>+</i>{text || '(empty)'}</div>
          </div>
          <div className="subpanel" style={{ fontSize: 12.5 }}>
            <b>Impacted</b>
            <div className="dim" style={{ marginTop: 4 }}>9 running missions · 3 pending approvals would be re-timed · Browser-02 and Release-01 grants renewed.</div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* DL-50 ------------------------------------------------------------- */
function SecretConnector({ close }: DialogComponentProps) {
  const add = useUG((s) => s.addSecret);
  const [name, setName] = useState('');
  const [provider, setProvider] = useState('Model provider');
  const [scope, setScope] = useState('Gateway · all missions');
  const [tested, setTested] = useState<'idle' | 'busy' | 'ok'>('idle');
  const [tried, setTried] = useState(false);
  const valid = /^[a-z0-9-/]+$/.test(name);
  const test = () => { setTested('busy'); window.setTimeout(() => setTested('ok'), 900); };
  return (
    <Modal title="Connect secret reference" icon={KeyRound} help="ug.dialog.secret" dialogId="DL-50" sub="Store a reference only. AXION never displays or stores the value in this UI." onClose={close}
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" onClick={() => { setTried(true); if (!valid) return; add({ id: `SEC-${Date.now() % 1000}`, ref: `sec://${name}`, provider, scope, owner: 'Luca', rotatedDays: 0, dueDays: 90, state: 'ok', accesses: 0 }); toast({ tone: 'success', title: 'Reference saved (demo)', body: `sec://${name}. Value stays in the vault.` }); close(); }}>Save Secret Reference</button></>}>
      <div className="col" style={{ gap: 14 }}>
        <Field label="Reference name" required help="ug.secret.ref" hint="Lowercase letters, digits, dash and slash." error={tried && !valid ? 'Use lowercase letters, digits, - and / only.' : undefined}>
          <div className="input-wrap"><KeyRound size={15} /><input data-autofocus className="input mono" placeholder="models/provider-primary" value={name} onChange={(e) => setName(e.target.value.toLowerCase())} /></div>
        </Field>
        <div className="grid g-2">
          <Field label="Provider"><select className="select" value={provider} onChange={(e) => setProvider(e.target.value)}><option>Model provider</option><option>Source host</option><option>Deploy target</option><option>Speech provider</option></select></Field>
          <Field label="Scope" help="ug.secret.scope"><select className="select" value={scope} onChange={(e) => setScope(e.target.value)}><option>Gateway · all missions</option><option>One mission only</option><option>Staging only</option></select></Field>
        </div>
        <div className="subpanel row" style={{ gap: 10 }}>
          <button className="btn sm" onClick={test} disabled={tested === 'busy'}>{tested === 'busy' ? 'Testing…' : 'Test connectivity'}</button>
          <span className="dim" style={{ fontSize: 12.5 }}>{tested === 'ok' ? 'Reachable (test-only, no value read). Value: ••••••••' : 'Test-only call. The secret value is never returned to the UI.'}</span>
        </div>
      </div>
    </Modal>
  );
}

/* DL-61 ------------------------------------------------------------- */
const EVENTS = [['approval', 'Approvals'], ['critical', 'Critical alerts'], ['mission', 'Mission milestones'], ['agent', 'Agent updates'], ['system', 'System events'], ['evolution', 'Evolution']] as const;
function NotificationRule({ close }: DialogComponentProps) {
  const add = useUG((s) => s.addRule);
  const [name, setName] = useState('');
  const [events, setEvents] = useState<string[]>(['approval']);
  const [channel, setChannel] = useState<'in-app' | 'email' | 'digest'>('in-app');
  const [urgency, setUrgency] = useState<'all' | 'warning+' | 'critical'>('warning+');
  const [freq, setFreq] = useState<'instant' | 'hourly' | 'daily'>('instant');
  const [qs, setQs] = useState('22:00');
  const [qe, setQe] = useState('07:00');
  const [tried, setTried] = useState(false);
  return (
    <Modal title="Notification rule" icon={Bell} help="ug.dialog.rule" dialogId="DL-61" sub="Critical alerts always break through quiet hours." onClose={close}
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" onClick={() => { setTried(true); if (!name.trim() || !events.length) return; add({ id: `R-${Date.now() % 1000}`, name, events, channel, urgency, freq, quiet: `${qs} - ${qe}`, on: true }); toast({ tone: 'success', title: 'Rule saved (demo)', body: name }); close(); }}>Save Rule</button></>}>
      <div className="col" style={{ gap: 14 }}>
        <Field label="Rule name" required error={tried && !name.trim() ? 'Give the rule a name.' : undefined}><input data-autofocus className="input" placeholder="e.g. Release approvals, instant" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Events" help="ug.rule.events" error={tried && !events.length ? 'Pick at least one event.' : undefined}>
          <div className="row wrap" style={{ gap: 6 }}>
            {EVENTS.map(([k, l]) => { const on = events.includes(k); return <button key={k} type="button" aria-pressed={on} className={'ug-pill' + (on ? ' on' : '')} onClick={() => setEvents(on ? events.filter((x) => x !== k) : [...events, k])}>{l}</button>; })}
          </div>
        </Field>
        <div className="grid g-2">
          <Field label="Channel"><Segmented ariaLabel="Channel" size="sm" value={channel} onChange={setChannel} options={[{ key: 'in-app', label: 'In-app' }, { key: 'email', label: 'Email' }, { key: 'digest', label: 'Digest' }]} /></Field>
          <Field label="Frequency"><Segmented ariaLabel="Frequency" size="sm" value={freq} onChange={setFreq} options={[{ key: 'instant', label: 'Instant' }, { key: 'hourly', label: 'Hourly' }, { key: 'daily', label: 'Daily' }]} /></Field>
        </div>
        <Field label="Minimum urgency"><Segmented ariaLabel="Urgency" size="sm" value={urgency} onChange={setUrgency} options={[{ key: 'all', label: 'All' }, { key: 'warning+', label: 'Warning+' }, { key: 'critical', label: 'Critical' }]} /></Field>
        <Field label="Quiet hours" help="ug.rule.quiet"><div className="row" style={{ gap: 8 }}><input className="input" type="time" value={qs} onChange={(e) => setQs(e.target.value)} aria-label="Quiet hours start" /><span className="dim">to</span><input className="input" type="time" value={qe} onChange={(e) => setQe(e.target.value)} aria-label="Quiet hours end" /></div></Field>
      </div>
    </Modal>
  );
}

export const dialogs = {
  'user-invite': UserInvite,
  'role-edit': RoleEdit,
  'session-revoke': SessionRevoke,
  'approval-decision': ApprovalDecision,
  'policy-revision': PolicyRevision,
  'secret-connector': SecretConnector,
  'notification-rule': NotificationRule,
};
void ROLE_HUE;
