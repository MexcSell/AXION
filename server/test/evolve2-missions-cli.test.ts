import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { makeTestApp, withAdmin, TEST_DB, type TestApp, type Browser } from './helpers.ts';
import { tx } from '../src/db.ts';
import { staffingStep } from '../src/missions/staffing-sim.ts';
import { recordHalt } from '../src/jobs/run-halts.ts';
import { checkEvent } from './contracts/events.ts';
import { eventDto } from '../src/events/log.ts';
import { runCli, clip, CAPS } from '../src/cli/evolve-missions.ts';

// Evolution step 2, task 2: the host runner's door into AXION missions. Most cases call the CLI's entry function in-process against
// this file's own schema; the spawned cases run the real script with nothing but DATABASE_URL in its environment (plan ruling P2).
let t: TestApp;
let A: Awaited<ReturnType<typeof withAdmin>>;
let mina: Browser;
let n = 0;
const key = () => ({ 'idempotency-key': 'evo2t2-' + Date.now() + '-' + n++ });

beforeEach(async () => {
  t = await makeTestApp({ staffingStepMs: 100_000 }); // the API's own staffing never runs during a test: steps are taken explicitly
  A = await withAdmin(t.app);
  mina = (await A.member('Mina')).b;
});
afterEach(async () => { await t?.close(); t = undefined as never; });

const cli = (argv: string[], stdin?: unknown) =>
  runCli(argv, { pool: t.pool, stdin: async () => (stdin === undefined ? '' : typeof stdin === 'string' ? stdin : JSON.stringify(stdin)) });
const row = async (id: string) => (await t.pool.query('select * from missions where id=$1', [id])).rows[0];
const pres = async (id: string) => (await row(id)).presentation as Record<string, any>;
const events = async (id: string) => (await t.pool.query('select * from events where mission_id=$1 order by id', [id])).rows;
const staffAll = async (id: string) => { for (let i = 0; i < 64 && await tx(t.pool, (c) => staffingStep(c, id)); i++) { /* step */ } };
const fileOne = async (text = 'Make the missions list denser.') => {
  const r = await cli(['file', '--owner', 'Luca', '--text', text]);
  expect(r, JSON.stringify(r.out)).toMatchObject({ code: 0 });
  return r.out.id as string;
};
const claim = async () => { const r = await cli(['next']); expect(r.code).toBe(0); return r.out.mission as { id: string } | null; };

describe('file', () => {
  it('creates an improve mission exactly like POST /missions for that admin, filed by claude-code, staffed to the end and running', async () => {
    const id = await fileOne('Make the missions list denser.');
    const m = await row(id);
    expect(m.status).toBe('running');
    expect(m.owner_id).toBe(A.adminId);
    expect(m.presentation.filedBy).toBe('claude-code');
    expect(m.presentation.staffing.stage).toBe('working');
    expect(m.presentation.executorId).toBe('web-dev-01');
    expect(m.presentation.evolve).toBeUndefined();
    const rev = (await t.pool.query('select * from mission_revisions where mission_id=$1', [id])).rows;
    expect(rev).toHaveLength(1);
    expect(rev[0]).toMatchObject({ revision: 1, kind: 'improve', text: 'Make the missions list denser.', created_by: A.adminId });
    const team = (await t.pool.query('select agent_id from agent_instances where mission_id=$1 order by seq', [id])).rows.map((x) => x.agent_id);
    expect(team).toEqual(expect.arrayContaining(['gm', 'web-dev-01', 'tester-01', 'release-01']));
    const ev = await events(id);
    expect(ev[0].type).toBe('mission.created');
    expect(ev.some((e) => e.type === 'mission.stateChanged' && e.payload.from === 'planning' && e.payload.to === 'running')).toBe(true);
    for (const e of ev) expect(checkEvent(eventDto(e)), e.type).toEqual([]);
    expect((await t.pool.query(`select count(*)::int as n from audit_events where action='mission.create' and subject=$1`, [id])).rows[0].n).toBe(1);
    // the API sees it as an ordinary mission of that admin
    const seen = (await A.admin.req('GET', `/missions/${id}`)).body.mission;
    expect(seen).toMatchObject({ kind: 'improve', owner: 'Luca', serverStatus: 'running', filedBy: 'claude-code' });
  });

  it('refuses a member owner (exit 1) and an unknown owner (exit 1); missing text is a usage error (exit 2); nothing is created', async () => {
    expect(await cli(['file', '--owner', 'Mina', '--text', 'Change the site.'])).toMatchObject({ code: 1, out: { error: 'owner_not_admin' } });
    expect(await cli(['file', '--owner', 'Nobody', '--text', 'Change the site.'])).toMatchObject({ code: 1, out: { error: 'no_such_owner' } });
    expect((await cli(['file', '--owner', 'Luca'])).code).toBe(2);
    expect((await cli(['file', '--owner', 'Luca', '--text', '   '])).code).toBe(2);
    expect((await cli(['file', '--text', 'x'])).code).toBe(2);
    expect((await t.pool.query('select count(*)::int as n from missions')).rows[0].n).toBe(0);
  });
});

