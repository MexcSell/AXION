import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Boxes, Plus, Search, Brain, Eye, Binary, Mic, Volume2, Languages, Server, KeyRound, Lock, ShieldCheck, ArrowUp, ArrowDown, X, CheckCircle2, AlertTriangle, Play,
  Activity, HeartPulse, Route, FlaskConical, BarChart3, Settings2, Cpu, Cloud, RefreshCcw, Braces, Wand2, Zap, Gauge, ArrowRight, Download, Sparkles, Waves, Layers,
} from 'lucide-react';
import { Panel, PageHeader } from '@/components/ui/Panel';
import { Tabs } from '@/components/ui/Tabs';
import { Chip, Dot } from '@/components/ui/Chips';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { IconButton } from '@/components/ui/IconButton';
import { Switch, Segmented } from '@/components/ui/Form';
import { EmptyState } from '@/components/ui/EmptyState';
import { AreaChart, ColumnBars, Donut, Legend, Sparkline } from '@/components/viz/Charts';
import { useTab } from '@/hooks/useTab';
import { toast, openDialog } from '@/store/ui';
import { seeded } from '@/data/agents';
import {
  MODELS, MODEL_BY_ID, PROVIDERS, ROUTE_ROLES, HEALTH_LABELS, healthSeries, INCIDENTS, PLAY_SAMPLES, useRoutes, useVoice, validateRoute,
  type ModelDef, type ModelKind,
} from '@/data/models';
import { KpiStrip, Heartbeat } from './_emuShared';

const TAB_ICONS = [Boxes, Server, Route, FlaskConical, BarChart3, HeartPulse];
const KIND_ICON = { LLM: Brain, Vision: Eye, Embeddings: Binary, STT: Mic, TTS: Volume2, Translation: Languages } as const;
const STATUS_HUE = { ready: 150, degraded: 40, disabled: 230, optional: 200 } as const;

