import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Plug, Route as RouteIcon, FlaskConical, Mic, Wallet, Trophy, ArrowUp, ArrowDown, X, ShieldCheck, Crown, Lock, AlertTriangle, CheckCircle2, XCircle, Play, RefreshCcw, KeyRound } from 'lucide-react';
import type { DialogComponentProps } from '@/dialogs/DialogHost';
import { Modal } from '@/components/ui/Modal';
import { Field, SwitchRow, Segmented } from '@/components/ui/Form';
import { Chip } from '@/components/ui/Chips';
import { toast } from '@/store/ui';
import { MODELS, MODEL_BY_ID, PROVIDERS, ROUTE_ROLES, useRoutes, useVoice, validateRoute, type ModelKind } from '@/data/models';
import { PROPOSALS, EXPERIMENTS, PROMOTIONS, usePromos, LADDER } from '@/data/evolution';
import { LIMITS, useLimits } from '@/data/usage';
import { money } from '@/lib/format';
import '@/theme/pages/evolution-models-usage.css';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ DL-41 */
function ModelAdd({ close, props }: DialogComponentProps<{ preset?: string; provider?: string }>) {
  const addModel = useRoutes((s) => s.addModel);
  const [kind, setKind] = useState<ModelKind>('LLM');
  const [provider, setProvider] = useState(props.provider ?? 'anthropic');
  const [id, setId] = useState(props.preset ?? '');
  const [endpoint, setEndpoint] = useState('');
  const [cred, setCred] = useState('');
  const [json, setJson] = useState(true);
  const [vision, setVision] = useState(false);
  const [ctx, setCtx] = useState('128K');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const p = PROVIDERS.find((x) => x.id === provider);
  const err = {
    id: !id.trim() ? 'Model ID is required' : MODEL_BY_ID[id.trim()] ? 'This model ID already exists' : /\s/.test(id.trim()) ? 'No spaces allowed' : '',
    endpoint: provider === 'custom' && !/^https?:\/\/|^[\w.-]+(:\d+)?$/.test(endpoint.trim()) ? 'Enter a host or URL' : '',
    cred: p && p.credential !== 'none' ? '' : provider === 'custom' && !cred.trim() ? 'Enter a credential reference or paste a key (stored encrypted)' : '',
  };
  const bad = Object.values(err).some(Boolean);
  const submit = async () => {
    setTouched(true); if (bad) return;
    setBusy(true); await sleep(1300);
    addModel({ id: id.trim(), name: id.trim(), kind, provider, local: p?.kind === 'local', status: 'optional', ctx, modalities: vision ? ['text', 'image'] : ['text'], costIn: null, costOut: null, costUnit: 'est.', latencyMs: 800, json, blurb: 'Added by you (demo)', hue: 165 });
    toast({ tone: 'success', title: 'Connection validated (demo)', body: `${id.trim()} was added as optional. The credential was stored encrypted and is never shown again.` });
    close();
  };
  return (
    <Modal title="Add model / provider" icon={Plug} help="models.add" dialogId="DL-41" onClose={close} sub="Connect a model. Secrets are write-only."
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={busy} onClick={submit}>{busy ? <><RefreshCcw size={14} className="emu-spin" />Validating...</> : 'Validate connection'}</button></>}>
      <div className="col" style={{ gap: 12 }}>
        <Field label="Model type" help="models.add.type"><Segmented ariaLabel="Model type" size="sm" value={kind} onChange={setKind} options={(['LLM', 'Vision', 'Embeddings', 'STT', 'TTS', 'Translation'] as ModelKind[]).map((k) => ({ key: k, label: k }))} /></Field>
        <div className="grid g-2" style={{ gap: 10 }}>
          <Field label="Provider" help="models.add.provider"><select className="select" value={provider} onChange={(e) => setProvider(e.target.value)}>{PROVIDERS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}<option value="custom">New provider...</option></select></Field>
          <Field label="Model ID" required help="models.add.id" error={touched ? err.id : undefined}><input className="input" data-autofocus placeholder="e.g. local/mistral-large" value={id} onChange={(e) => setId(e.target.value)} /></Field>
        </div>
        {provider === 'custom' && <Field label="API endpoint" required error={touched ? err.endpoint : undefined} hint="Host or URL. HTTPS is required for remote hosts."><input className="input" placeholder="api.example.com" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} /></Field>}
        <Field label="Credential" help="models.add.credential" error={touched ? err.cred : undefined} hint={p && p.credential !== 'none' ? `Using existing reference ${p.credRef}` : 'Write-only. Encrypted server-side and replaced by a reference.'}>
          {p && p.credential !== 'none' ? <div className="emu-cred"><KeyRound size={15} className="good" /><span className="mono" style={{ fontSize: 12 }}>{p.credRef}</span><span className="emu-mask">••••••••</span><Chip hue={150} size="sm" icon={ShieldCheck}>encrypted</Chip></div>
            : <input className="input" type="password" autoComplete="off" placeholder={p?.kind === 'local' ? 'Not needed for local providers' : 'Paste key (never displayed again)'} value={cred} onChange={(e) => setCred(e.target.value)} disabled={p?.kind === 'local'} />}
        </Field>
        <div className="grid g-2" style={{ gap: 10 }}>
          <Field label="Context window"><select className="select" value={ctx} onChange={(e) => setCtx(e.target.value)}>{['8K', '32K', '128K', '500K', '1M'].map((c) => <option key={c}>{c}</option>)}</select></Field>
          <div><SwitchRow label="Structured JSON" desc="Passes schema validation" checked={json} onChange={setJson} /><SwitchRow label="Accepts images" checked={vision} onChange={setVision} /></div>
        </div>
        <div className="row emu-note"><Lock size={14} className="good" /><span style={{ fontSize: 12 }}>The new model stays <b>optional</b>: it is not routed to until you add it to a role in Routing.</span></div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ DL-42 */
