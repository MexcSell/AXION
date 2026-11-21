import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap, Plus, Check, CheckCircle2, XCircle, Circle, CalendarClock, AlertOctagon, Lock, FlaskConical, History, Ban } from 'lucide-react';
import type { MentoringPlanDto, MentoringStatus } from '@contracts';
import { Panel } from '@/components/ui/Panel';
import { Chip } from '@/components/ui/Chips';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { EmptyState } from '@/components/ui/EmptyState';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { useAgentsCatalog } from '@/api/agents';
import { useMentoringPlans, tickMilestone, closeMentoringPlan } from '@/api/mentoring';
import { AGENT_BY_ID } from '@/data/agents';
import { isAdmin, useMe } from '@/store/auth';
import { openDialog, toast } from '@/store/ui';
import { ago, cx } from '@/lib/format';
import '@/theme/pages/overview-org-agent.css';

/* Improvement cycle 19 (api mode): mentoring plans. Only stored facts are shown: mentor, target skill, milestones with
   who ticked them and when, the re-evaluation date, status. No score or "skill gain": nothing is measured yet. */

export const MP_STATUS: Record<MentoringStatus, { label: string; hue: number; icon: typeof CheckCircle2 }> = {
  active: { label: 'Active', hue: 205, icon: GraduationCap },
  completed: { label: 'Completed', hue: 145, icon: CheckCircle2 },
  cancelled: { label: 'Cancelled', hue: 225, icon: XCircle },
};
export const NEEDS_EVAL = 'Needs evaluation data: agents don\'t execute yet.';

const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const since = (iso: string) => ago((Date.now() - new Date(iso).getTime()) / 60_000);

/** Where a re-evaluation result would go: there is none, and the card says why. */
export function NoReevaluation({ due }: { due: boolean }) {
  return (
    <div className="row" style={{ gap: 8, fontSize: 12, padding: '7px 10px', borderRadius: 10, background: 'var(--panel-3)', border: '1px dashed var(--border-soft)' }} data-reevaluation="none">
      <FlaskConical size={14} className="dim" aria-hidden />
      <span className="dim">{due ? 'Re-evaluation is due. ' : 'Re-evaluation: '}{NEEDS_EVAL}</span>
      <span className="spacer" /><HelpTrigger k="mentoring.reeval" />
    </div>
  );
}