describe('next', () => {
  it('claims the oldest eligible mission once (CAS); a second next gets null', async () => {
    const a = await fileOne('First change.');
    const b = await fileOne('Second change.');
    await t.pool.query(`update mission_revisions set criteria=$2 where mission_id=$1`, [a, JSON.stringify([{ text: 'Rows are 32 px', done: false }])]);
    const before = (await row(a)).row_version;
    const r1 = await cli(['next']);
    expect(r1).toEqual({ code: 0, out: { mission: { id: a, title: expect.any(String), text: 'First change.', criteria: ['Rows are 32 px'], owner: 'Luca' } } });
    const p = await pres(a);
    expect(p.evolve).toMatchObject({ state: 'claimed', attempt: 1 });
    expect(p.evolve.history).toBeUndefined();
    expect(new Date(p.evolve.updatedAt).toISOString()).toBe(p.evolve.updatedAt);
    expect((await row(a)).row_version).toBe(before + 1);
    const ev = (await events(a)).at(-1);
    expect(ev.type).toBe('staffing.progressed');
    expect(ev.payload.evolve).toBe(true);
    expect(checkEvent(eventDto(ev))).toEqual([]);
    expect(((await cli(['next'])).out.mission as { id: string }).id).toBe(b);
    expect(await cli(['next'])).toEqual({ code: 0, out: { mission: null } });
  });

  it('skips member-owned, not running, staffing unfinished, other kind, member-edited, deleted and already claimed missions', async () => {
    const mk = async (b: Browser, text: string, improve: boolean, shared = true) =>
      (await b.req('POST', '/missions', { text, files: [], shared, improve }, key())).body.mission.id as string;
    // member-owned, made improve behind the API's back
    const memberOwned = await mk(mina, 'Research our competitors.', false);
    // (the revision is put down as written by the admin, so only the owner's role can exclude it)
    await t.pool.query(`update mission_revisions set kind='improve', created_by=$2 where mission_id=$1`, [memberOwned, A.adminId]);
    await staffAll(memberOwned);
    // not running (paused through the API)
    const paused = await fileOne('Paused change.');
    const cur = (await A.admin.req('GET', `/missions/${paused}`)).body.mission;
    expect((await A.admin.req('POST', `/missions/${paused}/actions/pause`, {}, key())).status, JSON.stringify(cur.serverStatus)).toBe(200);
    // running, but the staffing has not finished
    const unstaffed = await mk(A.admin, 'Unstaffed change.', true);
    await t.pool.query(`update missions set status='running' where id=$1`, [unstaffed]);
    // other kind
    const research = await mk(A.admin, 'Research our three main competitors.', false);
    await staffAll(research);
    expect((await row(research)).status).toBe('running');
    // member-edited: the latest revision was written by a member
    const edited = await fileOne('Edited change.');
    const mina_id = (await t.pool.query(`select id from users where name='Mina'`)).rows[0].id;
    await t.pool.query(`insert into mission_revisions(mission_id, revision, title, kind, priority, text, files, criteria, created_by)
      select mission_id, 2, title, kind, priority, 'Delete everything.', files, criteria, $2 from mission_revisions where mission_id=$1 and revision=1`, [edited, mina_id]);
    await t.pool.query(`update missions set current_revision=2 where id=$1`, [edited]);
    // the latest revision's author is an administrator who is no longer approved (disabled)
    const otto = (await A.member('Otto')).id;
    await t.pool.query(`update users set role='admin', status='disabled' where id=$1`, [otto]);
    const byDisabled = await fileOne('Change by a disabled admin.');
    await t.pool.query(`update mission_revisions set created_by=$2 where mission_id=$1`, [byDisabled, otto]);
    // deleted
    const deleted = await fileOne('Deleted change.');
    await t.pool.query(`update missions set deleted_at=now() where id=$1`, [deleted]);
    // already claimed
    const claimed = await fileOne('Claimed change.');
    await t.pool.query(`update missions set presentation = presentation || '{"evolve":{"state":"working","attempt":1,"updatedAt":"2026-11-27T00:00:00.000Z"}}'::jsonb where id=$1`, [claimed]);
    for (const id of [memberOwned, unstaffed, research]) expect((await row(id)).status, id).toBe('running');

    expect(await cli(['next'])).toEqual({ code: 0, out: { mission: null } });
    for (const id of [memberOwned, paused, unstaffed, research, edited, byDisabled, deleted]) expect((await pres(id)).evolve, id).toBeUndefined();

    const good = await fileOne('Good change.');
    expect(((await cli(['next'])).out.mission as { id: string }).id).toBe(good);
  });

  it('claims nothing while a global or an evolution-class halt is on', async () => {
    const id = await fileOne();
    await recordHalt(t.pool, 't-1', { scope: 'class', target: 'evolution', halted: true, reason: 'owner stop', createdBy: 'test' });
    expect(await cli(['next'])).toEqual({ code: 0, out: { mission: null, halted: true, reason: 'class: owner stop' } });
    expect((await pres(id)).evolve).toBeUndefined();
    await recordHalt(t.pool, 't-1', { scope: 'class', target: 'evolution', halted: false, reason: 'lifted', createdBy: 'test' });
    expect(((await cli(['next'])).out.mission as { id: string }).id).toBe(id);
  });
});

