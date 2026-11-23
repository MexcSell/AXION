import { openStream, Browser } from '../helpers.ts';
import { ROUTES } from '../contracts/registry.ts';
import { freshSessions, getCases, canon, DetectorInvalid, type GetCase } from './isolation.ts';
import { WRITE_CASES, type Req } from './writes.ts';
import { idem, type Tenant } from './fixture.ts';
import { addPrivate, flipPrivate, type VisWorld } from './vis-fixture.ts';

/**
 * Improvement cycle 87: the detector for visibility inside one tenant. Relations (this cycle's own construction):
 *  V1  invariance: M's response for every GET route is identical (same normalisation as c79, nothing added) in the states
 *      a (O's private mission absent), b1 (present, good outcomes) and b2 (present, outcomes flipped);
 *  V2  marker absence: none of the private mission's markers appears in anything M receives (every GET in every state, the SSE stream);
 *  ID  M asking for an id of the private mission gets what M gets for a well-formed id that does not exist (status, and the body once the id is masked), and no marker.
 * A violation carries its route and relation, so the allow-list tables are keyed by (route, relation).
 */
export interface VViolation { relation: 'CONTROL' | 'V1' | 'V2' | 'ID' | 'IDW' | 'SSE' | 'POSITIVE'; route: string; who: string; detail: string; /** V1 only: the JSON paths that differ (array positions written as []) */ paths?: string[] }
/** The JSON paths at which two bodies differ (array positions written as [], a changed array length as the array's own path + '[#]'). */
export function diffPaths(a: unknown, b: unknown, at = ''): string[] {
  if (Array.isArray(a) && Array.isArray(b)) { const out = a.length !== b.length ? [at + '[#]'] : []; for (let i = 0; i < Math.min(a.length, b.length); i++) out.push(...diffPaths(a[i], b[i], at + '[]')); return out; }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a as object), kb = Object.keys(b as object); const out: string[] = [];
    for (const k of new Set([...ka, ...kb])) out.push(...diffPaths((a as any)[k], (b as any)[k], at ? at + '.' + k : k));
    return out;
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [at || '(body)'];
}
const bad = (rs: { who: string; label: string; status: number }[]) => rs.filter((s) => s.status === 429 || s.status >= 500);
interface VSnap { who: string; label: string; key: string; status: number; text: string }

async function snap(browsers: [string, Browser][], cases: GetCase[]): Promise<VSnap[]> {
  const out: VSnap[] = [];
  for (const [who, b] of browsers) for (const c of cases) { const r = await b.req('GET', c.url); out.push({ who, label: c.label, key: c.key, status: r.status, text: r.raw.body }); }
  const b = bad(out); if (b.length) throw new DetectorInvalid('responses that make a comparison meaningless: ' + b.slice(0, 3).map((s) => `${s.who} ${s.label} ${s.status}`).join(', '));
  return out;
}
const sk = (s: { who: string; label: string }) => `${s.who} ${s.label}`;
export function diffV(a: VSnap[], b: VSnap[], relation: 'CONTROL' | 'V1', only: string[] = ['member']): VViolation[] {
  const out: VViolation[] = []; const bm = new Map(b.map((s) => [sk(s), s]));
  for (const s of a) {
    if (!only.includes(s.who)) continue;
    const o = bm.get(sk(s));
    if (!o) { out.push({ relation, route: s.key, who: s.who, detail: 'missing in the second snapshot' }); continue; }
    if (s.status !== o.status) { out.push({ relation, route: s.key, who: s.who, detail: `${s.label}: status ${s.status} -> ${o.status}` }); continue; }
    const x = canon(s.text), y = canon(o.text);
    if (x !== y) { let i = 0; while (i < x.length && x[i] === y[i]) i++; let paths: string[] = []; try { paths = [...new Set(diffPaths(JSON.parse(x), JSON.parse(y)))]; } catch { paths = ['(not json)']; } out.push({ relation, route: s.key, who: s.who, paths, detail: `${s.label}: body differs at char ${i}: ${JSON.stringify(x.slice(Math.max(0, i - 40), i + 70))} vs ${JSON.stringify(y.slice(Math.max(0, i - 40), i + 70))}` }); }
  }
  return out;
}
export const privHits = (v: VisWorld, text: string): string[] => { const low = text.toLowerCase(); return [...v.markers].filter(([m]) => low.includes(m.toLowerCase())).map(([m, f]) => `${m} (${f})`); };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Wait until nothing more is written to the event log (the staffing job of the new mission has finished). Condition-based: stable twice in a row. */
export async function settle(v: VisWorld) {
  let last = -1, same = 0; const t0 = Date.now();
  while (same < 3 && Date.now() - t0 < 20000) { const n = Number((await v.w.pool.query(`select coalesce(max(id),0) m from events where tenant_id=$1`, [v.t.tenantId])).rows[0].m); same = n === last ? same + 1 : 0; last = n; await wait(150); }
}

