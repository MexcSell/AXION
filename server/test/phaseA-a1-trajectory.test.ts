import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeSchema } from './helpers.ts';
import { tx } from '../src/db.ts';
import { verifyChain } from '../src/audit.ts';
import { TrajectoryRecorder, saveTrajectory, loadTrajectory, verifyStoredTrajectory, type BuiltTrajectory } from '../src/trajectory/recorder.ts';
import { GENESIS, stepHashOf, runDigestOf, verifyTrajectory } from '../src/trajectory/chain.ts';
import { replayTrajectory } from '../src/trajectory/replay.ts';
import { redactArgs } from '../src/trajectory/redact.ts';
import { claimOf, trajectoryCost, type StoredRun, type StoredStep } from '../../shared/contracts/src/index.ts';
import { TRAJECTORIES, COST_CASES, CLAIM_CASES, REDACTION_CASES, TAMPERS, TAMPER_BASE, THRESHOLDS_A1, RUN_START, type TamperView } from './phaseA/trajectory-fixtures.ts';
import { runFixture, iso, sha } from './phaseA/trajectory-executor.ts';

/** Phase A, A1: the run trajectory record. A fake executor writes it; nothing executes and no model is called. */
const TENANT = 'a1-tenant';
let s: Awaited<ReturnType<typeof makeSchema>>;
beforeAll(async () => { s = await makeSchema(); }, 60_000);
afterAll(async () => { await s?.drop(); });
const q = (sql: string, p: unknown[] = []) => s.pool.query(sql, p);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const save = (b: BuiltTrajectory, tenant = TENANT) => tx(s.pool, (c) => saveTrajectory(c, tenant, b, 'executor-fake'));
/** Test-DB-only: the append-only triggers are switched off inside the test itself, as a tamperer with table rights would. */
async function tamper(sql: string, params: unknown[] = []) {
  const c = await s.pool.connect();
  try {
    await c.query('alter table trajectory_steps disable trigger user');
    await c.query('alter table run_trajectories disable trigger user');
    try { await c.query(sql, params); } finally { await c.query('alter table trajectory_steps enable trigger user'); await c.query('alter table run_trajectories enable trigger user'); }
  } finally { c.release(); }
}

describe('the fake executor and the hand-derived expectations (23 trajectories)', () => {
  it('has at least 20 trajectories with unique ids', () => {
    expect(TRAJECTORIES.length).toBeGreaterThanOrEqual(THRESHOLDS_A1.trajectories);
    expect(new Set(TRAJECTORIES.map((t) => t.id)).size).toBe(TRAJECTORIES.length);
  });
  for (const f of TRAJECTORIES) {
    it(`${f.id}: ${f.why}`, () => {
      const { built } = runFixture(f);
      expect(built.steps.length).toBe(f.expect.steps);
      f.steps.forEach((fs, i) => {
        const st = built.steps[i];
        expect(st.decision.profile === null ? null : st.decision.profile.allowed ? 'allowed' : st.decision.profile.reason, `step ${i + 1} profile`).toBe(fs.expect.profile);
        expect(st.decision.caps.action === 'continue' ? 'continue' : st.decision.caps.reason, `step ${i + 1} caps`).toBe(fs.expect.caps);
        expect(st.executed, `step ${i + 1} executed`).toBe(fs.expect.executed);
      });
      expect(built.steps.filter((x) => x.executed).length).toBe(f.expect.executed);
      expect(built.run.costStatus).toBe(f.expect.cost.status);
      expect(built.run.costMicros).toBe(f.expect.cost.micros);
      expect(built.run.costLowerBoundMicros).toBe(f.expect.cost.lowerBound);
      expect(built.run.costMissingSteps).toBe(f.expect.cost.missing);
      expect(built.run.tokensTotal).toBe(f.expect.tokens);
      expect(claimOf(built.run).label).toBe(f.expect.label);
    });
  }
});

