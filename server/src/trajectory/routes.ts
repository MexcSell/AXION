import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import { notFound } from '../errors.ts';
import { claimOf, TRAJECTORY_LIST_MAX, type RunCost, type StoredRun, type TrajectoryDetailDto, type TrajectoryListDto, type TrajectoryRunDto, type TrajectoryStepDto } from '../../../shared/contracts/src/index.ts';
import { RUN_COLUMNS, loadTrajectory, runOf } from './recorder.ts';
import { verifyTrajectory } from './chain.ts';

/**
 * Phase A (A1): read-only trajectory routes for administrators. GET /runs/trajectories lists this tenant's runs (newest first); GET /runs/trajectories/:id gives the steps
 * (arguments as stored, that is, redacted), the cost, the claim label and the chain status, checked against the audit anchor on every read. There is no write route: a run is
 * written once, by the server's own recorder, when a (future) executor finishes it. Nothing here starts a run.
 */
const ListQuery = z.object({ limit: z.coerce.number().int().min(1).max(TRAJECTORY_LIST_MAX).optional() }).strict();

const costText = (c: RunCost) => (c.status === 'known' ? `${c.micros} micro-units` : 'unknown');
function runDto(run: StoredRun, recordedAt: string, executedSteps: number): TrajectoryRunDto {
  const cost: RunCost = { status: run.costStatus, micros: run.costMicros, lowerBound: run.costLowerBoundMicros, missing: run.costMissingSteps };
  return {
    id: run.id, jobRef: run.jobRef, taskClass: run.taskClass, startedAt: run.startedAt, endedAt: run.endedAt, finalClaim: run.finalClaim, claim: claimOf(run), steps: run.stepCount, executedSteps, tokens: run.tokensTotal,
    cost: { status: cost.status, micros: cost.micros, knownSumMicros: cost.lowerBound, missingSteps: cost.missing, text: costText(cost) },
    profileSha256: run.profileSha256, caps: run.caps, headHash: run.headHash, recordedAt,
  };
}

export default async function trajectoryRoutes(app: FastifyInstance) {
  app.get('/runs/trajectories', async (req): Promise<TrajectoryListDto> => {
    const ctx = await requireAdmin(req);
    const q = parse(ListQuery, req.query);
    const rows = (await app.db.query(
      `select ${RUN_COLUMNS}, (select count(*)::int from trajectory_steps s where s.tenant_id = r.tenant_id and s.run_id = r.id and s.executed) as executed_steps
         from run_trajectories r where r.tenant_id = $1 order by r.recorded_at desc, r.id desc limit $2`, [ctx.tenantId, q.limit ?? 50])).rows;
    return { runs: rows.map((r) => runDto(runOf(r), r.recorded_at, r.executed_steps)) };
  });

  app.get('/runs/trajectories/:id', async (req): Promise<TrajectoryDetailDto> => {
    const ctx = await requireAdmin(req);
    const t = await loadTrajectory(app.db, ctx.tenantId, (req.params as { id: string }).id);
    if (!t) throw notFound('No such run.');
    const steps: TrajectoryStepDto[] = t.steps.map((s) => ({
      seq: s.seq, modelRequestHash: s.modelRequestHash, tool: s.tool, args: s.args, redactions: s.redactions, decision: s.decision, policyDecisionId: s.policyDecisionId, executed: s.executed, ok: s.ok, resultHash: s.resultHash,
      approvalId: s.approvalId, credentialHandleId: s.credentialHandleId, startedAt: s.startedAt, endedAt: s.endedAt, tokens: s.tokens, toolCostMicros: s.toolCostMicros, stepHash: s.stepHash,
    }));
    return { run: runDto(t.run, t.recordedAt, t.steps.filter((s) => s.executed).length), envCheck: t.run.envCheck, steps, chain: verifyTrajectory(t.run, t.steps, t.anchor) };
  });
}