export function MentoringPlanCard({ p, admin, index, showMentee = false, err, setErr }: { p: MentoringPlanDto; admin: boolean; index: number; showMentee?: boolean; err?: string; setErr: (m: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState<null | 'completed' | 'cancelled'>(null);
  const [note, setNote] = useState('');
  const S = MP_STATUS[p.status];
  const active = p.status === 'active';
  const due = active && p.reevalOn <= today();
  const mentor = AGENT_BY_ID[p.mentorId];
  const mentee = AGENT_BY_ID[p.menteeId];
  const run = async (f: () => Promise<{ ok: true; value: MentoringPlanDto } | { ok: false; message: string }>, done: string) => {
    if (busy) return;
    setBusy(true); setErr(null);
    const r = await f();
    setBusy(false);
    if (!r.ok) { setErr(r.message); toast({ tone: 'warning', title: 'Mentoring plan: not done', body: r.message }); return; }
    setClosing(null); setNote('');
    toast({ tone: 'success', title: done });
  };
  return (
    <motion.article layout className="subpanel glass-card oa-pcard" data-mentoring-plan={p.id} data-status={p.status} data-agent={p.menteeId}
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: .97 }} transition={{ delay: Math.min(index, 8) * .05 }}>
      <div className="row" style={{ gap: 10 }}>
        {showMentee && mentee ? <Link to={`/agents/${p.menteeId}?tab=mentoring`} aria-label={`Open ${p.menteeName}`}><RobotAvatar role={mentee.role} size={38} animated={active} /></Link>
          : <RobotAvatar role="mentor" size={38} faceMode="face" animated={active} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <b style={{ fontSize: 14 }} data-skill>{p.skill}</b>
          <div className="dim" style={{ fontSize: 11.5 }}>
            {showMentee && <><b>{p.menteeName}</b> · </>}mentor <b data-mentor>{mentor ? <Link to={`/agents/${p.mentorId}`}>{p.mentorName}</Link> : p.mentorName}</b> · by {p.createdByName} · {since(p.createdAt)}
          </div>
        </div>
        <Chip hue={S.hue} icon={S.icon} size="sm" solid={active} className={cx(active && 'oa-pulse')}>{S.label}</Chip>
      </div>
      <div className="row wrap" style={{ gap: 6, margin: '8px 0 4px' }}>
        <span data-reeval={p.reevalOn}><Chip hue={225} icon={CalendarClock} size="sm" title="Re-evaluation date">re-evaluate {fmtDate(p.reevalOn)}</Chip></span>
        <span data-progress={`${p.milestonesDone}/${p.milestonesTotal}`}><Chip hue={p.milestonesDone === p.milestonesTotal ? 145 : 205} size="sm" className="tnum">{p.milestonesDone} of {p.milestonesTotal} milestones done</Chip></span>
        {due && <Chip hue={38} icon={AlertOctagon} size="sm">re-evaluation due</Chip>}
      </div>
      <div className="bar thin" aria-hidden style={{ margin: '2px 0 8px' }}><motion.i initial={{ width: 0 }} animate={{ width: `${p.milestonesTotal ? (p.milestonesDone / p.milestonesTotal) * 100 : 0}%` }} transition={{ duration: .7 }} /></div>
      <ol className="col" style={{ gap: 6, margin: 0, padding: 0, listStyle: 'none' }} aria-label={`Milestones for ${p.skill}`}>
        {p.milestones.map((m) => (
          <li key={m.id} className="row" style={{ gap: 8, fontSize: 12.5 }} data-milestone={m.seq} data-done={m.doneAt ? '1' : '0'}>
            {m.doneAt ? <CheckCircle2 size={16} style={{ color: 'var(--good)', flex: 'none' }} aria-label="done" />
              : active && admin ? <button className="icon-btn" style={{ width: 22, height: 22, flex: 'none' }} disabled={busy} aria-label={`Mark milestone ${m.seq} done: ${m.text}`} title="Mark done (recorded with your name and the time)"
                onClick={() => run(() => tickMilestone(p.id, m.id), `Milestone ${m.seq} done`)}><Check size={13} /></button>
                : <Circle size={16} className="dim" style={{ flex: 'none' }} aria-label="not done" />}
            <span style={{ flex: 1, minWidth: 0 }} className={cx(m.doneAt && 'dim')}>{m.text}</span>
            {m.doneAt && <span className="dim" style={{ fontSize: 11.5 }} data-done-by={m.doneByName ?? ''}>{m.doneByName} · {since(m.doneAt)}</span>}
          </li>
        ))}
      </ol>
      {active && <div style={{ marginTop: 8 }}><NoReevaluation due={due} /></div>}
      {!active && (
        <div className="dim" style={{ fontSize: 12, marginTop: 8 }} data-closed>{S.label} by {p.closedByName}{p.closedAt ? ` · ${since(p.closedAt)}` : ''}{p.note ? <> · “{p.note}”</> : null}</div>
      )}
      {err && <div className="oa-banner" role="alert" style={{ marginTop: 8 }} data-card-error><AlertOctagon size={15} /><span>{err}</span></div>}
      {active && admin && (closing ? (
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <input className="input" style={{ flex: 1, minWidth: 0, height: 32 }} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label={`Closing note for ${p.skill}`} data-autofocus />
          <button className={cx('btn sm', closing === 'completed' && 'primary')} disabled={busy} onClick={() => run(() => closeMentoringPlan(p.id, closing, note), closing === 'completed' ? 'Plan completed' : 'Plan cancelled')}>
            {closing === 'completed' ? <CheckCircle2 size={13} /> : <Ban size={13} />}Confirm {closing === 'completed' ? 'complete' : 'cancel'}</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => setClosing(null)}>Back</button>
        </div>
      ) : (
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <span className="dim" style={{ fontSize: 11.5 }}>A closed plan stays in the history.</span><span className="spacer" />
          <button className="btn sm" onClick={() => setClosing('completed')}><CheckCircle2 size={13} />Complete</button>
          <button className="btn sm ghost" onClick={() => setClosing('cancelled')}><Ban size={13} />Cancel plan</button>
          <HelpTrigger k="mentoring.close" />
        </div>
      ))}
    </motion.article>
  );
}

