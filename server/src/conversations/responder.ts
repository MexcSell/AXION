import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tx, type Db, type Tx } from '../db.ts';
import { audit } from '../audit.ts';
import { z } from 'zod';
import { CloudCallError } from '../cloud/claude-cli.ts';
import type { ModelRouter } from '../cloud/router.ts';
import { addReceipt, appendMessage, messagesWhere, type ThreadRow } from './service.ts';
import { companyContext } from './company-context.ts';
import { DRAFT_CRITERIA_MAX, DRAFT_CRITERION_MAX, DRAFT_TEXT_MAX, DRAFT_TITLE_MAX, type MessageDto, type MissionDraftDto } from '../../../shared/contracts/src/conversations.ts';

/**
 * Live answers in the General Manager and agent chats (owner 2026-11-25: model Claude 2, the GM sees company data, no limits, every
 * agent channel too). Mission threads still never call a model.
 *
 * Flow: the POST stores the person's message as 'queued' and commits; then `schedule(thread)` starts (or re-arms) one worker per thread.
 * The worker marks every waiting message 'delivered' (the web shows "thinking"), sends the company data and the conversation to the model
 * on stdin, and posts the answer as the agent (author_kind 'agent', author_id = the agent id) with every answered message 'acknowledged'.
 * One call answers all waiting messages of the thread. A failure posts a system note saying why; the messages stay 'delivered' and are
 * answered together with the next message (or at the next server start). No rate limit and no in-flight cap here (owner: no restrictions).
 * When the model is not configured, disabled or removed on Models › Providers, the channels keep the honest "can't answer yet" note.
 */
export interface ChatResponder {
  /** true when a post to a gm or agent channel of this tenant will be answered */
  enabled(c: Db | Tx, tenantId: string): Promise<boolean>;
  schedule(threadId: string): void;
  /** resolves when no worker runs (tests; shutdown) */
  idle(): Promise<void>;
  /** at startup: threads with a waiting message get a worker */
  sweep(): Promise<void>;
  close(): Promise<void>;
}

const TRANSCRIPT_CAP = 40_000; // characters of conversation in one prompt (the newest messages are kept)
const HISTORY = 80;            // messages read back
const BODY_MAX = 8000;         // messages.body check
const WAITING = `(select r.state from message_receipts r where r.message_id=m.id order by r.id desc limit 1) in ('queued','delivered')`;

const system = (name: string, duty: string, gm: boolean) =>
  `You are ${name}, ${duty} of a company run on AXION, an agent company operating system. A person from the company is chatting with you in the AXION web app. ` +
  'The message holds who you are (between <about_you> tags), the company data (between <company_data> tags) and the conversation so far. Answer from them. ' +
  'When the data does not hold the answer, say so plainly: never invent missions, agents, people, numbers, pages or results. ' +
  'You cannot run tools, browse, or change anything in AXION, and missions are not executed by agents yet: when asked to act, say what the person can do in AXION instead, ' +
  'and never promise to remember, note or do something later. ' +
  (gm ? 'When the person asks for work to be done, draft it as a mission: end your reply with exactly one block ' +
    '<mission_draft>{"title": "short title", "text": "what to do and why, for the agents", "criteria": ["checkable done criterion", "..."]}</mission_draft> ' +
    'and say they can create it with the "Create mission" button under your reply. Only one draft, only when work is asked for, valid JSON. ' : '') +
  'Reply in the language of the person\'s last message, briefly and directly, as plain text: the chat shows no Markdown, so no **bold**, # headings, tables or code fences (simple "- " lists are fine).';

