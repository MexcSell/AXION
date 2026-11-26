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

    // a member cannot move an admin's shared improve mission away from improve (it is the admin's pick), but can edit other fields
    const cur = (await A.admin.req('GET', `/missions/${adm.id}`)).body.mission;
    const away = await mina.req('PATCH', `/missions/${adm.id}`, { kind: 'research' }, { 'if-match': String(cur.rowVersion) });
    expect(away.status).toBe(403);
    const title = await mina.req('PATCH', `/missions/${adm.id}`, { title: 'Denser list' }, { 'if-match': String(cur.rowVersion) });
    expect(title.status).toBe(200);
    expect(title.body.mission.kind).toBe('improve');
  });

  it('PATCH with a kind the mission already has (improve to improve, by a member editing the title in the same call) is not refused', async () => {
    const { A, mina } = await setup();
    const adm = (await A.admin.req('POST', '/missions', { text: 'x y z', files: [], shared: true, improve: true }, key())).body.mission;
    const r = await mina.req('PATCH', `/missions/${adm.id}`, { kind: 'improve', title: 'Same kind' }, { 'if-match': String(adm.rowVersion) });
    expect(r.status).toBe(200);
  });
});
