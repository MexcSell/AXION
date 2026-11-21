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