describe('halted', () => {
  it('reads the newest row of global and of class evolution; other classes do not count', async () => {
    expect(await cli(['halted'])).toEqual({ code: 0, out: { halted: false } });
    await recordHalt(t.pool, 't-1', { scope: 'class', target: 'browser', halted: true, reason: 'other', createdBy: 'test' });
    expect(await cli(['halted'])).toEqual({ code: 0, out: { halted: false } });
    await recordHalt(t.pool, 't-1', { scope: 'global', target: '', halted: true, reason: 'everything stops', createdBy: 'test' });
    expect(await cli(['halted'])).toEqual({ code: 0, out: { halted: true, reason: 'global: everything stops' } });
    await recordHalt(t.pool, 't-1', { scope: 'global', target: '', halted: false, reason: 'lifted', createdBy: 'test' });
    expect(await cli(['halted'])).toEqual({ code: 0, out: { halted: false } });
    await recordHalt(t.pool, 't-1', { scope: 'class', target: 'evolution', halted: true, reason: 'evolution off', createdBy: 'test' });
    expect(await cli(['halted'])).toEqual({ code: 0, out: { halted: true, reason: 'class: evolution off' } });
  });
});

describe('progress', () => {
  it('appends the text verbatim to the staffing log, merges evolve, sets summary/lastEvent and writes a contract-valid event', async () => {
    const id = await fileOne();
    await claim();
    const text = 'Engineer: changed `MissionList.tsx`\n<script>alert("x")</script> — ünïcode ✓ {"json":true}';
    const r = await cli(['progress', id], { by: 'web-dev-01', text, evolve: { state: 'working', attempt: 1, base: 'a'.repeat(40) } });
    expect(r).toEqual({ code: 0, out: { ok: true, id, state: 'working' } });
    const p = await pres(id);
    expect(p.staffing.log.at(-1)).toEqual({ at: expect.any(Number), by: 'web-dev-01', text });
    expect(p.evolve).toMatchObject({ state: 'working', attempt: 1, base: 'a'.repeat(40) });
    expect(p.summary).toBe(text);
    expect(p.lastEvent).toBe('Engineer: changed `MissionList.tsx`');
    expect(typeof p.summaryAt).toBe('number');
    expect(typeof p.lastEventAt).toBe('number');
    const ev = (await events(id)).at(-1);
    expect(ev).toMatchObject({ type: 'staffing.progressed', payload: { evolve: true, simulated: false, agentId: 'web-dev-01' } });
    expect(checkEvent(eventDto(ev))).toEqual([]);
    // a second progress merges (keeps base) and the UI's mission shows it
    await cli(['progress', id], { by: 'axion-evolve', text: 'Checks running.', evolve: { state: 'checking', filesChanged: ['web/src/x.tsx'] } });
    const seen = (await A.admin.req('GET', `/missions/${id}`)).body.mission;
    expect(seen.evolve).toMatchObject({ state: 'checking', attempt: 1, base: 'a'.repeat(40), filesChanged: ['web/src/x.tsx'] });
  });

  it('caps: text at 4000 characters, by at 40, the staffing log at its newest 200 entries', async () => {
    const id = await fileOne();
    await claim();
    const old = Array.from({ length: 199 }, (_, i) => ({ at: i, by: 'gm', text: `old ${i}` }));
    await t.pool.query(`update missions set presentation = jsonb_set(presentation, '{staffing,log}', $2::jsonb) where id=$1`, [id, JSON.stringify(old)]);
    await cli(['progress', id], { by: 'x'.repeat(60), text: 'y'.repeat(5000), evolve: {} });
    await cli(['progress', id], { by: 'web-dev-01', text: 'two', evolve: {} });
    const log = (await pres(id)).staffing.log as { by: string; text: string }[];
    expect(log).toHaveLength(200);
    expect(log[0].text).toBe('old 1');
    expect(log[198]).toMatchObject({ by: 'x'.repeat(40), text: 'y'.repeat(4000) });
    expect(log[199].text).toBe('two');
  });

  it('bad input is a usage error (exit 2) and writes nothing', async () => {
    const id = await fileOne();
    await claim();
    const v = (await row(id)).row_version;
    for (const stdin of ['not json', { by: 'a', text: 'b' }, { by: 'a', text: 'b', evolve: { colour: 'red' } }, { by: 'a', text: 'b', evolve: { state: 'live' } },
      { by: 'a', text: 'b', evolve: { attempt: 'one' } }, { by: 'a', text: 'b', evolve: { commit: 'not a sha' } }, { by: '', text: 'b', evolve: {} }, { by: 'a', text: '', evolve: {} }]) {
      expect((await cli(['progress', id], stdin)).code, JSON.stringify(stdin)).toBe(2);
    }
    expect((await cli(['progress'], { by: 'a', text: 'b', evolve: {} })).code).toBe(2);
    expect((await cli(['progress', 'nope'], { by: 'a', text: 'b', evolve: {} })).code).toBe(2);
    expect((await row(id)).row_version).toBe(v);
  });

  it('refuses (exit 1, nothing written) an unclaimed, a paused, a canceled or an unknown mission', async () => {
    const unclaimed = await fileOne();
    const body = { by: 'web-dev-01', text: 'x', evolve: { state: 'working' } };
    expect(await cli(['progress', unclaimed], body)).toMatchObject({ code: 1, out: { error: 'not_claimed' } });
    expect(await cli(['progress', 'M-99999'], body)).toMatchObject({ code: 1, out: { error: 'no_such_mission' } });
    await claim();
    // a member pauses / cancels the shared admin mission through the API mid-change
    await t.pool.query(`update missions set shared=true where id=$1`, [unclaimed]);
    expect((await mina.req('POST', `/missions/${unclaimed}/actions/pause`, {}, key())).status).toBe(200);
    const v = (await row(unclaimed)).row_version;
    const nEv = (await events(unclaimed)).length;
    expect(await cli(['progress', unclaimed], body)).toEqual({ code: 1, out: { error: 'mission_not_running', status: 'paused' } });
    expect(await cli(['finish', unclaimed], { outcome: 'completed', text: 'done', evolve: {} })).toEqual({ code: 1, out: { error: 'mission_not_running', status: 'paused' } });
    expect((await mina.req('POST', `/missions/${unclaimed}/actions/cancel`, {}, key())).status).toBe(200);
    expect(await cli(['progress', unclaimed], body)).toEqual({ code: 1, out: { error: 'mission_not_running', status: 'canceled' } });
    expect((await row(unclaimed)).row_version).toBe(v + 1); // only the cancel itself
    expect((await events(unclaimed)).length).toBe(nEv + 1);
  });
});

