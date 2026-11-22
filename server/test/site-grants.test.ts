import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { loadGrants, decideOnOrigin } from '../src/grants/service.ts';
import { evaluate } from '../src/policy/index.ts';

const hostile = JSON.parse(readFileSync(new URL('./fixtures/hostile-origins.json', import.meta.url), 'utf8')) as { input: unknown; reason: string }[];
const benign = JSON.parse(readFileSync(new URL('./fixtures/benign-origins.json', import.meta.url), 'utf8')) as { input: string; origin: string }[];

let t: TestApp;
let A: Awaited<ReturnType<typeof withAdmin>>;
beforeEach(async () => { t = await makeTestApp({ staffingStepMs: 60_000, writeLimits: { proposals: { max: 10_000, windowMs: 60_000 } } }); A = await withAdmin(t.app); });
afterEach(async () => { await t.close(); });

let n = 0;
const mission = async () => (await A.admin.req('POST', '/missions', { text: 'Check the pricing page.', files: [], shared: false }, { 'idempotency-key': 'g' + Date.now() + n++ })).body.mission.id as string;
const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const grant = (b: Record<string, unknown>, key = 'k' + Date.now() + n++) => A.admin.req('POST', '/site-grants', b, { 'idempotency-key': key });
const body = (missionId: string, over: Record<string, unknown> = {}) => ({ origin: 'https://example.com', missionId, capabilities: ['read'], expiresAt: hours(2), ...over });
const agent = { id: 'research-01', kind: 'agent' as const, role: 'agent' };
const read = (origin: string, missionId: string) => ({ kind: 'read', origin, missionId, requester: agent, effect: 'read' as const, payload: {} });

