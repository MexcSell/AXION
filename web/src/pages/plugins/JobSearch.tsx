import { AnimatePresence, motion } from 'motion/react';
import { LiveStatus } from '@/components/ui/LiveStatus';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Briefcase, Globe, Plus, Pause, Play, Trash2, Search, FileText, Image as ImageIcon, File as FileIcon, Upload, Send, Trophy, XCircle, Clock3, PenLine,
  Eye, MousePointer2, Lock, RefreshCw, ArrowLeft, ArrowRight, Sparkles, UserRound, Target, BookOpen, CheckCircle2, CircleDot, SkipForward, Radar, ExternalLink,
} from 'lucide-react';
import { TopBoard, FrameBody } from '@/components/layout/PageFrame';
import { Panel } from '@/components/ui/Panel';
import { Chip } from '@/components/ui/Chips';
import { Tip } from '@/components/ui/Tip';
import { IconButton } from '@/components/ui/IconButton';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { EmptyState } from '@/components/ui/EmptyState';
import { Segmented } from '@/components/ui/Form';
import { Splitter, usePaneWidth } from '@/components/ui/Splitter';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { useTab } from '@/hooks/useTab';
import { AGENT_BY_ID } from '@/data/agents';
import { useJobs, type Job, type JobSite, type JobStatus, type ProfileDoc, type InvestigationStep } from '@/store/jobs';
import { channelId } from '@/store/chat';
import { useMe } from '@/store/auth';
import { toast, openDialog } from '@/store/ui';
import { ChannelChat } from '@/features/chat/ChannelChat';
import { agoFromTs, cx } from '@/lib/format';
import '@/theme/pages/job-search.css';

/*
 * Job Search — a plug-in app (rail bottom section), built on the former Browser Studio (owner update 2026-11-20 u1).
 *   Investigate: added job sites | live preview of the site with the investigation process | mobilized agents + chat
 *   Jobs:        every job the agents researched, whether the bid succeeded, and the profile used for it
 *   Profile:     documents and free text the agents tailor for each bid
 */
const STATUS: Record<JobStatus, { label: string; hue: number; icon: typeof Send }> = {
  found: { label: 'Found', hue: 210, icon: Eye }, drafting: { label: 'Drafting bid', hue: 38, icon: PenLine }, bid: { label: 'Bid sent', hue: 268, icon: Send },
  won: { label: 'Won', hue: 145, icon: Trophy }, lost: { label: 'Not selected', hue: 350, icon: XCircle }, skipped: { label: 'Skipped', hue: 225, icon: SkipForward },
};
const STEP_ICON: Record<InvestigationStep['kind'], typeof Eye> = { open: Globe, read: Eye, match: Target, draft: PenLine, bid: Send, result: Trophy, learn: BookOpen };
const ICONS = [Radar, Briefcase, UserRound];

/** Simulation driver: every scanning site advances while the plug-in is open. */
function useInvestigation() {
  const sites = useJobs((s) => s.sites);
  const tick = useJobs((s) => s.tick);
  useEffect(() => {
    const t = window.setInterval(() => { for (const s of useJobs.getState().sites) if (s.state === 'scanning') tick(s.id); }, 2600);
    return () => window.clearInterval(t);
  }, [tick, sites.length]);
}

