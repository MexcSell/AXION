# c41 review (independent): reviewed playbooks and a skill library

Worktree /home/luca/AXION-w39, branch c41-playbooks, tip bb5e5a2. Read only. Ran the two playbook test files: 32 passed.

**Verdict: CLEAR.** No path found that makes anything active in a playbook without a human decision by someone other than the proposer. The skill "code" check is a keyword filter, not a barrier (Important, but nothing executes). Several Important items should be fixed or recorded before merge.

All line numbers refer to `server/src/agents/playbooks.ts` unless stated.

## 1. Activation paths: sound
- The only writes that change the active playbook are the two inserts into `playbooks`: accept (l.305) and rollback (l.349). There is no system path that inserts. Both run under `requireAdmin`, the per-agent advisory lock taken as its own statement first (l.272, l.337), then a compare-and-set on `baseVersion` (l.287, l.340). The table adds `version = base_version + 1` plus a unique key, so a gap or fork is refused even if the code were wrong. The 23505 savepoint branch is unreachable in tests, as the report says.
- `decided_by='system'` is allowed only with status `superseded` (migration l.28-29). Superseding only closes a `proposed` row whose text is identical; it never touches `playbooks`. Sound.
- Proposer is not decider: `mine()` checks proposer and submitter (l.274), and the DB check on the candidate holds it too (migration l.28). Agent proposals (`kind='agent'`) are blocked for the filer as well. `proposeLesson` has no callers outside tests, so no route reaches it.
- Rollback cannot resurrect a rejected or never-accepted lesson. It copies `target.items` verbatim, and items only ever enter a version through accept. "Propose as B, then decide via rollback as B" cannot add anything.
- Residual (**Minor**, l.330-365): rollback has no proposer check. With two admins, admin A who proposed lesson L (accepted by B, later rolled out by B) can roll back to the version with L and put it back alone. The text was human-reviewed once, so it is not a review bypass, but a re-activation by the original proposer. Either state it in the help or refuse a rollback that re-adds an item the actor proposed.
- **Minor**: the candidate row stays `accepted` with `accepted_in_version` after a rollback removes the item, so the Candidates list and Playbook disagree. The history shows it, but a status such as "accepted, withdrawn in vN" would be honest. The `playbooks` row is not tied to the candidate by any DB check (the `accept` insert and the candidate update are only coupled in app code; a raw insert could add an item with no human decision). Acceptable for an app-level invariant, but "held in the table" in the report is slightly strong for the playbook side.
- **Minor**: `proposed_by_kind='agent'` does not require `submitted_by` in the DB. An agent proposal with no submitter is only blocked for the agent itself, which has no session anyway.

## 2. Sources and visibility
- **Important** (l.153-155, shared/contracts/playbooks.ts l.3): only `mission` sources are checked. `failure_tag`, `review`, `task` and `note` are free strings the proposer types. A candidate can cite a review or task that does not exist, or one the proposer cannot see, and the reviewer sees it as an evidence chip. This is forged-evidence risk, not a leak (ids are not resolved), but the help text ("Sources let a reviewer check it") overstates it. Fix: label unverified kinds in the chip ("unverified"), or check existence and visibility for `task` and `review` where those tables exist in this tree.
- **Minor**: an accepted item copies `sources` (mission id, free `note` up to 200 chars) into `playbooks.items`, readable by every signed-in user (l.189-212, l.229). A proposer who could see a private mission thus publishes its id and the note to the tenant once an admin accepts. The admin decides, but nothing prompts them. The playbook is append-only, so it cannot be redacted later. Suggest a line in the accept dialog: "sources will be visible to all signed-in users".
- Visibility before LIMIT: correct. `candidates()` puts the rule in the SQL (l.126) and the skills list does too (l.371). The test with 210 newer rows covers it. `GET /lessons/:lid` goes through the same query, so an invisible lesson gives the same 404 as a missing one.
- **Minor (Important for consistency)**: the rollback `note` (`why`) and the `overrideNote` are returned to all signed-in users (`playbookDto`, l.89; the history list l.198), while the agent-version rollback reason is admin only (audit row). Free text of up to 1000 chars from an admin ("rolled back because customer X ...") reaching every member is a real, if low, leak, and the route comment (l.360) says the reason "stays in the audit row" only for the event. Recommend: return `note` to admins only, or only the override note on the item.