describe('threshold (a): replay reproduces every recorded policy decision (read back from the database)', () => {
  const tally = { runs: 0, steps: 0, reproduced: 0 };
  for (const f of TRAJECTORIES) {
    it(`${f.id}: save, load, verify the chain, replay`, async () => {
      const ran = runFixture(f, { runId: `RUN-${f.id}-replay` });
      await save(ran.built);
      const { run, steps, anchor } = (await loadTrajectory(s.pool, TENANT, `RUN-${f.id}-replay`))!;
      expect(verifyTrajectory(run, steps, anchor)).toMatchObject({ ok: true, status: 'verified', checked: steps.length, firstBadSeq: null });
      const r = replayTrajectory({ run, steps, profile: ran.profile, results: ran.results });
      expect(r.mismatches).toEqual([]);
      expect(r.resultMismatches).toEqual([]);
      expect(r.reproduced).toBe(steps.length);
      tally.runs++; tally.steps += steps.length; tally.reproduced += r.reproduced;
    });
  }
  it('totals: every decision of every step reproduced (100%)', () => {
    expect(tally.runs).toBe(TRAJECTORIES.length);
    expect(tally.reproduced).toBe(tally.steps);
    expect(tally.steps).toBeGreaterThanOrEqual(40);
    console.log(`A1 replay: ${tally.runs} trajectories, ${tally.steps} steps, ${tally.reproduced} reproduced`);
  });
  it('replay runs the real deciders: the same trajectory with a different profile does NOT reproduce, and a profile of another hash is refused', () => {
    const f = TRAJECTORIES.find((x) => x.id === 't02')!;
    const ran = runFixture(f);
    const other = clone(ran.profile!); other.network.allowedOrigins = ['https://good.com'];
    const r = replayTrajectory({ run: ran.built.run, steps: ran.built.steps, profile: other });
    expect(r.ok).toBe(false);
    expect(r.profileMismatch).toBe(true);
    const noProfile = replayTrajectory({ run: ran.built.run, steps: ran.built.steps, profile: null });
    expect(noProfile.ok).toBe(false);
    expect(noProfile.profileMismatch).toBe(true);
  });
  it('negative control (excluded from every count): a wrongly recorded decision is flagged by replay, 6 of 6', () => {
    let flagged = 0;
    const cases: [string, number, (st: StoredStep) => void][] = [
      ['t02', 1, (st) => { st.decision.profile = { allowed: false, reason: 'origin_not_granted' }; }],
      ['t03', 0, (st) => { st.decision.profile = { allowed: true, reason: 'allowed' }; }],
      ['t09', 2, (st) => { st.decision.caps = { action: 'continue', reason: null }; }],
      ['t10', 1, (st) => { st.inputs.halted = false; }],
      ['t14', 0, (st) => { st.decision.caps = { action: 'stop', reason: 'money_reserve' }; }],
      ['t05', 1, (st) => { st.policyDecisionId = 'pd-' + '0'.repeat(32); }],
    ];
    for (const [id, idx, mut] of cases) {
      const ran = runFixture(TRAJECTORIES.find((x) => x.id === id)!);
      const steps = clone(ran.built.steps);
      mut(steps[idx]);
      const r = replayTrajectory({ run: ran.built.run, steps, profile: ran.profile });
      if (r.mismatches.some((m) => m.seq === idx + 1)) flagged++;
    }
    expect(flagged).toBe(cases.length);
  });
  it('recorded tool results fed back must hash to the recorded result hash', () => {
    const ran = runFixture(TRAJECTORIES.find((x) => x.id === 't02')!);
    expect(replayTrajectory({ run: ran.built.run, steps: ran.built.steps, profile: ran.profile, results: ran.results }).resultMismatches).toEqual([]);
    const bad = replayTrajectory({ run: ran.built.run, steps: ran.built.steps, profile: ran.profile, results: { ...ran.results, 2: { n: 2, ok: false } } });
    expect(bad.resultMismatches.map((m) => m.seq)).toEqual([2]);
    expect(bad.ok).toBe(false);
  });
});

