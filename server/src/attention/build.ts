import type { Db, Tx } from '../db.ts';
import { attentionReason } from '../../../shared/contracts/src/index.ts';
import { loadItems, type Viewer } from './queue.ts';
import { whyOf } from './why.ts';
import { collapseItems } from './collapse.ts';

type Q = Tx | Db;

/**
 * c68: the ranked, collapsed queue. Items are read (queue.ts), folded where related (collapse.ts) and ranked (rank.ts). The totals
 * let the screen show that nothing is hidden: items = the sum of the row counts, collapsed = items - rows.
 */
export async function buildAttention(c: Q, v: Viewer) {
  const items = await loadItems(c, v);
  const groups = collapseItems(items);
  const rows = groups.map((g) => ({
    id: g.id, reason: g.lead.reason, kind: g.lead.kind, icon: attentionReason(g.lead.reason).icon, tier: g.lead.tier, subject: g.lead.subject,
    why: whyOf(g.lead.reason, { ...g.lead.facts, ageSec: g.ageSec, expiresInSec: g.expiresInSec }, g.count),
    ageSec: g.ageSec, expiresInSec: g.expiresInSec, count: g.count, groupedBy: g.groupedBy, missionId: g.lead.missionId, route: g.lead.route,
    members: g.members.map((m) => ({ id: m.id, subject: m.subject, ageSec: m.ageSec, expiresInSec: m.expiresInSec, route: m.route, tier: m.tier })),
  }));
  return { rows, totals: { items: items.length, rows: rows.length, collapsed: items.length - rows.length } };
}
