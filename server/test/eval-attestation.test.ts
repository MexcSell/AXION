import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { makeSchema } from './helpers.ts';
import { makeDataset, addRun, allYes } from './eval-fixtures.ts';
import { ATTESTATION_ITEMS, attestDataset, datasetValidity } from '../src/evolution/attestation.ts';
import { loadEvaluations } from '../src/evolution/proposal-evidence.ts';

// c61 R2-3: dataset attestation. ABC-style (A3, NeurIPS 2025 D&B): task validity, outcome validity, reporting. The item wording is ours;
// we do not claim the paper's item list. Human attestation; records and validation only, no execution. The per-run "disallowed
// source reachable" flag is deferred: it needs execution.
let s: Awaited<ReturnType<typeof makeSchema>>;
let v1 = '';
const q = (sql: string, p: unknown[] = []) => s.pool.query(sql, p);
const cx = async <T>(fn: (c: pg.PoolClient) => Promise<T>) => { const c = await s.pool.connect(); try { return await fn(c); } finally { c.release(); } };
const attest = (datasetId: string, attestorId: string, answers: Record<string, { answer: string; note?: string }> = allYes()) =>
  cx((c) => attestDataset(c, { tenantId: 't-1', datasetId, attestorId, answers: answers as never }));
let n = 0;
/** an unfrozen dataset by author `au` with 3 cases */
async function ds(author: string | null = 'u-author', cases = 3) {
  const id = 'AD' + ++n;
  await makeDataset(s.pool, { id, split: 'holdout', cases, freeze: false, createdBy: author ?? undefined });
  return id;
}
beforeAll(async () => {
  s = await makeSchema();
  await q(`insert into tenants(id,name) values ('t-1','T') on conflict do nothing`);
  await q(`insert into users(id,tenant_id,name,name_key,pass_hash,role,status) values
    ('u-author','t-1','Author','author','h','admin','approved'), ('u-adm','t-1','Adm','adm','h','admin','approved'), ('u-adm2','t-1','Adm2','adm2','h','admin','approved'),
    ('u-mem','t-1','Mem','mem','h','member','approved'), ('u-off','t-1','Off','off','h','admin','disabled')`);
  await q(`insert into agent_definitions(id, tenant_id, name, role, dept, duty, created_by) values ('a-1','t-1','A','r','D','duty','u')`);
  v1 = (await q(`insert into agent_versions(agent_id, seq, label, model, prompt_hash, created_by) values ('a-1',1,'v1','m','h','u') returning id`)).rows[0].id;
});
afterAll(async () => { await s.drop(); });

describe('the checklist', () => {
  it('has items in all three groups, with unique ids, and the SQL list is the same', async () => {
    const cats = new Set(ATTESTATION_ITEMS.map((i) => i.category));
    expect([...cats].sort()).toEqual(['outcome_validity', 'reporting', 'task_validity']);
    for (const c of cats) expect(ATTESTATION_ITEMS.filter((i) => i.category === c).length).toBeGreaterThanOrEqual(3);
    expect(new Set(ATTESTATION_ITEMS.map((i) => i.id)).size).toBe(ATTESTATION_ITEMS.length);
    const sql = (await q(`select unnest(eval_attestation_item_ids()) id`)).rows.map((r) => r.id).sort();
    expect(sql).toEqual(ATTESTATION_ITEMS.map((i) => i.id).sort());
  });
});

describe('who may attest', () => {
  it('an administrator who is not the author can', async () => {
    const d = await ds();
    const r = await attest(d, 'u-adm');
    expect(r.version).toBe(1);
    const row = (await q(`select content_sha256 h, attestor_id a from eval_attestations where dataset_id=$1`, [d])).rows[0];
    expect(row.a).toBe('u-adm');
    expect(row.h).toBe((await q(`select eval_dataset_sha($1) h`, [d])).rows[0].h);
    expect(r.contentSha256).toBe(row.h);
  });
  it('the author cannot attest their own dataset (also not with another spelling of the id)', async () => {
    const d = await ds();
    await expect(attest(d, 'u-author')).rejects.toThrow(/attestor_is_author/);
    const d2 = await ds('U-Author ');
    await expect(attest(d2, 'u-author')).rejects.toThrow(/attestor_is_author/);
  });
  it('a member, a disabled administrator and an unknown id cannot', async () => {
    const d = await ds();
    await expect(attest(d, 'u-mem')).rejects.toThrow(/attestor_not_admin/);
    await expect(attest(d, 'u-off')).rejects.toThrow(/attestor_not_admin/);
    await expect(attest(d, 'nobody')).rejects.toThrow(/attestor_not_admin/);
  });
  it('a dataset whose author is not recorded cannot be attested (the rule cannot be checked)', async () => {
    const d = await ds(null);
    await expect(attest(d, 'u-adm')).rejects.toThrow(/author_unknown/);
  });
  it('the database refuses the same things for a raw insert', async () => {
    const d = await ds();
    await expect(q(`insert into eval_attestations(tenant_id, dataset_id, version, content_sha256, attestor_id, answers) values ('t-1',$1,1,'x','u-author',$2::jsonb)`, [d, JSON.stringify(allYes())])).rejects.toThrow(/attestor_is_author/);
  });
  it('the author of a dataset cannot be changed afterwards', async () => {
    const d = await ds();
    await expect(q(`update eval_datasets set created_by='u-adm' where id=$1`, [d])).rejects.toThrow(/author/);
  });
});

