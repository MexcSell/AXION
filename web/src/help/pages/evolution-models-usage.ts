import type { HelpEntry } from '../registry';

const h = (title: string, what: string, extra: Partial<HelpEntry> = {}): HelpEntry => ({ title, what, ...extra });

const entries: Record<string, HelpEntry> = {
  /* Evolution */
  /* Models */
  'models.page': h('Models', 'The model gateway. Roles are separate from providers, so you can change a model without changing an agent.', { permission: 'Secrets are resolved only on the server and are never displayed.' }),
  'models.kpi.ready': h('Ready models', 'Models that are enabled and available to routing.'),
  'models.kpi.providers': h('Healthy providers', 'Providers whose last health check passed.'),
  'models.kpi.latency': h('p50 latency', 'Median time to first complete response across all models in the last 24 hours.'),
  'models.kpi.errors': h('Error rate', 'Share of model calls that returned an error in the last 24 hours, before retries.'),
  'models.kpi.cache': h('Prompt cache hit', 'Share of input tokens served from a cache, which lowers token use and latency.'),
  'models.tab.manager': h('Model manager', 'The model management window. Models are grouped as LLM, TTS (text to speech), STT (speech to text) and Local (Ollama tags and GGUF files), with vision, embeddings and translation under Other.', { how: 'Each card shows what the model is good at, its share of company use and, for local models, the disk and memory it occupies. Click a card to manage it.' }),
  'models.kpi.vram': h('Local VRAM in use', 'GPU memory taken by local models that are loaded right now, against the host GPU total.', { why: 'A model that does not fit in VRAM falls back to slow CPU memory or fails to load.' }),
  'models.manager.categories': h('Model categories', 'LLM: language models. TTS: text to speech. STT: speech to text. Local: weights on this host, either Ollama tags or GGUF files served by llama.cpp. Other: vision, embeddings and translation. A local LLM appears in both LLM and Local.'),
  'models.manager.sort': h('Sort', 'Most used puts models closest to their limit (or using the most memory) first, so pressure is visible at a glance.'),
  'models.manager.host': h('Local host capacity', 'Disk, GPU memory (VRAM) and system memory on the machine that runs local models. Rings turn amber at 70% and red at 90%.', { how: 'Pull from Ollama downloads a tag; Import GGUF registers a .gguf file for llama.cpp.' }),
  'models.manage': h('Manage model', 'Everything about one model: its characteristics, usage against its limit, the role it leads, and for local models the weights file, quantization and memory footprint.', { permission: 'Disabling or removing a model never breaks running missions: routing moves to the next fallback.' }),
  'models.manage.traits': h('Characteristics', 'Relative scores within this catalog: quality on the company benchmark, speed (latency), token efficiency per verified output, and usable context length. Strengths and best-for come from evaluation notes.'),
  'models.manage.usage': h('Usage ring', 'This model\'s share of all company use in the same unit (tokens or minutes) this month. There are no limits or funds. Only models whose provider reports usage show a ring.'),
  'models.manage.default': h('Default for a role', 'Puts this model first in the role routing list. The previous models stay as fallbacks, in order.'),
  'models.manage.capacity': h('Local capacity', 'Size of the weights on disk and the memory they need when loaded. Loading uses VRAM (or RAM for CPU models); unloading frees it.', { how: 'Ollama models can pull updates. GGUF files can be re-quantized: smaller quantization (Q4) uses less memory, larger (Q8, F16) keeps more quality.' }),
  'models.tab.providers': h('Providers', 'Local and remote providers with endpoint health and encrypted credential status.'),
  'models.tab.routing': h('Routing', 'For each role, an ordered list of models. The first is tried first; the rest are fallbacks.'),
  'models.tab.playground': h('Playground', 'Try a prompt and see a streamed response with JSON validation. Never changes production routing.'),
  'models.tab.usage': h('Model usage', 'Calls, tokens, speech minutes and errors per model.'),
  'models.tab.health': h('Health', 'Latency and error trends, provider incidents and retry state.'),
  'models.voice': h('Voice pipeline', 'Optional: microphone capture with consent, speech to text, optional translation, agent reasoning, then synthesized speech.', { permission: 'Audio is only used with explicit consent, language and retention scope.' }),
  'models.voice.consent': h('Microphone consent', 'Without consent no audio is captured and voice turns are blocked.'),
  'models.routing': h('Routing precedence', 'The gateway picks the first model that is available, not overloaded and compatible with the task data handling. The Model Loader agent keeps each order fitted to its agents.', { example: 'Planner: Opus 5.5 first, Sonnet 5.5 if Opus is rate limited, local Llama as last resort.' }),
  'models.add': h('Add model or provider', 'Connect a model by type, ID, endpoint and a credential. The key is encrypted server-side and replaced with a reference.', { permission: 'Validation never displays the secret.' }),
  'models.add.type': h('Model type', 'The modality this model serves. It decides which roles can use it.'),
  'models.add.provider': h('Provider', 'Where the model runs. Local providers need no credential.'),
  'models.add.id': h('Model ID', 'The exact identifier the provider expects, for example claude-sonnet-5-5.'),
  'models.add.credential': h('Credential', 'Paste once. It is encrypted and never shown again; only a reference like secret://providers/name/key remains.'),
  'models.playground': h('Benchmark test', 'Compare models on the same sample for quality, JSON validity, latency and tokens used.'),
  'models.usage.calls': h('Calls per hour', 'Number of model calls each hour in the last 24 hours.'),
  'models.usage.tokens': h('Tokens by model', 'Input and output tokens in millions, per model, month to date.'),
  'models.health.latency': h('Latency by provider', 'Median response time per provider in the last 24 hours.'),
  'models.incidents': h('Incidents', 'Provider outages and degradations, with the fallback decisions taken.'),
  /* Usage */
};
export default entries;
