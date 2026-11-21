import type { Tx } from '../db.ts';
import { MISSIONS, getMissionControl } from '../../../web/src/data/missions.ts';
import { ensureThread, addReceipt, appendMessage } from '../conversations/service.ts';
import { instanceId, insertDelegation, insertInstance, UI_TO_TASK } from './service.ts';

/**
 * Startup backfill (Stage 6 review focus 5): every mission without instances gets its team.
 * Demo missions take nodes/edges/tasks from the prototype's fixture builder (simulated=true).
 * Real missions take the GM, executor and joined agents from their presentation (simulated=false; nothing executes).
 * Idempotent: a mission that already has instances is skipped. Demo missions without threads also get their conversations
 * (backfillThreads, gated on "no threads", so missions backfilled by an earlier version still get them).
 */
export async function backfillMissionControl(c: Tx, tenantId: string, log?: { info: (o: object, m: string) => void; error: (o: object, m: string) => void }) {
  await c.query('select pg_advisory_xact_lock(hashtext($1))', ['instance-backfill:' + tenantId]);
  const rows = (await c.query(`select m.id, m.demo, m.presentation, (select id from mission_runs where mission_id=m.id order by id desc limit 1) as run_id
      from missions m where m.tenant_id=$1 and not exists (select 1 from agent_instances i where i.mission_id=m.id) order by m.created_at, m.id`, [tenantId])).rows;
  const done = { missions: 0, instances: 0, delegations: 0, tasks: 0, skipped: 0 };
  for (const m of rows) {
    const part = { instances: 0, delegations: 0, tasks: 0 };
    await c.query('savepoint bf');
    try {
    const fixture = m.demo ? MISSIONS.find((x) => x.id === m.id) : undefined;
    const runId = m.run_id ? Number(m.run_id) : null;
    const simulated = !!m.demo;
    const agentOf = (inst: string) => inst.slice(m.id.length + 1);
    if (fixture) {
      const mc = getMissionControl(fixture);
      const order = [...fixture.agentIds, ...mc.nodes.map((n) => n.agentId)];
      const nodes = [...mc.nodes].sort((a, b) => order.indexOf(a.agentId) - order.indexOf(b.agentId));
      for (const n of nodes) {
        if (await insertInstance(c, { tenantId, missionId: m.id, agentId: n.agentId, managerAgentId: n.parent ? agentOf(n.parent) : undefined, state: n.state, task: n.task, progress: n.progress, taskCount: n.tasks, pending: n.pending, simulated, runId })) part.instances++;
      }
      const have = new Set((await c.query('select id from agent_instances where mission_id=$1', [m.id])).rows.map((r) => r.id));
      for (const e of mc.edges) {
        if (e.kind === 'reports' || !have.has(e.from) || !have.has(e.to)) continue; // reports is implied by delegated
        await insertDelegation(c, { missionId: m.id, from: e.from, to: e.to, kind: e.kind as 'delegated', simulated });
        part.delegations++;
      }
      for (const t of mc.tasks) {
        const owner = instanceId(m.id, t.owner);
        await c.query(`insert into tasks(id, tenant_id, mission_id, run_id, title, status, owner_agent, owner_instance_id, weight, evidence, col, row, simulated)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true) on conflict (id) do nothing`,
          [t.id, tenantId, m.id, runId, t.title, UI_TO_TASK[t.state] ?? 'created', t.owner, have.has(owner) ? owner : null, t.weight, t.evidence, t.col, t.row]);
        part.tasks++;
      }
      for (const t of mc.tasks) for (const d of t.deps) {
        await c.query('insert into task_dependencies(task_id, depends_on) values ($1,$2) on conflict do nothing', [t.id, d]);
      }
    } else {
      const p = (m.presentation ?? {}) as { agentIds?: string[]; executorId?: string };
      const ids = Array.isArray(p.agentIds) ? p.agentIds : p.agentIds === undefined ? [] : [...(p.agentIds as Iterable<string>)]; // a malformed value throws, caught per mission
      const joined = [...new Set<string>(['gm', ...ids])];
      const ex = p.executorId && joined.includes(p.executorId) ? p.executorId : joined.find((a) => a !== 'gm');
      const team = ex ? ['gm', ex, ...joined.filter((a) => a !== 'gm' && a !== ex)] : joined;
      const made = new Set<string>();
      for (const a of team) {
        const want = a === 'gm' ? undefined : a === ex ? 'gm' : ex;
        const manager = want && made.has(want) ? want : a !== 'gm' && made.has('gm') ? 'gm' : undefined; // fall back to the GM instance
        if (!(await insertInstance(c, { tenantId, missionId: m.id, agentId: a, managerAgentId: manager, simulated, runId }))) continue;
        made.add(a);
        part.instances++;
        if (manager) { await insertDelegation(c, { missionId: m.id, from: instanceId(m.id, manager), to: instanceId(m.id, a), kind: 'delegated', simulated }); part.delegations++; }
      }
    }
    await c.query('release savepoint bf');
    done.instances += part.instances; done.delegations += part.delegations; done.tasks += part.tasks;
    done.missions++;
    } catch (e) {
      await c.query('rollback to savepoint bf');
      await c.query('release savepoint bf');
      done.skipped++;
      log?.error({ err: e, mission: m.id }, 'instance backfill skipped a mission');
    }
  }
  const th = await backfillThreads(c, tenantId, log);
  log?.info({ ...done, ...th }, 'instance backfill');
  return { ...done, ...th };
}

