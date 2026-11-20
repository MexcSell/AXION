import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import {
  Package, LayoutGrid, MonitorPlay, History, GitBranch, GitCompare, Download, Rocket, Search, Eye, Play, RotateCcw, ShieldCheck, Clock, GitMerge, Lock,
  CheckCircle2, XCircle, FileCheck2, Copy, Layers, TrendingUp, Undo2, FlaskConical, BadgeCheck, ArrowRight, ScrollText, LayoutDashboard, Shapes,
} from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { TopBoard, FrameBody } from '@/components/layout/PageFrame';
import { Chip, DemoTag, Dot } from '@/components/ui/Chips';
import { EmptyState } from '@/components/ui/EmptyState';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { IconButton } from '@/components/ui/IconButton';
import { Segmented } from '@/components/ui/Form';
import { Donut, Legend, MeterRow } from '@/components/viz/Charts';
import { AGENT_BY_ID } from '@/data/agents';
import { allArtifacts, buildManifest, contentLines, defaultStage, diffLines, EXT, RELEASE_STAGES, sha256Hex, TYPE_HUE, useResults, type ArtRef, type ReleaseStage } from '@/data/results';
import { DiffView, downloadVersion, FakeBrowser, KpiStrip, TypeIcon, VerifyBadge } from '@/dialogs/defs/browser-results';
import type { ArtifactType, ArtifactVersion } from '@/data/types';
import { useVisibleMissions } from '@/store/data';
import { useTab } from '@/hooks/useTab';
import { openDialog, toast } from '@/store/ui';
import { ago, cx } from '@/lib/format';
import '@/theme/pages/browser-results-knowledge.css';

const LANES = [190, 275, 150, 40];

