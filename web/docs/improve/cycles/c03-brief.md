# Cycle 3 (theme C, agent performance): agent reliability measured from recorded task history

## Hypothesis
Every agent metric in api mode is a DEMO fixture: reliability, success, grade and the radar. Agents created through
the API show "not enough evidence" forever, because nothing ever measures them. After this cycle the server computes one
real, conservative measure per agent: **reliability**. It is the share of the agent's finished tasks that passed on the
first attempt without being taken away. It is built only from recorded tasks, attempts and delegations, carries its sample
size and window, and stays empty below 5 pieces of evidence. The Agent Profile and Directory show it next to (never
mixed with) the DEMO fixture metrics.

Pattern: subnet-scout `organization.py` 1212-1264 (reliability = delegated work done without escalation;
`MIN_EVIDENCE` = 5; renormalise only over components that exist). Spec: Stage 9, "agent performance cards wired to actual
evaluator sample sizes … not invented performance grades"; §16, the evidence-linked "soccer card".

## Measure and pass threshold (fixed now; never lowered)
1. Server: the tests below pass; the whole suite stays green.
2. `GET /agents` and `GET /agents/:id` return
   `reliability: {value: number|null, n: number, window: '90d', evidence: string, includesSimulated: false}` for every
   agent. It is computed from real (non-simulated) tasks by default.
3. A browser check in api mode:
   - a fresh agent shows "not enough evidence (n of 5)";
   - after the script drives 5 or more tasks owned by one agent's instance to terminal states through the API (user
     actions: cancel, reassign, retry; plus the e2e seam cycle 2 documented, if one exists), the profile shows the
     server's value and n;
   - the DEMO metrics still carry their DEMO chip.
4. `verify-all.sh` stays green, and demo mode is unchanged.

## Definition (write it in the help text too)
- **Evidence** = tasks whose final owner instance belongs to the agent and that reached a terminal state (`passed`,
  `failed`, `canceled`) within the window. Ownership is decided as below.
- **Reliable** = `passed` with exactly one attempt and never reassigned away from this agent.
- **Unreliable:**
  - `failed`;
  - `passed` after a retry (more than one attempt);
  - a task reassigned *away* from this agent, which counts against the agent it left even if it later passed elsewhere.
- **`canceled`** by a human doesn't count for or against; it is excluded from n. Document this.
- `value = reliable ÷ (reliable + unreliable)`, as a percentage with 0 decimals. `value = null` when n < 5.
- Simulated (DEMO) tasks are excluded by default; `?includeSimulated=1` includes them and sets `includesSimulated: true`.
- Only tasks in missions the caller can see count (reuse `VISIBLE_SQL`).
  - This makes a member's view possibly smaller than an admin's. That's acceptable, and the evidence sentence says
    "from missions you can see".
- **Evidence sentence** example: "4 of 6 finished tasks passed first time · 1 retried · 1 reassigned away · last 90 days".

## Server
- A pure function `reliabilityOf(rows)` in `server/src/agents/reliability.ts`, with unit tests.
- A SQL query that gathers per-agent rows in one pass. Avoid N+1: one grouped query for all agents on `GET /agents`.
- No new migration expected. If an index is needed for the query, add `0014_*` (0013 is taken).
- Add `reliability` to the agent DTO, and update the type in `shared/contracts`.

## Web
- **Agent Profile, api mode:** a "Reliability" stat with the value, n and window, or "not enough evidence (n of 5)",
  with a `?` that explains the definition. It sits beside the existing DEMO metrics, which keep their DEMO chip. The radar
  and grade stay DEMO-tagged.
- **Directory card and list row, api mode:** a small reliability chip (value or "—") with the n tooltip.
- **Live:** refetch on `task.stateChanged` and `task.delegated`, debounced.
- **Demo mode:** unchanged.

## Tests (write first)
Unit tests for each classification:
- first-time pass;
- retried pass;
- failed;
- reassigned away (counts against the agent it left);
- canceled (excluded);
- the n < 5 threshold giving null;
- the window boundary;
- simulated excluded and then included.

Route tests:
- a member doesn't count a private mission's tasks;
- other tenants never count;
- the value is identical between `GET /agents` and `GET /agents/:id`.

Plus the browser check from "Measure and pass threshold" (extend `web/scripts/api-improve.mjs`).

## Constraints
Same as cycles 1–2:
- **Never touch the live system:**
  - don't run anything against the real `axion` database or 127.0.0.1:5191;
  - never restart 5190;
  - no `npm run dev`, `migrate` or `demo:*`.
- **Keep the safeguards:** don't loosen auth, visibility, append-only, the execution guard or any test.
- **Owner UI rules:**
  - icon-first, animated, `?` help;
  - the development stage stays visible;
  - fit checks stay green.
- **Verify:**
  - `cd server && npx tsc --noEmit -p . && npx vitest run`
  - `cd web && npx tsc --noEmit -p . && ./scripts/api-e2e.sh api-auth-flow.mjs api-flows.mjs api-stage6.mjs api-improve.mjs && ./scripts/verify-all.sh`
- **Commit** on `improve-30h`, ending the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