function RouteEditor({ close, props }: DialogComponentProps<{ role?: string }>) {
  const { routes, caps, setRoute, setCap, extra } = useRoutes();
  const [role, setRole] = useState(props.role ?? 'Planner');
  const [list, setList] = useState<string[]>(routes[role]);
  const [cap, setCapL] = useState(caps[role]);
  const all = [...extra, ...MODELS];
  const pick = (r: string) => { setRole(r); setList(routes[r]); setCapL(caps[r]); };
  const issues = useMemo(() => validateRoute(role, list), [role, list]);
  const move = (i: number, d: number) => { const l = [...list]; const j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; setList(l); };
  const fatal = issues.filter((x) => x.startsWith('Primary') || x === 'No model assigned');
  const save = () => { if (fatal.length) return; setRoute(role, list); setCap(role, cap); toast({ tone: 'success', title: `${role} routing saved (demo)`, body: `${list.length} models, daily cap ${money(cap, 0)}. Running missions keep their pinned routes.` }); close(); };
  return (
    <Modal title="Edit model route" icon={RouteIcon} help="models.routing" dialogId="DL-42" size="lg" onClose={close} sub="Order decides precedence. Incompatible primaries are blocked."
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={fatal.length > 0} onClick={save}>Save route</button></>}>
      <div className="col" style={{ gap: 12 }}>
        <Field label="Role"><select className="select" data-autofocus value={role} onChange={(e) => pick(e.target.value)}>{ROUTE_ROLES.map((r) => <option key={r.role}>{r.role}</option>)}</select></Field>
        <div className="col" style={{ gap: 5 }}>
          {list.map((id, i) => (
            <motion.div layout key={id} className="emu-route"><span className={'emu-rank' + (i === 0 ? ' p' : '')}>{i === 0 ? 'P' : i}</span><span className="ellipsis" style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{MODEL_BY_ID[id]?.name ?? id}</span><Chip hue={200} size="sm">{MODEL_BY_ID[id]?.kind}</Chip>
              <button className="icon-btn" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp size={14} /></button><button className="icon-btn" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === list.length - 1}><ArrowDown size={14} /></button>
              <button className="icon-btn" aria-label="Remove" onClick={() => setList(list.filter((x) => x !== id))}><X size={14} /></button></motion.div>
          ))}
        </div>
        <Field label="Add fallback"><select className="select" value="" onChange={(e) => e.target.value && setList([...list, e.target.value])}><option value="">Choose a model...</option>{all.filter((m) => !list.includes(m.id)).map((m) => <option key={m.id} value={m.id}>{m.name} ({m.kind})</option>)}</select></Field>
        <Field label={`Daily budget cap: ${money(cap, 0)}`} hint="When reached, the role uses local models or pauses."><input type="range" className="range" min={20} max={1500} step={10} value={cap} onChange={(e) => setCapL(+e.target.value)} /></Field>
        <div className="col" style={{ gap: 4 }}>
          {issues.length === 0 ? <span className="good" style={{ fontSize: 12.5 }}><CheckCircle2 size={13} style={{ display: 'inline', verticalAlign: -2 }} /> Route is compatible.</span> : issues.map((x) => <span key={x} className={x.startsWith('Primary') || x === 'No model assigned' ? 'bad' : 'warn'} style={{ fontSize: 12.5 }}><AlertTriangle size={13} style={{ display: 'inline', verticalAlign: -2 }} /> {x}</span>)}
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ DL-43 */
function PlaygroundDialog({ close, props }: DialogComponentProps<{ model?: string }>) {
  const llms = MODELS.filter((m) => m.kind === 'LLM' || m.kind === 'Vision');
  const [kind, setKind] = useState<'prompt' | 'image' | 'audio'>('prompt');
  const [sel, setSel] = useState<string[]>([props.model ?? 'claude-sonnet-5-5', 'claude-haiku-5-5']);
  const [n, setN] = useState(20);
  const [state, setState] = useState<'idle' | 'run' | 'done'>('idle');
  const [pct, setPct] = useState(0);
  const run = async () => {
    if (sel.length < 1) return;
    setState('run'); setPct(0);
    for (let i = 1; i <= 10; i++) { await sleep(150); setPct(i * 10); }
    setState('done');
  };
  const rows = sel.map((id) => { const m = MODEL_BY_ID[id]; return { m, score: Math.round(86 + (m.costOut ?? 5) / 8 + (m.json ? 2 : -4)), ms: m.latencyMs, cost: Math.round(((m.costOut ?? 0) * n * 0.0007) * 100) / 100, json: m.json ? 100 : 80 }; });
  return (
    <Modal title="Benchmark test" icon={FlaskConical} help="models.playground" dialogId="DL-43" size="lg" onClose={close} sub="Compare models on a sample. Results never change production routing."
      footer={<><button className="btn" onClick={close}>Close</button><button className="btn primary" disabled={state === 'run' || sel.length === 0} onClick={run}>{state === 'run' ? <><RefreshCcw size={14} className="emu-spin" />Running {pct}%</> : <><Play size={14} />Run benchmark</>}</button></>}>
      <div className="col" style={{ gap: 12 }}>
        <Field label="Sample type"><Segmented ariaLabel="Sample type" size="sm" value={kind} onChange={setKind} options={[{ key: 'prompt', label: 'Prompt' }, { key: 'image', label: 'Image' }, { key: 'audio', label: 'Audio' }]} /></Field>
        <Field label="Models to compare" hint="Choose up to 3."><div className="row wrap" style={{ gap: 6 }}>{llms.map((m) => { const on = sel.includes(m.id); return <button key={m.id} className={'btn sm' + (on ? ' primary' : '')} aria-pressed={on} data-autofocus={on && m.id === sel[0] ? true : undefined} onClick={() => setSel(on ? sel.filter((x) => x !== m.id) : sel.length < 3 ? [...sel, m.id] : sel)}>{m.name}</button>; })}</div></Field>
        <Field label={`Samples: ${n}`}><input type="range" className="range" min={5} max={100} step={5} value={n} onChange={(e) => setN(+e.target.value)} /></Field>
        {state === 'run' && <div className="bar"><motion.i animate={{ width: `${pct}%` }} /></div>}
        {state === 'done' && (
          <motion.div className="table-wrap" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <table className="table"><thead><tr><th>Model</th><th>Quality</th><th>JSON valid</th><th>Latency</th><th>Est. cost</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.m.id}><td><b>{r.m.name}</b></td><td className="tnum">{Math.min(r.score, 99)}</td><td className={'tnum ' + (r.json === 100 ? 'good' : 'warn')}>{r.json}%</td><td className="tnum">{r.ms} ms</td><td className="tnum">{money(r.cost)}</td></tr>)}</tbody></table>
          </motion.div>
        )}
        <div className="dim" style={{ fontSize: 11.5 }}><Lock size={11} style={{ display: 'inline' }} /> {kind === 'audio' ? 'Audio samples require microphone consent and are discarded after the run.' : 'Sandboxed calls. No production auto-routing.'}</div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ DL-44 */
