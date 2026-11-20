import { seeded } from '@/data/agents';

/* DEMO fixtures for Models (spec 4.12, 10.8). No secrets are ever stored here, only secret references. */

export type ModelKind = 'LLM' | 'Vision' | 'Embeddings' | 'STT' | 'TTS' | 'Translation';
export interface ModelDef {
  id: string; name: string; kind: ModelKind; provider: string; local: boolean; status: 'ready' | 'degraded' | 'disabled' | 'optional';
  ctx: string; modalities: string[]; costIn: number | null; costOut: number | null; costUnit: string; latencyMs: number; json: boolean; blurb: string; hue: number;
}
export const MODELS: ModelDef[] = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', kind: 'LLM', provider: 'anthropic', local: false, status: 'ready', ctx: '500K', modalities: ['text', 'image'], costIn: 15, costOut: 75, costUnit: '/Mtok', latencyMs: 1480, json: true, blurb: 'Deep planning and hard reasoning', hue: 275 },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', kind: 'LLM', provider: 'anthropic', local: false, status: 'ready', ctx: '500K', modalities: ['text', 'image'], costIn: 3, costOut: 15, costUnit: '/Mtok', latencyMs: 720, json: true, blurb: 'Default coder and browser agent model', hue: 215 },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', kind: 'LLM', provider: 'anthropic', local: false, status: 'ready', ctx: '300K', modalities: ['text', 'image'], costIn: 0.8, costOut: 4, costUnit: '/Mtok', latencyMs: 310, json: true, blurb: 'Fast triage, QA and summaries', hue: 190 },
  { id: 'claude-fable-5-2', name: 'Claude Fable 5.2', kind: 'LLM', provider: 'anthropic', local: false, status: 'ready', ctx: '1M', modalities: ['text', 'image'], costIn: 5, costOut: 25, costUnit: '/Mtok', latencyMs: 940, json: true, blurb: 'Long-context research synthesis', hue: 300 },
  { id: 'local/llama-4-70b', name: 'Llama 4 70B (local)', kind: 'LLM', provider: 'local-ollama', local: true, status: 'optional', ctx: '128K', modalities: ['text'], costIn: 0, costOut: 0, costUnit: 'local', latencyMs: 2100, json: false, blurb: 'Private fallback, no data leaves host', hue: 150 },
  { id: 'claude-sonnet-5-5-vision', name: 'Sonnet 5.5 Vision', kind: 'Vision', provider: 'anthropic', local: false, status: 'ready', ctx: '500K', modalities: ['image', 'text'], costIn: 3, costOut: 15, costUnit: '/Mtok', latencyMs: 1100, json: true, blurb: 'Screenshot reading and visual diffs', hue: 195 },
  { id: 'local/llava-next-34b', name: 'LLaVA-Next 34B (local)', kind: 'Vision', provider: 'local-ollama', local: true, status: 'optional', ctx: '32K', modalities: ['image', 'text'], costIn: 0, costOut: 0, costUnit: 'local', latencyMs: 3400, json: false, blurb: 'Offline screenshot captioning', hue: 150 },
  { id: 'embed-text-v4', name: 'Embed Text v4', kind: 'Embeddings', provider: 'anthropic', local: false, status: 'ready', ctx: '8K', modalities: ['text'], costIn: 0.1, costOut: null, costUnit: '/Mtok', latencyMs: 90, json: false, blurb: 'Knowledge index, 1536-dim', hue: 215 },
  { id: 'local/bge-m3', name: 'BGE-M3 (local)', kind: 'Embeddings', provider: 'local-ollama', local: true, status: 'ready', ctx: '8K', modalities: ['text'], costIn: 0, costOut: null, costUnit: 'local', latencyMs: 140, json: false, blurb: 'Multilingual local embeddings', hue: 150 },
  { id: 'whisper-large-v4', name: 'Whisper Large v4', kind: 'STT', provider: 'local-speech', local: true, status: 'optional', ctx: 'audio', modalities: ['audio'], costIn: 0, costOut: null, costUnit: 'local', latencyMs: 640, json: false, blurb: 'Consent-gated speech to text, 99 languages', hue: 40 },
  { id: 'cloud-stt-streaming', name: 'Cloud STT Streaming', kind: 'STT', provider: 'cloud-speech', local: false, status: 'disabled', ctx: 'audio', modalities: ['audio'], costIn: 0.006, costOut: null, costUnit: '/min', latencyMs: 380, json: false, blurb: 'Disabled until a retention scope is set', hue: 40 },
  { id: 'local-tts-neural', name: 'Local TTS Neural', kind: 'TTS', provider: 'local-speech', local: true, status: 'optional', ctx: 'audio', modalities: ['text', 'audio'], costIn: 0, costOut: null, costUnit: 'local', latencyMs: 520, json: false, blurb: 'Voice, rate and volume controls', hue: 330 },
  { id: 'cloud-tts-studio', name: 'Cloud TTS Studio', kind: 'TTS', provider: 'cloud-speech', local: false, status: 'degraded', ctx: 'audio', modalities: ['text', 'audio'], costIn: 0.016, costOut: null, costUnit: '/min', latencyMs: 880, json: false, blurb: 'Studio voices, elevated latency now', hue: 330 },
  { id: 'translate-ja-en-v2', name: 'Translate JA-EN v2', kind: 'Translation', provider: 'anthropic', local: false, status: 'ready', ctx: '32K', modalities: ['text'], costIn: 0.8, costOut: 4, costUnit: '/Mtok', latencyMs: 260, json: true, blurb: 'Japanese to English, keeps terminology', hue: 165 },
  { id: 'local/nllb-200', name: 'NLLB-200 (local)', kind: 'Translation', provider: 'local-ollama', local: true, status: 'optional', ctx: '4K', modalities: ['text'], costIn: 0, costOut: null, costUnit: 'local', latencyMs: 420, json: false, blurb: '200-language local translation', hue: 150 },
];
export const MODEL_BY_ID: Record<string, ModelDef> = Object.fromEntries(MODELS.map((m) => [m.id, m]));

