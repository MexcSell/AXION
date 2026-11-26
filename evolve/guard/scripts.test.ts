// evolve/backup.sh (F2) against a fake root: the database contract with the Guard and the retention of whole backup sets.
// Runs the real script as root with a fake `runuser` (runs the command as is) and a fake db-backup.mjs; skipped when not
// root or when the OS user axion does not exist (the script chowns to it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = new URL('../backup.sh', import.meta.url).pathname;
const hasAxion = spawnSync('id', ['axion']).status === 0;
const skip = process.getuid?.() !== 0 ? 'needs root' : !hasAxion ? 'needs the OS user axion' : false;

function fakeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'guard-backup-'));
  mkdirSync(join(root, 'guard', 'tools'), { recursive: true });
  mkdirSync(join(root, 'data', 'uploads'), { recursive: true });
  writeFileSync(join(root, 'data', 'audit-anchors.jsonl'), '{"a":1}\n');
  // fake db-backup.mjs: records the URL it got, writes a dump + manifest with an increasing stamp, prints like the real one
  writeFileSync(join(root, 'guard', 'tools', 'db-backup.mjs'), `
import { writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
const dir = process.env.BACKUP_DIR;
const n = existsSync(dir + '/.n') ? Number(readFileSync(dir + '/.n', 'utf8')) + 1 : 10;
writeFileSync(dir + '/.n', String(n));
appendFileSync(dir + '/.urls', process.env.DATABASE_URL + '\\n');
const base = dir + '/axion-20261126T1200' + String(n).padStart(2, '0') + 'Z';
writeFileSync(base + '.dump', 'x'); writeFileSync(base + '.json', '{}');
console.log('backup: ' + base + '.dump (1 bytes), manifest 0 missions / 0 events');
`);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'runuser'), '#!/bin/sh\n# fake: runuser -u axion -- <cmd…>\nshift 3\nexec "$@"\n');
  chmodSync(join(bin, 'runuser'), 0o755);
  const run = (env: Record<string, string> = {}) => spawnSync('bash', [SCRIPT], {
    encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH}`, EVOLVE_ROOT: root, ...env },
  });
  return { root, run, out: join(root, 'backups') };
}

test('backup.sh: dumps the database the Guard names (AXION_GUARD_DATABASE, default axion), prints the dump path last', { skip }, () => {
  const r = fakeRoot();
  const a = r.run({ AXION_GUARD_DATABASE: 'axion_restore_check' });
  assert.equal(a.status, 0, a.stderr);
  const last = a.stdout.trim().split('\n').at(-1)!;
  assert.match(last, /\/backups\/axion-20261126T120010Z\.dump$/);
  assert.ok(existsSync(last.replace(/\.dump$/, '.data.tar.gz')));
  const b = r.run();
  assert.equal(b.status, 0, b.stderr);
  assert.deepEqual(readFileSync(join(r.out, '.urls'), 'utf8').trim().split('\n'), [
    'postgresql:///axion_restore_check?host=/var/run/postgresql&user=axion',
    'postgresql:///axion?host=/var/run/postgresql&user=axion',
  ]);
  for (const bad of ['Axion', 'axion;drop', 'axion x', '1axion', '']) {
    if (bad === '') continue; // empty = unset → default
    const x = r.run({ AXION_GUARD_DATABASE: bad });
    assert.equal(x.status, 2, bad);
    assert.match(x.stderr, /not a database name/);
  }
  assert.equal(readFileSync(join(r.out, '.urls'), 'utf8').trim().split('\n').length, 2, 'a refused name never reaches db-backup');
});

test('backup.sh: keeps the newest 14 sets; a .data.tar.gz goes with its dump, an orphan one goes too', { skip }, () => {
  const r = fakeRoot();
  mkdirSync(r.out, { recursive: true });
  writeFileSync(join(r.out, 'axion-20200101T000000Z.data.tar.gz'), 'orphan');
  for (let i = 0; i < 16; i++) assert.equal(r.run().status, 0);
  const files = readdirSync(r.out).filter((f) => !f.startsWith('.')).sort();
  const dumps = files.filter((f) => f.endsWith('.dump'));
  const data = files.filter((f) => f.endsWith('.data.tar.gz'));
  assert.equal(dumps.length, 14);
  assert.deepEqual(data, dumps.map((d) => d.replace(/\.dump$/, '.data.tar.gz')));
  assert.equal(dumps[0], 'axion-20261126T120012Z.dump', 'the two oldest sets are gone');
  assert.ok(!files.includes('axion-20200101T000000Z.data.tar.gz'));
});
