# Cycle 8 review (lane w6, branch c08-flaky-checks): remove the flaky browser checks

Reviewer: independent, read-only. Scope: commits ce6a693..de6e556 (diff `c08.diff`), brief `c08-brief.md`, report
`c08-report.md`, PROCESS.md "Safety rules". I ran nothing (no servers). Evidence comes from the code and the lane's run logs in `/tmp/w6-*`.

## Verdicts

- **Spec: PARTIALLY MET (conditional).** Both root causes are real, explained and fixed: the loadAgents race and the
  expiry-step race. The fixed threshold is not fully met. Stage6 got 0 runs that reached the 409 steps (blocked by c22). The
  improve flake was never reproduced RED (0/10 unstressed). The flows "after" evidence has an unexplained failing run, and
  verify-all is not evidenced at HEAD.
- **Quality: GOOD. Approve after the report fixes below.** The app fix is correct for every caller, and the new test
  forces the race. The expiry gate can't deadlock and keeps the assertion. No assertion was removed or loosened, and no
  fixed sleep was added.

## Critical
None.

## Important

**I1. The report's evidence is incomplete, and one post-fix flows run failed without being reported ("honest numbers").**
- The report says "api-c08.mjs: 20 consecutive runs, see the result line below" and "plus 10 further runs (see below)".
  There is nothing below. The api-c08 and api-improve 20-run results do exist: `/tmp/w6-g-c08.summary` has 20× `rc=0`
  (runs 22:00–22:07) and `/tmp/w6-g-imp.summary` has 20× `rc=0` (every log `83/83 passed` with
  `PASS PROPOSAL_EXPIRED`, 21:36–22:00). Copy these lines into the report.
- `/tmp/w6-fl.txt` (last written 22:13:43) is the flows loop. It shows the per-run FAIL counts `0 0 0 0 0 0 2 0 0 0`.
  **Run 7 had 2 FAILs.** No per-run log survives, so the failing steps can't be identified. These runs started before
  the final commit de6e556 (22:11:30), so they ran the bc6e823 flows.mjs with both condition waits. The report presents
  flows as fixed and does not mention this run.
- Pass-threshold line 3 says "two 500 ms sleeps replaced by condition waits in flows". The final diff replaces one
  (`flows.mjs:105`). The Hierarchy change was dropped in de6e556.
- Fix: correct the report, state the run-7 result honestly, and re-run flows 10× on the tree that will merge (see I3).

**I2. Threshold 2 is unmet for api-stage6, and threshold 1 is partial.** The report declares this honestly; the cycle must
still be logged that way.
- Stage6: `/tmp/w6-base-s6*` shows each run dying at `page.reload: Timeout 30000ms` (`TimeoutError`, 4 occurrences
  across base and dbg logs), before the Edit/409 steps. "0 failures in 20 runs" for stage6 is **not met**.
- api-improve: before 0/10, so the expiry race was diagnosed from code and the c02 history, not reproduced. The fix is sound
  (see check 3), but there is no RED for it.
- The api-c08 RED ("5/6 on the old agents.ts") has no saved log (`/tmp/w6-red` holds only api.log/vite.log). My static
  walk below confirms it would fail on the old code.
- Follow-up that must be recorded in LOG.md: after c22 merges, run `api-stage6.mjs` 20× and record the result. Until
  then the 409 flake is closed by `api-c08.mjs` only.

**I3. verify-all at the merge point depends on c25.**
- de6e556 removed this branch's Hierarchy condition wait. HEAD `flows.mjs:87-88` again has the fixed
  `waitForTimeout(500)` and an immediate count, which is the step the report itself saw fail. The fix for it is in
  c25-test-hygiene, which is **not** in improve-30h yet.
- `/tmp/w6-verify.log` (22:01, 0 FAIL) predates de6e556.
- Merge c25 before or with c08, then re-run verify-all on the merged tree before marking the flows flake closed.

## Minor

**m1. `api-c08.mjs:66`: the double requestAnimationFrame between releasing #1 and #2 is an ordering assumption, not a
condition.**
- It affects only RED sensitivity. The fixed code passes in any release order (see check 1), so this can't make the
  new check flaky.
- On the old code, if #2's response were applied before #1's continuation ran, the dialog would adopt the newest version
  and the test would wrongly pass.
