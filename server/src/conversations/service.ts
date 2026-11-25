import type { Tx, Db } from '../db.ts';
import { emit } from '../events/hooks.ts';
import { ApiError, notFound } from '../errors.ts';
import { VISIBLE_SQL } from '../missions/visibility.ts';
import type { AttachmentDto, ChannelDto, MessageDto, MissionDraftDto, ThreadDto } from '../../../shared/contracts/src/conversations.ts';

type Ctx = { tenantId: string; user: { id: string; name?: string; role: string } };
export interface ThreadRow { id: string; tenant_id: string; scope: string; mission_id: string | null; kind: string; a: string; b: string; owner_user_id: string | null; created_at: Date; demo?: boolean }

/** a < b in code-point order (the table's check uses collate "C"). */
export const orderPair = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);

const KB = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const uiAttachmentKind = (k: string): AttachmentDto['kind'] => (k === 'image' || k === 'audio' || k === 'video' ? k : k === 'pdf' || k === 'doc' || k === 'txt' ? 'doc' : 'file');
export const sizeLabel = KB;

const SELECT_MESSAGE = `select m.*, c.mission_id, ai.agent_id as author_agent, ri.agent_id as recipient_agent, u.name as user_name, coalesce(ad.name, dd.name) as agent_name,
    (select r.state from message_receipts r where r.message_id=m.id order by r.id desc limit 1) as status,
    coalesce((select jsonb_agg(jsonb_build_object('id', coalesce(a.upload_id, 'att-' || a.id), 'name', a.name, 'kind', a.kind, 'size', a.size, 'upload', a.upload_id) order by a.id)
              from message_attachments a where a.message_id=m.id), '[]'::jsonb) as atts
  from messages m join conversation_threads c on c.id=m.thread_id
  left join agent_instances ai on ai.id=m.author_id and m.author_kind='agent'
  left join agent_instances ri on ri.id=m.recipient
  left join users u on u.id=m.author_id and m.author_kind='human'
  left join agent_definitions ad on ad.id=ai.agent_id
  left join agent_definitions dd on dd.id=m.author_id and m.author_kind='agent' and ai.id is null and dd.tenant_id=c.tenant_id`; // a direct-channel reply: author_id is the agent id (gm, coder-01)

export function messageDto(r: any, now = Date.now()): MessageDto {
  const t = new Date(r.created_at).getTime();
  const human = r.author_kind === 'human', agent = r.author_kind === 'agent';
  const from = human ? `human:${r.author_id}` : agent ? (r.author_agent ?? r.author_id) : 'system';
  const to = r.recipient_agent ?? r.recipient;
  const atts: AttachmentDto[] = (r.atts as any[]).map((a) => ({ id: a.id, name: a.name, kind: uiAttachmentKind(a.kind), ...(a.size ? { size: a.size } : {}), ...(a.upload ? { url: `/api/v1/uploads/${a.upload}` } : {}) }));
  return {
    id: String(r.id), seq: r.seq, threadId: r.thread_id, from, to, kind: r.kind, text: r.body, agoMin: Math.max(0, Math.floor((now - t) / 60_000)), ts: t,
    ...(r.task_id ? { taskId: r.task_id } : {}), ...(r.reply_to ? { replyTo: r.reply_to } : {}), ...(atts.length ? { attachments: atts } : {}), ...(r.draft ? { draft: r.draft } : {}),
    ...(r.status ? { status: r.status } : human ? { status: 'sent' as const } : {}),
    simulated: r.simulated,
    author: { kind: r.author_kind, id: from, name: human ? (r.user_name ?? 'Owner') : agent ? (r.agent_name ?? r.author_id) : 'System', ...(agent ? { instanceId: r.author_id } : {}) },
  };
}

export async function messagesWhere(c: Tx | Db, where: string, params: unknown[], tail = ''): Promise<MessageDto[]> {
  const rows = (await c.query(`${SELECT_MESSAGE} where ${where} ${tail}`, params)).rows;
  const now = Date.now();
  return rows.map((r) => messageDto(r, now));
}

