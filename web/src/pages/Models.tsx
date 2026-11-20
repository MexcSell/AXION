import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Boxes, Plus, Search, Brain, Mic, Volume2, Languages, Server, KeyRound, Lock, ShieldCheck, ArrowUp, ArrowDown, X, CheckCircle2, AlertTriangle, Play,
  Activity, HeartPulse, Route, FlaskConical, BarChart3, Settings2, Cpu, Cloud, RefreshCcw, Braces, Wand2, Zap, ArrowRight, Download, Sparkles, Waves, Layers,
  SlidersHorizontal, MemoryStick, HardDrive, FileBox, ArrowUpDown, Ban, Ruler, Timer, ChevronRight,
} from 'lucide-react';
import { Navigate, useSearchParams } from 'react-router-dom';
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
  MODELS, MODEL_BY_ID, PROVIDERS, LOCAL_HOST, localFootprint, useModelState, ROUTE_ROLES, HEALTH_LABELS, healthSeries, INCIDENTS, PLAY_SAMPLES, useRoutes, useVoice, validateRoute,
  type ModelDef,
  usageShare, LOADER_PICKS,
} from '@/data/models';
import { Heartbeat } from './_emuShared';
import { KIND_ICON, RUNTIME, runtimeOf, UseRing, TraitBars, CapacityLine } from './_modelParts';

const TAB_ICONS = [SlidersHorizontal, Server, Route, FlaskConical, BarChart3, HeartPulse];
const STATUS_HUE = { ready: 150, degraded: 40, disabled: 230, optional: 200 } as const;
const TAB_SUB: Record<string, string> = { Manager: 'Characteristics, usage and local capacity per model.', Providers: 'Connections and encrypted credential status.', Routing: 'Role to model precedence with fallbacks.', Playground: 'Try prompts safely. No production routing.', Usage: 'Calls, tokens and speech by model.', Health: 'Latency, errors and incidents.' };

/** Old /models links land in System Operations › Models (owner update u1). */
export default function ModelsRedirect() {
  const [sp] = useSearchParams();
  const n = new URLSearchParams(sp);
  const t = n.get('tab'); n.delete('tab'); n.set('tab', 'models'); if (t) n.set('sub', t);
  return <Navigate to={`/operations?${n.toString()}`} replace />;
}

/** Models, embedded in System Operations: KPIs, actions, sub-tabs and body. */
export function useModelsSection() {
  const [tab, setTab, tabs] = useTab('models', 'sub');
  const [playModel, setPlayModel] = useState('claude-sonnet-5-5');
  const extra = useRoutes((s) => s.extra);
  const removed = useRoutes((s) => s.removed);
  const off = useRoutes((s) => s.off);
  const all = useMemo(() => [...extra, ...MODELS].filter((m) => !removed[m.id]), [extra, removed]);
  const ready = all.filter((m) => m.status === 'ready' && !off[m.id]).length;
  const foot = localFootprint(all);
  return {
    kpis: [
          { key: 'm', icon: Boxes, value: ready, label: 'Ready Models', color: '#22d3ee', hint: `of ${all.length} in catalog`, help: 'models.kpi.ready', onClick: () => setTab('Manager') },
          { key: 'p', icon: Server, value: PROVIDERS.filter((p) => p.health === 'healthy').length, label: 'Healthy Providers', color: '#2ee98a', hint: '1 degraded', help: 'models.kpi.providers', onClick: () => setTab('Providers') },
          { key: 'v', icon: MemoryStick, value: foot.vramGB, decimals: 1, suffix: ' GB', label: 'Local VRAM in use', color: '#fb923c', hint: `of ${LOCAL_HOST.vramGB} GB on ${LOCAL_HOST.gpu}`, bar: Math.round((foot.vramGB / LOCAL_HOST.vramGB) * 100), help: 'models.kpi.vram', onClick: () => setTab('Manager') },
          { key: 'l', icon: Zap, value: 720, suffix: ' ms', label: 'p50 Latency', color: '#a78bfa', delta: '-8%', down: true, help: 'models.kpi.latency', onClick: () => setTab('Health') },
          { key: 'e', icon: AlertTriangle, value: 0.4, decimals: 1, suffix: '%', label: 'Error Rate (24 h)', color: '#facc15', help: 'models.kpi.errors', onClick: () => setTab('Health') },
        ],
    actions: <><button className="btn" onClick={() => openDialog('model-add', { provider: 'local-ollama' })}><Download size={15} />Pull / import local</button><button className="btn primary" onClick={() => openDialog('model-add')}><Plus size={16} />Add model / provider</button></>,
    sub: { tabs, value: tab, onChange: setTab, icons: TAB_ICONS },
    toolbar: <span className="row" style={{ gap: 6 }}>{TAB_SUB[tab]}<HelpTrigger k={`models.tab.${tab.toLowerCase()}`} /></span>,
    bodyKey: tab,
    body: <>
      {tab === 'Manager' && <Manager all={all} />}
      {tab === 'Providers' && <Providers />}
      {tab === 'Routing' && <Routing />}
      {tab === 'Playground' && <Playground all={all} model={playModel} setModel={setPlayModel} />}
      {tab === 'Usage' && <ModelUsage />}
      {tab === 'Health' && <Health />}
    </>,
  };
}

