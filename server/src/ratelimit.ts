import type { FastifyInstance } from 'fastify';
import { ApiError } from './errors.ts';
import { requireUser } from './auth/session.ts';

/**
 * Per-session write rate limits (cycle 14). Generous for a person using the app, tight enough to stop a runaway script
 * or a stuck client from flooding messages, governance writes (proposals, rollbacks, mentoring plans) or uploads. Counted per signed-in session (the session's token
 * hash), in a sliding window; every attempt counts, also a refused one. Reads are never limited.
 * Sign-in has its own limiter (FailLimiter in auth/service.ts).
 */
export type WriteBucket = 'messages' | 'proposals' | 'uploads' | 'ledgers' | 'cloud';
export interface WriteLimit { max: number; windowMs: number }
export const DEFAULT_WRITE_LIMITS: Record<WriteBucket, WriteLimit> = {
  messages: { max: 60, windowMs: 60_000 },
  proposals: { max: 30, windowMs: 60_000 },
  uploads: { max: 30, windowMs: 60_000 },
  ledgers: { max: 30, windowMs: 60_000 }, // c39: its own budget, so a ledger retry loop never uses up proposal creation
  cloud: { max: 10, windowMs: 60_000 }, // owner 2026-11-24: prompts to the live cloud model (each one spends the owner's subscription)
};

/** Which write routes are limited, and in which (shared) bucket. Keys: `METHOD route-pattern` as registered. */
export const LIMITED_ROUTES: Record<string, WriteBucket> = {
  'POST /api/v1/threads/:id/messages': 'messages',
  'POST /api/v1/channels/:key/messages': 'messages',
  'POST /api/v1/channels/admin/:userId/messages': 'messages',
  'POST /api/v1/organization/proposals': 'proposals',
  'POST /api/v1/organization/proposals/:id/decision': 'proposals',
  'POST /api/v1/organization/proposals/:id/withdraw': 'proposals',
  'PUT /api/v1/organization/proposals/:id/plan': 'proposals', // c85
  'POST /api/v1/organization/proposals/:id/plan/amendments': 'proposals', // c85
  // merge follow-up (c14 review I1): every governance write shares the proposals budget. The route-table test in
  // security.test.ts fails when a new message, upload, proposal, rollback or mentoring write route is missing here.
  'POST /api/v1/organization/revisions/:seq/rollback-proposal': 'proposals', // c04
  'POST /api/v1/agents/:id/version-proposals': 'proposals', // c05
  'POST /api/v1/version-proposals/:pid/decision': 'proposals',
  'POST /api/v1/version-proposals/:pid/withdraw': 'proposals',
  'POST /api/v1/agents/:id/rollback': 'proposals',
  'POST /api/v1/agents/:id/mentoring': 'proposals', // c19
  'POST /api/v1/mentoring/:pid/milestones/:mid/done': 'proposals',
  'POST /api/v1/mentoring/:pid/close': 'proposals',
  'POST /api/v1/site-grants': 'proposals', // c36
  'POST /api/v1/site-grants/:id/revoke': 'proposals',
  'POST /api/v1/failure-tags': 'proposals', // c33
  'POST /api/v1/failure-tags/:id/decision': 'proposals',
  'POST /api/v1/failure-tags/:id/attributions': 'proposals', // c60
  'POST /api/v1/missions/:id/ledgers/:kind': 'ledgers', // c39
  'POST /api/v1/tasks/:id/reviews': 'proposals', // c38: a review is a governance write
  'POST /api/v1/missions/:id/delegation-briefs': 'proposals', // c42
  'POST /api/v1/missions/:id/staffing/retry': 'proposals', // c42 fix round 2
  'POST /api/v1/agents/:id/lessons': 'proposals', // c41: playbooks and skills
  'POST /api/v1/lessons/:lid/decision': 'proposals',
  'POST /api/v1/agents/:id/playbook/rollback': 'proposals',
  'POST /api/v1/skills': 'proposals',
  'POST /api/v1/skills/:sid/approve': 'proposals',
  'POST /api/v1/skills/:sid/retire': 'proposals',
  'POST /api/v1/skills/:sid/retirement-dismiss': 'proposals', // c59
  'POST /api/v1/uploads': 'uploads',
  'POST /api/v1/cloud-models/:id/manage': 'cloud',
  'POST /api/v1/cloud-models/:id/complete': 'cloud',
};

export class SlidingWindow {
  private hits = new Map<string, number[]>();
  constructor(private limit: WriteLimit) {}
  /** Counts the attempt and returns 0, or returns the ms until the next attempt is allowed (nothing counted). */
  take(key: string, now = Date.now()): number {
    const from = now - this.limit.windowMs;
    const r = (this.hits.get(key) ?? []).filter((t) => t > from);
    if (r.length >= this.limit.max) { this.hits.set(key, r); return Math.max(1, r[0] - from); }
    r.push(now);
    this.hits.set(key, r);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.some((t) => t > from)) this.hits.delete(k);
    return 0;
  }
}

/** preHandler: resolve the session (also checks X-CSRF) for a limited route, then count the attempt. */
export function installWriteLimits(app: FastifyInstance, over: Partial<Record<WriteBucket, WriteLimit>> = {}) {
  const windows = Object.fromEntries((Object.keys(DEFAULT_WRITE_LIMITS) as WriteBucket[]).map((b) => [b, new SlidingWindow(over[b] ?? DEFAULT_WRITE_LIMITS[b])])) as Record<WriteBucket, SlidingWindow>;
  app.addHook('preHandler', async (req, reply) => {
    const bucket = LIMITED_ROUTES[`${req.method} ${req.routeOptions.url}`];
    if (!bucket) return;
    const ctx = await requireUser(req);
    const wait = windows[bucket].take(ctx.tokenHash);
    if (wait) {
      reply.header('retry-after', String(Math.ceil(wait / 1000)));
      throw new ApiError('RATE_LIMITED', 429, `Too many ${bucket} from this session. Wait ${Math.ceil(wait / 1000)} s and try again.`, { retryable: true });
    }
  });
}
