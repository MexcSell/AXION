/**
 * Phase A, A1 fixtures: the run trajectory record (R6-3 first slice). COMMITTED BEFORE the schema, the recorder, the chain, the replay verifier,
 * the redaction or the routes exist. Nothing executes and no model is called: every "run" below is a script for a fake executor.
 *
 * Every expectation was worked out BY HAND from these rules, never computed by the code under test:
 *
 *  POLICY DECISIONS (what replay must reproduce). Per step, two independent decisions are recorded:
 *    profile: for tool browse (args.url, optional args.redirects), read_file / write_file (args.path) the c94 request decider answers allow or a reason
 *             code; any other tool has no request, so the profile decision is null (not applicable). A run with no execution profile denies every
 *             browse / read_file / write_file with the reason `no_profile` (deny by default).
 *    caps:    the c95 checker answers continue or a stop reason. The estimate of a step is est (money, tokens); once a step has run, its outcome
 *             counts its actual cost, or, where the actual cost is unknown (null), its estimate. A caps stop ENDS the run (that stop is the last step recorded).
 *    A step is EXECUTED only when the profile decision is allow-or-null AND caps say continue. A denied step is recorded and the run goes on.
 *
 *  COST. The cost of a run is over its EXECUTED steps only (a step that did not run costs nothing and needs no cost data).
 *    - at least one executed step and every executed step has a cost (zero is a known cost): status "known", micros = their sum;
 *    - no executed step: "unknown" (there is no cost data), micros null;
 *    - any executed step without a cost: "unknown", micros null, never a partial sum shown as the total. The sum of the known costs is kept apart as a
 *      labelled lower bound, with the number of executed steps that lack a cost.
 *    Tokens follow the same rule (sum when every executed step has them, otherwise null).
 *
 *  CLAIM. finalClaim is success | failure | none. A success claim is "verified" only when an environment-state record exists, belongs to this run, was
 *    taken no earlier than the run started, has two 64-hex states and they are equal. Any other success claim is "claimed, not verified", with the reason:
 *    no_record | not_this_run | before_run | malformed | state_differs. A claim of failure or none claims nothing.
 *
 *  CHAIN. step hash = sha256(canonical({v:1, tenantId, runId, prev, step})). prev of step 1 is 64 zeros. The run keeps head (hash of the last step), its
 *    step count and a run digest over its own fields; the audit log row `run.trajectory.recorded` anchors head, run digest and count. First fault found wins,
 *    in this order: seq, prev link, step hash (walking the steps), step count, head, run digest, anchor.
 */
import { goodProfile } from '../fixtures/exec-profile-good.ts';

export type ProfileExpect = string | null; // 'allowed' | a decider reason | null (no request)
export interface FStep {
  tool: string;
  args: Record<string, unknown>;
  /** estimated (money micros, tokens); default [0, 0] */
  est?: [number, number];
  /** the tool reported success; default true. Only used when the step runs */
  ok?: boolean;
  /** actual tool cost in micros when the step runs: a number, or null when the executor reported none */
  cost?: number | null;
  /** model tokens used by the step when it runs, or null */
  tokens?: number | null;
  /** ms after the run started; default (i - 1) * 1000 */
  at?: number;
  halted?: boolean;
  /** [held token, current token]; default [1, 1] */
  fencing?: [number, number];
  approvalId?: string;
  credentialHandleId?: string;
  expect: { profile: ProfileExpect; caps: string; executed: boolean };
}
export interface CostExpect { status: 'known' | 'unknown'; micros: number | null; lowerBound: number; missing: number }
export interface TrajFixture {
  id: string;
  why: string;
  profile: boolean;
  caps: { maxSteps?: number; maxWallMs?: number; maxToolCallsPerMinute?: number; maxDistinctOrigins?: number; reservedMoneyMicros?: number; reservedTokens?: number } | null;
  stage: 0 | 1 | 2 | 3;
  breaker: number;
  steps: FStep[];
  claim: 'success' | 'failure' | 'none';
  env: 'match' | null;
  expect: { steps: number; executed: number; cost: CostExpect; tokens: number | null; label: 'verified' | 'claimed_not_verified' | 'no_success_claimed' };
}

export const RUN_START = '2026-11-25T08:00:00.000Z';
export const FIXTURE_CAPS = { maxSteps: 10, maxWallMs: 600_000, maxToolCallsPerMinute: 60, maxDistinctOrigins: 5, reservedMoneyMicros: 1_000_000, reservedTokens: 100_000 };
export const fixtureProfile = goodProfile;

