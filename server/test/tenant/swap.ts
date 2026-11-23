import { ROUTES } from '../contracts/registry.ts';
import { Browser } from '../helpers.ts';
import { idem, cookieOf, type Tenant, type World } from './fixture.ts';
import { atRestText, canon, freshSessions, getCases, markerHits, snapshot, diffSnaps, type Violation } from './isolation.ts';
import { WRITE_CASES, WRITE_EXCEPTIONS, AT_REST_VOLATILE, writeRoutesWithIds, type Req } from './writes.ts';

/**
 * c81 item 6, MR2 "the tenant-id swap" (the researcher's own construction, not a published relation).
 * Tenant A sends tenant B's id as `tenantId` / `tenant_id` / `tenant` in the body, in the query and as an `x-tenant-id` / `x-tenant` header.
 * The answer must be the same as for the same request without them, or a 400 (an unknown field); it must never act on B.
 * A write changes state, so "the same request without them" is taken twice (plain 1, plain 2) and the forged variants are compared with plain 2.
 * Where plain 1 and plain 2 are byte-identical after c79's normalisation, the forged answer must be byte-identical too; where the state moved on
 * (a created id, a second 409), it must have the same status and the same JSON shape (keys and value types). B's data is compared before and after.
 */
export interface Forge { name: 'body' | 'query' | 'header' | 'all'; body: Record<string, string> | null; query: string; headers: Record<string, string> }
export const forgesOf = (other: Tenant): Forge[] => {
  const id = other.tenantId;
  const body = { tenantId: id, tenant_id: id, tenant: id }, query = `tenantId=${id}&tenant_id=${id}&tenant=${id}`, headers = { 'x-tenant-id': id, 'x-tenant': id };
  return [
    { name: 'body', body, query: '', headers: {} }, { name: 'query', body: null, query, headers: {} },
    { name: 'header', body: null, query: '', headers }, { name: 'all', body, query, headers },
  ];
};
export interface Out { status: number; text: string }
export interface SwapCase { run: (view: Tenant, f: Forge | null) => Promise<Out>; session?: string }
const withQuery = (url: string, q: string) => (q ? url + (url.includes('?') ? '&' : '?') + q : url);
const jsonCase = (method: string, build: (t: Tenant) => Req | Promise<Req>): SwapCase => ({
  run: async (view, f) => {
    const rq = await build(view);
    const body = f?.body ? { ...((rq.body as object | undefined) ?? {}), ...f.body } : rq.body;
    const r = await view.admin.req(method, withQuery(rq.url, f?.query ?? ''), body, { ...(rq.headers ?? {}), ...(f?.headers ?? {}) });
    return { status: r.status, text: r.raw.body };
  },
});
let n = 0;
const dayIso = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const newName = (p: string) => `${p} ${Date.now().toString(36)}${n++}`;

/** A new approved member of the viewer's tenant, signed in (a throwaway: the password change and logout cases must not spend the shared sessions). */
async function throwawayMember(view: Tenant): Promise<Browser> {
  const b = new Browser(view.app, `127.0.7.${n % 200}`, 'Firefox on Linux'); const name = newName('Swap user').replace(/[^A-Za-z0-9 ]/g, '');
  if ((await b.connect(name, 'pass1234')).status !== 202) throw new Error('throwaway member: not waiting');
  const id = ((await view.admin.req('GET', '/users')).body.users as { id: string; name: string }[]).find((u) => u.name === name)!.id;
  await view.admin.req('POST', `/users/${id}/approve`);
  if ((await b.req('GET', '/auth/wait')).status !== 200) throw new Error('throwaway member: approval failed');
  return b;
}
const asBrowser = (method: string, url: string, body: unknown, getB: (v: Tenant) => Promise<Browser>): SwapCase => ({
  run: async (view, f) => {
    const b = await getB(view);
    const r = await b.req(method, withQuery(url, f?.query ?? ''), f?.body ? { ...((body as object | undefined) ?? {}), ...f.body } : body, f?.headers ?? {});
    return { status: r.status, text: r.raw.body };
  },
});
const sessionOf = async (view: Tenant): Promise<Browser> => { const b = new Browser(view.app, view.admin.ip, view.admin.ua); for (const [k, x] of view.admin.jar) if (k !== 'axion_sid') b.jar.set(k, x); if ((await b.connect('Luca', 'pass1234')).status !== 200) throw new Error('cannot sign in'); return b; };

