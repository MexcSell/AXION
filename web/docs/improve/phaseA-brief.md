# Phase A brief: no execution, no model (owner go 2026-11-25)

The owner approved the roadmap's Phase A ("Everything you suggested is good. Execute it as is", 2026-11-25). Source of truth for the
phase: `FINAL-REPORT-PHASE2.md` §12 (table row A) and `phase2/research-r6.md` (R6-1, R6-3, R6-5, Stage 0). Earlier slices this builds
on: `cycles/c94-report.md` (execution profile and egress validator), `cycles/c95-report.md` (run caps and halt checker),
`cycles/c96-report.md`, `cycles/c97-report.md`.

## Hard rules
- Nothing executes and no model is called. No process, browser, network or model runner is started by any new code
  (`server/test/approvals.test.ts` "execution guard" must stay green without widening it).
- New tables are append-only (same trigger pattern as `0057_stage9_records.up.sql`) and tenant-scoped. Migrations start at **0063**.
- Every number is honest: unknown cost is "unknown", never 0; a claimed success without an environment-state record is "claimed, not verified".
- Each threshold is checked by fixtures written before the implementation (commit the fixtures first, as c95 did).
- Existing behaviour does not change: approval digest v1/v2 rows keep verifying exactly as now.

## A1. Run trajectory record (R6-3 first slice)
- Migration: `run_trajectories` (one per run: tenant, id, lease/job ref nullable, task class, started/ended, final claim, environment-state
  check, totals, head hash) and `trajectory_steps` (ordered steps: seq, model request hash, tool name, redacted arguments, result hash,
  policy decision id, approval id, credential handle id, timestamps, tokens, tool cost nullable, prev hash, step hash).
- Hash chain: step hash = sha256 over the canonical JSON of the step plus the previous step's hash; the run's head hash is anchored into
  the audit log (one `audit_events` row, action `run.trajectory.recorded`, subject the run id, detail the head hash and counts).
- Recorder driven by a scripted fake executor (pattern: `server/test/c95/fake-executor.ts`); a replay verifier that feeds recorded tool
  results back and reproduces every recorded policy decision; a chain verifier that finds the first altered step.
- Redaction before storing arguments: secrets (token/key/password shapes, the existing audit redaction in `server/src/audit.ts` or its
  helpers) and flagged personal data never reach the table.
- Thresholds (fixtures): 20 hand-written trajectories replay with 100% of policy decisions reproduced; 10 tamper fixtures all detected;
  per-run cost = sum of step costs in 100%, a run with no cost data shows "unknown"; 10 "claimed success, no environment record" fixtures
  all flagged "claimed, not verified"; redaction fixtures show no secret in stored arguments.
- Read-only route for administrators: `GET /runs/trajectories` (list) and `GET /runs/trajectories/:id` (steps, chain status, cost). Register
  them in the contract registry and the tenant tests like every route. A small viewer under System Operations is welcome but optional.

## A2. Halt-record table (c95's deferred item)
- Migration: `run_halts` (tenant, scope `global` | `class` | `run`, target, reason, created by, created at; a lift is a new row, never an
  update). The latest row per scope/target decides.
- `server/src/jobs/run-caps.ts` (c95) takes halt as an input today: add the durable source (a function that reads the effective halt for a
  run, global first) and make the fake executor's store read it at commit time, so "zero accepted steps after a halt" holds against the
  table, including the concurrent interleavings c95 used.
- Administrator routes: `POST /operations/halts` (set or lift, reason required, audited) and `GET /operations/halts`.

## A3. Bind the execution profile hash and caps into the approval digest (digest v3), OFF until the owner approves O1b
- `server/src/approvals/service.ts` has digest v1 and v2 (`rowDigest`, `digestV2`). Add v3 = v2's bound action plus the execution profile
  hash (c94) and the run caps (c95), canonicalised. A cap or profile change after approval must make the stored digest stale (R6-5 d).
- New approval rows keep using the current version unless a server setting (env `APPROVAL_DIGEST_VERSION=3`, default unset) turns v3 on.
  Old rows verify with their own version. Tests cover v1, v2, v3 rows side by side and the stale-on-cap-change case.

## O1 material for the owner
- One execution profile file for a read-only browsing task class over origins the owner has already granted (site grants), in the c94
  format, plus a one-page plain-language summary next to it (`web/docs/improve/phaseA-O1-profile.md`): what it allows, what it refuses,
  the caps. The owner reads it and decides O1; nothing uses it before that.

## Exit check (from the roadmap)
All fixtures pass; the full server suite is green; the web typechecks; a report `web/docs/improve/phaseA-report.md` lists every threshold
with its result and evidence (counts), what was deferred and why, and the two owner decisions now open (O1, O1b).