/** A mission thread the user may use: its mission is visible (u1 rule); invisible or unknown is 404. Direct channels have their own routes (/channels) and are never opened by thread id. `lock` takes the row lock used to serialise seq. */
export async function getThreadFor(c: Tx | Db, ctx: Ctx, id: string, lock = false): Promise<ThreadRow> {
  const r = (await c.query(
    `select c.*, m.demo from conversation_threads c left join missions m on m.id=c.mission_id
      where c.id=$1 and c.tenant_id=$2 and (
        (c.scope='mission' and m.deleted_at is null and ${VISIBLE_SQL('$3', '$4')}))
      ${lock ? 'for update of c' : ''}`, [id, ctx.tenantId, ctx.user.role === 'admin', ctx.user.id])).rows[0];
  if (!r) throw notFound('No such conversation, or its mission is not shared with you.');
  return r;
}

export interface NewMessage {
  thread: { id: string; tenant_id: string; mission_id: string | null; scope?: string; kind?: string; a?: string; b?: string; owner_user_id?: string | null };
  authorKind: 'human' | 'agent' | 'system'; authorId: string; recipient: string; kind: string; body: string;
  taskId?: string | null; replyTo?: string | null; simulated: boolean; createdAt?: Date; agoMin?: number; seq?: number;
  attachments?: { uploadId?: string | null; name: string; kind: string; size: string }[];
  actor?: { kind: 'human' | 'agent' | 'system'; id: string }; correlationId?: string; quiet?: boolean; status?: MessageDto['status'];
  /** a GM chat reply's mission draft (owner 2026-11-25) */
  draft?: MissionDraftDto | null;
}

type ChannelThread = { kind?: string; a?: string; b?: string; owner_user_id?: string | null };
/** The `payload.channel` of a direct thread's events: which of the web's chat channels it belongs to. */
const channelOf = (t: ChannelThread) => ({ kind: t.kind === 'agent-direct' ? 'agent' : t.kind!, userId: t.owner_user_id!, ...(t.kind === 'agent-direct' ? { agentId: t.a === 'human' ? t.b! : t.a! } : t.kind === 'gm' ? { agentId: 'gm' } : {}) });

/** Append one message (the caller holds the thread lock when concurrent writers are possible) and emit conversation.messageCreated. */
export async function appendMessage(c: Tx, m: NewMessage): Promise<MessageDto> {
  const seq = m.seq ?? Number((await c.query('select coalesce(max(seq), 0) + 1 as s from messages where thread_id=$1', [m.thread.id])).rows[0].s);
  const id = (await c.query(
    `insert into messages(thread_id, seq, author_kind, author_id, recipient, kind, body, task_id, reply_to, simulated, created_at, draft)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, coalesce($11::timestamptz, now()) - make_interval(mins => coalesce($12::int, 0)), $13) returning id`,
    [m.thread.id, seq, m.authorKind, m.authorId, m.recipient, m.kind, m.body, m.taskId ?? null, m.replyTo ?? null, m.simulated, m.createdAt ?? null, m.agoMin ?? null, m.draft ? JSON.stringify(m.draft) : null])).rows[0].id;
  for (const a of m.attachments ?? []) await c.query('insert into message_attachments(message_id, upload_id, name, kind, size) values ($1,$2,$3,$4,$5)', [id, a.uploadId ?? null, a.name, a.kind, a.size]);
  const dto = (await messagesWhere(c, 'm.id=$1', [id]))[0];
  if (m.status) dto.status = m.status; // the state the receipt written right after will give, so the event and the response agree
  if (m.thread.mission_id && !m.quiet) {
    await emit(c, { tenantId: m.thread.tenant_id, type: 'conversation.messageCreated', subjectKind: 'thread', subject: m.thread.id, missionId: m.thread.mission_id,
      actor: m.actor?.id ?? (m.authorKind === 'system' ? 'system' : m.authorId), actorKind: m.actor?.kind ?? m.authorKind, correlationId: m.correlationId,
      payload: { threadId: m.thread.id, messageId: dto.id, seq, kind: m.kind, simulated: m.simulated, message: dto } });
  }
  else if (m.thread.scope === 'direct' && m.thread.owner_user_id && !m.quiet) {
    // Stage 6 E6: gm and agent channels are private to their owner ('owner' never reaches an administrator); the admin line is the owner plus every administrator ('user')
    const t = m.thread;
    const channel = channelOf(t);
    await emit(c, { tenantId: t.tenant_id, type: 'conversation.messageCreated', subjectKind: 'thread', subject: t.id, audience: t.kind === 'admin' ? 'user' : 'owner', audienceUser: t.owner_user_id ?? undefined,
      actor: m.actor?.id ?? (m.authorKind === 'system' ? 'system' : m.authorId), actorKind: m.actor?.kind ?? m.authorKind, correlationId: m.correlationId,
      payload: { threadId: t.id, messageId: dto.id, seq, kind: m.kind, simulated: m.simulated, channel, message: dto } });
  }
  return dto;
}