describe('site grants: routes', () => {
  it('only an administrator can list, validate, issue or revoke; no session gets 401', async () => {
    const m = await mission();
    const { b } = await A.member('Mia');
    for (const [method, url, payload] of [['GET', '/site-grants'], ['GET', '/site-grants/validate?origin=https://example.com'], ['POST', '/site-grants', body(m)], ['POST', '/site-grants/SG-00000000000000000000000000000000/revoke', {}]] as const) {
      const r = await b.req(method, url, payload, { 'idempotency-key': 'm' + n++ });
      expect(r.status, url).toBe(403);
    }
    const anon = await t.app.inject({ method: 'GET', url: '/api/v1/site-grants' });
    expect(anon.statusCode).toBe(401);
  });

  it('issues a grant as an R3 action through the policy, stores the normal form, lists it, and audits the decision', async () => {
    const m = await mission();
    const r = await grant(body(m, { origin: 'HTTPS://Example.COM:443/' }));
    expect(r.status).toBe(201);
    expect(r.body.grant).toMatchObject({ origin: 'https://example.com', missionId: m, capabilities: ['read'], state: 'active', tier: 'R3', issuedByName: 'Luca' });
    expect(r.body.decision).toMatchObject({ tier: 'R3', approver: 'admin', policyVersion: 1 });
    const list = (await A.admin.req('GET', '/site-grants')).body;
    expect(list.grants.map((g: any) => g.id)).toEqual([r.body.grant.id]);
    expect(list.maxDays).toBe(30);
    const a = (await t.pool.query(`select detail, result from audit_events where action='grant.issue' and subject=$1`, [r.body.grant.id])).rows[0];
    expect(a.result).toBe('ok');
    expect(a.detail).toMatchObject({ tier: 'R3', approver: 'admin', origin: 'https://example.com' });
    expect((await t.pool.query(`select exact_origin from site_grants`)).rows).toEqual([{ exact_origin: 'https://example.com' }]);
  });

  it('refuses every hostile origin through the validate endpoint with its reason', async () => {
    let refused = 0;
    for (const h of hostile) {
      if (typeof h.input !== 'string') continue;
      const r = await A.admin.req('GET', '/site-grants/validate?origin=' + encodeURIComponent(h.input));
      expect(r.status).toBe(200);
      expect(r.body.ok, JSON.stringify(h.input)).toBe(false);
      expect(r.body.reason, JSON.stringify(h.input)).toBe(h.reason);
      expect(r.body.message.length).toBeGreaterThan(5);
      refused++;
    }
    expect(refused).toBeGreaterThanOrEqual(60);
    for (const b of benign) expect((await A.admin.req('GET', '/site-grants/validate?origin=' + encodeURIComponent(b.input))).body).toEqual({ ok: true, origin: b.origin });
  });

  it('refuses hostile origins when issuing: 422 with the reason, nothing stored, each refusal audited', async () => {
    const m = await mission();
    const sample = hostile.filter((h) => typeof h.input === 'string' && (h.input as string).length < 280);
    for (const h of sample) {
      const r = await grant(body(m, { origin: h.input }));
      expect(r.status, JSON.stringify(h.input)).toBe(422);
      expect(r.body.fieldErrors.origin.length).toBeGreaterThan(5);
    }
    expect((await t.pool.query('select count(*)::int n from site_grants')).rows[0].n).toBe(0);
    const denied = (await t.pool.query(`select detail from audit_events where action='grant.issue' and result='denied'`)).rows;
    expect(denied.length).toBe(sample.length);
    expect(denied[0].detail.reason).toBeTruthy();
  });

  it('requires an expiry, caps it at 30 days, and refuses a past expiry', async () => {
    const m = await mission();
    expect((await grant({ origin: 'https://example.com', missionId: m, capabilities: ['read'] })).status).toBe(400);
    expect((await grant(body(m, { expiresAt: 'tomorrow' }))).status).toBe(422);
    expect((await grant(body(m, { expiresAt: hours(-1) }))).body.fieldErrors.expiresAt).toMatch(/future/);
    expect((await grant(body(m, { expiresAt: hours(24 * 30 + 1) }))).body.fieldErrors.expiresAt).toMatch(/30 days/);
    expect((await grant(body(m, { expiresAt: hours(24 * 30 - 1) }))).status).toBe(201);
  });

  it('refuses unknown or risky capabilities, an unknown mission, and a duplicate active grant', async () => {
    const m = await mission();
    for (const caps of [['submit_form'], ['release'], ['read', 'origin-grant'], [], ['*']]) expect([400, 422], JSON.stringify(caps)).toContain((await grant(body(m, { capabilities: caps }))).status);
    expect((await grant(body('M-99999'))).status).toBe(422);
    expect((await grant(body(m))).status).toBe(201);
    const dup = await grant(body(m, { origin: 'https://EXAMPLE.com/' }));
    expect(dup.status).toBe(409);
    expect((await grant(body(m, { origin: 'https://example.com:8443' }))).status).toBe(201); // a different port is a different origin
  });

  it('replays the same Idempotency-Key without a second grant', async () => {
    const m = await mission();
    const b = body(m);
    expect((await grant(b, 'same')).status).toBe(201);
    expect((await grant(b, 'same')).status).toBe(201);
    expect((await t.pool.query('select count(*)::int n from site_grants')).rows[0].n).toBe(1);
  });

  it('revokes once; a second revoke is a refused conflict; the revoke is audited', async () => {
    const m = await mission();
    const id = (await grant(body(m))).body.grant.id;
    const r = await A.admin.req('POST', `/site-grants/${id}/revoke`, { reason: 'site no longer needed' });
    expect(r.status).toBe(200);
    expect(r.body.grant).toMatchObject({ state: 'revoked', reason: 'site no longer needed', revokedByName: 'Luca' });
    expect((await A.admin.req('POST', `/site-grants/${id}/revoke`, {})).status).toBe(409);
    expect((await A.admin.req('POST', `/site-grants/SG-NOPE/revoke`, {})).status).toBe(404);
    const acts = (await t.pool.query(`select action, result from audit_events where action='grant.revoke' order by id`)).rows;
    expect(acts.map((x) => x.result)).toEqual(['ok', 'denied', 'denied']);
  });
});