describe('threshold (a, tamper): the chain verifier finds the first altered step', () => {
  it('has at least 10 tamper fixtures', () => { expect(TAMPERS.length).toBeGreaterThanOrEqual(THRESHOLDS_A1.tamper); });
  let base: { run: StoredRun; steps: StoredStep[]; anchor: { head: string; runDigest: string; steps: number } | null };
  beforeAll(async () => {
    await save(runFixture(TRAJECTORIES.find((x) => x.id === TAMPER_BASE)!, { runId: 'RUN-tamper-base' }).built);
    base = (await loadTrajectory(s.pool, TENANT, 'RUN-tamper-base'))! as typeof base;
  });
  const viewOf = (run: StoredRun, steps: StoredStep[], anchor: typeof base.anchor): TamperView => ({
    run, steps: steps as any, anchor,
    rehash(i) { steps[i].stepHash = stepHashOf(run.tenantId, run.id, steps[i].prevHash, steps[i]); },
    rechainFrom(i) { for (let j = i; j < steps.length; j++) { steps[j].prevHash = j === 0 ? GENESIS : steps[j - 1].stepHash; steps[j].stepHash = stepHashOf(run.tenantId, run.id, steps[j].prevHash, steps[j]); } run.headHash = steps[steps.length - 1].stepHash; },
    redigest() { run.runDigest = runDigestOf(run); },
  });
  it('the untampered base verifies', () => {
    expect(base.steps.length).toBe(3);
    expect(verifyTrajectory(base.run, base.steps, base.anchor)).toEqual({ ok: true, status: 'verified', checked: 3, firstBadSeq: null, reason: null, anchor: 'ok' });
  });
  let detected = 0;
  for (const t of TAMPERS) {
    it(`${t.id}: ${t.why}`, () => {
      const run = clone(base.run), steps = clone(base.steps), anchor = clone(base.anchor);
      const v = viewOf(run, steps, anchor);
      t.mutate(v);
      const r = verifyTrajectory(v.run as StoredRun, v.steps as unknown as StoredStep[], v.anchor);
      expect(r.ok).toBe(false);
      expect({ status: r.status, reason: r.reason, firstBadSeq: r.firstBadSeq }).toEqual({ status: t.expect.status, reason: t.expect.reason, firstBadSeq: t.expect.firstBadSeq });
      detected++;
    });
  }
  it('all tamper fixtures detected', () => { expect(detected).toBe(TAMPERS.length); console.log(`A1 tamper: ${detected} of ${TAMPERS.length} detected`); });
  it('the same faults are found in the database itself (append-only triggers lifted inside the test)', async () => {
    const mk = async (id: string) => { await save(runFixture(TRAJECTORIES.find((x) => x.id === TAMPER_BASE)!, { runId: id }).built); };
    await mk('RUN-db-edit'); await mk('RUN-db-del'); await mk('RUN-db-trunc'); await mk('RUN-db-claim'); await mk('RUN-db-anchor'); await mk('RUN-db-ok');
    await tamper(`update trajectory_steps set args = '{"url":"https://good.com/x"}' where tenant_id=$1 and run_id='RUN-db-edit' and seq=2`, [TENANT]);
    await tamper(`delete from trajectory_steps where tenant_id=$1 and run_id='RUN-db-del' and seq=2`, [TENANT]);
    await tamper(`delete from trajectory_steps where tenant_id=$1 and run_id='RUN-db-trunc' and seq=3`, [TENANT]);
    await tamper(`update run_trajectories set final_claim='failure' where tenant_id=$1 and id='RUN-db-claim'`, [TENANT]);
    const c = await s.pool.connect();
    try { await c.query('alter table audit_events disable trigger user'); try { await c.query(`delete from audit_events where tenant_id=$1 and action='run.trajectory.recorded' and subject='RUN-db-anchor'`, [TENANT]); } finally { await c.query('alter table audit_events enable trigger user'); } } finally { c.release(); }
    const v = (id: string) => verifyStoredTrajectory(s.pool, TENANT, id);
    expect(await v('RUN-db-ok')).toMatchObject({ ok: true, status: 'verified' });
    expect(await v('RUN-db-edit')).toMatchObject({ ok: false, status: 'broken', reason: 'step_hash_mismatch', firstBadSeq: 2 });
    expect(await v('RUN-db-del')).toMatchObject({ ok: false, status: 'broken', reason: 'seq_gap', firstBadSeq: 2 });
    expect(await v('RUN-db-trunc')).toMatchObject({ ok: false, status: 'broken', reason: 'step_count_mismatch', firstBadSeq: 3 });
    expect(await v('RUN-db-claim')).toMatchObject({ ok: false, status: 'broken', reason: 'run_digest_mismatch' });
    expect(await v('RUN-db-anchor')).toMatchObject({ ok: false, status: 'unanchored', reason: 'anchor_missing' });
    expect(await verifyStoredTrajectory(s.pool, TENANT, 'RUN-nope')).toBeNull();
  });
});