/** Attachments of a post: each upload must belong to the sender (not yours is the same as not there). */
export async function loadAttachments(c: Tx, ctx: { tenantId: string; user: { id: string } }, uploadIds: string[]) {
  const atts: { uploadId: string; name: string; kind: string; size: string }[] = [];
  for (const uid of [...new Set(uploadIds)]) {
    const f = (await c.query('select id, name, kind, size from uploads where id=$1 and tenant_id=$2 and owner_id=$3', [uid, ctx.tenantId, ctx.user.id])).rows[0];
    if (!f) throw notFound('No such file.');
    atts.push({ uploadId: f.id, name: f.name, kind: uiAttachmentKind(f.kind), size: sizeLabel(Number(f.size)) });
  }
  return atts;
}

/** One page of a thread, newest first (before = seq cursor). A newest-page read records the read position for the user, unless `mark=0` (background re-reads). */
export async function readPage(c: Tx | Db, threadId: string | null, userId: string, q: { before?: string; limit?: string; mark?: string }) {
  const bad = (f: string) => new ApiError('VALIDATION', 422, 'Some fields are not valid.', { fieldErrors: { [f]: 'must be a positive integer' } });
  const before = q.before === undefined ? null : /^\d{1,9}$/.test(q.before) ? Number(q.before) : NaN;
  const limit = q.limit === undefined ? 50 : /^\d{1,6}$/.test(q.limit) ? Math.min(200, Number(q.limit)) : NaN;
  if (Number.isNaN(before)) throw bad('before');
  if (Number.isNaN(limit) || limit < 1) throw bad('limit');
  if (!threadId) return { messages: [] as MessageDto[], hasMore: false, nextBefore: null as number | null };
  const rows = await messagesWhere(c, 'm.thread_id=$1 and ($2::int is null or m.seq < $2)', [threadId, before], `order by m.seq desc limit ${limit + 1}`);
  const page = rows.slice(0, limit);
  if (before === null && page.length && q.mark !== '0') {
    await c.query(`insert into thread_reads(thread_id, user_id, last_seq) values ($1,$2,$3)
      on conflict (thread_id, user_id) do update set last_seq = greatest(thread_reads.last_seq, excluded.last_seq)`, [threadId, userId, page[0].seq]);
  }
  return { messages: page, hasMore: rows.length > limit, nextBefore: rows.length > limit ? page[page.length - 1].seq : null };
}

/** `channelEvent`: a receipt of a gm or agent direct channel is sent to its owner live (the chat responder; the sender's own 'queued' needs no event). */
export async function addReceipt(c: Tx, thread: { id: string; tenant_id: string; mission_id: string | null } & ChannelThread, messageId: string, state: 'queued' | 'delivered' | 'acknowledged', opts: { at?: Date; quiet?: boolean; simulated?: boolean; correlationId?: string; channelEvent?: boolean } = {}) {
  await c.query(`insert into message_receipts(message_id, state, at) values ($1,$2, coalesce($3::timestamptz, now()))`, [messageId, state, opts.at ?? null]);
  if (thread.mission_id && !opts.quiet) {
    await emit(c, { tenantId: thread.tenant_id, type: 'conversation.receipt', subjectKind: 'thread', subject: thread.id, missionId: thread.mission_id, correlationId: opts.correlationId,
      payload: { threadId: thread.id, messageId, state, simulated: !!opts.simulated } });
  } else if (opts.channelEvent && !opts.quiet && thread.owner_user_id && (thread.kind === 'gm' || thread.kind === 'agent-direct')) {
    await emit(c, { tenantId: thread.tenant_id, type: 'conversation.receipt', subjectKind: 'thread', subject: thread.id, audience: 'owner', audienceUser: thread.owner_user_id,
      actor: 'system', actorKind: 'system', correlationId: opts.correlationId, payload: { threadId: thread.id, messageId, state, simulated: false, channel: channelOf(thread) } });
  }
}

