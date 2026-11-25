import type { Db, Tx } from '../db.ts';
import type { CloudModelCheck } from '../../../shared/contracts/src/index.ts';
import type { CloudAdapter, CloudFailure } from './claude-cli.ts';

/**
 * The chat model router (owner 2026-11-25: "admin should be able to change it in settings; when a model becomes unusable, the model router
 * must replace it with another model").
 *
 * - Order: per tenant, `chat_model_routes.models` (administrators set it in Settings › AI Chat). No row yet = the default order:
 *   CHAT_MODEL (default claude-2) first, then every other configured cloud model.
 * - Usable: configured on this server, not Disabled or Removed on Models › Providers, and not cooling down.
 * - Cooling down: a provider limit keeps the model out until its reported reset (else 15 minutes); a timeout or failure keeps it out for
 *   1, 2, 4 … minutes (at most 30) after consecutive failures; a success or an "available" provider check clears it.
 * - `candidates()` gives the usable models in order, then, as a last resort, the cooling ones (soonest back first): a stale cooldown never
 *   leaves a chat unanswered while some model might work. Disabled, removed and unconfigured models are never tried.
 * The health is in memory: a restart forgets it, and the first failing call learns it again.
 */
export interface Health { until: number; reason: string; failures: number }
export interface RouteEntry {
  id: string; label: string; model: string;
  configured: boolean; enabled: boolean;
  usable: boolean; reason: string | null; until: string | null;
}
export interface RouteStatus { models: string[]; custom: boolean; entries: RouteEntry[]; active: string | null; updatedAt: string | null; updatedBy: string | null }

const LIMIT_FALLBACK_MS = 15 * 60_000;
const MAX_BACKOFF_MS = 30 * 60_000;
const MAX_RESET_MS = 8 * 24 * 3600_000;

export class ModelRouter {
  private health = new Map<string, Health>();
  constructor(readonly adapters: CloudAdapter[], readonly defaultFirst: string, private now: () => number = Date.now) {}

  get(id: string) { return this.adapters.find((a) => a.id === id); }
  defaultOrder() {
    const ids = this.adapters.map((a) => a.id);
    return ids.includes(this.defaultFirst) ? [this.defaultFirst, ...ids.filter((x) => x !== this.defaultFirst)] : ids;
  }

  /** A call or check outcome for one model. */
  report(id: string, outcome: { ok: true } | { ok: false; kind: CloudFailure; resetsAt?: string | null }) {
    if (outcome.ok) { this.health.delete(id); return; }
    const t = this.now();
    const prev = this.health.get(id);
    if (outcome.kind === 'limited') {
      const reset = outcome.resetsAt ? Date.parse(outcome.resetsAt) : NaN;
      const until = Number.isFinite(reset) && reset > t && reset - t < MAX_RESET_MS ? reset : t + LIMIT_FALLBACK_MS;
      this.health.set(id, { until, reason: 'usage limit reached', failures: (prev?.failures ?? 0) + 1 });
      return;
    }
    const failures = (prev?.failures ?? 0) + 1;
    this.health.set(id, { until: t + Math.min(MAX_BACKOFF_MS, 60_000 * 2 ** (failures - 1)), reason: outcome.kind === 'timeout' ? 'did not answer in time' : 'failed', failures });
  }
  /** A provider check (Models › Providers › Refresh, or the cloud routes) also teaches the router. */
  noteCheck(id: string, check: CloudModelCheck) {
    if (check.status === 'available') this.report(id, { ok: true });
    else if (check.status === 'limited') this.report(id, { ok: false, kind: 'limited', resetsAt: check.resetsAt });
    else this.report(id, { ok: false, kind: check.status === 'timeout' ? 'timeout' : 'failed' });
  }
  cooling(id: string): Health | null {
    const h = this.health.get(id);
    return h && h.until > this.now() ? h : null;
  }

  async route(c: Db | Tx, tenantId: string) {
    const row = (await c.query('select models, updated_at, updated_by from chat_model_routes where tenant_id=$1', [tenantId])).rows[0];
    const states = new Map((await c.query('select model_id, state from cloud_model_settings where tenant_id=$1', [tenantId])).rows.map((r) => [r.model_id as string, r.state as string]));
    return { order: (row?.models as string[] | undefined) ?? this.defaultOrder(), custom: !!row, states, updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null, updatedBy: (row?.updated_by as string | undefined) ?? null };
  }

  /** The models to try for one chat answer, in order. */
  async candidates(c: Db | Tx, tenantId: string): Promise<CloudAdapter[]> {
    const { order, states } = await this.route(c, tenantId);
    const allowed = order.map((id) => this.get(id)).filter((a): a is CloudAdapter => !!a && states.get(a.id) !== 'disabled' && states.get(a.id) !== 'removed');
    const ready = allowed.filter((a) => !this.cooling(a.id));
    const resting = allowed.filter((a) => this.cooling(a.id)).sort((x, y) => this.cooling(x.id)!.until - this.cooling(y.id)!.until);
    return [...ready, ...resting];
  }

  async status(c: Db | Tx, tenantId: string): Promise<RouteStatus> {
    const { order, custom, states, updatedAt, updatedBy } = await this.route(c, tenantId);
    const ids = [...order, ...this.adapters.map((a) => a.id).filter((id) => !order.includes(id))]; // models not in the route are listed after it
    const entries = ids.map((id): RouteEntry => {
      const a = this.get(id);
      const st = states.get(id);
      const enabled = !!a && st !== 'disabled' && st !== 'removed';
      const h = a ? this.cooling(id) : null;
      const reason = !a ? 'not configured on this server' : st === 'removed' ? 'removed on Models' : st === 'disabled' ? 'disabled on Models' : h ? h.reason : null;
      return { id, label: a?.label ?? id, model: a?.model ?? '', configured: !!a, enabled, usable: enabled && !h, reason, until: h ? new Date(h.until).toISOString() : null };
    });
    const inRoute = entries.filter((e) => order.includes(e.id));
    const active = inRoute.find((e) => e.usable)?.id ?? inRoute.find((e) => e.enabled)?.id ?? null;
    return { models: order, custom, entries, active, updatedAt, updatedBy };
  }
}