const Draft = z.object({
  title: z.string().trim().min(1).max(DRAFT_TITLE_MAX),
  text: z.string().trim().min(1).max(DRAFT_TEXT_MAX),
  criteria: z.array(z.string().trim().min(1).max(DRAFT_CRITERION_MAX)).max(DRAFT_CRITERIA_MAX).default([]),
});
/** The GM's <mission_draft> block: removed from the shown text; kept as the message's draft when it is valid JSON of the right shape. */
export function extractDraft(text: string): { body: string; draft: MissionDraftDto | null } {
  const re = /<mission_draft>([\s\S]*?)<\/mission_draft>/g;
  const blocks = [...text.matchAll(re)];
  if (!blocks.length) return { body: text, draft: null };
  const body = text.replace(re, '').replace(/\n{3,}/g, '\n\n').trim();
  let draft: MissionDraftDto | null = null;
  try {
    const raw = blocks.at(-1)![1].trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    const r = Draft.safeParse(JSON.parse(raw));
    if (r.success) draft = r.data;
  } catch { /* not JSON: shown without a draft */ }
  return { body: body || (draft ? 'Here is a mission draft.' : '(no answer)'), draft };
}

/** Who the agent is: its definition, the active version (model, skills, tools) and its current playbook. */
async function aboutAgent(c: Db | Tx, tenantId: string, agentId: string): Promise<string> {
  const a = (await c.query(`select d.name, d.role, d.dept, d.duty, d.description, d.profile, v.label, v.model, v.skills, v.tools
    from agent_definitions d left join agent_versions v on v.id=d.active_version_id where d.id=$1 and d.tenant_id=$2`, [agentId, tenantId])).rows[0];
  if (!a) return `Agent ${agentId} (no definition found).`;
  const list = (x: unknown) => (Array.isArray(x) ? x.map((y) => (typeof y === 'string' ? y : (y as { name?: string; id?: string })?.name ?? (y as { id?: string })?.id ?? JSON.stringify(y))).join(', ') : '');
  const p = (a.profile ?? {}) as Record<string, unknown>;
  const lines = [`${a.name}: ${a.duty} (${a.role}, ${a.dept}). ${a.description}`];
  if (a.label) lines.push(`Active version ${a.label}${a.model ? `, configured model ${a.model}` : ''}.`);
  if (list(a.skills)) lines.push(`Skills: ${list(a.skills)}.`);
  lines.push(`Tools: ${list(a.tools) || 'none listed'} (none of them can run from this chat).`);
  if (p.grade || p.level) lines.push(`Grade ${p.grade ?? '?'}, level ${p.level ?? '?'}, load ${p.load ?? '?'}%, growth ${p.growth ?? '?'}.`);
  const pb = (await c.query(`select version, items from playbooks where tenant_id=$1 and agent_id=$2 order by version desc limit 1`, [tenantId, agentId])).rows[0];
  const items = Array.isArray(pb?.items) ? pb.items.slice(0, 20).map((i: unknown) => (typeof i === 'string' ? i : (i as { text?: string; rule?: string })?.text ?? (i as { rule?: string })?.rule ?? JSON.stringify(i))) : [];
  lines.push(items.length ? `Playbook v${pb.version}:\n- ${items.map((t: string) => t.slice(0, 300)).join('\n- ')}` : 'Playbook: none yet.');
  return lines.join('\n');
}