describe('every item has an answer', () => {
  it('a missing item, an unknown item and a bad answer are refused', async () => {
    const d = await ds();
    const a = allYes();
    const [first] = Object.keys(a);
    const { [first]: _drop, ...rest } = a; void _drop;
    await expect(attest(d, 'u-adm', rest)).rejects.toThrow(/attestation_incomplete/);
    await expect(attest(d, 'u-adm', { ...a, extra_item: { answer: 'yes' } })).rejects.toThrow(/attestation_incomplete/);
    await expect(attest(d, 'u-adm', { ...a, [first]: { answer: 'maybe' } })).rejects.toThrow(/attestation_incomplete/);
    await expect(attest(d, 'u-adm', {})).rejects.toThrow(/attestation_incomplete/);
  });
  it('"not applicable" needs a reason of at least 10 characters', async () => {
    const d = await ds();
    const [first] = Object.keys(allYes());
    await expect(attest(d, 'u-adm', { ...allYes(), [first]: { answer: 'not_applicable' } })).rejects.toThrow(/attestation_incomplete/);
    await expect(attest(d, 'u-adm', { ...allYes(), [first]: { answer: 'not_applicable', note: 'too short' } })).rejects.toThrow(/attestation_incomplete/);
    const r = await attest(d, 'u-adm', { ...allYes(), [first]: { answer: 'not_applicable', note: 'no tools are used by this task set' } });
    expect(r.version).toBe(1);
    const stored = (await q(`select answers from eval_attestations where dataset_id=$1`, [d])).rows[0].answers;
    expect(stored[first]).toEqual({ answer: 'not_applicable', note: 'no tools are used by this task set' });
    expect(Object.keys(stored).length).toBe(ATTESTATION_ITEMS.length);
  });
});

describe('versions are bound to the content hash', () => {
  it('changing an answer is a new version; the old one stays; an identical one is refused', async () => {
    const d = await ds();
    await attest(d, 'u-adm');
    await expect(attest(d, 'u-adm2')).rejects.toThrow(/attestation_unchanged/);
    const [first] = Object.keys(allYes());
    const r2 = await attest(d, 'u-adm2', { ...allYes(), [first]: { answer: 'no', note: 'the reference answers were not rechecked' } });
    expect(r2.version).toBe(2);
    const rows = (await q(`select version, content_sha256 h, attestor_id a from eval_attestations where dataset_id=$1 order by version`, [d])).rows;
    expect(rows.map((r) => r.version)).toEqual([1, 2]);
    expect(rows[0].h).toBe(rows[1].h);
  });
  it('the hash and the version are computed by the database, never taken from the caller', async () => {
    const d = await ds();
    await q(`insert into eval_attestations(tenant_id, dataset_id, version, content_sha256, attestor_id, answers) values ('t-1',$1,7,'forged','u-adm',$2::jsonb)`, [d, JSON.stringify(allYes())]);
    const row = (await q(`select version, content_sha256 h from eval_attestations where dataset_id=$1`, [d])).rows[0];
    expect(row.version).toBe(1);
    expect(row.h).toBe((await q(`select eval_dataset_sha($1) h`, [d])).rows[0].h);
  });
  it('an attestation of cases that were changed afterwards is stale: the freeze is unattested; a new attestation binds the new hash', async () => {
    const d = await ds();
    await attest(d, 'u-adm');
    await q(`insert into eval_cases(dataset_id, case_id, input, expected) values ($1,'c99','{"q":99}','{"a":1}')`, [d]);
    await q(`select eval_freeze_dataset($1)`, [d]);
    expect((await q(`select attested_version v from eval_datasets where id=$1`, [d])).rows[0].v).toBeNull();
    const e = await ds();
    await attest(e, 'u-adm');
    await q(`insert into eval_cases(dataset_id, case_id, input, expected) values ($1,'c99','{"q":99}','{"a":1}')`, [e]);
    const r = await attest(e, 'u-adm');
    expect(r.version).toBe(2);
    await q(`select eval_freeze_dataset($1)`, [e]);
    expect((await q(`select attested_version v from eval_datasets where id=$1`, [e])).rows[0].v).toBe(2);
  });
  it('a frozen dataset cannot be attested afterwards', async () => {
    const d = await ds();
    await q(`select eval_freeze_dataset($1)`, [d]);
    await expect(attest(d, 'u-adm')).rejects.toThrow(/dataset_frozen/);
  });
  it('the attested version of a freeze cannot be chosen by the caller', async () => {
    const d = await ds();
    await attest(d, 'u-adm');
    const sha = (await q(`select eval_dataset_sha($1) h`, [d])).rows[0].h;
    await q(`update eval_datasets set frozen_at=now(), content_sha256=$2, attested_version=5 where id=$1`, [d, sha]);
    expect((await q(`select attested_version v from eval_datasets where id=$1`, [d])).rows[0].v).toBe(1);
    const e = await ds();
    const sha2 = (await q(`select eval_dataset_sha($1) h`, [e])).rows[0].h;
    await q(`update eval_datasets set frozen_at=now(), content_sha256=$2, attested_version=1 where id=$1`, [e, sha2]);
    expect((await q(`select attested_version v from eval_datasets where id=$1`, [e])).rows[0].v).toBeNull();
  });
  it('attestations are append-only (update, delete, truncate), except demo purge', async () => {
    await expect(q(`update eval_attestations set attestor_id='u-adm2'`)).rejects.toThrow(/append-only/);
    await expect(q(`delete from eval_attestations`)).rejects.toThrow(/append-only/);
    await expect(q(`truncate eval_attestations`)).rejects.toThrow(/append-only/);
    const c = await s.pool.connect();
    try { await c.query('begin'); await c.query(`set local axion.purge_demo='on'`); const r = await c.query(`delete from eval_attestations`); expect(r.rowCount).toBeGreaterThan(0); await c.query('rollback'); } finally { c.release(); }
  });
});

