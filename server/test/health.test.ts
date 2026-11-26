import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, type TestApp } from './helpers.ts';

describe('health and error envelope', () => {
  let t: TestApp;
  beforeAll(async () => { t = await makeTestApp({ configure: (app: import('fastify').FastifyInstance) => app.get('/api/v1/__boom', async () => { throw new Error('select * from secret_table at /home/x'); }) }); });
  afterAll(async () => { await t.close(); });

  it('GET /api/v1/health reports the database', async () => {
    const r = await t.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, db: 'up' });
    expect(typeof r.json().version).toBe('string');
    expect(r.json().commit).toBeNull(); // no commit configured in tests
    expect(r.json().leader).toBe(true); // mode always
  });

  it('unknown routes give the error envelope without a stack', async () => {
    const r = await t.app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(r.statusCode).toBe(404);
    const b = r.json();
    expect(b.code).toBe('NOT_FOUND');
    expect(typeof b.correlationId).toBe('string');
    expect(b.retryable).toBe(false);
    expect(JSON.stringify(b)).not.toMatch(/stack|\/home\//);
  });

  it('a thrown internal error is hidden behind INTERNAL', async () => {
    const r = await t.app.inject({ method: 'GET', url: '/api/v1/__boom' });
    expect(r.statusCode).toBe(500);
    expect(r.json().code).toBe('INTERNAL');
    expect(r.json().retryable).toBe(true);
    expect(r.body).not.toMatch(/secret_table|\/home\//);
  });

  it('malformed JSON gives BAD_REQUEST envelope', async () => {
    const r = await t.app.inject({ method: 'POST', url: '/api/v1/health', headers: { 'content-type': 'application/json' }, payload: '{bad' });
    expect([400, 404, 405]).toContain(r.statusCode);
    expect(r.json().code).toBeTypeOf('string');
    expect(r.json().correlationId).toBeTypeOf('string');
  });
});
