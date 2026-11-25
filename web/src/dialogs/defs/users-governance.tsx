import { useState } from 'react';
import { ShieldAlert, CheckCircle2, XCircle, Fingerprint, Clock } from 'lucide-react';
import type { DialogComponentProps } from '@/dialogs/DialogHost';
import { ApprovalFacts, GateNote, RuleOfTwoNote, useGate } from '@/features/approvals/ApprovalBinding';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Form';
import { Chip } from '@/components/ui/Chips';
import { toast } from '@/store/ui';
import { useData, allApprovals, useVisibleMissions } from '@/store/data';
import { AGENT_BY_ID } from '@/data/agents';
import { RISK_TIER } from '@/data/users-governance';
import { ago } from '@/lib/format';
import '@/theme/pages/users-governance-notifications.css';

function ApprovalDecision({ close, props }: DialogComponentProps<{ approvalId?: string }>) {
  const missions = useVisibleMissions();
  const decisions = useData((s) => s.approvalDecisions);
  const decide = useData((s) => s.decideApproval);
  const a = allApprovals(missions, decisions).find((x) => x.id === props.approvalId);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const gate = useGate(a ?? {});
  if (!a) {
    return <Modal title="Approval not found" icon={ShieldAlert} help="ug.dialog.approval" dialogId="DL-48" onClose={close} footer={<button className="btn" onClick={close}>Close</button>}><p className="muted">This approval no longer exists or was resolved.</p></Modal>;
  }
  const r = RISK_TIER[a.risk];
  const agent = AGENT_BY_ID[a.agentId];
  const done = a.status !== 'pending';
  const go = async (decision: 'approved' | 'denied') => {
    if (busy) return;
    if (decision === 'denied' && comment.trim().length < 3) { setTried(true); return; }
    setBusy(true);
    const recorded = await decide(a.id, decision, comment.trim());
    setBusy(false);
    if (recorded) {
      toast({ tone: decision === 'approved' ? 'success' : 'info', title: decision === 'approved' ? 'Approval recorded' : 'Denial recorded', body: a.title });
      close();
    }
  };
  return (
    <Modal title="Approval decision" icon={Fingerprint} help="ug.dialog.approval" dialogId="DL-48" size="lg" tone={a.risk === 'critical' ? 'danger' : a.risk === 'high' ? 'warn' : 'default'}
      sub="You decide on one exact action. This does not grant anything broader." onClose={close}
      footer={done ? <button className="btn" onClick={close}>Close</button> : <>
        <button className="btn" onClick={close}>Cancel</button>
        <span className="spacer" />
        {gate.blocked && <GateNote id={gate.id} text={gate.text} tipSide="top" />}
        <button type="button" disabled={busy} {...gate.bind(() => go('denied'), 'btn danger')}><XCircle size={15} />Deny</button>
        <button type="button" data-autofocus={gate.blocked ? undefined : true} disabled={busy} {...gate.bind(() => go('approved'), 'btn good')}><CheckCircle2 size={15} />Approve</button>
      </>}>
      <div className="col" style={{ gap: 14 }}>
        <div className="ug-bound" style={{ ['--h' as string]: r.hue }}>
          <div className="row" style={{ gap: 8 }}><Chip hue={r.hue} solid>{r.tier} · {r.label}</Chip><Chip hue={225}>{a.kind}</Chip>{done && <Chip hue={a.status === 'approved' ? 145 : 0}>{a.status}</Chip>}<span className="spacer" /><span className="mono dim" style={{ fontSize: 11.5 }}>{a.id}</span></div>
          <h3 className="ug-bound-title">{a.title}</h3>
          <p className="muted" style={{ fontSize: 13 }}>{a.detail}</p>
          <ApprovalFacts a={a} />
          <RuleOfTwoNote a={a} />
          <dl className="ug-kv">
            <div><dt>Requested by</dt><dd>{agent?.name ?? a.agentId}</dd></div>
            <div><dt>Mission</dt><dd className="mono">{a.missionId}</dd></div>
            {a.digest && <div><dt>Bound hash</dt><dd className="mono">{a.digest}</dd></div>}
            <div><dt>Expires</dt><dd><Clock size={12} style={{ display: 'inline', verticalAlign: -2 }} /> in {a.expiresMin} min</dd></div>
            <div><dt>Asked</dt><dd>{ago(a.agoMin)}</dd></div>
            <div><dt>On expiry</dt><dd>Denied automatically, no silent retry</dd></div>
          </dl>
        </div>
        {!done && <>
          <Field label="Comment" hint="Required when denying. Saved with the decision." error={tried ? 'A short reason is required to deny.' : undefined} help="ug.approval.comment">
            <textarea className="textarea" maxLength={1000} rows={3} placeholder="Why are you approving or denying this exact action?" value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>

        </>}
      </div>
    </Modal>
  );
}

export const dialogs = { 'approval-decision': ApprovalDecision };