export function chatResponder(app: FastifyInstance, router: ModelRouter): ChatResponder {
  const chains = new Map<string, { again: boolean; done: Promise<void> }>();
  let closing = false;
  const log = app.log;

  /** true when some model of the tenant's chat route is enabled (cooling ones count: the router tries them last) */
  async function enabled(c: Db | Tx, tenantId: string) {
    if (closing || !router.adapters.length) return false;
    return (await router.candidates(c, tenantId)).length > 0;
  }

  /** One answer for the thread's waiting messages. true = answered (look again), false = nothing waiting, or every model failed. */
  async function answerOnce(threadId: string): Promise<boolean> {
    const db = app.db;
    const th: ThreadRow | undefined = (await db.query(`select * from conversation_threads where id=$1 and scope='direct' and kind in ('gm','agent-direct')`, [threadId])).rows[0];
    if (!th || !th.owner_user_id) return false;
    const candidates = await router.candidates(db, th.tenant_id);
    if (!candidates.length) return false;
    const owner = (await db.query(`select id, name, role, status from users where id=$1 and tenant_id=$2`, [th.owner_user_id, th.tenant_id])).rows[0];
    if (!owner || owner.status !== 'approved') return false; // a pending, rejected or disabled account is not answered
    const waiting = (await db.query(`select m.id, (select r.state from message_receipts r where r.message_id=m.id order by r.id desc limit 1) as state
      from messages m where m.thread_id=$1 and m.author_kind='human' and m.author_id=$2 and ${WAITING} order by m.seq`, [th.id, owner.id])).rows as { id: string; state: string }[];
    if (!waiting.length) return false;
    const gm = th.kind === 'gm';
    const agentId = gm ? 'gm' : th.a === 'human' ? th.b : th.a;
    const agent = (await db.query(`select id, name, duty, role, dept from agent_definitions where id=$1 and tenant_id=$2`, [agentId, th.tenant_id])).rows[0];
    const name = gm ? 'the General Manager' + (agent?.name && agent.name !== 'GM' ? ` (${agent.name})` : '') : agent?.name ?? agentId;
    const who = gm ? 'the General Manager' : `${agent?.name ?? agentId}`;

    await tx(db, async (c) => { for (const w of waiting) if (w.state === 'queued') await addReceipt(c, th, String(w.id), 'delivered', { channelEvent: true }); });
    if (closing) return false;

    const models = router.adapters.map((m) => ({ id: m.id, label: m.label, model: m.model }));
    const data = await companyContext(db, { tenantId: th.tenant_id, userId: owner.id, admin: owner.role === 'admin' }, models);
    const about = await aboutAgent(db, th.tenant_id, agentId);
    const history = (await messagesWhere(db, 'm.thread_id=$1', [th.id], `order by m.seq desc limit ${HISTORY}`)).reverse();
    const prompt = `<about_you>\n${about}\n</about_you>\n\n<company_data>\n${data}\n</company_data>\n\n<conversation>\n${transcript(history, owner.id)}\n</conversation>\n\n` +
      `Write ${who}'s next reply to ${owner.name}. It answers ${waiting.length === 1 ? 'their newest message' : `their last ${waiting.length} messages, which were waiting`}.`;
    const sys = system(name, gm ? 'the General Manager' : `the agent responsible for ${agent?.duty ?? 'its duty'} (${agent?.role ?? 'agent'}, ${agent?.dept ?? 'the company'})`, gm);
    const failures: string[] = [];
    for (const [i, adapter] of candidates.entries()) {
      if (closing) return false;
      const started = Date.now();
      const base = { tenantId: th.tenant_id, actor: owner.id, action: 'model.cloud.chat', subject: `${adapter.id}:${adapter.model}`, correlationId: randomUUID() };
      try {
        const r = await adapter.complete({ prompt, system: sys });
        router.report(adapter.id, { ok: true });
        if (closing) return false;
        const { body: text, draft } = gm ? extractDraft(r.text.trim()) : { body: r.text.trim(), draft: null };
        const clean = text || '(no answer)';
        const body = clean.length > BODY_MAX ? clean.slice(0, BODY_MAX - 1) + '…' : clean;
        await tx(db, async (c) => {
          const locked = (await c.query('select * from conversation_threads where id=$1 for update', [th.id])).rows[0] as ThreadRow;
          await appendMessage(c, { thread: locked, authorKind: 'agent', authorId: agentId, recipient: `human:${owner.id}`, kind: 'reply', body, replyTo: String(waiting.at(-1)!.id), simulated: false, draft });
          for (const w of waiting) await addReceipt(c, locked, String(w.id), 'acknowledged', { channelEvent: true });
          await audit(c, { ...base, result: 'ok', detail: { channel: th.kind, agentId, answered: waiting.length, fallback: i > 0, draft: !!draft, promptChars: prompt.length, answerChars: r.text.length, usageIn: r.usage.input, usageOut: r.usage.output, durationMs: r.durationMs } });
        });
        return true;
      } catch (e) {
        if (closing) return false;
        const kind = e instanceof CloudCallError ? e.kind : 'failed';
        router.report(adapter.id, { ok: false, kind, resetsAt: null });
        log.warn({ model: adapter.id, thread: th.id, kind, why: e instanceof CloudCallError ? e.message : String(e), next: candidates[i + 1]?.id ?? null }, 'chat answer failed');
        failures.push(kind === 'limited' ? `${adapter.label} reached a usage limit` : kind === 'timeout' ? `${adapter.label} did not answer in time` : `${adapter.label} failed`);
        await audit(db, { ...base, result: 'error', detail: { channel: th.kind, agentId, waiting: waiting.length, fallback: i > 0, promptChars: prompt.length, durationMs: Date.now() - started, kind } })
          .catch((err) => log.error({ err }, 'chat failure audit could not be saved'));
      }
    }
    await tx(db, async (c) => {
      const locked = (await c.query('select * from conversation_threads where id=$1 for update', [th.id])).rows[0] as ThreadRow;
      await appendMessage(c, { thread: locked, authorKind: 'system', authorId: 'system', recipient: 'human', kind: 'system', simulated: false,
        body: `${who[0].toUpperCase() + who.slice(1)} could not answer: ${failures.join('; ')}. Your message is kept and will be answered with your next message.` });
    }).catch((err) => log.error({ err }, 'chat failure note could not be saved'));
    return false;
  }

  function schedule(threadId: string) {
    if (closing || !router.adapters.length) return;
    const cur = chains.get(threadId);
    if (cur) { cur.again = true; return; }
    const entry = { again: true, done: Promise.resolve() };
    entry.done = (async () => {
      try {
        while (entry.again && !closing) {
          entry.again = false;
          while (!closing && await answerOnce(threadId)) { /* answered: anything newer waiting? */ }
        }
      } catch (err) { if (!closing) log.error({ err, thread: threadId }, 'chat responder failed'); }
      finally { chains.delete(threadId); }
    })();
    chains.set(threadId, entry);
  }

  return {
    enabled,
    schedule,
    async idle() { while (chains.size) await Promise.all([...chains.values()].map((c) => c.done)); },
    async sweep() {
      if (!router.adapters.length) return;
      const rows = (await app.db.query(`select distinct m.thread_id from messages m join conversation_threads t on t.id=m.thread_id
        where t.scope='direct' and t.kind in ('gm','agent-direct') and m.author_kind='human' and m.author_id=t.owner_user_id and ${WAITING}`)).rows;
      for (const r of rows) schedule(r.thread_id);
    },
    async close() {
      closing = true;
      // a model call can take minutes: shutdown waits a little, then leaves it (the reply is dropped; the next start answers the message again)
      await Promise.race([Promise.all([...chains.values()].map((c) => c.done)), new Promise((r) => setTimeout(r, 3000).unref())]);
    },
  };
}

/** The conversation as plain lines, oldest first, cut from the oldest end to TRANSCRIPT_CAP. System notes are left out. */
function transcript(history: MessageDto[], ownerId: string): string {
  const lines = history.filter((m) => m.kind !== 'system').map((m) => {
    const when = new Date(m.ts).toISOString().slice(0, 16).replace('T', ' ');
    const who = m.from === `human:${ownerId}` ? `${m.author?.name ?? 'Person'} (person)` : m.author?.kind === 'agent' ? `${m.author.name} (you)` : m.author?.name ?? m.from;
    const att = m.attachments?.length ? ` [attached: ${m.attachments.map((a) => a.name).join(', ')}]` : '';
    return `[${when} UTC] ${who}: ${m.text}${att}`;
  });
  let out = ''; let n = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (n + lines[i].length + 1 > TRANSCRIPT_CAP) { out = '…(older messages left out)\n' + out; break; }
    out = lines[i] + '\n' + out; n += lines[i].length + 1;
  }
  return out.trimEnd();
}
