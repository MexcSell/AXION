import type { Tx } from '../db.ts';

/** Placeholder until the durable event log (Task 5): events are accepted and dropped. */
export interface EmitInput { tenantId: string; type: string; subject: string; missionId?: string; adminOnly?: boolean; userId?: string; payload?: Record<string, unknown> }
export async function emit(_c: Tx, _e: EmitInput): Promise<void> { /* Task 5 */ }
