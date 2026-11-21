import type { Tx, Db } from '../db.ts';
import { emit } from '../events/hooks.ts';
import { notFound } from '../errors.ts';
import { VISIBLE_SQL } from '../missions/visibility.ts';
import type { AttachmentDto, MessageDto, ThreadDto } from '../../../shared/contracts/src/conversations.ts';

type Ctx = { tenantId: string; user: { id: string; name?: string; role: string } };
export interface ThreadRow { id: string; tenant_id: string; scope: string; mission_id: string | null; kind: string; a: string; b: string; owner_user_id: string | null; created_at: Date; demo?: boolean }

/** a < b in code-point order (the table's check uses collate "C"). */
export const orderPair = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);

const KB = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const uiAttachmentKind = (k: string): AttachmentDto['kind'] => (k === 'image' || k === 'audio' || k === 'video' ? k : k === 'pdf' || k === 'doc' || k === 'txt' ? 'doc' : 'file');
export const sizeLabel = KB;

const SELECT_MESSAGE = `select m.*, c.mission_id, ai.agent_id as author_agent, ri.agent_id as recipient_agent, u.name as user_name, ad.name as agent_name,
    (select r.state from message_receipts r where r.message_id=m.id order by r.id desc limit 1) as status,
    coalesce((select jsonb_agg(jsonb_build_object('id', coalesce(a.upload_id, 'att-' || a.id), 'name', a.name, 'kind', a.kind, 'size', a.size, 'upload', a.upload_id) order by a.id)
              from message_attachments a where a.message_id=m.id), '[]'::jsonb) as atts
  from messages m join conversation_threads c on c.id=m.thread_id
  left join agent_instances ai on ai.id=m.author_id and m.author_kind='agent'
  left join agent_instances ri on ri.id=m.recipient
  left join users u on u.id=m.author_id and m.author_kind='human'
  left join agent_definitions ad on ad.id=ai.agent_id`;

export function messageDto(r: any, now = Date.now()): MessageDto {
  const t = new Date(r.created_at).getTime();
  const human = r.author_kind === 'human', agent = r.author_kind === 'agent';
  const from = human ? `human:${r.author_id}` : agent ? (r.author_agent ?? r.author_id) : 'system';
  const to = r.recipient_agent ?? r.recipient;
  const atts: AttachmentDto[] = (r.atts as any[]).map((a) => ({ id: a.id, name: a.name, kind: uiAttachmentKind(a.kind), ...(a.size ? { size: a.size } : {}), ...(a.upload ? { url: `/api/v1/uploads/${a.upload}` } : {}) }));
  return {
    id: String(r.id), seq: r.seq, threadId: r.thread_id, from, to, kind: r.kind, text: r.body, agoMin: Math.max(0, Math.floor((now - t) / 60_000)), ts: t,
    ...(r.task_id ? { taskId: r.task_id } : {}), ...(r.reply_to ? { replyTo: r.reply_to } : {}), ...(atts.length ? { attachments: atts } : {}),
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

/** A thread the user may use: its mission is visible (u1 rule); invisible or unknown is 404. `lock` takes the row lock used to serialise seq. */
export async function getThreadFor(c: Tx | Db, ctx: Ctx, id: string, lock = false): Promise<ThreadRow> {
  const r = (await c.query(
    `select c.*, m.demo from conversation_threads c left join missions m on m.id=c.mission_id
      where c.id=$1 and c.tenant_id=$2 and (
        (c.scope='mission' and m.deleted_at is null and ${VISIBLE_SQL('$3', '$4')}) or (c.scope='direct' and c.owner_user_id=$4))
      ${lock ? 'for update of c' : ''}`, [id, ctx.tenantId, ctx.user.role === 'admin', ctx.user.id])).rows[0];
  if (!r) throw notFound('No such conversation, or its mission is not shared with you.');
  return r;
}

export interface NewMessage {
  thread: { id: string; tenant_id: string; mission_id: string | null };
  authorKind: 'human' | 'agent' | 'system'; authorId: string; recipient: string; kind: string; body: string;
  taskId?: string | null; replyTo?: string | null; simulated: boolean; createdAt?: Date; agoMin?: number; seq?: number;
  attachments?: { uploadId?: string | null; name: string; kind: string; size: string }[];
  actor?: { kind: 'human' | 'agent' | 'system'; id: string }; correlationId?: string; quiet?: boolean; status?: MessageDto['status'];
}

/** Append one message (the caller holds the thread lock when concurrent writers are possible) and emit conversation.messageCreated. */
export async function appendMessage(c: Tx, m: NewMessage): Promise<MessageDto> {
  const seq = m.seq ?? Number((await c.query('select coalesce(max(seq), 0) + 1 as s from messages where thread_id=$1', [m.thread.id])).rows[0].s);
  const id = (await c.query(
    `insert into messages(thread_id, seq, author_kind, author_id, recipient, kind, body, task_id, reply_to, simulated, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, coalesce($11::timestamptz, now()) - make_interval(mins => coalesce($12::int, 0))) returning id`,
    [m.thread.id, seq, m.authorKind, m.authorId, m.recipient, m.kind, m.body, m.taskId ?? null, m.replyTo ?? null, m.simulated, m.createdAt ?? null, m.agoMin ?? null])).rows[0].id;
  for (const a of m.attachments ?? []) await c.query('insert into message_attachments(message_id, upload_id, name, kind, size) values ($1,$2,$3,$4,$5)', [id, a.uploadId ?? null, a.name, a.kind, a.size]);
  const dto = (await messagesWhere(c, 'm.id=$1', [id]))[0];
  if (m.status) dto.status = m.status; // the state the receipt written right after will give, so the event and the response agree
  if (m.thread.mission_id && !m.quiet) {
    await emit(c, { tenantId: m.thread.tenant_id, type: 'conversation.messageCreated', subjectKind: 'thread', subject: m.thread.id, missionId: m.thread.mission_id,
      actor: m.actor?.id ?? (m.authorKind === 'system' ? 'system' : m.authorId), actorKind: m.actor?.kind ?? m.authorKind, correlationId: m.correlationId,
      payload: { threadId: m.thread.id, messageId: dto.id, seq, kind: m.kind, simulated: m.simulated, message: dto } });
  }
  return dto;
}

export async function addReceipt(c: Tx, thread: { id: string; tenant_id: string; mission_id: string | null }, messageId: string, state: 'queued' | 'delivered' | 'acknowledged', opts: { at?: Date; quiet?: boolean; simulated?: boolean; correlationId?: string } = {}) {
  await c.query(`insert into message_receipts(message_id, state, at) values ($1,$2, coalesce($3::timestamptz, now()))`, [messageId, state, opts.at ?? null]);
  if (thread.mission_id && !opts.quiet) {
    await emit(c, { tenantId: thread.tenant_id, type: 'conversation.receipt', subjectKind: 'thread', subject: thread.id, missionId: thread.mission_id, correlationId: opts.correlationId,
      payload: { threadId: thread.id, messageId, state, simulated: !!opts.simulated } });
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
