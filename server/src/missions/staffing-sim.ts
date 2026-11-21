import type { FastifyInstance } from 'fastify';
import { tx } from '../db.ts';
import { emit } from '../events/hooks.ts';
import { transition, toUiStatus, type MissionStatus } from './machine.ts';
import { insertInstance, joinMission } from '../instances/service.ts';
import { advance } from '../../../web/src/features/mission/staffing-plan.ts';

/**
 * Stage 5 (owner decision D6): the GM → executor → agents staffing runs on the server as a labelled simulation.
 * Every step is a real `staffing.progressed` event with simulated:true, so the UI animates from server events.
 * Nothing executes: no model, browser or process is started. Real agents arrive in Stage 6.
 */
export function startStaffingSim(app: FastifyInstance, stepMs = 1500) {
  const timers = new Map<string, NodeJS.Timeout>();
  let closed = false;

  const schedule = (id: string, delay = stepMs) => {
    if (closed || timers.has(id)) return;
    timers.set(id, setTimeout(() => { timers.delete(id); void step(id); }, delay));
  };
  const stop = (id: string) => { const t = timers.get(id); if (t) clearTimeout(t); timers.delete(id); };

  async function step(id: string) {
    if (closed) return;
    let more = false;
    try {
      more = await tx(app.db, async (c) => {
        const r = (await c.query('select * from missions where id=$1 and deleted_at is null for update', [id])).rows[0];
        if (!r || !['planning', 'running'].includes(r.status)) return false;
        const p = r.presentation ?? {};
        if (!p.staffing || p.staffing.stage === 'working') return false;
        const now = Date.now();
        // Stage 6: the team lives in agent_instances. The GM instance exists from the first step.
        const simulated = !!r.demo; // staffing of a real mission is the real record, even though nothing executes
        if (await insertInstance(c, { tenantId: r.tenant_id, missionId: id, agentId: 'gm', ...(simulated ? { state: 'working', task: 'Coordinating mission plan' } : {}), simulated })) {
          await emit(c, { tenantId: r.tenant_id, type: 'instance.created', subjectKind: 'instance', subject: `${id}:gm`, missionId: id, actor: 'gm', actorKind: 'agent', payload: { instanceId: `${id}:gm`, agentId: 'gm', simulated } });
        }
        const team = (await c.query('select agent_id from agent_instances where mission_id=$1 order by seq', [id])).rows.map((x) => x.agent_id as string);
        const view = { ...p, id, status: toUiStatus(r.status), agentIds: team, progress: p.progress ?? 0 };
        const patch = advance(view as never, now) as Record<string, any> | null;
        if (!patch) return false;
        const { status: nextStatus, lastEventAgoMin: _l, summaryAgoMin: _s, agentIds: _a, ...rest } = patch;
        void _l; void _s; void _a; // agentIds is derived from instances, never written to presentation
        const pres: Record<string, unknown> = { ...rest };
        if (rest.lastEvent) pres.lastEventAt = now;
        if (rest.summary) pres.summaryAt = now;
        let to: MissionStatus = r.status;
        if (nextStatus === 'running' && r.status === 'planning') to = transition('planning', 'start');
        const u = await c.query(`update missions set presentation = presentation || $2::jsonb, status=$3, row_version=row_version+1, updated_at=now() where id=$1 and status=$4 returning id`,
          [id, JSON.stringify(pres), to, r.status]);
        if (!u.rowCount) return false;
        const st = rest.staffing as { stage: string; joined: number; plan: { agentId: string; why: string; managerId?: string }[] };
        const joinedAgent = st.stage === 'recruiting' ? st.plan[st.joined - 1]?.agentId : st.stage === 'appointing' ? p.executorId : undefined;
        if (joinedAgent && joinedAgent !== 'gm') {
          // cycle 11: a real mission's plan names each agent's manager (fixed when the mission was created); DEMO plans never do
          const planned = st.stage === 'recruiting' ? st.plan[st.joined - 1]?.managerId : undefined;
          const mgr = st.stage === 'appointing' ? 'gm' : !simulated && planned && team.includes(planned) ? planned : (p.executorId as string);
          await joinMission(c, { tenantId: r.tenant_id, missionId: id, agentId: joinedAgent, managerAgentId: mgr, simulated,
            task: st.stage === 'appointing' ? 'General executor' : st.plan[st.joined - 1]?.why ?? '' });
        }
        await emit(c, { tenantId: r.tenant_id, type: 'staffing.progressed', subject: id, missionId: id, actor: st.stage === 'appointing' ? 'gm' : p.executorId ?? 'gm', actorKind: 'agent',
          payload: { simulated: true, stage: st.stage, joined: st.joined, agentId: joinedAgent, text: rest.lastEvent } });
        if (to !== r.status) {
          await c.query(`insert into mission_runs(mission_id, revision, status, execution) values ($1,$2,'running','disabled')`, [id, r.current_revision]);
          await emit(c, { tenantId: r.tenant_id, type: 'mission.stateChanged', subject: id, missionId: id, payload: { from: r.status, to, action: 'start', by: 'system', simulated: true } });
        }
        return st.stage !== 'working';
      });
    } catch (e) {
      app.log.warn({ err: e, mission: id }, 'staffing step failed; retrying');
      more = true;
    }
    if (more) schedule(id);
  }

  /** Called after every mission change: keep stepping while planning/running, stop otherwise. */
  app.onMissionChanged = (id, status) => { if (status === 'planning' || status === 'running') schedule(id); else stop(id); };

  // resume unfinished staffing after a restart
  void app.db.query(`select id from missions where deleted_at is null and status in ('planning','running') and presentation->'staffing' is not null and presentation->'staffing'->>'stage' <> 'working'`)
    .then((r) => r.rows.forEach((m, i) => schedule(m.id, Math.min(stepMs, 200) + i * 20)))
    .catch(() => {});

  app.addHook('onClose', async () => { closed = true; timers.forEach((t) => clearTimeout(t)); timers.clear(); });
}