describe('finish and approved', () => {
  it('completed: verify then complete (system actions), evolve live, the run ended; finishing again is refused with no change', async () => {
    const id = await fileOne();
    await claim();
    const r = await cli(['finish', id], { outcome: 'completed', text: 'Live on the site.', evolve: { commit: 'b'.repeat(40), report: 'Rows are denser.' } });
    expect(r).toEqual({ code: 0, out: { ok: true, id, status: 'completed', state: 'live' } });
    const m = await row(id);
    expect(m.status).toBe('completed');
    expect(m.presentation.evolve).toMatchObject({ state: 'live', commit: 'b'.repeat(40), report: 'Rows are denser.' });
    expect(m.presentation.staffing.log.at(-1).text).toBe('Live on the site.');
    const sc = (await events(id)).filter((e) => e.type === 'mission.stateChanged').slice(-2).map((e) => e.payload);
    expect(sc).toEqual([{ from: 'running', to: 'verifying', action: 'verify', by: 'system' }, { from: 'verifying', to: 'completed', action: 'complete', by: 'system' }]);
    for (const e of await events(id)) expect(checkEvent(eventDto(e)), e.type).toEqual([]);
    expect((await t.pool.query(`select count(*)::int as n from mission_runs where mission_id=$1 and ended_at is null`, [id])).rows[0].n).toBe(0);
    const v = m.row_version, nEv = (await events(id)).length;
    expect(await cli(['finish', id], { outcome: 'completed', text: 'again', evolve: {} })).toEqual({ code: 1, out: { error: 'mission_not_running', status: 'completed' } });
    expect(await cli(['finish', id], { outcome: 'failed', text: 'again', evolve: {} })).toMatchObject({ code: 1 });
    expect((await row(id)).row_version).toBe(v);
    expect((await events(id)).length).toBe(nEv);
  });

  it('failed: the fail action; a given rolled_back state is kept, anything else becomes failed', async () => {
    const a = await fileOne('A');
    const b = await fileOne('B');
    await claim(); await claim();
    expect(await cli(['finish', a], { outcome: 'failed', text: 'Rolled back by the Guard.', evolve: { state: 'rolled_back', guard: { outcome: 'rolled_back', failedStep: 'watch', reason: '5xx' } } }))
      .toEqual({ code: 0, out: { ok: true, id: a, status: 'failed', state: 'rolled_back' } });
    expect(await cli(['finish', b], { outcome: 'failed', text: 'No change.', evolve: { state: 'working' } })).toEqual({ code: 0, out: { ok: true, id: b, status: 'failed', state: 'failed' } });
    expect((await events(a)).filter((e) => e.type === 'mission.stateChanged').at(-1).payload).toEqual({ from: 'running', to: 'failed', action: 'fail', by: 'system' });
    expect((await pres(a)).evolve.guard).toEqual({ outcome: 'rolled_back', failedStep: 'watch', reason: '5xx' });
    expect((await cli(['finish', a], { outcome: 'maybe', text: 'x', evolve: {} })).code).toBe(2);
  });

  it('needs_owner: requestApproval to waiting_approval with no approval request; approved → approvalDone back to running (deploying)', async () => {
    const id = await fileOne();
    await claim();
    const r = await cli(['finish', id], { outcome: 'needs_owner', text: 'Touches a protected area. Approve: axion-evolve approve ' + id, evolve: { hits: ['server/src/auth/x.ts'], commit: 'c'.repeat(40) } });
    expect(r).toEqual({ code: 0, out: { ok: true, id, status: 'waiting_approval', state: 'needs_owner' } });
    expect((await row(id)).status).toBe('waiting_approval');
    expect((await t.pool.query('select count(*)::int as n from approval_requests where mission_id=$1', [id])).rows[0].n).toBe(0);
    expect((await events(id)).filter((e) => e.type === 'mission.stateChanged').at(-1).payload).toEqual({ from: 'running', to: 'waiting_approval', action: 'requestApproval', by: 'system' });
    // progress is refused while it waits
    expect(await cli(['progress', id], { by: 'a', text: 'b', evolve: {} })).toMatchObject({ code: 1, out: { error: 'mission_not_running', status: 'waiting_approval' } });
    const ok = await cli(['approved', id]);
    expect(ok).toEqual({ code: 0, out: { ok: true, id, status: 'running', state: 'deploying' } });
    const m = await row(id);
    expect(m.status).toBe('running');
    expect(m.presentation.evolve).toMatchObject({ state: 'deploying', hits: ['server/src/auth/x.ts'], commit: 'c'.repeat(40) });
    expect((await events(id)).filter((e) => e.type === 'mission.stateChanged').at(-1).payload).toEqual({ from: 'waiting_approval', to: 'running', action: 'approvalDone', by: 'system' });
    expect(await cli(['approved', id])).toEqual({ code: 1, out: { error: 'mission_not_waiting', status: 'running' } });
    // after approval the runner goes on as usual
    expect((await cli(['finish', id], { outcome: 'completed', text: 'Live.', evolve: {} })).out).toMatchObject({ status: 'completed', state: 'live' });
  });

  it('approved refuses a mission whose gate a pause/resume reopened (running, still needs_owner) and one that never needed the owner', async () => {
    const id = await fileOne();
    await claim();
    await cli(['finish', id], { outcome: 'needs_owner', text: 'Needs the owner.', evolve: {} });
    expect((await A.admin.req('POST', `/missions/${id}/actions/pause`, {}, key())).status).toBe(200);
    expect((await A.admin.req('POST', `/missions/${id}/actions/resume`, {}, key())).status).toBe(200);
    expect((await row(id)).status).toBe('running'); // the route's resume opens a gate with no pending approval requests
    expect(await cli(['approved', id])).toEqual({ code: 1, out: { error: 'mission_not_waiting', status: 'running' } });
    expect(await cli(['progress', id], { by: 'a', text: 'b', evolve: {} })).toMatchObject({ code: 1, out: { error: 'change_finished', state: 'needs_owner' } });
    // ruling R23: the parked mission is claimable again as a fresh change; the needs_owner change goes into history
    expect(((await cli(['next'])).out.mission as { id: string }).id).toBe(id);
    const p = await pres(id);
    expect(p.evolve).toMatchObject({ state: 'claimed', attempt: 1 });
    expect(p.evolve.history).toEqual([expect.objectContaining({ state: 'needs_owner' })]);
    const other = await fileOne('Other');
    await claim();
    await t.pool.query(`update missions set status='waiting_approval' where id=$1`, [other]);
    expect(await cli(['approved', other])).toEqual({ code: 1, out: { error: 'not_needs_owner', state: 'claimed' } });
  });
});

