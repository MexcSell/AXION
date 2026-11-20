import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.ts';
import { migrate } from '../src/migrate.ts';
import type { FastifyInstance } from 'fastify';

export const TEST_DB = () => {
  const u = process.env.TEST_DATABASE_URL;
  if (!u) throw new Error('TEST_DATABASE_URL missing (server/.env)');
  return u;
};

/** A fresh Postgres schema inside axion_test, migrated to the latest version. */
export async function makeSchema(opts: { migrate?: boolean } = {}) {
  const schema = 't_' + randomBytes(6).toString('hex');
  const admin = new pg.Client({ connectionString: TEST_DB() });
  await admin.connect();
  await admin.query(`create schema ${schema}`);
  await admin.end();
  const pool = new pg.Pool({ connectionString: TEST_DB(), options: `-c search_path=${schema}`, max: 4 });
  if (opts.migrate !== false) await migrate(pool, 'up');
  const drop = async () => {
    await pool.end();
    const c = new pg.Client({ connectionString: TEST_DB() });
    await c.connect();
    await c.query(`drop schema ${schema} cascade`);
    await c.end();
  };
  return { schema, pool, drop };
}

export interface TestApp { app: FastifyInstance; schema: string; pool: pg.Pool; close: () => Promise<void> }

export async function makeTestApp(over: Record<string, unknown> = {}): Promise<TestApp> {
  const s = await makeSchema();
  const uploadDir = mkdtempSync(join(tmpdir(), 'axion-up-'));
  const app = await buildApp({ databaseUrl: TEST_DB(), schema: s.schema, logger: false, uploadDir, ...over });
  return { app, schema: s.schema, pool: s.pool, close: async () => { await app.close(); await s.drop(); rmSync(uploadDir, { recursive: true, force: true }); } };
}

/** One simulated browser: keeps its own cookies and the CSRF token from the last `me`. */
export class Browser {
  jar = new Map<string, string>();
  csrf = '';
  constructor(public app: FastifyInstance, public ip = '127.0.0.1', public ua = 'Chrome on Linux') {}
  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await this.app.inject({
      method: method as 'GET', url: '/api/v1' + url, remoteAddress: this.ip,
      headers: { ...(cookie ? { cookie } : {}), ...(this.csrf && method !== 'GET' ? { 'x-csrf': this.csrf } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
    for (const c of r.cookies as { name: string; value: string; maxAge?: number; expires?: Date }[]) {
      if (c.value === '' || c.maxAge === 0 || (c.expires && c.expires.getTime() < Date.now())) this.jar.delete(c.name); else this.jar.set(c.name, c.value);
    }
    let json: any = undefined;
    try { json = r.json(); } catch { /* not json */ }
    if (json?.me?.csrf) this.csrf = json.me.csrf;
    return { status: r.statusCode, body: json, raw: r };
  }
  connect(name: string, password: string, device = { name: 'Chrome on Linux', kind: 'desktop', browser: 'Chrome' }) {
    return this.req('POST', '/auth/connect', { name, password, device });
  }
}

/** Admin "Luca" signed in, plus a helper to make approved members. */
export async function withAdmin(app: FastifyInstance) {
  const admin = new Browser(app);
  const r = await admin.connect('Luca', 'pass1234');
  if (r.status !== 200) throw new Error('admin connect failed ' + JSON.stringify(r.body));
  const member = async (name: string, pass = 'pass1234') => {
    const b = new Browser(app);
    const w = await b.connect(name, pass);
    if (w.status !== 202) throw new Error('expected waiting ' + JSON.stringify(w.body));
    const users = (await admin.req('GET', '/users')).body.users as { id: string; name: string }[];
    const u = users.find((x) => x.name === name)!;
    await admin.req('POST', `/users/${u.id}/approve`);
    const ok = await b.req('GET', '/auth/wait');
    if (ok.status !== 200) throw new Error('approve failed ' + JSON.stringify(ok.body));
    return { b, id: u.id };
  };
  return { admin, adminId: r.body.me.account.id as string, member };
}
