/**
 * The live cloud models (owner requests 2026-11-24). Each Claude Code OAuth token in the repository's root .env
 * (CLAUDE_CODE_OAUTH_TOKEN1, CLAUDE_CODE_OAUTH_TOKEN2, ...) is one model; the server answers through the `claude` CLI with every tool off.
 * Tokens never leave the server: the browser only sees which models exist.
 * Mission execution stays off: missions, tasks and routing never call this model.
 */
export type CloudModelFormat = 'text' | 'json';

export type CloudModelAction = 'refresh' | 'enable' | 'disable' | 'remove';
export interface CloudUsageWindow {
  label: string;
  percent: number;
  resetsAt: string | null;
}
export interface CloudModelCheck {
  checkedAt: string;
  status: 'available' | 'unavailable' | 'limited' | 'timeout';
  resetsAt: string | null;
  account: string | null;
  windows: CloudUsageWindow[];
}

/** One live cloud model: one per CLAUDE_CODE_OAUTH_TOKEN<n> in the server's environment. */
export interface CloudModelStatusDto {
  /** route id, e.g. claude-1 */
  id: string;
  /** e.g. "Claude 1" */
  label: string;
  provider: 'anthropic';
  /** how the server reaches the model */
  transport: 'claude-code-cli';
  /** the env var holding this model's token: a name, the value is never sent */
  tokenVar: string;
  model: string;
  enabled: boolean;
  check: CloudModelCheck | null;
  /** calls running now on this model */
  inFlight: number;
  /** the most recent call since the server started (null before the first) */
  lastCall: { at: string; ok: boolean; durationMs: number } | null;
}

/** GET /cloud-models. `models` is empty when no token is configured. */
export interface CloudModelsDto {
  models: CloudModelStatusDto[];
  /** the most calls one model runs at once */
  maxInFlight: number;
  /** only administrators may send prompts */
  canPrompt: boolean;
}

export interface CloudCompletionDto {
  /** which live model answered (its id) */
  id: string;
  model: string;
  text: string;
  /** true when the reply was cut at the server's output cap */
  truncated: boolean;
  format: CloudModelFormat;
  /** only for format 'json': whether the reply parses as JSON */
  validJson: boolean | null;
  durationMs: number;
  usage: { input: number; output: number };
}

export const CLOUD_PROMPT_MAX = 8000;

/**
 * The chat model route (owner 2026-11-25): which cloud models answer the GM and agent chats, in order. The first usable one answers;
 * the router moves to the next when a model is disabled, removed, limited or failing. GET /chat-model (everyone), PUT /chat-model (administrators).
 */
export interface ChatRouteEntryDto {
  id: string;
  label: string;
  /** '' when the id is not configured on this server */
  model: string;
  configured: boolean;
  /** configured and not Disabled or Removed on Models › Providers */
  enabled: boolean;
  /** enabled and not cooling down after a limit or a failure */
  usable: boolean;
  /** why it is not usable, else null */
  reason: string | null;
  /** when a cooldown ends (ISO), else null */
  until: string | null;
}
export interface ChatModelRouteDto {
  /** the chat models in preference order (ids); the models after them in `entries` are not used for chat */
  models: string[];
  /** false = the default order (CHAT_MODEL, else claude-2, first) */
  custom: boolean;
  entries: ChatRouteEntryDto[];
  /** the model the next answer goes to (null = none can answer: the chats show the honest note) */
  active: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  canEdit: boolean;
}
export const CHAT_ROUTE_MAX = 20;
/** GET /chat-model/usage?days=N (administrators): chat answers per day and model, from the audit log. */
export interface ChatUsageRowDto { day: string; modelId: string; calls: number; errors: number; answered: number; inputTokens: number; outputTokens: number }
export interface ChatUsageDto { days: number; rows: ChatUsageRowDto[]; fallbacks: number }