function VoiceSettings({ close }: DialogComponentProps) {
  const v = useVoice();
  const [d, setD] = useState({ consent: v.consent, translate: v.translate, voice: v.voice, rate: v.rate, volume: v.volume, lang: v.lang, retention: v.retention });
  const set = (p: Partial<typeof d>) => setD((x) => ({ ...x, ...p }));
  const retentionBad = d.consent && !d.retention;
  return (
    <Modal title="Voice settings" icon={Mic} help="models.voice" dialogId="DL-44" onClose={close} sub="Optional voice pipeline. Audio is used only with consent."
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={retentionBad} onClick={() => { v.set(d); toast({ tone: 'success', title: 'Voice settings saved (demo)', body: d.consent ? 'Consent recorded with language and retention scope.' : 'Microphone consent is off. Voice turns are blocked.' }); close(); }}>Save settings</button></>}>
      <div className="col" style={{ gap: 10 }}>
        <SwitchRow label="Microphone consent" desc="Required before any audio is captured" checked={d.consent} onChange={(c) => set({ consent: c })} help="models.voice.consent" />
        <SwitchRow label="Translate Japanese to English" desc="Optional step between STT and the agent" checked={d.translate} onChange={(c) => set({ translate: c })} />
        <div className="grid g-2" style={{ gap: 10 }}>
          <Field label="Spoken language"><select className="select" data-autofocus value={d.lang} onChange={(e) => set({ lang: e.target.value })}><option value="ja">Japanese</option><option value="en">English</option><option value="es">Spanish</option></select></Field>
          <Field label="Voice"><select className="select" value={d.voice} onChange={(e) => set({ voice: e.target.value })}>{['Aria (neural)', 'Kai (neural)', 'Mio (studio)'].map((x) => <option key={x}>{x}</option>)}</select></Field>
        </div>
        <Field label={`Rate: ${d.rate.toFixed(1)}x`}><input type="range" className="range" min={0.6} max={1.6} step={0.1} value={d.rate} onChange={(e) => set({ rate: +e.target.value })} /></Field>
        <Field label={`Volume: ${d.volume}`}><input type="range" className="range" min={0} max={100} value={d.volume} onChange={(e) => set({ volume: +e.target.value })} /></Field>
        <Field label="Audio retention" required error={retentionBad ? 'Choose a retention scope' : undefined}><select className="select" value={d.retention} onChange={(e) => set({ retention: e.target.value })}>{['Discard audio after transcription', 'Keep 24 hours for review', 'Keep 30 days (Owner only)'].map((x) => <option key={x}>{x}</option>)}</select></Field>
        <div className="row" style={{ gap: 8, fontSize: 12 }}><span className="dim">Original audio, recognized text, translated text and the synthesized reply are always shown separately.</span></div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ DL-51 */
function BudgetLimit({ close, props }: DialogComponentProps<{ key?: string; cap?: number }>) {
  const over = useLimits((s) => s.over);
  const save = useLimits((s) => s.save);
  const rev = useLimits((s) => s.revisions);
  const [key, setKey] = useState(props.key ?? LIMITS[0].key);
  const l = LIMITS.find((x) => x.key === key) ?? LIMITS[0];
  const cur = over[l.key] ?? { soft: l.soft, cap: l.cap };
  const [soft, setSoft] = useState(cur.soft);
  const [cap, setCap] = useState(props.cap ?? cur.cap);
  const [scope, setScope] = useState('This month');
  const [cons, setCons] = useState(l.consequence);
  const [why, setWhy] = useState('');
  const [t, setT] = useState(false);
  const pick = (k: string) => { const x = LIMITS.find((y) => y.key === k)!; const c = over[k] ?? { soft: x.soft, cap: x.cap }; setKey(k); setSoft(c.soft); setCap(c.cap); setCons(x.consequence); };
  const err = { soft: soft >= cap ? 'Soft cap must be below the hard cap' : soft <= 0 ? 'Must be positive' : '', cap: cap < l.used ? `Below current use (${l.used.toLocaleString()}): this would trigger the consequence immediately` : '', why: why.trim().length < 5 ? 'Add a short reason for the audit log' : '' };
  const hard = !!err.soft || !!err.why; // cap<used is a warning that still allows save
  const pctUsed = Math.min(100, (l.used / cap) * 100);
  return (
    <Modal title="Budget limit editor" icon={Wallet} help="usage.limits" dialogId="DL-51" onClose={close} sub={`Saving creates limit revision r${rev + 1}.`}
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" onClick={() => { setT(true); if (hard) return; save(l.key, { soft, cap, note: why }); toast({ tone: 'success', title: `Limit revision r${rev + 1} saved (demo)`, body: `${l.key}: soft ${soft.toLocaleString()}, hard ${cap.toLocaleString()}. Logged for audit.` }); close(); }}>Save limit revision</button></>}>
      <div className="col" style={{ gap: 12 }}>
        <Field label="Limit"><select className="select" data-autofocus value={key} onChange={(e) => pick(e.target.value)}>{LIMITS.map((x) => <option key={x.key}>{x.key}</option>)}</select></Field>
        <div className="grid g-2" style={{ gap: 10 }}>
          <Field label={`Soft cap (warn)${l.unit === '$' ? ' $' : ''}`} error={t ? err.soft : undefined}><input className="input" type="number" value={soft} onChange={(e) => setSoft(+e.target.value)} /></Field>
          <Field label={`Hard cap (enforce)${l.unit === '$' ? ' $' : ''}`} hint={err.cap ? undefined : undefined} error={err.cap || undefined}><input className="input" type="number" value={cap} onChange={(e) => setCap(+e.target.value)} /></Field>
        </div>
        <div><div className="row dim" style={{ fontSize: 12, marginBottom: 4 }}>Current use {l.used.toLocaleString()} ({Math.round(pctUsed)}% of hard cap)</div><div className={'bar ' + (l.used >= cap ? 'bad' : l.used >= soft ? 'warn' : 'good')} style={{ position: 'relative' }}><motion.i animate={{ width: `${pctUsed}%` }} /><span className="emu-soft" style={{ left: `${Math.min(100, (soft / cap) * 100)}%` }} /></div></div>
        <div className="grid g-2" style={{ gap: 10 }}>
          <Field label="Date scope"><select className="select" value={scope} onChange={(e) => setScope(e.target.value)}>{['This month', 'Rolling 30 days', 'Daily', 'Until changed'].map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Consequence at hard cap"><select className="select" value={cons} onChange={(e) => setCons(e.target.value)}>{Array.from(new Set([l.consequence, 'Pause non-critical missions', 'Fall back to local models', 'Queue new work'])).map((x) => <option key={x}>{x}</option>)}</select></Field>
        </div>
        <Field label="Reason" required error={t ? err.why : undefined}><input className="input" placeholder="e.g. Q4 launch needs more headroom" value={why} onChange={(e) => setWhy(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ DL-54 */
function ExperimentDialog({ close, props }: DialogComponentProps<{ proposalId?: string }>) {
  const open = PROPOSALS.filter((p) => !['promoted', 'rejected'].includes(p.status));
  const [pid, setPid] = useState(props.proposalId ?? open[0].id);
  const p = PROPOSALS.find((x) => x.id === pid) ?? open[0];
  const [hyp, setHyp] = useState(p.hypothesis);
  const [sets, setSets] = useState<Record<string, boolean>>({ fixed: true, fresh: true, regression: true, security: p.tier === 'L3' || p.tier === 'L4' });
  const [evaluator, setEvaluator] = useState('Tester-01');
  const [budget, setBudget] = useState(24);
  const [t, setT] = useState(false);
  const pick = (id: string) => { setPid(id); setHyp(PROPOSALS.find((x) => x.id === id)!.hypothesis); };
  const tier = LADDER.find((l) => l.tier === p.tier)!;
  const missing = tier.tests.filter((k) => !sets[k]);
  const err = { eval: evaluator === p.author ? `The evaluator cannot be the author (${p.author})` : '', sets: missing.length ? `${p.tier} requires: ${missing.join(', ')}` : '', hyp: hyp.trim().length < 12 ? 'State a testable hypothesis' : '' };
  const bad = Object.values(err).some(Boolean);
  return (
    <Modal title="Evolution experiment" icon={FlaskConical} help="evo.experiment" dialogId="DL-54" size="lg" onClose={close} sub="Baseline vs candidate, run in isolation."
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" onClick={() => { setT(true); if (bad) return; toast({ tone: 'success', title: 'Isolated experiment started (demo)', body: `${p.id}: ${p.baseline} vs ${p.candidate}, evaluator ${evaluator}, cap $${budget}.` }); close(); }}>Start isolated experiment</button></>}>
      <div className="col" style={{ gap: 12 }}>
        <div className="grid g-2" style={{ gap: 10 }}>
          <Field label="Proposal"><select className="select" data-autofocus value={pid} onChange={(e) => pick(e.target.value)}>{open.map((x) => <option key={x.id} value={x.id}>{x.id} · {x.title}</option>)}</select></Field>
          <Field label="Risk tier"><div className="row" style={{ gap: 6 }}><Chip hue={tier.hue}>{tier.tier} {tier.name}</Chip><Chip hue={p.risk === 'high' ? 350 : p.risk === 'medium' ? 40 : 150}>{p.risk} risk</Chip>{tier.owner && <Chip hue={40} icon={Crown}>Owner gate</Chip>}</div></Field>
        </div>
        <Field label="Hypothesis" required error={t ? err.hyp : undefined}><textarea className="textarea" rows={2} value={hyp} onChange={(e) => setHyp(e.target.value)} /></Field>
        <div className="grid g-2" style={{ gap: 10 }}>
          <Field label="Baseline"><input className="input" value={p.baseline} readOnly /></Field>
          <Field label="Candidate"><input className="input" value={p.candidate} readOnly /></Field>
        </div>
        <Field label="Datasets" error={t ? err.sets : undefined} hint={`${p.tier} requires ${tier.tests.join(', ')}. The fresh set is hidden from the author.`}>
          <div className="row wrap" style={{ gap: 14 }}>{['fixed', 'fresh', 'regression', 'security'].map((k) => <label key={k} className="row" style={{ gap: 6, fontSize: 13, textTransform: 'capitalize' }}><input type="checkbox" checked={!!sets[k]} onChange={(e) => setSets((s) => ({ ...s, [k]: e.target.checked }))} />{k}</label>)}</div>
        </Field>
        <div className="grid g-2" style={{ gap: 10 }}>
          <Field label="Independent evaluator" help="evo.independence" error={err.eval || undefined} hint={err.eval ? undefined : 'Cannot adjust thresholds after seeing results.'}><select className="select" value={evaluator} onChange={(e) => setEvaluator(e.target.value)}>{['Tester-01', 'Security-01', 'Auditor-01', p.author].filter((x, i, a) => a.indexOf(x) === i).map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label={`Resource cap: $${budget}`} hint="Run stops when the cap is reached."><input type="range" className="range" min={5} max={80} value={budget} onChange={(e) => setBudget(+e.target.value)} /></Field>
        </div>
        <div className="row emu-note"><ShieldCheck size={15} className="good" /><span style={{ fontSize: 12 }}>Risks: runs in <b>sandbox-3</b> with no production credentials or website grants. Source and org changes still need the Owner after the experiment.</span></div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ DL-55 */
function PromotionDialog({ close, props }: DialogComponentProps<{ id?: string; mode?: 'approve' | 'reject' }>) {
  const p = PROMOTIONS.find((x) => x.id === props.id) ?? PROMOTIONS[0];
  const decide = usePromos((s) => s.decide);
  const reject = props.mode === 'reject';
  const [comment, setComment] = useState('');
  const [indep, setIndep] = useState(false);
  const [ack, setAck] = useState(false);
  const [t, setT] = useState(false);
  const exp = EXPERIMENTS.find((e) => e.proposal === p.proposal);
  const err = { comment: reject && comment.trim().length < 5 ? 'A reason is required to reject' : '', indep: !reject && !indep ? 'Confirm you are independent of the author' : '', ack: !reject && p.secRegressions > 0 && !ack ? 'Acknowledge the security regression' : '' };
  const bad = Object.values(err).some(Boolean);
  const go = () => { setT(true); if (bad) return; decide(p.id, { verdict: reject ? 'rejected' : 'approved', comment: comment.trim(), at: Date.now() }); toast({ tone: reject ? 'warning' : 'success', title: reject ? `${p.id} rejected (demo)` : `${p.id} approved (demo)`, body: reject ? `${p.from} remains stable. Decision logged.` : `Staged rollout ${p.rollout.join(' / ')}% started with rollback armed.` }); close(); };
  return (
    <Modal title={reject ? 'Reject promotion' : 'Owner approval'} icon={Trophy} tone={reject ? 'warn' : 'default'} help="evo.promotion" dialogId="DL-55" size="lg" onClose={close} sub={`${p.id} · ${p.title} · ${p.from} to ${p.to}`}
      footer={<><button className="btn" data-autofocus onClick={close}>Cancel</button>{reject ? <button className="btn danger" onClick={go}><XCircle size={14} />Reject promotion</button> : <button className="btn good" onClick={go}><Crown size={14} />Approve and start rollout</button>}</>}>
      <div className="col" style={{ gap: 12 }}>
        <div className="grid g-3" style={{ gap: 8 }}>
          <div className="emu-mini"><span className="dim">Metric delta</span><b className="good">{p.delta}</b></div>
          <div className="emu-mini"><span className="dim">Confidence</span><b>{p.confidence}%{exp ? ` · n=${exp.baseline.n + exp.candidate.n}` : ''}</b></div>
          <div className="emu-mini"><span className="dim">Security regressions</span><b className={p.secRegressions ? 'bad' : 'good'}>{p.secRegressions}</b></div>
        </div>
        <div><div className="section-label">Reviewers and independence</div>
          <div className="col" style={{ gap: 5, marginTop: 6 }}>{p.reviewers.map((r) => <div key={r.name} className="emu-rev"><b style={{ fontSize: 12.5 }}>{r.name}</b><span className="dim" style={{ fontSize: 11.5 }}>{r.kind}</span><span className="spacer" />{r.kind === 'author' ? <Chip hue={30} size="sm" icon={Lock}>cannot approve own change</Chip> : <Chip hue={150} size="sm" icon={ShieldCheck}>independent</Chip>}{r.kind === 'owner' ? <Chip hue={40} size="sm">you</Chip> : r.done ? <CheckCircle2 size={14} className="good" /> : <AlertTriangle size={14} className="warn" />}</div>)}</div></div>
        <div className="row emu-note"><RouteIcon size={15} className="info" /><span style={{ fontSize: 12 }}><b>Rollback:</b> {p.rollback}. New instances only; running missions stay pinned.</span></div>
        {!reject && p.secRegressions > 0 && <label className="row warn" style={{ gap: 8, fontSize: 13 }}><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I reviewed the {p.secRegressions} security regression and accept the risk.</label>}
        {t && err.ack && <span className="field-error" role="alert">{err.ack}</span>}
        {!reject && <label className="row" style={{ gap: 8, fontSize: 13 }}><input type="checkbox" checked={indep} onChange={(e) => setIndep(e.target.checked)} /> I did not author or evaluate this candidate.</label>}
        {t && err.indep && <span className="field-error" role="alert">{err.indep}</span>}
        <Field label={reject ? 'Reason' : 'Comment (optional)'} required={reject} error={t ? err.comment : undefined}><textarea className="textarea" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={reject ? 'Why is this not ready?' : 'Anything to record with the decision'} /></Field>
      </div>
    </Modal>
  );
}

export const dialogs = {
  'model-add': ModelAdd,
  'model-route-editor': RouteEditor,
  'model-playground': PlaygroundDialog,
  'voice-settings': VoiceSettings,
  'budget-limit': BudgetLimit,
  'evolution-experiment': ExperimentDialog,
  'evolution-promotion': PromotionDialog,
};
