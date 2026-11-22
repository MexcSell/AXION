/**
 * Harness only (api-c58.mjs): adds N more pending approvals to the e2e database so the approval-quality statistics can reach five decisions
 * (the demo seed has four). Refuses any database that is not an axion_e2e one, like e2e-serve.ts.
 */
import { makePool, tx } from '../db.ts';
import { requestApproval } from '../approvals/service.ts';

const url = process.env.E2E_DATABASE_URL;
if (!url || !/\/axion_e2e\d*(\?|$)/.test(url)) throw new Error('E2E_DATABASE_URL must point at axion_e2e or axion_e2e<N>');
const n = Number(process.argv[2] || 4);
const pool = makePool(url, undefined, 1);
const m = (await pool.query(`select id, tenant_id from missions where deleted_at is null order by id limit 1`)).rows[0];
if (!m) throw new Error('no mission in the e2e database yet: sign in first');
for (let i = 0; i < n; i++) await tx(pool, (c) => requestApproval(c, { tenantId: m.tenant_id, missionId: m.id, agentId: 'release-01', kind: 'submit_form', title: `Extra approval ${i + 1}`, detail: 'Added by the e2e harness for the statistics.', payload: { extra: i }, expiresInMin: 24 * 60 }));
await pool.end();
console.log(`added ${n} approvals on ${m.id}`);