export interface Provider { id: string; name: string; kind: 'remote' | 'local'; endpoint: string; credential: 'encrypted' | 'none' | 'missing' | 'expiring'; credRef: string; rotated: string; health: 'healthy' | 'degraded' | 'down' | 'idle'; latency: number[]; models: number; quota: number; region: string }
const lat = (seed: string, base: number, jitter: number) => { const r = seeded(seed); return Array.from({ length: 24 }, () => Math.round(base + (r() - 0.5) * jitter)); };
export const PROVIDERS: Provider[] = [
  { id: 'anthropic', name: 'Anthropic API', kind: 'remote', endpoint: 'api.anthropic.com', credential: 'encrypted', credRef: 'secret://providers/anthropic/key', rotated: '12 d ago', health: 'healthy', latency: lat('p1', 720, 220), models: 7, quota: 62, region: 'us-east' },
  { id: 'local-ollama', name: 'Local Ollama (optional)', kind: 'local', endpoint: '127.0.0.1:11434', credential: 'none', credRef: 'no credential needed', rotated: 'n/a', health: 'idle', latency: lat('p2', 1800, 900), models: 4, quota: 0, region: 'this host' },
  { id: 'local-speech', name: 'Local speech runtime', kind: 'local', endpoint: '127.0.0.1:8787', credential: 'none', credRef: 'no credential needed', rotated: 'n/a', health: 'idle', latency: lat('p3', 560, 200), models: 2, quota: 0, region: 'this host' },
  { id: 'cloud-speech', name: 'Cloud speech vendor', kind: 'remote', endpoint: 'speech.vendor.example', credential: 'expiring', credRef: 'secret://providers/speech/key', rotated: '84 d ago', health: 'degraded', latency: lat('p4', 900, 700), models: 2, quota: 28, region: 'eu-west' },
];

export const ROUTE_ROLES = [
  { role: 'Planner', hint: 'Plans, decomposes, re-plans', cap: 400, models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'local/llama-4-70b'] },
  { role: 'Coder', hint: 'Source edits and tests', cap: 900, models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'] },
  { role: 'Browser', hint: 'Reads pages, picks locators', cap: 500, models: ['claude-sonnet-5-5', 'claude-sonnet-5-5-vision', 'claude-haiku-5-5'] },
  { role: 'Research', hint: 'Long-context synthesis', cap: 600, models: ['claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5'] },
  { role: 'QA', hint: 'Verification and visual diffs', cap: 250, models: ['claude-haiku-5-5', 'claude-sonnet-5-5-vision', 'claude-sonnet-5-5'] },
  { role: 'Voice', hint: 'STT, TTS, spoken replies', cap: 80, models: ['whisper-large-v4', 'local-tts-neural', 'cloud-tts-studio'] },
  { role: 'Translator', hint: 'JA to EN, terminology safe', cap: 60, models: ['translate-ja-en-v2', 'local/nllb-200', 'claude-haiku-5-5'] },
];