export default function JobSearchPage() {
  const [tab, setTab, tabs] = useTab('jobSearch');
  const jobs = useJobs((s) => s.jobs);
  const sites = useJobs((s) => s.sites);
  useInvestigation();
  const bids = jobs.filter((j) => ['bid', 'won', 'lost'].includes(j.status));
  const won = jobs.filter((j) => j.status === 'won').length;
  const decided = jobs.filter((j) => j.status === 'won' || j.status === 'lost').length;
  return (
    <div className="page js-page">
      <TopBoard id="job-search" icon={Briefcase} title="Job Search" help="jobs.page" sub="Add job sites. Agents investigate them, find matching jobs and bid with your profile, tailored to each job."
        actions={<Chip hue={268}>plug-in · v2.0.0</Chip>}
        kpis={[
          { key: 'sites', icon: Globe, value: sites.length, label: 'Job sites', hint: `${sites.filter((s) => s.state === 'scanning').length} being investigated`, color: '#22d3ee', help: 'jobs.sites', onClick: () => setTab('Investigate') },
          { key: 'found', icon: Eye, value: jobs.length, label: 'Jobs researched', hint: `${jobs.filter((j) => j.status === 'found').length} waiting for a decision`, color: '#3b82f6', help: 'jobs.jobs', onClick: () => setTab('Jobs') },
          { key: 'bids', icon: Send, value: bids.length, label: 'Bids sent', hint: `${jobs.filter((j) => j.status === 'drafting').length} drafting now`, color: '#a78bfa', help: 'jobs.bid', onClick: () => setTab('Jobs') },
          { key: 'won', icon: Trophy, value: won, label: 'Won', hint: decided ? `${Math.round((won / decided) * 100)}% of decided bids` : 'no answers yet', color: '#2ee98a', help: 'jobs.jobs', onClick: () => setTab('Jobs') },
        ]}
        tabs={{ tabs, value: tab, onChange: setTab, icons: ICONS, ariaLabel: 'Job Search views', counts: { Jobs: jobs.length } }}
        toolbar={<span>{{ Investigate: 'Pick a site to watch the agents work on it live.', Jobs: 'Every researched job, its bid and the profile used.', Profile: 'What the agents tailor for each bid.' }[tab]}</span>} />
      <FrameBody tab={tab} panel={tab !== 'Investigate'} scroll={tab !== 'Investigate'} className={tab === 'Investigate' ? 'js-fill' : undefined}>
        {tab === 'Investigate' && <Investigate />}
        {tab === 'Jobs' && <JobsTab />}
        {tab === 'Profile' && <ProfileTab />}
      </FrameBody>
    </div>
  );
}

/* ================================================================== Investigate */
function Investigate() {
  const sites = useJobs((s) => s.sites);
  const [sp, setSp] = useSearchParams();
  const sel = sites.find((s) => s.id === sp.get('site')) ?? sites[0];
  const setSel = (id: string) => setSp((p) => { const n = new URLSearchParams(p); n.set('site', id); return n; }, { replace: true });
  const [leftW, setLeftW, resetLeft] = usePaneWidth('jobs.sites', 270);
  const [rightW, setRightW, resetRight] = usePaneWidth('jobs.agents', 380);
  return (
    <div className="js-split">
      <aside className="panel js-sites" style={{ ['--pane-w' as string]: `${leftW}px` }} aria-label="Job sites"><SitesPane sel={sel} onSel={setSel} /></aside>
      <Splitter pane="prev" width={leftW} onChange={setLeftW} onReset={resetLeft} min={220} maxFrac={.3} label="Resize job sites" />
      <section className="panel js-preview" aria-label="Site preview">{sel ? <Preview site={sel} /> : <EmptyState icon={Globe} title="Add a job site" body="Paste a job site address on the left. Its agent starts investigating right away." />}</section>
      <Splitter pane="next" width={rightW} onChange={setRightW} onReset={resetRight} min={300} maxFrac={.38} label="Resize agents and chat" />
      <aside className="panel js-agents" style={{ ['--pane-w' as string]: `${rightW}px` }} aria-label="Mobilized agents">{sel && <AgentsPane site={sel} />}</aside>
    </div>
  );
}

