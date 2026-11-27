import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { gates, parseDiff, scanFlags, loadRules, FLAG_RULES } from './gates.ts';

// Fake secret values are built at run time, so no token-like literal sits in the repo (push protection).
const TOKEN = ['sk', 'ant', 'oat01', randomBytes(30).toString('base64url')].join('-');
const PASSWORD = 'pw' + randomBytes(10).toString('hex');
const SECRETS = [TOKEN, PASSWORD, 'short'];

const diffOf = (file: string, added: string[], removed: string[] = [], context: string[] = ['ctx']) =>
  [
    `diff --git a/${file} b/${file}`,
    'index 1111111..2222222 100644',
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${removed.length + context.length} +1,${added.length + context.length} @@`,
    ...context.map((l) => ` ${l}`),
    ...removed.map((l) => `-${l}`),
    ...added.map((l) => `+${l}`),
    '',
  ].join('\n');

const base = { files: [{ path: 'web/src/a.ts', status: 'M' as const }], secrets: SECRETS, report: 'changed a.ts', message: 'feat: a' };
const run = (o: Partial<Parameters<typeof gates>[0]> & { diff: string }) => gates({ ...base, ...o });
const leaks = (hits: string[]) => hits.some((h) => h.includes(TOKEN) || h.includes(PASSWORD));

test('a clean diff has no hits and no flags', () => {
  assert.deepEqual(run({ diff: diffOf('web/src/a.ts', ['export const a = 1;']) }), { protectedHits: [], secretHits: [], flags: [] });
});

test('protected hits come from the Guard classify and evolve/protected.txt', () => {
  const r = run({ diff: diffOf('evolve/x', ['y']), files: [{ path: 'evolve/x', status: 'M' }, { path: 'server/test/new.test.ts', status: 'A' }, { path: 'server/test/old.test.ts', status: 'M' }] });
  assert.deepEqual(r.protectedHits, ['evolve/x', 'server/test/old.test.ts']);
  assert.ok(loadRules().includes('evolve/**'));
  assert.deepEqual(run({ diff: '', files: [{ path: 'web/b.ts', status: 'R', oldPath: '.gitattributes' }] }).protectedHits, ['.gitattributes']);
});

test('a planted token value in an added line is a secret hit that names the place, never the value', () => {
  const r = run({ diff: diffOf('web/src/a.ts', ['const ok = 1;', `const t = "${TOKEN}";`]) });
  assert.equal(r.secretHits.length >= 1, true);
  assert.ok(r.secretHits.some((h) => h.includes('web/src/a.ts:3')), r.secretHits.join('; '));
  assert.equal(leaks(r.secretHits), false);
  assert.equal(leaks(r.flags), false);
});

test('the same value only in a removed or context line is ignored', () => {
  assert.deepEqual(run({ diff: diffOf('web/src/a.ts', ['const t = 1;'], [`const t = "${PASSWORD}";`]) }).secretHits, []);
  assert.deepEqual(run({ diff: diffOf('web/src/a.ts', ['const t = 1;'], [], [`old ${PASSWORD}`]) }).secretHits, []);
});

test('the value in the commit message, the report or a file name is a hit', () => {
  const d = diffOf('web/src/a.ts', ['x']);
  assert.ok(run({ diff: d, message: `fix: ${PASSWORD}` }).secretHits.some((h) => h.includes('commit message')));
  assert.ok(run({ diff: d, report: `I found ${TOKEN}` }).secretHits.some((h) => h.includes('report')));
  const named = run({ diff: '', files: [{ path: `web/${PASSWORD}.txt`, status: 'A' }] });
  assert.ok(named.secretHits.some((h) => h.includes('file name')), named.secretHits.join('; '));
  assert.equal(leaks(named.secretHits), false);
});

test('encoded and split forms of a value are hits (base64 at any alignment, hex, reversed, split over lines)', () => {
  for (const pre of ['', 'a', 'ab']) {
    const b64 = Buffer.from(pre + PASSWORD).toString('base64');
    assert.ok(run({ diff: diffOf('web/src/a.ts', [`const b = "${b64}";`]) }).secretHits.length > 0, `base64 offset ${pre.length}`);
  }
  assert.ok(run({ diff: diffOf('web/src/a.ts', [Buffer.from(TOKEN).toString('base64url')]) }).secretHits.length > 0, 'base64url');
  assert.ok(run({ diff: diffOf('web/src/a.ts', [Buffer.from(PASSWORD).toString('hex').toUpperCase()]) }).secretHits.length > 0, 'hex');
  assert.ok(run({ diff: diffOf('web/src/a.ts', [[...PASSWORD].reverse().join('')]) }).secretHits.length > 0, 'reversed');
  assert.ok(run({ diff: diffOf('web/src/a.ts', [PASSWORD.slice(0, 9), PASSWORD.slice(9)]) }).secretHits.length > 0, 'split');
});

test('the markers sk-ant-, CLAUDE_CODE_OAUTH and -----BEGIN in added lines are hits; values shorter than 12 are not used', () => {
  for (const m of ['sk-' + 'ant-x', 'CLAUDE_CODE_' + 'OAUTH_TOKEN', '-----' + 'BEGIN PRIVATE KEY-----']) {
    assert.ok(run({ diff: diffOf('web/src/a.ts', [`// ${m}`]) }).secretHits.length > 0, m);
  }
  assert.deepEqual(run({ diff: diffOf('web/src/a.ts', ['const s = "short";']) }).secretHits, []);
});

