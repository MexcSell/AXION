import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tx } from '../db.ts';
import { audit } from '../audit.ts';
import { ApiError, notFound } from '../errors.ts';
import { requireUser } from '../auth/session.ts';
import { idempotent } from '../idempotency.ts';
import { getVisibleRow } from '../missions/service.ts';
import { HUMAN_POST_KINDS, MAX_BODY } from '../../../shared/contracts/src/conversations.ts';
import { addReceipt, appendMessage, ensureThread, getThreadFor, messagesWhere, missionThreads, sizeLabel, uiAttachmentKind } from './service.ts';
import { ensureHonestNote } from './honest.ts';

declare module 'fastify' { interface FastifyInstance { onMessagePosted?: (messageId: string) => void } }

const invalid = (fieldErrors: Record<string, string>) => new ApiError('VALIDATION', 422, 'Some fields are not valid.', { fieldErrors });
const PostIn = z.object({
  kind: z.string(), text: z.string().max(MAX_BODY, `at most ${MAX_BODY} characters`).default(''), to: z.string().min(1).max(200),
  replyTo: z.string().max(100).optional(), uploadIds: z.array(z.string().max(40)).max(10).default([]),
}); // unknown keys (from, author, simulated, ...) are dropped: authorship comes from the session

export default async function conversationRoutes(app: FastifyInstance) {
  app.get('/missions/:id/threads', async (req) => {
    const ctx = await requireUser(req);
    const m = await getVisibleRow(app.db, ctx, (req.params as { id: string }).id);
    return missionThreads(app.db, m.id, ctx.user.id);
  });

  // E4: one human<->agent thread per (mission, instance), created lazily, shared by everyone who can see the mission
  app.post('/missions/:id/threads', async (req) => {
    const ctx = await requireUser(req);
    const { id } = req.params as { id: string };
    const b = z.object({ instanceId: z.string().min(1).max(200) }).safeParse(req.body ?? {});
    if (!b.success) throw invalid({ instanceId: 'required' });
    return tx(app.db, async (c) => {
      const m = await getVisibleRow(c, ctx, id);
      const inst = (await c.query('select 1 from agent_instances where id=$1 and mission_id=$2', [b.data.instanceId, m.id])).rowCount;
      if (!inst) throw notFound('No such agent instance in this mission.');
      const before = (await c.query(`select 1 from conversation_threads where mission_id=$1 and (a=$2 and b='human' or a='human' and b=$2)`, [m.id, b.data.instanceId])).rowCount;
      const th = await ensureThread(c, { tenantId: ctx.tenantId, missionId: m.id, kind: 'human-agent', x: b.data.instanceId, y: 'human' });
      if (!before) await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'conversation.thread', subject: th.id, result: 'ok', correlationId: ctx.correlationId, detail: { missionId: m.id, instanceId: b.data.instanceId } });
      return { threadId: th.id };
    });
  });

  app.get('/threads/:id/messages', async (req) => {
    const ctx = await requireUser(req);
    const { id } = req.params as { id: string };
    const q = req.query as { before?: string; limit?: string };
    const th = await getThreadFor(app.db, ctx, id);
    const before = q.before === undefined ? null : /^\d{1,9}$/.test(q.before) ? Number(q.before) : NaN;
    const limit = q.limit === undefined ? 50 : /^\d{1,6}$/.test(q.limit) ? Math.min(200, Number(q.limit)) : NaN;
    if (Number.isNaN(before) || Number.isNaN(limit) || limit < 1) throw invalid({ [Number.isNaN(before) ? 'before' : 'limit']: 'must be a positive integer' });
    const rows = await messagesWhere(app.db, 'm.thread_id=$1 and ($2::int is null or m.seq < $2)', [th.id, before], `order by m.seq desc limit ${limit + 1}`);
    const page = rows.slice(0, limit);
    if (before === null && page.length) {
      await app.db.query(`insert into thread_reads(thread_id, user_id, last_seq) values ($1,$2,$3)
        on conflict (thread_id, user_id) do update set last_seq = greatest(thread_reads.last_seq, excluded.last_seq)`, [th.id, ctx.user.id, page[0].seq]);
    }
    return { messages: page, hasMore: rows.length > limit, nextBefore: rows.length > limit ? page[page.length - 1].seq : null };
  });

  app.post('/threads/:id/messages', async (req, reply) => {
    const ctx = await requireUser(req);
    const { id } = req.params as { id: string };
    const p = PostIn.safeParse(req.body ?? {});
    if (!p.success) throw invalid(Object.fromEntries(p.error.issues.map((i) => [i.path.join('.') || '_', i.message])));
    const b = p.data;
    if (!(HUMAN_POST_KINDS as readonly string[]).includes(b.kind)) throw invalid({ kind: 'people can only send a command or a reply' });
    const text = b.text.trim();
    if (!text && !b.uploadIds.length) throw invalid({ text: 'write a message or attach a file' });
    const out = await idempotent(app.db, req, ctx, async (c) => {
      const th = await getThreadFor(c, ctx, id, true); // 404 when the mission is not visible; the row lock orders seq and the honest note
      // `to` must be a participant, and an agent (people never address 'human')
      const parts = (await c.query(`select p.id, i.agent_id from (values ($1::text), ($2::text)) p(id) left join agent_instances i on i.id=p.id`, [th.a, th.b])).rows;
      const target = parts.find((x) => x.id !== 'human' && (x.id === b.to || x.agent_id === b.to));
      if (!target) throw invalid({ to: 'must be an agent in this conversation' });
      const atts: { uploadId: string; name: string; kind: string; size: string }[] = [];
      for (const uid of [...new Set(b.uploadIds)]) {
        const f = (await c.query('select id, name, kind, size from uploads where id=$1 and tenant_id=$2 and owner_id=$3', [uid, ctx.tenantId, ctx.user.id])).rows[0];
        if (!f) throw notFound('No such file.'); // not yours is the same as not there
        atts.push({ uploadId: f.id, name: f.name, kind: uiAttachmentKind(f.kind), size: sizeLabel(Number(f.size)) });
      }
      const msg = await appendMessage(c, { thread: th, authorKind: 'human', authorId: ctx.user.id, recipient: target.id, kind: b.kind, body: text, replyTo: b.replyTo ?? null,
        simulated: false, attachments: atts, correlationId: ctx.correlationId });
      if (!th.demo) { // E5: real mission, nothing acts. queued receipt plus one honest note per thread
        await addReceipt(c, th, msg.id, 'queued', { correlationId: ctx.correlationId });
        await ensureHonestNote(c, th);
        msg.status = 'queued';
      }
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'conversation.message', subject: th.id, result: 'ok', correlationId: ctx.correlationId, detail: { messageId: msg.id, kind: b.kind, attachments: atts.length } });
      return { status: 201, body: { message: msg } };
    }, async (c) => { await getThreadFor(c, ctx, id); });
    if (out.status === 201) app.onMessagePosted?.((out.body as { message: { id: string } }).message.id);
    return reply.status(out.status).send(out.body);
  });
}
