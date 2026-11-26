import { describe, it, expect, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';

// Evolution step 2, task 1: the mission kind `improve` (an engineer agent changes AXION itself). Only administrators may use it.
let t: TestApp;
afterEach(async () => { await t?.close(); t = undefined as never; });
let n = 0;
const key = () => ({ 'idempotency-key': 'evo2-' + Date.now() + '-' + n++ });
const kindOf = async (id: string) => (await t.pool.query(`select r.kind from missions m join mission_revisions r on r.mission_id=m.id and r.revision=m.current_revision where m.id=$1`, [id])).rows[0].kind as string;

async function setup() {
  t = await makeTestApp({ staffingStepMs: 100_000 });
  const A = await withAdmin(t.app);
  const mina = (await A.member('Mina')).b;
  return { A, mina };
}

describe('mission kind improve', () => {
  it('an admin creating with improve:true gets kind improve, executed by web-dev-01 with the tester and release agents planned', async () => {
    const { A } = await setup();
    const r = await A.admin.req('POST', '/missions', { text: 'Make the missions list denser.', files: [], shared: false, improve: true }, key());
    expect(r.status).toBe(201);
    expect(r.body.mission.kind).toBe('improve');
    expect(await kindOf(r.body.mission.id)).toBe('improve');
    expect(r.body.mission.executorId).toBe('web-dev-01');
    expect(r.body.mission.staffing.plan.map((p: { agentId: string }) => p.agentId)).toEqual(['tester-01', 'release-01']);
  });

  it('a member creating with improve:true is refused with 403 and nothing is created', async () => {
    const { mina } = await setup();
    const r = await mina.req('POST', '/missions', { text: 'Change the website.', files: [], shared: false, improve: true }, key());
    expect(r.status).toBe(403);
    expect((await t.pool.query('select count(*)::int as n from missions')).rows[0].n).toBe(0);
  });

  it('without improve the kind still comes from the text (even for an admin), and improve:false changes nothing', async () => {
    const { A, mina } = await setup();
    const a = await A.admin.req('POST', '/missions', { text: 'Research our three main competitors.', files: [], shared: false }, key());
    expect(a.body.mission.kind).toBe('research');
    const b = await mina.req('POST', '/missions', { text: 'Research our three main competitors.', files: [], shared: false, improve: false }, key());
    expect(b.status).toBe(201);
    expect(b.body.mission.kind).toBe('research');
  });

  it('PATCH kind -> improve: 403 for a member, ok for an admin; PATCH kind away from improve is admin-only too', async () => {
    const { A, mina } = await setup();
    const own = (await mina.req('POST', '/missions', { text: 'Research our three main competitors.', files: [], shared: false }, key())).body.mission;
    const denied = await mina.req('PATCH', `/missions/${own.id}`, { kind: 'improve' }, { 'if-match': String(own.rowVersion) });
    expect(denied.status).toBe(403);
    expect(await kindOf(own.id)).toBe('research');

    const adm = (await A.admin.req('POST', '/missions', { text: 'Research our three main competitors.', files: [], shared: true }, key())).body.mission;
    const ok = await A.admin.req('PATCH', `/missions/${adm.id}`, { kind: 'improve' }, { 'if-match': String(adm.rowVersion) });
    expect(ok.status).toBe(200);
    expect(ok.body.mission.kind).toBe('improve');

    const cur = (await A.admin.req('GET', `/missions/${adm.id}`)).body.mission;
    const away = await mina.req('PATCH', `/missions/${adm.id}`, { kind: 'research' }, { 'if-match': String(cur.rowVersion) });
    expect(away.status).toBe(403);
    expect(await kindOf(adm.id)).toBe('improve');
  });

  const revOf = async (id: string) => (await t.pool.query('select current_revision::int as r from missions where id=$1', [id])).rows[0].r as number;

  it('on a shared admin improve mission a member can change nothing (text, addFiles, criteria, title, priority, same kind): 403, no new revision', async () => {
    const { A, mina } = await setup();
    const adm = (await A.admin.req('POST', '/missions', { text: 'Make the list denser.', files: [], shared: true, improve: true }, key())).body.mission;
    const before = await revOf(adm.id);
    const bodies = [{ text: 'Delete everything.' }, { addFiles: ['nope'] }, { criteria: [{ text: 'x', done: true }] }, { title: 'Mine' }, { priority: 'critical' }, { kind: 'improve', title: 'Same kind' }];
    for (const body of bodies) {
      const r = await mina.req('PATCH', `/missions/${adm.id}`, body, { 'if-match': String(adm.rowVersion) });
      expect(r.status, JSON.stringify(body)).toBe(403);
    }
    expect(await revOf(adm.id)).toBe(before);
    const mission = (await A.admin.req('GET', `/missions/${adm.id}`)).body.mission;
    expect(mission.content.text).toBe('Make the list denser.');
    // the admin may
    const ok = await A.admin.req('PATCH', `/missions/${adm.id}`, { text: 'Make the list denser and calmer.' }, { 'if-match': String(mission.rowVersion) });
    expect(ok.status).toBe(200);
    expect(ok.body.mission.content.text).toBe('Make the list denser and calmer.');
    expect(await revOf(adm.id)).toBe(before + 1);
  });

  it('an admin cannot flip a mission owned by a member to improve (409, nothing written); members still edit non-improve shared missions', async () => {
    const { A, mina } = await setup();
    const own = (await mina.req('POST', '/missions', { text: 'Research our three main competitors.', files: [], shared: true }, key())).body.mission;
    const before = await revOf(own.id);
    const r = await A.admin.req('PATCH', `/missions/${own.id}`, { kind: 'improve' }, { 'if-match': String(own.rowVersion) });
    expect(r.status).toBe(409);
    expect(r.body.error?.message ?? JSON.stringify(r.body)).toMatch(/owned by an administrator/);
    expect(await kindOf(own.id)).toBe('research');
    expect(await revOf(own.id)).toBe(before);
    const edit = await mina.req('PATCH', `/missions/${own.id}`, { title: 'Competitors' }, { 'if-match': String(own.rowVersion) });
    expect(edit.status).toBe(200);
    // a member can also edit an admin's shared non-improve mission, as before
    const adm = (await A.admin.req('POST', '/missions', { text: 'Research our three main competitors.', files: [], shared: true }, key())).body.mission;
    expect((await mina.req('PATCH', `/missions/${adm.id}`, { title: 'Shared edit' }, { 'if-match': String(adm.rowVersion) })).status).toBe(200);
  });
});