/** Demo missions get the fixture builder's threads (simulated=true); created_at is spread so the newest message is `agoMin` old. */
export async function backfillThreads(c: Tx, tenantId: string, log?: { error: (o: object, m: string) => void }) {
  const rows = (await c.query(`select m.id from missions m where m.tenant_id=$1 and m.demo and not exists (select 1 from conversation_threads t where t.mission_id=m.id)
      and exists (select 1 from agent_instances i where i.mission_id=m.id) order by m.created_at, m.id`, [tenantId])).rows;
  const done = { threadMissions: 0, threads: 0, messages: 0, threadsSkipped: 0 };
  for (const m of rows) {
    const fixture = MISSIONS.find((x) => x.id === m.id);
    if (!fixture) continue;
    await c.query('savepoint bft');
    try {
      const have = new Set((await c.query('select id from agent_instances where mission_id=$1', [m.id])).rows.map((r) => r.id));
      let nt = 0, nm = 0;
      for (const [key, msgs] of Object.entries(getMissionControl(fixture).threads)) {
        const sides = key.split('|');
        const human = sides.find((s) => s.startsWith('human:'));
        const agents = sides.filter((s) => !s.startsWith('human:')).map((a) => instanceId(m.id, a));
        if (agents.some((a) => !have.has(a)) || (human ? agents.length !== 1 : agents.length !== 2)) continue;
        const th = await ensureThread(c, { tenantId, missionId: m.id, kind: human ? 'human-agent' : 'agent-agent', x: agents[0], y: human ? 'human' : agents[1] });
        nt++;
        const ordered = msgs.map((x, i) => ({ x, i })).sort((p, q) => q.x.agoMin - p.x.agoMin || p.i - q.i).map((e) => e.x); // oldest first
        let seq = 0;
        for (const x of ordered) {
          const fromHuman = x.from.startsWith('human:');
          const msg = await appendMessage(c, {
            thread: th, seq: ++seq, authorKind: fromHuman ? 'human' : 'agent', authorId: fromHuman ? x.from.slice(6) : instanceId(m.id, x.from),
            recipient: x.to.startsWith('human:') ? x.to : instanceId(m.id, x.to), kind: x.kind, body: x.text, taskId: x.taskId ?? null, replyTo: x.replyTo ?? null,
            simulated: true, agoMin: x.agoMin, quiet: true,
            attachments: (x.attachments ?? []).map((a) => ({ name: a.name, kind: a.kind, size: a.size ?? '' })),
          });
          if (x.status === 'delivered' || x.status === 'acknowledged' || x.status === 'queued') await addReceipt(c, th, msg.id, x.status, { at: new Date(msg.ts), quiet: true, simulated: true });
          nm++;
        }
      }
      await c.query('release savepoint bft');
      done.threadMissions++; done.threads += nt; done.messages += nm;
    } catch (e) {
      await c.query('rollback to savepoint bft');
      await c.query('release savepoint bft');
      done.threadsSkipped++;
      log?.error({ err: e, mission: m.id }, 'thread backfill skipped a mission');
    }
  }
  return done;
}
