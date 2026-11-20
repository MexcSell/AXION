import { seeded } from '@/data/agents';

/* DEMO fixtures for Models (spec 4.12, 10.8). No secrets are ever stored here, only secret references. */

export type ModelKind = 'LLM' | 'Vision' | 'Embeddings' | 'STT' | 'TTS' | 'Translation';
/** Where the weights run: a hosted API, a local Ollama tag, a raw GGUF file (llama.cpp) or the local speech runtime. */
export type ModelRuntime = 'api' | 'ollama' | 'gguf' | 'speech';
/** 0-100 scores, relative within the catalog (DEMO). `costEff` high = cheap per useful output. */
export interface ModelTraits { quality: number; speed: number; costEff: number; context: number; strengths: string[]; bestFor: string; limits?: string }
/** Only for models whose provider reports usage. `quota` is the monthly cap the gateway enforces. */
export interface ModelUsage { used: number; quota: number; unit: string; period: string; calls: number }
/** Local weights: footprint on disk and in memory when loaded. */
export interface ModelLocal { file: string; sizeGB: number; quant: string; params: string; memGB: number; memKind: 'VRAM' | 'RAM'; loaded: boolean; tokPerSec?: number }
export interface ModelDef {
  id: string; name: string; kind: ModelKind; provider: string; local: boolean; status: 'ready' | 'degraded' | 'disabled' | 'optional';
  ctx: string; modalities: string[]; costIn: number | null; costOut: number | null; costUnit: string; latencyMs: number; json: boolean; blurb: string; hue: number;
  runtime?: ModelRuntime; traits?: ModelTraits; usage?: ModelUsage; weights?: ModelLocal;
}
const BASE: ModelDef[] = [
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
  // extra local weights: Ollama tags and raw GGUF files served by llama.cpp
  { id: 'local/qwen3-coder-32b', name: 'Qwen3 Coder 32B (Ollama)', kind: 'LLM', provider: 'local-ollama', local: true, status: 'ready', ctx: '128K', modalities: ['text'], costIn: 0, costOut: 0, costUnit: 'local', latencyMs: 1250, json: true, blurb: 'Private code edits and refactors on the host GPU', hue: 150 },
  { id: 'local/mistral-small-24b', name: 'Mistral Small 3.2 24B (Ollama)', kind: 'LLM', provider: 'local-ollama', local: true, status: 'optional', ctx: '128K', modalities: ['text', 'image'], costIn: 0, costOut: 0, costUnit: 'local', latencyMs: 980, json: true, blurb: 'Balanced local generalist with tool calling', hue: 150 },
  { id: 'gguf/qwen3-14b-q5', name: 'Qwen3 14B Instruct (GGUF)', kind: 'LLM', provider: 'local-llamacpp', local: true, status: 'ready', ctx: '32K', modalities: ['text'], costIn: 0, costOut: 0, costUnit: 'local', latencyMs: 640, json: true, blurb: 'Fast local triage and JSON extraction', hue: 28 },
  { id: 'gguf/mistral-7b-q4', name: 'Mistral 7B Instruct v0.3 (GGUF)', kind: 'LLM', provider: 'local-llamacpp', local: true, status: 'optional', ctx: '32K', modalities: ['text'], costIn: 0, costOut: 0, costUnit: 'local', latencyMs: 310, json: false, blurb: 'Tiny always-on fallback, runs on CPU', hue: 28 },
  { id: 'gguf/phi-4-mini-q8', name: 'Phi-4 Mini (GGUF)', kind: 'LLM', provider: 'local-llamacpp', local: true, status: 'optional', ctx: '128K', modalities: ['text'], costIn: 0, costOut: 0, costUnit: 'local', latencyMs: 280, json: true, blurb: 'Small reasoning model for offline summaries', hue: 28 },
];