function SitesPane({ sel, onSel }: { sel?: JobSite; onSel: (id: string) => void }) {
  const sites = useJobs((s) => s.sites);
  const jobs = useJobs((s) => s.jobs);
  const { addSite, setSiteState, removeSite } = useJobs();
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const r = addSite(url);
    if (!r.ok) { setErr(r.error); return; }
    setUrl(''); setErr(''); onSel(r.site.id);
    toast({ tone: 'success', title: `${r.site.domain} added`, body: `${AGENT_BY_ID[r.site.agentId]?.name} started investigating it.` });
  };
  return (
    <div className="js-sites-in">
      <div className="js-pane-h"><Globe size={15} className="info" /><b>Job sites</b><HelpTrigger k="jobs.sites" /><span className="spacer" /><span className="dim tnum" style={{ fontSize: 12 }}>{sites.length}</span></div>
      <form className="js-add" onSubmit={add}>
        <div className="input-wrap grow"><Plus size={14} /><input className="input" value={url} onChange={(e) => { setUrl(e.target.value); setErr(''); }} placeholder="Add a site URL…" aria-label="Job site URL" /></div>
        <IconButton size="sm" variant="active" icon={Search} label="Add site and start searching" type="submit" disabled={!url.trim()} />
      </form>
      <AnimatePresence>{err && <motion.div className="field-error" style={{ fontSize: 12 }} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} role="alert">{err}</motion.div>}</AnimatePresence>
      <div className="js-site-list fit-scroll" role="listbox" aria-label="Job sites">
        <AnimatePresence initial={false}>
          {sites.map((s, i) => {
            const mine = jobs.filter((j) => j.siteId === s.id);
            const ag = AGENT_BY_ID[s.agentId];
            const on = s.id === sel?.id;
            return (
              <motion.div key={s.id} layout role="option" aria-selected={on} tabIndex={0} className={cx('js-site', on && 'on', s.state)}
                initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ delay: i * .03 }}
                onClick={() => onSel(s.id)} onKeyDown={(e) => { if (e.key === 'Enter') onSel(s.id); }}>
                {on && <motion.span layoutId="js-site-sel" className="js-site-sel" />}
                <span className="js-fav" style={{ ['--h' as string]: (s.domain.charCodeAt(0) * 37) % 360 }}>{s.name[0]}</span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <b className="ellipsis">{s.domain}</b>
                  <div className="dim ellipsis" style={{ fontSize: 11.5 }}>{mine.length} jobs · {mine.filter((j) => ['bid', 'won', 'lost'].includes(j.status)).length} bids · {ag?.name}</div>
                </div>
                <span className={cx('js-state', s.state)} title={s.state}>{s.state === 'scanning' ? <Radar size={13} /> : s.state === 'paused' ? <Pause size={12} /> : <CircleDot size={12} />}</span>
                <span className="js-site-act">
                  <IconButton size="xs" icon={s.state === 'scanning' ? Pause : Play} label={s.state === 'scanning' ? `Pause ${s.domain}` : `Start ${s.domain}`} onClick={(e) => { e.stopPropagation(); setSiteState(s.id, s.state === 'scanning' ? 'paused' : 'scanning'); }} />
                  <IconButton size="xs" icon={Trash2} label={`Remove ${s.domain}`} onClick={(e) => { e.stopPropagation(); removeSite(s.id); toast({ tone: 'info', title: `${s.domain} removed`, body: 'Its jobs were removed too.' }); }} />
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      <div className="js-note dim"><Lock size={12} /> Agents only read the sites you add. A bid is submitted with your tailored profile; you can pause any site.</div>
    </div>
  );
}

