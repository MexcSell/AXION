import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeWorld, approval, staleReview, waitingTask, failure, orgProposal, versionProposal, humanLesson, systemLesson, key, type World } from './c68-fixtures.ts';
import { Browser } from './helpers.ts';

// c68 item 6: a person sees in the queue only what the source routes already show them, for every row kind; no per-person ranking.
let w: World;
const P: Record<string, string> = {}; // ids on the administrator's private mission, on Ben's, and on the shared one
const S: Record<string, string> = {};
const B: Record<string, string> = {};
const members = (rows: any[]) => rows.flatMap((r) => r.members.map((m: any) => m.id as string));
const attention = async (who: Browser) => (await who.req('GET', '/attention')).body as { rows: any[]; totals: { items: number } };
const idsOf = (b: { rows: any[] }, kind: string) => new Set(b.rows.filter((r) => r.kind === kind).flatMap((r) => r.members.map((m: any) => m.id.split(':')[1] as string)));

beforeAll(async () => {
  w = await makeWorld();
  for (const [bag, mission] of [[P, w.mPrivate], [S, w.mShared], [B, w.mBen]] as const) {
    bag.approval = (await approval(w, mission, 'submit_form')).id;
    bag.approvalR3 = (await approval(w, mission, 'release')).id;
    bag.review = await staleReview(w, mission);
    bag.waiting = await waitingTask(w, mission, 30);
    bag.failure = await failure(w, mission, 'FM-3.2');
  }
  P.org = await orgProposal(w, 10); P.version = await versionProposal(w, 10);
  P.lessonAdmin = await humanLesson(w.admin, 'An administrator lesson about locators');
  S.lessonMia = await humanLesson(w.mia, 'A lesson about retries');
  P.system = await systemLesson(w);
}, 90_000);
afterAll(async () => { await w.t.close(); });

