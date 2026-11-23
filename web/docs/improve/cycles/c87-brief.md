# c87 brief: private-mission visibility sweep inside one tenant

**Lane:** w85 (`/home/luca/AXION-w85`, branch `c87-visibility-sweep`), from improve-30h at the commit that adds this brief (batches through 38 merged). Ports 13590–13593. E2E DB **axion_e2e4** (reused; edit the lane `server/.env` after `new-lane.sh`). **Tests only: no product code change, no migration, no `web/` change.** If the sweep finds a leak, record it as a finding with evidence and keep going. Don't fix product code in this lane.

**Why:** the c86 review found that a reference-class baseline counted tasks from private missions the viewer could not see, so a member could read a hidden task's outcome from an aggregate. The c79 suite (`server/test/tenant/`) is generated from the route table but only checks **across tenants**. Nothing generated checks visibility **inside** one tenant: a member against private missions they don't own.

**Sources:**
- the c79 suite and its report and review: `server/test/tenant/` (fixture.ts, isolation.ts, writes.ts, mutants), `cycles/c79-*.md`;
- c81's additions (MR2, MR4), if merged;
- `server/src/missions/visibility.ts` (`VISIBLE_SQL`: admin, owner or shared);
- the privacy rulings in `cycles/c65-review.md`, `c68-review.md` and `c46-review.md`, and the c65 and c68 privacy tests. Those rulings decide which company-wide aggregates are allowed by design.

**HARD RULE:** never connect to, query or read the live `axion` database in any form. Never run migrate, demo:* or audit:* CLIs.

## Items (each its own commit)
1. **Fixture.** One tenant, with:
   - an admin;
   - two members, M (the viewer) and O (the owner);
   - a private mission of O (not shared), with tasks, delegation briefs (class and difficulty), reviews, approvals, failure tags, messages, notifications and uploads.
   Every free-text field carries a unique marker. M also has their own missions, so aggregates are non-empty.
2. **MR-V1: invariance.** For every GET route reachable by a member (generated from `app.routeTable`, with c79's `QUERY` map and id resolution reused), M's response must be identical in these two worlds:
   - (a) O's private mission is absent;
   - (b) it exists, and its outcomes are flipped: accepted against rejected reviews, done against failed tasks, approvals decided one way or the other.
   Compare byte-for-byte after the same volatile-field normalisation c79 uses, with no new normalisations unless reviewed and listed.
3. **MR-V2: marker absence.** None of O's private markers appear in any response M gets, including the SSE stream (reuse c79's positive-control approach).
4. **Ids.** For every route taking an id, M asking for an id in O's private mission gets the same status as a nonexistent id (404 or 403), with no marker.
5. **Classification.** For every route where MR-V1 or MR-V2 fails, classify it:
   - **BY-DESIGN:** a company-wide aggregate that a prior review explicitly allowed. Cite the file and line of the ruling. Each one goes in a reviewed `VISIBILITY_ALLOWED` table with its reason and citation, which the controller approves at review.
   - **FINDING:** anything else. List it with the route, what leaks, a minimal reproduction and a suggested fix. The suite keeps such a route in a `VISIBILITY_FINDINGS` table so it stays visible and the run stays green. Each entry must name the BACKLOG id the controller will give it (write "TBD").
   A route missing from both tables fails the suite.
6. **Seeded mutants.** At least 5:
   - drop `VISIBLE_SQL` from a list route;
   - from an aggregate;
   - from an id route;
   - leak a marker through a nested field;
   - leak through an SSE event.
   Each must be killed.
7. **Non-vacuity.** Show the worlds really differ: the admin's responses differ between (a) and (b) on at least the routes that serve the private mission.

## Pass threshold
- Items 1–7 done.
- Every member-reachable GET route is either swept or listed as skipped with a reason.
- The mutants are killed.
- Full serial vitest with no failure, or every failure named.
- tsc clean.
- Diff stat: only `server/test/**` plus the report.

## Report
`cycles/c87-report.md`: the route counts, the BY-DESIGN list with citations and the FINDINGS list. **Deadline:** hand back by about 13:00Z. If you are short of time, hand back the committed sweep with what it found, and mark the rest NOT MET.