/** A live preview of the site the agent is working on: browser chrome, a job board, a moving cursor and the current step. */
function Preview({ site }: { site: JobSite }) {
  const jobs = useJobs((s) => s.jobs).filter((j) => j.siteId === site.id).slice(0, 6);
  const steps = useJobs((s) => s.steps).filter((x) => x.siteId === site.id).slice(-14).reverse();
  const last = steps[0];
  const [focus, setFocus] = useState(0);
  useEffect(() => { if (site.state !== 'scanning') return; const t = window.setInterval(() => setFocus((f) => (f + 1) % Math.max(1, jobs.length)), 1300); return () => window.clearInterval(t); }, [site.state, jobs.length]);
  const ag = AGENT_BY_ID[site.agentId];
  return (
    <div className="js-prev-in">
      <div className="js-browser">
        <div className="js-chrome">
          <span className="js-dots"><i /><i /><i /></span>
          <IconButton size="xs" icon={ArrowLeft} label="Back (agent controlled)" disabled /><IconButton size="xs" icon={ArrowRight} label="Forward (agent controlled)" disabled />
          <IconButton size="xs" icon={RefreshCw} label="Reload" onClick={() => toast({ tone: 'info', title: `${ag?.name} reloads ${site.domain}` })} />
          <div className="js-url"><Lock size={11} className="good" /><span className="ellipsis">{site.url}</span></div>
          <span className={cx('js-live', site.state)}>{site.state === 'scanning' ? <><i />LIVE</> : site.state.toUpperCase()}</span>
          <Tip label="Open the real site in a new tab"><a className="icon-btn xs" href={site.url} target="_blank" rel="noopener noreferrer" aria-label="Open site"><ExternalLink size={13} /></a></Tip>
        </div>
        <div className="js-page-mock">
          <div className="js-site-head"><span className="js-fav lg" style={{ ['--h' as string]: (site.domain.charCodeAt(0) * 37) % 360 }}>{site.name[0]}</span><b>{site.name}</b><span className="dim">Jobs · page {site.page}</span><span className="spacer" /><span className="js-fake-search"><Search size={12} />react, typescript</span></div>
          <div className="js-job-list">
            {jobs.length === 0 && <LiveStatus className="dim" style={{ padding: 20, fontSize: 13 }}>Loading results…</LiveStatus>}
            {jobs.map((j, i) => (
              <div key={j.id} className={cx('js-mock-job', i === focus && site.state === 'scanning' && 'reading')}>
                <b className="ellipsis">{j.title}</b><span className="dim ellipsis">{j.company} · {j.remote} · {j.rate}</span>
                <span className="js-mock-tags">{j.skills.map((s) => <i key={s}>{s}</i>)}</span>
                <Chip hue={STATUS[j.status].hue} size="sm">{STATUS[j.status].label}</Chip>
              </div>
            ))}
          </div>
          {site.state === 'scanning' && jobs.length > 0 && (
            <motion.span className="js-cursor" animate={{ top: 58 + focus * 58 + 18, left: '62%' }} transition={{ type: 'spring', stiffness: 120, damping: 16 }}><MousePointer2 size={20} /></motion.span>
          )}
        </div>
        <AnimatePresence mode="wait">
          {last && <motion.div key={last.at + last.text} className="js-now" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <RobotAvatar role={ag?.role ?? 'browser'} size={26} animated={site.state === 'scanning'} /><b>{ag?.name}</b><span className="ellipsis">{last.text}</span>
          </motion.div>}
        </AnimatePresence>
      </div>
      <div className="js-steps">
        <div className="js-pane-h"><Sparkles size={14} className="violet" /><b>Investigation process</b><HelpTrigger k="jobs.process" /><span className="spacer" />{site.state !== 'scanning' && <button className="btn sm" onClick={() => useJobs.getState().setSiteState(site.id, 'scanning')}><Play size={13} />Start</button>}</div>
        <ol className="js-step-list">
          <AnimatePresence initial={false}>
            {steps.length === 0 && <li className="dim" style={{ fontSize: 12.5 }}>Steps appear here as the agent works.</li>}
            {steps.map((s) => { const I = STEP_ICON[s.kind]; return (
              <motion.li key={s.at + s.text} className={cx('js-step', s.kind)} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}>
                <span className="js-step-ico"><I size={12} /></span><span className="grow">{s.text}</span><span className="dim tnum">{agoFromTs(s.at)}</span>
              </motion.li>
            ); })}
          </AnimatePresence>
        </ol>
      </div>
    </div>
  );
}

/** The agents mobilized for this site, and a chat to instruct, teach and control them. */
function AgentsPane({ site }: { site: JobSite }) {
  const me = useMe();
  const team = [
    { id: site.agentId, task: site.agentId === 'homepage-01' ? `Investigates ${site.domain} (a site agent will be derived)` : `Investigates ${site.domain}` },
    { id: 'homepage-01', task: 'Coordinates all site agents · shares lessons' },
    { id: 'writer-01', task: 'Writes the tailored bid letters' },
    { id: 'researcher-01', task: 'Checks clients and job details' },
  ].filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i);
  const [pick, setPick] = useState(team[0].id);
  const cur = team.some((t) => t.id === pick) ? pick : team[0].id;
  useEffect(() => { setPick(team[0].id); }, [site.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="js-agents-in">
      <div className="js-pane-h"><UserRound size={15} className="info" /><b>Mobilized agents</b><HelpTrigger k="jobs.agents" /></div>
      <div className="js-team" role="radiogroup" aria-label="Agent to chat with">
        {team.map((t) => { const a = AGENT_BY_ID[t.id]; return a && (
          <Tip key={t.id} label={`${a.name}: ${t.task}`}>
            <button role="radio" aria-checked={cur === t.id} className={cx('js-mate', cur === t.id && 'on')} onClick={() => setPick(t.id)}>
              <RobotAvatar role={a.role} size={36} animated={site.state === 'scanning' && t.id === site.agentId} />
              <span className="ellipsis">{a.name}</span>
              <span className={cx('js-mate-dot', site.state === 'scanning' && 'on')} />
            </button>
          </Tip>
        ); })}
      </div>
      <div className="js-mate-task dim">{team.find((t) => t.id === cur)?.task}</div>
      {me && <ChannelChat key={cur} channel={channelId.plugin('jobs', cur, me.id)} compact className="js-chat"
        modes={[
          { key: 'instruct', label: 'Instruct', help: 'jobs.chat', placeholder: `Tell ${AGENT_BY_ID[cur]?.name} what to do on ${site.domain}…` },
          { key: 'teach', label: 'Teach', help: 'jobs.chat', placeholder: `Teach ${AGENT_BY_ID[cur]?.name} something to remember (e.g. never bid below…)` },
          { key: 'control', label: 'Control', help: 'jobs.chat', placeholder: 'Pause, resume, skip this job, only remote jobs…' },
        ]} />}
    </div>
  );
}

