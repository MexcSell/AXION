import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateExecProfile } from '../src/exec-profile/validator.ts';
import { decideRequests } from '../src/exec-profile/decider.ts';
import { execProfileSha256 } from '../src/exec-profile/hash.ts';
import { checkRunStep, newRunCounters } from '../src/jobs/run-caps.ts';
import { digestV3 } from '../src/approvals/service.ts';
import { RUN_CAP_FIELDS, stageNeedsCaps, type RunCaps } from '../../shared/contracts/src/index.ts';
import type { ExecProfile } from '../../shared/contracts/src/exec-profile.ts';

/** Phase A, O1 material for the owner: the execution profile and caps for ONE read-only browsing class. Nothing uses them before the owner decides O1. */
const DOCS = join(import.meta.dirname, '..', '..', 'web', 'docs', 'improve');
const profile = JSON.parse(readFileSync(join(DOCS, 'phaseA-O1-profile.json'), 'utf8')) as ExecProfile;
const capsFile = JSON.parse(readFileSync(join(DOCS, 'phaseA-O1-caps.json'), 'utf8')) as { taskClass: string; stage: 0 | 1 | 2 | 3; maxConsecutiveFailures: number; caps: RunCaps };
const doc = readFileSync(join(DOCS, 'phaseA-O1-profile.md'), 'utf8');

describe('the O1 profile file', () => {
  it('passes the c94 validator and its hash is the one printed in the owner\'s page', () => {
    const v = validateExecProfile(profile);
    expect(v.ok, v.ok ? '' : JSON.stringify(v.refusals)).toBe(true);
    expect(doc).toContain(execProfileSha256(profile));
  });
  it('is deny by default, names no origin (the owner lists them), is the class the page says, and cannot use the weakest tier for untrusted content', () => {
    expect(profile.network.default).toBe('deny');
    expect(profile.network.allowedOrigins).toEqual([]);
    expect(profile.untrustedContent).toBe(true);
    expect(profile.tier).not.toBe('process');
    expect(profile.taskClass).toBe(capsFile.taskClass);
  });
  it('a request to any origin is refused until the owner adds one; with one granted origin only that origin is allowed', () => {
    const none = decideRequests(profile, { urls: [{ url: 'https://news.example.org/a' }] });
    expect(none.allowed).toBe(false);
    expect(none.items[0].reason).toBe('origin_not_granted');
    const granted = { ...profile, network: { ...profile.network, allowedOrigins: ['https://news.example.org'] } };
    expect(decideRequests(granted, { urls: [{ url: 'https://news.example.org/a?page=2' }] }).allowed).toBe(true);
    for (const url of ['https://other.example.org/', 'http://news.example.org/', 'https://10.0.0.1/', 'https://169.254.169.254/latest/meta-data', 'https://news.example.org.evil.com/']) expect(decideRequests(granted, { urls: [{ url }] }).allowed, url).toBe(false);
    expect(decideRequests(granted, { urls: [{ url: 'https://news.example.org/a', redirects: ['https://169.254.169.254/'] }] }).allowed).toBe(false);
  });
  it('allows no write outside its scratch directory, no write to the read-only input, and no credential file', () => {
    const p = (path: string, access: 'read' | 'write') => decideRequests(profile, { paths: [{ path, access }] });
    expect(p('/work/scratch/page.html', 'write').allowed).toBe(true);
    expect(p('/work/in/list.txt', 'read').allowed).toBe(true);
    for (const [path, access] of [['/work/in/list.txt', 'write'], ['/etc/passwd', 'read'], ['/work/out/x', 'write'], ['/work/scratch/.env', 'read'], ['/work/in/key.pem', 'read'], ['/work/scratch/../../etc/passwd', 'read'], ['/work/in/.ssh/id_rsa', 'read']] as const) expect(p(path, access).allowed, path).toBe(false);
  });
});

describe('the O1 caps file', () => {
  it('has all six caps as non-negative integers and a stage and breaker the checker accepts', () => {
    for (const f of RUN_CAP_FIELDS) expect(Number.isSafeInteger(capsFile.caps[f]) && capsFile.caps[f] >= 0, f).toBe(true);
    expect(Object.keys(capsFile.caps).sort()).toEqual([...RUN_CAP_FIELDS].sort());
    expect(capsFile.maxConsecutiveFailures).toBeGreaterThanOrEqual(1);
    const d = checkRunStep({ caps: capsFile.caps, breaker: { taskClass: capsFile.taskClass, stage: capsFile.stage, maxConsecutiveFailures: capsFile.maxConsecutiveFailures }, counters: newRunCounters(0), step: { tool: 'browse', origin: 'https://news.example.org', atMs: 0, estMoneyMicros: 0, estTokens: 0, fencingToken: 1 }, halt: { halted: false }, currentFencingToken: 1 });
    expect(d.action).toBe('continue');
    expect(stageNeedsCaps(capsFile.stage) || capsFile.stage <= 1).toBe(true);
  });
  it('stops at the step cap and spends nothing: any estimated money or tokens is refused (the model budget is owner decision O3, not set here)', () => {
    const br = { taskClass: capsFile.taskClass, stage: capsFile.stage, maxConsecutiveFailures: capsFile.maxConsecutiveFailures };
    const step = (o: object) => ({ tool: 'browse', origin: 'https://a.example.org', atMs: 0, estMoneyMicros: 0, estTokens: 0, fencingToken: 1, ...o });
    const at = { ...newRunCounters(0), steps: capsFile.caps.maxSteps };
    expect(checkRunStep({ caps: capsFile.caps, breaker: br, counters: at, step: step({}), halt: { halted: false }, currentFencingToken: 1 })).toMatchObject({ action: 'stop', reason: 'step_budget' });
    expect(checkRunStep({ caps: capsFile.caps, breaker: br, counters: newRunCounters(0), step: step({ estMoneyMicros: 1 }), halt: { halted: false }, currentFencingToken: 1 })).toMatchObject({ action: 'stop', reason: 'money_reserve' });
    expect(checkRunStep({ caps: capsFile.caps, breaker: br, counters: newRunCounters(0), step: step({ estTokens: 1 }), halt: { halted: false }, currentFencingToken: 1 })).toMatchObject({ action: 'stop', reason: 'token_reserve' });
  });
  it('under digest v3 the profile hash and these caps are bound: changing either makes an approval stale', () => {
    const a = { tenantId: 't', missionId: 'M-1', kind: 'browse', payload: {}, tier: 'R2' as const, requestedBy: 'u', expiresAt: '2026-11-25T10:00:00.000Z', execProfileSha256: execProfileSha256(profile), runCaps: capsFile.caps };
    const base = digestV3(a);
    expect(digestV3({ ...a, runCaps: { ...capsFile.caps, maxSteps: capsFile.caps.maxSteps + 1 } })).not.toBe(base);
    expect(digestV3({ ...a, execProfileSha256: execProfileSha256({ ...profile, limits: { ...profile.limits, pids: 257 } }) })).not.toBe(base);
  });
});

describe('the owner\'s page', () => {
  it('says what it allows, what it refuses, the caps, that nothing uses it yet, and the open decisions O1 and O1b', () => {
    for (const w of ['What it allows', 'What it refuses', 'The limits', 'Nothing uses this file', 'O1', 'O1b', String(capsFile.caps.maxSteps), String(profile.limits.memoryMb)]) expect(doc, w).toContain(w);
    expect(doc).toMatch(/origins? you (have )?already granted|Site Grants/i);
  });
});
