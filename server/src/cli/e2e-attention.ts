/**
 * Harness only (api-c68.mjs), e2e databases only (isE2eDatabaseUrl). Usage: e2e-attention.ts <sharedMissionId> <privateMissionId>
 * Adds, through the same writers the server uses or plain inserts, one record of every kind the "Needs you" queue lists, so the
 * browser check can look at a full list: pending approvals of three tiers (two R2 of the shared mission fold into one row), stale reviews,
 * tasks waiting on a person, confirmed failures with no detection channel (three of one mode fold), proposals near expiry and one
 * system-derived lesson. Rows on the private mission must not reach a member. Prints one JSON line with the ids.
 */
import { randomBytes } from 'node:crypto';
import { makePool, tx } from '../db.ts';
import { requestApproval } from '../approvals/service.ts';
import { proposeLesson } from '../agents/playbooks.ts';
import { isE2eDatabaseUrl } from './e2e-url.ts';

const url = process.env.E2E_DATABASE_URL;
if (!isE2eDatabaseUrl(url)) throw new Error('E2E_DATABASE_URL must point at axion_e2e or axion_e2e<N>');
const [shared, priv] = process.argv.slice(2);
if (!shared || !priv) throw new Error('usage: e2e-attention.ts <sharedMissionId> <privateMissionId>');
const pool = makePool(url, undefined, 1);
const id = (p: string) => p + randomBytes(5).toString('hex');
const tenant = (await pool.query('select tenant_id from missions where id=$1', [shared])).rows[0].tenant_id as string;
const admin = (await pool.query(`select id from users where tenant_id=$1 and role='admin' order by created_at limit 1`, [tenant])).rows[0].id as string;
const reviewer = (await pool.query(`select id from users where tenant_id=$1 and role <> 'admin' order by created_at limit 1`, [tenant])).rows[0].id as string;
const ask = (mission: string, kind: string, title: string) => tx(pool, (c) => requestApproval(c, { tenantId: tenant, missionId: mission, agentId: 'release-01', kind, title, detail: 'Added by the e2e harness.', payload: { harness: id('') }, expiresInMin: 6 * 60 }));
const out: Record<string, string> = {};

out.r2a = (await ask(shared, 'submit_form', 'Submit the vendor form')).id;
out.r2b = (await ask(shared, 'submit_form', 'Submit the tax form')).id;
out.r3 = (await ask(shared, 'release', 'Publish the release notes')).id;
out.r4 = (await ask(shared, 'production_deploy', 'Deploy the checkout to production')).id;
out.r2p = (await ask(priv, 'submit_form', 'Private form')).id;
out.r3p = (await ask(priv, 'release', 'Private release')).id;

const task = async (mission: string, status: string, title: string, created = '0 seconds') => {
  const t = id('T-c68-');
  await pool.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, created_at) values ($1,$2,$3,$4,$5,'coder-01', now() - $6::interval)`, [t, tenant, mission, title, status, created]);
  return t;
};
const stale = async (mission: string, title: string) => {
  const t = await task(mission, 'passed', title);
  const a1 = (await pool.query(`insert into task_attempts(task_id, attempt_no, started_at, finished_at, result) values ($1,1, now() - interval '3 days', now() - interval '2 days','passed') returning id`, [t])).rows[0].id;
  await pool.query(`insert into task_reviews(id, tenant_id, mission_id, task_id, attempt_id, reviewer_id, reviewer_kind, producer_id, producer_kind, principal_id, rubric, verdict, evidence, created_at)
    values ($1,$2,$3,$4,$5,$6,'user','coder-01','agent','u-owner','[{"criterion":"The output is attached","result":"pass","note":""}]','accepted','[{"kind":"url","ref":"https://example.com/r"}]', now() - interval '2 days')`, [id('TR-'), tenant, mission, t, a1, reviewer]);
  await pool.query(`insert into task_attempts(task_id, attempt_no, started_at) values ($1,2, now() - interval '5 hours')`, [t]);
  return t;
};
out.stale = await stale(shared, 'Write the quarterly report');
out.staleP = await stale(priv, 'Private report');
const waiting = async (mission: string, title: string) => {
  const t = await task(mission, 'waiting_user', title, '2 days');
  await pool.query(`insert into events(tenant_id, type, mission_id, subject_kind, subject_id, payload, occurred_at) values ($1,'task.stateChanged',$2,'task',$3,$4, now() - interval '30 hours')`, [tenant, mission, t, JSON.stringify({ taskId: t, from: 'running', to: 'waiting_user' })]);
  return t;
};
out.waiting = await waiting(shared, 'Confirm the brand colour');
out.waitingP = await waiting(priv, 'Private question');
const failure = async (mission: string, mode: string) => {
  const t = await task(mission, 'failed', 'A failed task');
  await pool.query(`insert into failure_tags(id, tenant_id, mission_id, subject_kind, subject_id, taxonomy_version, mode_id, tagged_by, tagged_by_kind, status, decided_by, decided_at)
    values ($1,$2,$3,'task',$4,'mast-arxiv-2503.13657v3',$5,$6,'user','confirmed',$7, now() - interval '1 day')`, [id('FT-'), tenant, mission, t, mode, admin, reviewer]);
  return t;
};
for (let i = 0; i < 3; i++) out['fail' + i] = await failure(shared, 'FM-3.2');
out.failOne = await failure(shared, 'FM-1.3');
out.failP = await failure(priv, 'FM-2.2');

out.org = id('OP-');
await pool.query(`insert into org_proposals(id, tenant_id, title, why, base_revision, edges, payload_sha, created_by, expires_at) values ($1,$2,'Move the QA team','because',1,'[]',$3,$4, now() + interval '10 hours')`, [out.org, tenant, id('sha'), admin]);
out.version = id('VP-');
const v = (await pool.query(`select active_version_id as v from agent_definitions where id='coder-01' and tenant_id=$1`, [tenant])).rows[0].v;
await pool.query(`insert into agent_version_proposals(id, tenant_id, agent_id, base_version_id, base_sha, candidate, candidate_sha, title, created_by, expires_at)
  values ($1,$2,'coder-01',$3,'sha','{"model":"m","skills":[],"tools":[]}',$4,'Try a newer model',$5, now() + interval '20 hours')`, [out.version, tenant, v, id('c'), admin]);
out.system = await tx(pool, (c) => proposeLesson(c, { tenantId: tenant, agentId: 'coder-01', proposedBy: 'failure-pattern-review', kind: 'agent', channel: 'tool_output', text: 'System-derived from tool records, not written by a person. FM-3.2 recurred in two departments.', sources: [{ kind: 'failure_tag', id: 'FT-x' }], correlationId: 'c68-harness' }));
await pool.query(`insert into failure_pattern_candidates(id, tenant_id, mode_id, window_days, candidate_id, failure_count, department_count, departments, task_ids, tag_ids) values ($1,$2,'FM-3.2',30,$3,3,2,'["A","B"]','[]','[]')`, [id('FP-'), tenant, out.system]);
await pool.end();
console.log(JSON.stringify(out));