/* ================================================================== Jobs */
function JobsTab() {
  const jobs = useJobs((s) => s.jobs);
  const sites = useJobs((s) => s.sites);
  const [f, setF] = useState<'all' | JobStatus>('all');
  const [site, setSite] = useState('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const list = useMemo(() => jobs.filter((j) => (f === 'all' || j.status === f) && (site === 'all' || j.siteId === site) && (!q || (j.title + j.company + j.skills.join(' ')).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (b.bidAt ?? b.foundAt) - (a.bidAt ?? a.foundAt)), [jobs, f, site, q]);
  const cur = jobs.find((j) => j.id === sel) ?? list[0];
  const count = (s: JobStatus) => jobs.filter((j) => j.status === s).length;
  return (
    <div className="js-jobs">
      <div className="js-jobs-l">
        <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
          <Segmented ariaLabel="Bid status" size="sm" value={f} onChange={setF} options={[{ key: 'all', label: `All ${jobs.length}` }, ...(['bid', 'won', 'lost', 'drafting', 'found'] as JobStatus[]).map((s) => ({ key: s, label: `${STATUS[s].label} ${count(s)}` }))]} />
          <select className="select" style={{ width: 150 }} value={site} onChange={(e) => setSite(e.target.value)} aria-label="Filter by site"><option value="all">All sites</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.domain}</option>)}</select>
          <div className="input-wrap" style={{ width: 200 }}><Search size={14} /><input className="input" placeholder="Search jobs…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search jobs" /></div>
        </div>
        <div className="js-job-rows" role="listbox" aria-label="Researched jobs">
          <AnimatePresence initial={false}>
            {list.map((j, i) => { const S = STATUS[j.status]; const s = sites.find((x) => x.id === j.siteId); return (
              <motion.div key={j.id} layout role="option" aria-selected={cur?.id === j.id} tabIndex={0} className={cx('js-job-row', cur?.id === j.id && 'on')}
                onClick={() => setSel(j.id)} onKeyDown={(e) => { if (e.key === 'Enter') setSel(j.id); }}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: Math.min(i, 12) * .02 }}>
                <span className="js-status" style={{ ['--h' as string]: S.hue }}><S.icon size={14} /></span>
                <div className="grow" style={{ minWidth: 0 }}><b className="ellipsis">{j.title}</b><div className="dim ellipsis" style={{ fontSize: 11.5 }}>{j.company} · {s?.domain} · {j.rate}</div></div>
                <span className={cx('js-match tnum', j.match >= 85 ? 'good' : j.match >= 75 ? 'info' : 'dim')}>{j.match}%</span>
                <Chip hue={S.hue} size="sm">{S.label}</Chip>
              </motion.div>
            ); })}
          </AnimatePresence>
          {list.length === 0 && <EmptyState icon={Briefcase} title="No jobs here yet" body="Agents add jobs as they investigate your sites." />}
        </div>
      </div>
      <AnimatePresence mode="wait">{cur && <JobDetail key={cur.id} j={cur} />}</AnimatePresence>
    </div>
  );
}

