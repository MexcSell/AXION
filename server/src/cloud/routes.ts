import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireUser } from '../auth/session.ts';
import { ApiError } from '../errors.ts';
import { tx } from '../db.ts';
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
 * Besides these routes only the GM and agent direct-chat responder calls a model (owner 2026-11-25, conversations/responder.ts, no bucket
 * and no in-flight cap there); missions, tasks and routing stay disabled.
 */
export const MAX_IN_FLIGHT = 2;
const TEXT_CAP = 20_000;
const SYSTEM = 'You are the AXION assistant, answering an administrator testing the cloud model from the AXION web app. Answer plainly and briefly.';
const JSON_RULE = ' Reply with exactly one JSON value and nothing else: no prose, no code fences.';
const Body = z.object({ prompt: z.string().trim().min(1, 'Write a prompt.').max(CLOUD_PROMPT_MAX, `A prompt can be at most ${CLOUD_PROMPT_MAX} characters.`), format: z.enum(['text', 'json']).default('text') }).strict();

const stripFence = (s: string) => s.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/, '$1').trim();

interface Slot { adapter: CloudAdapter; inFlight: number; lastCall: CloudModelStatusDto['lastCall']; check: CloudModelStatusDto['check']; refreshing: boolean }

export default async function cloudModelRoutes(app: FastifyInstance) {
  const adapters = app.cfg.cloudModels ?? [];
  const ids = adapters.map((a) => a.id);
  if (new Set(ids).size !== ids.length) throw new Error('two cloud models share an id: ' + ids.join(', '));
  const slots = new Map<string, Slot>(adapters.map((a) => [a.id, { adapter: a, inFlight: 0, lastCall: null, check: a.previousCheck ?? null, refreshing: false }]));
  app.log.info({ cloudModels: adapters.map((a) => `${a.id}=${a.model} (${a.tokenVar})`) }, adapters.length ? `${adapters.length} cloud model(s) configured (claude CLI, tools off)` : 'no cloud model configured (no CLAUDE_CODE_OAUTH_TOKEN<n>)');

  async function settings(tenantId: string) {
    const rows = await app.db.query<{ model_id: string; state: string }>('select model_id, state from cloud_model_settings where tenant_id = $1', [tenantId]);
    return new Map(rows.rows.map(row => [row.model_id, row.state]));
  }

  function list(states: Map<string, string>, admin: boolean): CloudModelsDto {
    const models: CloudModelStatusDto[] = [];
    for (const [id, slot] of slots) {
      if (states.get(id) === 'removed') continue;
      const { label, tokenVar, model } = slot.adapter;
      const check = slot.check && { ...slot.check, account: admin ? slot.check.account : null };
      models.push({ id, label, tokenVar, model, provider: 'anthropic', transport: 'claude-code-cli', enabled: states.get(id) !== 'disabled', check, inFlight: slot.inFlight, lastCall: slot.lastCall });
    }
    return { models, maxInFlight: MAX_IN_FLIGHT, canPrompt: admin };
  }

  const missing = () => new ApiError('NOT_FOUND', 404, 'There is no cloud model with that id.');
  function requireAvailableSlot(id: string, state: string | undefined) {
    const slot = slots.get(id);
    if (!slot || state === 'removed') throw missing();
    if (state === 'disabled') throw new ApiError('ACTION_NOT_ALLOWED', 409, 'Enable this model before using it.');
    if (slot.inFlight >= MAX_IN_FLIGHT) throw new ApiError('MODEL_BUSY', 429, 'This model is busy. Try again in a moment.', { retryable: true });
    return slot;
  }

  app.get('/cloud-models', async (req): Promise<CloudModelsDto> => {
    const ctx = await requireUser(req);
    return list(await settings(ctx.tenantId), ctx.user.role === 'admin');
  });

  const Action = z.object({ action: z.enum(['enable', 'disable', 'refresh', 'remove']) }).strict();
  app.post<{ Params: { id: string } }>('/cloud-models/:id/manage', async (req): Promise<CloudModelsDto> => {
    const ctx = await requireAdmin(req);
    const { action } = parse(Action, req.body);
    const { id } = req.params;
    if (!slots.has(id)) throw missing();
    const entry = { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'model.cloud.' + action, subject: id, correlationId: ctx.correlationId };
    if (action === 'refresh') {
      const slot = requireAvailableSlot(id, (await settings(ctx.tenantId)).get(id));
      if (slot.refreshing) throw new ApiError('MODEL_BUSY', 429, 'A refresh is already running.', { retryable: true });
      const started = Date.now();
      slot.refreshing = true;
      slot.inFlight++;
      try {
        slot.check = await slot.adapter.refresh();
      } catch (err) {
        slot.check = { checkedAt: new Date().toISOString(), status: err instanceof CloudCallError && err.kind === 'timeout' ? 'timeout' : 'unavailable',
          account: null, resetsAt: null, windows: [] };
      } finally {
        slot.refreshing = false;
        slot.inFlight--;
      }
      slot.lastCall = { at: slot.check.checkedAt, ok: slot.check.status === 'available', durationMs: Date.now() - started };
      await audit(app.db, { ...entry, result: slot.lastCall.ok ? 'ok' : 'error', detail: { status: slot.check.status } });
    } else {
      const state = { enable: 'enabled', disable: 'disabled', remove: 'removed' }[action];
      await tx(app.db, async c => {
        const updated = await c.query(`insert into cloud_model_settings (tenant_id, model_id, state) values ($1, $2, $3)
          on conflict (tenant_id, model_id) do update set state = excluded.state where cloud_model_settings.state <> 'removed'`, [ctx.tenantId, id, state]);
        if (!updated.rowCount) throw missing();
        await audit(c, { ...entry, result: 'ok' });
      });
    }
    return list(await settings(ctx.tenantId), true);
  });

  app.post<{ Params: { id: string } }>('/cloud-models/:id/complete', { bodyLimit: 64 * 1024 }, async (req): Promise<CloudCompletionDto> => {
    const ctx = await requireAdmin(req);
    const b = parse(Body, req.body); // 400 VALIDATION, like every route that uses the shared parser
    if (!slots.size) throw new ApiError('MODEL_NOT_CONFIGURED', 503, 'No cloud model is configured on this server. Set CLAUDE_CODE_OAUTH_TOKEN1 in the server environment and restart it.');
    const slot = requireAvailableSlot(req.params.id, (await settings(ctx.tenantId)).get(req.params.id));
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
      // the answer is already paid for: an audit write that fails is logged, never turned into a failed call
      await audit(app.db, { ...base, result: 'ok', detail: { format, promptChars: prompt.length, answerChars: r.text.length, usageIn: r.usage.input, usageOut: r.usage.output, durationMs: r.durationMs } })
        .catch((err) => req.log.error({ err }, 'cloud model call audit could not be saved'));
      return { id: adapter.id, model: adapter.model, text, truncated: text.length < r.text.length, format, validJson, durationMs: r.durationMs, usage: r.usage };
    } catch (e) {
      const durationMs = Date.now() - started;
      slot.lastCall = { at: new Date().toISOString(), ok: false, durationMs };
      const kind = e instanceof CloudCallError ? e.kind : 'failed';
      req.log.warn({ model: adapter.id, kind, why: e instanceof CloudCallError ? e.message : 'unexpected error' }, 'cloud model call failed');
      await audit(app.db, { ...base, result: 'error', detail: { format, promptChars: prompt.length, durationMs, kind } }).catch(() => { /* the call's own error is the one reported */ });
      if (kind === 'limited') {
        const reset = slot.check?.resetsAt;
        const when = reset && Date.parse(reset) > Date.now() ? ' The reported reset is ' + reset.slice(0, 16).replace('T', ' ') + ' UTC.' : ' Refresh the provider to check its reset time.';
        throw new ApiError('MODEL_RATE_LIMITED', 429, adapter.label + ' reached a provider limit.' + when, { retryable: true });
      }
      if (kind === 'timeout') throw new ApiError('MODEL_TIMEOUT', 504, `${adapter.label} did not answer in time. Try a shorter prompt or try again.`, { retryable: true });
      throw new ApiError('MODEL_FAILED', 502, `${adapter.label} could not answer. Check the server log for the reason, then try again.`, { retryable: true });
    } finally { slot.inFlight--; }
  });
}
