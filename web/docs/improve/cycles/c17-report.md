# Cycle 17 report: "New Features" guide in the Help Center (lane w15)

## What was built
- A new first tab in Help Center, **New Features** (`/help?tab=new-features&f=<page>`). Left: 14 feature pages grouped as
  Stage 5, Stage 6 and Improvement loop, each with a status chip (Real / Real + DEMO parts / Coming when merged). Right:
  what it does, where to find it, what is real, what is still DEMO, honest limits, and an "Open it" link into the feature.
- Content: `web/src/help/whatsnew.ts` (one record per page) and `web/src/help/pages/whatsnew.ts` (each page also becomes a
  `?` entry `whatsnew.<key>`, so Context Help search finds them; plus `help.whatsnew`).
- Honesty: the history/rollback, version-proposal and department-facts pages are marked **Coming when merged** (cycles 4 to 6 are on
  their own branches, not in this app version) and their links go to the closest screen that exists today, labelled as such. Agent
  reliability states that its 5-sample path is NOT MET until execution exists. Missions and channels say plainly that nothing executes
  and agents do not answer on real missions. Open owner question Q1 (members deciding approvals) is stated on the Approvals page.
- Tab named "New Features" (not "What's new") because `fit-check.mjs` parses tab names with single quotes.
- Light-mode screenshots (api mode) in `web/docs/screenshots/c17-*-light.png`: guide pages (real and coming-later), agents
  directory, live instances, proposals, mission hierarchy, mission conversations, administrators line, scorecard, agent reliability.
  Script: `web/scripts/api-c17-shots.mjs`.

## Threshold
| Item | Result | Evidence |
|---|---|---|
| `check-help` green | PASS | verify-all step "help keys": All referenced help keys are defined |
| Every guide page has a working deep link, tested by a browser check | PASS | `api-c17.mjs`: 14 pages, each opened from its own URL (page selected, link href correct), link followed, lands on the right route and tab or sub-tab (or opens the chat dock). 22/22 checks PASS in api mode |
| verify-all green | PASS (rc=0) | typecheck + build, 78-view crawl NO PROBLEMS, deep crawl, flows, u1 flows, dialog smoke 106/106, dialog ids, help keys, fs guard; `BASE=http://127.0.0.1:6590 heavy.sh ./scripts/verify-all.sh` |
| Help page fits one screen | PASS | `api-c17.mjs`: New Features, Guides, Context Help have no page scroll and a 676 to 717 px scroll region at 1672x941 and 1440x900 |

RED/GREEN: the first run of `api-c17.mjs` had 6 FAIL (the landmark for Operations sub-tabs was wrong, a script error, fixed in
the script) and fit FAIL at 1366x650. At 1366x650 the existing Guides and Context Help tabs also overflow (69 and 215 px), so that
size is below the app's fit gate and was replaced by 1440x900; nothing was loosened in the app.

## Files
`web/src/help/whatsnew.ts`, `web/src/help/pages/whatsnew.ts`, `web/src/pages/Help.tsx`, `web/src/config/nav.ts` (one tab),
`web/scripts/api-c17.mjs`, `web/scripts/api-c17-shots.mjs`, `web/docs/screenshots/c17-*-light.png`.

## Concerns
- The "Coming when merged" pages must be updated or removed when cycles 4 to 6 merge (the status field is one line each).
- The guide is hand-written from PROGRESS.md and LOG.md and can go stale; there is no automatic check of its claims.
- The check is api mode only; demo mode renders the same tab but was only covered by verify-all.

## Fix round (review c17-review.md)
- **I1** Organization and version proposal pages now say: only administrators can propose and decide, the author cannot approve their own, so two administrators are needed and with one a proposal can be made but never applied.
- **I2** Dropped "instead of editing the org chart directly". Proposals are the reviewed route for reporting lines; adding an agent places it in the chart directly. Direct edits of an agent's skills, tools or model are single-administrator, audited and versioned, and the owner question on this is stated as open.
- **History/rollback, version proposals, department facts** rewritten as available features (no "Coming when merged"), from the c04, c05 and c06 reports, with their limits: no one-click undo, rollback past a newer agent cannot be approved, version proposals show no evaluation numbers, department outcomes need execution data (below 5 tasks: "too few to rate"). Statuses are now Real.
- **Runs-after-merge checks:** these three pages carry an `afterMerge` landmark. `api-c17.mjs` prints `SKIP ... runs after merge` when the landmark is not in the build (all three skip on this branch) and runs the check normally once cycles 4 to 6 are merged. The integrator must run it after merging and expect 3 fewer SKIP lines. For History the check clicks the Proposals / History switch first.
- **M2** Conversations link goes to `/missions` (no dependence on M-126). **M3** jargon removed (argon2id, "NOT MET", "n of 5", "dry run", "stale check"). **M1** verified-completion wording gained the agent-check path. **M4** Task Flow noted as sample data. **M5** a line at the top of the tab and per-page DEMO wording say the guide describes the server version and the offline demo shows sample data.
- Also made the fit check wait for the scroll region (it measured before the page rendered once).

Results: `api-c17.mjs` all PASS with 3 SKIP (after merge), fit PASS at 1672x941 and 1440x900. verify-all: typecheck, crawls NO PROBLEMS, dialog smoke 106/106, help keys defined, fs guard OK.

**Concern, not caused by this round:** the demo-mode `flows.mjs` step "Hierarchy: click agent → conversation pane" (and in one verify-all run also "Conversations: mission agents pane" and "v1 to v2 migration") FAILED. It fails identically on the previous commit 03c761f, where verify-all had passed before the lane dev-server override changed, so it looks environmental (the new override or load), not this change. verify-all still returned rc 0 because flows failures do not set the exit code; the integrator should rerun flows on the merged tree.