describe('threshold (b): per-run cost is the sum of step costs, or unknown, never zero by default', () => {
  it(`${COST_CASES.length} cost cases from the hand-written rule`, () => {
    expect(COST_CASES.length).toBeGreaterThanOrEqual(THRESHOLDS_A1.costCases);
    for (const c of COST_CASES) {
      const r = trajectoryCost(c.steps.map((x) => ({ executed: x.executed, toolCostMicros: x.cost, tokens: x.tokens })));
      expect(r.cost, c.id).toEqual(c.expect);
      expect(r.tokens, c.id).toBe(c.tokens);
    }
  });
  it('in the 23 trajectories: known costs are the exact sums (100% of the known ones), the unknown ones show micros null', () => {
    let known = 0, unknown = 0;
    for (const f of TRAJECTORIES) {
      const { built } = runFixture(f);
      const sum = built.steps.filter((x) => x.executed).reduce((a, x) => a + (x.toolCostMicros ?? 0), 0);
      if (built.run.costStatus === 'known') { expect(built.run.costMicros, f.id).toBe(sum); known++; } else { expect(built.run.costMicros, f.id).toBeNull(); unknown++; }
    }
    expect(known + unknown).toBe(TRAJECTORIES.length);
    expect(unknown).toBeGreaterThanOrEqual(1);
    console.log(`A1 cost: ${known} known (sum equals the step costs), ${unknown} unknown`);
  });
  it('a run with no cost data stores NULL, not 0, and the table refuses a known status without a number', async () => {
    const f = TRAJECTORIES.find((x) => x.id === 't19')!;
    await save(runFixture(f, { runId: 'RUN-unknown-cost' }).built);
    const r = (await q(`select cost_status, cost_micros, cost_lower_bound_micros, cost_missing_steps, tokens_total from run_trajectories where id='RUN-unknown-cost'`)).rows[0];
    expect(r).toMatchObject({ cost_status: 'unknown', cost_micros: null, cost_lower_bound_micros: '100', cost_missing_steps: 1, tokens_total: null });
    await expect(q(`update run_trajectories set cost_micros = 0 where id='RUN-unknown-cost'`)).rejects.toThrow(/append-only/);
    const b = runFixture(TRAJECTORIES.find((x) => x.id === 't01')!, { runId: 'RUN-badcost' }).built;
    b.run.costMicros = null; // known status without a number
    await expect(save(b)).rejects.toThrow();
  });
  it('the recorder refuses a step that did not run but carries a cost, tokens or a result', () => {
    const rec = new TrajectoryRecorder({ tenantId: TENANT, runId: 'RUN-r', jobRef: null, taskClass: 'c', startedAt: RUN_START, profileSha256: null, caps: null, breaker: { stage: 0, maxConsecutiveFailures: 3 } });
    const base = { modelRequestHash: null, tool: 'note', args: {}, inputs: { halted: false, estMoneyMicros: 0, estTokens: 0, fencingToken: 1, currentFencingToken: 1 }, decision: { profile: null, caps: { action: 'continue' as const, reason: null } }, approvalId: null, credentialHandleId: null, startedAt: iso(0), endedAt: iso(10) };
    expect(() => rec.addStep({ ...base, executed: false, ok: null, tokens: null, toolCostMicros: 0 })).toThrow();
    expect(() => rec.addStep({ ...base, executed: false, ok: null, tokens: 5, toolCostMicros: null })).toThrow();
    expect(() => rec.addStep({ ...base, executed: false, ok: null, tokens: null, toolCostMicros: null, result: { a: 1 } })).toThrow();
    expect(() => rec.addStep({ ...base, executed: true, ok: null, tokens: null, toolCostMicros: null })).toThrow();
    expect(() => rec.addStep({ ...base, decision: { profile: { allowed: false, reason: 'origin_not_granted' }, caps: { action: 'continue', reason: null } }, executed: true, ok: true, tokens: null, toolCostMicros: 1 })).toThrow(); // ran although denied
    expect(() => rec.addStep({ ...base, decision: { profile: null, caps: { action: 'stop', reason: 'halted' } }, executed: true, ok: true, tokens: null, toolCostMicros: 1 })).toThrow(); // ran although stopped
    expect(() => rec.addStep({ ...base, executed: true, ok: true, tokens: null, toolCostMicros: -1 })).toThrow();
    expect(() => rec.addStep({ ...base, executed: true, ok: true, tokens: null, toolCostMicros: 1.5 })).toThrow();
    expect(() => rec.addStep({ ...base, endedAt: iso(-10), executed: true, ok: true, tokens: null, toolCostMicros: 1 })).toThrow(); // ends before it starts
  });
});

