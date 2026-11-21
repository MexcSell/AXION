import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LifeBuoy, Sparkles, MapPin, ExternalLink, BookOpen, Lightbulb, Keyboard, Wrench, BookMarked, Search, Rocket, MessagesSquare, Globe, GitCompareArrows, Check, ChevronDown, Play, RotateCcw, SearchX,
} from 'lucide-react';
import { TopBoard, FrameBody } from '@/components/layout/PageFrame';
import { Panel } from '@/components/ui/Panel';
import { HelpBody, HelpTrigger } from '@/components/ui/HelpTrigger';
import { Chip } from '@/components/ui/Chips';
import { EmptyState } from '@/components/ui/EmptyState';
import { SHORTCUTS } from '@/components/settings/bits';
import { HELP } from '@/help/registry';
import { WHATS_NEW, WHATS_NEW_BY_KEY, type WhatsNewStatus } from '@/help/whatsnew';
import { useTab } from '@/hooks/useTab';
import { toast } from '@/store/ui';
import { cx } from '@/lib/format';
import '@/theme/pages/settings-ops-help.css';

const ICONS = [Sparkles, BookOpen, Lightbulb, Keyboard, Wrench, BookMarked];

export default function HelpPage() {
  const [tab, setTab, tabs] = useTab('help');
  return (
    <div className="page">
      <TopBoard icon={LifeBuoy} title="Help Center" help="help.center" sub="What is new, guides, every ? explanation, shortcuts, troubleshooting and a glossary."
        tabs={{ tabs, value: tab, onChange: setTab, icons: ICONS, ariaLabel: 'Help sections' }} />
      <FrameBody tab={tab} panel={false}>
        {tab === 'New Features' && <WhatsNew />}
        {tab === 'Guides' && <Guides />}
        {tab === 'Context Help' && <Context />}
        {tab === 'Shortcuts' && <Shortcuts />}
        {tab === 'Troubleshooting' && <Trouble />}
        {tab === 'Glossary' && <Glossary />}
      </FrameBody>
    </div>
  );
}

const STATUS: Record<WhatsNewStatus, { label: string; hue: number }> = {
  real: { label: 'Real', hue: 148 },
  mixed: { label: 'Real + DEMO parts', hue: 38 },
  later: { label: 'Coming when merged', hue: 225 },
};

