import type { Tx } from '../db.ts';
import { HONEST_NOTE } from '../../../shared/contracts/src/conversations.ts';
import { appendMessage } from './service.ts';

/**
 * Decision E5: real missions have no agent replies. The first command in a thread gets exactly one honest system note
 * (author 'system', kind 'system', simulated=false). The caller holds the thread row lock, so concurrent posts add it once.
 */
export async function ensureHonestNote(c: Tx, thread: { id: string; tenant_id: string; mission_id: string | null }) {
  const has = (await c.query(`select 1 from messages where thread_id=$1 and author_kind='system' and body=$2 limit 1`, [thread.id, HONEST_NOTE])).rowCount;
  if (has) return null;
  return appendMessage(c, { thread, authorKind: 'system', authorId: 'system', recipient: 'human', kind: 'system', body: HONEST_NOTE, simulated: false });
}