export default function ModelsPage() {
  const [tab, setTab, tabs] = useTab('models');
  const [playModel, setPlayModel] = useState('claude-sonnet-5-5');
  const extra = useRoutes((s) => s.extra);
  const all = useMemo(() => [...extra, ...MODELS], [extra]);
  return (
    <div className="page">
      <PageHeader icon={Boxes} title="Models" help="models.page" sub="One gateway for every model. Roles are separate from providers, and secrets never leave the server."
        actions={<div className="row" style={{ gap: 8 }}><button className="btn primary" onClick={() => openDialog('model-add')}><Plus size={16} />Add model / provider</button></div>} />
      <KpiStrip items={[
        { key: 'm', icon: Boxes, value: all.filter((m) => m.status === 'ready').length, label: 'Ready Models', color: '#22d3ee', foot: <div className="kpi-label" style={{ fontSize: 12 }}>of {all.length} in catalog</div>, help: 'models.kpi.ready', onClick: () => setTab('Catalog') },
        { key: 'p', icon: Server, value: 3, label: 'Healthy Providers', color: '#2ee98a', foot: <div className="kpi-label" style={{ fontSize: 12 }}>1 degraded</div>, help: 'models.kpi.providers', onClick: () => setTab('Providers') },
        { key: 'l', icon: Zap, value: 720, suffix: ' ms', label: 'p50 Latency', color: '#a78bfa', delta: '-8%', down: true, help: 'models.kpi.latency', onClick: () => setTab('Health') },
        { key: 'e', icon: AlertTriangle, value: 0.4, decimals: 1, suffix: '%', label: 'Error Rate (24 h)', color: '#facc15', help: 'models.kpi.errors', onClick: () => setTab('Health') },
        { key: 'c', icon: Gauge, value: 58, suffix: '%', label: 'Prompt Cache Hit', color: '#3b82f6', delta: '+17 pp', help: 'models.kpi.cache', onClick: () => setTab('Usage') },
      ]} />
      <Panel className="emu-main" icon={Layers} title={tab} titleSize="lg" help={`models.tab.${tab.toLowerCase()}`} delay={.1}
        sub={<span className="muted">{{ Catalog: 'Every model by modality, with context and estimated cost.', Providers: 'Connections and encrypted credential status.', Routing: 'Role to model precedence with fallbacks.', Playground: 'Try prompts safely. No production routing.', Usage: 'Calls, tokens and speech by model.', Health: 'Latency, errors and incidents.' }[tab]}</span>}
        actions={<Tabs size="sm" variant="underline" tabs={tabs.map((t, i) => ({ key: t, label: t, icon: TAB_ICONS[i] }))} value={tab} onChange={setTab} ariaLabel="Models views" />}>
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .2 }} role="tabpanel" aria-label={tab}>
            {tab === 'Catalog' && <Catalog all={all} tryIt={(id) => { setPlayModel(id); setTab('Playground'); }} />}
            {tab === 'Providers' && <Providers />}
            {tab === 'Routing' && <Routing />}
            {tab === 'Playground' && <Playground all={all} model={playModel} setModel={setPlayModel} />}
            {tab === 'Usage' && <ModelUsage />}
            {tab === 'Health' && <Health />}
          </motion.div>
        </AnimatePresence>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Catalog({ all, tryIt }: { all: ModelDef[]; tryIt: (id: string) => void }) {
  const [kind, setKind] = useState<ModelKind | 'all'>('all');
  const [q, setQ] = useState('');
  const [localOnly, setLocalOnly] = useState(false);
  const [off, setOff] = useState<Record<string, boolean>>({});
  const kinds: ModelKind[] = ['LLM', 'Vision', 'Embeddings', 'STT', 'TTS', 'Translation'];
  const list = all.filter((m) => (kind === 'all' || m.kind === kind) && (!localOnly || m.local) && (m.id + m.name + m.provider).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <Tabs tabs={[{ key: 'all' as const, label: 'All', count: all.length }, ...kinds.map((k) => ({ key: k, label: k, icon: KIND_ICON[k], count: all.filter((m) => m.kind === k).length }))]} value={kind} onChange={setKind} ariaLabel="Model type" className="status-chips" />
        <span className="spacer" />
        <label className="row" style={{ gap: 8, fontSize: 12.5 }}>Local only<Switch checked={localOnly} onChange={setLocalOnly} label="Local models only" /></label>
        <div className="input-wrap" style={{ width: 220 }}><Search size={15} /><input className="input" placeholder="Search models..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search models" /></div>
      </div>
      {list.length === 0 ? <EmptyState icon={Boxes} title="No models match" body="Change the type filter or add a model." action={<button className="btn" onClick={() => openDialog('model-add')}>Add model</button>} /> : (
        <div className="emu-model-grid">
          <AnimatePresence mode="popLayout">
            {list.map((m, i) => {
              const K = KIND_ICON[m.kind];
              const disabled = off[m.id] ?? m.status === 'disabled';
              return (
                <motion.div key={m.id} layout className={'subpanel glass-card hoverable emu-model' + (disabled ? ' off' : '')} style={{ ['--h' as string]: m.hue }}
                  initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: .95 }} transition={{ delay: Math.min(i, 10) * .035 }}>
                  <div className="row" style={{ gap: 10 }}>
                    <span className="emu-model-ico"><K size={22} strokeWidth={1.7} /></span>
                    <div style={{ minWidth: 0, flex: 1 }}><b className="ellipsis" style={{ display: 'block' }}>{m.name}</b><span className="mono dim ellipsis" style={{ display: 'block', fontSize: 11 }}>{m.id}</span></div>
                    <Switch checked={!disabled} onChange={(v) => { setOff((o) => ({ ...o, [m.id]: !v })); toast({ tone: v ? 'success' : 'warning', title: `${m.name} ${v ? 'enabled' : 'disabled'} (demo)`, body: v ? 'Available to routing again.' : 'Routing will skip it and use fallbacks.' }); }} label={`Enable ${m.name}`} />
                  </div>
                  <p className="muted" style={{ fontSize: 12.5, margin: '8px 0', minHeight: 32 }}>{m.blurb}</p>
                  <div className="row wrap" style={{ gap: 5 }}>
                    <Chip hue={m.hue} size="sm">{m.kind}</Chip>
                    <Chip hue={STATUS_HUE[disabled ? 'disabled' : m.status]} size="sm">{disabled ? 'disabled' : m.status}</Chip>
                    {m.local ? <Chip hue={150} size="sm" icon={Cpu}>local</Chip> : <Chip hue={215} size="sm" icon={Cloud}>remote</Chip>}
                    {m.json && <Chip hue={165} size="sm" icon={Braces}>JSON</Chip>}
                  </div>
                  <dl className="emu-spec">
                    <div><dt>Context</dt><dd>{m.ctx}</dd></div>
                    <div><dt>Latency</dt><dd>{m.latencyMs} ms</dd></div>
                    <div><dt>Cost</dt><dd>{m.costIn == null ? '-' : m.costIn === 0 ? 'free' : `$${m.costIn}${m.costOut != null ? `/$${m.costOut}` : ''}`}<span className="dim"> {m.costIn ? m.costUnit : ''}</span></dd></div>
                  </dl>
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn sm" disabled={disabled} onClick={() => tryIt(m.id)}><Play size={13} />Try</button>
                    <button className="btn sm ghost" onClick={() => toast({ tone: 'info', title: `${m.name} details (demo)`, body: `Modalities: ${m.modalities.join(', ')}. Provider: ${m.provider}.` })}>Details</button>
                    <span className="spacer" />{m.modalities.map((x) => <span key={x} className="dim" style={{ fontSize: 10.5 }}>{x}</span>)}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
      <VoicePipeline />
    </div>
  );
}

/* ------------------------------------------------------------------ */
const VOICE_STAGES = [
  { key: 'mic', label: 'Mic consent', icon: Mic, model: 'Browser capture', hue: 40, out: 'Original audio (waveform)', sample: '[ 0:04 audio, not stored ]' },
  { key: 'stt', label: 'STT', icon: Waves, model: 'whisper-large-v4', hue: 195, out: 'Recognized text', sample: '今日の進捗を教えてください' },
  { key: 'tr', label: 'Translate', icon: Languages, model: 'translate-ja-en-v2', hue: 165, out: 'Translated text (optional)', sample: 'Please tell me today\'s progress.' },
  { key: 'llm', label: 'LLM', icon: Brain, model: 'claude-sonnet-5-5', hue: 275, out: 'Agent reply', sample: '12 missions active, 76% verified progress on M-126.' },
  { key: 'tts', label: 'TTS', icon: Volume2, model: 'local-tts-neural', hue: 330, out: 'Synthesized response', sample: '[ voice: Aria, 1.0x, vol 80 ]' },
];
export function VoicePipeline() {
  const v = useVoice();
  const [step, setStep] = useState(-1);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearInterval(timer.current), []);
  const run = () => {
    if (!v.consent) { toast({ tone: 'warning', title: 'Microphone consent is off', body: 'Open Voice settings and grant consent before a voice turn. Nothing was recorded.' }); return; }
    window.clearInterval(timer.current);
    let i = 0; setStep(0);
    timer.current = window.setInterval(() => { i++; if (i >= VOICE_STAGES.length) { window.clearInterval(timer.current); setTimeout(() => setStep(-1), 1400); setStep(VOICE_STAGES.length); toast({ tone: 'success', title: 'Voice turn complete (demo)', body: 'No real audio was captured.' }); } else setStep(i); }, 900);
  };
  const stages = v.translate ? VOICE_STAGES : VOICE_STAGES.filter((s) => s.key !== 'tr');
  return (
    <div className="subpanel emu-voice">
      <div className="row wrap" style={{ gap: 10, marginBottom: 12 }}>
        <Mic size={19} className="warn" /><b style={{ fontSize: 15 }}>Voice pipeline</b><Chip hue={200} size="sm">optional</Chip><HelpTrigger k="models.voice" /><span className="spacer" />
        <span className="row" style={{ gap: 6, fontSize: 12.5 }}>Consent<Switch checked={v.consent} onChange={(c) => v.set({ consent: c })} label="Microphone consent" /></span>
        <button className="btn sm" onClick={() => openDialog('voice-settings')}><Settings2 size={14} />Voice settings</button>
        <button className="btn sm primary" onClick={run}><Play size={14} />Simulate voice turn</button>
      </div>
      <div className="emu-vp">
        {stages.map((s, i) => {
          const idx = VOICE_STAGES.indexOf(s);
          const st = step === VOICE_STAGES.length || idx < step ? 'done' : idx === step ? 'now' : '';
          return (
            <div key={s.key} className="row" style={{ gap: 0, flex: 1, minWidth: 0 }}>
              <motion.div className={'emu-vp-node ' + st + (s.key === 'mic' && !v.consent ? ' blocked' : '')} style={{ ['--h' as string]: s.hue }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .1 + i * .07 }}>
                <span className="emu-vp-ring"><s.icon size={22} />{s.key === 'mic' && !v.consent && <Lock size={11} className="emu-vp-lock" />}</span>
                <b>{s.label}</b>
                <span className="mono dim" style={{ fontSize: 10.5 }}>{s.model}</span>
                <div className="emu-vp-out"><span className="dim" style={{ fontSize: 10 }}>{s.out}</span><span style={{ fontSize: 11.5 }}>{s.key === 'tts' ? `[ ${v.voice}, ${v.rate}x, vol ${v.volume} ]` : s.sample}</span></div>
                {s.key === 'mic' && <div className="emu-wave" aria-hidden>{Array.from({ length: 16 }, (_, k) => <i key={k} style={{ animationDelay: `${k * .07}s`, animationPlayState: st === 'now' ? 'running' : 'paused' }} />)}</div>}
              </motion.div>
              {i < stages.length - 1 && <div className={'emu-vp-link ' + (idx < step || step === VOICE_STAGES.length ? 'done' : '')}><i /><ArrowRight size={14} /></div>}
            </div>
          );
        })}
      </div>
      <div className="row wrap dim" style={{ gap: 14, fontSize: 11.5, marginTop: 10 }}>
        <span><Lock size={11} style={{ display: 'inline' }} /> {v.retention}</span><span>Language: {v.lang === 'ja' ? 'Japanese to English' : v.lang}</span><span>Translate step: {v.translate ? 'on' : 'off'}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Providers() {
  const [state, setState] = useState<Record<string, 'idle' | 'testing' | 'ok' | 'warn'>>({});
  const test = (id: string, healthy: boolean) => {
    setState((s) => ({ ...s, [id]: 'testing' }));
    setTimeout(() => { setState((s) => ({ ...s, [id]: healthy ? 'ok' : 'warn' })); toast({ tone: healthy ? 'success' : 'warning', title: healthy ? 'Connection OK (demo)' : 'Connection slow (demo)', body: 'Credential validated server-side. The secret was never displayed.' }); }, 1300);
  };
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row emu-note"><Lock size={16} className="good" /><span><b>Credentials are encrypted and write-only.</b> The browser only ever sees a reference and a status. Rotate a key to replace it; you cannot read it back.</span></div>
      <div className="grid g-2">
        {PROVIDERS.map((p, i) => {
          const st = state[p.id] ?? 'idle';
          const hue = p.health === 'healthy' ? 150 : p.health === 'degraded' ? 40 : p.health === 'down' ? 350 : 215;
          return (
            <motion.div key={p.id} className="subpanel glass-card hoverable" style={{ padding: 14 }} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .07 }}>
              <div className="row" style={{ gap: 10 }}>
                <span className="emu-model-ico" style={{ ['--h' as string]: hue }}>{p.kind === 'local' ? <Cpu size={20} /> : <Cloud size={20} />}</span>
                <div style={{ minWidth: 0 }}><b>{p.name}</b><div className="mono dim" style={{ fontSize: 11.5 }}>{p.endpoint} · {p.region}</div></div>
                <span className="spacer" /><Chip hue={hue} size="sm">{p.health === 'idle' ? 'standby' : p.health}</Chip>
              </div>
              <div className="emu-cred">
                <KeyRound size={16} className={p.credential === 'expiring' ? 'warn' : 'good'} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row" style={{ gap: 6, fontSize: 12.5, fontWeight: 600 }}>{p.credential === 'none' ? 'No credential needed' : p.credential === 'expiring' ? 'Encrypted · rotation due' : 'Encrypted at rest'}{p.credential !== 'none' && <span className="emu-mask" aria-label="secret hidden">••••••••••••</span>}</div>
                  <div className="mono dim ellipsis" style={{ fontSize: 11 }}>{p.credRef}{p.rotated !== 'n/a' ? ` · rotated ${p.rotated}` : ''}</div>
                </div>
                {p.credential !== 'none' && <Chip hue={p.credential === 'expiring' ? 40 : 150} size="sm" icon={ShieldCheck}>{p.credential === 'expiring' ? 'expiring' : 'valid'}</Chip>}
              </div>
              <div className="row" style={{ gap: 14, margin: '10px 0' }}>
                <div style={{ flex: 1 }}><div className="dim" style={{ fontSize: 11.5 }}>p50 latency, 24 h</div><Sparkline data={p.latency} w={180} h={34} color={`hsl(${hue} 90% 60%)`} /></div>
                <div style={{ textAlign: 'right' }}><div className="dim" style={{ fontSize: 11.5 }}>{p.models} models</div><b className="display" style={{ fontSize: 18 }}>{p.latency[p.latency.length - 1]} ms</b></div>
              </div>
              {p.quota > 0 && <div className="row" style={{ gap: 8, fontSize: 12 }}><span className="dim" style={{ width: 80 }}>Quota used</span><div className={'bar thin' + (p.quota > 60 ? ' warn' : ' good')} style={{ flex: 1 }}><motion.i initial={{ width: 0 }} animate={{ width: `${p.quota}%` }} transition={{ duration: 1 }} /></div><b className="tnum">{p.quota}%</b></div>}
              <div className="row" style={{ gap: 6, marginTop: 12 }}>
                <button className="btn sm" disabled={st === 'testing'} onClick={() => test(p.id, p.health !== 'degraded')}>
                  {st === 'testing' ? <><RefreshCcw size={13} className="emu-spin" />Testing...</> : st === 'ok' ? <><CheckCircle2 size={13} className="good" />Connected</> : st === 'warn' ? <><AlertTriangle size={13} className="warn" />Slow</> : <><Activity size={13} />Test connection</>}
                </button>
                {p.credential !== 'none' && <button className="btn sm ghost" onClick={() => toast({ tone: 'info', title: 'Rotate credential (demo)', body: 'You would paste a new key into a write-only field. The old one is revoked after a successful test.' })}><KeyRound size={13} />Rotate</button>}
                <button className="btn sm ghost" onClick={() => openDialog('model-add', { provider: p.id })}>Add model</button>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Routing() {
  const { routes, caps, setRoute, setCap } = useRoutes();
  const extra = useRoutes((s) => s.extra);
  const [checked, setChecked] = useState(false);
  const move = (role: string, i: number, d: -1 | 1) => {
    const l = [...routes[role]]; const j = i + d; if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]]; setRoute(role, l);
  };
  const dragRef = useRef<{ role: string; i: number } | null>(null);
  const all = [...extra, ...MODELS];
  const problems = ROUTE_ROLES.flatMap((r) => validateRoute(r.role, routes[r.role]).map((p) => ({ role: r.role, p })));
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row wrap emu-note">
        <Route size={16} className="info" /><span>The first model is tried first. If it is unavailable, over budget or incompatible, the next one is used. Drag a row or use the arrows.</span><HelpTrigger k="models.routing" /><span className="spacer" />
        <button className="btn sm primary" onClick={() => { setChecked(true); toast(problems.length ? { tone: 'warning', title: `${problems.length} routing warnings (demo)`, body: 'Review the amber notes under each role.' } : { tone: 'success', title: 'Routing is valid (demo)' }); }}><ShieldCheck size={14} />Validate routing</button>
      </div>
      <div className="grid g-2">
        {ROUTE_ROLES.map((r, ri) => {
          const list = routes[r.role];
          const issues = validateRoute(r.role, list);
          return (
            <motion.div key={r.role} className="subpanel glass-card" style={{ padding: 14 }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: ri * .05 }}>
              <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                <b style={{ fontSize: 15 }}>{r.role}</b><span className="dim" style={{ fontSize: 12 }}>{r.hint}</span><span className="spacer" />
                {checked && (issues.length ? <Chip hue={40} size="sm" icon={AlertTriangle}>{issues.length} warning</Chip> : <Chip hue={150} size="sm" icon={CheckCircle2}>valid</Chip>)}
                <IconButton icon={Settings2} label={`Edit ${r.role} route`} size="xs" onClick={() => openDialog('model-route-editor', { role: r.role })} />
              </div>
              <div className="col" style={{ gap: 5 }}>
                <AnimatePresence initial={false}>
                  {list.map((id, i) => {
                    const m = MODEL_BY_ID[id] ?? all.find((x) => x.id === id);
                    if (!m) return null;
                    const K = KIND_ICON[m.kind];
                    return (
                      <motion.div key={id} layout className="emu-route" draggable
                        onDragStart={() => { dragRef.current = { role: r.role, i }; }} onDragOver={(e) => e.preventDefault()}
                        onDrop={() => { const d = dragRef.current; if (d && d.role === r.role && d.i !== i) { const l = [...list]; const [x] = l.splice(d.i, 1); l.splice(i, 0, x); setRoute(r.role, l); } dragRef.current = null; }}
                        transition={{ type: 'spring', stiffness: 400, damping: 34 }}>
                        <span className={'emu-rank' + (i === 0 ? ' p' : '')}>{i === 0 ? 'P' : i}</span>
                        <K size={15} style={{ color: `hsl(${m.hue} 90% 62%)` }} />
                        <span className="ellipsis" style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{m.name}</span>
                        <Chip hue={STATUS_HUE[m.status]} size="sm">{i === 0 ? 'primary' : `fallback ${i}`}</Chip>
                        <IconButton icon={ArrowUp} label={`Move ${m.name} up`} size="xs" onClick={() => move(r.role, i, -1)} disabled={i === 0} />
                        <IconButton icon={ArrowDown} label={`Move ${m.name} down`} size="xs" onClick={() => move(r.role, i, 1)} disabled={i === list.length - 1} />
                        <IconButton icon={X} label={`Remove ${m.name}`} size="xs" onClick={() => setRoute(r.role, list.filter((x) => x !== id))} />
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
              <AnimatePresence>
                {checked && issues.map((p) => <motion.div key={p} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0 }} className="warn" style={{ fontSize: 12, marginTop: 6 }}><AlertTriangle size={12} style={{ display: 'inline', verticalAlign: -2 }} /> {p}</motion.div>)}
              </AnimatePresence>
              <div className="row" style={{ gap: 8, marginTop: 10, fontSize: 12 }}>
                <span className="dim">Daily budget cap</span><input type="range" className="range" min={20} max={1500} step={10} value={caps[r.role]} onChange={(e) => setCap(r.role, +e.target.value)} aria-label={`${r.role} daily budget cap`} style={{ flex: 1 }} /><b className="tnum" style={{ width: 52, textAlign: 'right' }}>${caps[r.role]}</b>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function useTypewriter(text: string, run: number, speed = 14) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!run) { setN(0); return; }
    setN(0);
    const id = window.setInterval(() => setN((x) => { if (x >= text.length) { window.clearInterval(id); return x; } return x + Math.max(1, Math.round(text.length / 120)); }), speed);
    return () => window.clearInterval(id);
  }, [text, run, speed]);
  return Math.min(n, text.length);
}

function Playground({ all, model, setModel }: { all: ModelDef[]; model: string; setModel: (m: string) => void }) {
  const [sample, setSample] = useState(PLAY_SAMPLES[0].key);
  const s = PLAY_SAMPLES.find((x) => x.key === sample)!;
  const [prompt, setPrompt] = useState(s.prompt);
  const [temp, setTemp] = useState(0.2);
  const [expectJson, setExpectJson] = useState(true);
  const [compare, setCompare] = useState(false);
  const [run, setRun] = useState(0);
  const [other, setOther] = useState('claude-haiku-5-5');
  useEffect(() => { setPrompt(s.prompt); setExpectJson(s.json); setRun(0); }, [sample]); // eslint-disable-line react-hooks/exhaustive-deps
  const llms = all.filter((m) => m.kind === 'LLM' || m.kind === 'Vision' || m.kind === 'Translation');
  return (
    <div className="emu-split wide">
      <div className="col" style={{ gap: 10 }}>
        <div className="grid g-2" style={{ gap: 10 }}>
          <div className="field"><label className="field-label">Model</label><select className="select" value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model">{llms.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
          <div className="field"><label className="field-label">Sample</label><select className="select" value={sample} onChange={(e) => setSample(e.target.value)} aria-label="Sample prompt">{PLAY_SAMPLES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></div>
        </div>
        <div className="field"><label className="field-label">Prompt</label><textarea className="textarea" rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="Prompt" data-autofocus /></div>
        <div className="row wrap" style={{ gap: 14, fontSize: 12.5 }}>
          <span className="row" style={{ gap: 8, flex: 1, minWidth: 180 }}>Temperature <input type="range" className="range" min={0} max={1} step={0.1} value={temp} onChange={(e) => setTemp(+e.target.value)} aria-label="Temperature" /><b className="tnum">{temp.toFixed(1)}</b></span>
          <Segmented ariaLabel="Expected format" size="sm" value={expectJson ? 'json' : 'text'} onChange={(k) => setExpectJson(k === 'json')} options={[{ key: 'text', label: 'Text' }, { key: 'json', label: <><Braces size={12} />JSON</> }]} />
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <label className="row" style={{ gap: 8, fontSize: 12.5 }}>Compare<Switch checked={compare} onChange={setCompare} label="Compare two models" /></label>
          {compare && <select className="select" style={{ width: 170 }} value={other} onChange={(e) => setOther(e.target.value)} aria-label="Compare with">{llms.filter((m) => m.id !== model).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}
          <span className="spacer" />
          <button className="btn" onClick={() => openDialog('model-playground', { model })}><FlaskConical size={14} />Benchmark test</button>
          <button className="btn primary" onClick={() => setRun((r) => r + 1)}><Play size={14} />Run</button>
        </div>
        <div className="dim" style={{ fontSize: 11.5 }}><Lock size={11} style={{ display: 'inline' }} /> Playground calls are isolated. They never change production routing.</div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: compare ? '1fr' : '1fr', gap: 10 }}>
        <Output model={MODEL_BY_ID[model] ?? all.find((m) => m.id === model)!} text={s.out} expectJson={expectJson} run={run} />
        {compare && <Output model={MODEL_BY_ID[other]} text={s.key === 'bad' ? s.out : s.out.replace(/evidence/g, 'proof')} expectJson={expectJson} run={run} alt />}
      </div>
    </div>
  );
}

function Output({ model, text, expectJson, run, alt }: { model: ModelDef; text: string; expectJson: boolean; run: number; alt?: boolean }) {
  const n = useTypewriter(text, run);
  const done = run > 0 && n >= text.length;
  const streaming = run > 0 && !done;
  const json = useMemo(() => { if (!expectJson) return { ok: true as const }; try { JSON.parse(text); return { ok: true as const }; } catch (e) { return { ok: false as const, err: (e as Error).message.replace(/^JSON\.parse: /, '') }; } }, [text, expectJson]);
  return (
    <div className="subpanel emu-out" style={{ minHeight: 200 }}>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <Sparkles size={15} className="violet" /><b style={{ fontSize: 13 }}>{model.name}</b>
        <span className="spacer" />
        {streaming && <Chip hue={200} size="sm"><Dot tone="info" pulse />streaming</Chip>}
        {done && <><span className="mono dim" style={{ fontSize: 11 }}>{Math.round(text.length / 3.6)} tok · {model.latencyMs + (alt ? 120 : 0)} ms</span>
          <AnimatePresence mode="wait"><motion.span key={json.ok ? 'ok' : 'bad'} initial={{ scale: .6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 18 }}>
            {!expectJson ? <Chip hue={215} size="sm">free text</Chip> : json.ok ? <Chip hue={150} size="sm" icon={CheckCircle2}>valid JSON</Chip> : <Chip hue={352} size="sm" icon={AlertTriangle}>invalid JSON</Chip>}
          </motion.span></AnimatePresence></>}
      </div>
      {run === 0 ? <div className="emu-out-empty"><Wand2 size={26} /><span>Press Run to stream a demo response.</span></div> : <pre className="emu-pre">{text.slice(0, n)}{streaming && <span className="emu-caret" />}</pre>}
      {done && expectJson && !json.ok && <div className="bad" style={{ fontSize: 12, marginTop: 8 }}>Schema check failed: {json.err}. The orchestrator would retry with a repair prompt.</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
function ModelUsage() {
  const [prov, setProv] = useState('all');
  const r = seeded('mu');
  const calls = Array.from({ length: 24 }, (_, i) => Math.round(2400 + Math.sin(i / 3) * 700 + r() * 500));
  const rows = [
    { id: 'claude-sonnet-5-5', prov: 'anthropic', calls: 48210, tok: '312M', err: 0.3, cost: 1120 }, { id: 'claude-haiku-5-5', prov: 'anthropic', calls: 91400, tok: '402M', err: 0.2, cost: 410 },
    { id: 'claude-opus-5-5', prov: 'anthropic', calls: 6120, tok: '38M', err: 0.6, cost: 760 }, { id: 'claude-fable-5-2', prov: 'anthropic', calls: 2900, tok: '54M', err: 0.4, cost: 330 },
    { id: 'whisper-large-v4', prov: 'local-speech', calls: 840, tok: '412 min', err: 0.1, cost: 0 }, { id: 'cloud-tts-studio', prov: 'cloud-speech', calls: 620, tok: '208 min', err: 2.1, cost: 96 },
    { id: 'translate-ja-en-v2', prov: 'anthropic', calls: 11340, tok: '18M', err: 0.2, cost: 44 }, { id: 'embed-text-v4', prov: 'anthropic', calls: 188000, tok: '96M', err: 0.0, cost: 80 },
  ].filter((x) => prov === 'all' || x.prov === prov);
  const segs = [{ label: 'Sonnet 5.5', value: 312, color: 'var(--info)' }, { label: 'Haiku 5.5', value: 402, color: 'var(--accent-2)' }, { label: 'Opus 5.5', value: 38, color: 'var(--violet)' }, { label: 'Fable 5.2', value: 54, color: 'var(--gold)' }];
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <select className="select" style={{ width: 190 }} value={prov} onChange={(e) => setProv(e.target.value)} aria-label="Filter provider"><option value="all">All providers</option>{PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <span className="spacer" /><button className="btn" onClick={() => toast({ tone: 'success', title: 'Export queued (demo)', body: 'CSV with model, tokens, minutes, cost and errors.' })}><Download size={14} />Export</button>
      </div>
      <div className="grid emu-bench-top">
        <div className="subpanel"><div className="row" style={{ marginBottom: 8, gap: 6 }}><b>Calls per hour (24 h)</b><HelpTrigger k="models.usage.calls" /></div><ColumnBars data={calls} h={150} color="var(--accent-2)" labels={calls.map((_, i) => (i % 4 === 0 ? String(i) : ''))} /></div>
        <div className="subpanel"><div className="row" style={{ marginBottom: 8, gap: 6 }}><b>Tokens by model (M)</b><HelpTrigger k="models.usage.tokens" /></div>
          <div className="row" style={{ gap: 18 }}><Donut segs={segs} size={132} center="806M" sub="tokens" /><Legend segs={segs} /></div></div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Model</th><th>Provider</th><th>Calls</th><th>Tokens / minutes</th><th>Error rate</th><th>Cost</th></tr></thead>
          <tbody>{rows.map((x) => <tr key={x.id}><td className="mono">{x.id}</td><td className="dim">{x.prov}</td><td className="tnum">{x.calls.toLocaleString()}</td><td className="tnum">{x.tok}</td><td className={'tnum ' + (x.err > 1 ? 'warn' : 'good')}>{x.err}%</td><td className="tnum"><b>${x.cost.toLocaleString()}</b></td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Health() {
  const [probe, setProbe] = useState<string | null>(null);
  const lat = PROVIDERS.filter((p) => p.id !== 'local-speech').map((p, i) => ({ label: p.name.split(' ')[0], data: healthSeries(p.id).latency, color: ['var(--info)', 'var(--good)', 'var(--warn)'][i] }));
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="grid g-4">
        {PROVIDERS.map((p, i) => {
          const h = healthSeries(p.id);
          const ok = p.health !== 'degraded';
          return (
            <motion.div key={p.id} className="subpanel glass-card hoverable" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .06 }}>
              <div className="row" style={{ gap: 6 }}><b className="ellipsis" style={{ fontSize: 13 }}>{p.name}</b><span className="spacer" /><Dot tone={ok ? 'good' : 'warn'} pulse /></div>
              <div style={{ margin: '6px 0' }}><Heartbeat ok={ok} w={200} h={36} /></div>
              <div className="row" style={{ justifyContent: 'space-between', fontSize: 11.5 }}><span className="dim">latency</span><Sparkline data={h.latency} w={90} h={22} color="var(--accent-2)" fill={false} /></div>
              <div className="row" style={{ justifyContent: 'space-between', fontSize: 11.5 }}><span className="dim">errors %</span><Sparkline data={h.errors} w={90} h={22} color={ok ? 'var(--good)' : 'var(--bad)'} fill={false} /></div>
              <div className="row" style={{ justifyContent: 'space-between', fontSize: 11.5, marginTop: 4 }}><span className="dim">retries</span><span>{ok ? '0 queued' : '6 queued, backoff 2 s'}</span></div>
            </motion.div>
          );
        })}
      </div>
      <div className="grid emu-bench-top">
        <div className="subpanel"><div className="row" style={{ gap: 8, marginBottom: 6 }}><b>Latency by provider (ms, 24 h)</b><HelpTrigger k="models.health.latency" /><span className="spacer" />{lat.map((s) => <span key={s.label} className="row" style={{ gap: 5, fontSize: 11.5 }}><span className="dot sm" style={{ color: s.color }} />{s.label}</span>)}</div>
          <AreaChart series={lat} labels={HEALTH_LABELS} h={170} unit=" ms" /></div>
        <div className="subpanel"><div className="row" style={{ gap: 8, marginBottom: 8 }}><b>Incidents</b><HelpTrigger k="models.incidents" /></div>
          <div className="col" style={{ gap: 8 }}>
            {INCIDENTS.map((n) => (
              <div key={n.id} className="emu-inc"><Dot tone={n.state === 'degraded' ? 'warn' : 'good'} pulse={n.state === 'degraded'} /><div style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: 12.5 }}>{n.what}</div><div className="dim" style={{ fontSize: 11 }}>{n.provider} · {n.t}</div></div>
                <button className="btn sm ghost" onClick={() => toast({ tone: 'info', title: `${n.id} (demo)`, body: 'Timeline, affected calls and fallback decisions open here.' })}>Inspect</button></div>
            ))}
          </div>
          <button className="btn sm" style={{ marginTop: 10 }} disabled={probe === 'run'} onClick={() => { setProbe('run'); setTimeout(() => { setProbe(null); toast({ tone: 'success', title: 'Safe probe finished (demo)', body: '1 token echo per provider. No mission traffic was affected.' }); }, 1500); }}>
            {probe === 'run' ? <><RefreshCcw size={13} className="emu-spin" />Probing...</> : <><Activity size={13} />Run safe test</>}</button></div>
      </div>
    </div>
  );
}

