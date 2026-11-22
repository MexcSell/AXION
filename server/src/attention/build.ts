import type { Db, Tx } from '../db.ts';
import { attentionReason } from '../../../shared/contracts/src/index.ts';
import { loadItems, type Viewer } from './queue.ts';
import { whyOf } from './why.ts';

type Q = Tx | Db;

/** c68 item 1: one row per item, oldest first. (The fixed ranking and the collapsing arrive in the next items.) */
export async function buildAttention(c: Q, v: Viewer) {
  const items = (await loadItems(c, v)).sort((a, b) => b.ageSec - a.ageSec || (a.id < b.id ? -1 : 1));
  return { rows: items.map((i) => ({ id: i.id, reason: i.reason, kind: i.kind, icon: attentionReason(i.reason).icon, tier: i.tier, subject: i.subject, why: whyOf(i.reason, i.facts), ageSec: i.ageSec, expiresInSec: i.expiresInSec, missionId: i.missionId, route: i.route })) };
}
