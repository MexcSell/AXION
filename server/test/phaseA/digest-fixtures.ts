/**
 * Phase A, A3 fixtures: approval digest v3 (v2's bound action + the execution profile hash (c94) + the run caps (c95)). COMMITTED BEFORE any
 * v3 code exists. Nothing executes. Three kinds of fixture:
 *
 *  1. GOLDEN v1 and v2 digests. The hex values below were captured from the code as it was BEFORE this phase (server/src/approvals/service.ts at
 *     commit 81d26964). They prove "v1 and v2 rows keep verifying exactly as before": the implementation of v3 must not move a single one of them.
 *  2. A v3 SPEC. The canonical string of a v3 action is written out by hand here (keys sorted at every level, the same rule as `canonical` in
 *     service.ts), and the expected digest is the sha256 of that string, computed in THIS file and not by the code under test.
 *  3. A CHANGE MATRIX: every way the profile hash or a cap can change after approval, each of which must give a different v3 digest (the stored
 *     digest goes stale), and the two spellings that must give the SAME digest.
 *
 * Rules written down first:
 *   - v3 digest = sha256(canonical({ v: 3, tenantId, missionId, taskId|null, kind, origin|null, target|null, payload, tier, requestedBy, expiresAt,
 *                                    execProfileSha256: <64 hex>|null, runCaps: {six integer fields}|null })).
 *   - Caps are all six fields or null. A partial or non-integer cap set is refused (it would count as "no caps" in the checker), never hashed.
 *   - The profile hash is 64 lower-case hex characters or null; anything else is refused.
 *   - A v3 digest is never equal to the v2 digest of the same action (the version is inside the hash).
 *   - Version dispatch is explicit: 1, 2 and 3 only. Any other version fails closed (no digest verifies).
 */
import { createHash } from 'node:crypto';

export const GOLDEN_V1 = [
  { missionId: 'M-100001', kind: 'submit_form', payload: { url: 'https://a.example', fields: ['x', 'y'] }, digest: 'f0daf390228dd479727dc5be61c91eadd6901ad886648f193b5db3ba81618165' },
  { missionId: 'M-100002', kind: 'release', payload: {}, digest: 'b6318e1a45032a74b0fe928bca736127cf9cad2d2c30f8c11bddbac17cd455d2' },
  { missionId: 'M-100003', kind: 'send_email', payload: { to: 'a@b.test', n: 3, nested: { b: 1, a: [1, 2, { z: null }] } }, digest: 'bcfc3d18756dbe412b586210ca4a40c6f8efec43ab92482f13ff867fea4294a1' },
] as const;

const BASE = { tenantId: 't-1', missionId: 'M-100001', kind: 'submit_form', payload: { url: 'https://a.example', fields: ['x', 'y'] }, tier: 'R2' as const, requestedBy: 'coder-01', expiresAt: '2026-11-25T10:00:00.000Z' };
export const GOLDEN_V2 = [
  { action: BASE, digest: 'c509f11b76e49739d2aba6b4da9c33d775623711fb73742e60d60762570fb7f1' },
  { action: { ...BASE, taskId: 'T-9', origin: 'https://a.example', target: 'form-1', tier: 'R3' as const }, digest: '90c31ff163a08695bc86bf5cab28ad73573b6d8c93577bce212c541afb2f1a0b' },
  { action: { ...BASE, kind: 'release', payload: { b: 2, a: 1 }, tier: 'R4' as const, requestedBy: 'u-7' }, digest: '9274bb8b09bcaea79ef420aa96084033d9a164ba66fa84e206b717951d9088fe' },
] as const;

export interface CapsF { maxSteps: number; maxWallMs: number; maxToolCallsPerMinute: number; maxDistinctOrigins: number; reservedMoneyMicros: number; reservedTokens: number }
export const PROFILE_SHA = 'ab'.repeat(32);
export const CAPS: CapsF = { maxSteps: 50, maxWallMs: 600000, maxToolCallsPerMinute: 30, maxDistinctOrigins: 3, reservedMoneyMicros: 1000000, reservedTokens: 100000 };
export const V3_ACTION = { ...BASE, execProfileSha256: PROFILE_SHA as string | null, runCaps: CAPS as CapsF | null };

/** The v3 canonical string for BASE with the profile and caps above, written by hand (keys sorted at every level). */
export const V3_SPEC_STRING =
  '{"execProfileSha256":"' + PROFILE_SHA + '","expiresAt":"2026-11-25T10:00:00.000Z","kind":"submit_form","missionId":"M-100001","origin":null,'
  + '"payload":{"fields":["x","y"],"url":"https://a.example"},"requestedBy":"coder-01",'
  + '"runCaps":{"maxDistinctOrigins":3,"maxSteps":50,"maxToolCallsPerMinute":30,"maxWallMs":600000,"reservedMoneyMicros":1000000,"reservedTokens":100000},'
  + '"target":null,"taskId":null,"tenantId":"t-1","tier":"R2","v":3}';