- Suggest waiting for `requestfinished` of `held[1].route.request()` before `held[2].release()`. This is a real event and
  still order-safe for the new code.

**m2. `api-improve.mjs:233-235`: the gate covers only B reads issued after `B.p.route(...)`.**
- A B proposals read already in flight, if served by the server after the `update` at line 241, would still answer
  "expired". The `live` flag in `orgProposals.ts:21-25` drops it only if a newer read follows.
- Realistically, nothing triggers such a read in that window: B's only trigger is the debounced org.proposalCreated read
  that put the card on screen. The comment's claim "every read B made earlier has already been answered" is nevertheless
  not enforced.
- The old in-flight counter (`proposalReads`, lines 34-40) is now dead code.
- Cheap hardening: count held requests in `holdReads` and wait (condition) for `B.p.proposalReads() === heldCount`
  before the DB update. Otherwise delete the counter.

**m3. `agents.ts:45`: two behavioural edges of the new chaining, both acceptable.**
- A superseded load whose own GET fails still rejects at once, without waiting for the newest. The 409 path then shows
  pre-reload data, as before.
- `client.ts:26` has no fetch timeout. A superseded caller now waits for the newest load, so a hung event-triggered GET
  keeps the Edit dialog's Save busy where it used to return at once. Any API call has the same exposure, so it is Minor.

**m4. Merge conflict with c25 at `api-improve.mjs:222-224`.** c25 replaces the inline e2eUrl/regex lines with
`requireE2eDatabase()` (`_session.mjs:29`, the same `/\/axion_e2e\d*(\?|$)/`). Resolve by taking c25's line and keeping
c08's gate (lines 229-247).

**m5. Lane-only files.** The 20 runs used the uncommitted `web/scripts/api-e2e-lane.sh`, because `api-e2e.sh` lacks the
lane Vite override. Untracked `dbg-c08.mjs`, `dbg-s6.mjs` and `api-e2e-lane.sh` must stay out of the merge. The api-e2e.sh
gap is a LANES/backlog item.

## Checks requested

### 1. loadAgents fix (`web/src/api/agents.ts:36-52`): correct for every caller
How it works:
- `latest` always holds the most recently *started* run (line 50). `run` is assigned before the first `await`
  resolves, so `latest === run` (line 45) is well-defined.
- **Overtaken load A:** if B started later, A discards its own answer and returns `latest` (B). An `async` function that
  returns a promise adopts it, so A resolves only when B has applied (or B rejects).
- **Chains (A→B→C):** each overtaken run returns the newest run at the time of its check, and that run in turn defers to
  a newer one. The chain only moves forward to later-started runs, so there are no cycles and it ends at the newest load,
  which applies.
- **Sign-out (`resetAgentsCatalog`, line 56, `gen++` with no new run):** the in-flight newest run sees `latest === run`
  and returns `undefined`. Nothing applies and there is no self-await (this is the ef5da0d guard). After a later sign-in,
  an old run defers to the new user's load, which is harmless.

No lost updates:
- Only the newest-started run applies. An older answer arriving after a newer one has been applied is dropped (`mine !== gen`).

Awaiting callers get the newest data:
- `updateAgent` 409 path (`agents.ts:87`) then the dialog's `AGENT_BY_ID[a.id].rowVersion` adoption
  (`dialogs/defs/agents.tsx:113`). The data now comes from the newest load, which in the race was started after the other
  admin's change. This is the reported bug, and it is fixed.

Failure handling:
- If the newest load fails, its rejection now reaches the overtaken callers. Every caller catches it:
  - `events.ts:43` and `events.ts:47`;
  - `agents.ts:77`, `:84` and `:87`;
  - `loadAgentsOnce` at `agents.ts:60`, which now marks the catalog failed and toasts. Before, an overtaken first load
    left `loaded=false`, so this is an improvement.
  - c05's new caller `versionProposals.ts:40` (in improve-30h): `void loadAgents().catch(() => undefined)`.

No infinite wait beyond m3.

Compatibility:
- The brief's premise didn't hold. Neither c05 (merged) nor c19 touches `web/src/api/agents.ts`. Both change only
  `events.ts`, plus their own `versionProposals.ts` and `mentoring.ts`, and add no awaiting callers. There is no textual
  or semantic conflict.

