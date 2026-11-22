import { LiveStatus } from '@/components/ui/LiveStatus';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import {
  BookMarked, Plus, Check, X, ShieldCheck, CalendarClock, AlertTriangle, Undo2, History, Lock, Bot, User, Target, Tag, ClipboardCheck, ListChecks, StickyNote,
  Wand2, CheckCircle2, XCircle, Archive, Info, Layers, Minus, AlertOctagon, EyeOff, HelpCircle, Globe,
} from 'lucide-react';
import type { LessonCandidateDto, PlaybookItem, PlaybookVersionRow, SkillDto, SkillStatus, SkillStep, SourceKind, SourceRef } from '@contracts';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Form';
import { Chip, DemoTag } from '@/components/ui/Chips';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAgentsCatalog } from '@/api/agents';
import { isApi } from '@/api/mode';
import { usePlaybook, useLessons, useSkills, usePlaybookDiff, approveSkill, retireSkill, type Read } from '@/api/playbooks';
import { DEMO_LESSONS, DEMO_PLAYBOOK, DEMO_SKILLS, DEMO_VERSIONS } from '@/data/playbooksDemo';
import { AGENTS, AGENT_BY_ID } from '@/data/agents';
import { isAdmin, useMe } from '@/store/auth';
import { openDialog, toast } from '@/store/ui';
import { ago } from '@/lib/format';
import '@/theme/pages/overview-org-agent.css';

/* Improvement cycle 41: reviewed playbooks and the skill library (records only: nothing executes, no agent reads these yet).
   One panel: the current playbook of an agent role, the candidate lessons waiting for a person, the version history with
   diff and rollback, and the skill library. In demo mode the same panel shows DEMO samples, read only. */

const SRC_ICON: Record<SourceKind, typeof Target> = { mission: Target, failure_tag: Tag, review: ClipboardCheck, task: ListChecks, note: StickyNote };
export const SRC_LABEL: Record<SourceKind, string> = { mission: 'mission', failure_tag: 'failure tag', review: 'review', task: 'task', note: 'note' };
const since = (iso: string) => ago((Date.now() - new Date(iso).getTime()) / 60_000);
const fmtDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const DEMO_WHY = 'DEMO samples are read only. Playbooks are stored on the server.';

export function SourceChips({ sources }: { sources: SourceRef[] }) {
  return (
    <span className="row wrap" style={{ gap: 5 }} data-sources={sources.length}>
      {sources.map((s, i) => s.hidden
        ? <Chip key={i} hue={225} icon={EyeOff} size="sm" className="oa-src-hidden" title={`A ${SRC_LABEL[s.kind]} source: only administrators see which one`}>source hidden</Chip>
        : s.verified === false
          ? <Chip key={i} hue={38} icon={HelpCircle} size="sm" className="oa-src-unverified" title={`Unverified: ${SRC_LABEL[s.kind]} ids are typed by the proposer and not checked against any record${s.note ? '. Note: ' + s.note : ''}`}>unverified {SRC_LABEL[s.kind]}: {s.id}</Chip>
          : <Chip key={i} hue={205} icon={SRC_ICON[s.kind]} size="sm" title={s.note ? `${SRC_LABEL[s.kind]} ${s.id} (checked): ${s.note}` : `${SRC_LABEL[s.kind]} ${s.id} (checked)`}>{s.id}</Chip>)}
    </span>
  );
}