## 3. Skills: the code check is a keyword filter
- Regex at l.78: `\bfunction\b | => | \beval\b | <\s*script | \$\{ | ``` | exec( | require( | import\s+[\w{*]`, case-insensitive. Evaded by: `import(`, `setTimeout(`, `constructor[...]`, `javascript:` and `data:` URLs, `<img onerror=...>`, `<iframe>`, Markdown or HTML links, single-backtick template literals, shell (`curl x | sh`, `rm -rf`), SQL, Python `os.system(`, `__import__`, and zero-width or homoglyph splits (`func​tion`). It also gives false positives on the English word "function" (the report notes this). `looksLikeCode` is not applied to lesson text at all, so lessons can carry any of the above (they are text too).
- How much it matters: skills are inert records and nothing runs them, so today this is a UX hint, not a security barrier. The risk arrives when a consumer reads an approved skill. Then the real threat is not JS but instruction injection into an agent ("ignore previous rules ...") and tool misuse, which no keyword list addresses. The brief's pass item ("code-like step gives 400") is met as written. **Important** only because the help says "never code" and `playbook.steps` says text that looks like code "is refused"; it should say it is a best-effort filter and that the human approver is the barrier.
- Right structural rule: a closed step schema, for example `{kind: 'open'|'check'|'click'|'type'|'wait'|'note', target: <enumerated or short [A-Za-z0-9 .,-] string>, expect?: ...}`, a charset allow-list (no `<>`, backtick, `$`, `{}`, `|`, `;`, `\`), no URLs, and a consumer rule that skill text is only ever shown or passed as quoted data, never as instructions or to an interpreter. Keep the human approval. Cap lengths (already 20 x 300).
- **Important, bug** (l.395-398): name is squashed for storage (`squash(b.name)`) but the version query and lock use the raw `b.name`. "Foo  Bar" (two spaces) after an existing "Foo Bar" finds max version 0, inserts version 1 with lower name "foo bar", and hits the unique index `skills_name_version` (23505), which is not caught, so the client gets a 500 instead of a new version. Squash before the lock and the query. Same for lock key case folding with non-ASCII names (`toLowerCase` vs SQL `lower`), Minor.
- Skill approval: approver is not proposer (route l.417 and DB check). The approve swaps the old version to `retired` and the new one to `approved` in one transaction under the name lock. Sound. Retire by the proposer is allowed, which is fine (it only removes).

## 4. Contradiction check
- Deterministic (l.51-75): shared content keywords after stop-word removal and light stemming, with exactly one negated text. Misses: paraphrase and antonyms ("use X" vs "prefer Y over X"), double-negation parity, non-English text (non a-z is stripped, so keys are empty and nothing ever conflicts), and conflicts between two pending candidates (only the current playbook is compared, at accept time). False positives are possible too. The override note is required (l.293-294) but any non-empty text satisfies it.
- Help text (`playbook.contradiction`) is honest: "simple and deterministic, so it can miss subtle cases: the reviewer still decides". It could add "English only" and "pending candidates are not compared". **Minor**.

## 5. Append-only and migration
- Guards: `playbooks` refuses every update and delete; the candidate and skill guards allow one status transition and freeze content, including a no-edit-after-decided rule. TRUNCATE is refused in all three. The purge exception (DELETE only with `axion.purge_demo='on'`) matches 0007. It is effectively unused: `clearDemo` deletes missions, and these tables have no FK to missions, so mission sources in playbooks dangle after a demo purge (**Minor**, harmless).
- CHECKs: sound (gap-free version, kind/lesson_id/rollback_to pairing, rollback_to < base_version, one approved skill per name). `rollback_to` has no FK to an existing version of that agent; the code only picks existing versions.
- Down migration drops tables, then functions, in a safe order, and the test proves schema equality before and after on a database with rows. It destroys data by design; fine for a down.
- No raw inserts into the new tables exist outside the new tests and migration (grep of server/src, scripts and web/scripts).

## 6. UI
- Disabled states carry a reason and the `playbook.decider` `?` (Playbooks.tsx l.88-95), with a visible lock line; DEMO is read only, with a DemoTag and a shared reason. The roll-back and skill buttons give a title reason. Dialog exits: the footer has Cancel, `onClose` and Esc via Modal. No `href` or `dangerouslySetInnerHTML` in the new web files, so source ids render as text. I did not run the browser; I rely on the report (a11y 0 violations, ALL FIT) and the two committed screenshots, not re-verified. **Minor**: the report says a11y, fit-check, api-flows and api-stage6 were not re-run after the review fixes (only one dialog changed).
- Dialog ids DL-92..95 are unique: grep of w31, w34, w36, w37, w41 and AXION shows only DL-90 (w34) and DL-91 (w37); w31, w36 and w41 use none of 90-95. Re-check at merge, as the report says.
- **Minor** wording: the migration comment (l.9) and a help line say "one agent per role" while the implementer's ruling is that agents share roles and playbooks are per agent. Align the wording; the help text for `playbook.current` says "agents of this role" but the playbook belongs to one agent.

## 7. Tests
- They match the claims: sources 400, self-decision 403 (audited), 10 concurrent accepts both variants, rollback equals target, contradiction fixtures plus override, code-like 400, append-only including a hand-inserted gap, tenant isolation 404, visibility before limit. Security.test.ts is extended only by additions: 6 routes in the CSRF list, `LIMITED_KIND` widened to `/lessons|/skills`, a 429 test. Nothing weakened.
- Gaps (**Minor**): no test for rollback by the proposer (above), no test for skill name whitespace (the 500 above), the code check test covers only 5 positive strings, and the report is honest that the server code preceded the tests (RED was done by disabling the registration).

## Summary of findings
| # | Severity | Where | Finding |
|---|---|---|---|
| 1 | Important | l.395-398 | Skill name not squashed before version lookup and lock: whitespace variant gives an uncaught unique violation (500) |
| 2 | Important | l.78, help `skills.steps` | Code check is a keyword filter, easily evaded; help should not imply a barrier; use a closed step schema and a charset allow-list |
| 3 | Important | l.153-155 | Non-mission sources are unverified free strings shown as evidence chips; label or check them |
| 4 | Important | l.89, l.198 | Rollback note and override note readable by every user, unlike the admin-only agent-version reason; restrict to admins |
| 5 | Minor | l.330-365 | Rollback lets a proposer re-activate their own earlier-accepted lesson alone |
| 6 | Minor | l.315, l.330 | Candidate stays `accepted` after a rollback removed it |
| 7 | Minor | l.296 | Accepted items publish mission source ids and notes to all signed-in users; warn in the accept dialog |
| 8 | Minor | help, migration l.9 | "one agent per role" wording contradicts per-agent keying |
| 9 | Minor | l.51-75 | Contradiction check is English only and ignores pending candidates; help could say so |
| 10 | Minor | report | a11y, fit, api-flows and api-stage6 not re-run after the review fixes |
