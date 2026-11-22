import { z } from 'zod';
import type { Tx, Db } from '../db.ts';
import { ApiError } from '../errors.ts';
import { HUMAN_POST_KINDS, MAX_BODY } from '../../../shared/contracts/src/conversations.ts';

export const invalid = (fieldErrors: Record<string, string>) => new ApiError('VALIDATION', 422, 'Some fields are not valid.', { fieldErrors });

const Base = {
  kind: z.string(), text: z.string().max(MAX_BODY, `at most ${MAX_BODY} characters`).default(''),
  replyTo: z.string().max(100).optional(), uploadIds: z.array(z.string().max(40)).max(10).default([]),
};
// unknown keys (from, author, simulated, ...) are dropped: authorship comes from the session
const PostIn = z.object(Base);
const PostInTo = z.object({ ...Base, to: z.string().min(1).max(200) });

export interface ParsedPost { kind: string; text: string; replyTo?: string; uploadIds: string[]; to?: string }

/** The one post validator for mission threads (`withTo`) and direct channels. `text` comes back trimmed. */
export function parsePost(body: unknown, opts: { withTo: boolean }): ParsedPost {
  const p = (opts.withTo ? PostInTo : PostIn).safeParse(body ?? {});
  if (!p.success) throw invalid(Object.fromEntries(p.error.issues.map((i) => [i.path.join('.') || '_', i.message])));
  const b = p.data as ParsedPost;
  if (!(HUMAN_POST_KINDS as readonly string[]).includes(b.kind)) throw invalid({ kind: 'people can only send a command or a reply' });
  const text = b.text.trim();
  if (!text && !b.uploadIds.length) throw invalid({ text: 'write a message or attach a file' });
  return { ...b, text };
}

/** `replyTo` must be a message of the same conversation (messages.id is a bigint; reply_to is stored as text). */
export async function assertReplyInThread(c: Tx | Db, threadId: string, replyTo: string | undefined) {
  if (replyTo === undefined) return;
  const ok = /^\d{1,18}$/.test(replyTo) && (await c.query('select 1 from messages where id=$1::bigint and thread_id=$2', [replyTo, threadId])).rowCount;
  if (!ok) throw invalid({ replyTo: 'must be a message in this conversation' });
}