function ItemRow({ it, n, index }: { it: PlaybookItem; n: number; index: number }) {
  return (
    <motion.li layout className="subpanel glass-card" style={{ padding: '9px 12px', listStyle: 'none' }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 8) * .04 }}
      data-playbook-item={it.lessonId} data-contradiction={it.contradiction ? '1' : '0'} data-rereview={it.needsReReview ? '1' : '0'}>
      <div className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
        <span className="tnum dim" style={{ width: 18, paddingTop: 1 }}>{n}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5 }} data-item-text>{it.text}</div>
          <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
            <Chip hue={145} icon={ShieldCheck} size="sm" title="Accepted by a person who did not propose it">reviewed</Chip>
            <Chip hue={225} size="sm" title="The playbook version that added this item">added in v{it.addedInVersion}</Chip>
            <SourceChips sources={it.sources} />
            {it.reviewBy && <Chip hue={it.needsReReview ? 38 : 225} icon={CalendarClock} size="sm" title="Review-by date (server clock)">review by {fmtDate(it.reviewBy)}</Chip>}
            {it.needsReReview && <Chip hue={38} icon={AlertTriangle} size="sm" solid>needs re-review</Chip>}
            {it.contradiction && <Chip hue={0} icon={AlertOctagon} size="sm" title={`Contradicts ${it.contradicts.join(', ')}`}>contradiction · overridden</Chip>}
          </div>
          {it.contradiction && it.overrideNote && <div className="dim" style={{ fontSize: 12, marginTop: 5 }} data-override-note>Override: {it.overrideNote}</div>}
        </div>
      </div>
    </motion.li>
  );
}

function CandidateCard({ l, admin, index, api_, baseVersion }: { l: LessonCandidateDto; admin: boolean; index: number; api_: boolean; baseVersion: number }) {
  const why = !api_ ? DEMO_WHY : l.cannotDecideWhy;
  const can = api_ && l.canDecide;
  return (
    <motion.li layout className="subpanel glass-card" style={{ padding: '10px 12px', listStyle: 'none' }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: Math.min(index, 8) * .04 }}
      data-lesson={l.id} data-status={l.status} data-conflicts={l.conflicts.length}>
      <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <span className="center" style={{ width: 28, height: 28, flex: 'none', borderRadius: 9, background: 'var(--panel-3)' }}>{l.proposedByKind === 'agent' ? <Bot size={15} aria-label="proposed by an agent" /> : <User size={15} aria-label="proposed by a person" />}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5 }} data-lesson-text>{l.text}</div>
          <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
            <span className="dim" style={{ fontSize: 11.5 }}>by <b>{l.proposedByName}</b>{l.proposedByKind === 'agent' ? ' (agent)' : ''} · {since(l.createdAt)}</span>
            <SourceChips sources={l.sources} />
            {l.reviewBy && <Chip hue={225} icon={CalendarClock} size="sm">review by {fmtDate(l.reviewBy)}</Chip>}
            {l.conflicts.length > 0 && <Chip hue={0} icon={AlertOctagon} size="sm" solid title={l.conflicts.map((c) => c.text).join(' | ')}>contradicts {l.conflicts.length === 1 ? 'an item' : `${l.conflicts.length} items`}</Chip>}
          </div>
          {l.conflicts.length > 0 && <div className="dim" style={{ fontSize: 12, marginTop: 5 }}>Conflicts with “{l.conflicts[0].text}”. Accepting needs an override note.</div>}
        </div>
        {admin && (
          <div className="row" style={{ gap: 6, flex: 'none' }}>
            <button className="btn sm primary" disabled={!can} title={can ? 'Accept: adds a new playbook version' : why ?? undefined} aria-label={`Accept lesson: ${l.text}`}
              onClick={() => openDialog('lesson-decide', { lesson: l, mode: 'accept', baseVersion })}><Check size={13} />Accept</button>
            <button className="btn sm" disabled={!can} title={can ? 'Reject with a reason' : why ?? undefined} aria-label={`Reject lesson: ${l.text}`}
              onClick={() => openDialog('lesson-decide', { lesson: l, mode: 'reject', baseVersion })}><X size={13} />Reject</button>
            {!can && <HelpTrigger k="playbook.decider" />}
          </div>
        )}
      </div>
      {admin && !can && why && api_ && <div className="dim row" style={{ gap: 6, fontSize: 11.5, marginTop: 6 }} data-cannot-decide><Lock size={12} aria-hidden />{why}</div>}
    </motion.li>
  );
}