describe('site grants: the database refuses what the service would never do', () => {
  const insert = (over: Record<string, string> = {}) => {
    const f = { id: "'SG-X" + n++ + "'", tenant_id: "'t-1'", mission_id: over.mission_id ?? "'M-1'", exact_origin: "'https://example.com'", capabilities: "array['read']", issued_by: "(select id from users limit 1)", issued_at: 'now()', expires_at: "now() + interval '1 hour'", ...over };
    return t.pool.query(`insert into site_grants(${Object.keys(f).join(',')}) values (${Object.values(f).join(',')})`);
  };
  const withMission = async () => { const m = await mission(); return `'${m}'`; };

  it('refuses a non-normal origin, an expiry over 30 days, an empty or unknown capability list', async () => {
    const mission_id = await withMission();
    await insert({ mission_id }); // the control case is valid
    for (const o of ['HTTPS://example.com', 'http://example.com', 'https://example.com/', 'https://example.com/a', 'https://user@example.com', 'https://localhost', 'https://127.0.0.1', 'https://example.local', 'https://a.internal', 'https://*.example.com', 'https://example', 'https://example.com:0', 'https://exa mple.com'])
      await expect(insert({ mission_id, exact_origin: `'${o}'` }), o).rejects.toThrow(/site_grants_exact_origin_check/);
    await expect(insert({ mission_id, expires_at: "now() + interval '31 days'" })).rejects.toThrow(/check/);
    await expect(insert({ mission_id, expires_at: "now() - interval '1 hour'" })).rejects.toThrow(/check/);
    await expect(insert({ mission_id, capabilities: "array[]::text[]" })).rejects.toThrow(/check/);
    await expect(insert({ mission_id, capabilities: "array['submit_form']" })).rejects.toThrow(/check/);
  });

  it('is append-only: no edit except one revoke, no delete, no truncate', async () => {
    const m = await mission();
    const id = (await grant(body(m))).body.grant.id;
    await expect(t.pool.query(`update site_grants set exact_origin='https://evil.com' where id=$1`, [id])).rejects.toThrow(/can only be revoked/);
    await expect(t.pool.query(`update site_grants set expires_at = expires_at + interval '1 day' where id=$1`, [id])).rejects.toThrow(/can only be revoked/);
    await expect(t.pool.query(`update site_grants set capabilities=array['read','screenshot'] where id=$1`, [id])).rejects.toThrow(/can only be revoked/);
    await expect(t.pool.query(`delete from site_grants where id=$1`, [id])).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`truncate site_grants`)).rejects.toThrow(/append-only/);
    await A.admin.req('POST', `/site-grants/${id}/revoke`, {});
    await expect(t.pool.query(`update site_grants set reason='changed' where id=$1`, [id])).rejects.toThrow(/never changes/);
    await expect(t.pool.query(`update site_grants set revoked_at=null, revoked_by=null where id=$1`, [id])).rejects.toThrow(/never changes/);
  });
});