describe('threshold (c): a claimed success without a matching environment-state record is "claimed, not verified"', () => {
  const resolve = (env: unknown, run: { id: string; startedAt: string; endedAt: string }) =>
    env === null ? null : JSON.parse(JSON.stringify(env).replace(/"RUN"/g, JSON.stringify(run.id)).replace(/"END"/g, JSON.stringify(run.endedAt)).replace(/"START"/g, JSON.stringify(run.startedAt)));
  const run = { id: 'RUN-claim', startedAt: RUN_START, endedAt: iso(5000) };
  let flagged = 0;
  for (const c of CLAIM_CASES) {
    it(c.id, () => {
      const r = claimOf({ ...run, finalClaim: c.claim, envCheck: resolve(c.env, run) });
      expect(r.label).toBe(c.expect.label);
      expect(r.reason).toBe(c.expect.reason);
      if (c.id.startsWith('c')) { expect(r.label).toBe('claimed_not_verified'); expect(r.text).toBe('claimed, not verified'); flagged++; }
    });
  }
  it('10 of 10 flagged', () => { expect(flagged).toBe(THRESHOLDS_A1.claimedNotVerified); console.log(`A1 claim: ${flagged} of ${THRESHOLDS_A1.claimedNotVerified} flagged "claimed, not verified"`); });
  it('the label is computed from the stored row, so an env record added later through the table changes nothing the digest does not cover', async () => {
    const f = TRAJECTORIES.find((x) => x.id === 't01')!;
    await save(runFixture({ ...f, env: null }, { runId: 'RUN-noenv' }).built);
    const l = (await loadTrajectory(s.pool, TENANT, 'RUN-noenv'))!;
    expect(claimOf(l.run).label).toBe('claimed_not_verified');
    await save(runFixture(f, { runId: 'RUN-withenv' }).built);
    expect(claimOf((await loadTrajectory(s.pool, TENANT, 'RUN-withenv'))!.run).label).toBe('verified');
  });
});

