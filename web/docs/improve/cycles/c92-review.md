# c92 review: CLEAR

Findings (none blocker or major):
1. minor: web/scripts/_base.mjs:11 accepts any cwd under `/home/luca/AXION/` (startsWith(INTEGRATION + '/')). A worktree nested inside the integration tree would get the 5190 default. Lanes are siblings (/home/luca/AXION-wNN, /home/luca/AXION-lanes), so no live case. Fix (optional): also treat a nested `.git` file (worktree) as non-integration, or document it.
2. minor: pickBase compares exact dir or dir + '/', so AXION-w90, AXIONx, AXION-lanes are refused (tested). process.cwd() is already the realpath on Linux, so a symlinked cwd is judged by its target; a symlink into AXION resolves to the integration tree, which is the correct result.
3. minor: api-narrow.mjs, api-c73-psl.mjs, shot-c07.mjs read process.env.BASE with no default (fail on "undefined/...", not live). api-*.mjs 5193 defaults are the e2e port. No 5190/5191 default remains (grep of web/scripts for 519[01]: only _base.mjs and the verify-all.sh comment).

Verified:
- Explicit BASE or arg wins (arg > env.BASE); empty BASE counts as unset. Behaviour from /home/luca/AXION and /web is unchanged (5190).
- 28 script edits: diff lines are only the import, `resolveBase(...)`, and usage comments; argv forms (fs-guard, perf-nav) keep their arg; flows.mjs inline and `BASE = () => resolveBase()` equivalent. No other behaviour change.
- Scope: only web/scripts, server/test, report.
- Scanner probes (run, scratch test removed): `from (select 1) x join tasks t`, `from generate_series(..) g, tasks t`, `... g join tasks t`, `extract(epoch from now()) ... from tasks t`, `trim(both from x) ... from tasks t` all report tasks (reads resolved). Unknown `nosuch` stays unresolved after a sub-select, after unnest/lateral, after two sub-selects with join, beside extract, and inside `extract(epoch from (select ... from nosuch))`. The exemption is narrow: it keys on the immediately enclosing paren being preceded by extract/substring/trim/overlay/position as a whole word, so a nested real `from tasks` has its own paren and is still read.
- Tests: tsc clean; c92-script-base + c83-registry-columns: 20/20 pass (existing real-loader tests included).