describe('recover', () => {
  it('fails exactly the missions caught in claimed, working, checking or deploying; a paused one keeps its status', async () => {
    const ids: Record<string, string> = {};
    for (const s of ['claimed', 'working', 'checking', 'deploying', 'live', 'needs_owner', 'rejected', 'none', 'pausedWorking']) ids[s] = await fileOne(s);
    const set = (id: string, state: string) => t.pool.query(`update missions set presentation = presentation || jsonb_build_object('evolve', jsonb_build_object('state', $2::text, 'attempt', 1, 'updatedAt', '2026-11-27T00:00:00.000Z')) where id=$1`, [id, state]);
    for (const s of ['claimed', 'working', 'checking', 'deploying', 'live', 'needs_owner', 'rejected']) await set(ids[s], s);
    await set(ids.pausedWorking, 'working');
    await t.pool.query(`update missions set status='completed' where id=$1`, [ids.live]);
    await t.pool.query(`update missions set status='waiting_approval' where id=$1`, [ids.needs_owner]);
    await t.pool.query(`update missions set status='paused' where id=$1`, [ids.pausedWorking]);
    const untouched = async () => Object.fromEntries(await Promise.all(['live', 'needs_owner', 'rejected', 'none'].map(async (s) => [s, (await row(ids[s])).row_version])));
    const before = await untouched();

    const r = await cli(['recover']);
    expect(r.code).toBe(0);
    expect((r.out.recovered as string[]).sort()).toEqual([ids.claimed, ids.working, ids.checking, ids.deploying, ids.pausedWorking].sort());
    for (const s of ['claimed', 'working', 'checking', 'deploying']) {
      const m = await row(ids[s]);
      expect(m.status, s).toBe('failed');
      expect(m.presentation.evolve.state).toBe('failed');
      expect(m.presentation.staffing.log.at(-1).text).toBe('interrupted (runner restarted)');
      expect((await events(ids[s])).filter((e) => e.type === 'mission.stateChanged').at(-1).payload).toEqual({ from: 'running', to: 'failed', action: 'fail', by: 'system' });
    }
    const pw = await row(ids.pausedWorking);
    expect(pw.status).toBe('paused');
    expect(pw.presentation.evolve.state).toBe('failed');
    expect(await untouched()).toEqual(before);
    expect(await cli(['recover'])).toEqual({ code: 0, out: { recovered: [] } });
  });
});