/* ------------------------------------------------------------------ */
/* Manager — the model management window                               */
/* ------------------------------------------------------------------ */
type Cat = 'LLM' | 'TTS' | 'STT' | 'Local' | 'Other' | 'All';
const CATS: { key: Cat; label: string; sub: string; icon: typeof Brain; hue: number; test: (m: ModelDef) => boolean }[] = [
  { key: 'LLM', label: 'LLM', sub: 'Language models', icon: Brain, hue: 268, test: (m) => m.kind === 'LLM' },
  { key: 'TTS', label: 'TTS', sub: 'Text to speech', icon: Volume2, hue: 330, test: (m) => m.kind === 'TTS' },
  { key: 'STT', label: 'STT', sub: 'Speech to text', icon: Mic, hue: 40, test: (m) => m.kind === 'STT' },
  { key: 'Local', label: 'Local', sub: 'Ollama · GGUF', icon: Cpu, hue: 150, test: (m) => m.local },
  { key: 'Other', label: 'Other', sub: 'Vision · Embed · Translate', icon: Layers, hue: 200, test: (m) => ['Vision', 'Embeddings', 'Translation'].includes(m.kind) },
  { key: 'All', label: 'All', sub: 'Whole catalog', icon: Boxes, hue: 215, test: () => true },
];
type Sort = 'usage' | 'quality' | 'speed' | 'name';

