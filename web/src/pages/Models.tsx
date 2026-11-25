import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Activity, AlertTriangle, Boxes, CheckCircle2, Cloud, FlaskConical, Play, Power, RefreshCcw, Server } from 'lucide-react';
import { CLOUD_PROMPT_MAX, type CloudModelFormat, type CloudModelStatusDto, type CloudModelsDto } from '@contracts';
import { runCloudPrompt, useCloudModels, type CloudModelsRead, type CloudRun } from '@/api/cloudModel';
import { Chip } from '@/components/ui/Chips';
import { EmptyState } from '@/components/ui/EmptyState';
import { Segmented } from '@/components/ui/Form';
import { LiveProviderCard } from '@/features/ops/LiveProviderCard';
import { useTab } from '@/hooks/useTab';
import '@/theme/pages/evolution-models-usage.css';

export default function ModelsRedirect() {
  const [params] = useSearchParams();
  const next = new URLSearchParams(params);
  next.set('tab', 'models');
  next.set('sub', params.get('tab') === 'playground' ? 'playground' : 'providers');
  return <Navigate to={`/operations?${next}`} replace />;
}

export function useModelsSection(active = true) {
  const [tab, setTab, tabs] = useTab('models', 'sub');
  const cloud = useCloudModels(active);
  const models = cloud.data?.models;
  return {
    kpis: models ? [
      { key: 'models', icon: Boxes, value: models.length, label: 'Configured models', color: '#22d3ee' },
      { key: 'enabled', icon: Power, value: models.filter(m => m.enabled).length, label: 'Enabled models', color: '#2ee98a' },
      { key: 'calls', icon: Activity, value: models.reduce((sum, m) => sum + m.inFlight, 0), label: 'Calls in progress', color: '#a78bfa' },
    ] : [],
    actions: <button className="btn" onClick={cloud.refresh}><RefreshCcw size={14} />Reload models</button>,
    sub: { tabs, value: tab, onChange: setTab, icons: [Server, FlaskConical] },
    toolbar: null,
    bodyKey: tab,
    body: <ModelView cloud={cloud} playground={tab === 'Playground'} openProviders={() => setTab('Providers')} />,
  };
}

function ModelView({ cloud, playground, openProviders }: { cloud: CloudModelsRead; playground: boolean; openProviders: () => void }) {
  if (cloud.error) return <div role="alert" className="subpanel warn">{cloud.error}</div>;
  if (!cloud.data) return <div className="subpanel dim" role="status">Loading configured models…</div>;
  const { data } = cloud;
  if (!data.models.length) return <div data-testid="live-cloud-none"><EmptyState icon={Cloud} title="No configured models" body="Configure a Claude token slot on the server and restart the API to add a model." /></div>;
  if (playground) return <Playground data={data} refresh={cloud.refresh} openProviders={openProviders} />;
  return <div className="grid g-2" data-testid="live-cloud-models">
    {data.models.map(model => <LiveProviderCard key={model.id} model={model} admin={data.canPrompt} maxInFlight={data.maxInFlight} manage={cloud.manage} />)}
  </div>;
}

function availability(model: CloudModelStatusDto) {
  if (model.lastCall && (!model.check || model.lastCall.at > model.check.checkedAt)) {
    return model.lastCall.ok ? 'available' : 'unavailable';
  }
  if (!model.check) return 'unchecked';
  if (model.check.status === 'limited' && model.check.resetsAt && Date.parse(model.check.resetsAt) <= Date.now()) return 'unchecked';
  return model.check.status === 'available' ? 'available' : 'unavailable';
}

function Playground({ data, refresh, openProviders }: { data: CloudModelsDto; refresh: () => void; openProviders: () => void }) {
  const [params, setParams] = useSearchParams();
  const [prompt, setPrompt] = useState('');
  const [format, setFormat] = useState<CloudModelFormat>('text');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<{ id: string; result: CloudRun } | null>(null);
  const enabled = data.models.filter(m => m.enabled);
  const model = enabled.find(m => m.id === params.get('model'))
    ?? enabled.find(m => availability(m) === 'available')
    ?? enabled.find(m => availability(m) === 'unchecked')
    ?? enabled[0];

  if (!model) return <EmptyState icon={Power} title="All models are disabled" body="Enable a model in Providers to send a prompt." action={<button className="btn" onClick={openProviders}>View providers</button>} />;

  async function run() {
    if (busy || !data.canPrompt || !prompt.trim()) return;
    // Keep the user's request and its answer on the same model when a fresh check changes the default.
    const next = new URLSearchParams(params);
    next.set('model', model.id);
    setParams(next, { replace: true });
    setBusy(true);
    setReply(null);
    try {
      const result = await runCloudPrompt(model.id, prompt.trim(), format);
      setReply({ id: model.id, result });
    } finally {
      setBusy(false);
      refresh();
    }
  }
  const result = reply?.id === model.id ? reply.result : null;
  return <div className="emu-split wide">
    <form className="subpanel col" style={{ gap: 14 }} onSubmit={event => { event.preventDefault(); void run(); }}>
      <label className="field"><span className="field-label">Model</span>
        <select className="select" aria-label="Model" disabled={busy} value={model.id} onChange={event => {
          setReply(null);
          const next = new URLSearchParams(params);
          next.set('model', event.target.value);
          setParams(next, { replace: true });
        }}>
          {enabled.map(m => <option key={m.id} value={m.id}>{m.label} · {m.model}{availability(m) === 'unavailable' ? ' · unavailable' : ''}</option>)}
        </select>
      </label>
      <label className="field"><span className="field-label">Prompt</span>
        <textarea className="textarea" rows={6} maxLength={CLOUD_PROMPT_MAX} value={prompt} onChange={e => setPrompt(e.target.value)} aria-label="Prompt" />
      </label>
      <div className="row wrap" style={{ gap: 8 }}>
        <Segmented ariaLabel="Response format" size="sm" value={format} onChange={setFormat} options={[{ key: 'text', label: 'Text' }, { key: 'json', label: 'JSON' }]} />
        <span className="spacer" />
        <button className="btn primary" type="submit" disabled={busy || !data.canPrompt || !prompt.trim()}>
          {busy ? <RefreshCcw size={14} className="emu-spin" /> : <Play size={14} />}Run live
        </button>
      </div>
      {!data.canPrompt && <span className="dim">Only administrators can send prompts.</span>}
    </form>
    <div className="subpanel emu-out" data-testid="live-output" aria-live="polite">
      <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}><Cloud size={16} /><b>Response</b>
        {result?.ok && <span className="mono dim">{result.value.usage.input} input · {result.value.usage.output} output tokens · {(result.value.durationMs / 1000).toFixed(1)} s</span>}
      </div>
      {busy && <span role="status">Waiting for {model.label}…</span>}
      {!busy && !result && <span className="dim">Send a prompt to see the response.</span>}
      {result?.ok && <>
        {result.value.format === 'json' && <Chip size="sm" hue={result.value.validJson ? 150 : 40} icon={result.value.validJson ? CheckCircle2 : AlertTriangle}>{result.value.validJson ? 'Valid JSON' : 'Invalid JSON'}</Chip>}
        <pre className="emu-pre">{pretty(result.value.text, result.value.validJson)}</pre>
        {result.value.truncated && <span className="dim">Response truncated at the server limit.</span>}
      </>}
      {result && !result.ok && <div className="warn" role="alert">{result.message}</div>}
    </div>
  </div>;
}

function pretty(text: string, valid: boolean | null) {
  if (!valid) return text;
  try { return JSON.stringify(JSON.parse(text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/, '$1')), null, 2); }
  catch { return text; }
}
