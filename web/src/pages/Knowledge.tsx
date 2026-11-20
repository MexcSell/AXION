import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen, Library, FlaskConical, Link2, Quote, Inbox, Search, Plus, ShieldCheck, Check, X, Pencil, Trash2, ScanSearch, AlertTriangle, ArrowRight, Sparkles, BrainCircuit,
  GitMerge, Clock, FileText, Globe, GitBranch, Lightbulb, Wrench, BadgeCheck, RefreshCw, ExternalLink, Save,
} from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Tabs } from '@/components/ui/Tabs';
import { Modal } from '@/components/ui/Modal';
import { Chip, DemoTag, Dot } from '@/components/ui/Chips';
import { EmptyState } from '@/components/ui/EmptyState';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Field, Segmented } from '@/components/ui/Form';
import { IconButton } from '@/components/ui/IconButton';
import { Donut, Legend } from '@/components/viz/Charts';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { AGENT_BY_ID } from '@/data/agents';
import { CITATIONS, useKnowledge, type KnowItem, type KnowType, type ResearchReq } from '@/data/knowledge';
import { KpiStrip } from '@/dialogs/defs/browser-results';
import { useData } from '@/store/data';
import { useTab } from '@/hooks/useTab';
import { openDialog, toast } from '@/store/ui';
import { ago, cx } from '@/lib/format';
import '@/theme/pages/browser-results-knowledge.css';

const TYPE_META: Record<KnowType, { hue: number; icon: typeof BookOpen; label: string }> = {
  guide: { hue: 215, icon: BookOpen, label: 'Verified guide' }, lesson: { hue: 160, icon: Lightbulb, label: 'Task lesson' }, fact: { hue: 270, icon: FileText, label: 'Reusable fact' }, skill: { hue: 35, icon: Wrench, label: 'Skill' },
};

export default function KnowledgePage() {
  const [tab, setTab, tabs] = useTab('knowledge');
  const ICONS = [Library, FlaskConical, Globe, Quote, Inbox];
  const items = useKnowledge((s) => s.items);
  const queue = useKnowledge((s) => s.queue);
  const sources = useKnowledge((s) => s.sources);
  const unsupported = CITATIONS.filter((c) => !c.supported).length;
  const kpis = [
    { icon: BookOpen, value: items.length, label: 'Knowledge Items', color: '#22d3ee', delta: '+4' },
    { icon: Inbox, value: queue.length, label: 'In Learning Queue', color: '#fbbf24' },
    { icon: Globe, value: sources.filter((s) => s.trust !== 'untrusted').length, label: 'Trusted Sources', color: '#3b82f6' },
    { icon: AlertTriangle, value: unsupported, label: 'Unsupported Claims', color: '#fb5a78' },
    { icon: BadgeCheck, value: Math.round(items.reduce((n, i) => n + i.trust, 0) / Math.max(1, items.length)), suffix: '%', label: 'Average Trust', color: '#2ee98a', delta: '+1.2%' },
  ];
  return (
    <div className="page">
      <Panel icon={BookOpen} titleSize="lg" title="Knowledge" help="knowledge.library" sub="Verified lessons, sources and citations. Website text stays evidence, never instructions." delay={.02} className="brk-head-glow"
        actions={<div className="row" style={{ gap: 10 }}><DemoTag /><button className="btn primary" onClick={() => openDialog('knowledge-ingest')}><Plus size={16} />Ingest Source</button></div>}>
        <KpiStrip items={kpis} />
      </Panel>
      <Panel delay={.1} tight>
        <div className="row wrap" style={{ gap: 10, marginBottom: 12 }}>
          <Tabs size="sm" variant="underline" tabs={tabs.map((t, i) => ({ key: t, label: t, icon: ICONS[i], count: t === 'Learning Queue' ? queue.length : undefined }))} value={tab} onChange={setTab} ariaLabel="Knowledge views" />
          <span className="spacer" />
          <span className="muted" style={{ fontSize: 12.5 }}>{{ Library: 'Guides, lessons, facts and skills with expiry and scope.', Research: 'Research requests and agent findings.', Sources: 'Approved domains, repositories and files.', Citations: 'Statement, source span, content hash, retrieval date.', 'Learning Queue': 'A reviewer accepts, edits or rejects proposed memory.' }[tab]}</span>
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .2 }} role="tabpanel" aria-label={tab}>
            {tab === 'Library' && <LibraryTab />}
            {tab === 'Research' && <ResearchTab />}
            {tab === 'Sources' && <SourcesTab />}
            {tab === 'Citations' && <CitationsTab />}
            {tab === 'Learning Queue' && <QueueTab />}
          </motion.div>
        </AnimatePresence>
      </Panel>
      <div className="brk-bottom">
        <ScopePanel />
        <FreshPanel />
        <PolicyPanel />
      </div>
    </div>
  );
}