export const HEALTH_LABELS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
export function healthSeries(id: string) {
  const p = PROVIDERS.find((x) => x.id === id);
  const r = seeded('err' + id);
  return { latency: p?.latency ?? lat(id, 700, 200), errors: Array.from({ length: 24 }, (_, i) => Math.round(((id === 'cloud-speech' && i > 17 ? 4.5 : 0.4) + r() * 0.9) * 10) / 10) };
}
export const INCIDENTS = [
  { id: 'INC-31', t: '2 h ago', provider: 'Cloud speech vendor', what: 'Elevated p95 latency (880 ms), auto-retry engaged', state: 'degraded' as const },
  { id: 'INC-30', t: 'Yesterday', provider: 'Anthropic API', what: 'Rate-limit retries on claude-opus-5-5 (resolved, 14 min)', state: 'resolved' as const },
  { id: 'INC-29', t: '3 d ago', provider: 'Local Ollama', what: 'Process not running; fallback chain used for 2 calls', state: 'resolved' as const },
];

export const PLAY_SAMPLES = [
  { key: 'plan', label: 'Mission plan JSON', prompt: 'Break "Migrate checkout page to the new design system" into 4 verifiable tasks. Reply as JSON with fields title, owner_role, evidence.', json: true,
    out: '{\n  "tasks": [\n    { "title": "Inventory checkout components", "owner_role": "dev", "evidence": "component list + screenshot set" },\n    { "title": "Port header and cart summary", "owner_role": "dev", "evidence": "visual diff < 0.5%" },\n    { "title": "Cross-browser verification", "owner_role": "qa", "evidence": "3 browser reports" },\n    { "title": "Security review of form handlers", "owner_role": "security", "evidence": "signed review note" }\n  ]\n}' },
  { key: 'summary', label: 'Status summary (text)', prompt: 'Summarise mission M-126 for the Owner in two sentences.', json: false,
    out: 'M-126 is 76% verified: header and 11 of 14 pages are migrated and QA is running visual diffs. One approval is pending for the production publish; no blockers on schedule.' },
  { key: 'bad', label: 'Malformed output (demo of failure)', prompt: 'List three risks as JSON. (Model drifts out of schema.)', json: true,
    out: '{\n  "risks": [\n    "Locator drift on dynamic forms",\n    "Provider rate limits during release",\n    "Stale cache"\n  ,\n}' },
];

/* Shared demo stores so pages and dialogs (DL-42, DL-44) stay in sync. */
import { create } from 'zustand';
interface RouteState { routes: Record<string, string[]>; caps: Record<string, number>; setRoute: (role: string, models: string[]) => void; setCap: (role: string, cap: number) => void; extra: ModelDef[]; addModel: (m: ModelDef) => void }
export const useRoutes = create<RouteState>((set) => ({
  routes: Object.fromEntries(ROUTE_ROLES.map((r) => [r.role, r.models])),
  caps: Object.fromEntries(ROUTE_ROLES.map((r) => [r.role, r.cap])),
  setRoute: (role, models) => set((s) => ({ routes: { ...s.routes, [role]: models } })),
  setCap: (role, cap) => set((s) => ({ caps: { ...s.caps, [role]: cap } })),
  extra: [],
  addModel: (m) => set((s) => ({ extra: [m, ...s.extra] })),
}));
interface VoiceState { consent: boolean; translate: boolean; voice: string; rate: number; volume: number; lang: string; retention: string; set: (p: Partial<Omit<VoiceState, 'set'>>) => void }
export const useVoice = create<VoiceState>((set) => ({ consent: true, translate: true, voice: 'Aria (neural)', rate: 1, volume: 80, lang: 'ja', retention: 'Discard audio after transcription', set: (p) => set(p) }));

/** Compatibility check used by the Routing validator and DL-42. Returns problems for a role's ordered list. */
export function validateRoute(role: string, models: string[]): string[] {
  const out: string[] = [];
  const ms = models.map((id) => MODEL_BY_ID[id]).filter(Boolean);
  if (ms.length === 0) return ['No model assigned'];
  const first = ms[0];
  if (role === 'Voice' && !['STT', 'TTS'].includes(first.kind)) out.push(`Primary ${first.id} is not a speech model`);
  if (role === 'Translator' && first.kind !== 'Translation' && first.kind !== 'LLM') out.push(`Primary ${first.id} cannot translate`);
  if (!['Voice', 'Translator'].includes(role) && !['LLM', 'Vision'].includes(first.kind)) out.push(`Primary ${first.id} is a ${first.kind} model`);
  if (['Planner', 'Coder', 'Research'].includes(role) && ms.some((m) => !m.json && m.kind === 'LLM')) out.push('Fallback lacks structured JSON; plans may fail validation');
  if (ms.length < 2) out.push('No fallback: a provider outage would stop this role');
  if (ms.every((m) => m.local)) out.push('All local: check capacity');
  return out;
}
