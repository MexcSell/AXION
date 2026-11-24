/**
 * The live cloud models (owner requests 2026-11-24). Each Claude Code OAuth token in the repository's root .env
 * (CLAUDE_CODE_OAUTH_TOKEN1, CLAUDE_CODE_OAUTH_TOKEN2, ...) is one model; the server answers through the `claude` CLI with every tool off.
 * Tokens never leave the server: the browser only sees which models exist.
 * Mission execution stays off: missions, tasks and routing never call this model.
 */
export type CloudModelFormat = 'text' | 'json';

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
