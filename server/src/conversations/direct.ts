import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Tx, Db } from '../db.ts';
import { audit } from '../audit.ts';
import { ApiError, notFound } from '../errors.ts';
import { requireUser, type Ctx } from '../auth/session.ts';
import { idempotent } from '../idempotency.ts';
import { createNotification } from '../notifications/routes.ts';
import { HONEST_NOTE_GM, HUMAN_POST_KINDS, MAX_BODY, honestNoteAgent } from '../../../shared/contracts/src/conversations.ts';
import { addReceipt, appendMessage, ensureDirectThread, findDirectThread, listChannels, loadAttachments, parseChannelKey, readPage, type ChannelKey } from './service.ts';
import { ensureHonestNote } from './honest.ts';

const invalid = (fieldErrors: Record<string, string>) => new ApiError('VALIDATION', 422, 'Some fields are not valid.', { fieldErrors });
// unknown keys (from, to, author, simulated, ...) are dropped: the author is the session user, the recipient follows from the channel
const PostIn = z.object({ kind: z.string(), text: z.string().max(MAX_BODY, `at most ${MAX_BODY} characters`).default(''), replyTo: z.string().max(100).optional(), uploadIds: z.array(z.string().max(40)).max(10).default([]) });

/**
 * Which channel a request means. A member's channel is always their own (the owner is the session user). Only an administrator may
 * use another user's admin line (`/channels/admin/:userId`); everything else about someone else's channel is 404.
 */
async function resolve(c: Tx | Db, ctx: Ctx, rawKey: string, userId?: string): Promise<{ key: ChannelKey; ownerId: string; agentName?: string }> {
  const key = parseChannelKey(rawKey);
  if (!key) throw notFound('No such channel.');
  let ownerId = ctx.user.id;
  if (userId !== undefined && userId !== ctx.user.id) {
    if (key.kind !== 'admin' || ctx.user.role !== 'admin') throw notFound('No such channel.');
    const u = (await c.query('select 1 from users where id=$1 and tenant_id=$2', [userId, ctx.tenantId])).rowCount;
    if (!u) throw notFound('No such channel.');
    ownerId = userId;
  }
  let agentName: string | undefined;
  if (key.kind === 'agent') {
    agentName = (await c.query('select name from agent_definitions where id=$1 and tenant_id=$2', [key.agentId, ctx.tenantId])).rows[0]?.name;
    if (!agentName) throw notFound('No such agent.');
  }
  return { key, ownerId, agentName };
}

export default async function directRoutes(app: FastifyInstance) {
  app.get('/channels', async (req) => ({ channels: await listChannels(app.db, await requireUser(req)) }));

  const read = async (req: any, rawKey: string, userId?: string) => {
    const ctx = await requireUser(req);
    const r = await resolve(app.db, ctx, rawKey, userId);
    const th = await findDirectThread(app.db, ctx.tenantId, r.ownerId, r.key);
    return readPage(app.db, th?.id ?? null, ctx.user.id, req.query as { before?: string; limit?: string });
  };
  app.get('/channels/:key/messages', async (req) => read(req, (req.params as { key: string }).key));
  app.get('/channels/admin/:userId/messages', async (req) => read(req, 'admin', (req.params as { userId: string }).userId));

  const write = async (req: any, reply: any, rawKey: string, userId?: string) => {
    const ctx = await requireUser(req);
    const p = PostIn.safeParse(req.body ?? {});
    if (!p.success) throw invalid(Object.fromEntries(p.error.issues.map((i) => [i.path.join('.') || '_', i.message])));
    const b = p.data;
    if (!(HUMAN_POST_KINDS as readonly string[]).includes(b.kind)) throw invalid({ kind: 'people can only send a command or a reply' });
    const text = b.text.trim();
    if (!text && !b.uploadIds.length) throw invalid({ text: 'write a message or attach a file' });
    const out = await idempotent(app.db, req, ctx, async (c) => {
      const r = await resolve(c, ctx, rawKey, userId);
      const th = await ensureDirectThread(c, ctx.tenantId, r.ownerId, r.key);
      const atts = await loadAttachments(c, ctx, b.uploadIds);
      const toOwner = r.ownerId !== ctx.user.id; // an administrator answering in a user's admin line
      const recipient = r.key.kind === 'gm' ? 'gm' : r.key.kind === 'agent' ? r.key.agentId! : toOwner ? `human:${r.ownerId}` : 'admins';
      const real = r.key.kind === 'admin'; // people talk to people: no queue, no note. gm and agent channels: nothing answers yet (E6)
      const msg = await appendMessage(c, { thread: th, authorKind: 'human', authorId: ctx.user.id, recipient, kind: b.kind, body: text, replyTo: b.replyTo ?? null,
        simulated: false, attachments: atts, correlationId: ctx.correlationId, status: real ? undefined : 'queued' });
      if (!real) {
        await addReceipt(c, th, msg.id, 'queued', { correlationId: ctx.correlationId });
        await ensureHonestNote(c, th, r.key.kind === 'gm' ? HONEST_NOTE_GM : honestNoteAgent(r.agentName!));
      } else if (toOwner) {
        await createNotification(c, { tenantId: ctx.tenantId, userId: r.ownerId, ownerOnly: true, severity: 'info', category: 'system', title: 'An administrator answered you',
          body: text.length > 140 ? text.slice(0, 139) + '…' : text || '(attachment)', route: '/?chat=admin' });
      }
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'conversation.message', subject: th.id, result: 'ok', correlationId: ctx.correlationId, detail: { messageId: msg.id, kind: b.kind, channel: r.key.kind, owner: r.ownerId, attachments: atts.length } });
      return { status: 201, body: { message: msg } };
    }, async (c) => { await resolve(c, ctx, rawKey, userId); });
    return reply.status(out.status).send(out.body);
  };
  app.post('/channels/:key/messages', async (req, reply) => write(req, reply, (req.params as { key: string }).key));
  app.post('/channels/admin/:userId/messages', async (req, reply) => write(req, reply, 'admin', (req.params as { userId: string }).userId));
}
