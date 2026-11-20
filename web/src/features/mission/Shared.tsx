import { motion } from 'motion/react';
import { CheckCircle2, Gavel } from 'lucide-react';
import { Chip } from '@/components/ui/Chips';
import { useData, allApprovals } from '@/store/data';
import { openDialog, toast } from '@/store/ui';
import { AGENT_BY_ID } from '@/data/agents';
import { cx } from '@/lib/format';
import { GitBranch, Globe2, Cpu, MessageSquare, Upload, BadgeCheck, Send, Hand, XCircle, Rocket, Flag } from 'lucide-react';
const EV_ICON = { create: Flag, delegate: GitBranch, browser: Globe2, model: Cpu, message: MessageSquare, artifact: Upload, verify: BadgeCheck, report: Send, approval: Hand, error: XCircle, release: Rocket } as const;
const EV_TONE = { create: 'info', delegate: 'violet', browser: 'info', model: 'muted', message: 'info', artifact: 'good', verify: 'good', report: 'violet', approval: 'warn', error: 'bad', release: 'good' } as const;
export function EventIcon({ type }: { type: keyof typeof EV_ICON }) {
  const I = EV_ICON[type];
  const t = EV_TONE[type];
  return <span className="ev-ico" style={{ color: t === 'muted' ? 'var(--text-dim)' : `var(--${t})` }}><I size={13} /></span>;
}

export function ApprovalMini({ id }: { id: string }) {
  const missions = useData((s) => s.missions);
  const decisions = useData((s) => s.approvalDecisions);
  const decide = useData((s) => s.decideApproval);
  const a = allApprovals(missions, decisions).find((x) => x.id === id)!;
  const resolved = a.status !== 'pending';
  return (
    <motion.div layout className={cx('approval-mini', resolved && 'resolved')} style={{ ['--tone' as string]: a.risk === 'high' || a.risk === 'critical' ? 'var(--bad)' : 'var(--warn)' }}>
      <div className="row" style={{ gap: 8 }}>
        <Gavel size={16} style={{ color: 'var(--tone)' }} />
        <b className="ellipsis">{a.title}</b>
        <Chip hue={a.risk === 'high' ? 350 : 38} size="sm">{a.risk} risk</Chip>
        <span className="spacer" />
        <span className="dim" style={{ fontSize: 11.5 }}>{resolved ? a.status : `expires in ${a.expiresMin} min`}</span>
      </div>
      <div className="muted" style={{ fontSize: 12.5, margin: '6px 0 8px 24px' }}>{a.detail} <span className="dim">· requested by {AGENT_BY_ID[a.agentId]?.name}</span></div>
      {!resolved ? (
        <div className="row" style={{ gap: 6, marginLeft: 24 }}>
          <button className="btn sm good" onClick={() => { decide(a.id, 'approved'); toast({ tone: 'success', title: 'Approved once', body: `${a.title} — bound to ${a.id}.` }); }}>Approve once</button>
          <button className="btn sm danger" onClick={() => { decide(a.id, 'denied'); toast({ tone: 'warning', title: 'Denied', body: `${a.title}. The agent will propose an alternative.` }); }}>Deny</button>
          <button className="btn sm ghost" onClick={() => openDialog('approval-decision', { approvalId: a.id })}>Review details…</button>
        </div>
      ) : <div className="row" style={{ marginLeft: 24, gap: 6, fontSize: 12.5 }}>{a.status === 'approved' ? <CheckCircle2 size={14} className="good" /> : <XCircle size={14} className="bad" />}Resolved: {a.status}</div>}
    </motion.div>
  );
}