function useErrs() {
  const [errs, setErrs] = useState<Record<string, string>>({});
  return { errs, setErr: (id: string) => (m: string | null) => setErrs((x) => { const n = { ...x }; if (m) n[id] = m; else delete n[id]; return n; }) };
}

/** Agent Profile › Mentoring in api mode: the active plan, its milestones, and the history of closed plans. */
export function ServerMentoring({ agentId, agentName, canStart }: { agentId: string; agentName: string; canStart: boolean }) {
  useAgentsCatalog();
  const { data, error, retry } = useMentoringPlans(agentId);
  const me = useMe();
  const admin = isAdmin(me);
  const { errs, setErr } = useErrs();
  const list = data ?? [];
  const active = list.find((p) => p.status === 'active');
  const history = list.filter((p) => p.status !== 'active');
  return (
    <div className="col" style={{ gap: 'var(--gap)' }} data-mentoring={data ? 'ready' : error ? 'error' : 'loading'}>
      <Panel icon={GraduationCap} title="Mentoring plan" help="mentoring.plan" delay={.05}
        sub={`Recorded plan for ${agentName}: mentor, target skill, milestones, re-evaluation date.`}
        actions={canStart ? <div className="row" style={{ gap: 6 }}>
          <button className="btn primary" disabled={!data || !!active} title={active ? 'This agent already has an active plan: close it first' : undefined} onClick={() => openDialog('mentoring-plan', { agentId })}><Plus size={15} />Start a plan</button>
          <HelpTrigger k="mentoring.start" />
        </div> : <Chip hue={225} icon={Lock} size="sm" title="Only administrators start and close plans">Read only</Chip>}>
        {error && <div className="oa-banner" role="alert"><AlertOctagon size={15} /><span>Mentoring plans not loaded: {error}</span><button className="btn sm" onClick={retry}>Retry</button></div>}
        {!data && !error ? <div className="dim" style={{ padding: 12 }}>Loading plans…</div>
          : active ? <MentoringPlanCard p={active} admin={admin} index={0} err={errs[active.id]} setErr={setErr(active.id)} />
          : <EmptyState icon={GraduationCap} title="No active mentoring plan" body={admin ? 'Start a plan: choose a mentor agent, a target skill, up to five milestones and a re-evaluation date.' : 'Administrators record mentoring plans here.'} />}
      </Panel>
      <Panel icon={History} title="History" help="mentoring.history" delay={.1} sub="Closed plans are kept: completed or cancelled, never deleted.">
        {history.length === 0 ? <div className="dim" style={{ fontSize: 12.5 }} data-history="empty">No closed plans yet.</div>
          : <div className="col" style={{ gap: 10 }} data-history="list"><AnimatePresence>{history.map((p, i) => <MentoringPlanCard key={p.id} p={p} admin={admin} index={i} err={errs[p.id]} setErr={setErr(p.id)} />)}</AnimatePresence></div>}
      </Panel>
    </div>
  );
}

/** Agents › Development in api mode: every agent's active mentoring plan. */
export function ServerMentoringList() {
  useAgentsCatalog();
  const { data, error, retry } = useMentoringPlans();
  const admin = isAdmin(useMe());
  const { errs, setErr } = useErrs();
  const active = (data ?? []).filter((p) => p.status === 'active');
  return (
    <Panel icon={GraduationCap} titleSize="lg" title="Mentoring plans" help="mentoring.dev" delay={.1} data-dev-mentoring={data ? 'ready' : error ? 'error' : 'loading'}
      sub="Active plans: a mentor, a target skill, milestones ticked off by a person and a re-evaluation date. Start one from an agent's Mentoring tab.">
      {error && <div className="oa-banner" role="alert"><AlertOctagon size={15} /><span>Mentoring plans not loaded: {error}</span><button className="btn sm" onClick={retry}>Retry</button></div>}
      {!data && !error ? <div className="dim" style={{ padding: 12 }}>Loading plans…</div>
        : active.length === 0 ? <EmptyState icon={GraduationCap} title="No active mentoring plans" body={admin ? 'Open an agent › Mentoring and use “Start a plan”.' : 'Administrators record mentoring plans here.'} />
        : <div className="oa-prop-grid"><AnimatePresence>{active.map((p, i) => <MentoringPlanCard key={p.id} p={p} admin={admin} index={i} showMentee err={errs[p.id]} setErr={setErr(p.id)} />)}</AnimatePresence></div>}
    </Panel>
  );
}
