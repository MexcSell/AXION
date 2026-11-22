import type { Db, Tx } from '../db.ts';
import { attentionReason, ATTENTION_SETTINGS, ATTENTION_RANKING_TEXT, type AttentionDto, type AttentionRowDto } from '../../../shared/contracts/src/index.ts';
import { loadItems, type Viewer } from './queue.ts';
import { whyOf } from './why.ts';
import { collapseItems } from './collapse.ts';
import { evidenceOf, actionOf } from './evidence.ts';

type Q = Tx | Db;

/**
 * c68: the ranked, collapsed queue. Items are read (queue.ts), folded where related (collapse.ts) and ranked (rank.ts). The totals
 * let the screen show that nothing is hidden: items = the sum of the row counts, collapsed = items - rows.
 */
export async function buildAttention(c: Q, v: Viewer): Promise<AttentionDto> {
  const items = await loadItems(c, v);
  const groups = collapseItems(items);
  const rows: AttentionRowDto[] = groups.map((g) => ({
    id: g.id, reason: g.lead.reason, kind: g.lead.kind, icon: attentionReason(g.lead.reason).icon, tier: g.lead.tier, subject: g.lead.subject,
    why: whyOf(g.lead.reason, { ...g.lead.facts, ageSec: g.ageSec, expiresInSec: g.expiresInSec }, g.count),
    ageSec: g.ageSec, expiresInSec: g.expiresInSec, ageNote: g.members.find((m) => m.ageNote)?.ageNote ?? null, count: g.count, groupedBy: g.groupedBy, missionId: g.lead.missionId,
    action: actionOf(g.lead.reason, g.lead), evidence: evidenceOf(g.lead.reason, g.lead.facts),
    members: g.members.map((m) => ({ id: m.id, subject: m.subject, ageSec: m.ageSec, expiresInSec: m.expiresInSec, ageNote: m.ageNote ?? null, route: m.route, tier: m.tier, canAct: m.canAct, note: m.canAct ? null : m.note, demo: m.demo, evidence: evidenceOf(m.reason, m.facts) })),
  }));
  const checkedAt = new Date((await c.query('select now() as at')).rows[0].at).toISOString();
  return { rows, totals: { items: items.length, rows: rows.length, collapsed: items.length - rows.length }, settings: { ...ATTENTION_SETTINGS }, ranking: ATTENTION_RANKING_TEXT, checkedAt };
}
