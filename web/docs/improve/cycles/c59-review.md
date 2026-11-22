# c59 review (independent): origin-bound memory and skill records
Branch c59-origin-records, worktree /home/luca/AXION-w58, commits 5b3e32b..aa28be9, migration 0044. Read-only review. All DB probes ran inside
BEGIN..ROLLBACK on axion_e2e17 (it was left at 0044, unchanged).

## What I re-ran (evidence)
- `heavy.sh npx vitest run` on the 4 c59 files, playbooks.test.ts, playbooks-migration.test.ts and test/contracts, with `--maxWorkers=1 --no-file-parallelism`
  (load 10.5): 9 files, 129 passed, 0 failed.
- `heavy.sh ./scripts/api-e2e.sh api-c59.mjs` at 1366x768, PLAYBOOK_ACTIVE_CAP=3, ports 10892/10893: 26 passed, 0 failed.
- NOT re-run: full vitest, verify-all, fit-check and a11y sweeps (the lane's results stand; I only viewed the committed 1366x768 screenshots of cap and retirement, no clipping seen).
- `git diff --stat 5b3e32b^..aa28be9` on playbooks.test.ts, playbooks-migration.test.ts, api-c41.mjs: empty (unchanged). allowlists.ts and exercised.ts: not in the diff.

## Findings

### F1 (should-fix) The 0044 down then up round trip RAISES origin classes
`down` drops origin_channel/origin_class; `up` backfills every row as human_entry/human unless proposed_by_kind='agent'. Any record that was
derived or tool-class and was written by a person (a person citing an agent/tool record) comes back as human.
Evidence (axion_e2e17, in a transaction, then rolled back): before `derived | agent | human(kind) | 1`; after `\i down` + `\i up`:
`human_entry | human | human | 5` (the derived/agent row became human_entry/human). This breaks "class never rises" across a rollback and redeploy.
Fix options: have `down` refuse (raise) while any row has channel other than human_entry/agent_output-by-agent-kind; or keep the columns in a side table that
`up` restores from; or make the up backfill fail closed (rows with unknowable origin become 'agent', not 'human'). The migration test only checks guards, not this.

### F2 (should-fix) Wording says "role", ruling says "per agent playbook"
- web/src/features/agents/OriginRecords.tsx:39 tooltip: "against the cap for the role".
- web/src/help/pages/c59-origin.ts `playbook.cap`: "The most active items one agent role keeps in its playbook"; "Skills have no role, so they are not capped".
- server/src/agents/playbooks.ts:124 comment and shared/contracts/src/playbooks.ts:52 doc say "per role".
- Server messages say "The playbook for ${agent.role} ..." (names a role, not the agent).
- The c59-report says "per playbook" correctly but also "per role" in the brief quote. Change UI/help/errors to "per agent playbook" (and the agent name).

### F3 (should-fix) Honesty limit is not stated in the UI or help
Report concern 3 admits a person typing an agent's text by hand is undetectable and the rule covers recorded links only. Neither appears in the product.
- OriginChip `human` says "Typed by a person." (OriginRecords.tsx:19), which over-claims.
- help `playbook.origin` says "Only a person typing through the app can create a "human" record" and nothing about hand-typed agent text or non-record sources
  (mission, review, note) carrying no class.
Add one plain sentence to the help and the chip tooltip: "Human means entered by a signed-in person; text copied from an agent is not detected, and the rule
follows recorded links to lessons and skills only."

### F4 (should-fix, small) No `?` on the origin class
Only a `title` tooltip on OriginChip (not keyboard reachable). `playbook.origin` is used only in the new-lesson dialog when a record is cited
(grep: web/src/dialogs/defs/playbooks.tsx:38, nowhere else). Cap has `?` (chip and beside a disabled Accept), log has `?`, retirement has `?`. Add
`<HelpTrigger k="playbook.origin" />` beside the chip (once per list header is enough if space is tight).

### F5 (minor) Contribution log completeness is application-level only
Every route path writes its log row in the same transaction (checked: propose, reject, accept, closed_duplicate, withdrawn/restored, replaced, approved, retired,
retirement_kept; refusals write none). The DB does not enforce it: `update skills set status='retired'` by raw SQL passes skills_guard with no log row.
Optional: a deferred constraint trigger. Related small gaps: (a) an agent proposal filed by a person logs only the agent as actor; the filing person is in the audit row, not the log;
(b) a second rollback logs 'withdrawn' for a restored lesson whose status was already 'superseded' (the update is a no-op, the line is not).

### F6 (minor) DB trigger matches source kind case-sensitively
Raw insert with `{"kind":"Lesson","id":"<agent lesson>"}`, channel human_entry/class human, proposed_by_kind human: ACCEPTED (probe P8). The service blocks it
(zod enum), and a raw writer could set human_entry anyway, so this is defence in depth only. Use lower(kind) or a CHECK on the kind list.

### F7 (minor) Migration 0044 was edited twice in place, not once
`git log --follow` shows c35ee39 and a6b1615 (the report says once, "after its first commit"). The runner stores version and name only (schema_migrations has no checksum),
so a DB that applied the c35ee39 version silently lacks the a6b1615 trigger ("non-derived row citing records is refused"). Safe for merge only if no lane DB or deploy applied
the early draft; axion_e2e17 has the final one (probe P4 refused). Other lanes that copied 0044 early must run down/up. Say so in the merge note.

### F8 (minor) Contract suite red between commits 2-5
Recommend the integrator squash commits ad7f7b3, 9580d15, a611143, 58c645b (items 2-5) into one commit, or fold 58c645b's contracts into each, so bisect is never red.

### F9 (minor) api-c59 seeds agent rows by psql
Legitimate as setup: no route or runtime can write agent_output (that is the point of the rule), c41/c53 precedent, lane DB only. But it inserts without origin columns, so it
tests the trigger defaults, not `proposeLesson`. The server-side tests do use `proposeLesson` with real channels. Optional: a tiny e2e-only CLI that calls proposeLesson.

## Checklist results
1. Origin never rises. HOLDS on every path I could reach, except F1 (migration round trip) and F6 (raw, case).
   - Raw SQL (e2e DB): P1 update class on proposed agent lesson refused ("a lesson candidate can only be decided"); P2 agent-kind human_entry refused (lesson_origin_agent);
     P3/P5 derived above weakest source refused; P4 non-derived row citing a lesson refused; P9 source in another tenant refused ("needs lesson or skill sources that exist");
     P10 update of class or sources on a derived row refused; chain tool -> D1(tool) -> D2(tool) ok, D3 'agent' over D1 refused (class is stored per record, so depth is irrelevant, deeper than 3 is fine).
   - Cycles are impossible: sources are immutable and must exist at insert, ids are random 128-bit.
   - Deleted/purged source: derived class is already stored; playbook item origin falls back to 'tool' (fail closed) when the lesson row is gone (PLAYBOOK_SELECT).
   - Service: insertLesson/insertSkill are not exported; proposeLesson/proposeSkill refuse kind human (ORIGIN_NOT_ALLOWED); channel human_entry by an agent or on behalf is refused;
     citing any record forces derived with class = weakest of cited and writer ceiling (origin.ts). Routes are `.strict()` (body cannot name a class) and need a user session; agents have no sessions.
   - a6b1615's two holes (named lower record but kept class; exported writers accepting human) are closed in code and DB. Siblings: F1, F6 only.
2. Log append-only: UPDATE, DELETE, TRUNCATE refused on record_contributions and skill_outcomes (P11); with axion.purge_demo=on only DELETE passes, UPDATE and TRUNCATE still refused;
   skill_outcomes source other than 'fixture' refused (P12). Same-transaction writes: yes at the app level (F5 for the DB).
3. Cap: ACTIVE_CAP_REACHED 409 on accept and on a growing rollback, audited, no version, no log; inside playbookLock -> advisoryXactLock in server/src/locks.ts (schema-scoped).
   c59-cap "6 racing, exactly 3 succeed" passed; a loser with a stale baseVersion gets CONFLICT first (still refused). Operator setting only: config.ts + env, no route reads or writes it. Wording: F2.
4. Retirement: derived on read, nothing stored, only recordFixtureOutcome writes (no route/job), source CHECK = 'fixture'; no auto-retire path exists. Dismiss and retire are admin routes;
   there is no proposer on a system-derived proposal, so decider != proposer is not applicable; the existing retire route is unchanged (c41 behaviour). UI always shows "fixture only" and "no outcome data yet" (seen in api-c59 and screenshot).
5. c41 not loosened: the three c41 files have an empty diff. 0044 only ADDS immutable columns to the two guards. Both directions on axion_e2e17 (BEGIN..ROLLBACK): up state md5 differs from down, down guard bodies equal 0033's (text compared with whitespace folded: True for both),
   down removes columns, tables, functions. Re-up works. But see F1 (data semantics) and F7 (in-place edits).
6. Contracts: registry has all 4 new routes, validators cover every new field (originChannel/Class on all 3 DTOs, activeCap, contribution, retirement), ERROR_CODES has both codes; no allowlist lines; security.test lists updated only.
   Squash advice: F8.
7. UI: plain words mostly good; `?` on cap (chip and disabled Accept), log, retirement, derived note; none on the origin chip (F4). 1366x768 screenshots show no clip; api-c59 ran at 1366x768 26/26. a11y not re-run (lane reports 0 violations); Log and Keep/Retire buttons have aria-labels, aria-expanded on Log.
8. Honesty: not stated in UI/help (F3).
