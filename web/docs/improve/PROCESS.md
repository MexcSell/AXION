# AXION improvement loop: the process, step by step

Owner request (2026-11-21): *"We study ways to update the company's structure, update the company's performance, and
improve the performance of agents, and update the code based on them. Write down this process step by step. This is
learned by repeating it continuously for 30 hours."*

**Who runs it:** Claude Code runs it on the AXION code (the owner chose this). The loop started at 2026-11-21 11:36 UTC
and ends at 2026-11-22 17:36 UTC.

**Where it happens:** on the local branch `improve-30h`. `release_1.0.0` on GitHub stays as it was, and nothing is pushed
without asking.

## The three themes

| Theme | What we improve | Examples |
|---|---|---|
| **A. Company structure** | how the company is organised and how that changes safely | org chart revisions, reorganisation proposals with before/after and impact on running missions, approval, rollback |
| **B. Company performance** | how the company measures and shows its own work | mission throughput, cycle time, verified outcomes, blocked time, always with sample size and time window |
| **C. Agent performance** | how agents are evaluated, coached and improved | evidence-based scorecards, mentoring plans, version proposals evaluated by someone other than the author, promotion and rollback |

The themes take turns (A → B → C → A …), so each one moves forward.

## One cycle, step by step

1. **Check the clock and the state.** Read `STATE.md` and run `date -u`. Don't start a new cycle when less than 90 minutes are left.
2. **Measure first.** Record the current numbers for this theme: tests, check counts, timings, sizes, and data the app really
   records. Write them down before touching code.
3. **Study.** Read the relevant part of the design spec and the existing code, plus patterns from the reference backend
   (`/home/thomas/subnet-scout`, read only). Pick candidates from `BACKLOG.md` and score each one on value, effort and risk.
4. **Decide one change.** It must be small enough to build, test and review in one cycle. If it adds a new writer of
   existing data, list the other writers of that data, so they all share one safe path. Write down:
   - the **hypothesis** (what gets better and for whom);
   - the **measure** (which number or check shows it);
   - the **pass threshold**, fixed now and never lowered after seeing results.
5. **Build it test-first.** A fresh implementer works from a written brief: write the failing test, then the code, then make it pass.
6. **Independent review.** A different reviewer checks the change against the brief and the safety rules. There is at most
   one round of fixes; anything left over is written down for later.
7. **Verify.** Run the full checks: server tests, web typecheck, the browser checks against a test server, and the
   demo-mode suite. A red check means the cycle is not done.
8. **Measure again.** Compare against step 2 and the threshold from step 4.
9. **Record.** Add an entry to `LOG.md` with:
   - the times;
   - the hypothesis;
   - what changed (commits);
   - the numbers before and after;
   - pass or fail;
   - a screenshot path for UI changes.
   Then commit on the branch.
10. **Learn.** Write one lesson in `LESSONS.md`. If the lesson changes how the loop should work, edit this document.
11. **Update the live system when needed.** If the cycle changed server routes or the database, first take a backup and
    check that it restores. Then restart the live server and check its health. Otherwise leave the live server alone.
    Restart only when every change is committed: the live server runs straight from the working folder.
12. **Next theme.** Go back to step 1.

## Safety rules that every cycle obeys

- **Honest numbers only.** Agents don't execute yet, so there is no real agent or company performance to improve. The
  loop builds the **measurement and the governed improvement flow**. Any number that isn't measured is shown as "not
  enough evidence" or tagged DEMO, never invented. The only before/after gains claimed are code-level ones: tests,
  checks, speed and size.
- **The threshold is fixed before the change.** A test or rule is never weakened to make a cycle pass.
- **Untouchable:** sign-in and permissions, who can see what, the append-only history tables, the "nothing executes"
  guard and the audit log. A cycle may make them stricter, never looser.
- **Still off:** real browser automation (Stage 7) and real model calls. They need the owner's approval.
- **Owner rules stay:**
  - one agent per role and no teams;
  - the development stage is always visible;
  - the shared page frame;
  - pages fit one screen;
  - icon-first, animated UI with `?` help;
  - the demo mode keeps working.
- **Database:** existing migrations (0001–0012) are frozen. New changes get new migrations, tested on a database that
  already has data.
- **Questions for the owner** are queued in `LOG.md` with a safe default, and the loop keeps going.

## Files

| File | Purpose |
|---|---|
| `PROCESS.md` | this process (edited when a lesson changes it) |
| `STATE.md` | start and end time, current cycle and step, base commit (the place to resume from) |
| `BACKLOG.md` | improvement ideas per theme, scored |
| `LOG.md` | one entry per cycle, with evidence and queued owner questions |
| `LESSONS.md` | what each cycle taught |
| `SCORECARD.md` | baseline and final measured numbers |

## At the end

One summary covering:
- the scorecard before and after;
- what changed per theme;
- the lessons;
- the queued questions;
- how to return to `release_1.0.0` (`git switch main`).

Then the owner decides whether to push the branch and whether Stage 7 starts.