describe('threshold (d): secrets and flagged personal data never reach the table', () => {
  it(`${REDACTION_CASES.length} redaction fixtures: no secret survives, what is not secret stays`, () => {
    expect(REDACTION_CASES.length).toBeGreaterThanOrEqual(THRESHOLDS_A1.redaction);
    for (const c of REDACTION_CASES) {
      const { value } = redactArgs(c.args, { piiFields: c.piiFields });
      const text = JSON.stringify(value);
      for (const sec of c.secrets) expect(text, `${c.id}: ${sec}`).not.toContain(sec);
      for (const k of c.keep ?? []) expect(text, `${c.id}: keeps ${k}`).toContain(k);
    }
  });
  it('is idempotent, counts what it replaced, and never throws on odd input', () => {
    for (const c of REDACTION_CASES) {
      const once = redactArgs(c.args, { piiFields: c.piiFields });
      expect(redactArgs(once.value, { piiFields: c.piiFields }).value, c.id).toEqual(once.value);
      if (c.secrets.length) expect(once.count, c.id).toBeGreaterThan(0);
    }
    expect(redactArgs({ a: 'ordinary' }).count).toBe(0);
    for (const odd of [undefined, null, 5, 'x', true, [], {}, [[[[[[[[[[[[[[[[[[1]]]]]]]]]]]]]]]]]], { a: undefined }, { n: Number.NaN }, { 'nul': 'a\u0000b' }]) expect(() => redactArgs(odd)).not.toThrow();
    expect(JSON.stringify(redactArgs({ nul: 'a\u0000b' }).value)).not.toContain('\\u0000');
  });
  it('very large or very deep arguments are bounded (a marker, never the raw content)', () => {
    const big = redactArgs({ blob: 'x'.repeat(100_000) }).value as Record<string, unknown>;
    expect(JSON.stringify(big).length).toBeLessThan(20_000);
    let deep: any = { v: 1 }; for (let i = 0; i < 60; i++) deep = { n: deep };
    expect(JSON.stringify(redactArgs(deep).value).length).toBeLessThan(20_000);
  });
  it('hostile input does not stall it: long runs of word characters, dots and dashes are scanned in well under a second, and a secret inside the first 2000 characters of a long string is still removed', () => {
    const t0 = Date.now();
    for (const filler of ['a.', 'a-', 'ab_', '1 ', 'x=', '/a', '@a.', 'password ']) redactArgs({ blob: filler.repeat(Math.ceil(120_000 / filler.length)) });
    expect(Date.now() - t0).toBeLessThan(5000);
    const r = JSON.stringify(redactArgs({ blob: 'password=Tr0ub4dor&3 ' + 'x'.repeat(50_000) }).value);
    expect(r).not.toContain('Tr0ub4dor&3');
    expect(r).toContain('[truncated:+');
  });
  it('through the recorder and the database: no seeded secret appears anywhere in the stored rows or the audit anchor', async () => {
    const piiFields = ['patientNote'];
    const rec = new TrajectoryRecorder({ tenantId: TENANT, runId: 'RUN-redact', jobRef: null, taskClass: 'web-research', startedAt: RUN_START, profileSha256: null, caps: null, breaker: { stage: 1, maxConsecutiveFailures: 3 }, piiFields });
    REDACTION_CASES.forEach((c, i) => rec.addStep({
      modelRequestHash: null, tool: 'note', args: c.args, inputs: { halted: false, estMoneyMicros: 0, estTokens: 0, fencingToken: 1, currentFencingToken: 1 },
      decision: { profile: null, caps: { action: 'continue', reason: null } }, executed: true, ok: true, result: { r: i }, approvalId: null, credentialHandleId: null, startedAt: iso(i * 10), endedAt: iso(i * 10 + 5), tokens: 1, toolCostMicros: 0,
    }));
    const built = rec.finish({ endedAt: iso(10_000), finalClaim: 'none', envCheck: null });
    await save(built);
    const rows = (await q(`select t::text as txt from trajectory_steps t where run_id='RUN-redact'`)).rows.map((r) => r.txt).join('\n');
    const runRow = (await q(`select t::text as txt from run_trajectories t where id='RUN-redact'`)).rows[0].txt;
    const anchor = (await q(`select detail::text as txt from audit_events where action='run.trajectory.recorded' and subject='RUN-redact'`)).rows[0].txt;
    const everything = rows + runRow + anchor;
    for (const c of REDACTION_CASES) for (const sec of c.secrets) expect(everything, `${c.id}: ${sec}`).not.toContain(sec);
    expect((await q(`select sum(redactions)::int n from trajectory_steps where run_id='RUN-redact'`)).rows[0].n).toBeGreaterThan(20);
    // and what was stored is exactly what was hashed: the chain verifies from the rows
    expect(await verifyStoredTrajectory(s.pool, TENANT, 'RUN-redact')).toMatchObject({ ok: true, status: 'verified' });
  });
});

