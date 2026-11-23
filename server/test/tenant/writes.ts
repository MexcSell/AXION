import type { Browser } from '../helpers.ts';
import { ROUTES } from '../contracts/registry.ts';
import { idem, type Tenant, type World } from './fixture.ts';
import { atRestText, freshSessions, getCases, snapshot, diffSnaps, markerHits, type Violation } from './isolation.ts';

/**
 * Item 3 of c79: for every POST, PUT, PATCH and DELETE route whose path takes an id, tenant A acting on tenant B's id (and B on A's) must
 * get 404 or 403, and nothing may change in the owner's tenant. The cases are generated from the route table: a write route with an id and
 * neither a case nor a listed exception fails the inventory test. Bodies are shaped to pass validation, so the id check is what answers.
 */
export interface Req { url: string; body?: unknown; headers?: Record<string, string> }
type Builder = (target: Tenant, viewer: Tenant) => Req | Promise<Req>;
const D64 = 'f'.repeat(64);
const rowVersion = async (target: Tenant, path: string, pick: (b: any) => number) => String(pick((await target.admin.req('GET', path)).body));
const brief = { goal: 'Goal', inputs: [], acceptance: ['Done'], capabilities: [{ kind: 'read' }], escalation: 'Ask' };

export const WRITE_CASES: Record<string, Builder> = {
  'DELETE /me/devices/:did': (t) => ({ url: `/me/devices/${t.ids.device}` }),
  'DELETE /missions/:id': (t) => ({ url: `/missions/${t.ids.mission2}` }),
  'DELETE /users/:id/devices/:did': (t) => ({ url: `/users/${t.ids.memberId}/devices/${t.ids.device}` }),
  'PATCH /agents/:id': async (t) => ({ url: `/agents/${t.ids.newAgent}`, body: { description: 'hijacked' }, headers: { 'if-match': await rowVersion(t, `/agents/${t.ids.newAgent}`, (b) => b.agent.rowVersion) } }),
  'PATCH /missions/:id': async (t) => ({ url: `/missions/${t.ids.mission2}`, body: { title: 'hijacked' }, headers: { 'if-match': await rowVersion(t, `/missions/${t.ids.mission2}`, (b) => b.mission.rowVersion) } }),
  'PATCH /users/:id': (t) => ({ url: `/users/${t.ids.memberId}`, body: { role: 'admin' } }),
  'POST /agents/:id/lessons': (t) => ({ url: `/agents/${t.ids.coder}/lessons`, body: { text: 'Planted lesson', sources: [{ kind: 'review', id: 'REV-1', note: 'x' }] }, headers: idem() }),
  'POST /agents/:id/mentoring': (t) => ({ url: `/agents/${t.ids.coder}/mentoring`, body: { mentorId: t.ids.coder, skill: 'Planted', milestones: ['One'], reevalOn: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10) }, headers: idem() }),
  'POST /agents/:id/playbook/rollback': (t) => ({ url: `/agents/${t.ids.coder}/playbook/rollback`, body: { toVersion: 1, baseVersion: 2, why: 'Planted rollback' } }),
  'POST /agents/:id/rollback': async (t) => ({ url: `/agents/${t.ids.coder}/rollback`, body: { toVersionId: (await t.admin.req('GET', `/agents/${t.ids.coder}`)).body.agent.versionId, why: 'Planted rollback' }, headers: idem() }),
  'POST /agents/:id/version-proposals': async (t) => { const a = (await t.admin.req('GET', `/agents/${t.ids.coder}`)).body.agent; return { url: `/agents/${t.ids.coder}/version-proposals`, body: { title: 'Planted', hypothesis: 'x', candidate: { model: a.model, skills: [...a.skills, 'Planted'], tools: a.tools }, baseVersionId: a.versionId }, headers: idem() }; },
  'POST /approvals/:id/decision': (t) => ({ url: `/approvals/${t.ids.approval}/decision`, body: { decision: 'approved', digest: D64, reason: 'planted' } }),
  'POST /channels/:key/messages': (t) => ({ url: `/channels/agent:${t.ids.coder}/messages`, body: { kind: 'command', text: 'Planted' }, headers: idem() }),
  'POST /channels/admin/:userId/messages': (t) => ({ url: `/channels/admin/${t.ids.memberId}/messages`, body: { kind: 'reply', text: 'Planted' }, headers: idem() }),
  'POST /failure-tags/:id/decision': (t) => ({ url: `/failure-tags/${t.ids.tag}/decision`, body: { decision: 'confirm' } }),
  'POST /failure-tags/:id/attributions': (t) => ({ url: `/failure-tags/${t.ids.tag}/attributions`, body: { agentId: 'planted-agent', stepRef: 'step-9' }, headers: idem() }),
  'POST /lessons/:lid/decision': (t) => ({ url: `/lessons/${t.ids.lesson}/decision`, body: { decision: 'accept', baseVersion: 0, note: 'planted' } }),
  'POST /mentoring/:pid/close': (t) => ({ url: `/mentoring/${t.ids.plan}/close`, body: { outcome: 'completed', note: 'planted' } }),
  'POST /mentoring/:pid/milestones/:mid/done': (t) => ({ url: `/mentoring/${t.ids.plan}/milestones/${t.ids.milestone}/done`, body: {} }),
  'POST /missions/:id/actions/:action': (t) => ({ url: `/missions/${t.ids.mission2}/actions/pause`, body: {}, headers: idem() }),
  'POST /missions/:id/delegation-briefs': (t) => ({ url: `/missions/${t.ids.mission}/delegation-briefs`, body: { toInstanceId: t.ids.instance, brief }, headers: idem() }),
  'POST /missions/:id/ledgers/:kind': (t) => ({ url: `/missions/${t.ids.mission}/ledgers/progress`, body: { baseVersion: 1, body: { satisfied: false, looping: false, progressing: true, notes: 'planted' } } }),
  'POST /missions/:id/share': (t) => ({ url: `/missions/${t.ids.mission2}/share`, body: { shared: false } }),
  'POST /missions/:id/staffing/retry': (t) => ({ url: `/missions/${t.ids.mission2}/staffing/retry`, body: {}, headers: idem() }),
  'POST /missions/:id/threads': (t) => ({ url: `/missions/${t.ids.mission}/threads`, body: { instanceId: t.ids.instance } }),
  'POST /notifications/:id/ack': (t) => ({ url: `/notifications/${t.ids.notification}/ack` }),
  'POST /organization/proposals/:id/decision': (t) => ({ url: `/organization/proposals/${t.ids.orgProposal}/decision`, body: { decision: 'approve', sha: D64, note: 'planted' } }),
  'POST /organization/proposals/:id/withdraw': (t) => ({ url: `/organization/proposals/${t.ids.orgProposal}/withdraw`, body: {} }),
  'POST /site-grants/:id/revoke': (t) => ({ url: `/site-grants/${t.ids.grant}/revoke`, body: { reason: 'planted' } }),
  'POST /skills/:sid/approve': (t) => ({ url: `/skills/${t.ids.skill}/approve`, body: {} }),
  'POST /skills/:sid/retire': (t) => ({ url: `/skills/${t.ids.skill}/retire`, body: { note: 'planted' } }),
  'POST /skills/:sid/retirement-dismiss': (t) => ({ url: `/skills/${t.ids.skill}/retirement-dismiss`, body: { note: 'planted' } }),
  'POST /tasks/:id/:action': (t) => ({ url: `/tasks/${t.ids.task}/retry`, body: {}, headers: idem() }),
  'POST /tasks/:id/reviews': (t) => ({ url: `/tasks/${t.ids.task3}/reviews`, body: { verdict: 'accepted', rubric: [{ criterion: 'planted', result: 'pass', note: 'x' }], evidence: [{ kind: 'url', ref: 'https://example.com/planted' }] }, headers: idem() }),
  'POST /threads/:id/messages': (t) => ({ url: `/threads/${t.ids.thread}/messages`, body: { kind: 'command', text: 'Planted', to: t.ids.instance.split(':')[1] }, headers: idem() }),
  'POST /users/:id/approve': (t) => ({ url: `/users/${t.ids.memberId}/approve` }),
  'POST /users/:id/devices/:did/:action': (t) => ({ url: `/users/${t.ids.memberId}/devices/${t.ids.device}/block` }),
  'POST /users/:id/reject': (t) => ({ url: `/users/${t.ids.memberId}/reject` }),
  'POST /version-proposals/:pid/decision': (t) => ({ url: `/version-proposals/${t.ids.versionProposal}/decision`, body: { decision: 'promote', sha: D64, evaluationSha: D64, note: 'planted' } }),
  'POST /version-proposals/:pid/withdraw': (t) => ({ url: `/version-proposals/${t.ids.versionProposal}/withdraw`, body: {} }),
};
/** Write routes with an id that have no foreign-id case, with the reason. */
export const WRITE_EXCEPTIONS: Record<string, string> = {
  'POST /organization/revisions/:seq/rollback-proposal': 'The id is a per-tenant revision counter (1, 2, ...), so the same number names a different record in each tenant; there is no foreign id to send. The proposal it creates is stored under the caller\'s own tenant (checked by the at-rest sweep of the owner).',
};
/**
 * Routes that may answer 200 for a foreign id, each with the check that proves the effect is scoped to the caller. Empty since c81: the only
 * entry, `POST /notifications/:id/ack`, now answers 404 for an id the caller cannot see and stores nothing (it was a reasoned exception in c79).
 */
