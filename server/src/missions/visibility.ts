import type { Ctx } from '../auth/session.ts';

/** Owner update u1: administrators see everything, owners see theirs, everyone sees shared missions. One rule for list, read, write and events. */
export function canSee(ctx: Pick<Ctx, 'tenantId' | 'user'>, m: { tenant_id: string; owner_id: string; shared: boolean; deleted_at?: Date | null }): boolean {
  if (m.tenant_id !== ctx.tenantId || m.deleted_at) return false;
  return ctx.user.role === 'admin' || m.owner_id === ctx.user.id || m.shared;
}
/** The same rule as SQL; $admin, $user are bind parameters. */
export const VISIBLE_SQL = (admin: string, user: string) => `(${admin}::boolean or m.owner_id = ${user} or m.shared)`;
/** Only the owner or an administrator may flip `shared` or delete. */
export const canManage = (ctx: Pick<Ctx, 'user'>, m: { owner_id: string }) => ctx.user.role === 'admin' || m.owner_id === ctx.user.id;