export const V3_SPEC_DIGEST = createHash('sha256').update(V3_SPEC_STRING).digest('hex');

/** The same, with no profile and no caps bound: both are explicit nulls in the hash. */
export const V3_NULL_SPEC_STRING =
  '{"execProfileSha256":null,"expiresAt":"2026-11-25T10:00:00.000Z","kind":"submit_form","missionId":"M-100001","origin":null,'
  + '"payload":{"fields":["x","y"],"url":"https://a.example"},"requestedBy":"coder-01","runCaps":null,"target":null,"taskId":null,"tenantId":"t-1","tier":"R2","v":3}';
export const V3_NULL_SPEC_DIGEST = createHash('sha256').update(V3_NULL_SPEC_STRING).digest('hex');

export interface ChangeCase { id: string; patch: { execProfileSha256?: string | null; runCaps?: Partial<CapsF> | null }; }
const flip = (h: string) => (h[0] === 'a' ? 'b' : 'a') + h.slice(1);
/** Each of these, applied after approval, must make the digest DIFFER from V3_ACTION's (the stored digest is stale). */
export const MUST_DIFFER: ChangeCase[] = [
  { id: 'profile hash: first character', patch: { execProfileSha256: flip(PROFILE_SHA) } },
  { id: 'profile hash: last character', patch: { execProfileSha256: PROFILE_SHA.slice(0, 63) + (PROFILE_SHA.endsWith('b') ? 'c' : 'b') } },
  { id: 'profile removed (null)', patch: { execProfileSha256: null } },
  ...(['maxSteps', 'maxWallMs', 'maxToolCallsPerMinute', 'maxDistinctOrigins', 'reservedMoneyMicros', 'reservedTokens'] as const).flatMap((f) => [
    { id: `cap ${f} raised by one`, patch: { runCaps: { [f]: CAPS[f] + 1 } } },
    { id: `cap ${f} lowered by one`, patch: { runCaps: { [f]: CAPS[f] - 1 } } },
  ]),
  { id: 'caps removed (null)', patch: { runCaps: null } },
  { id: 'cap maxSteps set to zero', patch: { runCaps: { maxSteps: 0 } } },
];
/** These spellings are the SAME action: the digest must not change. */
export const MUST_MATCH: ChangeCase[] = [
  { id: 'caps given with the keys in another order', patch: { runCaps: { reservedTokens: CAPS.reservedTokens, maxSteps: CAPS.maxSteps, maxWallMs: CAPS.maxWallMs, maxDistinctOrigins: CAPS.maxDistinctOrigins, maxToolCallsPerMinute: CAPS.maxToolCallsPerMinute, reservedMoneyMicros: CAPS.reservedMoneyMicros } } },
  { id: 'nothing changed', patch: {} },
];
/** Refused (never hashed, never read as "no caps"): the writer throws, and a consumer that presents one is a digest mismatch. */
export const MUST_REFUSE: { id: string; patch: { execProfileSha256?: unknown; runCaps?: unknown } }[] = [
  { id: 'partial caps (one field missing)', patch: { runCaps: { maxSteps: 1, maxWallMs: 1, maxToolCallsPerMinute: 1, maxDistinctOrigins: 1, reservedMoneyMicros: 1 } } },
  { id: 'fractional cap', patch: { runCaps: { ...CAPS, maxSteps: 1.5 } } },
  { id: 'negative cap', patch: { runCaps: { ...CAPS, maxSteps: -1 } } },
  { id: 'NaN cap', patch: { runCaps: { ...CAPS, reservedTokens: Number.NaN } } },
  { id: 'cap as a string', patch: { runCaps: { ...CAPS, maxSteps: '50' } } },
  { id: 'unknown extra cap field', patch: { runCaps: { ...CAPS, extra: 1 } } },
  { id: 'empty caps object', patch: { runCaps: {} } },
  { id: 'profile hash too short', patch: { execProfileSha256: 'abc' } },
  { id: 'profile hash upper case', patch: { execProfileSha256: PROFILE_SHA.toUpperCase() } },
  { id: 'profile hash not a string', patch: { execProfileSha256: 12345 } },
  { id: 'profile hash empty string', patch: { execProfileSha256: '' } },
];

export const THRESHOLDS_A3 = {
  /** at least this many single changes are each detected as stale */
  minDiffer: 15,
  goldenV1: 3, goldenV2: 3,
} as const;
