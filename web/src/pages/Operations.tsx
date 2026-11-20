import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, Server, Cpu, ListChecks, Globe, HardDrive, ScrollText, LifeBuoy, RotateCw, Pause, Play, Download, Search, Trash2, CircleCheck, CircleX,
  ShieldCheck, Undo2, FlaskConical, GitBranch, Lock,
} from 'lucide-react';
import { PageHeader, Panel } from '@/components/ui/Panel';
import { Tabs } from '@/components/ui/Tabs';
import { Chip, DemoTag, Dot } from '@/components/ui/Chips';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { IconButton } from '@/components/ui/IconButton';
import { Sparkline, RingGauge } from '@/components/viz/Charts';
import { MiniStat } from '@/components/settings/bits';
import { useTab } from '@/hooks/useTab';
import { openDialog, toast } from '@/store/ui';
import {
  SERVICES, WORKERS, QUEUES, BROWSER_HOSTS, CRASH_REPORTS, STORAGE_AREAS, makeLog, RELEASES, INCIDENTS, READINESS, type Sev, type Health,
} from '@/data/operations';
import { cx } from '@/lib/format';
import '@/theme/pages/settings-ops-help.css';

const ICONS = [Server, Cpu, ListChecks, Globe, HardDrive, ScrollText, LifeBuoy];
const HCOL: Record<Health, string> = { good: 'good', warn: 'warn', bad: 'bad' };

export default function OperationsPage() {
  const [tab, setTab, tabs] = useTab('operations');
  const up = SERVICES.filter((s) => s.health === 'good').length;
  return (
    <div className="page">
      <PageHeader icon={Activity} title="System Operations" help="ops.services" sub="systemd units, workers, queues, browser hosts, logs and recovery. Read-only by default." actions={<DemoTag />}>
        <div className="grid g-4" style={{ marginTop: 12 }}>
          <MiniStat label="Services healthy" value={`${up}/${SERVICES.length}`} tone={up === SERVICES.length ? 'good' : 'warn'} sub="1 warning: browser-worker" />
          <MiniStat label="Jobs in queues" value={QUEUES.reduce((a, q) => a + q.pending + q.running, 0)} tone="info" sub={`${QUEUES.reduce((a, q) => a + q.failed, 0)} failed`} />
          <MiniStat label="Browser memory" value="1.3 GB" tone="violet" sub="1 orphan context" />
          <MiniStat label="Rollback readiness" value="4/5" tone="warn" sub="dry-run is stale" />
        </div>
        <div style={{ marginTop: 12, overflowX: 'auto' }}>
          <Tabs tabs={tabs.map((t, i) => ({ key: t, label: t, icon: ICONS[i] }))} value={tab} onChange={setTab} ariaLabel="Operations sections" />
        </div>
      </PageHeader>
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .2 }} role="tabpanel" aria-label={tab}>
          {tab === 'Services' && <Services />}
          {tab === 'Workers' && <Workers />}
          {tab === 'Queues' && <Queues />}
          {tab === 'Browser Hosts' && <Hosts />}
          {tab === 'Storage' && <StorageOps />}
          {tab === 'Logs' && <Logs />}
          {tab === 'Recovery' && <Recovery />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Services() {
  return (
    <Panel icon={Server} titleSize="lg" title="systemd services" help="ops.services" delay={.05} sub="Read-only · restart is a request" actions={<span className="chip" style={{ ['--h' as string]: 205 }}><Lock size={11} />read-only</span>}>
      <div className="grid g-3">
        {SERVICES.map((s, i) => (
          <motion.div key={s.unit} className="subpanel glass-card hoverable svc-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .05 }}>
            <div className="row" style={{ gap: 8 }}>
              <Dot tone={s.health} pulse={s.health !== 'good'} />
              <b className="mono ellipsis" style={{ fontSize: 13 }}>{s.unit}</b>
              <span className="spacer" />
              <Chip hue={s.health === 'good' ? 148 : 40} size="sm">{s.health === 'good' ? 'Healthy' : 'Warning'}</Chip>
            </div>
            <div className="dim" style={{ fontSize: 12, margin: '4px 0 8px' }}>{s.desc}</div>
            <div className="mono dim" style={{ fontSize: 11 }}>{s.state} · pid {s.pid} · up {s.uptime}</div>
            <div className="row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
              <div className="col" style={{ gap: 2, fontSize: 12 }}>
                <span>CPU <b className={HCOL[s.health]}>{s.cpu}%</b> · Mem <b>{s.mem} MB</b></span>
                <span className="dim">Last restart {s.lastRestart}</span>
              </div>
              <Sparkline data={s.spark} w={96} h={34} color={`var(--${s.health === 'good' ? 'good' : 'warn'})`} />
            </div>
            <div className="row" style={{ marginTop: 10, gap: 6 }}>
              <button className="btn sm" onClick={() => openDialog('service-restart', { unit: s.unit })}><RotateCw size={13} />Request restart</button>
              <button className="btn sm ghost" onClick={() => toast({ tone: 'info', title: `journalctl -u ${s.unit}`, body: 'Opens the Logs tab filtered to this unit in a real build.' })}>Logs</button>
            </div>
          </motion.div>
        ))}
      </div>
    </Panel>
  );
}

function Workers() {
  return (
    <Panel icon={Cpu} titleSize="lg" title="Worker allocations" help="ops.workers" delay={.05} actions={<DemoTag />}>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Worker</th><th>Unit</th><th>Agent</th><th>Job</th><th>Progress</th><th>Crashes</th><th>Restarts</th><th>Pinned</th><th>State</th><th /></tr></thead>
        <tbody>{WORKERS.map((w, i) => (
          <motion.tr key={w.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * .04 }}>
            <td className="mono">{w.id}</td><td className="mono dim">{w.unit}</td><td>{w.agent}</td><td className="ellipsis" style={{ maxWidth: 240 }}>{w.job}</td>
            <td style={{ width: 120 }}><div className="bar thin"><motion.i initial={{ width: 0 }} animate={{ width: `${w.progress}%` }} transition={{ duration: .9, delay: .1 + i * .05 }} /></div></td>
            <td className={cx('tnum', w.crashes > 0 && 'warn')}>{w.crashes}</td><td className="tnum">{w.restarts}</td><td className="mono">{w.pinned}</td>
            <td><Chip hue={w.state === 'running' ? 148 : w.state === 'draining' ? 40 : 240} size="sm">{w.state}</Chip></td>
            <td><button className="btn sm ghost" disabled={w.state !== 'running'} onClick={() => toast({ tone: 'info', title: `Drain request for ${w.id} (demo)`, body: 'Draining finishes the current task, then stops accepting work. Needs Admin approval.' })}>Drain</button></td>
          </motion.tr>))}</tbody></table></div>
    </Panel>
  );
}