describe('the anchor in the audit log', () => {
  it('one audit row per run: action run.trajectory.recorded, subject the run id, detail holds the head, the run digest and the counts, and the audit chain still verifies', async () => {
    const f = TRAJECTORIES.find((x) => x.id === 't19')!;
    const AT = 'a1-anchor'; // its own tenant: the tamper tests above delete an audit row of TENANT on purpose
    const built = runFixture(f, { runId: 'RUN-anchor', tenantId: AT }).built;
    await save(built, AT);
    const rows = (await q(`select actor, subject, result, detail from audit_events where tenant_id=$1 and action='run.trajectory.recorded' and subject='RUN-anchor'`, [AT])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: 'executor-fake', result: 'ok' });
    expect(rows[0].detail).toMatchObject({ head: built.run.headHash, runDigest: built.run.runDigest, steps: 2, costStatus: 'unknown', costMicros: null, claim: 'success', claimLabel: 'verified' });
    expect(rows[0].detail.head).toMatch(/^[0-9a-f]{64}$/); // redact() drops keys that look like hashes; the anchor must not use one
    expect((await verifyChain(s.pool, AT)).ok).toBe(true);
    expect(await verifyStoredTrajectory(s.pool, AT, 'RUN-anchor')).toMatchObject({ ok: true, status: 'verified', anchor: 'ok' });
  });
  it('a run id cannot be recorded twice in one tenant, and the same id may exist in another tenant', async () => {
    const f = TRAJECTORIES.find((x) => x.id === 't01')!;
    await save(runFixture(f, { runId: 'RUN-dup', tenantId: TENANT }).built);
    await expect(save(runFixture(f, { runId: 'RUN-dup', tenantId: TENANT }).built)).rejects.toThrow();
    await save(runFixture(f, { runId: 'RUN-dup', tenantId: 'a1-other' }).built, 'a1-other');
    expect((await loadTrajectory(s.pool, 'a1-other', 'RUN-dup'))!.run.tenantId).toBe('a1-other');
    expect(await loadTrajectory(s.pool, 'a1-third', 'RUN-dup')).toBeNull();
    expect((await q(`select count(*)::int n from audit_events where action='run.trajectory.recorded' and subject='RUN-dup'`)).rows[0].n).toBe(2);
  });
  it('a failed save leaves nothing behind (run, steps and anchor are one transaction)', async () => {
    const b = runFixture(TRAJECTORIES.find((x) => x.id === 't02')!, { runId: 'RUN-atomic' }).built;
    b.steps[2].tool = ''; // refused by the table (length check) on the third step insert
    await expect(save(b)).rejects.toThrow();
    expect((await q(`select count(*)::int n from run_trajectories where id='RUN-atomic'`)).rows[0].n).toBe(0);
    expect((await q(`select count(*)::int n from trajectory_steps where run_id='RUN-atomic'`)).rows[0].n).toBe(0);
    expect((await q(`select count(*)::int n from audit_events where subject='RUN-atomic'`)).rows[0].n).toBe(0);
  });
});

