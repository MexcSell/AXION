import { useRef, useState } from 'react';
import { ImagePlus, ShieldAlert, Bell, X, CheckCircle2, XCircle, Fingerprint, Clock } from 'lucide-react';
import type { DialogComponentProps } from '@/dialogs/DialogHost';
import { ApprovalFacts, GateNote, useGate } from '@/features/approvals/ApprovalBinding';
import { Modal } from '@/components/ui/Modal';
import { Field, Segmented } from '@/components/ui/Form';
import { Chip } from '@/components/ui/Chips';
import { toast } from '@/store/ui';
import { useData, allApprovals, useVisibleMissions } from '@/store/data';
import { AGENT_BY_ID } from '@/data/agents';
import { RISK_TIER, ROLE_HUE, useUG } from '@/data/users-governance';
import { ago } from '@/lib/format';
import '@/theme/pages/users-governance-notifications.css';

function ApprovalDecision({ close, props }: DialogComponentProps<{ approvalId?: string }>) {
  const missions = useVisibleMissions();
  const decisions = useData((s) => s.approvalDecisions);
  const decide = useData((s) => s.decideApproval);
  const a = allApprovals(missions, decisions).find((x) => x.id === props.approvalId);
  const [comment, setComment] = useState('');
  const [img, setImg] = useState<{ name: string; url: string } | null>(null);
  const [tried, setTried] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const gate = useGate(a ?? {});
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
        {gate.blocked && <GateNote id={gate.id} text={gate.text} />}
        <button type="button" {...gate.bind(() => go('denied'), 'btn danger')}><XCircle size={15} />Deny</button>
        <button type="button" data-autofocus={gate.blocked ? undefined : true} {...gate.bind(() => go('approved'), 'btn good')}><CheckCircle2 size={15} />Approve</button>
      </>}>
      <div className="col" style={{ gap: 14 }}>
        <div className="ug-bound" style={{ ['--h' as string]: r.hue }}>
          <div className="row" style={{ gap: 8 }}><Chip hue={r.hue} solid>{r.tier} · {r.label}</Chip><Chip hue={225}>{a.kind}</Chip>{done && <Chip hue={a.status === 'approved' ? 145 : 0}>{a.status}</Chip>}<span className="spacer" /><span className="mono dim" style={{ fontSize: 11.5 }}>{a.id}</span></div>
          <h3 className="ug-bound-title">{a.title}</h3>
          <p className="muted" style={{ fontSize: 13 }}>{a.detail}</p>
          <ApprovalFacts a={a} />
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
  'approval-decision': ApprovalDecision,
  'notification-rule': NotificationRule,
};
void ROLE_HUE;