const hl = (text: string, q: string): ReactNode => {
  if (!q.trim()) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  return i < 0 ? text : <>{text.slice(0, i)}<mark className="kn-hit">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
};
function TrustRing({ v }: { v: number }) {
  const c = v >= 90 ? 'var(--good)' : v >= 75 ? 'var(--warn)' : 'var(--bad)';
  return <span className="kn-ring" style={{ ['--p' as string]: v, ['--c' as string]: c }} title={`Trust ${v}%`}><span>{v}</span></span>;
}

/* ---------------------------------------------------------------- */
function LibraryTab() {
  const items = useKnowledge((s) => s.items);
  const [q, setQ] = useState('');
  const [type, setType] = useState<KnowType | 'all'>('all');
  const [mode, setMode] = useState<'text' | 'semantic'>('text');
  const [sel, setSel] = useState<KnowItem | null>(null);
  const list = useMemo(() => {
    const f = items.filter((i) => (type === 'all' || i.type === type) && (mode === 'semantic' ? true : (i.title + i.summary + i.tags.join(' ')).toLowerCase().includes(q.toLowerCase())));
    if (mode === 'semantic' && q.trim()) { const w = q.toLowerCase().split(/\s+/); return [...f].map((i) => ({ i, s: w.reduce((n, x) => n + ((i.title + i.summary + i.tags.join(' ')).toLowerCase().includes(x) ? 1 : 0), 0) + i.trust / 1000 })).sort((a, b) => b.s - a.s).map((x) => x.i); }
    return f;
  }, [items, q, type, mode]);
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="input-wrap" style={{ width: 300 }}><Search size={15} /><input className="input" placeholder={mode === 'text' ? 'Full-text search' : 'Describe what you need (semantic)'} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search knowledge" /></div>
        <Segmented ariaLabel="Search mode" size="sm" value={mode} onChange={setMode} options={[{ key: 'text', label: 'Full-text' }, { key: 'semantic', label: <><Sparkles size={12} />Semantic</> }]} />
        <div className="brk-pillrow">
          {(['all', 'guide', 'lesson', 'fact', 'skill'] as const).map((t) => <button key={t} className={cx('chip pill', type === t && 'solid')} style={{ cursor: 'pointer', height: 26, ['--h' as string]: t === 'all' ? 215 : TYPE_META[t].hue }} onClick={() => setType(t)}>{t === 'all' ? `All (${items.length})` : t}</button>)}
        </div>
        <span className="spacer" /><HelpTrigger k="knowledge.library" />
      </div>
      {list.length === 0 ? <EmptyState icon={Library} title="No knowledge matches" body="Try different words or ingest a new source." action={<button className="btn" onClick={() => { setQ(''); setType('all'); }}>Clear</button>} /> : (
        <div className="grid g-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          <AnimatePresence mode="popLayout">
            {list.map((k, i) => {
              const M = TYPE_META[k.type];
              return (
                <motion.div key={k.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: .95 }} transition={{ delay: Math.min(i, 10) * .04 }} className="subpanel glass-card hoverable kn-card" style={{ ['--h' as string]: M.hue, cursor: 'pointer' }} onClick={() => setSel(k)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setSel(k); }}>
                  <div className="row" style={{ gap: 10 }}>
                    <TrustRing v={k.trust} />
                    <div style={{ minWidth: 0, flex: 1 }}><b className="clamp-2" style={{ fontSize: 13.5, lineHeight: 1.3 }}>{hl(k.title, mode === 'text' ? q : '')}</b></div>
                  </div>
                  <div className="clamp-2 muted" style={{ fontSize: 12 }}>{k.summary}</div>
                  <div className="row wrap" style={{ gap: 6 }}><Chip hue={M.hue} size="sm"><M.icon size={10} />{k.type}</Chip><Chip hue={215} size="sm">{k.scope}</Chip><span className="spacer" /><span className={k.expiresDays < 30 ? 'warn' : 'dim'} style={{ fontSize: 11 }}><Clock size={10} style={{ display: 'inline' }} /> {k.expiresDays > 900 ? 'no expiry' : `${k.expiresDays} d`}</span></div>
                  <div className="dim ellipsis" style={{ fontSize: 11 }}>{k.source} · {k.uses} uses · {ago(k.updatedMin)}</div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
      <AnimatePresence>{sel && <Inspect k={sel} onClose={() => setSel(null)} />}</AnimatePresence>
    </div>
  );
}
function Inspect({ k, onClose }: { k: KnowItem; onClose: () => void }) {
  const nav = useNavigate();
  return (
    <Modal title={k.title} icon={BookOpen} help="knowledge.library" size="md" sub={`${k.id} · ${TYPE_META[k.type].label}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn" onClick={() => { onClose(); nav('/knowledge?tab=citations'); }}><Quote size={14} />View citations</button><button className="btn primary" data-autofocus onClick={() => { toast({ tone: 'success', title: 'Attached to mission context (demo)', body: 'Scope rules still apply.' }); onClose(); }}>Use in mission</button></>}>
      <p style={{ margin: 0 }}>{k.summary}</p>
      <dl className="kv" style={{ margin: 0 }}><dt>Trust</dt><dd><TrustRing v={k.trust} /></dd><dt>Scope</dt><dd>{k.scope}</dd><dt>Source</dt><dd>{k.source}</dd><dt>Expires</dt><dd>{k.expiresDays > 900 ? 'never' : `in ${k.expiresDays} days`}</dd><dt>Used</dt><dd>{k.uses} times</dd></dl>
      <div className="brk-pillrow">{k.tags.map((t) => <span key={t} className="badge">{t}</span>)}</div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- */
const R_STATES: ResearchReq['state'][] = ['queued', 'running', 'review', 'done'];
function ResearchTab() {
  const research = useKnowledge((s) => s.research);
  const addResearch = useKnowledge((s) => s.addResearch);
  const nav = useNavigate();
  const missions = useData((s) => s.missions);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [mid, setMid] = useState('M-130');
  const [touched, setTouched] = useState(false);
  const submit = () => { setTouched(true); if (title.trim().length < 6) return; addResearch({ id: `RS-${75 + research.length}`, title: title.trim(), agentId: 'researcher-01', state: 'queued', confidence: 0, sources: 0, findings: 0, ageMin: 0, missionId: mid }); toast({ tone: 'success', title: 'Research mission queued (demo)', body: 'Researcher-01 will cite every finding.' }); setOpen(false); setTitle(''); setTouched(false); };
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row"><span className="muted" style={{ fontSize: 13 }}>Agents gather evidence from approved sources. Low-confidence findings stay out of the library until reviewed.</span><HelpTrigger k="knowledge.research" /><span className="spacer" /><button className="btn primary" onClick={() => setOpen(true)}><Plus size={14} />Submit research mission</button></div>
      <div className="grid g-2">
        <AnimatePresence initial={false}>
          {research.map((r, i) => {
            const a = AGENT_BY_ID[r.agentId];
            const idx = R_STATES.indexOf(r.state);
            return (
              <motion.div key={r.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .05 }} className="subpanel glass-card hoverable col" style={{ gap: 10, padding: 14 }}>
                <div className="row" style={{ gap: 10 }}>{a && <RobotAvatar role={a.role} size={34} />}<div style={{ minWidth: 0, flex: 1 }}><b className="ellipsis" style={{ display: 'block' }}>{r.title}</b><span className="dim" style={{ fontSize: 11.5 }}>{r.id} · {a?.name} · {r.missionId} · {ago(r.ageMin)}</span></div><Chip hue={r.state === 'done' ? 150 : r.state === 'running' ? 200 : r.state === 'review' ? 40 : 260} size="sm">{r.state === 'running' && <Dot tone="info" pulse />}{r.state}</Chip></div>
                <div className="row" style={{ gap: 4 }}>{R_STATES.map((s, k) => <div key={s} className="grow" style={{ position: 'relative' }}><div className="bar thin"><motion.i initial={{ width: 0 }} animate={{ width: k < idx ? '100%' : k === idx ? (r.state === 'done' ? '100%' : '55%') : 0 }} transition={{ delay: .2 + k * .12, duration: .6 }} /></div><span className="dim" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>{s}</span></div>)}</div>
                <div className="row" style={{ gap: 14, fontSize: 12 }}>
                  <span><b>{r.findings}</b> <span className="muted">findings</span></span><span><b>{r.sources}</b> <span className="muted">sources</span></span>
                  <span className="spacer" />{r.confidence > 0 && <span className="row" style={{ gap: 6 }}><span className="muted">confidence</span><b className={r.confidence >= 85 ? 'good' : 'warn'}>{r.confidence}%</b></span>}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm" disabled={!r.findings} onClick={() => nav('/knowledge?tab=citations')}><Link2 size={13} />Follow evidence</button>
                  {r.state === 'review' && <button className="btn sm good" onClick={() => toast({ tone: 'success', title: 'Findings sent to Learning Queue (demo)' })}><Check size={13} />Promote findings</button>}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {open && (
          <Modal title="Submit research mission" icon={FlaskConical} help="knowledge.research" size="sm" onClose={() => setOpen(false)}
            footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn primary" onClick={submit}>Queue research</button></>}>
            <Field label="Question" required error={touched && title.trim().length < 6 ? 'Describe the question (at least 6 characters).' : ''}><input className="input" data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. How do competitors price onboarding?" aria-label="Research question" /></Field>
            <Field label="Mission"><select className="select" value={mid} onChange={(e) => setMid(e.target.value)} aria-label="Mission">{missions.filter((m) => m.status !== 'archived').map((m) => <option key={m.id} value={m.id}>{m.id} · {m.title}</option>)}</select></Field>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------------------------------------------------------- */
function SourcesTab() {
  const sources = useKnowledge((s) => s.sources);
  const remove = useKnowledge((s) => s.removeSource);
  const [scanning, setScanning] = useState<string | null>(null);
  const segs = [{ label: 'Verified', value: sources.filter((s) => s.trust === 'verified').length, color: '#2ee98a' }, { label: 'Reviewed', value: sources.filter((s) => s.trust === 'reviewed').length, color: '#38bdf8' }, { label: 'Untrusted', value: sources.filter((s) => s.trust === 'untrusted').length, color: '#fbbf24' }];
  const KI = { domain: Globe, repo: GitBranch, file: FileText };
  return (
    <div className="brk-split">
      <div className="col" style={{ gap: 10 }}>
        <div className="row"><span className="muted" style={{ fontSize: 13 }}>Only approved sources feed agents. Untrusted content is quoted as evidence and never obeyed.</span><HelpTrigger k="knowledge.sources" /><span className="spacer" /><button className="btn primary" onClick={() => openDialog('knowledge-ingest')}><Plus size={14} />Add source</button></div>
        <div className="table-wrap brk-scroll"><table className="table"><thead><tr><th>Source</th><th>Kind</th><th>Trust</th><th>Relevance</th><th>Docs</th><th>Last scan</th><th /></tr></thead><tbody>
          <AnimatePresence initial={false}>{sources.map((s, i) => { const I = KI[s.kind]; return (
            <motion.tr key={s.id} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }} transition={{ delay: Math.min(i, 8) * .03 }}>
              <td><span className="row" style={{ gap: 8 }}><I size={14} className="info" /><span className="mono" style={{ fontSize: 12 }}>{s.label}</span></span></td>
              <td className="dim">{s.kind}</td>
              <td><Chip hue={s.trust === 'verified' ? 150 : s.trust === 'reviewed' ? 200 : 40} size="sm">{s.trust}</Chip></td>
              <td style={{ width: 120 }}><div className="row" style={{ gap: 6 }}><div className="bar thin grow"><motion.i initial={{ width: 0 }} animate={{ width: `${s.relevance}%` }} transition={{ duration: .8 }} /></div><span className="tnum" style={{ fontSize: 11 }}>{s.relevance}</span></div></td>
              <td className="tnum">{s.docs}</td>
              <td className="dim">{scanning === s.id ? <span className="info">scanning…</span> : s.scanMin ? ago(s.scanMin) : 'queued'}</td>
              <td style={{ whiteSpace: 'nowrap' }}><IconButton icon={RefreshCw} label="Rescan (goes to review)" size="sm" onClick={() => { setScanning(s.id); window.setTimeout(() => { setScanning(null); toast({ tone: 'info', title: `Rescan of ${s.label} queued for review (demo)` }); }, 900); }} /><IconButton icon={Trash2} label="Remove source" size="sm" variant="danger" onClick={() => { remove(s.id); toast({ tone: 'warning', title: `${s.label} removed (demo)`, body: 'Existing citations keep their hashes.' }); }} /></td>
            </motion.tr>); })}</AnimatePresence>
        </tbody></table></div>
        {sources.length === 0 && <EmptyState icon={Globe} title="No sources" body="Add an approved domain, repository or file." />}
      </div>
      <div className="subpanel col" style={{ gap: 12 }}>
        <div className="row"><b>Trust mix</b><HelpTrigger k="knowledge.trust" /></div>
        <div className="row" style={{ gap: 14 }}><Donut segs={segs} size={112} stroke={13} center={String(sources.length)} sub="sources" /><Legend segs={segs} total={sources.length} /></div>
        <div className="brk-warnbox info"><ShieldCheck size={16} className="info" /><div>Fetched pages pass a prompt-injection screen before agents see them.</div></div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
function CitationsTab() {
  const [flag, setFlag] = useState(false);
  const [audit, setAudit] = useState<'idle' | 'running' | 'done'>('idle');
  const run = () => { setAudit('running'); window.setTimeout(() => { setAudit('done'); setFlag(true); toast({ tone: 'warning', title: `Audit complete: ${CITATIONS.filter((c) => !c.supported).length} unsupported claim`, body: 'Flagged for reviewer follow-up (demo).' }); }, 1200); };
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="kn-flow"><span className="node">Statement</span><ArrowRight size={13} className="dim" /><span className="node">Source span</span><ArrowRight size={13} className="dim" /><span className="node">Content hash</span><ArrowRight size={13} className="dim" /><span className="node">Retrieved</span></div>
        <HelpTrigger k="knowledge.citations" /><span className="spacer" />
        <button className="btn" disabled={audit === 'running'} onClick={run}><ScanSearch size={14} />{audit === 'running' ? 'Auditing…' : 'Audit unsupported claims'}</button>
      </div>
      {audit === 'running' && <div className="bar thin"><motion.i initial={{ width: 0 }} animate={{ width: '100%' }} transition={{ duration: 1.1 }} /></div>}
      <div className="col" style={{ gap: 8 }}>
        {CITATIONS.map((c, i) => (
          <motion.div key={c.id} className="subpanel glass-card kn-cite" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * .06 }} style={{ borderColor: !c.supported && flag ? 'rgba(var(--bad-rgb), .6)' : undefined, boxShadow: !c.supported && flag ? '0 0 18px rgba(var(--bad-rgb), .25)' : undefined }}>
            {c.supported ? <Check size={18} className="good" /> : <AlertTriangle size={18} className="bad" />}
            <div style={{ minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.statement}</div><div className="dim mono ellipsis" style={{ fontSize: 11 }}>{c.source}</div></div>
            <div style={{ minWidth: 0, fontSize: 12 }}><div className={c.supported ? 'muted' : 'bad'}>{c.span}</div><div className="mono dim" style={{ fontSize: 11 }}>{c.hash} · {ago(c.retrievedMin)}</div></div>
            <div className="row" style={{ gap: 6 }}><IconButton icon={ExternalLink} label="Open source in viewer" size="sm" onClick={() => toast({ tone: 'info', title: 'Source snapshot opened (demo)', body: c.source })} />{!c.supported && <button className="btn sm danger" onClick={() => toast({ tone: 'warning', title: 'Claim removed from drafts (demo)' })}>Remove claim</button>}</div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
function QueueTab() {
  const queue = useKnowledge((s) => s.queue);
  const decide = useKnowledge((s) => s.decide);
  const edit = useKnowledge((s) => s.edit);
  const decided = useKnowledge((s) => s.decided);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [flash, setFlash] = useState<Record<string, 'accepted' | 'rejected'>>({});
  const act = (id: string, d: 'accepted' | 'rejected') => {
    setFlash((f) => ({ ...f, [id]: d }));
    window.setTimeout(() => { decide(id, d); toast({ tone: d === 'accepted' ? 'success' : 'info', title: d === 'accepted' ? 'Lesson accepted into the library (demo)' : 'Lesson rejected (demo)', body: d === 'accepted' ? 'Provenance and scope were recorded.' : 'The agent is notified; it will not reappear.' }); }, 420);
  };
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <span className="muted" style={{ fontSize: 13 }}>Lessons proposed from missions. Mission-private memory is never shared automatically.</span><HelpTrigger k="knowledge.queue" /><span className="spacer" />
        <Chip hue={150}>{decided.filter((d) => d.d === 'accepted').length} accepted</Chip><Chip hue={350}>{decided.filter((d) => d.d === 'rejected').length} rejected</Chip><Chip hue={40}>{queue.length} waiting</Chip>
      </div>
      <div className="col" style={{ gap: 8 }}>
        <AnimatePresence mode="popLayout">
          {queue.map((q) => {
            const a = AGENT_BY_ID[q.agentId];
            const f = flash[q.id];
            return (
              <motion.div key={q.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, backgroundColor: f === 'accepted' ? 'rgba(46,233,138,.18)' : f === 'rejected' ? 'rgba(251,90,120,.18)' : undefined }} exit={{ opacity: 0, x: f === 'rejected' ? -120 : 120, scale: .96, height: 0, marginBottom: -8 }} transition={{ duration: .35 }} className="subpanel glass-card kn-lq">
                <div className="col" style={{ gap: 6, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}>{a && <RobotAvatar role={a.role} size={28} />}<span className="mono dim" style={{ fontSize: 11 }}>{q.id} · {q.missionId} · {a?.name}</span><span className="spacer" /><span className="row" style={{ gap: 6, fontSize: 11.5 }}><span className="muted">confidence</span><TrustRing v={q.confidence} /></span></div>
                  {editing === q.id ? (
                    <div className="col" style={{ gap: 6 }}><textarea className="textarea" rows={2} data-autofocus value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Edit lesson" /><div className="row" style={{ gap: 6 }}><button className="btn sm primary" disabled={draft.trim().length < 8} onClick={() => { edit(q.id, draft.trim()); setEditing(null); toast({ tone: 'success', title: 'Lesson text updated (demo)' }); }}><Save size={13} />Save edit</button><button className="btn sm ghost" onClick={() => setEditing(null)}>Cancel</button></div></div>
                  ) : <div style={{ fontSize: 13.5, fontWeight: 600 }}>{q.lesson}</div>}
                  <div className="row wrap" style={{ gap: 6 }}>
                    <Chip hue={215} size="sm">{q.evidence} evidence runs</Chip><Chip hue={270} size="sm">{q.scope}</Chip>
                    {q.dup && <Chip hue={200} size="sm" icon={GitMerge} title="Similar knowledge already exists">duplicate of {q.dup}</Chip>}
                    {q.conflict && <Chip hue={30} size="sm" icon={AlertTriangle} title={q.conflict}>contradiction</Chip>}
                  </div>
                  {q.conflict && <span className="warn" style={{ fontSize: 11.5 }}>{q.conflict}</span>}
                </div>
                <div className="col" style={{ gap: 6 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn sm good" disabled={!!f} onClick={() => act(q.id, 'accepted')}><Check size={14} />Accept</button>
                    <button className="btn sm" disabled={!!f} onClick={() => { setEditing(q.id); setDraft(q.lesson); }}><Pencil size={14} />Edit</button>
                    <button className="btn sm danger" disabled={!!f} onClick={() => act(q.id, 'rejected')}><X size={14} />Reject</button>
                  </div>
                  <button className="btn sm ghost" onClick={() => openDialog('experience-promotion', { itemId: q.id })}><BrainCircuit size={13} />Full review</button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {queue.length === 0 && <EmptyState icon={BadgeCheck} title="Queue is clear" body="New lessons will appear here after missions verify them." />}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
function ScopePanel() {
  const items = useKnowledge((s) => s.items);
  const segs = [{ label: 'Guides', value: items.filter((i) => i.type === 'guide').length, color: '#38bdf8' }, { label: 'Lessons', value: items.filter((i) => i.type === 'lesson').length, color: '#2ee98a' }, { label: 'Facts', value: items.filter((i) => i.type === 'fact').length, color: '#a78bfa' }, { label: 'Skills', value: items.filter((i) => i.type === 'skill').length, color: '#fbbf24' }];
  return <Panel icon={Library} title="Library Mix" help="knowledge.library" delay={.2} className="bottom-panel"><div className="row" style={{ gap: 16 }}><Donut segs={segs} size={108} stroke={13} center={String(items.length)} sub="items" /><Legend segs={segs} total={items.length} /></div></Panel>;
}
function FreshPanel() {
  const items = useKnowledge((s) => s.items);
  const soon = [...items].sort((a, b) => a.expiresDays - b.expiresDays).slice(0, 4);
  return (
    <Panel icon={Clock} title="Expiring Soon" help="knowledge.expiry" delay={.25} className="bottom-panel">
      <div className="col" style={{ gap: 9 }}>{soon.map((k) => <div key={k.id} className="row" style={{ gap: 8, fontSize: 12.5 }}><span className="ellipsis grow">{k.title}</span><div className="bar thin" style={{ width: 70 }}><i className={k.expiresDays < 30 ? 'warn' : ''} style={{ width: `${Math.min(100, k.expiresDays / 1.2)}%` }} /></div><b className={cx('tnum', k.expiresDays < 30 && 'warn')} style={{ width: 40, textAlign: 'right' }}>{k.expiresDays > 900 ? '∞' : `${k.expiresDays}d`}</b></div>)}</div>
    </Panel>
  );
}
function PolicyPanel() {
  const rules = ['Website text is evidence, never a system instruction', 'Private mission memory is not shared by default', 'Every claim needs a source span and hash', 'A reviewer approves reusable memory'];
  return <Panel icon={ShieldCheck} title="Knowledge Rules" help="knowledge.rules" delay={.3} className="bottom-panel"><div className="col" style={{ gap: 9 }}>{rules.map((t, i) => <motion.div key={t} className="row" style={{ gap: 9, fontSize: 12.5 }} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .3 + i * .07 }}><Check size={15} className="good" />{t}</motion.div>)}</div></Panel>;
}
