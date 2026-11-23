import type pg from 'pg';

/** Test helper (c83): inserts `n` plain missions and returns their typed sample references (`mission:<id>`). */
export async function insertMissionRefs(pool: pg.Pool, tenantId: string, ownerId: string, n: number, prefix: string): Promise<string[]> {
  const ids = Array.from({ length: n }, (_, i) => `M-${prefix}${i}`);
  await pool.query(`insert into missions(id, tenant_id, owner_id, status) select x, $1, $2, 'completed' from unnest($3::text[]) x on conflict do nothing`, [tenantId, ownerId, ids]);
  return ids.map((id) => `mission:${id}`);
}
