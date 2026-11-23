/**
 * Harness only (api-c72.mjs), e2e databases only (isE2eDatabaseUrl). Usage: e2e-skill-fixture.ts
 * Gives two agents of the first live mission finished tasks whose briefs name a task class and a difficulty, with plain inserts (the same rows the
 * brief and task routes write), so the Agent Profile can show filled, null and unrated cells:
 *  - coding: agent A passes 15 of 16 and agent B 3 of 16, both at levels 2 and 3 (shared levels: distinguishable);
 *  - research: A has 5 passes at level 1 and B 5 at level 5 (no shared level: indistinguishable);
 *  - writing: A has 3 outcomes (under 5: not enough evidence); one finished task of A has a class but no difficulty (unrated).
 * Prints one JSON line: { missionId, a, b, names }.
 */
import { createHash } from 'node:crypto';
import { makePool } from '../db.ts';
import { isE2eDatabaseUrl } from './e2e-url.ts';

const url = process.env.E2E_DATABASE_URL;
if (!isE2eDatabaseUrl(url)) throw new Error('E2E_DATABASE_URL must point at axion_e2e or axion_e2e<N>');
const pool = makePool(url, undefined, 1);
const only = process.argv[2];
const first = only ? { mission_id: only } : (await pool.query(`select i.mission_id from agent_instances i join missions m on m.id=i.mission_id where i.ended_at is null and m.deleted_at is null and m.demo = false order by i.mission_id, i.seq limit 1`)).rows[0]
  ?? (await pool.query(`select i.mission_id from agent_instances i join missions m on m.id=i.mission_id where i.ended_at is null and m.deleted_at is null order by i.mission_id, i.seq limit 1`)).rows[0];
if (!first) throw new Error('no live agent instance in the e2e database yet: sign in first');
const insts = (await pool.query(`select id, agent_id, tenant_id from agent_instances where mission_id=$1 and ended_at is null order by seq`, [first.mission_id])).rows as { id: string; agent_id: string; tenant_id: string }[];
const A = insts[0], B = insts.find((x) => x.agent_id !== A.agent_id);
if (!B) throw new Error('the mission has only one agent');
const sha = (o: unknown) => createHash('sha256').update(JSON.stringify(o)).digest('hex'); // the e2e check only needs a 64-hex value here
let k = 0;
const tag = Date.now().toString(36);
const fin = async (ag: typeof A, status: 'passed' | 'failed', cls: string | null, d: number | null) => {
  const id = `T-c72e-${tag}-${++k}`;
  await pool.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent) values ($1,$2,$3,$4,$5,$6)`, [id, ag.tenant_id, first.mission_id, `c72 fixture ${k}`, status, ag.agent_id]);
  const brief = { goal: `c72 fixture task ${k}`, inputs: [], acceptance: ['Done'], capabilities: [{ kind: 'read' }], escalation: 'Ask the mission owner', ...(cls ? { taskClass: cls } : {}), ...(d ? { difficulty: d } : {}) };
  await pool.query(`insert into delegation_briefs(tenant_id, mission_id, task_id, from_id, from_kind, to_instance, to_agent, brief, sha256, depth, created_by) values ($1,$2,$3,'c72-harness','user',$4,$5,$6,$7,1,'c72-harness')`,
    [ag.tenant_id, first.mission_id, id, ag.id, ag.agent_id, JSON.stringify(brief), sha(brief)]);
};
for (let i = 0; i < 16; i++) { await fin(A, i < 15 ? 'passed' : 'failed', 'coding', 2 + (i % 2)); await fin(B, i < 3 ? 'passed' : 'failed', 'coding', 2 + (i % 2)); }
for (let i = 0; i < 5; i++) { await fin(A, 'passed', 'research', 1); await fin(B, 'passed', 'research', 5); }
for (let i = 0; i < 3; i++) await fin(A, 'passed', 'writing', 3);
await fin(A, 'passed', 'review', null);
const names = (await pool.query(`select id, name from agent_definitions where id = any($1)`, [[A.agent_id, B.agent_id]])).rows;
await pool.end();
console.log(JSON.stringify({ missionId: first.mission_id, a: A.agent_id, b: B.agent_id, names }));
