// Forced-failure proof for the narrowed guards in _session.mjs: each must still fail on the defect it guards, and pass honest text.
// Run: node scripts/selftest-guards.mjs   (no browser, no server, no database)
import { isE2eDatabaseUrl, inventedNumbers, DECISION_BUTTON } from './_session.mjs';
let bad = 0;
const t = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) bad++; };
// database guard: e2e databases pass, everything else is refused
for (const u of ['postgres://u:p@h:5432/axion_e2e', 'postgres://u:p@h/axion_e2e23', 'postgres://u:p@h/axion_e2e7?sslmode=x']) t(`accepts ${u}`, isE2eDatabaseUrl(u));
for (const u of ['postgres://u:p@h/axion', 'postgres://u:p@h/axion_lane_disabled', 'postgres://u:p@h/axion_e2e_x', 'postgres://u:p@h/xaxion_e2e/axion', 'postgres://u:p@h/axion_e2e23/other', '', undefined]) t(`refuses ${u}`, !isE2eDatabaseUrl(u));
// invented numbers: the defect is a made-up figure, not the word
for (const x of ['coverage +3%', 'Applied by Bea 12 %', 'latency -12', 'tokens: 4000', 'coverage 3', 'cost 0.5%', '4000 tokens saved', '12 ms latency', '3 coverage', 'latency 12 ms', '1.5k tokens', 'answered in 3 s', '52s']) t(`flags "${x}"`, inventedNumbers(x).length > 0);
for (const x of ['Skill coverage is checked in the dry run', 'No tokens were used', 'coverage gaps: none listed', 'base rev 2 · 3 changes', 'Applied by Bea · base rev 2', 'Tokens are not measured yet', 'OP-1A2B3C4D · by Ann · 52s ago', 'Applied by Bea · 49s ago · “Agreed.”']) t(`allows "${x}"`, inventedNumbers(x).length === 0);
// decision buttons: members must see none of these
for (const x of ['Approve', 'Reject', 'Withdraw']) t(`${x} counts as a decision button`, DECISION_BUTTON.test(x));
for (const x of ['Show details', 'Approved', 'Copy id', 'Rejection reason']) t(`"${x}" is not a decision button`, !DECISION_BUTTON.test(x));
process.exit(bad ? 1 : 0);
