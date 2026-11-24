import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireUser } from '../auth/session.ts';
import { ApiError } from '../errors.ts';
import { audit } from '../audit.ts';
import { parse } from '../auth/routes.ts';
import { CloudCallError, type CloudAdapter } from './claude-cli.ts';
import { CLOUD_PROMPT_MAX, type CloudCompletionDto, type CloudModelStatusDto, type CloudModelsDto } from '../../../shared/contracts/src/index.ts';

/**
 * The live cloud models (owner requests 2026-11-24): one per CLAUDE_CODE_OAUTH_TOKEN<n> in the server's environment.
 *  GET  /cloud-models                 every signed-in person: which models exist (id, label, model, token VARIABLE name), calls running. Never a token.
 *  POST /cloud-models/:id/complete    administrators only (each token is the owner's own subscription): {prompt, format?}.
 *                                     Rate limited (bucket "cloud", shared by all models), at most MAX_IN_FLIGHT at once per model, prompt and
 *                                     answer capped, audited (sizes and timing only, never the prompt or the answer).
 * Nothing else in the server calls a model: missions, tasks and routing stay disabled.
 */
export const MAX_IN_FLIGHT = 2;
const TEXT_CAP = 20_000;
const SYSTEM = 'You are the AXION assistant, answering an administrator testing the cloud model from the AXION web app. Answer plainly and briefly.';
const JSON_RULE = ' Reply with exactly one JSON value and nothing else: no prose, no code fences.';
const Body = z.object({ prompt: z.string().trim().min(1, 'Write a prompt.').max(CLOUD_PROMPT_MAX, `A prompt can be at most ${CLOUD_PROMPT_MAX} characters.`), format: z.enum(['text', 'json']).default('text') }).strict();

const stripFence = (s: string) => s.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/, '$1').trim();

interface Slot { adapter: CloudAdapter; inFlight: number; lastCall: CloudModelStatusDto['lastCall'] }

export default async function cloudModelRoutes(app: FastifyInstance) {
  const adapters = app.cfg.cloudModels ?? [];
  const ids = adapters.map((a) => a.id);
  if (new Set(ids).size !== ids.length) throw new Error('two cloud models share an id: ' + ids.join(', '));
  const slots = new Map<string, Slot>(adapters.map((a) => [a.id, { adapter: a, inFlight: 0, lastCall: null }]));
  app.log.info({ cloudModels: adapters.map((a) => `${a.id}=${a.model} (${a.tokenVar})`) }, adapters.length ? `${adapters.length} cloud model(s) configured (claude CLI, tools off)` : 'no cloud model configured (no CLAUDE_CODE_OAUTH_TOKEN<n>)');

  app.get('/cloud-models', async (req): Promise<CloudModelsDto> => {
    const ctx = await requireUser(req);
    return {
      models: [...slots.values()].map((s) => ({ id: s.adapter.id, label: s.adapter.label, provider: 'anthropic', transport: 'claude-code-cli', tokenVar: s.adapter.tokenVar, model: s.adapter.model, inFlight: s.inFlight, lastCall: s.lastCall })),
      maxInFlight: MAX_IN_FLIGHT, canPrompt: ctx.user.role === 'admin',
    };
  });

  app.post<{ Params: { id: string } }>('/cloud-models/:id/complete', { bodyLimit: 64 * 1024 }, async (req): Promise<CloudCompletionDto> => {
    const ctx = await requireAdmin(req);
    const b = parse(Body, req.body); // 400 VALIDATION, like every route that uses the shared parser
    const slot = slots.get(req.params.id);
    if (!slot) {
      if (!slots.size) throw new ApiError('MODEL_NOT_CONFIGURED', 503, 'No cloud model is configured on this server. Set CLAUDE_CODE_OAUTH_TOKEN1 in the server environment and restart it.');
      throw new ApiError('NOT_FOUND', 404, 'There is no cloud model with that id.');
    }
    if (slot.inFlight >= MAX_IN_FLIGHT) throw new ApiError('MODEL_BUSY', 429, `${slot.adapter.label} is already answering ${MAX_IN_FLIGHT} prompts. Try again in a moment.`, { retryable: true });
    const { prompt, format } = b;
    const { adapter } = slot;
    slot.inFlight++;
    const started = Date.now();
    const base = { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'model.cloud.complete', subject: `${adapter.id}:${adapter.model}`, correlationId: ctx.correlationId };
    try {
      const r = await adapter.complete({ prompt, system: SYSTEM + (format === 'json' ? JSON_RULE : '') });
      const text = r.text.length > TEXT_CAP ? r.text.slice(0, TEXT_CAP) : r.text;
      let validJson: boolean | null = null;
      if (format === 'json') { try { JSON.parse(stripFence(r.text)); validJson = true; } catch { validJson = false; } }
      slot.lastCall = { at: new Date().toISOString(), ok: true, durationMs: r.durationMs };
      await audit(app.db, { ...base, result: 'ok', detail: { format, promptChars: prompt.length, answerChars: r.text.length, usageIn: r.usage.input, usageOut: r.usage.output, durationMs: r.durationMs } });
      return { id: adapter.id, model: adapter.model, text, truncated: text.length < r.text.length, format, validJson, durationMs: r.durationMs, usage: r.usage };
    } catch (e) {
      const durationMs = Date.now() - started;
      slot.lastCall = { at: new Date().toISOString(), ok: false, durationMs };
      const kind = e instanceof CloudCallError ? e.kind : 'failed';
      req.log.warn({ model: adapter.id, kind, why: e instanceof CloudCallError ? e.message : 'unexpected error' }, 'cloud model call failed');
      await audit(app.db, { ...base, result: 'error', detail: { format, promptChars: prompt.length, durationMs, kind } }).catch(() => { /* the call's own error is the one reported */ });
      if (kind === 'timeout') throw new ApiError('MODEL_TIMEOUT', 504, `${adapter.label} did not answer in time. Try a shorter prompt or try again.`, { retryable: true });
      throw new ApiError('MODEL_FAILED', 502, `${adapter.label} could not answer. Check the server log for the reason, then try again.`, { retryable: true });
    } finally { slot.inFlight--; }
  });
}