/** Get or create the thread between two participants of a mission (instance ids or 'human'). */
export async function ensureThread(c: Tx, t: { tenantId: string; missionId: string; kind: 'agent-agent' | 'human-agent'; x: string; y: string }): Promise<ThreadRow> {
  const [a, b] = orderPair(t.x, t.y);
  await c.query(`insert into conversation_threads(tenant_id, scope, mission_id, kind, a, b) values ($1,'mission',$2,$3,$4,$5) on conflict do nothing`, [t.tenantId, t.missionId, t.kind, a, b]);
  return (await c.query(`select c.*, m.demo from conversation_threads c join missions m on m.id=c.mission_id where c.mission_id=$1 and c.a=$2 and c.b=$3 and c.owner_user_id is null`, [t.missionId, a, b])).rows[0];
}

const THREAD_SELECT = `select c.*, ia.agent_id as a_agent, ib.agent_id as b_agent,
    (select count(*)::int from messages where thread_id=c.id) as n,
    (select count(*)::int from messages x where x.thread_id=c.id and x.seq > coalesce(tr.last_seq, 0) and not (x.author_kind='human' and x.author_id=$2)) as unread,
    (select id from messages where thread_id=c.id order by seq desc limit 1) as last_id
  from conversation_threads c
  left join agent_instances ia on ia.id=c.a left join agent_instances ib on ib.id=c.b
  left join thread_reads tr on tr.thread_id=c.id and tr.user_id=$2`;

export async function threadDtos(c: Tx | Db, missionId: string, userId: string): Promise<ThreadDto[]> {
  const rows = (await c.query(`${THREAD_SELECT} where c.mission_id=$1 order by c.created_at, c.id`, [missionId, userId])).rows;
  const ids = rows.map((r) => r.last_id).filter(Boolean);
  const last = new Map((ids.length ? await messagesWhere(c, 'm.id = any($1::bigint[])', [ids]) : []).map((m) => [m.id, m]));
  return rows.map((r) => ({
    id: r.id, missionId: r.mission_id, kind: r.kind, a: r.a, b: r.b, aAgentId: r.a_agent ?? null, bAgentId: r.b_agent ?? null,
    count: r.n, unread: r.unread, lastMessage: r.last_id ? last.get(String(r.last_id)) ?? null : null, createdAt: new Date(r.created_at).toISOString(),
  }));
}

/** For each instance of a mission: the partners it talks to (existing threads) plus the human line (threadId null until created). */
export async function missionThreads(c: Tx | Db, missionId: string, userId: string) {
  const threads = await threadDtos(c, missionId, userId);
  const inst = (await c.query('select id, agent_id from agent_instances where mission_id=$1 order by seq', [missionId])).rows;
  const instances = inst.map((i) => {
    const partners = threads.filter((t) => t.a === i.id || t.b === i.id).map((t) => {
      const other = t.a === i.id ? 'b' : 'a';
      const human = t[other] === 'human';
      return { threadId: t.id as string | null, kind: t.kind, human, withInstanceId: human ? null : t[other], withAgentId: other === 'a' ? t.aAgentId : t.bAgentId, lastMessage: t.lastMessage, unread: t.unread, count: t.count };
    });
    if (!partners.some((p) => p.human)) partners.push({ threadId: null, kind: 'human-agent', human: true, withInstanceId: null, withAgentId: null, lastMessage: null, unread: 0, count: 0 });
    return { instanceId: i.id as string, agentId: i.agent_id as string, partners };
  });
  return { threads, instances };
}

