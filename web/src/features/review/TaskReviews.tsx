import { ClipboardCheck, Bot, UserRound, ShieldCheck, FileCheck2, CircleCheck, CircleAlert, CircleX } from 'lucide-react';
import { Chip } from '@/components/ui/Chips';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Tip } from '@/components/ui/Tip';
import { openDialog } from '@/store/ui';
import { agoFromTs } from '@/lib/format';
import type { ReviewVerdict, TaskReviewDto } from '@contracts';
import type { ReviewsRead } from '@/api/taskReviews';
import '@/theme/pages/task-review.css';

export const VERDICT: Record<ReviewVerdict, { label: string; hue: number; icon: typeof CircleCheck }> = {
  accepted: { label: 'Accepted', hue: 150, icon: CircleCheck },
  changes_requested: { label: 'Changes requested', hue: 40, icon: CircleAlert },
  rejected: { label: 'Rejected', hue: 355, icon: CircleX },
};
export const VerdictChip = ({ v, size }: { v: ReviewVerdict; size?: 'sm' }) => <Chip hue={VERDICT[v].hue} icon={VERDICT[v].icon} size={size}>{VERDICT[v].label}</Chip>;

const agreementText = (a: TaskReviewDto['reviewerAgreement']) =>
  a.state === 'ok' ? `agrees ${a.agreed} of ${a.n} (n=${a.n})` : a.n ? `agreement: not enough evidence (n=${a.n})` : 'agreement: not enough evidence (n=0)';
const rubricText = (r: TaskReviewDto['rubric']) => `${r.filter((x) => x.result === 'pass').length} pass · ${r.filter((x) => x.result === 'fail').length} fail · ${r.filter((x) => x.result === 'na').length} n/a`;

/** The "Review" action with the reason it is unavailable. The server decides (canReview); the `?` always explains the rule. */
export function ReviewAction({ missionId, taskId, rv, api_ }: { missionId: string; taskId: string; rv: ReviewsRead; api_: boolean }) {
  const can = rv.data?.canReview;
  const allowed = api_ && !!can?.allowed;
  const why = !api_ ? 'Reviews are recorded on the server; this is demo data.' : !rv.data ? (rv.error ?? 'Reading the task reviews') : can?.reason ?? '';
  return (
    <span className="row rv-action" style={{ gap: 4 }} data-review-action={allowed ? 'enabled' : 'disabled'} data-review-code={can?.code ?? ''}>
      <Tip label={allowed ? 'Record an independent review of this task' : why}>
        <span><button className="btn primary" disabled={!allowed} aria-label="Review" onClick={() => openDialog('task-review', { missionId, taskId })}><ClipboardCheck size={15} />Review</button></span>
      </Tip>
      <HelpTrigger k="review.who" />
    </span>
  );
}

/** Reviews of one task (api mode): each with its verdict chip, reviewer, evidence and the reviewer's agreement with n. */
export function ReviewList({ rv }: { rv: ReviewsRead }) {
  const d = rv.data;
  return (
    <div data-review-list={d ? 'ready' : rv.error ? 'error' : 'loading'}>
      <div className="row" style={{ gap: 6 }}><div className="section-label" style={{ margin: 0 }}>Independent review ({d?.reviews.length ?? '…'})</div><HelpTrigger k="review.list" /></div>
      {!d ? <span className="dim" style={{ fontSize: 12.5 }} role={rv.error ? 'alert' : 'status'}>{rv.error ?? 'Reading the reviews…'}</span>
        : d.reviews.length === 0 ? <span className="dim" style={{ fontSize: 12.5 }}>No review yet. A task counts as verified only after someone other than its producer accepts it with evidence.</span>
        : <ul className="rv-list" aria-label="Reviews">{d.reviews.map((r) => (
          <li key={r.id} className="rv-item" data-verdict={r.verdict}>
            <div className="row" style={{ gap: 6 }}>
              <VerdictChip v={r.verdict} size="sm" />
              {r.reviewer.kind === 'agent' ? <Bot size={13} aria-hidden /> : <UserRound size={13} aria-hidden />}
              <b className="ellipsis" style={{ fontSize: 12.5 }}>{r.reviewer.name}</b>
              {r.reviewer.modelFamily && <Chip hue={205} size="sm" title="Model family of the reviewer">{r.reviewer.modelFamily}</Chip>}
              <span className="spacer" />
              <span className="dim tnum" style={{ fontSize: 11 }}>{agoFromTs(new Date(r.createdAt).getTime())}</span>
            </div>
            <div className="row dim rv-meta" style={{ gap: 10, fontSize: 11.5 }}>
              <span><ShieldCheck size={11} aria-hidden /> producer {r.producer.name}{r.producer.modelFamily ? ` (${r.producer.modelFamily})` : ''}</span>
              <span>{rubricText(r.rubric)}</span>
              <span><FileCheck2 size={11} aria-hidden /> {r.evidence.length} evidence</span>
              <span data-agreement={r.reviewerAgreement.state}>{agreementText(r.reviewerAgreement)}</span>
            </div>
          </li>))}</ul>}
    </div>
  );
}