export interface Run {
  violations: VViolation[];
  /** per route: did the administrator's response change between the states? (non-vacuity) */
  adminChanged: Map<string, string[]>;
  /** per route: did O's own response contain a marker in some state? */
  ownerSees: Set<string>;
  stats: Record<string, number>;
  cases: GetCase[];
}
export type Arm = (stage: 'a' | 'b1' | 'b2') => void;

/** The whole sweep for the GET routes and the SSE stream. `arm` switches a seeded fault on at the given state (used by the mutants). */
export async function sweepGets(v: VisWorld, opt: { arm?: Arm; keepOpen?: boolean } = {}): Promise<Run> {
  v.t = await freshSessions({ ...v.t });
  const view: Tenant = { ...v.t, waiting: undefined };
  const viewM = v.t.member, viewA0 = v.t.admin, viewO = v.O;
  const { cases } = getCases(view);
  const vio: VViolation[] = []; const stats: Record<string, number> = {};
  const sM = await openStream(view.base, viewM); const sA = await openStream(view.base, viewA0); const sO = await openStream(view.base, viewO);
  try {
    for (const s of [sM, sA, sO]) await s.waitFor((e) => e.event === 'hello');
    // GET /audit/verify is limited to 6 a minute per session: the administrator signs in again before every snapshot, so a 429 can never look like a difference
    const who = async (): Promise<[string, Browser][]> => { v.t = await freshSessions(v.t); return [['member', v.t.member], ['admin', v.t.admin], ['owner', viewO]]; };
    opt.arm?.('a');
    await snap(await who(), cases); // warm-up: reading a channel or thread marks it read, which changes the unread counts once
    const a0 = await snap(await who(), cases); const a1 = await snap(await who(), cases);
    vio.push(...diffV(a0, a1, 'CONTROL')); // the member's pair; the administrator's own sign-ins move the audit chain, so only the member's responses are compared
    await addPrivate(v); await settle(v);
    opt.arm?.('b1');
    await snap(await who(), cases); // a second warm-up: the new mission's own reads
    const b1 = await snap(await who(), cases);
    await flipPrivate(v); await settle(v);
    opt.arm?.('b2');
    const b2 = await snap(await who(), cases); const b2b = await snap(await who(), cases);
    vio.push(...diffV(b2, b2b, 'CONTROL')); // the normalisation list is enough in state b2 too
    vio.push(...diffV(a1, b1, 'V1').map((x) => ({ ...x, detail: 'a->b1 ' + x.detail })), ...diffV(b1, b2, 'V1').map((x) => ({ ...x, detail: 'b1->b2 ' + x.detail })));
    // V2: markers in anything M got, in any state
    for (const [name, s] of [['a0', a0], ['a1', a1], ['b1', b1], ['b2', b2]] as const) for (const x of s) if (x.who === 'member') for (const h of privHits(v, x.text)) vio.push({ relation: 'V2', route: x.key, who: 'member', detail: `${name} ${x.label}: marker ${h}` });
    stats.getResponsesPerWho = a0.length / 3;
    // non-vacuity: the administrator's and the owner's responses really differ between the states
    const adminChanged = new Map<string, string[]>(); const ownerSees = new Set<string>();
    const stage = { a1, b1, b2 };
    for (const c of cases) {
      const key = (n: keyof typeof stage) => stage[n].find((x) => x.who === 'admin' && x.label === c.label)!;
      const diffs: string[] = [];
      if (canon(key('a1').text) !== canon(key('b1').text)) diffs.push('a->b1');
      if (canon(key('b1').text) !== canon(key('b2').text)) diffs.push('b1->b2');
      if (diffs.length) adminChanged.set(c.key, [...new Set([...(adminChanged.get(c.key) ?? []), ...diffs])]);
    }
    for (const x of [...b1, ...b2]) if (x.who === 'owner' && privHits(v, x.text).length) ownerSees.add(x.key);
    // SSE: M's own later event arrives (the stream was really read), then no private marker in M's stream; the admin's and the owner's streams must carry some (positive control)
    const own = 'ZQCONTROL' + Date.now() + 'Q';
    const before = Number((await v.w.pool.query(`select coalesce(max(id),0) m from events where tenant_id=$1`, [v.t.tenantId])).rows[0].m);
    must(await v.t.member.req('POST', '/channels/gm/messages', { kind: 'command', text: 'Control ' + own }, idem()));
    const last = (await v.w.pool.query(`select id::text id from events where tenant_id=$1 and id > $2 and audience_user=$3 order by id desc limit 1`, [v.t.tenantId, before, v.mId])).rows[0]?.id as string | undefined;
    const arrived = last ? await sM.waitFor((e) => e.id === last, 8000) : undefined;
    if (!arrived) vio.push({ relation: 'POSITIVE', route: 'GET /events/stream', who: 'member', detail: 'the member\'s own control event never arrived, so the stream check proves nothing' });
    for (const e of sM.events) for (const h of privHits(v, JSON.stringify(e))) vio.push({ relation: 'SSE', route: 'GET /events/stream', who: 'member', detail: `event ${e.id ?? e.event} ${e.event}: marker ${h}` });
    const sseA = sA.events.filter((e) => privHits(v, JSON.stringify(e)).length).length, sseO = sO.events.filter((e) => privHits(v, JSON.stringify(e)).length).length;
    stats.sseMember = sM.events.length; stats.sseAdminWithMarker = sseA; stats.sseOwnerWithMarker = sseO;
    if (!sseA) vio.push({ relation: 'POSITIVE', route: 'GET /events/stream', who: 'admin', detail: 'no private marker reached the administrator\'s stream: the SSE check has nothing to detect' });
    return { violations: vio, adminChanged, ownerSees, stats, cases };
  } finally { sM.close(); sA.close(); sO.close(); await Promise.allSettled([sM.done, sA.done, sO.done]); }
}
const must = (r: { status: number; body: any }) => { if (r.status >= 300) throw new DetectorInvalid('control write failed ' + r.status + ' ' + JSON.stringify(r.body)?.slice(0, 120)); return r; };