/** Write routes without an id in the path (the ones with an id come from c79's WRITE_CASES). */
export const NOID_CASES: Record<string, SwapCase> = {
  'PATCH /me': jsonCase('PATCH', () => ({ url: '/me', body: { avatar: { kind: 'robot', hue: 120, robot: 'r1' } } })),
  'POST /agents': jsonCase('POST', (t) => ({ url: '/agents', body: { name: newName('Swap'), role: newName('Role'), dept: 'Ops', duty: newName('Duty'), model: 'test-model', skills: ['audit'], tools: [], parentId: t.ids.coder.replace('coder-01', 'ops-01') }, headers: idem() })),
  'POST /company/metric-audits': jsonCase('POST', (t) => ({ url: '/company/metric-audits', body: { metricId: 'scorecard.finished', samples: [{ sampleRef: `mission:${t.ids.mission}`, metricLabel: true, auditLabel: true }] } })),
  'POST /failure-tags': jsonCase('POST', (t) => ({ url: '/failure-tags', body: { subjectKind: 'task', subjectId: t.ids.task, modeId: 'FM-1.1', note: newName('swap'), attribution: { agentId: 'agent-swap', stepRef: 'step-1' } }, headers: idem() })),
  'POST /missions': jsonCase('POST', () => ({ url: '/missions', body: { text: newName('Swap mission'), files: [], shared: false }, headers: idem() })),
  'POST /notifications/ack-all': jsonCase('POST', (t) => ({ url: '/notifications/ack-all', body: { ids: [t.ids.notification] } })),
  'POST /organization/proposals': jsonCase('POST', async (t) => {
    const g = (await t.admin.req('GET', '/organization/graph')).body;
    const moved = g.edges.map((e: any) => (e.subordinateId === 'tester-01' ? { ...e, supervisorId: 'coder-01' } : e));
    return { url: '/organization/proposals', body: { baseline: 'No change: keep the current chart as it is.', expectedCost: 'No added cost is expected in this test.', title: newName('Swap'), why: 'Shorter path', baseRevision: g.revision.seq, edges: moved, triggers: ['coverage_gap'] }, headers: idem() };
  }),
  'POST /site-grants': jsonCase('POST', (t) => ({ url: '/site-grants', body: { origin: `https://swap${n++}.example.com`, missionId: t.ids.mission, capabilities: ['read'], expiresAt: dayIso(2) }, headers: idem() })),
  'POST /skills': jsonCase('POST', () => ({ url: '/skills', body: { name: newName('Swap skill'), description: 'Do it', steps: [{ kind: 'observe', detail: 'Read it' }], preconditions: [], sources: [{ kind: 'review', id: 'REV-1', note: 'x' }] }, headers: idem() })),
  'POST /uploads': {
    run: async (view, f) => {
      const boundary = '----c81' + Date.now() + n++;
      const extra = f?.body ? Object.entries(f.body).map(([k, v]) => `--${boundary}\r\ncontent-disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('') : '';
      const payload = `${extra}--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="swap.txt"\r\ncontent-type: text/plain\r\n\r\nswap body\r\n--${boundary}--\r\n`;
      const r = await view.app.inject({ method: 'POST', url: withQuery('/api/v1/uploads', f?.query ?? ''), remoteAddress: '127.0.0.1', headers: { cookie: cookieOf(view.admin), 'x-csrf': view.admin.csrf, 'content-type': `multipart/form-data; boundary=${boundary}`, ...(f?.headers ?? {}) }, payload });
      return { status: r.statusCode, text: r.body };
    },
  },
  'POST /auth/cancel': asBrowser('POST', '/auth/cancel', undefined, async (v) => new Browser(v.app)),
  'POST /auth/connect': asBrowser('POST', '/auth/connect', { name: 'Luca', password: 'pass1234', device: { name: 'Chrome on Linux', kind: 'desktop', browser: 'Chrome' } }, async (v) => { const b = new Browser(v.app, v.admin.ip, v.admin.ua); for (const [k, x] of v.admin.jar) if (k !== 'axion_sid') b.jar.set(k, x); return b; }),
  'POST /auth/logout': asBrowser('POST', '/auth/logout', undefined, sessionOf),
  'POST /me/password': asBrowser('POST', '/me/password', { current: 'pass1234', next: 'pass12345' }, throwawayMember),
};
/** Write routes with an id that c79's WRITE_CASES does not cover (its WRITE_EXCEPTIONS), built here for the caller's own tenant. */
export const SWAP_ID_EXTRA: Record<string, SwapCase> = {
  'POST /organization/revisions/:seq/rollback-proposal': jsonCase('POST', (t) => ({ url: `/organization/revisions/${t.ids.revision}/rollback-proposal`, body: { why: 'swap' }, headers: idem() })),
};
/** Every write route is either a swap case or a listed exception (none today); the inventory test fails on anything else. */
export const SWAP_EXCEPTIONS: Record<string, string> = {};
export const swapCases = (): Record<string, SwapCase> => {
  const idCases = Object.fromEntries(Object.entries(WRITE_CASES).map(([k, b]) => [k, jsonCase(k.split(' ')[0], (t) => b(t, t))]));
  return { ...idCases, ...SWAP_ID_EXTRA, ...NOID_CASES };
};
export const writeRoutes = (t: Tenant): string[] => [...new Set(t.app.routeTable.filter((r) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method)).map((r) => `${r.method} ${r.url.replace(/^\/api\/v1/, '')}`))].sort();

/** Shape of a JSON text: keys and value types, so a created id or a timestamp does not count as a difference. */
const shape = (t: string): string => { try { const f = (v: unknown): unknown => (Array.isArray(v) ? [v.length ? f(v[0]) : null] : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, f(x)])) : v === null ? 'null' : typeof v); return JSON.stringify(f(JSON.parse(t))); } catch { return 'text'; } };

export interface SwapRow { key: string; kind: 'GET' | 'write'; plain: number; stable: boolean; forged: Record<string, string> }
/** The whole relation for one (viewer, other) pair. GET routes first (all of the viewer's generated cases, as its administrator), then every write route. */
export async function swapTenant(w: World, view0: Tenant, other0: Tenant, arm?: () => void): Promise<{ violations: Violation[]; rows: SwapRow[] }> {
  const v: Violation[] = []; const rows: SwapRow[] = [];
  const view = await freshSessions(view0), other = await freshSessions(other0);
  arm?.();
  const forges = forgesOf(other);
  const { cases } = getCases(view);
  const otherCases = getCases(other).cases;
  await snapshot(other, otherCases, 'admin');
  const bBefore = await snapshot(other, otherCases, 'admin'); const restBefore = await atRestText(w, other.tenantId);
  // GET routes: one plain request, the same again (the control), then the query, header and both variants
  for (const c of cases) {
    const get = async (f: Forge | null) => { const r = await view.admin.req('GET', withQuery(c.url, f?.query ?? ''), undefined, f?.headers ?? {}); return { status: r.status, text: r.raw.body } as Out; };
    const p1 = await get(null), p2 = await get(null);
    if (p1.status !== p2.status || canon(p1.text) !== canon(p2.text)) v.push({ relation: 'CONTROL', where: `swap GET ${c.label}`, detail: 'two plain requests differ: a volatile field is missing from the list' });
    const row: SwapRow = { key: c.label, kind: 'GET', plain: p2.status, stable: true, forged: {} };
    for (const f of forges.filter((x) => x.name !== 'body')) {
      const o = await get(f); row.forged[f.name] = String(o.status);
      v.push(...markerHits(o.text, other, `swap GET ${c.label} (${f.name})`));
      if (o.status === 400 && p2.status !== 400) continue;
      if (o.status !== p2.status) v.push({ relation: 'MR2', where: `GET ${c.label} (${f.name})`, detail: `status ${p2.status} without the foreign tenant id, ${o.status} with it` });
      else if (canon(o.text) !== canon(p2.text)) v.push({ relation: 'MR2', where: `GET ${c.label} (${f.name})`, detail: 'the body differs from the same request without the foreign tenant id' });
    }
    rows.push(row);
  }
  // write routes
  const table = swapCases();
  // routes that consume their target (delete, reject, block, retire, withdraw, revoke) go last, so the rest still find what they act on
  const destructive = (k: string) => /^DELETE|^POST \/users\/|\/retire$|\/withdraw$|\/revoke$|^POST \/auth\/logout|^POST \/me\/password/.test(k);
  for (const key of [...writeRoutes(view)].sort((a, b) => Number(destructive(a)) - Number(destructive(b)) || a.localeCompare(b))) {
    const sc = table[key];
    if (!sc) { if (!(key in SWAP_EXCEPTIONS)) v.push({ relation: 'MR2', where: key, detail: 'a write route with neither a swap case nor a listed exception' }); continue; }
    const p1 = await sc.run(view, null), p2 = await sc.run(view, null);
    const stable = p1.status === p2.status && canon(p1.text) === canon(p2.text);
    const row: SwapRow = { key, kind: 'write', plain: p1.status, stable, forged: {} };
    for (const f of forges) {
      const o = await sc.run(view, f); row.forged[f.name] = String(o.status);
      v.push(...markerHits(o.text, other, `swap ${key} (${f.name})`));
      if (o.status === 400 && p2.status !== 400) continue; // an unknown field, refused
      if (o.status !== p2.status) v.push({ relation: 'MR2', where: `${key} (${f.name})`, detail: `status ${p2.status} without the foreign tenant id, ${o.status} with it: ${o.text.slice(0, 120)}` });
      else if (stable ? canon(o.text) !== canon(p2.text) : shape(o.text) !== shape(p2.text)) v.push({ relation: 'MR2', where: `${key} (${f.name})`, detail: `the answer ${stable ? 'differs' : 'has another shape'} from the same request without the foreign tenant id` });
    }
    rows.push(row);
  }
  // nothing happened to tenant B
  const bAfter = await snapshot(other, otherCases, 'admin');
  for (const x of diffSnaps(bBefore, bAfter, 'MR2')) v.push({ ...x, detail: 'tenant ' + other.tag + ' changed after the forged requests: ' + x.detail });
  const restAfter = new Map((await atRestText(w, other.tenantId)).map((r) => [r.table, r.text]));
  const sorted = (t: string) => t.split('\n').sort().join('\n'); // the physical row order is not defined (an update elsewhere can move a row)
  for (const r of restBefore) if (!AT_REST_VOLATILE.has(r.table) && sorted(restAfter.get(r.table) ?? '') !== sorted(r.text)) {
    const was = new Set(r.text.split('\n')); const now = (restAfter.get(r.table) ?? '').split('\n');
    v.push({ relation: 'MR2', where: `at rest ${r.table}`, detail: `rows of tenant ${other.tag} changed after the forged requests: ${now.filter((x) => !was.has(x)).slice(0, 2).join(' || ').slice(0, 300)} (was: ${[...was].filter((x) => !now.includes(x)).slice(0, 2).join(' || ').slice(0, 300)})` });
  }
  return { violations: v, rows };
}
void ROUTES; void writeRoutesWithIds; void WRITE_EXCEPTIONS;
