import type { AttentionKind, AttentionReasonCode } from '../../../shared/contracts/src/index.ts';

/** Values a "why" template may use: enums, numbers and system ids. Free text an agent or a person wrote is never a fact. */
export type Fact = string | number | null;

/** One underlying thing that needs a person, as read from the stored records. Ages and distances are seconds computed by the database (now()). */
export interface AttentionItem {
  id: string; reason: AttentionReasonCode; kind: AttentionKind;
  /** R2 to R4 for an approval, null for every other kind */
  tier: string | null;
  /** the item's own name (an approval title, a task title): agent- or person-written, shown apart from the sentence */
  subject: string;
  ageSec: number; expiresInSec: number | null;
  missionId: string | null; demo: boolean;
  route: string;
  /** whether the viewer may act on it, by the rule of the route that acts (decideRefusal, the review and proposal rules), and why not */
  canAct: boolean; note: string | null;
  /** stored fields the sentence is built from */
  facts: Record<string, Fact>;
}