/** ids of the private mission, and for every one a well-formed id that does not exist */
const PRIV_KEYS = ['mission', 'mission2', 'task', 'task2', 'task3', 'instance', 'instance2', 'thread', 'upload', 'approval', 'notification', 'tag', 'grant'] as const;
export function idSets(v: VisWorld): { priv: Record<string, string>; ghost: Record<string, string> } {
  const own = v.t.ids; const p = v.priv;
  const privIds: Record<string, string> = { ...own, mission: p.mission, mission2: p.mission, task: p.task, task2: p.task2, task3: p.task3, instance: p.instance, instance2: p.instance, thread: p.thread, upload: p.upload, approval: p.approval, notification: p.notification, tag: p.tag, grant: p.grant };
  const ghost: Record<string, string> = { ...own };
  // a well-formed id that does not exist: the trailing number becomes 99999999 (mission ids must match M-<digits>), else the last character changes
  const mut = (s: string) => (/\d+$/.test(s) ? s.replace(/\d+$/, '99999999') : s.slice(0, -1) + (s.endsWith('0') ? '1' : '0'));
  for (const k of PRIV_KEYS) ghost[k] = k === 'instance' || k === 'instance2' ? mut(p.instance.split(':')[0]) + ':' + p.instance.split(':')[1] : mut(privIds[k]);
  return { priv: privIds, ghost };
}
const mask = (text: string, id: string) => canon(text).split(id).join('<ID>').split(encodeURIComponent(id)).join('<ID>').split(id.split(':')[0]).join('<MISSION>');

export interface IdRun { violations: VViolation[]; tried: string[]; skipped: string[]; /** routes where the administrator's answer for the private id differs from the answer for a ghost id (the private record really is served) */ adminServes: string[]; adminSame: string[] }
/** ID relation, GET routes: M asks for the private ids, then for ghost ids of the same shape. Same status, same masked body, no marker. */
export async function idGets(v: VisWorld): Promise<IdRun> {
  const t = { ...v.t, waiting: undefined }; const { priv, ghost } = idSets(v);
  const mine = getCases(t).cases; const pc = getCases(t, priv).cases, gc = getCases(t, ghost).cases;
  const vio: VViolation[] = []; const tried: string[] = []; const skipped: string[] = []; const adminServes: string[] = []; const adminSame: string[] = [];
  const own = new Map(mine.map((c) => [c.label, c.url]));
  for (let i = 0; i < pc.length; i++) {
    const c = pc[i], g = gc[i];
    if (c.url === own.get(c.label)) { skipped.push(c.key); continue; } // the route's ids are not mission-scoped: nothing private to ask for
    const [rp, rg] = [await v.t.member.req('GET', c.url), await v.t.member.req('GET', g.url)];
    tried.push(c.label);
    { const [ap, ag] = [await v.t.admin.req('GET', c.url), await v.t.admin.req('GET', g.url)]; (ap.status !== ag.status || canon(ap.raw.body).split(Object.values(priv).find((x) => c.url.includes(x)) ?? '\0').join('') !== canon(ag.raw.body).split(Object.values(ghost).find((x) => g.url.includes(x)) ?? '\0').join('') ? adminServes : adminSame).push(c.label); }
    if (rp.status >= 500 || rg.status >= 500 || rp.status === 429 || rg.status === 429) throw new DetectorInvalid(`ID ${c.label}: ${rp.status}/${rg.status}`);
    for (const h of privHits(v, rp.raw.body)) vio.push({ relation: 'ID', route: c.key, who: 'member', detail: `${c.label}: marker ${h}` });
    if (rp.status !== rg.status) { vio.push({ relation: 'ID', route: c.key, who: 'member', detail: `${c.label}: private id answers ${rp.status}, a nonexistent id answers ${rg.status}` }); continue; }
    const idp = new Set(Object.values(priv).filter((x) => c.url.includes(x) || c.url.includes(encodeURIComponent(x)))), idg = new Set(Object.values(ghost).filter((x) => g.url.includes(x) || g.url.includes(encodeURIComponent(x))));
    let bp = canon(rp.raw.body), bg = canon(rg.raw.body);
    for (const x of idp) bp = mask(bp, x); for (const x of idg) bg = mask(bg, x);
    if (bp !== bg) vio.push({ relation: 'ID', route: c.key, who: 'member', detail: `${c.label}: the body for a private id differs from the body for a nonexistent id: ${JSON.stringify(bp.slice(0, 120))} vs ${JSON.stringify(bg.slice(0, 120))}` });
    if (![403, 404].includes(rp.status)) vio.push({ relation: 'ID', route: c.key, who: 'member', detail: `${c.label}: status ${rp.status}, expected 404 or 403` });
  }
  return { violations: vio, tried, skipped: [...new Set(skipped)], adminServes, adminSame };
}

