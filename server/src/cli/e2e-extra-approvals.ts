/**
 * Harness only (api-c58.mjs), e2e databases only (isE2eDatabaseUrl). Usage: e2e-extra-approvals.ts <n> [--fired]
 *  - adds n pending, non-demo approvals (kind submit_form) to the mission of the first live agent instance, so the approval-quality statistics can
 *    reach five decisions (demo requests are never counted);
 *  - with --fired, first gives that agent a real delegation brief (read at an origin, plus release) and asks a real `release` approval through
 *    requestApproval, so the server itself derives all three Rule-of-Two flags and the rule fires. Nothing about the flags is written by hand.
 * Prints one JSON line: { missionId, firedId }.
 */
import { makePool, tx } from '../db.ts';
import { requestApproval } from '../approvals/service.ts';
import { DelegationBriefIn, briefSha } from '../delegation/brief.ts';
import { isE2eDatabaseUrl } from './e2e-url.ts';

const url = process.env.E2E_DATABASE_URL;
if (!isE2eDatabaseUrl(url)) throw new Error('E2E_DATABASE_URL must point at axion_e2e or axion_e2e<N>');
const n = Number(process.argv[2] || 4);
const fired = process.argv.includes('--fired');
const pool = makePool(url, undefined, 1);
const inst = (await pool.query(`select i.id, i.tenant_id, i.mission_id, i.agent_id from agent_instances i join missions m on m.id=i.mission_id where i.ended_at is null and m.deleted_at is null order by i.mission_id, i.seq limit 1`)).rows[0];
if (!inst) throw new Error('no live agent instance in the e2e database yet: sign in first');
// the plain requests come first: the flags describe the agent's configuration, so once it holds the brief below every request of that agent fires
for (let i = 0; i < n; i++) await tx(pool, (c) => requestApproval(c, { tenantId: inst.tenant_id, missionId: inst.mission_id, agentId: inst.agent_id, kind: 'submit_form', title: `Extra approval ${i + 1}`, detail: 'Added by the e2e harness for the statistics.', payload: { extra: i }, expiresInMin: 24 * 60 }));
let firedId: string | null = null;
if (fired) {
  const brief = DelegationBriefIn.parse({ goal: 'Check the status page and ship the release', inputs: [], acceptance: ['The release is shipped'], capabilities: [{ kind: 'read', origin: 'https://example.com' }, { kind: 'release' }], escalation: 'Ask the mission owner' });
  await pool.query(`insert into delegation_briefs(tenant_id, mission_id, from_id, from_kind, to_instance, to_agent, brief, sha256, depth, created_by) values ($1,$2,'c58-harness','user',$3,$4,$5,$6,1,'c58-harness')`,
    [inst.tenant_id, inst.mission_id, inst.id, inst.agent_id, JSON.stringify(brief), briefSha(brief)]);
  firedId = (await tx(pool, (c) => requestApproval(c, { tenantId: inst.tenant_id, missionId: inst.mission_id, agentId: inst.agent_id, kind: 'release', title: 'Ship release (Rule of Two fires)', detail: 'Created by the e2e harness through requestApproval; the server derived the flags.', payload: { harness: 'fired' }, expiresInMin: 24 * 60 }))).id;
}
await pool.end();
console.log(JSON.stringify({ missionId: inst.mission_id, firedId }));
