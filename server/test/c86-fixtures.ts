import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';

/** c86 fixtures: a company with an administrator, Mia (owns the missions), Ben (the independent reviewer), Zed and Amy (forecasters); a shared and a private staffed mission. */
export interface World {
  t: TestApp; admin: Browser; adminId: string; mia: Browser; miaId: string; ben: Browser; benId: string; zed: Browser; zedId: string; amy: Browser; amyId: string;
  mShared: string; mPrivate: string;
  task: (mission?: string, o?: { status?: string; title?: string }) => Promise<string>;
  review: (taskId: string, verdict?: 'accepted' | 'changes_requested' | 'rejected', by?: Browser) => Promise<{ status: number; body: any }>;
  q: (sql: string, p?: unknown[]) => Promise<any[]>;
}
let n = 0;
export const key = () => ({ 'idempotency-key': 'c86-' + Date.now() + '-' + n++ });
const RUBRIC = [{ criterion: 'The output is attached', result: 'pass', note: 'seen' }];
const EV = [{ kind: 'url', ref: 'https://example.com/report' }];

export async function makeWorld(): Promise<World> {
  const t = await makeTestApp({ staffingStepMs: 30, writeLimits: { proposals: { max: 1000, windowMs: 60_000 } } });
  const w = await withAdmin(t.app);
  const mia = await w.member('Mia'), ben = await w.member('Ben'), zed = await w.member('Zed'), amy = await w.member('Amy');
  const staffed = async (b: Browser, shared: boolean) => {
    const m = (await b.req('POST', '/missions', { text: 'Build a website landing page for the shop.', files: [], shared }, key())).body.mission.id as string;
    const t0 = Date.now();
    while (Date.now() - t0 < 10_000 && (await b.req('GET', `/missions/${m}`)).body.mission.staffing.stage !== 'working') await new Promise((r) => setTimeout(r, 40));
    return m;
  };
  const mShared = await staffed(mia.b, true), mPrivate = await staffed(mia.b, false);
  let tk = 0;
  const q = async (sql: string, p: unknown[] = []) => (await t.pool.query(sql, p)).rows;
  return {
    t, admin: w.admin, adminId: w.adminId, mia: mia.b, miaId: mia.id, ben: ben.b, benId: ben.id, zed: zed.b, zedId: zed.id, amy: amy.b, amyId: amy.id, mShared, mPrivate, q,
    task: async (mission = mShared, o = {}) => {
      const id = 'T-f' + ++tk + '-' + Math.random().toString(36).slice(2, 6);
      await t.pool.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id) values ($1,'t-1',$2,$3,$4,'coder-01',$5)`, [id, mission, o.title ?? 'Write the report', o.status ?? 'passed', `${mission}:coder-01`]);
      return id;
    },
    review: async (taskId, verdict = 'accepted', by = ben.b) => {
      const r = await by.req('POST', `/tasks/${taskId}/reviews`, { verdict, rubric: RUBRIC, evidence: verdict === 'accepted' ? EV : [] }, key());
      return { status: r.status, body: r.body };
    },
  };
}
export const forecast = (b: Browser, taskId: string, probability: unknown) => b.req('POST', `/tasks/${taskId}/forecasts`, { probability }, key());