const t = (quality: number, speed: number, costEff: number, context: number, strengths: string[], bestFor: string, limits?: string): ModelTraits => ({ quality, speed, costEff, context, strengths, bestFor, limits });
const u = (used: number, quota: number, unit: string, calls: number, period = 'this month'): ModelUsage => ({ used, quota, unit, period, calls });
const w = (file: string, sizeGB: number, quant: string, params: string, memGB: number, loaded: boolean, tokPerSec?: number, memKind: 'VRAM' | 'RAM' = 'VRAM'): ModelLocal => ({ file, sizeGB, quant, params, memGB, memKind, loaded, tokPerSec });

/** Characteristics, usage and local footprint per model (DEMO). Models without `usage` cannot report it (disabled or offline). */
const DETAILS: Record<string, Pick<ModelDef, 'runtime' | 'traits' | 'usage' | 'weights'>> = {
  'claude-opus-5-5': { runtime: 'api', traits: t(98, 42, 30, 80, ['Multi-step planning', 'Hard reasoning', 'Code review'], 'Mission plans, re-plans and decisions that are expensive to get wrong', 'Slowest and most expensive per token'), usage: u(38, 60, 'M tok', 6120) },
  'claude-sonnet-5-5': { runtime: 'api', traits: t(92, 70, 68, 80, ['Coding', 'Tool use', 'Browser control'], 'Default worker for coder and browser agents'), usage: u(312, 400, 'M tok', 48210) },
  'claude-haiku-5-5': { runtime: 'api', traits: t(80, 94, 92, 60, ['Low latency', 'Classification', 'Summaries'], 'QA checks, triage and high-volume short calls'), usage: u(402, 600, 'M tok', 91400) },
  'claude-fable-5-2': { runtime: 'api', traits: t(90, 60, 55, 100, ['1M context', 'Long documents', 'Synthesis'], 'Research briefs across many long sources'), usage: u(54, 120, 'M tok', 2900) },
  'local/llama-4-70b': { runtime: 'ollama', traits: t(82, 30, 100, 45, ['Private', 'Offline', 'No per-token cost'], 'Last-resort fallback when data must not leave the host', 'Slow on one GPU; no strict JSON mode'), weights: w('llama4:70b-instruct-q4_K_M', 42.5, 'Q4_K_M', '70B', 40.2, false, 14) },
  'claude-sonnet-5-5-vision': { runtime: 'api', traits: t(90, 62, 66, 80, ['Screenshot reading', 'Visual diff', 'OCR'], 'QA visual regression and browser page understanding'), usage: u(22, 80, 'M tok', 9300) },
  'local/llava-next-34b': { runtime: 'ollama', traits: t(70, 25, 100, 20, ['Offline captions', 'Private images'], 'Captioning screenshots that must stay on the host', 'Weak at small text'), weights: w('llava-next:34b-q4_K_M', 20.1, 'Q4_K_M', '34B', 21.4, false, 11) },
  'embed-text-v4': { runtime: 'api', traits: t(88, 98, 95, 15, ['1536-dim vectors', 'Multilingual'], 'Knowledge index and semantic search'), usage: u(96, 200, 'M tok', 188000) },
  'local/bge-m3': { runtime: 'ollama', traits: t(80, 90, 100, 15, ['Dense + sparse', '100+ languages'], 'Private embeddings for sensitive documents'), weights: w('bge-m3:567m-fp16', 1.2, 'F16', '567M', 1.4, true, 900) },
  'whisper-large-v4': { runtime: 'speech', traits: t(90, 72, 100, 10, ['99 languages', 'Timestamps', 'Noise robust'], 'Owner voice commands, transcribed on the host'), usage: u(412, 1000, 'min', 840), weights: w('whisper-large-v4.bin', 3.1, 'F16', '1.6B', 3.8, true) },
  'cloud-stt-streaming': { runtime: 'api', traits: t(86, 92, 60, 10, ['Streaming partials', 'Diarization'], 'Live meetings once a retention scope is approved', 'Disabled: no retention scope set') },
  'local-tts-neural': { runtime: 'speech', traits: t(78, 85, 100, 10, ['Offline voices', 'Rate and volume'], 'Spoken replies from agents without sending text out'), usage: u(96, 600, 'min', 410), weights: w('piper-neural-aria.onnx', 0.4, 'F32', '60M', 0.6, true, undefined, 'RAM') },
  'cloud-tts-studio': { runtime: 'api', traits: t(95, 55, 50, 10, ['Studio voices', 'Emotion control'], 'Polished narration for reports and demos', 'Latency elevated right now'), usage: u(208, 300, 'min', 620) },
  'translate-ja-en-v2': { runtime: 'api', traits: t(90, 88, 85, 30, ['Keeps terminology', 'JA to EN'], 'Owner instructions written in Japanese'), usage: u(18, 50, 'M tok', 11340) },
  'local/nllb-200': { runtime: 'ollama', traits: t(72, 80, 100, 5, ['200 languages', 'Private'], 'Offline translation of short texts', 'Short context only'), weights: w('nllb-200:3.3b-q8_0', 3.6, 'Q8_0', '3.3B', 4.1, false, 60) },
  'local/qwen3-coder-32b': { runtime: 'ollama', traits: t(86, 48, 100, 45, ['Code edits', 'Tool calls', 'JSON'], 'Private code work on repositories that must not leave the host'), weights: w('qwen3-coder:32b-q4_K_M', 19.8, 'Q4_K_M', '32B', 22.6, true, 28) },
  'local/mistral-small-24b': { runtime: 'ollama', traits: t(80, 58, 100, 45, ['Tool calling', 'Vision input'], 'General local assistant work'), weights: w('mistral-small3.2:24b-q4_K_M', 15.1, 'Q4_K_M', '24B', 17.3, false, 34) },
  'gguf/qwen3-14b-q5': { runtime: 'gguf', traits: t(76, 78, 100, 25, ['JSON extraction', 'Fast'], 'Triage and structured extraction without network'), weights: w('Qwen3-14B-Instruct-Q5_K_M.gguf', 10.5, 'Q5_K_M', '14B', 11.8, true, 52) },
  'gguf/mistral-7b-q4': { runtime: 'gguf', traits: t(62, 92, 100, 25, ['CPU friendly', 'Tiny footprint'], 'Always-on fallback when the GPU is busy', 'No reliable JSON'), weights: w('Mistral-7B-Instruct-v0.3-Q4_K_M.gguf', 4.4, 'Q4_K_M', '7B', 5.2, false, 38, 'RAM') },
  'gguf/phi-4-mini-q8': { runtime: 'gguf', traits: t(68, 90, 100, 45, ['Reasoning for size', 'Long context'], 'Offline summaries of long logs'), weights: w('Phi-4-mini-instruct-Q8_0.gguf', 4.1, 'Q8_0', '3.8B', 4.9, false, 70) },
};
export const MODELS: ModelDef[] = BASE.map((m) => ({ ...m, ...DETAILS[m.id] }));