function Manager({ all }: { all: ModelDef[] }) {
  const [sp, setSp] = useSearchParams();
  const cat = (CATS.find((c) => c.key.toLowerCase() === sp.get('cat'))?.key ?? 'LLM') as Cat;
  const setCat = (c: Cat) => setSp((p) => { const n = new URLSearchParams(p); n.set('cat', c.toLowerCase()); return n; }, { replace: true });
  const [q, setQ] = useState('');
  const [rt, setRt] = useState<'all' | 'ollama' | 'gguf'>('all');
  const [sort, setSort] = useState<Sort>('usage');
  const C = CATS.find((c) => c.key === cat)!;
  const pctOf = (m: ModelDef) => (m.usage ? usageShare(m, all) : m.weights?.loaded ? m.weights.memGB / LOCAL_HOST.vramGB : m.weights ? -0.5 : -1);
  const list = all.filter((m) => C.test(m) && (cat !== 'Local' || rt === 'all' || runtimeOf(m) === rt) && (m.id + m.name + m.provider + (m.traits?.strengths.join(' ') ?? '')).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'quality' ? (b.traits?.quality ?? 0) - (a.traits?.quality ?? 0) : sort === 'speed' ? (b.traits?.speed ?? 0) - (a.traits?.speed ?? 0) : pctOf(b) - pctOf(a));
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="mm-cats" role="tablist" aria-label="Model category">
        {CATS.map((c, i) => {
          const n = all.filter(c.test).length;
          const on = c.key === cat;
          return (
            <motion.button key={c.key} type="button" role="tab" aria-selected={on} className={'mm-cat' + (on ? ' on' : '')} style={{ ['--h' as string]: c.hue }} onClick={() => setCat(c.key)}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .04 }} whileTap={{ scale: .97 }}>
              {on && <motion.span layoutId="mm-cat-glow" className="mm-cat-glow" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
              <span className="mm-cat-ico"><c.icon size={19} /></span>
              <span className="mm-cat-t"><b>{c.label}</b><small>{c.sub}</small></span>
              <span className="mm-cat-n tnum">{n}</span>
            </motion.button>
          );
        })}
        <HelpTrigger k="models.manager.categories" />
      </div>
      {cat === 'Local' && <HostCapacity all={all} />}
      <div className="row wrap" style={{ gap: 10 }}>
        {cat === 'Local' && <Segmented ariaLabel="Local runtime" size="sm" value={rt} onChange={setRt} options={[{ key: 'all', label: 'All local' }, { key: 'ollama', label: 'Ollama' }, { key: 'gguf', label: 'GGUF' }]} />}
        <span className="dim" style={{ fontSize: 12.5 }}>{list.length} model{list.length === 1 ? '' : 's'} · click a card to manage it</span>
        <span className="spacer" />
        <label className="row" style={{ gap: 6, fontSize: 12.5 }}><ArrowUpDown size={14} className="dim" />
          <select className="select" style={{ width: 150, height: 32 }} value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort models">
            <option value="usage">Most used</option><option value="quality">Quality</option><option value="speed">Speed</option><option value="name">Name</option>
          </select><HelpTrigger k="models.manager.sort" /></label>
        <div className="input-wrap" style={{ width: 220 }}><Search size={15} /><input className="input" placeholder="Search models or strengths..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search models" /></div>
      </div>
      {list.length === 0 ? <EmptyState icon={Boxes} title="No models match" body="Change the category or search, or add a model." action={<button className="btn" onClick={() => openDialog('model-add')}>Add model</button>} /> : (
        <motion.div className="mm-grid" layout>
          <AnimatePresence mode="popLayout">
            {list.map((m, i) => <ModelCard key={m.id} m={m} i={i} all={all} />)}
          </AnimatePresence>
        </motion.div>
      )}
      {(cat === 'STT' || cat === 'TTS') && <VoicePipeline />}
    </div>
  );
}

function HostCapacity({ all }: { all: ModelDef[] }) {
  const f = localFootprint(all);
  return (
    <motion.div className="subpanel mm-host" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="mm-host-info">
        <div className="row" style={{ gap: 8 }}><Server size={18} className="good" /><b>{LOCAL_HOST.name}</b><HelpTrigger k="models.manager.host" /></div>
        <div className="dim" style={{ fontSize: 12 }}>{LOCAL_HOST.gpu} · {LOCAL_HOST.vramGB} GB VRAM · {LOCAL_HOST.ramGB} GB RAM</div>
        <div className="row wrap" style={{ gap: 5, marginTop: 6 }}>
          <Chip hue={150} size="sm" icon={Cpu}>Ollama {LOCAL_HOST.ollamaVersion}</Chip><Chip hue={28} size="sm" icon={FileBox}>llama.cpp {LOCAL_HOST.llamacppBuild}</Chip>
        </div>
        <div className="row" style={{ gap: 6, marginTop: 10 }}>
          <button className="btn sm" onClick={() => openDialog('model-add', { provider: 'local-ollama' })}><Download size={13} />Pull from Ollama</button>
          <button className="btn sm" onClick={() => openDialog('model-add', { provider: 'local-llamacpp' })}><FileBox size={13} />Import GGUF</button>
        </div>
      </div>
      <UseRing used={f.diskGB} total={LOCAL_HOST.diskGB} unit="GB" caption="Disk" icon={HardDrive} size={78} />
      <UseRing used={f.vramGB} total={LOCAL_HOST.vramGB} unit="GB" caption="VRAM" icon={MemoryStick} size={78} />
      <UseRing used={f.ramGB} total={LOCAL_HOST.ramGB} unit="GB" caption="RAM" icon={MemoryStick} size={78} />
    </motion.div>
  );
}

