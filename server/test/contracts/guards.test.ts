import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ERROR_CODES } from '../../../shared/contracts/src/index.ts';
import { check } from './validate.ts';
import * as C from './validators.ts';
import { checkEvent } from './events.ts';

describe('the validators themselves detect drift', () => {
  const ok = { ok: true, db: 'up', version: '1', commit: null, leader: true };
  it('accepts a correct body', () => expect(check('h', C.health, ok)).toEqual([]));
  it('flags a missing field, a wrong type, an extra field and a bad enum', () => {
    expect(check('h', C.health, { ok: true, db: 'up', commit: null, leader: true })).toEqual(['h.version: missing']);
    expect(check('h', C.health, { ...ok, ok: 'yes' })[0]).toMatch(/expected boolean/);
    expect(check('h', C.health, { ...ok, extra: 1 })).toEqual(['h.extra: not in the contract']);
    expect(check('h', C.health, { ...ok, db: 'sideways' })[0]).toMatch(/expected one of/);
  });
  it('flags an event of an unknown type and a payload that does not match', () => {
    const env = { id: '1', seq: 1, type: 'mission.shared', tenantId: 't-1', actor: { kind: 'human', id: 'u' }, subject: { kind: 'mission', id: 'M-1' }, occurredAt: new Date().toISOString(), correlationId: 'c', schemaVersion: 1 };
    expect(checkEvent({ ...env, payload: { shared: true } })).toEqual([]);
    expect(checkEvent({ ...env, payload: { shared: 'yes' } }).length).toBe(1);
    expect(checkEvent({ ...env, type: 'mission.exploded', payload: {} })[0]).toMatch(/not in EVENT_TYPES/);
  });
});

describe('error codes', () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.ts') ? [join(d, f)] : []));
  it('every code the server throws or sends is in ERROR_CODES', () => {
    const used = new Set<string>();
    for (const f of walk(join(__dirname, '../../src'))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/new ApiError\('([A-Z_]+)'/g)) used.add(m[1]);
      if (f.endsWith('src/app.ts')) for (const m of src.matchAll(/code: [^\n]*/g)) for (const q of m[0].matchAll(/'([A-Z_]{3,})'/g)) used.add(q[1]); // every quoted code on a `code:` line, not just the first
      // codes passed through a variable, e.g. new ApiError(out.code, ...) with `code: 'X' as const` defined in the same file
      if (/new ApiError\((?!')/.test(src)) for (const m of src.matchAll(/code: '([A-Z_]+)' as const/g)) used.add(m[1]); // the error handler's own envelopes
    }
    expect([...used].filter((c) => !(ERROR_CODES as readonly string[]).includes(c))).toEqual([]);
  });
});
