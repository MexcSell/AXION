import { describe, it, expect } from 'vitest';
import { validateExecProfile } from '../src/exec-profile/validator.ts';
import { goodProfile } from './fixtures/exec-profile-good.ts';

// c99 X1-1: /var/run and /run are never a scope. New visible family; earlier c94 families are untouched.
const refusalCodes = (p: unknown): string[] => { const r = validateExecProfile(p); return r.ok ? [] : r.refusals.map((x) => x.code); };

describe('c99 X1-1: /var/run and /run are never a scope', () => {
  it.each(['/var/run', '/var/run/docker', '/var/run/secrets/kubernetes.io', '/run', '/run/user/1000', '/run/secrets', '/var/run/', '/var//run/x', '/var/./run'])('refuses %s as writable and as read-only scope', (dir) => {
    for (const key of ['writablePaths', 'readOnlyPaths'] as const) {
      const p = goodProfile(); p.filesystem[key] = [dir];
      expect(refusalCodes(p), `${key} ${dir}`).toContain('path_too_broad');
    }
  });
  it.each(['/var/runner', '/var/running', '/runtime', '/running/x', '/var/lib/run', '/var/log', '/work/run', '/work/var/run'])('still accepts the look-alike %s', (dir) => {
    const p = goodProfile(); p.filesystem.readOnlyPaths = [dir];
    expect(validateExecProfile(p).ok, dir).toBe(true);
  });
  it('the existing sensitive roots are still refused', () => {
    for (const dir of ['/', '/etc', '/proc', '/root', '/sys', '/dev', '/etc/ssh']) { const p = goodProfile(); p.filesystem.writablePaths = [dir]; expect(refusalCodes(p), dir).toContain('path_too_broad'); }
  });
});