function Queues() {
  return (
    <Panel icon={ListChecks} titleSize="lg" title="Queues" help="ops.queues" delay={.05} actions={<DemoTag />}>
      <div className="grid g-2">
        {QUEUES.map((q, i) => (
          <motion.div key={q.name} className="subpanel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .05 }}>
            <div className="row"><b className="mono">{q.name}</b><span className="spacer" /><span className="dim" style={{ fontSize: 12 }}>oldest {q.oldest}</span></div>
            <div className="row" style={{ gap: 6, margin: '8px 0' }}>
              <Chip hue={205} size="sm">pending {q.pending}</Chip><Chip hue={148} size="sm">running {q.running}</Chip><Chip hue={q.failed ? 350 : 240} size="sm">failed {q.failed}</Chip><Chip hue={40} size="sm">retry {q.retry}</Chip>
            </div>
            <div className="row" style={{ gap: 8, fontSize: 12 }}>
              <span className="dim" style={{ width: 120 }}>Concurrency {q.running}/{q.max}</span>
              <div className={cx('bar', q.running >= q.max ? 'warn' : '')} style={{ flex: 1 }}><motion.i initial={{ width: 0 }} animate={{ width: `${Math.min(100, (q.running / q.max) * 100)}%` }} transition={{ duration: .8 }} /></div>
            </div>
            <div className="row" style={{ gap: 6, marginTop: 10 }}>
              <button className="btn sm" disabled={!q.failed && !q.retry} onClick={() => toast({ tone: 'success', title: `Retry queued for ${q.name} (demo)`, body: `Idempotency key idem-${q.name.replace('.', '-')}-001 prevents duplicate work.` })}>Retry failed</button>
              <button className="btn sm ghost" disabled={!q.pending} onClick={() => toast({ tone: 'warning', title: 'Safe cancel needs Admin approval (demo)' })}>Cancel pending</button>
            </div>
          </motion.div>
        ))}
      </div>
    </Panel>
  );
}