function JobDetail({ j }: { j: Job }) {
  const S = STATUS[j.status];
  const site = useJobs((s) => s.sites.find((x) => x.id === j.siteId));
  const profile = useJobs((s) => s.profile);
  const setStatus = useJobs((s) => s.setJobStatus);
  const ag = AGENT_BY_ID[site?.agentId ?? 'homepage-01'];
  const timeline = [
    { t: j.foundAt, l: `Found by ${ag?.name}`, i: Eye, on: true },
    { t: j.bidAt, l: 'Bid sent with a tailored profile', i: Send, on: !!j.bidAt },
    { t: j.decidedAt, l: j.status === 'won' ? 'Won — the client accepted' : j.status === 'lost' ? 'Not selected' : 'Waiting for the client', i: j.status === 'won' ? Trophy : j.status === 'lost' ? XCircle : Clock3, on: !!j.decidedAt },
  ];
  return (
    <motion.aside className="js-detail subpanel" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: .2 }} aria-label="Job details">
      <div className="row" style={{ gap: 8 }}><Chip hue={S.hue} icon={S.icon}>{S.label}</Chip><span className="dim" style={{ fontSize: 12 }}>{site?.domain}</span><span className="spacer" /><a className="btn ghost sm" href={j.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} />Listing</a></div>
      <h3 className="js-d-title">{j.title}</h3>
      <div className="dim" style={{ fontSize: 12.5 }}>{j.company} · {j.remote} · listed {j.rate}</div>
      <p style={{ fontSize: 13, margin: '8px 0' }}>{j.summary}</p>
      <div className="row wrap" style={{ gap: 4 }}>{j.skills.map((s) => <Chip key={s} hue={200} size="sm">{s}</Chip>)}<Chip hue={j.match >= 75 ? 150 : 225} size="sm">match {j.match}%</Chip></div>
      <ol className="js-tl">{timeline.map((x) => <li key={x.l} className={cx(x.on && 'on')}><x.i size={13} /><span className="grow">{x.l}</span><span className="dim tnum">{x.t ? agoFromTs(x.t) : '—'}</span></li>)}</ol>
      <div className="js-tailor">
        <div className="row" style={{ gap: 6, marginBottom: 6 }}><PenLine size={14} className="warn" /><b>Profile used for this bid</b><HelpTrigger k="jobs.tailor" /></div>
        {j.tailored ? <>
          <div className="js-diff"><span className="del">− {profile.headline}</span><span className="add">+ {j.tailored.headline}</span></div>
          <ul className="js-emph">{j.tailored.emphasis.map((e) => <li key={e}><CheckCircle2 size={12} className="good" />{e}</li>)}</ul>
          <blockquote className="js-letter">{j.tailored.letter}</blockquote>
        </> : <div className="dim" style={{ fontSize: 12.5 }}>No bid yet. When the agent bids, it tailors your profile to this job and shows the changes here.</div>}
      </div>
      <div className="row wrap" style={{ gap: 6, marginTop: 'auto', paddingTop: 10 }}>
        {(j.status === 'found' || j.status === 'skipped') && <button className="btn primary sm" onClick={() => { setStatus(j.id, 'bid'); toast({ tone: 'success', title: 'Bid sent (demo)', body: `${ag?.name} tailored your profile to “${j.title}”.` }); }}><Send size={13} />Bid now</button>}
        {j.status === 'found' && <button className="btn sm" onClick={() => setStatus(j.id, 'skipped')}><SkipForward size={13} />Skip</button>}
        <button className="btn ghost sm" onClick={() => openDialog('mission-create', { text: `Prepare a stronger application for “${j.title}” at ${j.company} (${j.url}).` })}><Target size={13} />Make a mission</button>
      </div>
    </motion.aside>
  );
}