describe('site grants feed evaluate()', () => {
  const T = 't-1';
  it('an R0 action on a granted origin is allowed; on an ungranted origin it is denied no_grant', async () => {
    const m = await mission();
    await grant(body(m));
    const now = Date.now();
    const grants = await loadGrants(t.pool, T, m, now, agent.id);
    expect(grants).toHaveLength(1);
    expect(evaluate(read('https://example.com', m), grants, {}, now)).toMatchObject({ outcome: 'allow', tier: 'R0' });
    const d = evaluate(read('https://other.example.org', m), grants, {}, now);
    expect(d).toMatchObject({ outcome: 'deny' });
    expect(d.reasons).toContain('no_grant');
  });

  it('a capability not in the grant is not covered', async () => {
    const m = await mission();
    await grant(body(m, { capabilities: ['read'] }));
    const now = Date.now();
    const grants = await loadGrants(t.pool, T, m, now, agent.id);
    expect(evaluate({ ...read('https://example.com', m), kind: 'screenshot' }, grants, {}, now).reasons).toContain('no_grant');
  });

  it('denies at the exact expiry instant, and allows one millisecond before', async () => {
    const m = await mission();
    const exp = new Date(Date.now() + 3600_000);
    exp.setMilliseconds(0);
    await grant(body(m, { expiresAt: exp.toISOString() }));
    const e = exp.getTime();
    const grants = await loadGrants(t.pool, T, m, e - 1, agent.id);
    expect(grants[0].expiresAt).toBe(e);
    expect(evaluate(read('https://example.com', m), grants, {}, e - 1).outcome).toBe('allow');
    const at = evaluate(read('https://example.com', m), await loadGrants(t.pool, T, m, e, agent.id), {}, e);
    expect(at.outcome).toBe('deny');
    expect(at.reasons).toContain('grant_expired');
    expect(evaluate(read('https://example.com', m), await loadGrants(t.pool, T, m, e + 5000, agent.id), {}, e + 5000).outcome).toBe('deny');
  });

  it('a revoked grant denies', async () => {
    const m = await mission();
    const id = (await grant(body(m))).body.grant.id;
    await A.admin.req('POST', `/site-grants/${id}/revoke`, {});
    const now = Date.now() + 1000;
    const d = evaluate(read('https://example.com', m), await loadGrants(t.pool, T, m, now, agent.id), {}, now);
    expect(d.outcome).toBe('deny');
    expect(d.reasons).toContain('no_grant');
  });

  it('a grant for mission A does not cover mission B', async () => {
    const a = await mission(), b = await mission();
    await grant(body(a));
    const now = Date.now();
    expect(evaluate(read('https://example.com', b), await loadGrants(t.pool, T, b, now, agent.id), {}, now).outcome).toBe('deny');
    // even if a caller hands over A's grants, evaluate() still keys on the action's mission
    const ga = await loadGrants(t.pool, T, a, now, agent.id);
    expect(evaluate(read('https://example.com', b), ga, {}, now).outcome).toBe('deny');
    expect(evaluate(read('https://example.com', a), ga, {}, now).outcome).toBe('allow');
  });

  it("another tenant's grant never matches", async () => {
    const m = await mission();
    await grant(body(m));
    await t.pool.query(`insert into tenants(id, name) values ('t-2','Other')`);
    const now = Date.now();
    expect(await loadGrants(t.pool, 't-2', m, now, agent.id)).toEqual([]);
    const d = await decideOnOrigin(t.pool, { tenantId: 't-2', missionId: m, kind: 'read', effect: 'read', rawOrigin: 'https://example.com', requester: agent }, now);
    expect(d.decision.outcome).toBe('deny');
    // the owner tenant still gets its own grant
    expect((await decideOnOrigin(t.pool, { tenantId: T, missionId: m, kind: 'read', effect: 'read', rawOrigin: 'https://example.com', requester: agent }, now)).decision.outcome).toBe('allow');
  });

  it('decideOnOrigin normalises first: spelling variants of a granted origin match, lookalikes and hostile forms never do', async () => {
    const m = await mission();
    await grant(body(m, { origin: 'https://paypal.com' }));
    const now = Date.now();
    const ask = (rawOrigin: unknown) => decideOnOrigin(t.pool, { tenantId: T, missionId: m, kind: 'read', effect: 'read', rawOrigin, requester: agent }, now);
    for (const v of ['https://paypal.com', 'HTTPS://PayPal.com/', 'https://paypal.com:443']) expect((await ask(v)).decision.outcome, v).toBe('allow');
    for (const v of ['https://pаypal.com', 'https://xn--pypal-4ve.com', 'https://paypal.com.evil.com', 'https://paypal.com@evil.com', 'https://www.paypal.com', 'https://paypal.com:8443', 'http://paypal.com', 'https://paypal.com/login', 'https://paypal.com.', 'paypal.com', null, undefined]) {
      const r = await ask(v);
      expect(r.decision.outcome, String(v)).toBe('deny');
    }
    // every hostile corpus entry, asked as an action, is denied and carries a refusal reason
    for (const h of hostile) { const r = await ask(h.input); expect(r.decision.outcome).toBe('deny'); expect(r.refusal, JSON.stringify(h.input)).toBe(h.reason); }
  });
});