test('a binary change cannot be scanned and counts as a secret hit; a symlink is a flag', () => {
  const bin = ['diff --git a/web/i.png b/web/i.png', 'new file mode 100644', 'index 0000000..1111111', 'Binary files /dev/null and b/web/i.png differ', ''].join('\n');
  assert.ok(run({ diff: bin, files: [{ path: 'web/i.png', status: 'A' }] }).secretHits.some((h) => h.includes('web/i.png')));
  const link = ['diff --git a/web/l b/web/l', 'new file mode 120000', 'index 0000000..1111111', '--- /dev/null', '+++ b/web/l', '@@ -0,0 +1 @@', '+/proc/self/environ', '\\ No newline at end of file', ''].join('\n');
  assert.ok(run({ diff: link, files: [{ path: 'web/l', status: 'A' }] }).flags.some((f) => f.startsWith('symlink')));
});

test('parseDiff: added lines with file and new line number; a "+++" inside a hunk is content, not a header', () => {
  const d = diffOf('web/src/a.ts', ['++ looks like a header', 'b'], ['old']);
  const p = parseDiff(d);
  assert.deepEqual(p.added.map((a) => [a.file, a.line, a.text]), [['web/src/a.ts', 2, '++ looks like a header'], ['web/src/a.ts', 3, 'b']]);
});

// each flag fires on a positive fixture and not on a near-miss
const FIXTURES: Record<string, { hit: string[]; miss: string[] }> = {
  fetch: { hit: ['await fetch(url)', 'x = fetch ("/a")', 'globalThis.fetch(u)'], miss: ['prefetch(x)', 'fetchData(x)', 'const fetched = 1'] },
  url: { hit: ['const u = "https://evil.example/x"', "load('http://10.0.0.1:80/')"], miss: ['fetchJson("/api/v1/x")', 'xmlns="http://www.w3.org/2000/svg"', '// see docs'] },
  env: { hit: ['const k = process.env.KEY', "process['env']", 'const { env } = process'], miss: ['process.envelope', 'const environment = 1'] },
  child_process: { hit: ["import { spawn } from 'node:child_process'", "require('child_process')"], miss: ['const child_processor = 1'] },
  fs_write: { hit: ['fs.writeFileSync(p, d)', 'await fsp.writeFile(p, d)', 'fs.rmSync(p)', 'await unlink(p)', 'fs.unlinkSync(p)', 'writeFileSync(p, d)', 'fs.rm(p, cb)', 'createWriteStream(p)'], miss: ['fs.readFileSync(p)', 'rewriteFile(x)', 'const unlinked = true', 'fs.rmdirSyncish'] },
  sql: { hit: ['await q("DROP TABLE users")', 'drop table if exists x', 'TRUNCATE users', 'truncate table x', "q('DELETE FROM missions')", 'delete from x;'], miss: ['dropdown()', 'drop the item', "q('DELETE FROM missions WHERE id = $1')", 'truncate(text, 40)', 'deleted from list'] },
  eval: { hit: ['eval(code)', 'new Function("return 1")', 'window.eval (x)'], miss: ['evaluate(x)', 'medieval(x)', 'new FunctionComponent()'] },
};

test('every flag rule has fixtures; each fires on its positives and not on its near-misses', () => {
  assert.deepEqual(Object.keys(FIXTURES).sort(), FLAG_RULES.map((r) => r.id).sort());
  for (const [id, f] of Object.entries(FIXTURES)) {
    for (const s of f.hit) assert.ok(scanFlags(s).includes(id), `${id} should fire on: ${s}`);
    for (const s of f.miss) assert.ok(!scanFlags(s).includes(id), `${id} should not fire on: ${s}`);
  }
});

test('flags come from added lines only and name file and line', () => {
  const r = run({ diff: diffOf('web/src/a.ts', ['const x = 1;', 'eval(code)'], ['fetch(old)']) });
  assert.deepEqual(r.flags, ['eval(/new Function( in web/src/a.ts:3']);
});
