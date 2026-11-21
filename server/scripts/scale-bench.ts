/**
 * Cycle 10 scale benchmark. Runs ONLY against a parallel lane's e2e database (axion_e2e<N>): empties it, migrates to
 * 0016, seeds one tenant with 300 missions / 3,000 tasks / 6,000 attempts / 50,000 events / 20,000 audit rows (insert
 * only, so the append-only triggers stay on), times the read endpoints (BEFORE), applies migration 0017, times again
 * (AFTER) and prints EXPLAIN ANALYZE of the hot queries both times.
 * Run: /home/luca/AXION-lanes/heavy.sh npx tsx --env-file=.env scripts/scale-bench.ts
 */
import pg from 'pg';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.ts';
import { migrate } from '../src/migrate.ts';
import { Browser } from '../test/helpers.ts';

const url = process.env.E2E_DATABASE_URL;
if (!url || !/\/axion_e2e\d+(\?|$)/.test(url)) throw new Error('E2E_DATABASE_URL must be a lane database axion_e2e<N>');
const RUNS = 20;
const T = 't-1';

const pool = new pg.Pool({ connectionString: url, max: 3 });
await migrate(pool, 'down', 0);
await migrate(pool, 'up', 16);

const app = await buildApp({ databaseUrl: url, logger: false, uploadDir: mkdtempSync(join(tmpdir(), 'axion-scale-')), demoSeed: false });
const admin = new Browser(app);
const c = await admin.connect('Luca', 'pass1234');
if (c.status !== 200) throw new Error('connect failed');
const adminId = (await pool.query(`select id from users where tenant_id=$1 order by created_at limit 1`, [T])).rows[0].id as string;

async function seed() {
  const q = (s: string, p: unknown[] = []) => pool.query(s, p);
  // 300 missions over 60 days, mixed states, half shared
  await q(`insert into missions (id, tenant_id, owner_id, shared, status, created_at, updated_at)
           select 'M-' || (5000+g), $1, $2, g % 2 = 0,
                  (array['completed','completed','failed','running','canceled','waiting_approval'])[1 + g % 6],
                  now() - (g % 60 || ' days')::interval, now() from generate_series(1,300) g`, [T, adminId]);
  await q(`insert into mission_revisions (mission_id, revision, title, kind, priority, text, created_by)
           select id, 1, 'Scale mission ' || id, 'research', 'normal', 'seeded', $1 from missions where id like 'M-5%'`, [adminId]);
  await q(`insert into mission_runs (mission_id, revision, status, started_at)
           select id, 1, 'done', created_at + interval '1 minute' from missions where id like 'M-5%'`);
  // 4 instances per mission from the seeded company
  await q(`insert into agent_instances (id, tenant_id, mission_id, agent_id, agent_version_id, state, created_at)
           select m.id || ':' || a.id, $1, m.id, a.id, a.active_version_id, 'done', m.created_at
             from missions m cross join lateral (select id, active_version_id from agent_definitions where tenant_id=$1 order by id offset (abs(hashtext(m.id)) % 5) limit 4) a
            where m.id like 'M-5%'`, [T]);
  // 10 tasks per mission
  await q(`insert into tasks (id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id, created_at)
           select 'TS-' || m.n || '-' || k, $1, m.id, 'task ' || k, (array['passed','passed','passed','failed','running','passed','retry_ready','passed','canceled','passed'])[1 + k % 10],
                  i.agent_id, i.id, m.created_at + (k || ' minutes')::interval
             from (select id, row_number() over (order by id) as n, created_at from missions where id like 'M-5%') m
             cross join generate_series(0,9) k
             cross join lateral (select id, agent_id from agent_instances where mission_id = m.id order by id offset (k % 4) limit 1) i`, [T]);
  await q(`insert into task_attempts (task_id, attempt_no, started_at, finished_at, result)
           select t.id, a, t.created_at + (a || ' minutes')::interval, t.created_at + (a || ' minutes')::interval + interval '30 seconds', 'ok'
             from tasks t cross join generate_series(1,2) a where t.id like 'TS-%'`);
  await q(`insert into mission_delegations (mission_id, from_instance, to_instance, edge_kind, at)
           select i.mission_id, min(i.id), max(i.id), 'verifies', now() from agent_instances i where i.mission_id like 'M-5%' group by i.mission_id having min(i.id) <> max(i.id)`);
  await q(`insert into approval_requests (id, tenant_id, mission_id, agent_id, kind, title, risk, action_digest, state, created_at, expires_at)
           select 'AP-' || id, $1, id, 'x', 'k', 'approve', 'R1', 'd', 'approved', created_at, now() + interval '1 day' from missions where id like 'M-5%'`, [T]);
  await q(`insert into approval_decisions (approval_id, decision, digest, decided_by, decided_at)
           select 'AP-' || id, 'approved', 'd', $1, created_at + interval '5 minutes' from missions where id like 'M-5%'`, [adminId]);
  // events: ~2 mission transitions x 300 (+ run), 6,000 task transitions, filler to 50,000 in total (insert only)
  await q(`insert into events (tenant_id, type, mission_id, seq, subject_kind, subject_id, payload, occurred_at)
           select $1, 'mission.stateChanged', m.id, s, 'mission', m.id,
                  jsonb_build_object('from', (array['draft','running','waiting_approval'])[s], 'to', (array['running','waiting_approval','completed'])[s]),
                  m.created_at + (s * 10 || ' minutes')::interval
             from missions m cross join generate_series(1,3) s where m.id like 'M-5%' and m.status in ('completed')`, [T]);
  await q(`insert into events (tenant_id, type, subject_kind, subject_id, payload, occurred_at)
           select $1, 'task.stateChanged', 'task', t.id, jsonb_build_object('from','running','to', t.status), t.created_at + interval '20 minutes' from tasks t where t.id like 'TS-%'`, [T]);
  const have = Number((await q(`select count(*) from events where tenant_id=$1`, [T])).rows[0].count);
  await q(`insert into events (tenant_id, type, subject_kind, subject_id, payload, occurred_at)
           select $1, (array['instance.stateChanged','message.sent','note.added'])[1 + g % 3], 'x', 'x' || g, '{}'::jsonb, now() - (g % 40 || ' days')::interval from generate_series(1, 50000 - $2::int) g`, [T, have]);
  await q(`insert into audit_events (tenant_id, at, actor, action, subject, result, correlation_id, detail)
           select $1, now() - (g % 40 || ' days')::interval, $2, 'task.reassign', t.id, 'ok', 'c' || g,
                  jsonb_build_object('from','running','fromAgent', t.owner_agent)
             from (select id, owner_agent, row_number() over () g from tasks where id like 'TS-%' limit 3000) t`, [T, adminId]);
  await q(`insert into audit_events (tenant_id, at, actor, action, subject, result, correlation_id, detail)
           select $1, now() - (g % 40 || ' days')::interval, $2, (array['auth.login','mission.update','approval.decide'])[1 + g % 3], 'x' || g, 'ok', 'f' || g, '{}'::jsonb
             from generate_series(1, 20000 - 3000 - (select count(*) from audit_events where tenant_id=$1)::int + 3000) g`, [T, adminId]);
  await q('analyze');
}
await seed();
const counts = (await pool.query(`select (select count(*) from missions where id like 'M-5%') m, (select count(*) from tasks where id like 'TS-%') t, (select count(*) from task_attempts) a, (select count(*) from events) e, (select count(*) from audit_events) au, (select count(*) from agent_instances) i`)).rows[0];
console.log('seeded', JSON.stringify(counts));