const GOOD = 'https://good.com';
const API = 'https://api.example.org:8443';
const allow = (cost: number | null, tokens: number | null, extra: Partial<FStep> = {}) => ({ cost, tokens, ...extra });
const A = { profile: 'allowed', caps: 'continue', executed: true } as const;
const known = (micros: number): CostExpect => ({ status: 'known', micros, lowerBound: micros, missing: 0 });
const none: CostExpect = { status: 'unknown', micros: null, lowerBound: 0, missing: 0 };

const T = (f: Omit<TrajFixture, 'profile' | 'caps' | 'stage' | 'breaker' | 'claim' | 'env'> & Partial<Pick<TrajFixture, 'profile' | 'caps' | 'stage' | 'breaker' | 'claim' | 'env'>>): TrajFixture =>
  ({ profile: true, caps: {}, stage: 2, breaker: 3, claim: 'success', env: 'match', ...f });

/** 23 hand-written trajectories. Each step's expected decisions are written next to it. */
export const TRAJECTORIES: TrajFixture[] = [
  T({ id: 't01', why: 'one allowed browse, with an approval id and a credential handle id',
    steps: [{ tool: 'browse', args: { url: `${GOOD}/a` }, ...allow(1000, 50, { approvalId: 'APR-aaaa1111', credentialHandleId: 'cred-1' }), expect: A }],
    expect: { steps: 1, executed: 1, cost: known(1000), tokens: 50, label: 'verified' } }),
  T({ id: 't02', why: 'three allowed browses over two granted origins: cost 100 + 200 + 300 = 600, tokens 10 + 20 + 30 = 60',
    steps: [
      { tool: 'browse', args: { url: `${GOOD}/a` }, ...allow(100, 10), expect: A },
      { tool: 'browse', args: { url: `${API}/v1/items` }, ...allow(200, 20), expect: A },
      { tool: 'browse', args: { url: `${GOOD}/b?page=2` }, ...allow(300, 30), expect: A },
    ], expect: { steps: 3, executed: 3, cost: known(600), tokens: 60, label: 'verified' } }),
  T({ id: 't03', why: 'a browse to an origin that was never granted is denied and does not run: no executed step, so no cost data',
    steps: [{ tool: 'browse', args: { url: 'https://evil.test/x' }, expect: { profile: 'origin_not_granted', caps: 'continue', executed: false } }],
    expect: { steps: 1, executed: 0, cost: none, tokens: null, label: 'verified' } }),
  T({ id: 't04', why: 'a known cost of zero is zero, not unknown: a read and a write that both cost 0',
    steps: [
      { tool: 'read_file', args: { path: '/work/in/data.csv' }, ...allow(0, 0), expect: A },
      { tool: 'write_file', args: { path: '/work/out/r.txt' }, ...allow(0, 0), expect: A },
    ], expect: { steps: 2, executed: 2, cost: known(0), tokens: 0, label: 'verified' } }),
  T({ id: 't05', why: 'a credential file read is denied (path_credential_file), the next normal read runs: cost 5',
    steps: [
      { tool: 'read_file', args: { path: '/work/in/.env' }, expect: { profile: 'path_credential_file', caps: 'continue', executed: false } },
      { tool: 'read_file', args: { path: '/work/in/a.txt' }, ...allow(5, 1), expect: A },
    ], expect: { steps: 2, executed: 1, cost: known(5), tokens: 1, label: 'verified' } }),
  T({ id: 't06', why: 'a write into a read-only directory is denied (path_write_readonly), the write into the writable one runs: cost 7',
    steps: [
      { tool: 'write_file', args: { path: '/work/in/x.txt' }, expect: { profile: 'path_write_readonly', caps: 'continue', executed: false } },
      { tool: 'write_file', args: { path: '/work/out/y.txt' }, ...allow(7, 2), expect: A },
    ], expect: { steps: 2, executed: 1, cost: known(7), tokens: 2, label: 'verified' } }),
  T({ id: 't07', why: 'plain http is denied (scheme_not_https) even on a granted host',
    steps: [{ tool: 'browse', args: { url: 'http://good.com/' }, expect: { profile: 'scheme_not_https', caps: 'continue', executed: false } }],
    expect: { steps: 1, executed: 0, cost: none, tokens: null, label: 'verified' } }),
  T({ id: 't08', why: 'an IP literal is denied (ip_literal_denied); a granted browse after it runs: cost 1',
    steps: [
      { tool: 'browse', args: { url: 'https://10.0.0.1/' }, expect: { profile: 'ip_literal_denied', caps: 'continue', executed: false } },
      { tool: 'browse', args: { url: `${GOOD}/` }, ...allow(1, 1), expect: A },
    ], expect: { steps: 2, executed: 1, cost: known(1), tokens: 1, label: 'verified' } }),
  T({ id: 't09', why: 'maxSteps 2: steps 1 and 2 run, the third proposal is stopped (step_budget) and the run ends. Cost 1 + 1 = 2',
    caps: { maxSteps: 2 },
    steps: [
      { tool: 'browse', args: { url: `${GOOD}/1` }, ...allow(1, 1), expect: A },
      { tool: 'browse', args: { url: `${GOOD}/2` }, ...allow(1, 1), expect: A },
      { tool: 'browse', args: { url: `${GOOD}/3` }, expect: { profile: 'allowed', caps: 'step_budget', executed: false } },
    ], claim: 'failure', env: null, expect: { steps: 3, executed: 2, cost: known(2), tokens: 2, label: 'no_success_claimed' } }),
  T({ id: 't10', why: 'a halt seen before step 2: step 1 runs (cost 3), step 2 is stopped (halted) and the run ends',
    steps: [
      { tool: 'browse', args: { url: `${GOOD}/1` }, ...allow(3, 1), expect: A },
      { tool: 'browse', args: { url: `${GOOD}/2` }, halted: true, expect: { profile: 'allowed', caps: 'halted', executed: false } },
    ], claim: 'none', env: null, expect: { steps: 2, executed: 1, cost: known(3), tokens: 1, label: 'no_success_claimed' } }),
  T({ id: 't11', why: 'class breaker of 2: two failed steps in a row, the third proposal is stopped (circuit_breaker). Both failed steps ran: cost 1 + 1',
    breaker: 2,
    steps: [
      { tool: 'browse', args: { url: `${GOOD}/1` }, ok: false, ...allow(1, 1), expect: A },
      { tool: 'browse', args: { url: `${GOOD}/2` }, ok: false, ...allow(1, 1), expect: A },
      { tool: 'browse', args: { url: `${GOOD}/3` }, expect: { profile: 'allowed', caps: 'circuit_breaker', executed: false } },
    ], claim: 'failure', env: null, expect: { steps: 3, executed: 2, cost: known(2), tokens: 2, label: 'no_success_claimed' } }),
  T({ id: 't12', why: 'two calls a minute: calls at 0, 100 and 200 ms; the third is stopped (rate_limit)',
    caps: { maxToolCallsPerMinute: 2 },
    steps: [
      { tool: 'browse', args: { url: `${GOOD}/1` }, at: 0, ...allow(1, 1), expect: A },
      { tool: 'browse', args: { url: `${GOOD}/2` }, at: 100, ...allow(1, 1), expect: A },
      { tool: 'browse', args: { url: `${GOOD}/3` }, at: 200, expect: { profile: 'allowed', caps: 'rate_limit', executed: false } },
    ], claim: 'failure', env: null, expect: { steps: 3, executed: 2, cost: known(2), tokens: 2, label: 'no_success_claimed' } }),
  T({ id: 't13', why: 'one distinct origin allowed: the second granted origin is stopped (origin_budget) although the profile allows it',
    caps: { maxDistinctOrigins: 1 },
    steps: [
      { tool: 'browse', args: { url: `${GOOD}/1` }, ...allow(1, 1), expect: A },
      { tool: 'browse', args: { url: `${API}/v1` }, expect: { profile: 'allowed', caps: 'origin_budget', executed: false } },
    ], claim: 'failure', env: null, expect: { steps: 2, executed: 1, cost: known(1), tokens: 1, label: 'no_success_claimed' } }),
  T({ id: 't14', why: 'money reserve 1000: a step estimated at 600 runs (600 used), the next estimated at 600 would make 1200 > 1000 and is stopped (money_reserve)',
    caps: { reservedMoneyMicros: 1000 },
    steps: [
      { tool: 'browse', args: { url: `${GOOD}/1` }, est: [600, 0], ...allow(600, 1), expect: A },
      { tool: 'browse', args: { url: `${GOOD}/2` }, est: [600, 0], expect: { profile: 'allowed', caps: 'money_reserve', executed: false } },
    ], claim: 'failure', env: null, expect: { steps: 2, executed: 1, cost: known(600), tokens: 1, label: 'no_success_claimed' } }),
  T({ id: 't15', why: 'token reserve 100: a step with 60 tokens runs, the next estimated at 60 (60 + 60 > 100) is stopped (token_reserve)',
    caps: { reservedTokens: 100 },
    steps: [
      { tool: 'browse', args: { url: `${GOOD}/1` }, est: [0, 60], ...allow(2, 60), expect: A },
      { tool: 'browse', args: { url: `${GOOD}/2` }, est: [0, 60], expect: { profile: 'allowed', caps: 'token_reserve', executed: false } },
    ], claim: 'failure', env: null, expect: { steps: 2, executed: 1, cost: known(2), tokens: 60, label: 'no_success_claimed' } }),
  T({ id: 't16', why: 'wall time 1500 ms: steps at 0 and 1000 ms run, the step at 2000 ms (2000 >= 1500 elapsed) is stopped (wall_time)',
    caps: { maxWallMs: 1500 },
    steps: [
      { tool: 'browse', args: { url: `${GOOD}/1` }, at: 0, ...allow(1, 1), expect: A },
      { tool: 'browse', args: { url: `${GOOD}/2` }, at: 1000, ...allow(1, 1), expect: A },
      { tool: 'browse', args: { url: `${GOOD}/3` }, at: 2000, expect: { profile: 'allowed', caps: 'wall_time', executed: false } },
    ], claim: 'failure', env: null, expect: { steps: 3, executed: 2, cost: known(2), tokens: 2, label: 'no_success_claimed' } }),
  T({ id: 't17', why: 'a step with token 1 while the lease is at token 2 is stale (stale_fencing_token) and the run ends',
    steps: [{ tool: 'browse', args: { url: `${GOOD}/1` }, fencing: [1, 2], expect: { profile: 'allowed', caps: 'stale_fencing_token', executed: false } }],
    claim: 'none', env: null, expect: { steps: 1, executed: 0, cost: none, tokens: null, label: 'no_success_claimed' } }),
  T({ id: 't18', why: 'a tool with no request (note) has no profile decision (null) and runs at a known cost of 0',
    steps: [{ tool: 'note', args: { text: 'remember the page title' }, ...allow(0, 3), expect: { profile: null, caps: 'continue', executed: true } }],
    expect: { steps: 1, executed: 1, cost: known(0), tokens: 3, label: 'verified' } }),
  T({ id: 't19', why: 'one executed step with no cost data: the run cost is unknown (never the partial sum 100); lower bound 100, one step missing; tokens unknown too',
    steps: [
      { tool: 'browse', args: { url: `${GOOD}/1` }, ...allow(100, 10), expect: A },
      { tool: 'browse', args: { url: `${GOOD}/2` }, ...allow(null, null), expect: A },
    ], expect: { steps: 2, executed: 2, cost: { status: 'unknown', micros: null, lowerBound: 100, missing: 1 }, tokens: null, label: 'verified' } }),
  T({ id: 't20', why: 'a granted page that redirects to the metadata address is denied (redirect_internal); a later read runs: cost 2',
    steps: [
      { tool: 'browse', args: { url: `${GOOD}/p`, redirects: ['https://169.254.169.254/latest/meta-data'] }, expect: { profile: 'redirect_internal', caps: 'continue', executed: false } },
      { tool: 'read_file', args: { path: '/usr/share/data/x.txt' }, ...allow(2, 1), expect: A },
    ], expect: { steps: 2, executed: 1, cost: known(2), tokens: 1, label: 'verified' } }),
  T({ id: 't21', why: 'stage 2 without caps: the first proposal is stopped (caps_missing) and the run ends',
    caps: null, stage: 2,
    steps: [{ tool: 'browse', args: { url: `${GOOD}/1` }, expect: { profile: 'allowed', caps: 'caps_missing', executed: false } }],
    claim: 'none', env: null, expect: { steps: 1, executed: 0, cost: none, tokens: null, label: 'no_success_claimed' } }),
  T({ id: 't22', why: 'stage 1 without caps may continue (only halt, token and breaker apply): cost 4',
    caps: null, stage: 1,
    steps: [{ tool: 'browse', args: { url: `${GOOD}/1` }, ...allow(4, 1), expect: A }],
    expect: { steps: 1, executed: 1, cost: known(4), tokens: 1, label: 'verified' } }),
  T({ id: 't23', why: 'no execution profile: every browse, read and write is denied (no_profile); only the note tool runs (cost 0)',
    profile: false,
    steps: [
      { tool: 'browse', args: { url: `${GOOD}/1` }, expect: { profile: 'no_profile', caps: 'continue', executed: false } },
      { tool: 'read_file', args: { path: '/work/in/a.txt' }, expect: { profile: 'no_profile', caps: 'continue', executed: false } },
      { tool: 'note', args: { text: 'blocked' }, ...allow(0, 0), expect: { profile: null, caps: 'continue', executed: true } },
    ], expect: { steps: 3, executed: 1, cost: known(0), tokens: 0, label: 'verified' } }),
];

