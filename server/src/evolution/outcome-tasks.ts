import { cloneState, emptyState, fileIs, mark, result, untouchedOutside, sha256, type OutcomeState, type StatePath, type ToyTask } from './outcome-grader.ts';

/**
 * c97: ten toy tasks, each with an end-state grader, a reference solution and a null solution. Toy tasks test the harness, not any agent.
 * The graders look only at the end state. Anything under /scratch/ is ignored.
 */

function state(parts: Partial<OutcomeState>): OutcomeState { return { ...emptyState(), ...parts }; }
const only = (...paths: string[]) => (p: StatePath) => p.t === 'file' && paths.includes(p.path);
const doNothing = (s: OutcomeState) => cloneState(s);

/** the expected answer text for tasks whose answer is a file; the tamper fixtures store the hashes of these as "stored answers" */
export const ANSWER_TEXT: Record<string, string> = {
  'write-file': 'Report: 3 items\n',
  'rename-file': 'hello',
  'edit-json-config': '{"port":8080,"debug":true}',
  'dedupe-lines': 'a\nb\nc\n',
  'sum-rows-to-file': '42.5',
};

const writeFile: ToyTask = {
  id: 'write-file', description: 'Create /work/report.txt with the exact report text; leave notes.txt alone.',
  initial: state({ files: { '/work/notes.txt': 'draft' } }),
  grade(f, i) {
    const r: string[] = [];
    mark(r, fileIs(f, '/work/report.txt', ANSWER_TEXT['write-file']), 'report.txt missing or wrong');
    r.push(...untouchedOutside(f, i, only('/work/report.txt')));
    return result(r);
  },
  reference(i) { const s = cloneState(i); s.files['/work/report.txt'] = ANSWER_TEXT['write-file']; return s; },
  nul: doNothing,
};

const renameFile: ToyTask = {
  id: 'rename-file', description: 'Move /work/a.txt to /work/b.txt with the same content.',
  initial: state({ files: { '/work/a.txt': 'hello' } }),
  grade(f, i) {
    const r: string[] = [];
    mark(r, !Object.prototype.hasOwnProperty.call(f.files, '/work/a.txt'), 'a.txt still exists');
    mark(r, fileIs(f, '/work/b.txt', ANSWER_TEXT['rename-file']), 'b.txt missing or content changed');
    r.push(...untouchedOutside(f, i, only('/work/a.txt', '/work/b.txt')));
    return result(r);
  },
  reference(i) { const s = cloneState(i); s.files['/work/b.txt'] = s.files['/work/a.txt']; delete s.files['/work/a.txt']; return s; },
  nul: doNothing,
};

const updateRow: ToyTask = {
  id: 'update-row', description: 'Set orders/o7 status to shipped; keep its total and the other order.',
  initial: state({ rows: { orders: { o7: { status: 'pending', total: 40 }, o8: { status: 'pending', total: 15 } } } }),
  grade(f, i) {
    const r: string[] = [];
    const row = f.rows.orders?.o7;
    mark(r, row?.status === 'shipped', 'o7 status is not shipped');
    mark(r, row?.total === 40, 'o7 total changed');
    r.push(...untouchedOutside(f, i, (p) => p.t === 'field' && p.table === 'orders' && p.id === 'o7' && p.field === 'status'));
    return result(r);
  },
  reference(i) { const s = cloneState(i); s.rows.orders.o7.status = 'shipped'; return s; },
  nul: doNothing,
};

const insertRow: ToyTask = {
  id: 'insert-row', description: 'Insert customers/c9 with name Ada and tier gold; keep c1.',
  initial: state({ rows: { customers: { c1: { name: 'Bo', tier: 'basic' } } } }),
  grade(f, i) {
    const r: string[] = [];
    const row = f.rows.customers?.c9;
    mark(r, row !== undefined && row.name === 'Ada' && row.tier === 'gold' && Object.keys(row).length === 2, 'c9 missing or wrong');
    r.push(...untouchedOutside(f, i, (p) => (p.t === 'row' || p.t === 'field') && p.table === 'customers' && p.id === 'c9'));
    return result(r);
  },
  reference(i) { const s = cloneState(i); s.rows.customers.c9 = { name: 'Ada', tier: 'gold' }; return s; },
  nul: doNothing,
};

const deleteStale: ToyTask = {
  id: 'delete-stale-rows', description: 'Delete every session whose status is stale; keep the active ones untouched.',
  initial: state({ rows: { sessions: { s1: { status: 'stale' }, s2: { status: 'active' }, s3: { status: 'stale' }, s4: { status: 'active' }, s5: { status: 'stale' } } } }),
  grade(f, i) {
    const r: string[] = [];
    const rows = f.rows.sessions ?? {};
    for (const id of ['s1', 's3', 's5']) mark(r, !Object.prototype.hasOwnProperty.call(rows, id), `${id} still present`);
    for (const id of ['s2', 's4']) mark(r, rows[id]?.status === 'active', `${id} missing or changed`);
    r.push(...untouchedOutside(f, i, (p) => p.t === 'row' && p.table === 'sessions' && ['s1', 's3', 's5'].includes(p.id)));
    return result(r);
  },
  reference(i) { const s = cloneState(i); for (const id of ['s1', 's3', 's5']) delete s.rows.sessions[id]; return s; },
  nul: doNothing,
};

