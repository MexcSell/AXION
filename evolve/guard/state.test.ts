import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readState, writeState } from './state.ts';
import type { GuardState } from './state.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'guard-state-'));
const S: GuardState = {
  active: 'green', activeImage: 'bbbbbbbbbbbb-20261126T120000Z', activeSha: 'b'.repeat(40),
  previousImage: 'aaaaaaaaaaaa-20261125T100000Z', previousSha: 'a'.repeat(40),
  deploying: { sha: 'b'.repeat(40), step: 'watch', startedAt: '2026-11-26T12:00:00.000Z' },
};

test('a missing state.json reads as null', async () => {
  assert.equal(await readState(tmp()), null);
});

test('write then read round-trips, keeps unknown fields, and leaves no temp file behind', async () => {
  const dir = tmp();
  await writeState(dir, { ...S, frontPort: 5290, database: 'axion' });
  assert.deepEqual(await readState(dir), { ...S, frontPort: 5290, database: 'axion' });
  assert.deepEqual(readdirSync(dir), ['state.json']);
  assert.equal(statSync(join(dir, 'state.json')).mode & 0o777, 0o600);
});

test('writes replace the file by rename (a reader never sees a half-written file)', async () => {
  const dir = tmp();
  await writeState(dir, S);
  const ino1 = statSync(join(dir, 'state.json')).ino;
  const { deploying, ...cleared } = S;
  await writeState(dir, cleared);
  assert.notEqual(statSync(join(dir, 'state.json')).ino, ino1);
  assert.deepEqual(await readState(dir), cleared);
  assert.equal(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).deploying, undefined);
});

test('a corrupt or malformed state.json throws instead of reading as "nothing live"', async () => {
  for (const body of ['{"active":', '[]', 'null', '{"active":"red","activeImage":null,"activeSha":null,"previousImage":null}',
    '{"active":"blue","activeImage":5,"activeSha":null,"previousImage":null}',
    '{"active":"blue","activeImage":null,"activeSha":null,"previousImage":null,"deploying":{"sha":"x","step":"fly","startedAt":"t"}}']) {
    const dir = tmp();
    writeFileSync(join(dir, 'state.json'), body);
    await assert.rejects(readState(dir), /state\.json/, body);
  }
});