// ---- the cost rule on its own (executed steps only) -----------------------------------------------------------------------------------------
export interface CostCase { id: string; steps: { executed: boolean; cost: number | null; tokens: number | null }[]; expect: CostExpect; tokens: number | null }
const x = (cost: number | null, tokens: number | null = 1) => ({ executed: true, cost, tokens });
const d = { executed: false, cost: null, tokens: null };
export const COST_CASES: CostCase[] = [
  { id: 'empty run', steps: [], expect: none, tokens: null },
  { id: 'only a denied step', steps: [d], expect: none, tokens: null },
  { id: 'known zero', steps: [x(0, 0)], expect: known(0), tokens: 0 },
  { id: 'three zeros', steps: [x(0, 0), x(0, 0), x(0, 0)], expect: known(0), tokens: 0 },
  { id: 'sum', steps: [x(100, 5), x(200, 6)], expect: known(300), tokens: 11 },
  { id: 'denied steps add nothing and need nothing', steps: [x(100, 5), d, x(250, 5), d], expect: known(350), tokens: 10 },
  { id: 'one unknown', steps: [x(null, null)], expect: { status: 'unknown', micros: null, lowerBound: 0, missing: 1 }, tokens: null },
  { id: 'known then unknown', steps: [x(100), x(null)], expect: { status: 'unknown', micros: null, lowerBound: 100, missing: 1 }, tokens: 2 },
  { id: 'unknown then known', steps: [x(null), x(40)], expect: { status: 'unknown', micros: null, lowerBound: 40, missing: 1 }, tokens: 2 },
  { id: 'two unknown, one known', steps: [x(null), x(7), x(null)], expect: { status: 'unknown', micros: null, lowerBound: 7, missing: 2 }, tokens: 3 },
  { id: 'unknown tokens only', steps: [x(5, null), x(6, 2)], expect: known(11), tokens: null },
  { id: 'large known sum', steps: [x(9_000_000_000, 1), x(1, 1)], expect: known(9_000_000_001), tokens: 2 },
];