const editJson: ToyTask = {
  id: 'edit-json-config', description: 'Set port to 8080 in /work/app.json and keep debug true; add no other keys.',
  initial: state({ files: { '/work/app.json': '{"port":80,"debug":true}' } }),
  grade(f, i) {
    const r: string[] = [];
    let cfg: unknown = null;
    try { cfg = JSON.parse(f.files['/work/app.json'] ?? ''); } catch { r.push('app.json is not valid JSON'); }
    if (cfg !== null && typeof cfg === 'object' && !Array.isArray(cfg)) {
      const c = cfg as Record<string, unknown>;
      mark(r, c.port === 8080, 'port is not 8080');
      mark(r, c.debug === true, 'debug changed');
      mark(r, Object.keys(c).length === 2, 'unexpected keys');
    } else if (r.length === 0) r.push('app.json is not an object');
    r.push(...untouchedOutside(f, i, only('/work/app.json')));
    return result(r);
  },
  reference(i) { const s = cloneState(i); s.files['/work/app.json'] = ANSWER_TEXT['edit-json-config']; return s; },
  nul: doNothing,
};

const fillForm: ToyTask = {
  id: 'fill-form-page', description: 'Fill form.email with a@b.co and submit; leave the password empty.',
  initial: state({ page: { 'form.email': '', 'form.password': '', 'form.submitted': false } }),
  grade(f, i) {
    const r: string[] = [];
    mark(r, f.page['form.email'] === 'a@b.co', 'email wrong');
    mark(r, f.page['form.submitted'] === true, 'form not submitted');
    mark(r, f.page['form.password'] === '', 'password was filled');
    r.push(...untouchedOutside(f, i, (p) => p.t === 'page' && (p.key === 'form.email' || p.key === 'form.submitted')));
    return result(r);
  },
  reference(i) { const s = cloneState(i); s.page['form.email'] = 'a@b.co'; s.page['form.submitted'] = true; return s; },
  nul: doNothing,
};

const dedupe: ToyTask = {
  id: 'dedupe-lines', description: 'Rewrite /work/list.txt with unique lines, sorted, one per line.',
  initial: state({ files: { '/work/list.txt': 'b\na\nb\nc\na\n' } }),
  grade(f, i) {
    const r: string[] = [];
    mark(r, fileIs(f, '/work/list.txt', ANSWER_TEXT['dedupe-lines']), 'list.txt is not the unique sorted lines');
    r.push(...untouchedOutside(f, i, only('/work/list.txt')));
    return result(r);
  },
  reference(i) { const s = cloneState(i); s.files['/work/list.txt'] = ANSWER_TEXT['dedupe-lines']; return s; },
  nul: doNothing,
};

const sumRows: ToyTask = {
  id: 'sum-rows-to-file', description: 'Write the sum of the ledger amounts to /work/total.txt; do not change the ledger.',
  initial: state({ rows: { ledger: { l1: { amount: 10 }, l2: { amount: 20 }, l3: { amount: 12.5 } } } }),
  grade(f, i) {
    const r: string[] = [];
    // the expected value is computed from the INITIAL ledger, so a solution that edits the ledger cannot move the target
    let sum = 0;
    for (const row of Object.values(i.rows.ledger ?? {})) sum += Number(row.amount);
    const got = (f.files['/work/total.txt'] ?? '').trim();
    mark(r, got !== '' && Number(got) === sum && sha256(got) === sha256(String(sum)), 'total.txt is not the sum');
    r.push(...untouchedOutside(f, i, only('/work/total.txt')));
    return result(r);
  },
  reference(i) { const s = cloneState(i); s.files['/work/total.txt'] = ANSWER_TEXT['sum-rows-to-file']; return s; },
  nul: doNothing,
};

const navToggle: ToyTask = {
  id: 'navigate-and-toggle-page', description: 'Go to /settings/profile and turn notifications off.',
  initial: state({ page: { url: '/home', 'settings.notifications': true, 'settings.theme': 'dark' } }),
  grade(f, i) {
    const r: string[] = [];
    mark(r, f.page.url === '/settings/profile', 'wrong page');
    mark(r, f.page['settings.notifications'] === false, 'notifications still on');
    r.push(...untouchedOutside(f, i, (p) => p.t === 'page' && (p.key === 'url' || p.key === 'settings.notifications')));
    return result(r);
  },
  reference(i) { const s = cloneState(i); s.page.url = '/settings/profile'; s.page['settings.notifications'] = false; return s; },
  nul: doNothing,
};

export const TOY_TASKS: readonly ToyTask[] = [writeFile, renameFile, updateRow, insertRow, deleteStale, editJson, fillForm, dedupe, sumRows, navToggle];