/* ------------------------------------------------------------------ direct channels (Stage 6, E6) */
export type ChannelKey = { kind: 'gm' | 'admin' | 'agent'; agentId?: string };
const THREAD_KIND = { gm: 'gm', admin: 'admin', agent: 'agent-direct' } as const;
const RESERVED = new Set(['gm', 'admin', 'human', 'system', 'admins']);
export function parseChannelKey(k: string): ChannelKey | null {
  if (k === 'gm' || k === 'admin') return { kind: k };
  const m = /^agent:([A-Za-z0-9_.-]{1,100})$/.exec(k);
  return m && !RESERVED.has(m[1]) ? { kind: 'agent', agentId: m[1] } : null; // the General Manager has its own channel; reserved words are no agents
}
const sides = (k: ChannelKey) => orderPair(k.kind === 'gm' ? 'gm' : k.kind === 'admin' ? 'admin' : k.agentId!, 'human');

export async function findDirectThread(c: Tx | Db, tenantId: string, ownerId: string, k: ChannelKey, lock = false): Promise<ThreadRow | undefined> {
  const [a, b] = sides(k);
  return (await c.query(`select * from conversation_threads where tenant_id=$1 and scope='direct' and owner_user_id=$2 and kind=$3 and a=$4 and b=$5 ${lock ? 'for update' : ''}`, [tenantId, ownerId, THREAD_KIND[k.kind], a, b])).rows[0];
}
/** Get or create the channel's thread; the row lock orders seq and the honest note. */
export async function ensureDirectThread(c: Tx, tenantId: string, ownerId: string, k: ChannelKey): Promise<ThreadRow> {
  const [a, b] = sides(k);
  await c.query(`insert into conversation_threads(tenant_id, scope, kind, a, b, owner_user_id) values ($1,'direct',$2,$3,$4,$5) on conflict do nothing`, [tenantId, THREAD_KIND[k.kind], a, b, ownerId]);
  return (await findDirectThread(c, tenantId, ownerId, k, true))!;
}

/** My direct channels (gm and admin always; agent channels once used), plus, for an administrator, every user's admin line. */
export async function listChannels(c: Tx | Db, ctx: Ctx): Promise<ChannelDto[]> {
  const rows = (await c.query(
    `select c.*, u.name as owner_name,
        (select count(*)::int from messages where thread_id=c.id) as n,
        (select count(*)::int from messages x where x.thread_id=c.id and x.seq > coalesce(tr.last_seq, 0) and not (x.author_kind='human' and x.author_id=$2)) as unread,
        (select id from messages where thread_id=c.id order by seq desc limit 1) as last_id,
        (select max(created_at) from messages where thread_id=c.id) as last_at
       from conversation_threads c join users u on u.id=c.owner_user_id left join thread_reads tr on tr.thread_id=c.id and tr.user_id=$2
      where c.tenant_id=$1 and c.scope='direct' and (c.owner_user_id=$2 or (c.kind='admin' and $3::boolean))
      order by last_at desc nulls last, c.id`, [ctx.tenantId, ctx.user.id, ctx.user.role === 'admin'])).rows;
  const ids = rows.map((r) => r.last_id).filter(Boolean);
  const last = new Map((ids.length ? await messagesWhere(c, 'm.id = any($1::bigint[])', [ids]) : []).map((m) => [m.id, m]));
  const dto = (r: any): ChannelDto => ({
    kind: r.kind === 'agent-direct' ? 'agent' : r.kind, userId: r.owner_user_id, userName: r.owner_name,
    ...(r.kind === 'agent-direct' ? { agentId: r.a === 'human' ? r.b : r.a } : r.kind === 'gm' ? { agentId: 'gm' } : {}),
    threadId: r.id, count: r.n, unread: r.unread, last: r.last_id ? last.get(String(r.last_id)) ?? null : null,
  });
  const out = rows.map(dto);
  const own = (kind: 'gm' | 'admin'): ChannelDto => ({ kind, userId: ctx.user.id, userName: ctx.user.name, ...(kind === 'gm' ? { agentId: 'gm' } : {}), threadId: null, count: 0, unread: 0, last: null });
  const missing = (['admin', 'gm'] as const).filter((k) => !out.some((o) => o.kind === k && o.userId === ctx.user.id)).map(own);
  return [...missing, ...out].sort((x, y) => rank(x, ctx.user.id) - rank(y, ctx.user.id));
}
const rank = (c: ChannelDto, me: string) => (c.userId === me ? (c.kind === 'gm' ? 0 : c.kind === 'admin' ? 1 : 2) : 3);
