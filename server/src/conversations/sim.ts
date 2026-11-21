import type { FastifyInstance } from 'fastify';
import { tx } from '../db.ts';
import { addReceipt, appendMessage, ensureThread } from './service.ts';

const ACKS = ['Got it, on it now.', 'Understood. I will start right away and report back.', 'Acknowledged. Adding this to my queue.'];

/**
 * Decision E5: on DEMO missions (demo=true) the prototype's acknowledgements and upward reports are simulated on the server.
 * Everything written here is simulated=true; real missions are never touched. delivered at 1x, acknowledged + ack at 2x,
 * the instance's report to its manager at 4x. Timers are cleared when the app closes.
 */
declare module 'fastify' { interface FastifyInstance { conversationSim: { errors: unknown[]; pending: () => number } } }

export function startConversationSim(app: FastifyInstance, baseMs = 1200) {
  const timers = new Set<NodeJS.Timeout>();
  const errors: unknown[] = [];
  app.decorate('conversationSim', { errors, pending: () => timers.size });
  let closed = false;
  const later = (ms: number, fn: () => Promise<void>) => {
    if (closed) return;
    const h = setTimeout(() => { timers.delete(h); if (!closed) void fn().catch((e) => { errors.push(e); app.log.warn({ err: e }, 'conversation sim step failed'); }); }, ms);
    timers.add(h);
  };

  /** The posted human message, only when its mission is a live demo mission. */
  const load = async (c: import('../db.ts').Tx, messageId: string) => (await c.query(
    `select m.id, m.thread_id, m.recipient, m.body, m.seq, c.tenant_id, c.mission_id, u.name as user_name
       from messages m join conversation_threads c on c.id=m.thread_id join missions x on x.id=c.mission_id
       left join users u on u.id=m.author_id
      where m.id=$1 and m.author_kind='human' and not m.simulated and x.demo and x.deleted_at is null and c.scope='mission' and (c.a='human' or c.b='human')`, [messageId])).rows[0];
  /** Serialise the steps of one thread before any dedupe read. */
  const lock = async (c: import('../db.ts').Tx, threadId: string) => { await c.query('select 1 from conversation_threads where id=$1 for update', [threadId]); };

  app.onMessagePosted = (messageId) => {
    later(baseMs, () => tx(app.db, async (c) => {
      const r = await load(c, messageId);
      if (r) await lock(c, r.thread_id);
      if (!r || (await c.query('select 1 from message_receipts where message_id=$1', [messageId])).rowCount) return; // replayed posts do not restart it
      await addReceipt(c, { id: r.thread_id, tenant_id: r.tenant_id, mission_id: r.mission_id }, messageId, 'delivered', { simulated: true });
    }));
    later(baseMs * 2, () => tx(app.db, async (c) => {
      const r = await load(c, messageId);
      if (!r || !r.recipient) return;
      await lock(c, r.thread_id);
      const th = { id: r.thread_id, tenant_id: r.tenant_id, mission_id: r.mission_id };
      const states = (await c.query('select state from message_receipts where message_id=$1', [messageId])).rows.map((x) => x.state);
      if (!states.includes('delivered') || states.includes('acknowledged')) return;
      await addReceipt(c, th, messageId, 'acknowledged', { simulated: true });
      await appendMessage(c, { thread: th, authorKind: 'agent', authorId: r.recipient, recipient: 'human', kind: 'ack', body: ACKS[Number(r.seq) % ACKS.length], replyTo: messageId, simulated: true });
    }));
    later(baseMs * 4, () => tx(app.db, async (c) => {
      const r = await load(c, messageId);
      if (!r || !r.recipient) return;
      await lock(c, r.thread_id);
      const mgr = (await c.query('select manager_instance_id from agent_instances where id=$1', [r.recipient])).rows[0]?.manager_instance_id as string | undefined;
      if (!mgr) return; // the GM reports to nobody
      if ((await c.query(`select 1 from messages where author_id=$1 and recipient=$2 and kind='report' and reply_to=$3`, [r.recipient, mgr, messageId])).rowCount) return;
      const th = await ensureThread(c, { tenantId: r.tenant_id, missionId: r.mission_id, kind: 'agent-agent', x: r.recipient, y: mgr });
      await c.query('select 1 from conversation_threads where id=$1 for update', [th.id]);
      const quote = String(r.body).replace(/\s+/g, ' ').slice(0, 80);
      await appendMessage(c, { thread: th, authorKind: 'agent', authorId: r.recipient, recipient: mgr, kind: 'report', replyTo: messageId, simulated: true,
        body: `${r.user_name ?? 'The owner'} asked: "${quote}". I have acknowledged it and will fold it into my plan.` });
    }));
  };

  app.addHook('onClose', async () => { closed = true; timers.forEach((t) => clearTimeout(t)); timers.clear(); });
}
