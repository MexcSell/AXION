import type { Db, Tx } from '../db.ts';
import { attentionReason } from '../../../shared/contracts/src/index.ts';
import { loadItems, type Viewer } from './queue.ts';
import { whyOf } from './why.ts';
import { rankItems } from './rank.ts';

type Q = Tx | Db;

/** c68: one row per item in the fixed ranked order (rank.ts). Collapsing related rows arrives in item 3. */
export async function buildAttention(c: Q, v: Viewer) {
  const items = rankItems(await loadItems(c, v));
  return { rows: items.map((i) => ({ id: i.id, reason: i.reason, kind: i.kind, icon: attentionReason(i.reason).icon, tier: i.tier, subject: i.subject, why: whyOf(i.reason, i.facts), ageSec: i.ageSec, expiresInSec: i.expiresInSec, missionId: i.missionId, route: i.route })) };
}