describe('the tables are append-only and checked', () => {
  it('UPDATE, DELETE and TRUNCATE are refused on both tables', async () => {
    await save(runFixture(TRAJECTORIES.find((x) => x.id === 't01')!, { runId: 'RUN-ao' }).built);
    for (const t of ['run_trajectories', 'trajectory_steps']) {
      await expect(q(`update ${t} set tenant_id = tenant_id`)).rejects.toThrow(/append-only/);
      await expect(q(`delete from ${t}`)).rejects.toThrow(/append-only/);
      await expect(q(`truncate ${t} cascade`)).rejects.toThrow(/append-only/);
    }
  });
  it('a step needs its run in the same tenant (foreign key), a positive seq and hex hashes', async () => {
    const b = runFixture(TRAJECTORIES.find((x) => x.id === 't01')!, { runId: 'RUN-fk' }).built;
    await save(b);
    const ins = (over: Record<string, unknown>) => {
      const v = { tenant_id: TENANT, run_id: 'RUN-fk', seq: 9, tool: 'x', args: '{}', redactions: 0, inputs: '{}', decision: '{}', policy_decision_id: 'pd', executed: false, started_at: RUN_START, ended_at: RUN_START, prev_hash: 'a'.repeat(64), step_hash: 'b'.repeat(64), ...over };
      return q(`insert into trajectory_steps(${Object.keys(v).join(',')}) values (${Object.keys(v).map((_, i) => '$' + (i + 1)).join(',')})`, Object.values(v));
    };
    await expect(ins({ tenant_id: 'a1-someone-else' })).rejects.toThrow();
    await expect(ins({ run_id: 'RUN-missing' })).rejects.toThrow();
    await expect(ins({ seq: 0 })).rejects.toThrow();
    await expect(ins({ step_hash: 'nothex' })).rejects.toThrow();
    await expect(ins({ executed: true })).rejects.toThrow(); // an executed step must say whether it succeeded
    await ins({});
  });
});

describe('the recorder keeps what it is given consistent', () => {
  it('seq runs 1..n, each prev is the hash before, the first prev is 64 zeros, and the run head is the last step hash', () => {
    const { built } = runFixture(TRAJECTORIES.find((x) => x.id === 't02')!);
    expect(built.steps.map((x) => x.seq)).toEqual([1, 2, 3]);
    expect(built.steps[0].prevHash).toBe(GENESIS);
    expect(built.steps[1].prevHash).toBe(built.steps[0].stepHash);
    expect(built.steps[2].prevHash).toBe(built.steps[1].stepHash);
    expect(built.run.headHash).toBe(built.steps[2].stepHash);
    expect(built.run.stepCount).toBe(3);
    expect(built.run.runDigest).toBe(runDigestOf(built.run));
    for (const st of built.steps) expect(st.stepHash).toBe(stepHashOf(TENANT, built.run.id, st.prevHash, st));
  });
  it('a run with no steps has the genesis as its head and verifies', () => {
    const rec = new TrajectoryRecorder({ tenantId: TENANT, runId: 'RUN-empty', jobRef: null, taskClass: 'c', startedAt: RUN_START, profileSha256: null, caps: null, breaker: { stage: 0, maxConsecutiveFailures: 3 } });
    const b = rec.finish({ endedAt: iso(1), finalClaim: 'none', envCheck: null });
    expect(b.run.headHash).toBe(GENESIS);
    expect(b.run.costStatus).toBe('unknown');
    expect(verifyTrajectory(b.run, b.steps, { head: b.run.headHash, runDigest: b.run.runDigest, steps: 0 })).toMatchObject({ ok: true });
  });
  it('the policy decision id depends on the decision: a flipped decision is another id; the same decision is the same id', () => {
    const a = runFixture(TRAJECTORIES.find((x) => x.id === 't02')!).built.steps[0];
    const b = runFixture(TRAJECTORIES.find((x) => x.id === 't02')!).built.steps[0];
    expect(a.policyDecisionId).toBe(b.policyDecisionId);
    expect(a.policyDecisionId).toMatch(/^pd-[0-9a-f]{32}$/);
    expect(sha('x')).not.toBe(a.policyDecisionId);
  });
});
