import type { Db } from '../db.ts';
import { tx } from '../db.ts';
import { audit } from '../audit.ts';
import { requestApproval, TIER_OF } from '../approvals/service.ts';
import { MISSIONS, FIXTURE_OWNERS, getMissionControl } from '../../../web/src/data/missions.ts';

const SERVER_STATUS: Record<string, string> = { waiting: 'waiting_approval', queued: 'queued', canceled: 'canceled' };
const now = () => Date.now();

/**
 * Owner decision D5: the prototype's fixture missions go into the real database marked demo=true (shown with the DEMO tag).
 * Every fixture owner maps to the first administrator; each mission keeps its `shared` flag. No fake accounts are made.
 * Idempotent: missions that already exist are skipped.
 */
export async function seedDemo(db: Db, tenantId: string, adminId: string) {
  return tx(db, async (c) => {
    let missions = 0, approvals = 0;
    for (const m of MISSIONS) {
      const exists = (await c.query('select 1 from missions where id=$1', [m.id])).rowCount;
      if (exists) continue;
      const { id, title, kind, priority, status, objective, criteria, content, owner: _o, ownerId: _oi, shared: _s, revision, lastEventAgoMin, summaryAgoMin, ...rest } = m;
      void _o; void _oi; void _s;
      const t = now();
      const presentation = { ...rest, objective, revision, lastEventAt: t - lastEventAgoMin * 60_000, summaryAt: t - summaryAgoMin * 60_000 };
      await c.query(`insert into missions(id, tenant_id, owner_id, shared, status, current_revision, demo, presentation, created_at, archived_at)
                     values ($1,$2,$3,$4,$5,1,true,$6, now() - make_interval(days => $7), case when $5='archived' then now() else null end)`,
        [id, tenantId, adminId, FIXTURE_OWNERS[id]?.shared ?? false, SERVER_STATUS[status] ?? status, JSON.stringify({ ...presentation, ...(status === 'archived' ? { preArchive: 'completed' } : {}) }), m.createdAgoDays]);
      await c.query(`insert into mission_revisions(mission_id, revision, title, kind, priority, text, files, criteria, created_by) values ($1,1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, title, kind, priority, content?.text || objective, JSON.stringify(content?.files ?? []), JSON.stringify(criteria), adminId]);
      missions++;
      for (const a of getMissionControl(m).approvals) {
        await requestApproval(c, {
          tenantId, missionId: id, id: a.id, agentId: a.agentId, kind: a.kind, title: a.title, detail: a.detail, risk: TIER_OF[a.risk] ?? 'R2',
          payload: { fixture: a.id, detail: a.detail }, expiresInMin: a.expiresMin, createdAgoMin: a.agoMin, demo: true,
        });
        approvals++;
      }
    }
    if (missions) await audit(c, { tenantId, actor: 'system', action: 'demo.seed', subject: tenantId, result: 'ok', correlationId: 'seed-' + Date.now(), detail: { missions, approvals } });
    return { missions, approvals };
  });
}

/** `npm run demo:clear`: removes only demo=true rows (and their approvals); real missions stay. */
export async function clearDemo(db: Db, tenantId: string) {
  return tx(db, async (c) => {
    const r = await c.query('delete from missions where tenant_id=$1 and demo=true returning id', [tenantId]);
    await audit(c, { tenantId, actor: 'system', action: 'demo.clear', subject: tenantId, result: 'ok', correlationId: 'clear-' + Date.now(), detail: { missions: r.rowCount } });
    return { missions: r.rowCount ?? 0 };
  });
}
