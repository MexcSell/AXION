import type { Db, Tx } from '../db.ts';
import { VISIBLE_SQL } from '../missions/visibility.ts';
import { isTier } from '../policy/types.ts';
import { STALE_BEFORE_SQL } from '../tasks/reviews.ts';
import { failureModeOf } from '../failures/taxonomy.ts';
import { ATTENTION_SETTINGS } from '../../../shared/contracts/src/index.ts';
import type { AttentionItem } from './types.ts';

type Q = Tx | Db;
export interface Viewer { tenantId: string; user: { id: string; role: string } }
const num = (v: unknown) => Number(v);
/** seconds as computed by the database; a null stays null */
const secs = (v: unknown) => (v === null || v === undefined ? null : Math.max(0, Math.floor(Number(v))));

/**
 * Every item that needs a person now, as the stored records say. Each reader applies the same visibility rule as the route its rows
 * come from (missions: VISIBLE_SQL; proposals: the tenant; lessons: an administrator, or the person who made or filed it).
 * Read only: nothing here sweeps, expires or writes. All ages, distances and thresholds are computed in SQL with now().
 */
export async function loadItems(c: Q, v: Viewer): Promise<AttentionItem[]> {
  const admin = v.user.role === 'admin';
  const out = await Promise.all([approvals(c, v, admin), staleReviews(c, v, admin), waitingTasks(c, v, admin), undetectedFailures(c, v, admin), orgProposals(c, v), versionProposals(c, v), lessons(c, v, admin)]);
  return out.flat();
}

async function approvals(c: Q, v: Viewer, admin: boolean): Promise<AttentionItem[]> {
  const rows = (await c.query(
    `select a.*, extract(epoch from now() - a.created_at) as age_s, extract(epoch from a.expires_at - now()) as exp_s
       from approval_requests a join missions m on m.id = a.mission_id
      where a.tenant_id=$1 and m.deleted_at is null and ${VISIBLE_SQL('$2', '$3')} and a.state='pending' and a.expires_at > now()`, [v.tenantId, admin, v.user.id])).rows;
  return rows.map((r) => ({
    id: `approval:${r.id}`, reason: 'approval_pending' as const, kind: 'approval' as const, tier: isTier(r.risk) ? r.risk : 'R4', subject: r.title,
    ageSec: secs(r.age_s)!, expiresInSec: secs(r.exp_s), missionId: r.mission_id, demo: !!r.demo, route: '/notifications?tab=pending',
    facts: { tier: isTier(r.risk) ? r.risk : 'R4', kind: r.kind, missionId: r.mission_id, ageSec: secs(r.age_s)!, expiresInSec: secs(r.exp_s) },
  }));
}

async function staleReviews(c: Q, v: Viewer, admin: boolean): Promise<AttentionItem[]> {
  const rows = (await c.query(
    `select r.id as review_id, r.task_id, r.mission_id, r.created_at, t.title, m.demo, r.verdict,
            (select ra.attempt_no from task_attempts ra where ra.id = r.attempt_id) as reviewed_attempt,
            ${STALE_BEFORE_SQL('r')} as latest_attempt,
            extract(epoch from now() - coalesce((select la.started_at from task_attempts la where la.task_id = r.task_id order by la.attempt_no desc limit 1), r.created_at)) as age_s
       from task_reviews r join tasks t on t.id = r.task_id join missions m on m.id = r.mission_id
      where r.tenant_id=$1 and m.deleted_at is null and ${VISIBLE_SQL('$2', '$3')} and t.status <> 'canceled'
        and r.seq = (select max(x.seq) from task_reviews x where x.task_id = r.task_id) and ${STALE_BEFORE_SQL('r')} is not null`, [v.tenantId, admin, v.user.id])).rows;
  return rows.map((r) => ({
    id: `review:${r.task_id}`, reason: 'review_stale' as const, kind: 'task_review' as const, tier: null, subject: r.title,
    ageSec: secs(r.age_s)!, expiresInSec: null, missionId: r.mission_id, demo: !!r.demo, route: `/missions/${r.mission_id}?tab=task-flow`,
    facts: { taskId: r.task_id, missionId: r.mission_id, reviewedAttempt: num(r.reviewed_attempt ?? 0), latestAttempt: num(r.latest_attempt), ageSec: secs(r.age_s)!, verdict: r.verdict },
  }));
}

async function waitingTasks(c: Q, v: Viewer, admin: boolean): Promise<AttentionItem[]> {
  const rows = (await c.query(
    `select t.id, t.title, t.mission_id, m.demo, se.at is not null as has_change,
            extract(epoch from now() - coalesce(se.at, t.created_at)) as age_s
       from tasks t join missions m on m.id = t.mission_id
       left join lateral (select max(e.occurred_at) as at from events e where e.tenant_id = t.tenant_id and e.type = 'task.stateChanged' and e.subject_id = t.id and e.payload->>'to' = 'waiting_user') se on true
      where t.tenant_id=$1 and m.deleted_at is null and ${VISIBLE_SQL('$2', '$3')} and t.status = 'waiting_user'
        and coalesce(se.at, t.created_at) <= now() - make_interval(hours => $4::int)`, [v.tenantId, admin, v.user.id, ATTENTION_SETTINGS.waitingHours])).rows;
  return rows.map((r) => ({
    id: `waiting:${r.id}`, reason: 'task_waiting_person' as const, kind: 'task_waiting' as const, tier: null, subject: r.title,
    ageSec: secs(r.age_s)!, expiresInSec: null, missionId: r.mission_id, demo: !!r.demo, route: `/missions/${r.mission_id}?tab=task-flow`,
    facts: { taskId: r.id, missionId: r.mission_id, ageSec: secs(r.age_s)!, since: r.has_change ? 'state change' : 'task creation' },
  }));
}

