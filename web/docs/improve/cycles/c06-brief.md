# Cycle 6 (theme B, company performance): department facts from recorded data

## Hypothesis
Agents › Departments shows, for every department, a capacity ring, skill-coverage bars and three KPI numbers with
deltas. In api mode all of these are DEMO fixtures under a DEMO tag: nothing behind them is measured. Departments are
where the owner looks to judge how the company's parts are doing.

After this cycle each department card in api mode shows **facts the server really records**:
- its members, derived from the live catalog's departments;
- its head, from the active org revision: the member reporting to the GM;
- how many of its agents are staffed on active missions right now, and on how many missions;
- open tasks owned by its agents, split by state (running, waiting, failed);
- task outcomes in the window (passed, failed, retried), each with n;
- a "Last org change" stamp (the revision that last changed a line inside this department).

There are no ratios below a minimum sample, and every number has n and a window. The DEMO capacity, coverage and KPI
deltas are hidden in api mode, or kept under a clearly separate DEMO block. Pattern: subnet-scout `analytics.py`, rows
with `state:'none'` when unmeasured. Spec §16.1 ("Show these at company and department levels with sample sizes,
evidence and trend").

## Measure and pass threshold (fixed now; never lowered)
1. Server: the tests below pass; the whole suite stays green.
2. In api mode no department number is a fixture unless it carries a DEMO tag. A browser check asserts:
   - each department card's staffed-agents and active-missions numbers equal a server recount;
   - after a user action that changes them (a new mission is staffed by the simulation, or a task is reassigned or
     canceled), the card updates live without reload;
   - a member doesn't count missions they can't see.
3. `verify-all.sh` and the fit checks stay green, and demo mode is unchanged.

## Server
- **`GET /api/v1/departments?window=30d|7d|90d&includeDemo=0|1`.** Default 30d, DEMO excluded. Any signed-in user. It
  counts **only missions the caller can see** (`VISIBLE_SQL`) and only the caller's tenant, in **every** sub-query.
  - Response: `{window, from, to, departments: [{name, headAgentId|null, memberIds[], staffedAgents, activeMissions,
    openTasks: {running, waiting, failed}, outcomes: {passed, failed, retried, n}, lastOrgChange: {revision, at}|null,
    evidence}]}`.
  - Department membership comes from `agent_definitions.dept`. The head is the active member whose org-revision
    supervisor is `gm` (the cycle 1 definition). Use the latest revision by `max(seq)`, matching cycle 1's `latest()`.
  - `outcomes` ratios are never computed server-side. The client shows counts only and says "too few to rate" when
    n < 5.
- **No new table expected.** If an index is needed, add migration **0016** (the lanes use 0014 and 0015; 0001–0013 are
  frozen).
- **Pure function** `departmentFacts(rows)` with unit tests. Use one grouped query; no N+1.

## Web (api mode only; demo mode exactly as today)
- **Departments cards in api mode:**
  - head (or "no head" in amber);
  - members (avatars);
  - staffed agents and active missions, with a link to the missions;
  - open tasks by state;
  - outcome counts with n and window;
  - "last org change: rev N · when".
- **Remove from api mode:** the capacity ring, skill coverage bars and KPI deltas, or move them into a collapsed
  "Prototype figures (DEMO)" block with the DEMO tag. Don't show invented numbers in the main card.
- Keep "Edit draft" and the other controls as they are, member-hidden as already done.
- **Live:** refetch on `instance.*`, `task.*`, `org.*`, `agent.*`, `mission.*` events, debounced.
- **Help:** `?` help for every new fact, saying where it comes from.
- **Layout:** keep the page's one-screen fit at 1366×768 and 1672×941 (`fit-check`).

## Tests (write first)
- **Pure function:** membership, head, staffed counts, open-task buckets, outcome counts, window boundaries.
- **Route:**
  - visibility (a member doesn't count a private mission's instances or tasks);
  - another tenant excluded;
  - DEMO missions excluded unless `includeDemo=1`;
  - simulated tasks excluded from `outcomes` unless `includeDemo=1`;
  - `lastOrgChange` follows a newly applied org revision (create one through the cycle 1 proposal route, or through
    `POST /agents`).
- **Browser:** extend `web/scripts/api-improve.mjs`, or add `web/scripts/api-c06.mjs` (preferred, to avoid merge
  conflicts with the other lanes). Condition waits only.

## Lane setup (binding: you work in a separate git worktree, in parallel with other lanes)
- **Worktree:** `/home/luca/AXION-w4`, branch `c06-department-facts`. Edit, build, test and commit **only** there.
- **Browser checks:**
  `cd /home/luca/AXION-w4/web && E2E_API_PORT=5492 E2E_WEB_PORT=5493 ./scripts/api-e2e.sh <scripts>`.
  The lane `.env` points at `axion_e2e4`.
- **Demo-mode suite:**
  - start your own dev server: `setsid node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5490 --strictPort > /tmp/w4-vite.log 2>&1 &`
    (from `/home/luca/AXION-w4/web`);
  - run `BASE=http://127.0.0.1:5490 ./scripts/verify-all.sh` and `BASE=http://127.0.0.1:5490 node scripts/fit-check.mjs`;
  - stop the server by port.
- **Never:** 5190, 5191, 5192/5193 or other lanes' ports; the real `axion` database; `npm run dev`, `migrate`, `demo:*`;
  `pkill -f`.
- **Server tests:** `cd /home/luca/AXION-w4/server && npx tsc --noEmit -p . && npx vitest run`.
- **Commits:** on your branch, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't merge or push.