export const SELF_SCOPED_OK: Record<string, (w: World, view: Tenant, other: Tenant, rq: Req) => Promise<string | null>> = {};
/** Which records exist per tenant: tenant B has no organisation chart, so org ids only exist for A. Cases whose target lacks the id are skipped and counted. */
const needs: Record<string, string[]> = { 'POST /organization/proposals/:id/decision': ['orgProposal'], 'POST /organization/proposals/:id/withdraw': ['orgProposal'] };

/** Every write route in the table with a `:param` in its path (the generated population). */
export const writeRoutesWithIds = (t: Tenant): string[] =>
  [...new Set(t.app.routeTable.filter((r) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method) && r.url.includes(':')).map((r) => `${r.method} ${r.url.replace(/^\/api\/v1/, '')}`))].sort();

export interface WriteResult { key: string; as: string; status: number; skipped?: string }
/** `view` acts on `other`'s ids. As the administrator (all routes) and, for routes that are not administrator-only, as the member. */
export async function foreignWrites(w: World, view0: Tenant, other0: Tenant, arm?: () => void): Promise<{ violations: Violation[]; results: WriteResult[] }> {
  const violations: Violation[] = []; const results: WriteResult[] = [];
  const view = await freshSessions(view0), other = await freshSessions(other0);
  arm?.();
  const { cases } = getCases(other);
  await snapshot(other, cases, 'admin'); // warm-up: reading marks channels and threads read once
  const before = await snapshot(other, cases, 'admin');
  const restBefore = await atRestText(w, other.tenantId);
  for (const key of Object.keys(WRITE_CASES)) {
    if ((needs[key] ?? []).some((k) => !other.ids[k])) { results.push({ key, as: 'admin', status: 0, skipped: `tenant ${other.tag} has no ${needs[key].join(', ')}` }); continue; }
    const [method, pattern] = key.split(' ');
    const roles: [string, Browser][] = [['admin', view.admin]];
    const entry = ROUTES[key]; if (entry && 'v' in entry && !entry.admin) roles.push(['member', view.member]);
    for (const [name, b] of roles) {
      const rq = await WRITE_CASES[key](other, view);
      const r = await b.req(method, rq.url, rq.body, rq.headers ?? {});
      results.push({ key, as: name, status: r.status });
      if (r.status === 200 && key in SELF_SCOPED_OK) { // answers 200, which is allowed only when the stored effect is scoped to the caller
        const bad = await SELF_SCOPED_OK[key](w, view, other, rq);
        if (bad) violations.push({ relation: 'WRITE', where: `${name} ${key}`, detail: bad });
        continue;
      }
      if (![403, 404].includes(r.status)) violations.push({ relation: 'WRITE', where: `${name} ${method} ${rq.url}`, detail: `status ${r.status} ${JSON.stringify(r.body)?.slice(0, 160)}, expected 404 or 403` });
      violations.push(...markerHits(r.raw.body, other, `${name} ${key}`));
    }
    void pattern;
  }
  const after = await snapshot(other, cases, 'admin');
  for (const x of diffSnaps(before, after, 'WRITE')) violations.push({ ...x, detail: 'the owner tenant changed after the foreign attempts: ' + x.detail });
  const restAfter = new Map((await atRestText(w, other.tenantId)).map((r) => [r.table, r.text]));
  for (const r of restBefore) if (!AT_REST_VOLATILE.has(r.table) && restAfter.get(r.table) !== r.text) violations.push({ relation: 'WRITE', where: `at rest ${r.table}`, detail: `rows of tenant ${other.tag} changed after the foreign attempts` });
  return { violations, results };
}
/** Tables whose rows change when anyone reads (a session's last-used time), so a byte comparison there proves nothing. */
export const AT_REST_VOLATILE = new Set<string>(['sessions']);