/** ID relation, write routes a member may call: the private ids against ghost ids; the administrator's view of the private mission must not change. */
export async function idWrites(v: VisWorld): Promise<{ violations: VViolation[]; tried: string[]; skipped: string[] }> {
  const { priv, ghost } = idSets(v);
  const vio: VViolation[] = []; const tried: string[] = []; const skipped: string[] = [];
  const asT = (ids: Record<string, string>) => ({ ...v.t, ids }) as Tenant;
  const watch = getCases({ ...v.t, ids: priv, waiting: undefined } as Tenant).cases.filter((c) => /\/(missions|tasks|threads|approvals|notifications)\//.test(c.url) || c.key === 'GET /agent-instances');
  const adminSnap = async () => (await Promise.all(watch.map(async (c) => canon((await v.t.admin.req('GET', c.url)).raw.body)))).join('\n');
  await adminSnap();
  const before = await adminSnap();
  for (const key of Object.keys(WRITE_CASES)) {
    const entry = ROUTES[key]; if (entry && 'v' in entry && entry.admin) { skipped.push(`${key} (administrator only)`); continue; }
    const [method] = key.split(' ');
    const rp: Req = await WRITE_CASES[key](asT(priv), v.t); // the same request with every private id replaced by its ghost (the builders read row versions through the administrator, which a ghost id has none of)
    let gj = JSON.stringify(rp); for (const k of PRIV_KEYS) { if (priv[k] !== ghost[k]) gj = gj.split(priv[k]).join(ghost[k]).split(encodeURIComponent(priv[k])).join(encodeURIComponent(ghost[k])); }
    const rg: Req = JSON.parse(gj);
    const own: Req = await WRITE_CASES[key](v.t, v.t);
    if (rp.url === own.url && JSON.stringify(rp.body) === JSON.stringify(own.body)) { skipped.push(`${key} (ids are not mission-scoped)`); continue; }
    const a = await v.t.member.req(method, rp.url, rp.body, rp.headers ?? {}), b = await v.t.member.req(method, rg.url, rg.body, rg.headers ?? {});
    tried.push(key);
    if (a.status >= 500 || a.status === 429) throw new DetectorInvalid(`IDW ${key}: ${a.status}`);
    for (const h of privHits(v, a.raw.body)) vio.push({ relation: 'IDW', route: key, who: 'member', detail: `marker ${h}` });
    if (a.status !== b.status) vio.push({ relation: 'IDW', route: key, who: 'member', detail: `${method} ${rp.url}: private id answers ${a.status}, a nonexistent id answers ${b.status}` });
    else if (![403, 404].includes(a.status)) vio.push({ relation: 'IDW', route: key, who: 'member', detail: `${method} ${rp.url}: status ${a.status} ${JSON.stringify(a.body)?.slice(0, 120)}, expected 404 or 403` });
  }
  const after = await adminSnap();
  if (before !== after) vio.push({ relation: 'IDW', route: 'WRITES', who: 'admin', detail: 'the administrator\'s view of the private mission changed after the member\'s attempts' });
  return { violations: vio, tried, skipped };
}
void DetectorInvalid;
