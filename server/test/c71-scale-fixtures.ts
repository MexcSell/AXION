import type pg from 'pg';

/**
 * c71 (P6): a seeded company of `tasks` tasks (about ten per mission), insert-only (the append-only triggers stay on), shared by the
 * standing equivalence test, the on-demand budget test and scripts/c71-scale.ts. Deterministic: every value derives from the series
 * number, so two runs give the same rows (apart from ids the database generates).
 *
 * Distribution (per mission g of M = tasks / 10):
 *  - owner: the admin (even g) or the member (odd g); 1 in 3 missions private (not shared); 1 in 25 DEMO; deleted: none
 *  - status cycle completed, completed, failed, running, canceled, waiting_approval; created 1..110 days ago (so 7d / 30d / 90d windows differ)
 *  - about `perMission` (default 10, 5..15) tasks (status follows the mission); every started task has attempt 1, one in four a second attempt, one in twelve a third
 *  - reviews on about 60% of started tasks by the person who is neither owner nor producer; one in nine gets a second review;
 *    one in five points at attempt 1 (so it goes stale when a later attempt exists)
 *  - events: the mission transitions (draft→running→waiting_approval→completed, some fail→retry→complete, one restore from archived)
 *  - approvals: one per mission, decided by the owner or by the other person; 'verifies' delegations on 60% of missions; one brief per task
 *  - progress ledgers (2 per mission), confirmed failure tags on failed tasks
 */
