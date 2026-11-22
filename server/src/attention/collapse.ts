import type { AttentionItem } from './types.ts';
import { rankItems, TIER_BAND, type Rankable } from './rank.ts';

/**
 * Collapsing related items into one row with a count (c68 item 3).
 * Items fold only by what they are about: the same mission and tier (approvals), the same mission (reviews, waiting tasks),
 * the same failure mode, the same agent and reason (lessons). Never by a person. Nothing is hidden except by this fold: every
 * folded item stays listed in its row, the row's count always equals that list, and there is no limit, budget or suppression.
 * R3 and R4 approvals (and any tier this code does not know) are never folded, so an urgent approval always has a row of its own.
 */
export const MIN_GROUP = 2;

export interface AttentionGroup {
  id: string; groupedBy: string | null;
  /** the best-ranked member */
  lead: AttentionItem;
  /** best first; every folded item is here exactly once */
  members: AttentionItem[];
  count: number;
  /** the longest wait among the members, and the soonest expiry (null when none expires) */
  ageSec: number; expiresInSec: number | null;
}

const FOLDABLE_APPROVAL_TIERS = new Set(['R2']);

/** What an item folds with, or null when it is never folded. */
export function groupKeyOf(i: AttentionItem): string | null {
  switch (i.kind) {
    case 'approval': return i.tier !== null && FOLDABLE_APPROVAL_TIERS.has(i.tier) && i.tier in TIER_BAND && i.missionId ? `approval|mission:${i.missionId}|tier:${i.tier}` : null;
    case 'task_review': return i.missionId ? `review|mission:${i.missionId}` : null;
    case 'task_waiting': return i.missionId ? `waiting|mission:${i.missionId}` : null;
    case 'failure': return i.facts.modeId ? `failure|mode:${i.facts.modeId}` : null;
    case 'lesson': return i.facts.agentId ? `lesson|agent:${i.facts.agentId}|${i.reason}` : null;
    case 'proposal': return null;
  }
}
const label = (key: string) => key.split('|').slice(1).join(' ');

/** The groups, in ranked order (rows rank by their best member; see rank.ts). */
export function collapseItems(items: readonly AttentionItem[]): AttentionGroup[] {
  const ranked = rankItems(items);
  const byKey = new Map<string, AttentionItem[]>();
  const singles: AttentionItem[] = [];
  for (const i of ranked) {
    const k = groupKeyOf(i);
    if (k === null) { singles.push(i); continue; }
    const l = byKey.get(k);
    if (l) l.push(i); else byKey.set(k, [i]);
  }
  const groups: AttentionGroup[] = [];
  const make = (members: AttentionItem[], key: string | null): AttentionGroup => {
    const expiries = members.map((m) => m.expiresInSec).filter((e): e is number => e !== null);
    return {
      id: key === null ? members[0].id : `group:${key}`, groupedBy: key === null ? null : label(key), lead: members[0], members, count: members.length,
      ageSec: Math.max(...members.map((m) => m.ageSec)), expiresInSec: expiries.length ? Math.min(...expiries) : null,
    };
  };
  for (const i of singles) groups.push(make([i], null));
  for (const [k, m] of byKey) groups.push(m.length >= MIN_GROUP ? make(m, k) : make(m, null));
  const key = (g: AttentionGroup): Rankable => ({ id: g.id, tier: g.lead.tier, expiresInSec: g.expiresInSec, ageSec: g.ageSec });
  const order = new Map(rankItems(groups.map(key)).map((r, n) => [r.id, n]));
  return groups.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}
