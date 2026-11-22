/** Typed delegation brief (c42). The server validates it with zod; this is the shape the web reads. */
export type BriefTier = 'R0' | 'R1' | 'R2' | 'R3' | 'R4';
export interface BriefCapability { kind: string; origin?: string }
export interface DelegationBriefData {
  goal: string; inputs: string[]; acceptance: string[]; capabilities: BriefCapability[]; budget?: number; deadline?: string; escalation: string;
}
export interface DelegationBriefDto {
  id: string; missionId: string; taskId: string | null; fromId: string; fromKind: 'user' | 'agent'; toInstanceId: string; toAgentId: string;
  brief: DelegationBriefData; sha256: string; parentBriefId: string | null; supersedesId: string | null; depth: number; simulated: boolean; createdAt: string;
  tiers: Record<string, BriefTier | null>;
  /** recomputed on every read: own capabilities intersected with the latest brief of each ancestor; minimal deadline and budget */
  effective?: { capabilities: BriefCapability[]; deadline: string | null; budget: number | null; narrowedBy: { briefId: string; toAgentId: string; dropped: string[] }[] };
}
export interface DelegableKind { kind: string; tier: BriefTier; effect: string; approver: string | null; allowed: boolean; why: string }
export interface DelegationBriefList { briefs: DelegationBriefDto[]; maxDepth: number; kinds: DelegableKind[] }