export default function ResultsPage() {
  const [tab, setTab, tabs] = useTab('results');
  const ICONS = [LayoutDashboard, LayoutGrid, MonitorPlay, History, GitBranch, GitCompare, Download, Rocket];
  const missions = useVisibleMissions();
  const stageMap = useResults((s) => s.stage);
  const refs = useMemo(() => allArtifacts(missions), [missions]);
  const versions = refs.reduce((n, r) => n + r.artifact.versions.length, 0);
  const verified = refs.reduce((n, r) => n + r.artifact.versions.filter((v) => v.verified).length, 0);
  const deployed = refs.filter((r, i) => (stageMap[r.artifact.id] ?? defaultStage(r.artifact, i)) === 'deployed').length;
  const [sel, setSel] = useState<string>('');
  const kpis = [
    { icon: Package, value: refs.length, label: 'Artifacts', color: '#22d3ee', delta: '+3' },
    { icon: Layers, value: versions, label: 'Immutable Versions', color: '#3b82f6' },
    { icon: BadgeCheck, value: Math.round((verified / Math.max(1, versions)) * 1000) / 10, decimals: 1, suffix: '%', label: 'Verified', color: '#2ee98a', delta: '+1.8%' },
    { icon: Rocket, value: deployed, label: 'Deployed Releases', color: '#a78bfa' },
    { icon: Clock, value: versions - verified, label: 'Awaiting Review', color: '#fbbf24' },
  ];
  return (
    <div className="page">
      <TopBoard icon={Package} title="Results & Versions" help="results.library" sub="Every artifact is immutable, hash-addressed and traceable to a mission."
        actions={<><DemoTag /><button className="btn" onClick={() => openDialog('download-bundle', { missionId: refs[0]?.mission.id })}><Download size={15} />Download bundle</button></>}
        tabs={{ tabs, value: tab, onChange: setTab, icons: ICONS, ariaLabel: 'Results views' }}
        toolbar={<span>{{ Summary: 'Totals, verification, latest versions and protected main.', Library: 'Mission folders, type filters, provenance and verification.', Previews: 'Isolated sandbox renderers. Nothing runs on the host.', Timeline: 'Immutable versions, newest first, grouped by mission.', 'Branch Graph': 'Baseline, mission lines and protected merges.', Comparisons: 'Structured diff with benchmark deltas.', Downloads: 'Any retained version, with checksum and manifest.', Releases: 'candidate, tested, approved, deployed, rolled back.' }[tab]}</span>} />
      <FrameBody tab={tab}>
        {tab === 'Summary' && <Summary refs={refs} kpis={kpis} verified={verified} pending={versions - verified} />}
        {tab === 'Library' && <Library refs={refs} />}
        {tab === 'Previews' && <Previews refs={refs} />}
        {tab === 'Timeline' && <Timeline refs={refs} sel={sel} setSel={setSel} />}
        {tab === 'Branch Graph' && <BranchGraph refs={refs} />}
        {tab === 'Comparisons' && <Comparisons refs={refs} />}
        {tab === 'Downloads' && <Downloads refs={refs} />}
        {tab === 'Releases' && <Releases refs={refs} />}
      </FrameBody>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/** Page-wide totals live here only, instead of framing every tab. */
function Summary({ refs, kpis, verified, pending }: { refs: ArtRef[]; kpis: Parameters<typeof KpiStrip>[0]['items']; verified: number; pending: number }) {
  const stageMap = useResults((s) => s.stage);
  const byType = ALL_TYPES.map((t) => ({ t, n: refs.filter((r) => r.artifact.type === t).length })).filter((x) => x.n).sort((a, b) => b.n - a.n);
  const maxT = Math.max(1, ...byType.map((x) => x.n));
  const stages = RELEASE_STAGES.map((st) => ({ st, n: refs.filter((r, i) => (stageMap[r.artifact.id] ?? defaultStage(r.artifact, i)) === st).length }));
  return (
    <div className="col rs-summary" style={{ gap: 'var(--gap)' }}>
      <KpiStrip items={kpis} />
      <div className="brk-bottom">
        <VerifPanel verified={verified} pending={pending} />
        <RecentPanel refs={refs} />
        <ProtectedPanel />
      </div>
      <div className="grid g-2">
        <Panel icon={Shapes} title="Artifacts by Type" help="results.library" delay={.35} className="bottom-panel">
          <div className="col" style={{ gap: 8 }}>
            {byType.map(({ t, n }, i) => (
              <div key={t} className="row" style={{ gap: 10, fontSize: 12.5 }}>
                <TypeIcon type={t} size={15} /><span style={{ width: 86, textTransform: 'capitalize' }}>{t}</span>
                <div className="grow" style={{ height: 8, borderRadius: 99, background: 'var(--panel-2)', overflow: 'hidden' }}>
                  <motion.div style={{ height: '100%', borderRadius: 99, background: `hsl(${TYPE_HUE[t]} 85% 58%)`, boxShadow: `0 0 10px hsl(${TYPE_HUE[t]} 90% 60% / .6)` }} initial={{ width: 0 }} animate={{ width: `${(n / maxT) * 100}%` }} transition={{ delay: .4 + i * .05, duration: .6 }} />
                </div>
                <b className="tnum" style={{ width: 24, textAlign: 'right' }}>{n}</b>
              </div>
            ))}
          </div>
        </Panel>
        <Panel icon={Rocket} title="Release Pipeline" help="results.release" delay={.4} className="bottom-panel">
          <div className="rs-stages">
            {stages.map(({ st, n }, i) => (
              <motion.div key={st} className="rs-stage" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .45 + i * .06 }}>
                <b className="tnum">{n}</b><span>{st}</span>
              </motion.div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

const ALL_TYPES: ArtifactType[] = ['website', 'document', 'image', 'dataset', 'code', 'report', 'recipe', 'screenshot', 'video'];

/* ---------------------------------------------------------------- */
function Library({ refs }: { refs: ArtRef[] }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState<ArtifactType | 'all'>('all');
  const [mission, setMission] = useState('all');
  const [ver, setVer] = useState<'all' | 'verified' | 'pending'>('all');
  const counts = useMemo(() => { const c: Record<string, number> = {}; refs.forEach((r) => { c[r.artifact.type] = (c[r.artifact.type] ?? 0) + 1; }); return c; }, [refs]);
  const missionIds = Array.from(new Set(refs.map((r) => r.mission.id)));
  const list = refs.filter((r) => (type === 'all' || r.artifact.type === type) && (mission === 'all' || r.mission.id === mission) && (ver === 'all' || (ver === 'verified') === r.artifact.versions[0].verified) && (r.artifact.name + r.artifact.tags.join(' ') + r.mission.title).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="input-wrap" style={{ width: 250 }}><Search size={15} /><input className="input" placeholder="Search names, tags, missions" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search artifacts" /></div>
        <select className="select" style={{ width: 170 }} value={mission} onChange={(e) => setMission(e.target.value)} aria-label="Filter by mission"><option value="all">All missions</option>{missionIds.map((m) => <option key={m} value={m}>{m}</option>)}</select>
        <Segmented ariaLabel="Verification filter" size="sm" value={ver} onChange={setVer} options={[{ key: 'all', label: 'All' }, { key: 'verified', label: 'Verified' }, { key: 'pending', label: 'Pending' }]} />
        <span className="spacer" /><HelpTrigger k="results.library" /><span className="dim" style={{ fontSize: 12 }}>{list.length} of {refs.length}</span>
      </div>
      <div className="brk-pillrow">
        <button className={cx('chip pill', type === 'all' && 'solid')} style={{ cursor: 'pointer', height: 26, ['--h' as string]: 215 }} onClick={() => setType('all')}>All ({refs.length})</button>
        {ALL_TYPES.filter((t) => counts[t]).map((t) => <button key={t} className={cx('chip pill', type === t && 'solid')} style={{ cursor: 'pointer', height: 26, ['--h' as string]: TYPE_HUE[t] }} onClick={() => setType(t)}><TypeIcon type={t} size={12} />{t} ({counts[t]})</button>)}
      </div>
      {list.length === 0 ? <EmptyState icon={Package} title="No artifacts match" body="Adjust the filters." action={<button className="btn" onClick={() => { setQ(''); setType('all'); setMission('all'); setVer('all'); }}>Clear filters</button>} /> : (
        <div className="rv-grid brk-scroll" style={{ maxHeight: 520 }}>
          <AnimatePresence mode="popLayout">
            {list.map((r, i) => {
              const a = r.artifact, v = a.versions[0];
              return (
                <motion.div key={a.id} layout initial={{ opacity: 0, y: 12, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: .95 }} transition={{ delay: Math.min(i, 12) * .03 }}
                  className="subpanel glass-card hoverable rv-card" style={{ ['--h' as string]: TYPE_HUE[a.type] }} role="button" tabIndex={0}
                  onClick={() => openDialog('artifact-preview', { missionId: r.mission.id, artifactId: a.id })} onKeyDown={(e) => { if (e.key === 'Enter') openDialog('artifact-preview', { missionId: r.mission.id, artifactId: a.id }); }}>
                  <div className="rv-thumb"><div className="lines">{[70, 45, 82, 58].map((w, k) => <i key={k} style={{ width: `${w}%` }} />)}</div><motion.span animate={{ y: [0, -3, 0] }} transition={{ duration: 3 + (i % 3), repeat: Infinity, ease: 'easeInOut' }} style={{ position: 'relative' }}><TypeIcon type={a.type} size={34} /></motion.span></div>
                  <div className="row" style={{ gap: 6 }}><b className="ellipsis grow" style={{ fontSize: 13.5 }}>{a.name}</b><Chip hue={TYPE_HUE[a.type]} size="sm">{v.v}</Chip></div>
                  <div className="row" style={{ gap: 8, fontSize: 11.5 }}><span className="mono dim">{r.mission.id}</span><VerifyBadge verified={v.verified} /><span className="spacer" /><span className="dim">{v.size}</span></div>
                  <div className="dim ellipsis" style={{ fontSize: 11.5 }}>{a.versions.length} versions · {AGENT_BY_ID[v.by]?.name} · {ago(v.agoMin)}</div>
                  <div className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                    <IconButton icon={Eye} label="Preview" size="xs" onClick={() => openDialog('artifact-preview', { missionId: r.mission.id, artifactId: a.id })} />
                    <IconButton icon={History} label="Versions" size="xs" onClick={() => openDialog('artifact-versions', { missionId: r.mission.id, artifactId: a.id })} />
                    <IconButton icon={Download} label="Download latest" size="xs" onClick={() => downloadVersion(a, v)} />
                    {a.runnable && <IconButton icon={Play} label="Run safe preview" size="xs" onClick={() => openDialog('artifact-run', { missionId: r.mission.id, artifactId: a.id })} />}
                    <span className="spacer" /><span className="brk-pillrow">{Array.from(new Set(a.tags)).slice(0, 2).map((t) => <span key={t} className="badge">{t}</span>)}</span>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
function Previews({ refs }: { refs: ArtRef[] }) {
  const runnable = refs.filter((r) => r.artifact.runnable);
  const [id, setId] = useState(runnable[0]?.artifact.id);
  const [live, setLive] = useState<Record<string, number>>({});
  const [bump, setBump] = useState(0);
  const cur = runnable.find((r) => r.artifact.id === id) ?? runnable[0];
  const [secs, setSecs] = useState(0);
  const isLive = cur && live[cur.artifact.id] !== undefined;
  useEffect(() => { if (!isLive) { setSecs(0); return; } const t = window.setInterval(() => setSecs((s) => s + 1), 1000); return () => window.clearInterval(t); }, [isLive, cur?.artifact.id]);
  if (!cur) return <EmptyState icon={MonitorPlay} title="No runnable artifacts" body="Websites, code and recipes appear here." />;
  const a = cur.artifact, v = a.versions[0];
  const logs = ['sandbox: allocate read-only workspace', 'net: egress blocked (allowlist empty)', `serve: ${a.name} ${v.v}`, 'health: GET / 200 (38 ms)', 'csp: default-src self'];
  return (
    <div className="brk-split">
      <div className="col" style={{ gap: 10 }}>
        <div className="rv-preview-frame">
          <FakeBrowser sandbox origin="https://preview.sandbox.axion.local" path={`/${a.id.toLowerCase()}`} title={a.name.slice(0, 18)} state={isLive ? 'active' : 'idle'} target={isLive ? 'read' : 'none'} tsLabel={`${v.v}${isLive ? ` · up ${secs}s` : ''}`} tickKey={bump} small={false} />
        </div>
        <div className="brk-toolbar">
          <button className="btn primary" onClick={() => { if (!isLive) { setLive((l) => ({ ...l, [a.id]: Date.now() })); toast({ tone: 'success', title: 'Safe preview launched (demo)', body: 'Isolated sandbox, no network, auto-expires in 30 min.' }); } else openDialog('artifact-run', { missionId: cur.mission.id, artifactId: a.id }); }}><Rocket size={14} />{isLive ? 'Preview options' : 'Launch safe preview'}</button>
          <button className="btn" disabled={!isLive} onClick={() => { setBump((b) => b + 1); setSecs(0); toast({ tone: 'info', title: 'Sandbox restarted (demo)' }); }}><RotateCcw size={14} />Restart</button>
          <button className="btn" onClick={() => openDialog('compare-versions', { missionId: cur.mission.id, artifactId: a.id })}><GitCompare size={14} />Compare</button>
          <span className="spacer" />
          <Chip hue={isLive ? 150 : 260} size="sm" pill>{isLive && <Dot tone="good" pulse />}{isLive ? 'online · healthy' : 'stopped'}</Chip>
        </div>
      </div>
      <div className="col" style={{ gap: 10 }}>
        <div className="subpanel col" style={{ gap: 6, maxHeight: 190, overflow: 'auto' }}>
          <span className="section-label">Runnable results</span>
          {runnable.map((r) => <button key={r.artifact.id} className={cx('rv-select-row', r.artifact.id === a.id && 'on')} onClick={() => setId(r.artifact.id)}><TypeIcon type={r.artifact.type} size={15} /><span className="grow ellipsis" style={{ fontSize: 12.5 }}>{r.artifact.name}</span><span className="mono dim" style={{ fontSize: 11 }}>{r.mission.id}</span></button>)}
        </div>
        <div className="subpanel">
          <div className="row" style={{ marginBottom: 6 }}><ScrollText size={14} className="info" /><b style={{ fontSize: 13 }}>Sandbox logs</b><span className="spacer" /><HelpTrigger k="results.preview" /></div>
          <div className="col mono" style={{ gap: 3, fontSize: 11 }}>{(isLive ? logs : logs.slice(0, 1)).map((l, i) => <motion.div key={l + isLive} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * .18 }}><span className="good">›</span> {l}</motion.div>)}</div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
function Timeline({ refs, sel, setSel }: { refs: ArtRef[]; sel: string; setSel: (s: string) => void }) {
  const missions = Array.from(new Set(refs.map((r) => r.mission.id)));
  const [mid, setMid] = useState(missions[0]);
  const items = refs.filter((r) => r.mission.id === mid).flatMap((r) => r.artifact.versions.map((v) => ({ r, v }))).sort((a, b) => a.v.agoMin - b.v.agoMin);
  const cur = items.find((x) => `${x.r.artifact.id}@${x.v.v}` === sel) ?? items[0];
  return (
    <div className="brk-split">
      <div className="col" style={{ gap: 10 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <select className="select" style={{ width: 280 }} value={mid} onChange={(e) => { setMid(e.target.value); setSel(''); }} aria-label="Mission">{missions.map((m) => <option key={m} value={m}>{m} · {refs.find((r) => r.mission.id === m)?.mission.title}</option>)}</select>
          <span className="dim" style={{ fontSize: 12 }}>{items.length} versions</span><HelpTrigger k="results.timeline" />
        </div>
        <div className="rv-tl brk-scroll" style={{ maxHeight: 440 }}>
          <AnimatePresence mode="popLayout">
            {items.map(({ r, v }, i) => {
              const k = `${r.artifact.id}@${v.v}`;
              return (
                <motion.button key={mid + k} layout initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ delay: i * .03 }} className={cx('subpanel glass-card hoverable rv-tl-item', cur && k === `${cur.r.artifact.id}@${cur.v.v}` && 'on')} style={{ color: 'var(--text)', textAlign: 'left' }} onClick={() => setSel(k)}>
                  <span className="rv-thumb" style={{ width: 34, height: 34, ['--h' as string]: TYPE_HUE[r.artifact.type], borderRadius: 8 }}><TypeIcon type={r.artifact.type} size={16} /></span>
                  <div style={{ minWidth: 0, flex: 1 }}><b className="ellipsis" style={{ display: 'block', fontSize: 13 }}>{r.artifact.name} <span className="mono dim">{v.v}</span></b><span className="dim" style={{ fontSize: 11.5 }}>{v.notes}</span></div>
                  <VerifyBadge verified={v.verified} compact /><span className="dim" style={{ fontSize: 11.5 }}>{ago(v.agoMin)}</span>
                </motion.button>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
      {cur && (
        <motion.div key={`${cur.r.artifact.id}@${cur.v.v}`} className="subpanel col" style={{ gap: 10 }} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}>
          <div className="row"><b>{cur.r.artifact.name}</b><span className="spacer" /><Chip hue={TYPE_HUE[cur.r.artifact.type]} size="sm">{cur.v.v}</Chip></div>
          <dl className="kv" style={{ margin: 0 }}><dt>Created</dt><dd>{ago(cur.v.agoMin)}</dd><dt>Contributor</dt><dd>{AGENT_BY_ID[cur.v.by]?.name}</dd><dt>Size</dt><dd>{cur.v.size}</dd><dt>Status</dt><dd><VerifyBadge verified={cur.v.verified} /></dd></dl>
          <div className="rv-hash dim">{cur.v.hash}</div>
          <div className="row wrap" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => openDialog('compare-versions', { missionId: cur.r.mission.id, artifactId: cur.r.artifact.id, version: cur.v.v })}><GitCompare size={13} />Compare to current</button>
            <button className="btn sm" onClick={() => downloadVersion(cur.r.artifact, cur.v)}><Download size={13} />Download</button>
            <button className="btn sm ghost" onClick={() => openDialog('artifact-versions', { missionId: cur.r.mission.id, artifactId: cur.r.artifact.id, version: cur.v.v })}><History size={13} />All versions</button>
          </div>
        </motion.div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
interface GNode { key: string; x: number; y: number; lane: number; label: string; kind: 'base' | 'commit' | 'merge'; r?: ArtRef; v?: ArtifactVersion; pending?: boolean }
function BranchGraph({ refs }: { refs: ArtRef[] }) {
  const missions = Array.from(new Set(refs.map((r) => r.mission.id)));
  const [mid, setMid] = useState(missions.find((m) => refs.filter((r) => r.mission.id === m).some((r) => r.artifact.versions.length > 2)) ?? missions[0]);
  const [pick, setPick] = useState<string>('');
  const arts = refs.filter((r) => r.mission.id === mid).slice(0, 4);
  const W = 880, H = 90 + arts.length * 78, X0 = 90;
  const maxAge = Math.max(...arts.flatMap((r) => r.artifact.versions.map((v) => v.agoMin)), 1);
  const xOf = (age: number) => X0 + 160 + ((maxAge - age) / maxAge) * (W - X0 - 160 - 300);
  const mainY = 50;
  const nodes: GNode[] = [{ key: 'base', x: X0, y: mainY, lane: -1, label: 'baseline', kind: 'base' }];
  const edges: { d: string; c: number; dashed?: boolean; key: string; delay: number }[] = [];
  const forks: { key: string; x: number; c: number; delay: number }[] = [];
  arts.forEach((r, li) => {
    const y = mainY + 78 * (li + 1);
    const vs = [...r.artifact.versions].reverse();
    const firstX = xOf(vs[0].agoMin);
    // fork junction on main: deeper lanes fork nearer the baseline (nested arcs), so no
    // branch-off curve ever crosses another lane's line, label or commit
    const fx = X0 + 40 + (arts.length - 1 - li) * 28;
    forks.push({ key: `f${li}`, x: fx, c: LANES[li], delay: .2 + li * .2 });
    // curve drops from the junction to the lane, then runs straight into the first commit's centre
    edges.push({ key: `b${li}`, d: `M${fx},${mainY} C${fx + 30},${mainY} ${fx + 4},${y} ${fx + 40},${y} L${firstX},${y}`, c: LANES[li], delay: .2 + li * .2 });
    vs.forEach((v) => nodes.push({ key: `${r.artifact.id}${v.v}`, x: xOf(v.agoMin), y, lane: li, label: v.v, kind: 'commit', r, v }));
    for (let k = 0; k < vs.length - 1; k++) edges.push({ key: `l${li}${k}`, d: `M${xOf(vs[k].agoMin)},${y} L${xOf(vs[k + 1].agoMin)},${y}`, c: LANES[li], delay: .4 + li * .2 + k * .1 });
    const last = vs[vs.length - 1];
    const lx = xOf(last.agoMin);
    const mx = Math.max(lx + 70, 640 + li * 60);
    const mergeKey = `m${li}`;
    nodes.push({ key: mergeKey, x: mx, y: mainY, lane: li, label: `main +${r.artifact.id.slice(-2)}`, kind: 'merge', r, v: last, pending: !last.verified });
    edges.push({ key: `e${li}`, d: `M${lx},${y} C${lx + 50},${y} ${mx - 50},${mainY} ${mx},${mainY}`, c: LANES[li], dashed: !last.verified, delay: .8 + li * .2 });
  });
  const sel = nodes.find((n) => n.key === pick) ?? nodes.find((n) => n.kind === 'merge') ?? nodes[0];
  const mergeXs = nodes.filter((n) => n.kind === 'merge').map((n) => n.x);
  return (
    <div className="brk-split">
      <div className="col" style={{ gap: 8 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <select className="select" style={{ width: 300 }} value={mid} onChange={(e) => { setMid(e.target.value); setPick(''); }} aria-label="Mission lineage">{missions.map((m) => <option key={m} value={m}>{m} · {refs.find((r) => r.mission.id === m)?.mission.title}</option>)}</select>
          <HelpTrigger k="results.branch" /><span className="spacer" />
          <span className="row dim" style={{ gap: 12, fontSize: 11.5 }}><span className="row" style={{ gap: 4 }}><i style={{ width: 16, borderTop: '2px solid var(--accent-2)', display: 'block' }} />commit</span><span className="row" style={{ gap: 4 }}><i style={{ width: 16, borderTop: '2px dashed var(--warn)', display: 'block' }} />merge pending checks</span></span>
        </div>
        <div className="subpanel" style={{ padding: 6, overflow: 'hidden' }}>
          <svg className="rv-graph" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Branch lineage graph">
            <defs>
              <filter id="rvg" filterUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
              <linearGradient id="rvmain" gradientUnits="userSpaceOnUse" x1={X0} x2={W - 60} y1="0" y2="0"><stop offset="0" stopColor="#8b5cf6" /><stop offset="1" stopColor="#22d3ee" /></linearGradient>
            </defs>
            <motion.path d={`M${X0},${mainY} L${W - 60},${mainY}`} stroke="url(#rvmain)" strokeWidth="5" strokeLinecap="round" fill="none" filter="url(#rvg)" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2 }} />
            <text x={X0 - 16} y={mainY + 4} fontSize="12" fontWeight="800" textAnchor="end" style={{ fill: 'var(--text)' }}>main</text>
            {arts.map((r, li) => <text key={r.artifact.id} x={xOf(r.artifact.versions[r.artifact.versions.length - 1].agoMin) - 12} y={mainY + 78 * (li + 1) - 16} fontSize="11" fontWeight="600" style={{ fill: `hsl(${LANES[li]} 85% 50%)` }}>{r.artifact.name.length > 24 ? r.artifact.name.slice(0, 23) + '…' : r.artifact.name}</text>)}
            {edges.map((e) => <motion.path key={mid + e.key} d={e.d} fill="none" stroke={`hsl(${e.c} 90% 62%)`} strokeWidth="3" strokeLinecap="round" strokeDasharray={e.dashed ? '7 6' : undefined} filter="url(#rvg)" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: .8, delay: e.delay }} />)}
            <circle r="5" fill="#fff" filter="url(#rvg)"><animateMotion dur="5s" repeatCount="indefinite" path={`M${X0},${mainY} L${W - 60},${mainY}`} /></circle>
            {mergeXs.length > 0 && edges.filter((e) => !e.dashed && e.key.startsWith('e')).map((e) => <circle key={'p' + e.key} r="4" fill={`hsl(${e.c} 95% 70%)`} filter="url(#rvg)"><animateMotion dur="3.4s" repeatCount="indefinite" path={e.d} /></circle>)}
            {forks.map((f) => (
              <motion.g key={mid + f.key} initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: f.delay, type: 'spring', stiffness: 380, damping: 16 }} style={{ transformOrigin: `${f.x}px ${mainY}px`, pointerEvents: 'none' }}>
                <circle cx={f.x} cy={mainY} r="6" fill="none" stroke={`hsl(${f.c} 95% 70%)`} strokeWidth="1.5" opacity=".5"><animate attributeName="r" values="6;11;6" dur="2.4s" repeatCount="indefinite" /><animate attributeName="opacity" values=".55;0;.55" dur="2.4s" repeatCount="indefinite" /></circle>
                <circle cx={f.x} cy={mainY} r="6" fill={`hsl(${f.c} 90% 58%)`} stroke="#fff" strokeWidth="2" filter="url(#rvg)" />
              </motion.g>
            ))}
            {nodes.map((n, i) => {
              const c = n.kind === 'base' ? 260 : LANES[n.lane];
              const on = sel?.key === n.key;
              return (
                <motion.g key={mid + n.key} className="rv-node" initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: .5 + i * .04, type: 'spring', stiffness: 320, damping: 18 }} style={{ transformOrigin: `${n.x}px ${n.y}px`, color: `hsl(${c} 95% 65%)` }} onClick={() => setPick(n.key)} tabIndex={0} role="button" aria-label={`${n.label} commit`} onKeyDown={(e) => { if (e.key === 'Enter') setPick(n.key); }}>
                  {on && <circle cx={n.x} cy={n.y} r={n.kind === 'merge' ? 17 : 14} fill="none" stroke={`hsl(${c} 95% 65%)`} strokeWidth="1.5" opacity=".6"><animate attributeName="r" values="12;19;12" dur="2s" repeatCount="indefinite" /></circle>}
                  <circle className="core" cx={n.x} cy={n.y} r={n.kind === 'merge' ? 10 : n.kind === 'base' ? 9 : 7} fill={n.pending ? 'var(--panel-solid)' : `hsl(${c} 90% 58%)`} stroke={`hsl(${c} 95% 72%)`} strokeWidth="2.5" />
                  {n.kind === 'merge' && <text x={n.x} y={n.y + 3.5} fontSize="9" textAnchor="middle" fontWeight="800" style={{ fill: n.pending ? 'var(--warn)' : '#04101f' }}>{n.pending ? '!' : '✓'}</text>}
                  <text x={n.x} y={n.kind === 'commit' ? n.y + 24 : n.y - 18} fontSize="10.5" textAnchor="middle" fontWeight="700">{n.label}</text>
                </motion.g>
              );
            })}
          </svg>
        </div>
      </div>
      <motion.div key={sel?.key} className="subpanel col" style={{ gap: 10 }} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}>
        <div className="row"><GitBranch size={16} className="info" /><b>{sel?.kind === 'base' ? 'Baseline' : sel?.kind === 'merge' ? 'Merge into main' : 'Commit'}</b><span className="spacer" />{sel?.v && <Chip hue={LANES[sel.lane]} size="sm">{sel.v.v}</Chip>}</div>
        {sel?.r && sel.v ? <>
          <dl className="kv" style={{ margin: 0 }}><dt>Artifact</dt><dd>{sel.r.artifact.name}</dd><dt>Source</dt><dd className="mono" style={{ fontSize: 11.5 }}>mission/{sel.r.mission.id.toLowerCase()}-{sel.r.artifact.id.slice(-2).toLowerCase()}</dd><dt>Target</dt><dd className="mono">main (protected)</dd><dt>Checks</dt><dd>{sel.v.verified ? <span className="good">12 passed</span> : <span className="warn">11 passed · 1 pending</span>}</dd><dt>Evidence</dt><dd>{sel.v.verified ? '3 verified items' : 'awaiting QA'}</dd><dt>By</dt><dd>{AGENT_BY_ID[sel.v.by]?.name}</dd></dl>
          <div className="rv-hash dim">{sel.v.hash}</div>
          <div className="row wrap" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => openDialog('compare-versions', { missionId: sel.r!.mission.id, artifactId: sel.r!.artifact.id, version: sel.v!.v })}><GitCompare size={13} />Inspect change</button>
            <button className="btn sm primary" onClick={() => openDialog('merge-proposal', { missionId: sel.r!.mission.id, artifactId: sel.r!.artifact.id, version: sel.v!.v })}><GitMerge size={13} />Propose merge</button>
          </div>
          <div className="dim row" style={{ gap: 6, fontSize: 11.5 }}><Lock size={12} />Merge is disabled until all gates pass; there is no one-click bypass.</div>
        </> : <p className="muted" style={{ margin: 0, fontSize: 13 }}>The baseline is the last released main. Mission lines branch from here, accumulate commits with evidence, and merge back only after review.</p>}
      </motion.div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
function Comparisons({ refs }: { refs: ArtRef[] }) {
  const multi = refs.filter((r) => r.artifact.versions.length > 1);
  const [aid, setAid] = useState(multi[0]?.artifact.id);
  const cur = multi.find((r) => r.artifact.id === aid) ?? multi[0];
  const [base, setBase] = useState('');
  const [head, setHead] = useState('');
  const [decided, setDecided] = useState<Record<string, string>>({});
  if (!cur) return <EmptyState icon={GitCompare} title="Nothing to compare" body="An artifact needs two versions." />;
  const vs = cur.artifact.versions;
  const b = vs.find((x) => x.v === base)?.v ?? vs[1].v, h = vs.find((x) => x.v === head)?.v ?? vs[0].v;
  const rows = diffLines(contentLines(cur.artifact, b), contentLines(cur.artifact, h));
  const adds = rows.filter((r) => r.kind === 'add').length, dels = rows.filter((r) => r.kind === 'del').length;
  const key = `${cur.artifact.id}${b}${h}`;
  const bench = [['Build size', 12, 'bad'], ['Visual diff', -78, 'good'], ['A11y score', 9, 'good'], ['Test duration', -14, 'good']] as const;
  return (
    <div className="brk-split">
      <div className="col" style={{ gap: 10 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <select className="select" style={{ width: 250 }} value={cur.artifact.id} onChange={(e) => { setAid(e.target.value); setBase(''); setHead(''); }} aria-label="Artifact">{multi.map((r) => <option key={r.artifact.id} value={r.artifact.id}>{r.mission.id} · {r.artifact.name}</option>)}</select>
          <select className="select" style={{ width: 90 }} value={b} onChange={(e) => setBase(e.target.value)} aria-label="Base version">{vs.map((x) => <option key={x.v}>{x.v}</option>)}</select>
          <ArrowRight size={16} className="muted" />
          <select className="select" style={{ width: 90 }} value={h} onChange={(e) => setHead(e.target.value)} aria-label="Head version">{vs.map((x) => <option key={x.v}>{x.v}</option>)}</select>
          <Chip hue={150} size="sm">+{adds}</Chip><Chip hue={350} size="sm">−{dels}</Chip><HelpTrigger k="results.compare" />
        </div>
        <div className="brk-scroll" style={{ maxHeight: 380 }}><DiffView key={key} rows={rows} /></div>
      </div>
      <div className="col" style={{ gap: 10 }}>
        <div className="subpanel">
          <div className="section-label" style={{ marginBottom: 8 }}>Before / after</div>
          <div className="grid g-2">{[b, h].map((v, i) => <div key={v}><FakeBrowser small origin="https://preview.sandbox.axion.local" path="/home" target="none" title={i ? 'after' : 'before'} tsLabel={v} cursor={{ x: 85, y: 90 }} state="active" /></div>)}</div>
        </div>
        <div className="subpanel col" style={{ gap: 8 }}>
          <div className="section-label">Benchmark deltas</div>
          {bench.map(([n, d, t], i) => <div key={n} className="row" style={{ fontSize: 12.5, gap: 8 }}><span style={{ width: 96 }}>{n}</span><span className="bar grow"><motion.i className={t} initial={{ width: 0 }} animate={{ width: `${Math.min(100, Math.abs(d) * 4 + 12)}%` }} transition={{ delay: .2 + i * .1, duration: .8 }} /></span><b className={t === 'good' ? 'good' : 'bad'} style={{ width: 48, textAlign: 'right' }}>{d > 0 ? '+' : ''}{d}%</b></div>)}
        </div>
        <div className="row" style={{ gap: 6 }}>
          {decided[key] ? <Chip hue={decided[key] === 'accepted' ? 150 : 350}>{decided[key]} with evidence</Chip> : <>
            <button className="btn good" onClick={() => { setDecided((d) => ({ ...d, [key]: 'accepted' })); toast({ tone: 'success', title: 'Change accepted (demo)', body: 'Evidence attached; merge still needs review.' }); }}><CheckCircle2 size={14} />Accept</button>
            <button className="btn danger" onClick={() => { setDecided((d) => ({ ...d, [key]: 'rejected' })); toast({ tone: 'warning', title: 'Change rejected (demo)' }); }}><XCircle size={14} />Reject</button></>}
          <button className="btn ghost" onClick={() => { const t = rows.map((r) => `${r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' '} ${r.text}`).join('\n'); import('@/data/results').then((m) => m.downloadText(`${cur.artifact.id}-${b}-${h}.diff`, t, 'text/plain')); toast({ tone: 'success', title: 'Diff exported' }); }}><Download size={14} />Export</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
function Downloads({ refs }: { refs: ArtRef[] }) {
  const pinned = useResults((s) => s.pinned);
  const [aid, setAid] = useState(refs[0]?.artifact.id);
  const [q, setQ] = useState('');
  const cur = refs.find((r) => r.artifact.id === aid) ?? refs[0];
  const [vsel, setVsel] = useState('');
  const [state, setState] = useState<'idle' | 'checking' | 'ok'>('idle');
  const [mh, setMh] = useState('');
  const a = cur.artifact;
  const ver = a.versions.find((x) => x.v === (vsel || pinned[a.id])) ?? a.versions[0];
  const manifest = useMemo(() => JSON.stringify(buildManifest([{ artifact: a, version: ver }]), null, 2), [a, ver]);
  useEffect(() => { setState('idle'); sha256Hex(manifest).then(setMh); }, [manifest]);
  const verify = () => { setState('checking'); window.setTimeout(() => setState('ok'), 900); };
  const list = refs.filter((r) => (r.artifact.name + r.mission.id).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="brk-split" style={{ gridTemplateColumns: 'minmax(220px, .8fr) minmax(0, 1.5fr) minmax(280px, 1fr)' }}>
      <div className="col" style={{ gap: 8 }}>
        <div className="input-wrap"><Search size={15} /><input className="input" placeholder="Find artifact" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find artifact" /></div>
        <div className="col brk-scroll" style={{ gap: 5, maxHeight: 400 }}>
          {list.map((r) => <button key={r.artifact.id} className={cx('rv-select-row', r.artifact.id === a.id && 'on')} onClick={() => { setAid(r.artifact.id); setVsel(''); }}><TypeIcon type={r.artifact.type} size={15} /><span className="grow" style={{ minWidth: 0 }}><span className="ellipsis" style={{ display: 'block', fontSize: 12.5 }}>{r.artifact.name}</span><span className="mono dim" style={{ fontSize: 10.5 }}>{r.mission.id} · {r.artifact.versions.length} v</span></span></button>)}
        </div>
      </div>
      <div className="col" style={{ gap: 8 }}>
        <div className="row"><b>{a.name}</b><HelpTrigger k="results.downloads" /><span className="spacer" /><button className="btn sm" onClick={() => openDialog('download-bundle', { missionId: cur.mission.id, artifactId: a.id, version: ver.v })}><Package size={13} />Bundle</button></div>
        <div className="table-wrap"><table className="table"><thead><tr><th /><th>Version</th><th>Checksum</th><th>Size</th><th>Created</th><th>Verified</th></tr></thead><tbody>
          {a.versions.map((x) => <tr key={x.v} onClick={() => setVsel(x.v)} style={{ cursor: 'pointer', background: x.v === ver.v ? 'rgba(var(--accent-2-rgb), .10)' : undefined }}><td><input type="radio" checked={x.v === ver.v} onChange={() => setVsel(x.v)} aria-label={`Select ${x.v}`} style={{ accentColor: 'var(--accent)' }} /></td><td><b>{x.v}</b></td><td className="mono dim" style={{ fontSize: 11 }}>{x.hash.slice(0, 22)}…</td><td className="tnum">{x.size}</td><td className="dim">{ago(x.agoMin)}</td><td><VerifyBadge verified={x.verified} compact /></td></tr>)}
        </tbody></table></div>
        <pre className="mono subpanel" style={{ margin: 0, fontSize: 10.5, maxHeight: 130, overflow: 'auto' }}>{manifest}</pre>
      </div>
      <motion.div key={a.id + ver.v} className="subpanel col" style={{ gap: 10 }} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}>
        <div className="row"><FileCheck2 size={16} className="good" /><b>{a.id}-{ver.v}.{EXT[a.type]}</b></div>
        <div><div className="section-label" style={{ marginBottom: 4 }}>Version checksum</div><div className="rv-hash">{ver.hash}</div><button className="btn sm ghost" style={{ marginTop: 4 }} onClick={() => { navigator.clipboard?.writeText(ver.hash).catch(() => undefined); toast({ tone: 'info', title: 'Checksum copied' }); }}><Copy size={12} />Copy</button></div>
        <div><div className="section-label" style={{ marginBottom: 4 }}>Manifest SHA-256 (live)</div><div className="rv-hash dim">{mh || '…'}</div></div>
        <AnimatePresence mode="wait">{state === 'ok' && <motion.div key="ok" className="brk-warnbox good" initial={{ opacity: 0, scale: .95 }} animate={{ opacity: 1, scale: 1 }}><ShieldCheck size={16} className="good" /><div>Hash verified: manifest digest matches the recomputed value.</div></motion.div>}</AnimatePresence>
        <div className="row wrap" style={{ gap: 6 }}>
          <button className="btn primary" onClick={() => downloadVersion(a, ver)}><Download size={14} />Download</button>
          <button className="btn" disabled={state === 'checking'} onClick={verify}><ShieldCheck size={14} />{state === 'checking' ? 'Verifying…' : 'Verify hash'}</button>
        </div>
        <div className="dim" style={{ fontSize: 11.5 }}>DEMO: the downloaded file is a real manifest JSON generated in your browser. Retained versions never change.</div>
      </motion.div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
const STAGE_META: Record<ReleaseStage, { icon: typeof Rocket; hue: number }> = { candidate: { icon: FlaskConical, hue: 270 }, tested: { icon: BadgeCheck, hue: 200 }, approved: { icon: ShieldCheck, hue: 40 }, deployed: { icon: Rocket, hue: 150 }, 'rolled back': { icon: Undo2, hue: 350 } };
function Releases({ refs }: { refs: ArtRef[] }) {
  const stageMap = useResults((s) => s.stage);
  const setStage = useResults((s) => s.setStage);
  const rel = refs.filter((r) => r.artifact.runnable);
  const stageOf = (r: ArtRef) => stageMap[r.artifact.id] ?? defaultStage(r.artifact, refs.indexOf(r));
  const [pick, setPick] = useState<string>('');
  const cur = rel.find((r) => r.artifact.id === pick) ?? rel[0];
  if (!cur) return <EmptyState icon={Rocket} title="No release candidates" />;
  const st = stageOf(cur);
  const good = cur.artifact.versions.find((v) => v.verified) ?? cur.artifact.versions[0];
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row"><span className="muted" style={{ fontSize: 13 }}>Current and last-known-good are always retained. Deploy and rollback need owner approval.</span><HelpTrigger k="results.release" /></div>
      <div className="rv-pipe">
        {RELEASE_STAGES.map((s, si) => {
          const M = STAGE_META[s];
          const items = rel.filter((r) => stageOf(r) === s);
          return (
            <motion.div key={s} className={cx('rv-stage', s === 'deployed' && 's-deployed', s === 'rolled back' && 's-rolled')} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: si * .07 }}>
              <h4 style={{ color: `hsl(${M.hue} 90% 68%)` }}><M.icon size={14} />{s}<span className="spacer" /><span className="badge">{items.length}</span></h4>
              <AnimatePresence initial={false}>
                {items.map((r) => <motion.button key={r.artifact.id} layout initial={{ opacity: 0, scale: .9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .9 }} className={cx('rv-rel', r.artifact.id === cur.artifact.id && 'on')} style={{ textAlign: 'left', color: 'var(--text)' }} onClick={() => setPick(r.artifact.id)}><b className="ellipsis" style={{ display: 'block' }}>{r.artifact.name}</b><span className="mono dim" style={{ fontSize: 10.5 }}>{r.mission.id} · {r.artifact.versions[0].v}</span></motion.button>)}
              </AnimatePresence>
              {si < 4 && <ArrowRight size={14} className="dim" style={{ position: 'absolute', right: -11, top: 14, zIndex: 2 }} />}
            </motion.div>
          );
        })}
      </div>
      <motion.div key={cur.artifact.id + st} className="subpanel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="row wrap" style={{ gap: 14 }}>
          <span className="rv-thumb" style={{ width: 52, height: 52, ['--h' as string]: TYPE_HUE[cur.artifact.type] }}><TypeIcon type={cur.artifact.type} size={22} /></span>
          <div style={{ minWidth: 200 }}><b>{cur.artifact.name}</b><div className="dim" style={{ fontSize: 12 }}>{cur.mission.id} · current <b>{cur.artifact.versions[0].v}</b> · last-known-good <b className="good">{good.v}</b></div></div>
          <Chip hue={STAGE_META[st].hue}>{st}</Chip>
          <div className="spacer" />
          <div className="row wrap" style={{ gap: 6 }}>
            {st === 'candidate' && <button className="btn" onClick={() => { setStage(cur.artifact.id, 'tested'); toast({ tone: 'success', title: 'Tests passed (demo)', body: 'Moved to tested.' }); }}><FlaskConical size={14} />Run tests</button>}
            {st === 'tested' && <button className="btn" onClick={() => { setStage(cur.artifact.id, 'approved'); toast({ tone: 'success', title: 'Review approved (demo)' }); }}><BadgeCheck size={14} />Approve</button>}
            {(st === 'approved' || st === 'rolled back') && <button className="btn primary" onClick={() => openDialog('deploy-approval', { missionId: cur.mission.id, artifactId: cur.artifact.id })}><Rocket size={14} />Request deployment</button>}
            {st === 'deployed' && <button className="btn danger" onClick={() => openDialog('rollback-confirm', { missionId: cur.mission.id, artifactId: cur.artifact.id })}><Undo2 size={14} />Rollback</button>}
            <button className="btn" onClick={() => openDialog('artifact-versions', { missionId: cur.mission.id, artifactId: cur.artifact.id })}><History size={14} />Versions</button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
function VerifPanel({ verified, pending }: { verified: number; pending: number }) {
  const segs = [{ label: 'Verified', value: verified, color: '#2ee98a' }, { label: 'Pending review', value: pending, color: '#fbbf24' }];
  return (
    <Panel icon={BadgeCheck} title="Verification" help="results.verification" delay={.2} className="bottom-panel">
      <div className="row" style={{ gap: 16 }}><Donut segs={segs} size={112} stroke={13} center={`${Math.round((verified / Math.max(1, verified + pending)) * 100)}%`} sub="verified" /><Legend segs={segs} total={verified + pending} /></div>
    </Panel>
  );
}
function RecentPanel({ refs }: { refs: ArtRef[] }) {
  const recent = refs.flatMap((r) => r.artifact.versions.map((v) => ({ r, v }))).sort((a, b) => a.v.agoMin - b.v.agoMin).slice(0, 4);
  return (
    <Panel icon={TrendingUp} title="Latest Versions" help="results.timeline" delay={.25} className="bottom-panel">
      <div className="col" style={{ gap: 8 }}>{recent.map(({ r, v }) => <div key={r.artifact.id + v.v} className="row" style={{ gap: 8, fontSize: 12.5 }}><TypeIcon type={r.artifact.type} size={15} /><span className="ellipsis grow">{r.artifact.name}</span><Chip hue={TYPE_HUE[r.artifact.type]} size="sm">{v.v}</Chip><span className="dim" style={{ minWidth: 70, textAlign: 'right', whiteSpace: 'nowrap' }}>{ago(v.agoMin)}</span></div>)}</div>
    </Panel>
  );
}
function ProtectedPanel() {
  const props = useResults((s) => s.proposals);
  return (
    <Panel icon={GitMerge} title="Protected Main" help="results.branch" delay={.3} className="bottom-panel">
      <div className="col" style={{ gap: 10 }}>
        <MeterRow label="Checks passing" value={92} color="good" /><MeterRow label="Independent QA" value={84} /><MeterRow label="Owner review" value={61} color="warn" />
        <div className="dim" style={{ fontSize: 12 }}>{props.length ? `${props.length} merge proposal(s) submitted this session: ${props.map((p) => p.id).join(', ')}` : 'No merge proposals yet. Propose from the Branch Graph.'}</div>
      </div>
    </Panel>
  );
}