async function undetectedFailures(c: Q, v: Viewer, admin: boolean): Promise<AttentionItem[]> {
  const rows = (await c.query(
    `select f.id, f.mission_id, f.subject_kind, f.subject_id, f.mode_id, f.mechanism, f.control_expected, f.control_caught, m.demo, f.self_confirmed,
            extract(epoch from now() - f.decided_at) as age_s
       from failure_tags f join missions m on m.id = f.mission_id
      where f.tenant_id=$1 and m.deleted_at is null and ${VISIBLE_SQL('$2', '$3')} and f.status = 'confirmed' and f.detection_channel is null
        and f.decided_at > now() - make_interval(days => $4::int)
        and not exists (select 1 from failure_tags g where g.tenant_id = f.tenant_id and g.subject_kind = f.subject_kind and g.subject_id = f.subject_id and g.status = 'confirmed' and g.detection_channel is not null)`,
    [v.tenantId, admin, v.user.id, ATTENTION_SETTINGS.failureWindowDays])).rows;
  return rows.map((r) => {
    const mode = failureModeOf(r.mode_id)?.mode.name ?? r.mode_id;
    return {
      id: `failure:${r.id}`, reason: 'failure_no_detection' as const, kind: 'failure' as const, tier: null, subject: mode,
      ageSec: secs(r.age_s)!, expiresInSec: null, missionId: r.mission_id, demo: !!r.demo, route: `/missions/${r.mission_id}?tab=task-flow`,
      facts: { tagId: r.id, modeId: r.mode_id, modeName: mode, missionId: r.mission_id, subjectKind: r.subject_kind, subjectId: r.subject_id, ageSec: secs(r.age_s)!, mechanism: r.mechanism, controlExpected: r.control_expected, controlCaught: r.control_caught, selfConfirmed: r.self_confirmed ? 'yes' : 'no' },
    };
  });
}

async function orgProposals(c: Q, v: Viewer): Promise<AttentionItem[]> {
  const rows = (await c.query(
    `select p.id, p.title, p.base_revision, extract(epoch from now() - p.created_at) as age_s, extract(epoch from p.expires_at - now()) as exp_s,
            (select max(seq) from org_revisions r where r.tenant_id = p.tenant_id) as active_revision
       from org_proposals p
      where p.tenant_id=$1 and p.status = 'pending' and p.expires_at > now() and p.expires_at <= now() + make_interval(hours => $2::int)`, [v.tenantId, ATTENTION_SETTINGS.nearExpiryHours])).rows;
  return rows.map((r) => ({
    id: `org:${r.id}`, reason: 'org_proposal_expiring' as const, kind: 'proposal' as const, tier: null, subject: r.title,
    ageSec: secs(r.age_s)!, expiresInSec: secs(r.exp_s), missionId: null, demo: false, route: '/agents?tab=proposals',
    facts: { proposalId: r.id, expiresInSec: secs(r.exp_s), ageSec: secs(r.age_s)!, baseRevision: num(r.base_revision), activeRevision: r.active_revision === null ? null : num(r.active_revision) },
  }));
}

async function versionProposals(c: Q, v: Viewer): Promise<AttentionItem[]> {
  const rows = (await c.query(
    `select p.id, p.title, p.agent_id, p.base_version_id, d.active_version_id, extract(epoch from now() - p.created_at) as age_s, extract(epoch from p.expires_at - now()) as exp_s
       from agent_version_proposals p join agent_definitions d on d.id = p.agent_id
      where p.tenant_id=$1 and p.status = 'pending' and p.expires_at > now() and p.expires_at <= now() + make_interval(hours => $2::int)`, [v.tenantId, ATTENTION_SETTINGS.nearExpiryHours])).rows;
  return rows.map((r) => ({
    id: `version:${r.id}`, reason: 'version_proposal_expiring' as const, kind: 'proposal' as const, tier: null, subject: r.title,
    ageSec: secs(r.age_s)!, expiresInSec: secs(r.exp_s), missionId: null, demo: false, route: '/agents?tab=proposals',
    facts: { proposalId: r.id, agentId: r.agent_id, expiresInSec: secs(r.exp_s), ageSec: secs(r.age_s)!, baseIsActive: r.base_version_id === r.active_version_id ? 'yes' : 'no' },
  }));
}

async function lessons(c: Q, v: Viewer, admin: boolean): Promise<AttentionItem[]> {
  const rows = (await c.query(
    `select l.id, l.agent_id, l.text, l.sha256, jsonb_array_length(l.sources) as n_sources, l.origin_class, l.origin_channel, p.mode_id, p.failure_count, p.department_count,
            extract(epoch from now() - l.created_at) as age_s
       from lesson_candidates l left join failure_pattern_candidates p on p.candidate_id = l.id
      where l.tenant_id=$1 and l.status = 'proposed' and ($2::boolean or l.proposed_by = $3 or l.submitted_by = $3)`, [v.tenantId, admin, v.user.id])).rows;
  return rows.map((r) => ({
    id: `lesson:${r.id}`, reason: r.mode_id ? ('lesson_system_derived' as const) : ('lesson_awaiting_review' as const), kind: 'lesson' as const, tier: null, subject: r.text,
    ageSec: secs(r.age_s)!, expiresInSec: null, missionId: null, demo: false, route: `/agents/${r.agent_id}?tab=memory`,
    facts: { lessonId: r.id, agentId: r.agent_id, ageSec: secs(r.age_s)!, sources: num(r.n_sources), originClass: r.origin_class, originChannel: r.origin_channel, modeId: r.mode_id ?? null, failures: r.failure_count === null ? null : num(r.failure_count), departments: r.department_count === null ? null : num(r.department_count) },
  }));
}