// ---- claimed success without an environment-state record -----------------------------------------------------------------------------------
export interface ClaimCase { id: string; claim: 'success' | 'failure' | 'none'; steps: number; env: unknown; expect: { label: 'verified' | 'claimed_not_verified' | 'no_success_claimed'; reason: string | null } }
const S1 = 'a'.repeat(64);
const S2 = 'b'.repeat(64);
/** RUN is replaced by the run id and START / END by the run's own times when the case is built */
const rec = (o: Record<string, unknown> = {}) => ({ runId: 'RUN', checkedAt: 'END', expectedState: S1, observedState: S1, ...o });
export const CLAIM_CASES: ClaimCase[] = [
  // the ten that must all be flagged "claimed, not verified"
  { id: 'c01 no record at all', claim: 'success', steps: 2, env: null, expect: { label: 'claimed_not_verified', reason: 'no_record' } },
  { id: 'c02 no record, run has no steps', claim: 'success', steps: 0, env: null, expect: { label: 'claimed_not_verified', reason: 'no_record' } },
  { id: 'c03 record belongs to another run', claim: 'success', steps: 1, env: rec({ runId: 'RUN-OTHER' }), expect: { label: 'claimed_not_verified', reason: 'not_this_run' } },
  { id: 'c04 record taken before the run started', claim: 'success', steps: 1, env: rec({ checkedAt: '2026-11-25T07:59:59.999Z' }), expect: { label: 'claimed_not_verified', reason: 'before_run' } },
  { id: 'c05 observed state is not a hash', claim: 'success', steps: 1, env: rec({ observedState: 'looks fine' }), expect: { label: 'claimed_not_verified', reason: 'malformed' } },
  { id: 'c06 expected state missing', claim: 'success', steps: 1, env: { runId: 'RUN', checkedAt: 'END', observedState: S1 }, expect: { label: 'claimed_not_verified', reason: 'malformed' } },
  { id: 'c07 empty record', claim: 'success', steps: 1, env: {}, expect: { label: 'claimed_not_verified', reason: 'malformed' } },
  { id: 'c08 check time is not a time', claim: 'success', steps: 1, env: rec({ checkedAt: 'yesterday' }), expect: { label: 'claimed_not_verified', reason: 'malformed' } },
  { id: 'c09 the states differ by one character', claim: 'success', steps: 2, env: rec({ observedState: S1.slice(0, 63) + 'c' }), expect: { label: 'claimed_not_verified', reason: 'state_differs' } },
  { id: 'c10 the observed state is another hash', claim: 'success', steps: 2, env: rec({ observedState: S2 }), expect: { label: 'claimed_not_verified', reason: 'state_differs' } },
  // controls (not part of the ten)
  { id: 'k01 matching record is verified', claim: 'success', steps: 2, env: rec(), expect: { label: 'verified', reason: null } },
  { id: 'k02 matching record taken exactly at the start is verified', claim: 'success', steps: 1, env: rec({ checkedAt: 'START' }), expect: { label: 'verified', reason: null } },
  { id: 'k03 a failure claim claims nothing', claim: 'failure', steps: 1, env: null, expect: { label: 'no_success_claimed', reason: null } },
  { id: 'k04 no claim claims nothing', claim: 'none', steps: 1, env: null, expect: { label: 'no_success_claimed', reason: null } },
];