function ModelCard({ m, i, all }: { m: ModelDef; i: number; all: ModelDef[] }) {
  const st = useModelState(m);
  const setOff = useRoutes((s) => s.setOff);
  const K = KIND_ICON[m.kind];
  const R = RUNTIME[runtimeOf(m)];
  const open = () => openDialog('model-manage', { id: m.id });
  const status = st.disabled ? 'disabled' : m.status;
  return (
    <motion.div layout className={'subpanel glass-card mm-card' + (st.disabled ? ' off' : '')} style={{ ['--h' as string]: m.hue }} role="button" tabIndex={0}
      aria-label={`Manage ${m.name}`} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: .95 }} transition={{ delay: Math.min(i, 10) * .035 }} whileHover={{ y: -3 }}>
      <div className="row" style={{ gap: 10 }}>
        <span className="emu-model-ico"><K size={21} strokeWidth={1.7} /></span>
        <div style={{ minWidth: 0, flex: 1 }}><b className="ellipsis" style={{ display: 'block' }}>{m.name}</b><span className="mono dim ellipsis" style={{ display: 'block', fontSize: 10.5 }}>{m.weights?.file ?? m.id}</span></div>
        <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Switch checked={!st.disabled} disabled={m.status === 'disabled'} onChange={(v) => { setOff(m.id, !v); toast({ tone: v ? 'success' : 'warning', title: `${m.name} ${v ? 'enabled' : 'disabled'} (demo)`, body: v ? 'Available to routing again.' : 'Routing will skip it and use fallbacks.' }); }} label={`Enable ${m.name}`} />
        </span>
      </div>
      <div className="row wrap" style={{ gap: 4, margin: '8px 0 2px' }}>
        <Chip hue={m.hue} size="sm">{m.kind}</Chip>
        <Chip hue={R.hue} size="sm" icon={R.icon}>{R.label}</Chip>
        {m.weights && <Chip hue={28} size="sm" title={`${m.weights.params} parameters, ${m.weights.quant} quantization`}>{m.weights.quant}</Chip>}
        {m.weights && !st.disabled ? <Chip hue={st.loaded ? 150 : 225} size="sm">{st.loaded ? 'loaded' : 'on disk'}</Chip> : <Chip hue={STATUS_HUE[status]} size="sm">{status}</Chip>}
      </div>
      <p className="mm-best" title={m.traits?.bestFor ?? m.blurb}><Sparkles size={12} aria-hidden />{m.traits?.bestFor ?? m.blurb}</p>
      <div className="mm-mid">
        {m.usage ? <UseRing share used={m.usage.used} total={m.usage.used / Math.max(usageShare(m, all), 1e-9)} unit={m.usage.unit} />
          : m.weights ? <UseRing used={m.weights.memGB} ghost={!st.loaded} total={m.weights.memKind === 'VRAM' ? LOCAL_HOST.vramGB : LOCAL_HOST.ramGB} unit="GB" caption={m.weights.memKind} icon={MemoryStick} />
          : <div className="mm-ring none" title="This provider does not report usage"><span className="mm-ring-none"><Ban size={18} /></span><span className="dim" style={{ fontSize: 10.5, textAlign: 'center' }}>No usage reported</span></div>}
        <TraitBars m={m} compact />
      </div>
      {m.weights && <CapacityLine m={m} hostVram={LOCAL_HOST.vramGB} hostRam={LOCAL_HOST.ramGB} hostDisk={LOCAL_HOST.diskGB} loaded={st.loaded} />}
      <div className="row wrap" style={{ gap: 4, margin: '8px 0' }}>{m.traits?.strengths.slice(0, 3).map((s) => <span key={s} className="mm-tag">{s}</span>)}</div>
      <div className="mm-foot">
        <span title="Context window"><Ruler size={12} />{m.ctx}</span>
        <span title="Median latency"><Timer size={12} />{m.latencyMs} ms</span>
        <span title="Picked by the Model Loader for">{Object.entries(LOADER_PICKS).filter(([, v]) => v.model === m.id).map(([k]) => k).join(', ') || (m.local ? 'local' : 'remote')}</span>
        <span className="spacer" />
        <span className="mm-manage">Manage<ChevronRight size={13} /></span>
      </div>
    </motion.div>
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
  const { routes, setRoute } = useRoutes();
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
        <Route size={16} className="info" /><span>The first model is tried first. If it is unavailable, overloaded or incompatible, the next one is used. The Model Loader agent keeps this order fitted to each agent. Drag a row or use the arrows.</span><HelpTrigger k="models.routing" /><span className="spacer" />
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
                <Cpu size={13} className="violet" /><span className="dim">Model Loader picks</span><b>{MODEL_BY_ID[LOADER_PICKS[r.role]?.model]?.name ?? '—'}</b><span className="dim ellipsis" style={{ flex: 1 }}>{LOADER_PICKS[r.role]?.why}</span>
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
    { id: 'claude-sonnet-5-5', prov: 'anthropic', calls: 48210, tok: '312M', err: 0.3 }, { id: 'claude-haiku-5-5', prov: 'anthropic', calls: 91400, tok: '402M', err: 0.2 },
    { id: 'claude-opus-5-5', prov: 'anthropic', calls: 6120, tok: '38M', err: 0.6 }, { id: 'claude-fable-5-2', prov: 'anthropic', calls: 2900, tok: '54M', err: 0.4 },
    { id: 'whisper-large-v4', prov: 'local-speech', calls: 840, tok: '412 min', err: 0.1 }, { id: 'cloud-tts-studio', prov: 'cloud-speech', calls: 620, tok: '208 min', err: 2.1 },
    { id: 'translate-ja-en-v2', prov: 'anthropic', calls: 11340, tok: '18M', err: 0.2 }, { id: 'embed-text-v4', prov: 'anthropic', calls: 188000, tok: '96M', err: 0.0 },
  ].filter((x) => prov === 'all' || x.prov === prov);
  const segs = [{ label: 'Sonnet 5.5', value: 312, color: 'var(--info)' }, { label: 'Haiku 5.5', value: 402, color: 'var(--accent-2)' }, { label: 'Opus 5.5', value: 38, color: 'var(--violet)' }, { label: 'Fable 5.2', value: 54, color: 'var(--gold)' }];
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <select className="select" style={{ width: 190 }} value={prov} onChange={(e) => setProv(e.target.value)} aria-label="Filter provider"><option value="all">All providers</option>{PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <span className="spacer" /><button className="btn" onClick={() => toast({ tone: 'success', title: 'Export queued (demo)', body: 'CSV with model, tokens, minutes and errors.' })}><Download size={14} />Export</button>
      </div>
      <div className="grid emu-bench-top">
        <div className="subpanel"><div className="row" style={{ marginBottom: 8, gap: 6 }}><b>Calls per hour (24 h)</b><HelpTrigger k="models.usage.calls" /></div><ColumnBars data={calls} h={150} color="var(--accent-2)" labels={calls.map((_, i) => (i % 4 === 0 ? String(i) : ''))} /></div>
        <div className="subpanel"><div className="row" style={{ marginBottom: 8, gap: 6 }}><b>Tokens by model (M)</b><HelpTrigger k="models.usage.tokens" /></div>
          <div className="row" style={{ gap: 18 }}><Donut segs={segs} size={132} center="806M" sub="tokens" /><Legend segs={segs} /></div></div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Model</th><th>Provider</th><th>Calls</th><th>Tokens / minutes</th><th>Error rate</th></tr></thead>
          <tbody>{rows.map((x) => <tr key={x.id}><td className="mono">{x.id}</td><td className="dim">{x.prov}</td><td className="tnum">{x.calls.toLocaleString()}</td><td className="tnum">{x.tok}</td><td className={'tnum ' + (x.err > 1 ? 'warn' : 'good')}>{x.err}%</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Health() {
  const [probe, setProbe] = useState<string | null>(null);
  const lat = PROVIDERS.filter((p) => p.id !== 'local-speech').map((p, i) => ({ label: p.name.split(' ').slice(0, 2).join(' '), data: healthSeries(p.id).latency, color: ['var(--info)', 'var(--good)', 'var(--gold)', 'var(--warn)'][i] ?? 'var(--violet)' }));
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
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

