# Cycle 19 (lane w17, theme C4): mentoring plans, recorded and honest

## Hypothesis
The spec (§4.11 Mentoring, §16 "Mentors and independent QA") and the agent roster (Mentor-01) promise mentoring, but in
api mode there is nothing behind it. The Development tab's "Learning" lane is DEMO.

After this cycle an administrator can record a **mentoring plan** for an agent:
- the mentor (an agent, never the mentee itself);
- the target skill;
- 1–5 milestones (text);
- a re-evaluation date.

Milestones are ticked off by a person, with who and when recorded. The plan shows on the Agent Profile and in Agents ›
Development (api mode) beside cycle 5's version proposals. No numbers are invented: a plan reports milestones done and
dates, never a "skill gain %". Re-evaluation says "needs evaluation data — agents don't execute yet". Plans are
append-only in spirit: a closed or cancelled plan stays in history.

## Measure and pass threshold (fixed now)
1. **Server:**
   - migration **0023** `mentoring_plans` (+ `mentoring_milestones`);
   - routes `GET /agents/:id/mentoring`, `GET /mentoring`;
   - `POST /agents/:id/mentoring` (admin, Idempotency-Key; the mentor must be an active agent ≠ the mentee; the target
     skill is non-empty);
   - `POST /mentoring/:pid/milestones/:mid/done` (admin);
   - `POST /mentoring/:pid/close {outcome:'completed'|'cancelled', note}` (admin).
   - Audit on every write; events `mentoring.*` (audience all, subjectKind 'agent'); add them to EventType.
   - Tests:
     - a member gets 403;
     - the mentor = the mentee gives 422;
     - closing twice gives 409;
     - another tenant gets 404;
     - migration up/down/up.
2. **Web (api mode):**
   - the Agent Profile "Mentoring" section: active plan, milestones, history; a "Start a plan" dialog for admins;
   - the Development tab shows active plans;
   - `?` help on every control;
   - demo mode unchanged.
   - A browser check `web/scripts/api-c19.mjs` covers: create, tick, close, live in a 2nd browser, and member read-only.
3. The whole suite and verify-all stay green.

## Lane
You are lane w17:
- worktree `/home/luca/AXION-w17`, **branched from `c05-version-proposals`** (cycle 5, reviewed, not yet merged; build on
  its Development tab);
- port base 6700: dev 6790, e2e 6792/6793;
- database `axion_e2e17`;
- override config `/home/luca/AXION-lanes/vite-w17.config.ts`.

Follow `/home/luca/AXION/web/docs/improve/LANES.md` exactly: never git stash, and route every heavy run through
`heavy.sh`. Safety rules: `/home/luca/AXION/web/docs/improve/PROCESS.md`.