// ---- redaction -----------------------------------------------------------------------------------------------------------------------------
export interface RedactionCase { id: string; args: Record<string, unknown>; /** none of these may appear anywhere in the stored arguments */ secrets: string[]; /** each of these must still be there */ keep?: string[]; piiFields?: string[] }
export const REDACTION_CASES: RedactionCase[] = [
  { id: 'password key', args: { user: 'ann', password: 'hunter2-Zk9' }, secrets: ['hunter2-Zk9'], keep: ['ann'] },
  { id: 'api_key key', args: { api_key: 'AbCdEf0123456789xyz', q: 'tea' }, secrets: ['AbCdEf0123456789xyz'], keep: ['tea'] },
  { id: 'apiKey and token keys, nested in a list', args: { calls: [{ apiKey: 'k-live-9f8e7d6c5b4a', n: 1 }, { accessToken: 'tok_8a7b6c5d4e3f2a1b', n: 2 }] }, secrets: ['k-live-9f8e7d6c5b4a', 'tok_8a7b6c5d4e3f2a1b'] },
  { id: 'Authorization header with a bearer token', args: { headers: { Authorization: 'Bearer abcDEF123456.ghiJKL789', Accept: 'text/html' } }, secrets: ['abcDEF123456.ghiJKL789'], keep: ['text/html'] },
  { id: 'bearer token inside free text', args: { note: 'sent header Authorization: Bearer q1w2e3r4t5y6u7i8o9p0 to the server' }, secrets: ['q1w2e3r4t5y6u7i8o9p0'], keep: ['sent header'] },
  { id: 'basic auth header', args: { note: 'used Basic dXNlcjpwYXNzd29yZDEyMw== for login' }, secrets: ['dXNlcjpwYXNzd29yZDEyMw=='] },
  { id: 'cookie header', args: { headers: { Cookie: 'sid=s3cr3tSessionValue123; theme=dark' } }, secrets: ['s3cr3tSessionValue123'] },
  { id: 'token in the query string', args: { url: 'https://good.com/export?format=csv&token=Zm9vYmFyMTIzNDU2&page=2' }, secrets: ['Zm9vYmFyMTIzNDU2'], keep: ['https://good.com/export', 'format=csv', 'page=2'] },
  { id: 'api_key in the query string', args: { url: 'https://api.example.org:8443/v1?api_key=ZZ99yy88xx77ww66&limit=5' }, secrets: ['ZZ99yy88xx77ww66'], keep: ['limit=5'] },
  { id: 'password in the URL userinfo', args: { url: 'https://admin:Sup3rS3cret!@good.com/panel' }, secrets: ['Sup3rS3cret!'], keep: ['good.com/panel'] },
  { id: 'OpenAI style key', args: { note: 'key is sk-proj-AbCdEfGhIjKlMnOpQrStUvWx1234' }, secrets: ['sk-proj-AbCdEfGhIjKlMnOpQrStUvWx1234'] },
  { id: 'Anthropic style key', args: { note: 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv_wxyz-0123456789' }, secrets: ['sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv_wxyz-0123456789'] },
  { id: 'GitHub token', args: { cmd: 'git clone https://x:ghp_1234567890abcdefghijklmnopqrstuvwxyz12@github.test/r.git' }, secrets: ['ghp_1234567890abcdefghijklmnopqrstuvwxyz12'] },
  { id: 'AWS access key id and secret assignment', args: { env: 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' }, secrets: ['AKIAIOSFODNN7EXAMPLE', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'] },
  { id: 'JWT', args: { note: 'session eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV' }, secrets: ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV'] },
  { id: 'PEM private key', args: { file: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAx9yq\nabcdefghijkl\n-----END RSA PRIVATE KEY-----' }, secrets: ['MIIEowIBAAKCAQEAx9yq', 'abcdefghijkl'] },
  { id: 'Slack token', args: { note: ('xo' + 'xb-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx') }, secrets: [('xo' + 'xb-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx')] },
  { id: 'password=value in text', args: { note: 'login with password=Tr0ub4dor&3 then continue' }, secrets: ['Tr0ub4dor&3'], keep: ['login with', 'then continue'] },
  { id: 'a bare high-entropy secret as the whole value', args: { value: 'Xk39Fj28Qp71Lm04Zr56Vb92Nc13Hd87' }, secrets: ['Xk39Fj28Qp71Lm04Zr56Vb92Nc13Hd87'] },
  { id: 'email address (personal data)', args: { to: 'ann.example@mail.test', subject: 'hello' }, secrets: ['ann.example@mail.test'], keep: ['hello'] },
  { id: 'card number with spaces (Luhn valid)', args: { note: 'paid with 4111 1111 1111 1111 today' }, secrets: ['4111 1111 1111 1111', '4111111111111111'], keep: ['paid with', 'today'] },
  { id: 'IBAN', args: { note: 'transfer to DE89370400440532013000 please' }, secrets: ['DE89370400440532013000'] },
  { id: 'US social security number', args: { note: 'ssn 078-05-1120 on file' }, secrets: ['078-05-1120'] },
  { id: 'international phone number', args: { note: 'call +49 170 1234567 after noon' }, secrets: ['+49 170 1234567', '1234567'] },
  { id: 'personal-data field names', args: { email: 'b@c.test', phone: '0301234567', first_name: 'Ann', dob: '1990-02-03', address: '1 Main Street' }, secrets: ['b@c.test', '0301234567', 'Ann', '1990-02-03', '1 Main Street'] },
  { id: 'a field the caller flagged as personal', args: { patientNote: 'left knee pain since March', page: 3 }, piiFields: ['patientNote'], secrets: ['left knee pain since March'], keep: ['3'] },
  { id: 'nothing to hide: ordinary arguments stay intact', args: { url: 'https://good.com/path?q=tea&page=2', path: '/work/in/data.csv', n: 5, flag: true, list: ['a', 'b'] }, secrets: [], keep: ['https://good.com/path?q=tea&page=2', '/work/in/data.csv', 'flag', '"a"', '"b"'] },
];

// ---- tamper -------------------------------------------------------------------------------------------------------------------------------
/** The mutable view the tests give a tamper: rows exactly as the verifier reads them (camelCase), the run row and the anchor. */
export interface TamperView {
  run: Record<string, any>;
  steps: Record<string, any>[];
  anchor: { head: string; runDigest: string; steps: number } | null;
  /** recompute step i's own hash from its content and its prev, and store it */
  rehash(i: number): void;
  /** re-link and re-hash steps from index i to the end (prev from the step before), and set run.headHash to the new last hash */
  rechainFrom(i: number): void;
  /** recompute the run digest from the run row as it stands and store it in run.runDigest */
  redigest(): void;
}
export interface TamperCase { id: string; why: string; mutate(v: TamperView): void; expect: { ok: false; status: 'broken' | 'unanchored'; reason: string; firstBadSeq: number | null } }
/** The base is trajectory t02: 3 executed steps, seq 1..3. */
export const TAMPER_BASE = 't02';
export const TAMPERS: TamperCase[] = [
  { id: 'k01', why: 'arguments of step 2 edited, hash left alone', mutate: (v) => { v.steps[1].args = { url: 'https://good.com/edited' }; }, expect: { ok: false, status: 'broken', reason: 'step_hash_mismatch', firstBadSeq: 2 } },
  { id: 'k02', why: 'the recorded policy decision of step 3 flipped, hash left alone', mutate: (v) => { v.steps[2].decision = { profile: { allowed: false, reason: 'origin_not_granted' }, caps: { action: 'continue', reason: null } }; }, expect: { ok: false, status: 'broken', reason: 'step_hash_mismatch', firstBadSeq: 3 } },
  { id: 'k03', why: 'the tool cost of step 1 lowered, hash left alone', mutate: (v) => { v.steps[0].toolCostMicros = 1; }, expect: { ok: false, status: 'broken', reason: 'step_hash_mismatch', firstBadSeq: 1 } },
  { id: 'k04', why: 'step 2 edited and its own hash recomputed, nothing after it touched: the link at step 3 breaks', mutate: (v) => { v.steps[1].toolCostMicros = 5; v.rehash(1); }, expect: { ok: false, status: 'broken', reason: 'prev_hash_mismatch', firstBadSeq: 3 } },
  { id: 'k05', why: 'the LAST step edited and re-hashed: the chain is consistent, but the run head no longer matches', mutate: (v) => { v.steps[2].toolCostMicros = 5; v.rehash(2); }, expect: { ok: false, status: 'broken', reason: 'head_mismatch', firstBadSeq: 3 } },
  { id: 'k06', why: 'step 2 deleted', mutate: (v) => { v.steps.splice(1, 1); }, expect: { ok: false, status: 'broken', reason: 'seq_gap', firstBadSeq: 2 } },
  { id: 'k07', why: 'the contents of steps 2 and 3 swapped, seq numbers and hashes kept in place', mutate: (v) => { const a = v.steps[1], b = v.steps[2]; for (const k of ['tool', 'args', 'toolCostMicros', 'tokens', 'resultHash']) { const t = a[k]; a[k] = b[k]; b[k] = t; } }, expect: { ok: false, status: 'broken', reason: 'step_hash_mismatch', firstBadSeq: 2 } },
  { id: 'k08', why: 'the last step removed (tail truncation): what is left is a valid chain, but the run says 3 steps', mutate: (v) => { v.steps.pop(); }, expect: { ok: false, status: 'broken', reason: 'step_count_mismatch', firstBadSeq: 3 } },
  { id: 'k09', why: 'a forged step 4 appended with a perfectly valid link and hash', mutate: (v) => { v.steps.push({ ...v.steps[2], seq: 4, toolCostMicros: 99999 }); v.rechainFrom(3); v.run.headHash = v.steps[3].stepHash; }, expect: { ok: false, status: 'broken', reason: 'step_count_mismatch', firstBadSeq: 4 } },
  { id: 'k10', why: 'the chain from step 2 rewritten and re-hashed, and the run head and run digest updated to match: only the audit anchor still holds the original', mutate: (v) => { v.steps[1].args = { url: 'https://good.com/rewritten' }; v.rechainFrom(1); v.redigest(); }, expect: { ok: false, status: 'broken', reason: 'anchor_mismatch', firstBadSeq: null } },
  { id: 'k11', why: 'the final claim in the run row changed from success to failure, run digest left alone', mutate: (v) => { v.run.finalClaim = 'failure'; }, expect: { ok: false, status: 'broken', reason: 'run_digest_mismatch', firstBadSeq: null } },
  { id: 'k12', why: 'the prev link of step 1 replaced', mutate: (v) => { v.steps[0].prevHash = 'f'.repeat(64); }, expect: { ok: false, status: 'broken', reason: 'prev_hash_mismatch', firstBadSeq: 1 } },
  { id: 'k13', why: 'the environment-state record removed from the run row and the run digest recomputed: only the anchor catches it', mutate: (v) => { v.run.envCheck = null; v.redigest(); }, expect: { ok: false, status: 'broken', reason: 'anchor_mismatch', firstBadSeq: null } },
  { id: 'k14', why: 'the audit anchor of the run is gone: the chain is internally fine but nothing pins it', mutate: (v) => { v.anchor = null; }, expect: { ok: false, status: 'unanchored', reason: 'anchor_missing', firstBadSeq: null } },
  { id: 'k15', why: 'the anchor says 4 steps (a longer run was anchored), the table has 3', mutate: (v) => { v.anchor = { ...v.anchor!, steps: 4 }; }, expect: { ok: false, status: 'broken', reason: 'anchor_mismatch', firstBadSeq: null } },
];

export const THRESHOLDS_A1 = {
  /** (a) replay reproduces every recorded policy decision */
  trajectories: 20,
  /** (a) each of these tamper fixtures is detected */
  tamper: 10,
  /** (b) per-run cost equals the sum of step costs, or is shown as unknown */
  costCases: 10,
  /** (c) flagged "claimed, not verified" */
  claimedNotVerified: 10,
  /** (d) no secret or flagged personal data in stored arguments */
  redaction: 20,
} as const;