function DiffInline({ agentId, from, to }: { agentId: string; from: number; to: number }) {
  const { data, error } = usePlaybookDiff(agentId, isApi() ? from : null, isApi() ? to : null);
  const demo = !isApi() ? { from, to, added: from < to ? DEMO_PLAYBOOK(agentId, '', '').items.filter((i) => i.addedInVersion > from && i.addedInVersion <= to) : [], removed: [], kept: from } : null;
  const d = data ?? demo;
  if (error) return <div className="oa-banner" role="alert"><AlertOctagon size={15} /><span>Diff not loaded: {error}</span></div>;
  if (!d) return <LiveStatus className="dim" style={{ fontSize: 12 }}>Loading the diff…</LiveStatus>;
  return (
    <div className="oa-lines" data-playbook-diff={`${d.from}-${d.to}`} style={{ marginTop: 6 }}>
      {d.added.map((i) => <span key={'a' + i.lessonId} className="oa-line add" data-diff="add"><Plus size={11} aria-label="added" /><b>{i.text}</b></span>)}
      {d.removed.map((i) => <span key={'r' + i.lessonId} className="oa-line rm" data-diff="rm"><Minus size={11} aria-label="removed" /><b>{i.text}</b></span>)}
      {!d.added.length && !d.removed.length && <span className="dim" style={{ fontSize: 11.5 }}>No item changed ({d.kept} kept).</span>}
    </div>
  );
}