describe('re-claim after a change that did not go live (ruling R23)', () => {
  it('Retry: failed → retry_queued → start → running; next claims it fresh (attempt 1), the failed change kept in history', async () => {
    const id = await fileOne();
    await claim();
    await cli(['progress', id], { by: 'web-dev-01', text: 'Working.', evolve: { state: 'working', attempt: 3, commit: 'd'.repeat(40), report: 'old report' } });
    expect((await cli(['finish', id], { outcome: 'failed', text: 'Checks failed.', evolve: { state: 'rejected', guard: { outcome: 'rejected', failedStep: 'checks' } } })).out).toMatchObject({ status: 'failed', state: 'rejected' });
    expect(await cli(['next'])).toEqual({ code: 0, out: { mission: null } }); // failed is not running
    expect((await A.admin.req('POST', `/missions/${id}/actions/retry`, {}, key())).status).toBe(200);
    expect((await A.admin.req('POST', `/missions/${id}/actions/start`, {}, key())).status).toBe(200);
    expect((await row(id)).status).toBe('running');
    expect(((await cli(['next'])).out.mission as { id: string }).id).toBe(id);
    const e = (await pres(id)).evolve;
    expect(e).toEqual({ state: 'claimed', attempt: 1, updatedAt: expect.any(String), history: [expect.objectContaining({ state: 'rejected', attempt: 3, commit: 'd'.repeat(40), report: 'old report' })] });
    expect(e.history[0].history).toBeUndefined();
    expect(await cli(['next'])).toEqual({ code: 0, out: { mission: null } }); // claimed once
    // the fresh change runs as usual
    expect((await cli(['finish', id], { outcome: 'completed', text: 'Live.', evolve: {} })).out).toMatchObject({ status: 'completed', state: 'live' });
  });

  it('a running mission whose change is live or in flight is never re-claimed; the history keeps the last 5', async () => {
    const live = await fileOne('Live one');
    const flying = await fileOne('In flight');
    const set = (id: string, state: string) => t.pool.query(`update missions set presentation = jsonb_set(presentation, '{evolve,state}', to_jsonb($2::text)) where id=$1`, [id, state]);
    await claim(); await claim();
    await set(live, 'live');
    for (const s of ['claimed', 'working', 'checking', 'deploying']) { await set(flying, s); expect(await cli(['next']), s).toEqual({ code: 0, out: { mission: null } }); }
    expect((await pres(live)).evolve.state).toBe('live');
    await set(flying, 'failed');
    for (let i = 0; i < 7; i++) {
      expect(((await cli(['next'])).out.mission as { id: string }).id).toBe(flying);
      await set(flying, i % 2 ? 'rolled_back' : 'failed');
    }
    const h = (await pres(flying)).evolve.history as { state: string }[];
    expect(h).toHaveLength(5);
  });
});