export async function seedScale(pool: pg.Pool, o: { tasks: number; tenant?: string; adminId: string; memberId: string; prefix?: string; perMission?: number }) {
  const T = o.tenant ?? 't-1', A = o.adminId, B = o.memberId, P = o.prefix ?? 'SC';
  const tpm = o.perMission ?? 10; // average tasks per mission: 10 by default; the c69 reviewer's 25k data had many small missions, so the bench also runs 3
  const M = Math.max(1, Math.round(o.tasks / tpm));
  const q = (s: string, p: unknown[] = []) => pool.query(s, p);
  const mid = (g: string) => `'${P}-M-' || ${g}`;
  await q(`insert into missions (id, tenant_id, owner_id, shared, status, demo, created_at, updated_at)
           select ${mid('g')}, $1, case when g % 2 = 0 then $2 else $3 end, g % 3 <> 0,
                  (array['completed','completed','failed','running','canceled','waiting_approval'])[1 + g % 6], g % 25 = 0,
                  now() - ((1 + (g * 7) % 110) || ' days')::interval - ((g % 24) || ' hours')::interval, now()
             from generate_series(1, $4::int) g`, [T, A, B, M]);
  await q(`insert into mission_revisions (mission_id, revision, title, kind, priority, text, created_by)
           select id, 1, 'Scale mission ' || id, 'research', 'normal', 'seeded', owner_id from missions where id like '${P}-M-%'`);
  await q(`insert into mission_runs (mission_id, revision, status, started_at)
           select id, 1, 'done', created_at + interval '1 minute' from missions where id like '${P}-M-%' and status <> 'planning' and (abs(hashtext(id)) % 10) <> 0`);
  await q(`insert into agent_instances (id, tenant_id, mission_id, agent_id, agent_version_id, state, created_at)
           select m.id || ':' || a.id, $1, m.id, a.id, a.active_version_id, 'done', m.created_at
             from missions m cross join lateral (select id, active_version_id from agent_definitions where tenant_id=$1 order by id offset (abs(hashtext(m.id)) % 5) limit 4) a
            where m.id like '${P}-M-%'`, [T]);
  await q(`insert into tasks (id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id, simulated, created_at)
           select m.id || '-T' || k, $1, m.id, 'task ' || k,
                  case m.status
                    when 'completed' then (case when m.n % 5 < 3 then 'passed' else (array['passed','passed','failed','passed'])[1 + k % 4] end)
                    when 'failed' then (array['failed','passed','failed','retry_ready'])[1 + k % 4]
                    when 'canceled' then (array['canceled','passed','canceled'])[1 + k % 3]
                    when 'running' then (array['running','passed','created','passed','ready'])[1 + k % 5]
                    else (array['waiting_user','passed','passed','waiting_agent'])[1 + k % 4] end,
                  i.agent_id, i.id, (m.n % 40 = 0 and k = 0), m.created_at + ((k + 2) || ' minutes')::interval
             from (select id, status, created_at, row_number() over (order by id) as n from missions where id like '${P}-M-%') m
             cross join lateral generate_series(0, (case when $2::int >= 6 then $2::int - 5 + abs(hashtext(m.id)) % 11 else 1 + abs(hashtext(m.id)) % (2 * $2::int - 1) end) - 1) k
             cross join lateral (select id, agent_id from agent_instances where mission_id = m.id order by id offset (k % 4) limit 1) i`, [T, tpm]);
  await q(`insert into task_attempts (task_id, attempt_no, started_at, finished_at, result)
           select t.id, a, t.created_at + (a * 3 || ' minutes')::interval, t.created_at + (a * 3 || ' minutes')::interval + interval '30 seconds', 'ok'
             from tasks t cross join lateral generate_series(1, case when abs(hashtext(t.id)) % 12 = 0 then 3 when abs(hashtext(t.id)) % 4 = 0 then 2 else 1 end) a
            where t.id like '${P}-M-%' and t.status <> 'created'`);
  // reviews: neither the mission owner nor the producer reviews (the table's own checks); the "other" person reviews
  await q(`insert into task_reviews (id, tenant_id, mission_id, task_id, attempt_id, reviewer_id, reviewer_kind, producer_id, producer_kind, principal_id, rubric, verdict, evidence, created_at)
           select t.id || '-R' || r, $1, t.mission_id, t.id,
                  (select a.id from task_attempts a where a.task_id = t.id order by case when abs(hashtext(t.id)) % 5 = 0 then a.attempt_no else -a.attempt_no end limit 1),
                  case when m.owner_id = $2 then $3 else $2 end, 'user', t.owner_agent, 'agent', m.owner_id, '[{"c":"ok"}]'::jsonb,
                  case when abs(hashtext(t.id || r)) % 5 = 0 then 'changes_requested' else 'accepted' end,
                  case when abs(hashtext(t.id || r)) % 5 = 0 then '[]'::jsonb else '["e1"]'::jsonb end,
                  t.created_at + ((20 + r * 10) || ' minutes')::interval
             from tasks t join missions m on m.id = t.mission_id cross join lateral generate_series(1, case when abs(hashtext(t.id)) % 9 = 0 then 2 else 1 end) r
            where t.id like '${P}-M-%' and t.status <> 'created' and abs(hashtext(t.id)) % 10 < 6`, [T, A, B]);
  await q(`insert into mission_delegations (mission_id, from_instance, to_instance, edge_kind, simulated, at)
           select i.mission_id, min(i.id), max(i.id), 'delegated', false, min(i.created_at) + interval '2 minutes' from agent_instances i where i.mission_id like '${P}-M-%' group by i.mission_id having min(i.id) <> max(i.id)`);
  await q(`insert into mission_delegations (mission_id, from_instance, to_instance, edge_kind, simulated, at)
           select i.mission_id, min(i.id), max(i.id), 'verifies', false, min(i.created_at) + interval '30 minutes' from agent_instances i
            where i.mission_id like '${P}-M-%' and abs(hashtext(i.mission_id)) % 10 < 6 group by i.mission_id having min(i.id) <> max(i.id)`);
  await q(`insert into delegation_briefs (tenant_id, mission_id, task_id, from_id, from_kind, to_instance, to_agent, brief, sha256, depth, simulated, created_by, created_at)
           select $1, t.mission_id, t.id, m.owner_id, 'user', t.owner_instance_id, t.owner_agent, '{"goal":"x"}'::jsonb, md5(t.id) || md5(t.id || 'x'), 1, false, m.owner_id, t.created_at
             from tasks t join missions m on m.id = t.mission_id where t.id like '${P}-M-%' and t.owner_instance_id is not null`, [T]);
  await q(`insert into approval_requests (id, tenant_id, mission_id, agent_id, kind, title, risk, action_digest, digest_version, state, created_at, expires_at)
           select 'AP-' || id, $1, id, 'x', 'k', 'approve', 'R1', 'd', 2, 'approved', created_at + interval '10 minutes', now() + interval '1 day' from missions where id like '${P}-M-%'`, [T]);
  await q(`insert into approval_decisions (approval_id, decision, digest, decided_by, decided_at)
           select 'AP-' || id, 'approved', 'd', case when abs(hashtext(id)) % 3 = 0 then owner_id when owner_id = $1 then $2 else $1 end, created_at + interval '25 minutes' from missions where id like '${P}-M-%'`, [A, B]);
  await q(`insert into mission_ledgers (tenant_id, mission_id, kind, version, body, author_id, author_kind, created_at, demo)
           select $1, m.id, 'progress', v, jsonb_build_object('summary', 'p' || v, 'done', v, 'total', 2), m.owner_id, 'human', m.created_at + (v * 15 || ' minutes')::interval, m.demo
             from missions m cross join generate_series(1, 2) v where m.id like '${P}-M-%'`, [T]);
  // events: seq per mission is unique
  await q(`insert into events (tenant_id, type, mission_id, seq, subject_kind, subject_id, payload, occurred_at)
           select $1, 'mission.stateChanged', m.id, s.n, 'mission', m.id, jsonb_build_object('from', s.f, 'to', s.t), m.created_at + (s.n * 10 || ' minutes')::interval
             from missions m cross join lateral (values
               (1, 'draft', 'running'), (2, 'running', 'waiting_approval'),
               (3, 'waiting_approval', case m.status when 'completed' then 'completed' when 'failed' then 'failed' when 'canceled' then 'canceled' else 'running' end)) s(n, f, t)
            where m.id like '${P}-M-%' and (m.status in ('completed', 'failed', 'canceled') or s.n < 3 or m.status = 'running')`, [T]);
  // every fifth completed mission failed first and was retried; every 17th final mission was archived and restored (a restore re-emits the old final state)
  await q(`insert into events (tenant_id, type, mission_id, seq, subject_kind, subject_id, payload, occurred_at)
           select $1, 'mission.stateChanged', m.id, s.n, 'mission', m.id, jsonb_build_object('from', s.f, 'to', s.t), m.created_at + (s.n * 10 || ' minutes')::interval
             from (select id, status, created_at, row_number() over (order by id) as r from missions where id like '${P}-M-%' and status = 'completed') m
             cross join lateral (values (4, 'completed', 'archived'), (5, 'archived', 'completed')) s(n, f, t) where m.r % 17 = 0`, [T]);
  await q(`insert into events (tenant_id, type, mission_id, seq, subject_kind, subject_id, payload, occurred_at)
           select $1, 'mission.stateChanged', m.id, s.n, 'mission', m.id, jsonb_build_object('from', s.f, 'to', s.t), m.created_at + (s.n * 10 || ' minutes')::interval
             from (select id, status, created_at, row_number() over (order by id) as r from missions where id like '${P}-M-%' and status = 'completed') m
             cross join lateral (values (6, 'completed', 'running'), (7, 'running', 'failed'), (8, 'failed', 'running'), (9, 'running', 'completed')) s(n, f, t)
            where m.r % 5 = 0 and m.r % 17 <> 0`, [T]);
  await q(`insert into events (tenant_id, type, subject_kind, subject_id, payload, occurred_at)
           select $1, 'task.stateChanged', 'task', t.id, jsonb_build_object('from', 'running', 'to', t.status), t.created_at + interval '12 minutes'
             from tasks t where t.id like '${P}-M-%' and t.status in ('passed', 'failed')`, [T]);
  await q(`insert into failure_tags (id, tenant_id, mission_id, subject_kind, subject_id, taxonomy_version, mode_id, tagged_by, tagged_by_kind, status, created_at, decided_by, decided_at)
           select t.id || '-F', $1, t.mission_id, 'task', t.id, 'mast-arxiv-2503.13657v3', 'FM-1.' || (1 + abs(hashtext(t.id)) % 3), m.owner_id, 'user', 'confirmed', t.created_at + interval '40 minutes', m.owner_id, t.created_at + interval '41 minutes'
             from tasks t join missions m on m.id = t.mission_id where t.id like '${P}-M-%' and t.status = 'failed'`, [T]);
  await q('analyze');
  return M;
}
