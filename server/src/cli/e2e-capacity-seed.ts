/**
 * Harness only (api-c65.mjs), e2e databases only (isE2eDatabaseUrl). Usage: e2e-capacity-seed.ts [--lost]   (no flag: the sample; --lost: only the lost-close row, after the sample)
 *  - adds 24 decided (non-demo) approvals raised by the first live agent, decided by the first admin, one member and a third person, with
 *    stored latencies (the c58 columns), plus 3 still-pending ones, so the capacity view has numbers (percentiles need 20 decided);
 *  - with --lost, ONLY one approval (run it after the sample) that says "approved" but has no decision row (a lost close event), so the Little's-law check must fail.
 * Rows are inserted directly (the tables accept inserts). Prints one JSON line: { missionId, admin, member, third }.
 */
import { makePool } from '../db.ts';
import { isE2eDatabaseUrl } from './e2e-url.ts';

const url = process.env.E2E_DATABASE_URL;
if (!isE2eDatabaseUrl(url)) throw new Error('E2E_DATABASE_URL must point at axion_e2e or axion_e2e<N>');
const lost = process.argv.includes('--lost');
const pool = makePool(url, undefined, 1);
const inst = (await pool.query(`select i.tenant_id, i.mission_id, i.agent_id from agent_instances i join missions m on m.id=i.mission_id where i.ended_at is null and m.deleted_at is null order by i.mission_id, i.seq limit 1`)).rows[0];
if (!inst) throw new Error('no live agent instance in the e2e database yet: sign in first');
const users = (await pool.query(`select id, name, role from users where tenant_id=$1 and status='approved' order by created_at`, [inst.tenant_id])).rows;
const admin = users.find((u) => u.role === 'admin')?.id as string, member = users.find((u) => u.role === 'member')?.id as string, third = 'u-c65-third';
if (!admin || !member) throw new Error('needs an approved admin and an approved member');
const people = [admin, member, third];
const HOUR = 3_600_000;
for (let i = 0; i < 24 && !lost; i++) {
  const id = `APR-c65-${i}`, lat = (i + 1) * 90_000; // 1.5 to 36 minutes
  await pool.query(`insert into approval_requests(id, tenant_id, mission_id, agent_id, kind, title, risk, action_digest, digest_version, state, created_at, expires_at)
    values ($1,$2,$3,$4,'submit_form',$5,'R2','x',2,'approved', now() - ($6 || ' milliseconds')::interval, now() + interval '30 days')`, [id, inst.tenant_id, inst.mission_id, inst.agent_id, `Capacity sample ${i + 1}`, String((2 + (i % 20)) * HOUR)]);
  await pool.query(`insert into approval_decisions(approval_id, decision, reason, digest, decided_by, decided_at, latency_ms, queue_size, fast_bulk)
    values ($1,'approved','','d',$2, now() - ($3 || ' milliseconds')::interval, $4, $5, false)`, [id, people[i % 3], String((2 + (i % 20)) * HOUR - lat), lat, 1 + (i % 4)]);
}
for (let i = 0; i < 3 && !lost; i++) await pool.query(`insert into approval_requests(id, tenant_id, mission_id, agent_id, kind, title, risk, action_digest, digest_version, state, created_at, expires_at)
  values ($1,$2,$3,$4,'submit_form',$5,'R2','x',2,'pending', now() - interval '20 minutes', now() + interval '30 days')`, [`APR-c65-open-${i}`, inst.tenant_id, inst.mission_id, inst.agent_id, `Capacity waiting ${i + 1}`]);
if (lost) await pool.query(`insert into approval_requests(id, tenant_id, mission_id, agent_id, kind, title, risk, action_digest, digest_version, state, created_at, expires_at)
  values ('APR-c65-lost',$1,$2,$3,'submit_form','Capacity lost close','R2','x',2,'approved', now() - interval '3 hours', now() + interval '30 days')`, [inst.tenant_id, inst.mission_id, inst.agent_id]);
await pool.end();
console.log(JSON.stringify({ missionId: inst.mission_id, admin, member, third }));