const ENDPOINTS = ['/company/scorecard', '/agents', '/missions', '/agent-instances'];
async function bench(label: string) {
  const out: Record<string, { p50: number; p95: number; bytes: number }> = {};
  for (const ep of ENDPOINTS) {
    for (let i = 0; i < 3; i++) await admin.req('GET', ep); // warm-up
    const ts: number[] = []; let bytes = 0;
    for (let i = 0; i < RUNS; i++) { const t0 = performance.now(); const r = await admin.req('GET', ep); ts.push(performance.now() - t0); if (r.status !== 200) throw new Error(ep + ' ' + r.status); bytes = r.raw.body.length; }
    ts.sort((a, b) => a - b);
    out[ep] = { p50: +ts[Math.floor(RUNS / 2)].toFixed(1), p95: +ts[Math.ceil(RUNS * 0.95) - 1].toFixed(1), bytes };
  }
  console.log(label, JSON.stringify(out));
}
const EXPLAINS: Record<string, string> = {
  scorecard_transitions: `select mission_id, payload->>'from', payload->>'to', occurred_at from events where tenant_id='${T}' and type='mission.stateChanged' and mission_id = any(array(select id from missions where tenant_id='${T}' and deleted_at is null)) and occurred_at <= now() order by id`,
  reliability_ev: `select e.subject_id, e.payload->>'to', max(e.occurred_at) from events e where e.tenant_id='${T}' and e.type='task.stateChanged' and e.subject_id in (select id from tasks where status in ('passed','failed')) group by 1,2`,
  reliability_att: `select a.task_id, max(greatest(a.started_at, a.finished_at)) from task_attempts a where a.task_id in (select id from tasks where status in ('passed','failed')) group by 1`,
  reliability_audit: `select x.subject, x.at from audit_events x where x.tenant_id='${T}' and x.action='task.reassign' and x.result='ok' and x.subject in (select id from tasks where status in ('passed','failed'))`,
  instances_list: `select i.* from agent_instances i join missions m on m.id=i.mission_id where m.tenant_id='${T}' and m.deleted_at is null order by i.created_at desc, i.seq desc limit 500`,
};
async function explain(label: string) {
  // the full agent-reliability query, taken verbatim from the source with literal parameters
  const full = readFileSync(join(import.meta.dirname, '..', 'src/agents/reliability.ts'), 'utf8').match(/`(with vis as[\s\S]*?)`,\n/)![1]
    .replace("${VISIBLE_SQL('$2', '$3')}", '($2::boolean or m.owner_id = $3 or m.shared)').replace(/\$1/g, `'${T}'`).replace(/\$2/g, 'true').replace(/\$3/g, `'${adminId}'`).replace(/\$4/g, 'false');
  EXPLAINS.reliability_full = full;
  for (const [k, sql] of Object.entries(EXPLAINS)) {
    const rows = (await pool.query('explain (analyze, buffers off, timing off) ' + sql)).rows.map((r) => r['QUERY PLAN'] as string);
    const top = rows.filter((r) => k === 'reliability_full' || /Seq Scan|Index|Bitmap|Execution Time/.test(r)).map((r) => r.trim().slice(0, 110));
    console.log(`EXPLAIN ${label} ${k}:\n  ` + top.join('\n  '));
  }
}
await bench('BEFORE');
await explain('BEFORE');
await migrate(pool, 'up');
await pool.query('analyze');
await bench('AFTER');
await explain('AFTER');
await bench('AFTER2');
await app.close();
await pool.end();
