# Cycle 19 review (independent): mentoring plans

Branch c19-mentoring-plans (worktree /home/luca/AXION-w17), diff vs c05-version-proposals. Read-only review: code and tests read, nothing run.

## Verdicts
- Spec: PASS with one honesty finding (I1).
- Quality: PASS with one Important finding (I2) and minors.

## Spec checklist (file:line in diff paths)
- Migration 0023 `server/migrations/0023_mentoring_plans.up.sql`: both tables, `check (mentor_id <> mentee_id)`, seq 1-5, done_by/done_at paired, unique partial index one active plan per agent, append-only triggers (delete, truncate, closed plan frozen, milestone ticked once and only while active). Down drops both tables and functions. up/down/up asserted in `server/test/mentoring.test.ts` (migration 0023 describe), agents preserved. PASS.
- Routes in `server/src/agents/mentoring.ts`: GET /mentoring, GET /agents/:id/mentoring (requireUser, tenant-scoped, 404 for foreign agent); POST create (requireAdmin, `idempotent`, mentor same tenant, active, != mentee, skill min 1, 1-5 milestones, date validated and not past, `.strict()` refuses extra fields); tick and close (requireAdmin, `for update`, tenant in WHERE). PASS.
- Who and when: tick stores `done_by=ctx.user.id, done_at=now()`, DTO returns name and time. PASS.
- Close twice: 409 PLAN_CLOSED, tested. Tick on closed plan 409. History kept: no delete path, DB triggers refuse it. PASS.
- Audit: mentoring.plan / milestone / close on every write; refusals on existing plans audited as `denied` and committed (stricter than required). Events mentoring.planned|milestoneDone|closed, audience all, subjectKind agent, added to EventType; test asserts audience and kind. PASS.
- Honesty: DTO `evaluation: null`, no gain/score field in schema, contract, UI or help; card shows "N of M milestones done" plus "Needs evaluation data: agents don't execute yet"; e2e asserts no `%`/`gain` text on the card. The thin progress bar is a visual only (aria-hidden), not a number. PASS for the new surface.
- Demo mode unchanged: `MentoringTab` returns the server view only under `isApi()`; Development switch already api-gated. PASS.
- Tests assert real behaviour (DB rows, audit and event rows, trigger refusals, tenant 404s, 403 for members on create/tick/close, 422 self-mentor, 409 twice). Not weakened. RED claim is self-declared (code before test, then route unregistered): process note only.

## Findings

### Important
- I1 (honesty, pre-existing from c05 but on this theme's page): in api mode `web/src/pages/Agents.tsx:93-94` the Learning ("mentor exercises running") and Evolving ("candidates in the pipeline") KPI tiles show `COUNTS.learning` / `COUNTS.evolving` fixture numbers with no DEMO tag (`successFoot` at line 89 shows the pattern for the Success tile). With real mentoring plans now beside them the tiles contradict the panel (Learning 9 vs zero plans). Fix: in api mode derive Learning from active mentoring plans and Evolving from pending version proposals (both already fetched), or tag DemoTag. Also `devCount` (line 85) counts only pending proposals, not active plans; and the api toolbar text (line 114) does not mention mentoring.
- I2 (repo hygiene): commit 76bf6cb adds `server/node_modules` as a tracked symlink to the absolute path `/home/luca/AXION/server/node_modules` (the diff lists it as a new file; .gitignore `node_modules/` does not match a symlink). Merging this to main would track a symlink where the real directory lives and can break checkout or installs. Remove it from the commit (git rm --cached) before merge. (The same file was added earlier by c05 commit 7f5829a; the c05 branch has it too.)

### Minor
- M1 Tick and close have no Idempotency-Key (brief requires it only on create); a double click yields a 409 shown as a toast, acceptable.
- M2 Retired-mentor test mutates `ops-01` status without try/finally; a failing assertion between could leave later tests affected. Low risk.
- M3 `mentoring_milestones` guard only protects UPDATE/DELETE; a raw INSERT of a milestone into a closed plan is not blocked at the DB (API never does it).
- M4 Agent Profile header `growth` chips and the demo Mentor button remain demo numbers in api mode (declared by the implementer; same class as I1).
- M5 Migration number gap 0016-0022: fine given version-based runner; ensure other lanes merge in a consistent order.
- M6 `mentoringFor(a)` is still computed in api mode before the early return (wasted work only).