### 2. `api-c08.mjs` reproduces the race and asserts the user-visible outcome: YES
How the test holds the reloads:
- The route `/\/api\/v1\/agents(\?.*)?$/` (line 46) matches only the catalog GET. The `p.request` calls bypass page
  routing.
- Each held response is fetched for real before it is queued. The `heldCount` waits (lines 56, 59, 62) make the three
  reloads strictly sequential, and each one is answered after the server change it follows:
  - #0 after o1;
  - #1 after the stale Save's 409;
  - #2 after o2, carrying the newest rowVersion.
- A description-only PATCH emits exactly one `agent.updated` (`server/src/agents/routes.ts:107-110`), so each "other
  admin" edit produces one reload.

On the old code:
- When #1 is released, it sees `mine !== gen` (#2 has started) and returns.
- `AGENT_BY_ID` still holds the dialog-open version, because #0 and #2 are still held.
- The dialog adopts that stale version and the next Save returns 409, so the line-73 check fails. This matches the
  reported RED, modulo m1.

On the new code:
- #1 waits for #2, the dialog adopts rowVersion(o2), and Save succeeds.

Assertions are user-visible:
- The conflict message (line 69).
- The dialog closes and the server gains exactly one new version (line 73).

The waits use `until`, and the only non-condition wait is m1.

### 3. Expiry step (`api-improve.mjs:226-247`): still exercised and asserted, no deadlock
Still exercised and asserted:
- P3's `expires_at` is still moved into the past (line 241), and Approve still hits the server.
- The assertion text and condition are unchanged (lines 245-246): the alert contains "expired" and the card has
  `data-status=expired`.

A's and C's reads are unaffected by the gate:
- They can still expire P3 first (`expireDue` runs on read, `proposals.ts:57-62`).
- That does not change the outcome: the decision runs `expireDue` and then refuses any `status==='expired'` row with the
  same `PROPOSAL_EXPIRED` message (`proposals.ts:122-126`).
- B's DOM can change only through B's own reads, which are held. The decision POST passes through (`holdReads` continues
  non-GETs).

Card behaviour after release:
- After `openGate()` (line 244), a released read may land before the POST answer. The card then leaves the Pending filter
  briefly and comes back once `setErr` runs.
- `errs` lives in the parent (`ServerProposals.tsx:131-135`), so the card's message survives the unmount. The `until`
  wait covers this, the same as before.

Deadlock analysis:
- The gate is opened right after the click.
- If the click (Playwright's 30 s default timeout) or the DB step throws, the outer `catch` runs and the browser closes.
- Nothing awaits the held routes, so there is no hang.

Residual: m2.

The check that was dropped was a setup guard ("no proposals read in flight", plus a 300 ms `setTimeout` inside
`until`), not an assertion of app behaviour. The `setTimeout` was a disguised fixed sleep, and removing it is correct.

### 4. Conversations step (`flows.mjs:105-107`): condition wait with a timeout, checks identical
- The 500 ms sleep became `.first().waitFor({ timeout: 10000 }).catch(() => undefined)`, followed by the unchanged
  `expect` on the count and the unchanged URL check.
- M-126's lead is `gm` (`data/missions.ts:21`), and `agentId` derives from the URL (`Missions.tsx:139`). So a Planner-01
  `.msg-head` exists only after the click has updated the URL. The wait is not trivially satisfied, and the URL check
  stays valid.

### 5. No weakening
- No assertion was removed or loosened in agents.ts, api-improve, flows or api-c08.
- The DB guard regex `/\/axion_e2e\d*(\?|$)/` (`api-improve.mjs:224`) widens only to the lane e2e databases, never
  `axion`. It is the same pattern as c25's shared guard.
- One fixed sleep was removed (the 300 ms one) and one 500 ms sleep was replaced. None was added. m1's frame wait is not a
  timer.

## Notes for the backlog (outside this diff)
- AgentEdit after a 409 adopts the newest rowVersion but keeps the form's original description
  (`dialogs/defs/agents.tsx:110`). The next Save can silently revert the other admin's description edit. This is
  pre-existing UX, so it is not a c08 finding: consider refreshing untouched fields after a conflict.
- `api-e2e.sh` has no lane Vite override (see m5).
