import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';

let t: TestApp;
let dir = '';
afterEach(async () => { await t.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });

describe('GET /operations/health', () => {
  it('reports API, database, event log, streams, last backup and execution: disabled (admins only)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'axion-bk-'));
    writeFileSync(join(dir, 'axion-20261120T010000Z.dump'), 'x');
    utimesSync(join(dir, 'axion-20261120T010000Z.dump'), new Date('2026-11-20T01:00:00Z'), new Date('2026-11-20T01:00:00Z'));
    t = await makeTestApp({ backupDir: dir });
    const A = await withAdmin(t.app);
    const m = await A.member('Mina');
    const r = await A.admin.req('GET', '/operations/health');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ api: { status: 'up' }, db: { status: 'up' }, execution: 'disabled', sse: { clients: 0 } });
    expect(r.body.api.uptimeSec).toBeGreaterThanOrEqual(0);
    expect(r.body.db.sizeBytes).toBeGreaterThan(0);
    expect(r.body.events.count).toBeGreaterThan(0);
    expect(r.body.backup.last).toBe('2026-11-20T01:00:00.000Z');
    expect(r.body.backup.file).toBe('axion-20261120T010000Z.dump');
    expect(JSON.stringify(r.body)).not.toMatch(/password|postgres:\/\//);
    expect((await m.b.req('GET', '/operations/health')).status).toBe(403);
  });
});