describe('c68 item 6: members see only what the source routes show them', () => {
  it('approvals: the same set as GET /approvals (pending), per person', async () => {
    for (const who of [w.admin, w.mia, w.ben]) {
      const src = new Set(((await who.req('GET', '/approvals')).body.approvals as any[]).filter((a) => a.status === 'pending').map((a) => a.id as string));
      expect(idsOf(await attention(who), 'approval')).toEqual(src);
    }
    const mia = idsOf(await attention(w.mia), 'approval');
    expect(mia.has(P.approval)).toBe(false); expect(mia.has(B.approval)).toBe(false); expect(mia.has(S.approval)).toBe(true);
    expect(idsOf(await attention(w.ben), 'approval').has(B.approval)).toBe(true);
  });
  it('stale reviews and waiting tasks: only tasks of missions the person can open (the tasks routes 404 the rest)', async () => {
    const kinds = [['task_review', 'review'], ['task_waiting', 'waiting']] as const;
    for (const [kind, k] of kinds) for (const who of [w.mia, w.ben, w.admin]) {
      const got = idsOf(await attention(who), kind);
      for (const bag of [P, S, B]) {
        const visible = (await who.req('GET', `/tasks/${bag[k]}/reviews`)).status === 200;
        expect(got.has(bag[k]), `${kind} ${bag[k]}`).toBe(visible);
      }
    }
  });
  it('failures: only subjects of missions the person can open (GET /failure-tags 404s the rest)', async () => {
    for (const who of [w.mia, w.ben, w.admin]) {
      const got = idsOf(await attention(who), 'failure').size;
      let want = 0;
      for (const bag of [P, S, B]) if ((await who.req('GET', `/failure-tags?subjectKind=task&subjectId=${bag.failure}`)).status === 200) want++;
      expect(got).toBe(want);
    }
  });
  it('proposals: the tenant-wide lists, like their routes', async () => {
    for (const who of [w.admin, w.mia]) {
      const org = ((await who.req('GET', '/organization/proposals')).body.proposals as any[]).map((p) => p.id);
      const ver = ((await who.req('GET', '/version-proposals')).body.proposals as any[]).map((p) => p.id);
      const got = await attention(who);
      expect(idsOf(got, 'proposal').has(P.org)).toBe(org.includes(P.org));
      expect(idsOf(got, 'proposal').has(P.version)).toBe(ver.includes(P.version));
    }
  });
  it('lessons: an administrator sees every candidate; a member only the ones they proposed; nobody but an administrator sees a system-derived one', async () => {
    const adm = idsOf(await attention(w.admin), 'lesson'), mia = idsOf(await attention(w.mia), 'lesson'), ben = idsOf(await attention(w.ben), 'lesson');
    for (const id of [P.lessonAdmin, S.lessonMia, P.system]) expect(adm.has(id)).toBe(true);
    expect(mia.has(S.lessonMia)).toBe(true); expect(mia.has(P.lessonAdmin)).toBe(false); expect(mia.has(P.system)).toBe(false);
    expect(ben.size).toBe(0);
    const src = new Set(((await w.mia.req('GET', '/lessons?status=proposed')).body.lessons as any[]).map((l) => l.id as string));
    expect(mia).toEqual(src);
  });
  it('a hidden row is not counted either: the totals and a collapsed row count only what the person can see', async () => {
    // three more failures of the same mode on the private mission: one folded row for the administrator, a smaller one for Mia
    for (let i = 0; i < 3; i++) await failure(w, w.mPrivate, 'FM-3.2');
    const adm = await attention(w.admin), mia = await attention(w.mia);
    const fa = adm.rows.find((r) => r.kind === 'failure' && r.members[0].id && r.why.includes('FM-3.2'))!, fm = mia.rows.find((r) => r.kind === 'failure')!;
    expect(fa.count).toBeGreaterThan(fm.count);
    expect(fm.count).toBe(1);
    expect(mia.totals.items).toBeLessThan(adm.totals.items);
    expect(mia.totals.items).toBe(mia.rows.reduce((s, r) => s + r.count, 0));
    for (const r of mia.rows) expect(JSON.stringify(r)).not.toContain(P.failure);
  });
  it('a deleted mission leaves the queue', async () => {
    const m = (await w.mia.req('POST', '/missions', { text: 'To be deleted.', files: [], shared: true }, key())).body.mission.id as string;
    const a = (await approval(w, m, 'submit_form')).id;
    expect(members((await attention(w.admin)).rows)).toContain(`approval:${a}`);
    expect((await w.mia.req('DELETE', `/missions/${m}`, undefined, key())).status).toBe(200);
    expect(members((await attention(w.admin)).rows)).not.toContain(`approval:${a}`);
  });
  it('without a session the route is refused', async () => {
    const r = await new Browser(w.t.app).req('GET', '/attention');
    expect(r.status).toBe(401);
  });
});

describe('c68 item 6: no per-person ranking', () => {
  it('rows that two people can both see come in the same relative order', async () => {
    const a = await attention(w.admin), m = await attention(w.mia);
    const mine = new Set(m.rows.map((r) => r.id));
    expect(a.rows.map((r) => r.id).filter((id) => mine.has(id))).toEqual(m.rows.map((r) => r.id).filter((id) => new Set(a.rows.map((r) => r.id)).has(id)));
  });
  it('no person\'s name or id appears anywhere in the response, for a member or an administrator', async () => {
    for (const who of [w.admin, w.mia]) {
      const text = JSON.stringify(await attention(who));
      for (const bad of ['Luca', 'Mia', 'Ben', w.adminId, w.miaId, w.benId]) expect(text, String(bad)).not.toContain(bad);
    }
  });
  it('there is one route, and it has no per-person or per-approver variant', async () => {
    const reg = await import('./contracts/registry.ts');
    const keys = Object.keys(reg.ROUTES).filter((k) => /attention/.test(k));
    expect(keys.length).toBeLessThanOrEqual(1);
    for (const sub of ['/attention/people', '/attention/approvers', '/attention/users', '/attention/me']) expect((await w.admin.req('GET', sub)).status).toBe(404);
    expect((await w.admin.req('GET', `/attention?user=${w.miaId}`)).body.rows.length).toBe((await w.admin.req('GET', '/attention')).body.rows.length);
  });
});