/** The local GPU host that runs Ollama, llama.cpp and the speech runtime (DEMO). */
export const LOCAL_HOST = { name: 'gpu-01 (this VPS)', gpu: 'NVIDIA L40S', vramGB: 48, ramGB: 128, diskGB: 500, ollamaVersion: '0.9.4', llamacppBuild: 'b5920' };
export function localFootprint(models: ModelDef[]) {
  const loc = models.filter((m) => m.weights);
  return {
    diskGB: +loc.reduce((s, m) => s + (m.weights?.sizeGB ?? 0), 0).toFixed(1),
    vramGB: +loc.filter((m) => m.weights?.loaded && m.weights.memKind === 'VRAM').reduce((s, m) => s + (m.weights?.memGB ?? 0), 0).toFixed(1),
    ramGB: +(18 + loc.filter((m) => m.weights?.loaded && m.weights.memKind === 'RAM').reduce((s, m) => s + (m.weights?.memGB ?? 0), 0)).toFixed(1),
  };
}
export const MODEL_BY_ID: Record<string, ModelDef> = Object.fromEntries(MODELS.map((m) => [m.id, m]));

export interface Provider { id: string; name: string; kind: 'remote' | 'local'; endpoint: string; credential: 'encrypted' | 'none' | 'missing' | 'expiring'; credRef: string; rotated: string; health: 'healthy' | 'degraded' | 'down' | 'idle'; latency: number[]; models: number; quota: number; region: string }
const lat = (seed: string, base: number, jitter: number) => { const r = seeded(seed); return Array.from({ length: 24 }, () => Math.round(base + (r() - 0.5) * jitter)); };
export const PROVIDERS: Provider[] = [
  { id: 'anthropic', name: 'Anthropic API', kind: 'remote', endpoint: 'api.anthropic.com', credential: 'encrypted', credRef: 'secret://providers/anthropic/key', rotated: '12 d ago', health: 'healthy', latency: lat('p1', 720, 220), models: 7, quota: 62, region: 'us-east' },
  { id: 'local-ollama', name: 'Local Ollama (optional)', kind: 'local', endpoint: '127.0.0.1:11434', credential: 'none', credRef: 'no credential needed', rotated: 'n/a', health: 'healthy', latency: lat('p2', 1800, 900), models: 6, quota: 0, region: 'this host' },
  { id: 'local-speech', name: 'Local speech runtime', kind: 'local', endpoint: '127.0.0.1:8787', credential: 'none', credRef: 'no credential needed', rotated: 'n/a', health: 'idle', latency: lat('p3', 560, 200), models: 2, quota: 0, region: 'this host' },
  { id: 'local-llamacpp', name: 'Local llama.cpp (GGUF)', kind: 'local', endpoint: '127.0.0.1:8080', credential: 'none', credRef: 'no credential needed', rotated: 'n/a', health: 'healthy', latency: lat('p5', 520, 260), models: 3, quota: 0, region: 'this host' },
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
interface RouteState {
  routes: Record<string, string[]>; caps: Record<string, number>; setRoute: (role: string, models: string[]) => void; setCap: (role: string, cap: number) => void; extra: ModelDef[]; addModel: (m: ModelDef) => void;
  /** management-window overrides, shared by the Manager cards and the DL-41b dialog */
  off: Record<string, boolean>; setOff: (id: string, off: boolean) => void;
  quota: Record<string, number>; setQuota: (id: string, q: number) => void;
  loaded: Record<string, boolean>; setLoaded: (id: string, v: boolean) => void;
  removed: Record<string, boolean>; remove: (id: string) => void;
}
export const useRoutes = create<RouteState>((set) => ({
  routes: Object.fromEntries(ROUTE_ROLES.map((r) => [r.role, r.models])),
  caps: Object.fromEntries(ROUTE_ROLES.map((r) => [r.role, r.cap])),
  setRoute: (role, models) => set((s) => ({ routes: { ...s.routes, [role]: models } })),
  setCap: (role, cap) => set((s) => ({ caps: { ...s.caps, [role]: cap } })),
  extra: [],
  addModel: (m) => set((s) => ({ extra: [m, ...s.extra] })),
  off: {}, setOff: (id, off) => set((s) => ({ off: { ...s.off, [id]: off } })),
  quota: {}, setQuota: (id, q) => set((s) => ({ quota: { ...s.quota, [id]: q } })),
  loaded: {}, setLoaded: (id, v) => set((s) => ({ loaded: { ...s.loaded, [id]: v } })),
  removed: {}, remove: (id) => set((s) => ({ removed: { ...s.removed, [id]: true } })),
}));
/** Effective view of a model after the Owner's management changes. */
export function useModelState(m: ModelDef) {
  const off = useRoutes((s) => s.off[m.id]);
  const q = useRoutes((s) => s.quota[m.id]);
  const l = useRoutes((s) => s.loaded[m.id]);
  return {
    disabled: off ?? m.status === 'disabled',
    quota: q ?? m.usage?.quota,
    loaded: l ?? m.weights?.loaded ?? false,
  };
}
/** Status band for a used/limit share. Text label always accompanies the colour. */
export function usageBand(pct: number): { tone: 'ok' | 'warn' | 'bad'; label: string } {
  return pct >= 90 ? { tone: 'bad', label: 'at limit' } : pct >= 70 ? { tone: 'warn', label: 'near limit' } : { tone: 'ok', label: 'healthy' };
}
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