describe('unattested datasets can be used, flagged "unvalidated"', () => {
  it('a freeze without an attestation is flagged in 100% of 25 cases', async () => {
    let flagged = 0;
    for (let i = 0; i < 25; i++) {
      const d = await ds(i % 2 ? 'u-author' : null);
      await q(`select eval_freeze_dataset($1)`, [d]);
      const v = await cx((c) => datasetValidity(c, d));
      if (v.unvalidated && v.status === 'unattested' && v.version === null) flagged++;
    }
    expect(flagged).toBe(25);
  });
  it('an attested freeze is validated; a "no" answer makes it failing, still unvalidated, and names the item', async () => {
    const d = await ds(); await attest(d, 'u-adm'); await q(`select eval_freeze_dataset($1)`, [d]);
    expect(await cx((c) => datasetValidity(c, d))).toEqual({ unvalidated: false, status: 'attested', version: 1, failedItems: [] });
    const e = await ds(); const [first] = Object.keys(allYes());
    await attest(e, 'u-adm', { ...allYes(), [first]: { answer: 'no', note: 'a wrong answer is accepted' } }); await q(`select eval_freeze_dataset($1)`, [e]);
    expect(await cx((c) => datasetValidity(c, e))).toEqual({ unvalidated: true, status: 'failing', version: 1, failedItems: [first] });
  });
  const six = (f: (i: number) => number) => Array.from({ length: 12 }, (_, i) => f(i));
  let pn = 0;
  async function evaluated(attested: boolean) {
    const id = 'VD' + ++pn, pid = 'VP' + pn;
    await makeDataset(s.pool, { id, split: 'holdout', cases: 12, createdBy: 'u-author', attestBy: attested ? 'u-adm' : undefined });
    await q(`insert into agent_version_proposals(id, tenant_id, agent_id, base_version_id, base_sha, candidate, candidate_sha, title, created_by) values ($1,'t-1','a-1',$2,'h',$3::jsonb,$1,'t','u')`, [pid, v1, JSON.stringify({ model: 'qwen-72b', skills: [pid], tools: [] })]);
    await addRun(s.pool, { id: 'VB' + pn, datasetId: id, versionId: v1, scores: six(() => 40), judge: 'claude-judge', evaluator: 'ev-b' });
    await addRun(s.pool, { id: 'VC' + pn, datasetId: id, proposalId: pid, scores: six((i) => 70 + (i % 3)), judge: 'claude-judge', evaluator: 'ev-b' });
    return cx(async (c) => (await loadEvaluations(c, 't-1', [{ id: pid, created_by: 'u', base_version_id: v1, candidate: { model: 'qwen-72b' } }])).get(pid)!);
  }
  it('the verdict on an unattested holdout carries the flag and the outcome is unchanged', async () => {
    const e = await evaluated(false);
    expect(e.outcome).toBe('verified_better');
    expect(e.validity).toEqual({ unvalidated: true, status: 'unattested', version: null, failedItems: [] });
  });
  it('the verdict on an attested holdout is not flagged', async () => {
    const e = await evaluated(true);
    expect(e.outcome).toBe('verified_better');
    expect(e.validity).toEqual({ unvalidated: false, status: 'attested', version: 1, failedItems: [] });
  });
});