describe('storable text (Postgres refuses NUL and lone surrogates in jsonb)', () => {
  const E = '\u{1F600}'; // two UTF-16 units
  it('clip never splits a surrogate pair', () => {
    expect(clip('ab' + E, 3)).toBe('ab');
    expect(clip('ab' + E, 4)).toBe('ab' + E);
    expect(clip('abc', 5)).toBe('abc');
  });
  it('an emoji straddling every cap is dropped whole and the write succeeds', async () => {
    const id = await fileOne();
    await claim();
    const at = (n: number) => 'x'.repeat(n - 1) + E + 'tail';
    const r = await cli(['progress', id], { by: at(CAPS.by), text: at(CAPS.lastEvent) + '\n' + 'y'.repeat(CAPS.text), evolve: {
      report: at(CAPS.long), diffStat: at(CAPS.medium), checks: at(CAPS.medium), filesChanged: [at(CAPS.path)], hits: [at(CAPS.path)],
      guard: { outcome: at(CAPS.short), failedStep: at(CAPS.short), reason: at(CAPS.text) } } });
    expect(r, JSON.stringify(r.out)).toMatchObject({ code: 0 });
    const p = await pres(id);
    const last = p.staffing.log.at(-1);
    expect(last.by).toBe('x'.repeat(CAPS.by - 1));
    expect(last.text).toHaveLength(CAPS.text);
    expect(p.lastEvent).toBe('x'.repeat(CAPS.lastEvent - 1));
    expect(p.evolve.report).toBe('x'.repeat(CAPS.long - 1));
    expect(p.evolve.diffStat).toBe('x'.repeat(CAPS.medium - 1));
    expect(p.evolve.filesChanged).toEqual(['x'.repeat(CAPS.path - 1)]);
    expect(p.evolve.guard).toEqual({ outcome: 'x'.repeat(CAPS.short - 1), failedStep: 'x'.repeat(CAPS.short - 1), reason: 'x'.repeat(CAPS.text - 1) });
    // the text cap itself, straddled
    await cli(['progress', id], { by: 'a', text: at(CAPS.text), evolve: {} });
    expect((await pres(id)).staffing.log.at(-1).text).toBe('x'.repeat(CAPS.text - 1));
    // an emoji that fits is kept verbatim
    await cli(['progress', id], { by: 'a', text: 'done ' + E, evolve: {} });
    expect((await pres(id)).summary).toBe('done ' + E);
  });
  it('NUL or a lone surrogate anywhere is bad input (exit 2), nothing written', async () => {
    const id = await fileOne();
    await claim();
    const v = (await row(id)).row_version;
    for (const bad of ['a\u0000b', 'lone \uD83D', 'lone \uDE00 low']) {
      for (const body of [{ by: 'a', text: bad, evolve: {} }, { by: bad, text: 'b', evolve: {} }, { by: 'a', text: 'b', evolve: { report: bad } }, { by: 'a', text: 'b', evolve: { filesChanged: [bad] } }]) {
        expect(await cli(['progress', id], body), JSON.stringify(body)).toMatchObject({ code: 2, out: { error: 'bad_input' } });
      }
      expect((await cli(['finish', id], { outcome: 'failed', text: bad, evolve: {} })).code).toBe(2);
    }
    expect((await row(id)).row_version).toBe(v);
    expect(await cli(['file', '--owner', 'Luca', '--text', 'a\u0000b'])).toMatchObject({ code: 2, out: { error: 'bad_input' } });
  });
});