/** Cycle 17: what is new since Stage 5, in plain language, one page per feature; ?f=<key> selects a page. */
function WhatsNew() {
  const [sp, setSp] = useSearchParams();
  const sel = WHATS_NEW_BY_KEY[sp.get('f') ?? ''] ?? WHATS_NEW[0];
  const pick = (k: string) => setSp((prev) => { const n = new URLSearchParams(prev); n.set('f', k); return n; }, { replace: true });
  const groups = Array.from(new Set(WHATS_NEW.map((i) => i.group)));
  const st = STATUS[sel.status];
  const rows: [string, string, string?][] = [['What it does', sel.does], ['Where to find it', sel.where], ['What is real', sel.real], ['What is still DEMO', sel.demo]];
  return (
    <div className="grid ctx-grid" data-whatsnew>
      <Panel icon={Sparkles} title="What is new" help="help.whatsnew" delay={.05} sub={`${WHATS_NEW.length} features since Stage 5`}>
        <div className="ctx-list wn-list" role="listbox" aria-label="Features">
          {groups.map((g) => (
            <div key={g} className="col" style={{ gap: 4 }}>
              <div className="section-label" style={{ margin: '6px 4px 2px' }}>{g}</div>
              {WHATS_NEW.filter((i) => i.group === g).map((i) => (
                <button key={i.key} role="option" aria-selected={sel.key === i.key} data-wn={i.key} className={cx('ctx-item', sel.key === i.key && 'on')} onClick={() => pick(i.key)}>
                  <span className="row" style={{ gap: 6, width: '100%' }}><b className="grow">{i.title}</b><Chip hue={STATUS[i.status].hue} size="sm">{STATUS[i.status].label}</Chip></span>
                  <span className="dim" style={{ fontSize: 11.5 }}>{i.line}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </Panel>
      <Panel icon={MapPin} title={sel.title} delay={.1} sub={<Chip hue={st.hue} size="sm">{st.label}</Chip>} className="wn-detail" data-wn-detail={sel.key}>
        <AnimatePresence mode="wait">
          <motion.div key={sel.key} className="col" style={{ gap: 10 }} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .18 }}>
            {rows.map(([h, t]) => <div key={h}><div className="section-label">{h}</div><div style={{ fontSize: 13 }}>{t}</div></div>)}
            {sel.limits && <div><div className="section-label">Honest limits</div><div style={{ fontSize: 13 }}>{sel.limits}</div></div>}
            <div className="row"><Link className="btn primary" to={sel.route} data-wn-open={sel.key}><ExternalLink size={14} />{sel.linkLabel}</Link></div>
          </motion.div>
        </AnimatePresence>
      </Panel>
    </div>
  );
}

const GUIDES = [
  { k: 'mission', icon: Rocket, hue: 268, title: 'Run your first mission', time: '4 min', route: '/missions', steps: ['Open Missions and press New Mission', 'Write what you want, attach files if useful', 'The GM appoints an executor, who brings the agents', 'Watch verified progress and each agent\'s activity'] },
  { k: 'chat', icon: MessagesSquare, hue: 195, title: 'Talk to an agent', time: '2 min', route: '/missions', steps: ['Open a mission in Missions', 'Select an agent in the hierarchy', 'Type a command and press Ctrl + Enter', 'Read the reply and its attached evidence'] },
  { k: 'grants', icon: Globe, hue: 148, title: 'Search jobs with agents', time: '3 min', route: '/plugins/job-search', steps: ['Open Job Search in the rail\'s plug-in section', 'Add a job site address', 'Fill in Profile: headline, text and documents', 'Watch the agents investigate and bid; instruct or teach them in the chat'] },
  { k: 'results', icon: GitCompareArrows, hue: 38, title: 'Read versioned results', time: '3 min', route: '/results', steps: ['Open Results and pick a deliverable', 'Compare versions side by side', 'Check the evidence and verification state', 'Promote or request changes'] },
];

function Guides() {
  const [done, setDone] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<string | null>('mission');
  return (
    <div className="grid g-2">
      {GUIDES.map((g, gi) => {
        const n = done[g.k] ?? 0;
        const pct = Math.round((n / g.steps.length) * 100);
        const isOpen = open === g.k;
        return (
          <Panel key={g.k} icon={g.icon} title={g.title} help="help.guides" delay={gi * .06} sub={`${g.time} · ${g.steps.length} steps`} className="guide-panel"
            actions={<Chip hue={n === g.steps.length ? 148 : g.hue} size="sm">{n === g.steps.length ? 'Complete' : `${pct}%`}</Chip>}>
            <div className="bar thin" style={{ marginBottom: 12 }}><motion.i animate={{ width: `${pct}%` }} transition={{ duration: .5 }} /></div>
            <AnimatePresence initial={false}>
              {(isOpen || n > 0) && (
                <motion.ol className="step-list" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                  {g.steps.map((s, i) => (
                    <motion.li key={s} className={cx('step-card', i < n && 'done', i === n && 'cur')} style={{ ['--h' as string]: g.hue }} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * .07 }}>
                      <span className="step-num">{i < n ? <Check size={14} /> : i + 1}</span>
                      <span className="grow">{s}</span>
                      {i === n && <button className="btn sm primary" onClick={() => setDone((d) => ({ ...d, [g.k]: n + 1 }))}>Done</button>}
                    </motion.li>
                  ))}
                </motion.ol>
              )}
            </AnimatePresence>
            <div className="row" style={{ gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={() => { setOpen(isOpen ? null : g.k); }}>{isOpen ? 'Hide steps' : <><Play size={13} />Start guide</>}</button>
              <Link className="btn ghost" to={g.route}>Open screen</Link>
              {n > 0 && <button className="btn ghost" onClick={() => { setDone((d) => ({ ...d, [g.k]: 0 })); toast({ tone: 'info', title: 'Guide progress reset' }); }}><RotateCcw size={13} />Reset</button>}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

function Context() {
  const all = useMemo(() => Object.entries(HELP).map(([k, e]) => ({ k, e })).sort((a, b) => a.e.title.localeCompare(b.e.title)), []);
  const [q, setQ] = useState('');
  const [sp] = useSearchParams();
  const [sel, setSel] = useState<string>(sp.get('k') && HELP[sp.get('k')!] ? sp.get('k')! : all[0]?.k ?? '');
  const list = all.filter(({ k, e }) => !q || (k + ' ' + e.title + ' ' + e.what).toLowerCase().includes(q.toLowerCase()));
  const cur = HELP[sel];
  return (
    <div className="grid ctx-grid">
      <Panel icon={Search} title="Index" help="help.context" delay={.05} sub={`${list.length} of ${all.length} entries`}>
        <div className="input-wrap" style={{ marginBottom: 10 }}><Search size={15} /><input className="input" placeholder="Search every ? explanation…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search help" data-autofocus /></div>
        <div className="ctx-list" role="listbox" aria-label="Help entries">
          {list.length === 0 && <EmptyState icon={SearchX} title="No help entries match" body="Try another word." action={<button className="btn" onClick={() => setQ('')}>Clear search</button>} />}
          {list.map(({ k, e }, i) => (
            <motion.button key={k} role="option" aria-selected={sel === k} className={cx('ctx-item', sel === k && 'on')} onClick={() => setSel(k)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 12) * .015 }}>
              <b>{e.title}</b><span className="mono dim">{k}</span>
            </motion.button>
          ))}
        </div>
      </Panel>
      <Panel icon={Lightbulb} title={cur?.title ?? 'Select an entry'} delay={.1} sub={sel ? <span className="mono">{sel}</span> : undefined}>
        <AnimatePresence mode="wait">
          {cur ? <motion.div key={sel} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .18 }}><HelpBody e={cur} /></motion.div>
            : <EmptyState icon={Lightbulb} title="Nothing selected" body="Pick an entry from the index." />}
        </AnimatePresence>
      </Panel>
    </div>
  );
}

function Shortcuts() {
  const [q, setQ] = useState('');
  const rows = SHORTCUTS.filter(([k, d, p]) => !q || (k.join(' ') + d + p).toLowerCase().includes(q.toLowerCase()));
  const pages = Array.from(new Set(rows.map((r) => r[2])));
  return (
    <Panel icon={Keyboard} titleSize="lg" title="Keyboard shortcuts" help="settings.shortcuts" delay={.05} actions={<div className="input-wrap" style={{ width: 240 }}><Search size={15} /><input className="input" placeholder="Search shortcuts or page…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search shortcuts" /></div>}>
      {rows.length === 0 ? <EmptyState icon={SearchX} title="No shortcuts match" action={<button className="btn" onClick={() => setQ('')}>Clear</button>} /> : (
        <div className="grid g-3">
          {pages.map((p, pi) => (
            <motion.div key={p} className="subpanel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: pi * .06 }}>
              <div className="section-label" style={{ marginBottom: 8 }}>{p}</div>
              <div className="col" style={{ gap: 8 }}>
                {rows.filter((r) => r[2] === p).map(([k, d]) => (
                  <div key={d} className="kbd-row"><span className="row" style={{ gap: 4 }}>{k.map((x, i) => <span key={i} className="row" style={{ gap: 4 }}>{i > 0 && <span className="dim">+</span>}<kbd className="kbd big">{x}</kbd></span>)}</span><span>{d}</span></div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </Panel>
  );
}

const ISSUES = [
  { code: 'AX-101', sym: 'A mission does not start', cause: 'An assigned agent is still learning on an older pinned version, or its VM is out of memory.', fix: 'Open Start Mission, read the policy review and swap the agent, or free a VM in System Operations.', perm: 'Mission owner' },
  { code: 'AX-204', sym: 'Browser agent stops at a new website', cause: 'The origin has no grant. New sites always need separate permission.', fix: 'Approve a grant in Browser Studio, Grants. Pick the shortest duration that works.', perm: 'Approver' },
  { code: 'AX-312', sym: 'Progress seems stuck at 76%', cause: 'Remaining tasks wait for verification. Unverified work is not counted.', fix: 'Open the mission in Missions › Task Flow, and look for tasks in Verifying or Rejected.', perm: 'Anyone' },
  { code: 'AX-408', sym: 'Model call fails or is slow', cause: 'The primary model timed out and a fallback route is used.', fix: 'Check Models, Routing. If a provider is down, the fallback keeps work going.', perm: 'Admin to change routes' },
  { code: 'AX-503', sym: 'A service shows a warning in System Operations', cause: 'High memory or a recent restart by the watchdog.', fix: 'Request a restart in Operations, Services. An Admin approves it after the impact preview.', perm: 'Admin' },
  { code: 'AX-611', sym: 'Restore request is blocked', cause: 'The restore dry-run is older than 7 days.', fix: 'Run a restore dry-run in Operations, Recovery, then request again.', perm: 'Owner' },
];
function Trouble() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>('AX-204');
  const list = ISSUES.filter((i) => !q || (i.code + i.sym + i.cause).toLowerCase().includes(q.toLowerCase()));
  return (
    <Panel icon={Wrench} titleSize="lg" title="Troubleshooting" help="help.troubleshooting" delay={.05} actions={<div className="input-wrap" style={{ width: 240 }}><Search size={15} /><input className="input" placeholder="Search code or symptom…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search troubleshooting" /></div>}>
      {list.length === 0 ? <EmptyState icon={SearchX} title="No matching issue" action={<button className="btn" onClick={() => setQ('')}>Clear</button>} /> : (
        <div className="col" style={{ gap: 8 }}>
          {list.map((i, n) => {
            const o = open === i.code;
            return (
              <motion.div key={i.code} className="subpanel glass-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: n * .04 }}>
                <button className="row trouble-head" onClick={() => setOpen(o ? null : i.code)} aria-expanded={o}>
                  <Chip hue={350}>{i.code}</Chip><b className="grow" style={{ textAlign: 'left' }}>{i.sym}</b><motion.span animate={{ rotate: o ? 180 : 0 }}><ChevronDown size={16} /></motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {o && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
                      <div className="grid g-3" style={{ gap: 10, paddingTop: 10 }}>
                        <div><div className="section-label">Likely cause</div><div style={{ fontSize: 13 }}>{i.cause}</div></div>
                        <div><div className="section-label">Resolution</div><div style={{ fontSize: 13 }}>{i.fix}</div></div>
                        <div><div className="section-label">Permission</div><Chip hue={268}>{i.perm}</Chip></div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

const TERMS: [string, string][] = [
  ['Mission', 'What a user wants done, written as text and files. The GM appoints an executor, the executor brings agents, and it is finished only when its results are verified.'],
  ['Task', 'One unit of work inside a mission, with required evidence. Tasks count toward progress only after verification.'],
  ['Agent definition', 'A reusable agent type with a role, skills and a version. Think of it as the job description.'],
  ['Agent instance', 'A mission-specific run of an agent definition, with its own memory, access and pinned version.'],
  ['Origin grant', 'Permission for agents to use one website origin, for listed actions and a limited time.'],
  ['Verified result', 'A deliverable whose evidence passed independent checks by an evaluator, not by the agent that made it.'],
  ['Version', 'An immutable snapshot of an agent or a result. Changes create a new version and old ones stay available.'],
  ['Promotion', 'Moving a candidate agent version into use after tests and an approval.'],
  ['Evidence', 'Screenshots, diffs, logs and test output attached to a claim so a human can check it.'],
  ['Redaction', 'Removing secrets and personal data from logs and exports before they are stored.'],
];
function Glossary() {
  const [q, setQ] = useState('');
  const list = TERMS.filter(([t, d]) => !q || (t + d).toLowerCase().includes(q.toLowerCase()));
  return (
    <Panel icon={BookMarked} titleSize="lg" title="Glossary" help="help.glossary" delay={.05} actions={<div className="input-wrap" style={{ width: 240 }}><Search size={15} /><input className="input" placeholder="Search terms…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search glossary" /></div>}>
      {list.length === 0 ? <EmptyState icon={SearchX} title="No matching term" action={<button className="btn" onClick={() => setQ('')}>Clear</button>} /> : (
        <div className="grid g-2">
          {list.map(([t, d], i) => (
            <motion.div key={t} className="subpanel glass-card hoverable" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .03 }}>
              <div className="row" style={{ marginBottom: 4 }}><span className="gloss-letter">{t[0]}</span><b className="display" style={{ fontSize: 15 }}>{t}</b><HelpTrigger entry={{ title: t, what: d }} /></div>
              <div className="muted" style={{ fontSize: 13 }}>{d}</div>
            </motion.div>
          ))}
        </div>
      )}
    </Panel>
  );
}