function VersionRow({ v, current, agentId, admin, api_, index }: { v: PlaybookVersionRow; current: boolean; agentId: string; admin: boolean; api_: boolean; index: number }) {
  const [open, setOpen] = useState(false);
  const canRoll = admin && api_ && !current;
  return (
    <motion.li layout className="subpanel glass-card" style={{ padding: '8px 12px', listStyle: 'none' }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 8) * .04 }} data-playbook-version={v.version} data-kind={v.kind}>
      <div className="row" style={{ gap: 8 }}>
        <Chip hue={current ? 145 : 225} size="sm" solid={current} className="tnum">v{v.version}{current ? ' · current' : ''}</Chip>
        <Chip hue={v.kind === 'rollback' ? 38 : 205} icon={v.kind === 'rollback' ? Undo2 : Check} size="sm">{v.kind === 'rollback' ? `rollback to v${v.rollbackTo}` : 'lesson accepted'}</Chip>
        <span className="dim" style={{ fontSize: 12 }}>{v.items} item{v.items === 1 ? '' : 's'} · {v.createdByName} · {since(v.createdAt)}</span>
        {v.note && <span className="dim ellipsis" style={{ fontSize: 12, flex: 1, minWidth: 0 }}>“{v.note}”</span>}
        <span className="spacer" />
        <button className="btn sm ghost" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} diff of version ${v.version}`} onClick={() => setOpen((o) => !o)}><Layers size={13} />Diff</button>
        <button className="btn sm" disabled={!canRoll} aria-label={`Roll back to version ${v.version}`} title={!api_ ? DEMO_WHY : current ? 'This is the current version' : !admin ? 'Only administrators roll back' : 'Create a new version equal to this one'}
          onClick={() => openDialog('playbook-rollback', { agentId, toVersion: v.version })}><Undo2 size={13} />Roll back</button>
      </div>
      {open && <DiffInline agentId={agentId} from={v.version - 1} to={v.version} />}
    </motion.li>
  );
}

/** A step is quoted data: its text is shown as text, and an origin is shown, never opened. */
function StepLine({ st }: { st: SkillStep }) {
  return (
    <span className="row wrap" style={{ gap: 6, display: 'inline-flex' }}>
      <Chip hue={265} size="sm">{st.kind.replace('_', ' ')}</Chip>
      {st.target && <b>{st.target}</b>}<span>{st.detail}</span>
      {st.origin && <Chip hue={225} icon={Globe} size="sm" title="Origin (shown, never opened here)">{st.origin}</Chip>}
    </span>
  );
}
const SK_STATUS: Record<SkillStatus, { label: string; hue: number; icon: typeof Check }> = {
  draft: { label: 'Draft', hue: 38, icon: Wand2 }, approved: { label: 'Approved', hue: 145, icon: CheckCircle2 }, retired: { label: 'Retired', hue: 225, icon: Archive },
};
function SkillRow({ s, admin, api_, index }: { s: SkillDto; admin: boolean; api_: boolean; index: number }) {
  const [busy, setBusy] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const S = SK_STATUS[s.status];
  const run = async (f: () => Promise<{ ok: true } | { ok: false; message: string }>, done: string) => {
    if (busy) return;
    setBusy(true); setErr(null);
    const r = await f();
    setBusy(false);
    if (!r.ok) { setErr(r.message); toast({ tone: 'warning', title: 'Skill: not done', body: r.message }); return; }
    setRetiring(false); setNote('');
    toast({ tone: 'success', title: done });
  };
  const why = !api_ ? DEMO_WHY : s.cannotDecideWhy;
  return (
    <motion.li layout className="subpanel glass-card" style={{ padding: '9px 12px', listStyle: 'none' }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 8) * .04 }} data-skill={s.id} data-status={s.status}>
      <div className="row" style={{ gap: 8 }}>
        <b style={{ fontSize: 13.5 }}>{s.name}</b><Chip hue={225} size="sm" className="tnum">v{s.version}</Chip>
        <Chip hue={S.hue} icon={S.icon} size="sm" solid={s.status === 'approved'}>{S.label}</Chip>
        <span className="dim" style={{ fontSize: 12 }}>{s.steps.length} steps · by {s.proposedByName} · {since(s.createdAt)}{s.approvedByName ? ` · approved by ${s.approvedByName}` : ''}</span>
        <span className="spacer" />
        {admin && s.status === 'draft' && <>
          <button className="btn sm primary" disabled={!api_ || !s.canDecide || busy} title={s.canDecide && api_ ? 'Approve this skill' : why ?? undefined} aria-label={`Approve skill ${s.name}`} onClick={() => run(() => approveSkill(s.id), `${s.name} approved`)}><Check size={13} />Approve</button>
          {!s.canDecide && <HelpTrigger k="playbook.decider" />}
        </>}
        {admin && s.status !== 'retired' && !retiring && <button className="btn sm ghost" disabled={!api_} title={!api_ ? DEMO_WHY : 'Retire: stays in the library'} aria-label={`Retire skill ${s.name}`} onClick={() => setRetiring(true)}><Archive size={13} />Retire</button>}
      </div>
      <div className="dim" style={{ fontSize: 12.5, margin: '4px 0' }}>{s.description}</div>
      <ol className="col" style={{ gap: 2, margin: '2px 0 4px', paddingLeft: 18, fontSize: 12.5 }} aria-label={`Steps of ${s.name}`}>{s.steps.map((st, i) => <li key={i} data-step-kind={st.kind}><StepLine st={st} /></li>)}</ol>
      <div className="row wrap" style={{ gap: 6 }}>
        {s.preconditions.length > 0 && <Chip hue={225} icon={Info} size="sm" title={s.preconditions.join(' | ')}>{s.preconditions.length} precondition{s.preconditions.length === 1 ? '' : 's'}</Chip>}
        <SourceChips sources={s.sources} />
        {s.status === 'retired' && <span className="dim" style={{ fontSize: 12 }}>retired{s.retireNote ? ` · “${s.retireNote}”` : ''}</span>}
      </div>
      {s.status === 'draft' && admin && !s.canDecide && api_ && s.cannotDecideWhy && <div className="dim row" style={{ gap: 6, fontSize: 11.5, marginTop: 6 }}><Lock size={12} aria-hidden />{s.cannotDecideWhy}</div>}
      {err && <div className="oa-banner" role="alert" style={{ marginTop: 6 }}><AlertOctagon size={15} /><span>{err}</span></div>}
      {retiring && (
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <input className="input" style={{ flex: 1, minWidth: 0, height: 32 }} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="Why (optional)" aria-label={`Reason for retiring ${s.name}`} data-autofocus />
          <button className="btn sm primary" disabled={busy} onClick={() => run(() => retireSkill(s.id, note), `${s.name} retired`)}><Archive size={13} />Confirm retire</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => setRetiring(false)}>Back</button>
        </div>
      )}
    </motion.li>
  );
}

type View = 'playbook' | 'candidates' | 'history' | 'skills';
const demoRead = <T,>(data: T): Read<T> => ({ data, error: null, retry: () => undefined });

/** Agents › Development: playbook, candidate lessons, version history and the skill library, in one panel. */
export function PlaybookPanel() {
  useAgentsCatalog();
  const api_ = isApi();
  const admin = isAdmin(useMe());
  const [agentId, setAgentId] = useState('coder-01');
  const [view, setView] = useState<View>('playbook');
  const agent = AGENT_BY_ID[agentId] ?? AGENTS[0];
  const pbR = usePlaybook(agentId), lsR = useLessons(agentId), skR = useSkills();
  const pb = api_ ? pbR : demoRead({ playbook: DEMO_PLAYBOOK(agent.id, agent.name, agent.role), versions: DEMO_VERSIONS });
  const ls = api_ ? lsR : demoRead(DEMO_LESSONS(agent.id, agent.name));
  const sk = api_ ? skR : demoRead(DEMO_SKILLS);
  const version = pb.data?.playbook.version ?? 0;
  const waiting = (ls.data ?? []).filter((l) => l.status === 'proposed');
  const decided = (ls.data ?? []).filter((l) => l.status !== 'proposed');
  const err = view === 'skills' ? sk.error : view === 'candidates' ? ls.error : pb.error;
  const retry = view === 'skills' ? sk.retry : view === 'candidates' ? ls.retry : pb.retry;
  const options = useMemo(() => [
    { key: 'playbook' as const, label: <><BookMarked size={13} />Playbook{pb.data ? ` v${version}` : ''}</> },
    { key: 'candidates' as const, label: <><ListChecks size={13} />Candidates ({waiting.length})</> },
    { key: 'history' as const, label: <><History size={13} />History ({pb.data?.versions.length ?? 0})</> },
    { key: 'skills' as const, label: <><Wand2 size={13} />Skills ({(sk.data ?? []).filter((s) => s.status === 'approved').length})</> },
  ], [pb.data, version, waiting.length, sk.data]);
  const loading = view === 'skills' ? !sk.data : view === 'candidates' ? !ls.data : !pb.data;
  return (
    <Panel icon={BookMarked} titleSize="lg" title="Playbooks and skills" help="playbook.panel" delay={.15} data-dev-playbooks={loading && !err ? 'loading' : err ? 'error' : 'ready'}
      sub="Reviewed lessons per agent role, with their evidence. Records only: no agent reads them yet."
      actions={<div className="row" style={{ gap: 6 }}>
        {!api_ && <span className="row" style={{ gap: 4 }} data-demo-tag><DemoTag title="DEMO samples: invented to show the layout" /><HelpTrigger k="playbook.demo" /></span>}
        {view === 'skills'
          ? <button className="btn primary" disabled={!api_} title={!api_ ? DEMO_WHY : undefined} onClick={() => openDialog('skill-propose')}><Plus size={15} />Propose a skill</button>
          : <button className="btn primary" disabled={!api_} title={!api_ ? DEMO_WHY : undefined} onClick={() => openDialog('lesson-propose', { agentId })}><Plus size={15} />Propose a lesson</button>}
        <HelpTrigger k={view === 'skills' ? 'skills.panel' : 'playbook.propose'} />
      </div>}>
      <div className="col" style={{ gap: 10 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <Segmented ariaLabel="Playbook view" size="sm" value={view} onChange={setView} options={options} />
          {view !== 'skills' && (
            <label className="row" style={{ gap: 6, fontSize: 12.5 }}>
              <span className="dim">Agent</span>
              <select className="select" aria-label="Agent" style={{ height: 30 }} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                {AGENTS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          )}
          <span className="spacer" />
          {!admin && api_ && <Chip hue={225} icon={Lock} size="sm" title="Anyone can propose; only administrators decide">Propose only</Chip>}
          <HelpTrigger k={view === 'playbook' ? 'playbook.current' : view === 'candidates' ? 'playbook.candidates' : view === 'history' ? 'playbook.history' : 'skills.panel'} />
        </div>
        {err && <div className="oa-banner" role="alert"><AlertOctagon size={15} /><span>Not loaded: {err}</span><button className="btn sm" onClick={retry}>Retry</button></div>}
        {loading && !err ? <LiveStatus className="dim" style={{ padding: 12 }}>Loading…</LiveStatus> : null}
        {!loading && view === 'playbook' && pb.data && (pb.data.playbook.items.length === 0
          ? <EmptyState icon={BookMarked} title={`No playbook for ${agent.name} yet`} body="A playbook starts with its first accepted lesson. Propose one with its evidence; a different administrator accepts it." />
          : <ol className="col" style={{ gap: 8, margin: 0, padding: 0 }} aria-label={`Playbook of ${agent.name}`} data-playbook-version-now={version}>{pb.data.playbook.items.map((it, i) => <ItemRow key={it.lessonId} it={it} n={i + 1} index={i} />)}</ol>)}
        {!loading && view === 'candidates' && ls.data && (waiting.length === 0 && decided.length === 0
          ? <EmptyState icon={ListChecks} title={`No candidate lessons for ${agent.name}`} body="Lessons wait here until a person other than the proposer accepts or rejects them." />
          : <ol className="col" style={{ gap: 8, margin: 0, padding: 0 }} aria-label="Candidate lessons"><AnimatePresence>
            {waiting.map((l, i) => <CandidateCard key={l.id} l={l} admin={admin} index={i} api_={api_} baseVersion={version} />)}
            {decided.slice(0, 4).map((l) => (
              <li key={l.id} className="row dim" style={{ gap: 8, fontSize: 12, listStyle: 'none', padding: '2px 4px' }} data-lesson={l.id} data-status={l.status}>
                {l.status === 'accepted' ? <CheckCircle2 size={14} style={{ color: 'var(--good)' }} aria-label="accepted" /> : <XCircle size={14} aria-label={l.status} />}
                <span className="ellipsis" style={{ flex: 1, minWidth: 0 }}>{l.text}</span><span>{l.status}{l.decidedByName ? ` by ${l.decidedByName}` : ''}{l.acceptedInVersion ? ` · v${l.acceptedInVersion}` : ''}{l.withdrawnInVersion ? ` · withdrawn in v${l.withdrawnInVersion}` : ''}</span>
              </li>))}
          </AnimatePresence></ol>)}
        {!loading && view === 'history' && pb.data && (pb.data.versions.length === 0
          ? <EmptyState icon={History} title="No versions yet" body="Every accepted lesson and every rollback adds a version. None is ever edited or deleted." />
          : <ol className="col" style={{ gap: 8, margin: 0, padding: 0 }} aria-label="Playbook versions">{pb.data.versions.map((v, i) => <VersionRow key={v.version} v={v} current={v.version === version} agentId={agentId} admin={admin} api_={api_} index={i} />)}</ol>)}
        {!loading && view === 'skills' && sk.data && (sk.data.length === 0
          ? <EmptyState icon={Wand2} title="No skills yet" body="A skill is a named list of plain steps with its sources. Propose one; another administrator approves it." />
          : <ol className="col" style={{ gap: 8, margin: 0, padding: 0 }} aria-label="Skill library"><AnimatePresence>{sk.data.map((s, i) => <SkillRow key={s.id} s={s} admin={admin} api_={api_} index={i} />)}</AnimatePresence></ol>)}
      </div>
    </Panel>
  );
}