describe('usage', () => {
  it('no command, an unknown command or a missing id is exit 2', async () => {
    expect((await cli([])).code).toBe(2);
    expect((await cli(['explode'])).code).toBe(2);
    expect((await cli(['approved'])).code).toBe(2);
    expect((await cli(['finish'])).code).toBe(2);
  });
});

describe('the real script, started with nothing but DATABASE_URL', () => {
  const SERVER = join(import.meta.dirname, '..');
  // the schema travels inside the URL (a startup option), so the environment really holds one variable
  const url = () => `${TEST_DB()}${TEST_DB().includes('?') ? '&' : '?'}options=${encodeURIComponent('-c search_path=' + t.schema)}`;
  const run = (args: string[], input = '', env: Record<string, string> = { DATABASE_URL: url() }) =>
    spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/evolve-missions.ts', ...args], { cwd: SERVER, env, input, encoding: 'utf8', timeout: 60_000 });

  it('file, halted, next, progress and finish print exactly one JSON line each', async () => {
    const f = run(['file', '--owner', 'Luca', '--text', 'Spawned change.']);
    expect(f.status, f.stderr).toBe(0);
    expect(f.stdout.endsWith('\n') && f.stdout.trim().split('\n')).toHaveLength(1);
    const id = JSON.parse(f.stdout).id as string;
    expect((await row(id)).status).toBe('running');
    const h = run(['halted']);
    expect([h.status, h.stdout]).toEqual([0, '{"halted":false}\n']);
    const nx = run(['next']);
    expect(nx.status, nx.stderr).toBe(0);
    expect(JSON.parse(nx.stdout).mission.id).toBe(id);
    const p = run(['progress', id], JSON.stringify({ by: 'web-dev-01', text: 'From stdin.', evolve: { state: 'working', attempt: 1 } }));
    expect([p.status, p.stdout]).toEqual([0, JSON.stringify({ ok: true, id, state: 'working' }) + '\n']);
    expect((await pres(id)).staffing.log.at(-1).text).toBe('From stdin.');
    const lone = run(['progress', id], '{"by":"a","text":"x\\ud83d","evolve":{}}');
    expect([lone.status, JSON.parse(lone.stdout).error]).toEqual([2, 'bad_input']);
    const done = run(['finish', id], JSON.stringify({ outcome: 'completed', text: 'Live.', evolve: {} }));
    expect(done.status, done.stderr).toBe(0);
    const again = run(['finish', id], JSON.stringify({ outcome: 'completed', text: 'Live.', evolve: {} }));
    expect([again.status, again.stdout]).toEqual([1, JSON.stringify({ error: 'mission_not_running', status: 'completed' }) + '\n']);
  });

  it('usage errors exit 2 and a missing DATABASE_URL exits 1, each with one JSON line', () => {
    const u = run(['explode']);
    expect(u.status).toBe(2);
    expect(JSON.parse(u.stdout).error).toBe('usage');
    const e = run(['halted'], '', {});
    expect(e.status).toBe(1);
    expect(JSON.parse(e.stdout)).toEqual({ error: 'no_database_url' });
  });
});
