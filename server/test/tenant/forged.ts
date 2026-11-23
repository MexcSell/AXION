import { atRestText, freshSessions, getCases, markerHits, snapshot, diffSnaps, type Violation } from './isolation.ts';
import { AT_REST_VOLATILE } from './writes.ts';
import { idem, type Tenant, type World } from './fixture.ts';

/**
 * c81 item 7, MR4 "forged scope" (the researcher's own construction, like the rest of this file). Tenant A sends forged forms of tenant B's ids and
 * scope fields. Every one must be refused or answered without B's data: no status 5xx or 429 (the detector itself would be invalid), none of B's
 * markers or ids in the answer, and nothing changed in B afterwards. The table is reviewed by hand: one row per case, its class, and what it forges.
 * A row's `req` builds the request from the viewer's own ids and the other tenant's ids.
 */
export type Class = 'case' | 'whitespace' | 'urlencoding' | 'dotdot' | 'confusable' | 'prefix' | 'control' | 'array' | 'jsonpath';
export interface Forged { id: string; cls: Class; what: string; req: (view: Tenant, other: Tenant) => { method: string; url: string; body?: unknown; headers?: Record<string, string> } }

const enc = encodeURIComponent;
const pct = (s: string) => [...s].map((c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join('');
const CONF: Record<string, string> = { A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х' };
const confusable = (s: string) => s.replace(/[A-Za-z]/g, (c) => CONF[c] ?? c);
const wide = (s: string) => [...s].map((c) => (c === '-' ? '－' : /[A-Za-z0-9]/.test(c) ? String.fromCharCode(c.charCodeAt(0) + 0xFEE0) : c)).join('');
/** Path-ready (already URL-encoded) forged forms of one id. */
const FORMS = {
  lower: (id: string) => enc(id.toLowerCase()), upper: (id: string) => enc(id.toUpperCase()),
  spaceBefore: (id: string) => '%20' + enc(id), spaceAfter: (id: string) => enc(id) + '%20', tabNewline: (id: string) => enc(id) + '%09%0A',
  pctAll: (id: string) => pct(id), pctTwice: (id: string) => [...id].map((c) => '%25' + pct(c).slice(1)).join(''),
  dotdot: (id: string) => '..%2F' + enc(id), dotsEncoded: (id: string) => '%2E%2E%2F' + enc(id),
  cyrillic: (id: string) => enc(confusable(id)), fullwidth: (id: string) => enc(wide(id)), zeroWidth: (id: string) => enc(id[0] + '​' + id.slice(1)),
  truncate1: (id: string) => enc(id.slice(0, -1)), truncate3: (id: string) => enc(id.slice(0, -3)), prefix2: (id: string) => enc(id.slice(0, 2)),
  wildcard: (id: string) => enc(id.slice(0, -1)) + '%25', underscore: (id: string) => enc(id.slice(0, -1)) + '_',
  quote: (id: string) => enc(id + "'"), semicolon: (id: string) => enc(id + ';--'), nul: (id: string) => '%00' + enc(id), withOwn: (id: string) => enc(id) + ',own',
} satisfies Record<string, (id: string) => string>;
type Form = keyof typeof FORMS;
const CLS: Record<Form, Class> = {
  lower: 'case', upper: 'case', spaceBefore: 'whitespace', spaceAfter: 'whitespace', tabNewline: 'whitespace', pctAll: 'urlencoding', pctTwice: 'urlencoding',
  dotdot: 'dotdot', dotsEncoded: 'dotdot', cyrillic: 'confusable', fullwidth: 'confusable', zeroWidth: 'confusable',
  truncate1: 'prefix', truncate3: 'prefix', prefix2: 'prefix', wildcard: 'prefix', underscore: 'prefix', quote: 'control', semicolon: 'control', nul: 'control', withOwn: 'control',
};
interface Target { name: string; method: 'GET' | 'POST'; path: (id: string) => string; of: (t: Tenant) => string; body?: () => unknown; raw?: true }
const TARGETS: Record<string, Target> = {
  mission: { name: 'mission', method: 'GET', path: (id) => `/missions/${id}`, of: (t) => t.ids.mission },
  agent: { name: 'agent', method: 'GET', path: (id) => `/agents/${id}`, of: (t) => t.ids.tester },
  coder: { name: 'agent (coder)', method: 'GET', path: (id) => `/agents/${id}/playbook`, of: (t) => t.ids.coder },
  task: { name: 'task', method: 'GET', path: (id) => `/tasks/${id}`, of: (t) => t.ids.task },
  thread: { name: 'thread', method: 'GET', path: (id) => `/threads/${id}/messages`, of: (t) => t.ids.thread },
  upload: { name: 'upload', method: 'GET', path: (id) => `/uploads/${id}`, of: (t) => t.ids.upload },
  lesson: { name: 'lesson', method: 'GET', path: (id) => `/lessons/${id}`, of: (t) => t.ids.lesson },
  skill: { name: 'skill', method: 'GET', path: (id) => `/skills/${id}`, of: (t) => t.ids.skill },
  instance: { name: 'agent instance', method: 'GET', path: (id) => `/agent-instances/${id}`, of: (t) => t.ids.instance },
  ack: { name: 'notification ack', method: 'POST', path: (id) => `/notifications/${id}/ack`, of: (t) => t.ids.notification },
};
/** The path rows: (target, form). One line each, so a reviewer can read what is forged; the id is F-<target>-<form>. */
const PATH_ROWS: [keyof typeof TARGETS, Form][] = [
  ['mission', 'lower'], ['mission', 'spaceBefore'], ['mission', 'spaceAfter'], ['mission', 'tabNewline'], ['mission', 'pctAll'], ['mission', 'pctTwice'], ['mission', 'dotdot'], ['mission', 'dotsEncoded'],
  ['mission', 'cyrillic'], ['mission', 'fullwidth'], ['mission', 'zeroWidth'], ['mission', 'truncate1'], ['mission', 'wildcard'], ['mission', 'underscore'], ['mission', 'quote'], ['mission', 'semicolon'], ['mission', 'nul'], ['mission', 'withOwn'],
  ['agent', 'upper'], ['agent', 'spaceBefore'], ['agent', 'spaceAfter'], ['agent', 'pctAll'], ['agent', 'cyrillic'], ['agent', 'fullwidth'], ['agent', 'truncate1'], ['agent', 'truncate3'], ['agent', 'prefix2'], ['agent', 'wildcard'], ['agent', 'underscore'], ['agent', 'dotdot'], ['agent', 'quote'], ['agent', 'nul'],
  ['coder', 'upper'], ['coder', 'truncate1'], ['coder', 'prefix2'], ['coder', 'cyrillic'],
  ['task', 'lower'], ['task', 'spaceAfter'], ['task', 'cyrillic'], ['task', 'truncate1'], ['task', 'pctAll'],
  ['thread', 'upper'], ['thread', 'spaceBefore'], ['thread', 'truncate1'], ['thread', 'pctTwice'],
  ['upload', 'upper'], ['upload', 'truncate1'], ['upload', 'cyrillic'],
  ['lesson', 'lower'], ['lesson', 'wildcard'], ['skill', 'lower'], ['skill', 'truncate1'],
  ['instance', 'lower'], ['instance', 'spaceBefore'], ['instance', 'truncate1'],
  ['ack', 'lower'], ['ack', 'spaceAfter'], ['ack', 'truncate1'], ['ack', 'cyrillic'],
];
const mission = (t: Tenant) => ({ text: 'Forged scope ' + Date.now() + Math.random().toString(36).slice(2, 6), files: [], shared: false });
const STRUCTURAL: Forged[] = [
  { id: 'F-array-with-bracket', cls: 'array', what: 'compare: ?with[]= B\'s agent id, where one id is expected', req: (v, o) => ({ method: 'GET', url: `/agents/${v.ids.coder}/skills/compare?with[]=${enc(o.ids.tester)}` }) },
  { id: 'F-array-with-repeated', cls: 'array', what: 'compare: ?with= own agent, then ?with= B\'s agent (a repeated key)', req: (v, o) => ({ method: 'GET', url: `/agents/${v.ids.coder}/skills/compare?with=${enc(v.ids.tester)}&with=${enc(o.ids.tester)}` }) },
  { id: 'F-array-with-comma', cls: 'array', what: 'compare: ?with= own agent id, comma, B\'s agent id', req: (v, o) => ({ method: 'GET', url: `/agents/${v.ids.coder}/skills/compare?with=${enc(v.ids.tester + ',' + o.ids.tester)}` }) },
  { id: 'F-array-failure-subject', cls: 'array', what: 'failure tags: ?subjectId[]= B\'s task', req: (v, o) => ({ method: 'GET', url: `/failure-tags?subjectKind=task&subjectId[]=${enc(o.ids.task)}` }) },
  { id: 'F-array-failure-kind', cls: 'array', what: 'failure tags: ?subjectKind[]=task with B\'s task id', req: (v, o) => ({ method: 'GET', url: `/failure-tags?subjectKind[]=task&subjectId=${enc(o.ids.task)}` }) },
  { id: 'F-array-ackall-scalar', cls: 'array', what: 'ack-all: a bare id string where an array is expected', req: (v, o) => ({ method: 'POST', url: '/notifications/ack-all', body: { ids: o.ids.notification } }) },
  { id: 'F-array-ackall-nested', cls: 'array', what: 'ack-all: a nested array holding B\'s notice id', req: (v, o) => ({ method: 'POST', url: '/notifications/ack-all', body: { ids: [[o.ids.notification]] } }) },
  { id: 'F-array-thread-instance', cls: 'array', what: 'open thread: instanceId as an array holding B\'s instance', req: (v, o) => ({ method: 'POST', url: `/missions/${v.ids.mission}/threads`, body: { instanceId: [o.ids.instance] } }) },
  { id: 'F-array-mission-files', cls: 'array', what: 'new mission: files holding B\'s upload id', req: (v, o) => ({ method: 'POST', url: '/missions', body: { ...mission(v), files: [o.ids.upload] }, headers: idem() }) },
  { id: 'F-json-proto-body', cls: 'jsonpath', what: 'new mission with a "__proto__" key carrying a tenant', req: (v) => ({ method: 'POST', url: '/missions', body: JSON.parse(`{"__proto__":{"tenantId":"t-b"},"text":${JSON.stringify(mission(v).text)},"files":[],"shared":false}`), headers: idem() }) },
  { id: 'F-json-dollar-path', cls: 'jsonpath', what: 'new mission with keys "$.tenantId" and "a.b" in the body', req: (v) => ({ method: 'POST', url: '/missions', body: { ...mission(v), '$.tenantId': 't-b', 'a.b': 't-b' }, headers: idem() }) },
  { id: 'F-json-nested-filter', cls: 'jsonpath', what: 'new mission with a nested filter { tenant_id }', req: (v) => ({ method: 'POST', url: '/missions', body: { ...mission(v), filter: { tenant_id: 't-b' }, where: { tenant: 't-b' } }, headers: idem() }) },
  { id: 'F-json-ackall-path', cls: 'jsonpath', what: 'ack-all with an extra "$.ids[0]" key naming B\'s notice', req: (v, o) => ({ method: 'POST', url: '/notifications/ack-all', body: { ids: [v.ids.notification], '$.ids[0]': o.ids.notification } }) },
  { id: 'F-json-query-bracket', cls: 'jsonpath', what: 'missions list: ?tenant[id]=t-b', req: () => ({ method: 'GET', url: '/missions?tenant[id]=t-b' }) },
  { id: 'F-json-query-dotted', cls: 'jsonpath', what: 'missions list: ?filter.tenant_id=t-b&__proto__[tenantId]=t-b', req: () => ({ method: 'GET', url: '/missions?filter.tenant_id=t-b&__proto__[tenantId]=t-b' }) },
  { id: 'F-json-query-operator', cls: 'jsonpath', what: 'missions list: ?$where=tenant_id=\'t-b\'', req: () => ({ method: 'GET', url: '/missions?$where=' + enc("tenant_id='t-b'") }) },
  { id: 'F-json-agent-query', cls: 'jsonpath', what: 'agent list: ?tenantId[$ne]=t-1', req: () => ({ method: 'GET', url: '/agents?tenantId[$ne]=t-1' }) },
];
export const FORGED: Forged[] = [
  ...PATH_ROWS.map(([t, f]): Forged => {
    const T = TARGETS[t];
    return { id: `F-${t}-${f}`, cls: CLS[f], what: `${T.method} ${T.path('<' + f + ' of B\'s ' + T.name + ' id>')}`, req: (_v, o) => ({ method: T.method, url: T.path(FORMS[f](T.of(o))), ...(T.method === 'POST' ? { body: {} } : {}) }) };
  }),
  ...STRUCTURAL,
];

export interface ForgedRow { id: string; cls: Class; as: string; status: number }
/** Runs the table as `view` (the administrator, and the member for GET rows). */
export async function forgedScope(w: World, view0: Tenant, other0: Tenant, arm?: () => void): Promise<{ violations: Violation[]; rows: ForgedRow[] }> {
  const v: Violation[] = []; const rows: ForgedRow[] = [];
  const view = await freshSessions(view0), other = await freshSessions(other0);
  arm?.();
  const otherCases = getCases(other).cases;
  await snapshot(other, otherCases, 'admin');
  const bBefore = await snapshot(other, otherCases, 'admin'); const restBefore = await atRestText(w, other.tenantId);
  const foreignIds = Object.entries(other.ids).filter(([k, x]) => x.length >= 6 && !/^(adminId|memberId|memberName|device)$/.test(k)).map(([, x]) => x);
  for (const f of FORGED) {
    for (const [name, b] of [['admin', view.admin], ['member', view.member]] as const) {
      const rq = f.req(view, other);
      if (name === 'member' && rq.method !== 'GET') continue;
      const r = await b.req(rq.method, rq.url, rq.body, rq.headers ?? {});
      rows.push({ id: f.id, cls: f.cls, as: name, status: r.status });
      const where = `${f.id} as ${name}: ${rq.method} ${rq.url.slice(0, 90)}`;
      if (r.status >= 500 || r.status === 429) v.push({ relation: 'MR4', where, detail: `status ${r.status}: ${r.raw.body.slice(0, 120)}` });
      v.push(...markerHits(r.raw.body, other, where).map((x) => ({ ...x, relation: 'MR4' as const })));
      const sent = decodeURIComponent(rq.url.replace(/%00/g, '')) + JSON.stringify(rq.body ?? ''); // an id the caller itself sent may be echoed back in an error ("unknown file f-..."); that is not B's data
      for (const id of foreignIds) if (r.raw.body.includes(id) && !sent.includes(id)) v.push({ relation: 'MR4', where, detail: `the answer contains tenant ${other.tag}'s id ${id}` });
    }
  }
  const bAfter = await snapshot(other, otherCases, 'admin');
  for (const x of diffSnaps(bBefore, bAfter, 'MR4')) v.push({ ...x, detail: 'tenant ' + other.tag + ' changed after the forged requests: ' + x.detail });
  const restAfter = new Map((await atRestText(w, other.tenantId)).map((r) => [r.table, r.text]));
  const sorted = (t: string) => t.split('\n').sort().join('\n');
  for (const r of restBefore) if (!AT_REST_VOLATILE.has(r.table) && sorted(restAfter.get(r.table) ?? '') !== sorted(r.text)) v.push({ relation: 'MR4', where: `at rest ${r.table}`, detail: `rows of tenant ${other.tag} changed after the forged requests` });
  return { violations: v, rows };
}