function Hosts() {
  const [orphans, setOrphans] = useState(BROWSER_HOSTS.filter((h) => h.state === 'orphan').map((h) => h.id));
  return (
    <div className="grid set-grid-2">
      <Panel icon={Globe} titleSize="lg" title="Chromium hosts" help="ops.browserHosts" delay={.05} actions={<DemoTag />}>
        <div className="table-wrap"><table className="table"><thead><tr><th>Host</th><th>Profile</th><th>Mission</th><th>Memory</th><th>Tabs</th><th>Crashes</th><th>State</th><th /></tr></thead>
          <tbody>{BROWSER_HOSTS.map((h) => {
            const gone = h.state === 'orphan' && !orphans.includes(h.id);
            return (
              <tr key={h.id} style={gone ? { opacity: .4 } : undefined}>
                <td className="mono">{h.id}</td><td className="mono dim">{h.profile}</td><td>{h.mission}</td>
                <td style={{ width: 130 }}><div className="row" style={{ gap: 6 }}><div className={cx('bar thin', h.mem > 500 ? 'warn' : '')} style={{ flex: 1 }}><i style={{ width: `${Math.min(100, h.mem / 8)}%` }} /></div><span className="tnum" style={{ fontSize: 11.5 }}>{h.mem}</span></div></td>
                <td className="tnum">{h.tabs}</td><td className={cx('tnum', h.crashes > 0 && 'warn')}>{h.crashes}</td>
                <td><Chip hue={h.state === 'attached' ? 148 : h.state === 'orphan' ? 30 : 240} size="sm">{gone ? 'cleaned' : h.state}</Chip></td>
                <td>{h.state === 'orphan' && !gone && <button className="btn sm danger" onClick={() => { toast({ tone: 'info', title: 'Verifying orphan…', body: 'No mission session is attached to this context.' }); window.setTimeout(() => { setOrphans((o) => o.filter((x) => x !== h.id)); toast({ tone: 'success', title: `${h.id} cleaned up (demo)` }); }, 900); }}><Trash2 size={12} />Clean up</button>}</td>
              </tr>);
          })}</tbody></table></div>
      </Panel>
      <Panel icon={CircleX} title="Crash reports" help="ops.browserHosts" delay={.12}>
        <div className="col" style={{ gap: 8 }}>
          {CRASH_REPORTS.map((c) => (
            <div key={c.id} className="list-row"><Dot tone="bad" /><div className="grow"><div className="mono" style={{ fontSize: 12 }}>{c.id} · {c.host}</div><div style={{ fontSize: 12.5 }}>{c.reason}</div></div><span className="dim" style={{ fontSize: 12 }}>{c.when}</span></div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function StorageOps() {
  return (
    <Panel icon={HardDrive} titleSize="lg" title="Host storage" help="ops.storage" delay={.05} sub="Read-only integrity checks" actions={<><DemoTag /><button className="btn" onClick={() => toast({ tone: 'success', title: 'Integrity check passed (demo)', body: 'Database, artifacts and backups are consistent.' })}><ShieldCheck size={14} />Run integrity check</button></>}>
      <div className="grid g-4">
        {STORAGE_AREAS.map((a, i) => {
          const pct = Math.round((a.used / a.total) * 100);
          return (
            <motion.div key={a.key} className="subpanel glass-card hoverable" style={{ textAlign: 'center' }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .06 }}>
              <div className="row" style={{ justifyContent: 'center', marginBottom: 6 }}><b>{a.label}</b></div>
              <div className="row" style={{ justifyContent: 'center' }}><RingGauge value={pct} size={110} label={`${pct}%`} sub="used" colors={[`hsl(${a.hue} 90% 62%)`, `hsl(${a.hue + 30} 90% 62%)`]} /></div>
              <div className="tnum" style={{ marginTop: 6 }}><b>{a.used}</b> / {a.total} {a.unit}</div>
              <div className="dim" style={{ fontSize: 11.5 }}>{a.note}</div>
            </motion.div>
          );
        })}
      </div>
    </Panel>
  );
}

/* ------------------------------- Logs ------------------------------- */
const SEV_ORDER: Sev[] = ['debug', 'info', 'warn', 'error'];
function Redact({ text }: { text: string }) {
  const parts = text.split(/(\[REDACTED:[a-z-]+\])/g);
  return <>{parts.map((p, i) => p.startsWith('[REDACTED') ? <span key={i} className="redact" title="Redacted before storage">{p}</span> : <span key={i}>{p}</span>)}</>;
}
function Logs() {
  const [lines, setLines] = useState(() => Array.from({ length: 36 }, (_, i) => makeLog(i)));
  const [sev, setSev] = useState<Record<Sev, boolean>>({ debug: true, info: true, warn: true, error: true });
  const [q, setQ] = useState('');
  const [live, setLive] = useState(true);
  const next = useRef(36);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => { setLines((l) => [...l.slice(-249), makeLog(next.current++)]); }, 1100);
    return () => window.clearInterval(id);
  }, [live]);
  const shown = useMemo(() => lines.filter((l) => sev[l.sev] && (!q || (l.msg + l.svc + l.cid).toLowerCase().includes(q.toLowerCase()))), [lines, sev, q]);
  useEffect(() => { if (live && box.current) box.current.scrollTop = box.current.scrollHeight; }, [shown, live]);
  const counts = useMemo(() => SEV_ORDER.reduce((a, s) => ({ ...a, [s]: lines.filter((l) => l.sev === s).length }), {} as Record<Sev, number>), [lines]);
  return (
    <Panel icon={ScrollText} titleSize="lg" title="Logs" help="ops.logs" delay={.05} sub="Structured, correlation ids, redacted" actions={<DemoTag />}>
      <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
        {SEV_ORDER.map((s) => (
          <button key={s} className={cx('sev-chip', s, sev[s] && 'on')} aria-pressed={sev[s]} onClick={() => setSev((x) => ({ ...x, [s]: !x[s] }))}>{s} <b className="tnum">{counts[s]}</b></button>
        ))}
        <div className="input-wrap" style={{ width: 230 }}><Search size={15} /><input className="input" placeholder="Search message, unit, id…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search logs" /></div>
        <span className="spacer" />
        <span className="row dim" style={{ fontSize: 12, gap: 6 }}>Redaction <HelpTrigger k="ops.redaction" /></span>
        <IconButton icon={live ? Pause : Play} label={live ? 'Pause stream' : 'Resume stream'} variant={live ? 'active' : 'bordered'} onClick={() => setLive((v) => !v)} />
        <button className="btn" onClick={() => toast({ tone: 'success', title: 'Sanitized export prepared (demo)', body: `${shown.length} lines, secrets removed.` })}><Download size={14} />Export</button>
      </div>
      <div className="terminal" ref={box} role="log" aria-live="off" aria-label="Log stream" tabIndex={0}>
        <div className="term-bar"><i /><i /><i /><span className="mono">journalctl -f --output=json {live ? '' : '(paused)'}</span><span className="spacer" />{live && <span className="live-dot">LIVE</span>}</div>
        {shown.length === 0 && <div className="dim" style={{ padding: 16 }}>No lines match the current filters.</div>}
        {shown.map((l) => (
          <div key={l.id} className={cx('term-line', l.sev)}>
            <span className="t">{l.t}</span><span className={cx('lv', l.sev)}>{l.sev.toUpperCase().padEnd(5)}</span><span className="sv">{l.svc}</span><span className="msg"><Redact text={l.msg} /></span><span className="cid">{l.cid}</span>
          </div>
        ))}
        {live && <span className="term-cursor" aria-hidden />}
      </div>
    </Panel>
  );
}

/* ------------------------------ Recovery ------------------------------ */
function Recovery() {
  const [dry, setDry] = useState<'idle' | 'running' | 'done'>('idle');
  const [step, setStep] = useState(0);
  const steps = ['Unpack snapshot into scratch area', 'Verify checksums', 'Replay schema migrations', 'Smoke test API and workers', 'Discard scratch area'];
  useEffect(() => {
    if (dry !== 'running') return;
    if (step >= steps.length) { setDry('done'); toast({ tone: 'success', title: 'Restore dry-run passed', body: 'Live data was not touched.' }); return; }
    const id = window.setTimeout(() => setStep((s) => s + 1), 650);
    return () => window.clearTimeout(id);
  }, [dry, step, steps.length]);
  const ready = READINESS.filter((r) => r.ok).length + (dry === 'done' ? 1 : 0);
  const total = READINESS.length;
  return (
    <div className="grid set-grid-2">
      <div className="col" style={{ gap: 'var(--gap)' }}>
        <Panel icon={GitBranch} titleSize="lg" title="Releases" help="ops.recovery" delay={.05} actions={<DemoTag />}>
          <div className="col" style={{ gap: 8 }}>
            {RELEASES.map((r, i) => (
              <motion.div key={r.v} className={cx('subpanel row', r.state === 'last-good' && 'good-edge')} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * .07 }} style={{ gap: 10 }}>
                <b className="mono">{r.v}</b><span className="dim grow" style={{ fontSize: 12.5 }}>{r.note} · {r.date}</span>
                {r.state === 'last-good' && <Chip hue={148} size="sm"><CircleCheck size={11} />last good</Chip>}
                {r.state === 'active' && <Chip hue={205} size="sm">running</Chip>}
              </motion.div>
            ))}
          </div>
        </Panel>
        <Panel icon={Activity} title="Incident log" help="ops.recovery" delay={.12}>
          <div className="col" style={{ gap: 8 }}>
            {INCIDENTS.map((n) => <div key={n.id} className="list-row"><Dot tone={n.sev === 'error' ? 'bad' : n.sev === 'warn' ? 'warn' : 'info'} /><div className="grow"><div style={{ fontSize: 13 }}><span className="mono dim">{n.id}</span> {n.title}</div><div className="dim" style={{ fontSize: 12 }}>{n.res}</div></div><span className="dim" style={{ fontSize: 12 }}>{n.when}</span></div>)}
          </div>
        </Panel>
      </div>
      <div className="col" style={{ gap: 'var(--gap)' }}>
        <Panel icon={Undo2} titleSize="lg" title="Rollback readiness" help="ops.rollback" delay={.08} actions={<Chip hue={ready === total ? 148 : 40}>{ready}/{total} ready</Chip>}>
          <div className="row" style={{ gap: 18, alignItems: 'center' }}>
            <RingGauge value={Math.round((ready / total) * 100)} size={112} label={`${Math.round((ready / total) * 100)}%`} sub="ready" />
            <div className="col grow" style={{ gap: 7 }}>
              {READINESS.map((r, i) => {
                const ok = r.ok || (i === READINESS.length - 1 && dry === 'done');
                return <div key={r.k} className="row" style={{ gap: 8, fontSize: 13 }}>{ok ? <CircleCheck size={15} className="good" /> : <CircleX size={15} className="warn" />}<span className={ok ? '' : 'warn'}>{r.k}</span></div>;
              })}
            </div>
          </div>
        </Panel>
        <Panel icon={FlaskConical} title="Restore dry-run" help="ops.dryRun" delay={.14} actions={<button className="btn primary" disabled={dry === 'running'} onClick={() => { setStep(0); setDry('running'); }}><Play size={14} />{dry === 'done' ? 'Run again' : 'Run dry-run'}</button>}>
          <div className="col" style={{ gap: 8 }}>
            {steps.map((s, i) => (
              <div key={s} className="row" style={{ gap: 8, fontSize: 13, opacity: dry === 'idle' ? .5 : 1 }}>
                {i < step || dry === 'done' ? <CircleCheck size={15} className="good" /> : i === step && dry === 'running' ? <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }} style={{ display: 'inline-flex' }}><RotateCw size={15} className="info" /></motion.span> : <span className="dot sm" style={{ color: 'var(--text-dim)' }} />}
                <span>{s}</span>
              </div>
            ))}
          </div>
          <div className="divider" />
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn" onClick={() => openDialog('backup-restore', { snapshot: 'snap-1120-0300' })}>Request restore…</button>
            <button className="btn danger" onClick={() => toast({ tone: 'warning', title: 'Rollback to v3.1.4 needs an Owner-authorized plan (demo)' })}><Undo2 size={14} />Plan rollback</button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