/* ================================================================== Profile */
const DOC_ICON: Record<ProfileDoc['kind'], typeof FileText> = { pdf: FileText, doc: FileText, txt: FileText, image: ImageIcon, file: FileIcon };
function ProfileTab() {
  const profile = useJobs((s) => s.profile);
  const { setProfile, addDocs, removeDoc } = useJobs();
  const [headline, setHeadline] = useState(profile.headline);
  const [text, setText] = useState(profile.text);
  const [over, setOver] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const dirty = headline !== profile.headline || text !== profile.text;
  const add = (list: FileList | File[]) => {
    const docs = Array.from(list).map((f): ProfileDoc => ({ id: 'd' + Date.now().toString(36) + f.name.length, name: f.name, size: f.size, addedAt: Date.now(),
      kind: f.type === 'application/pdf' || /\.pdf$/i.test(f.name) ? 'pdf' : f.type.startsWith('image/') ? 'image' : /\.(docx?|odt|rtf)$/i.test(f.name) ? 'doc' : f.type.startsWith('text/') ? 'txt' : 'file' }));
    addDocs(docs);
    toast({ tone: 'success', title: `${docs.length} document${docs.length > 1 ? 's' : ''} added`, body: 'Agents attach the most relevant one to each bid.' });
  };
  return (
    <div className="js-profile">
      <Panel icon={UserRound} title="Profile used for bidding" help="jobs.profile" actions={<span className="dim" style={{ fontSize: 12 }}>updated {agoFromTs(profile.updatedAt)}</span>}>
        <label className="field"><span className="field-label">Headline</span><input className="input" value={headline} onChange={(e) => setHeadline(e.target.value)} aria-label="Headline" /></label>
        <label className="field" style={{ marginTop: 10 }}><span className="field-label">Other information</span>
          <textarea className="textarea" rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder="Experience, skills, availability, rates you accept, languages, anything the agents should know." aria-label="Other information" />
        </label>
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
          <span className="dim" style={{ fontSize: 12 }}>{text.trim().split(/\s+/).filter(Boolean).length} words</span>
          <span className="row" style={{ gap: 6 }}><button className="btn ghost sm" disabled={!dirty} onClick={() => { setHeadline(profile.headline); setText(profile.text); }}>Undo</button>
            <button className="btn primary sm" disabled={!dirty || !headline.trim()} onClick={() => { setProfile({ headline: headline.trim(), text }); toast({ tone: 'success', title: 'Profile saved', body: 'New bids use it from now on.' }); }}>Save profile</button></span>
        </div>
      </Panel>
      <Panel icon={FileText} title="Documents" help="jobs.docs" actions={<button className="btn sm" onClick={() => pick.current?.click()}><Upload size={13} />Add documents</button>}>
        <div className={cx('js-drop', over && 'over')} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) add(e.dataTransfer.files); }} onClick={() => pick.current?.click()} role="button" tabIndex={0} aria-label="Add documents">
          <Upload size={20} className="info" /><span>Drop a resume, portfolio, certificates or images</span>
        </div>
        <input ref={pick} type="file" multiple hidden accept=".pdf,.doc,.docx,.odt,.rtf,.txt,.md,image/*" onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ''; }} />
        <div className="col" style={{ gap: 6, marginTop: 10 }}>
          <AnimatePresence initial={false}>
            {profile.docs.map((d) => { const I = DOC_ICON[d.kind]; return (
              <motion.div key={d.id} layout className="js-doc" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}>
                <span className="js-doc-ico"><I size={16} /></span><div className="grow" style={{ minWidth: 0 }}><b className="ellipsis">{d.name}</b><div className="dim" style={{ fontSize: 11.5 }}>{d.kind.toUpperCase()} · {Math.max(1, Math.round(d.size / 1024))} KB · added {agoFromTs(d.addedAt)}</div></div>
                <IconButton size="xs" icon={Trash2} label={`Remove ${d.name}`} onClick={() => removeDoc(d.id)} />
              </motion.div>
            ); })}
          </AnimatePresence>
          {profile.docs.length === 0 && <span className="dim" style={{ fontSize: 12.5 }}>No documents yet.</span>}
        </div>
      </Panel>
      <Panel icon={Sparkles} title="How agents tailor it" help="jobs.tailor">
        <ol className="js-how">
          <li><b>Read the job.</b> The site agent reads the listing and scores the match against your profile.</li>
          <li><b>Tailor a copy.</b> Writer-01 rewrites the headline, puts the most relevant experience first and picks the best document. Your saved profile never changes.</li>
          <li><b>Bid.</b> The tailored copy is submitted. You can see exactly what changed in Jobs.</li>
          <li><b>Learn.</b> Wins and losses teach the site agent; general lessons are shared up to Homepage-01 for every site.</li>
        </ol>
      </Panel>
    </div>
  );
}
