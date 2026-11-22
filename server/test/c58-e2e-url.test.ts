import { describe, it, expect } from 'vitest';
import { isE2eDatabaseUrl } from '../src/cli/e2e-url.ts';

describe('c58 fix F2: only a database named axion_e2e or axion_e2e<digits> passes the e2e guard', () => {
  const ok = ['postgres://u:p@h:5432/axion_e2e', 'postgres://u:p@127.0.0.1/axion_e2e16', 'postgres://u:p@h/axion_e2e0?sslmode=disable', 'postgres://u:p@h/axion_e2e5#frag'];
  const bad = [
    'postgres://u:p@h/axion?x=/axion_e2e', 'postgres://u:p@h/axion#/axion_e2e', 'postgres://u:p@h/axion?application_name=/axion_e2e5', 'postgres://u:p@h/axion?dbname=/axion_e2e',
    'postgres://axion_e2e', 'postgres://axion_e2e@h', 'postgres://u:p@axion_e2e/axion', 'postgres://u:p@h/axion_e2e16x', 'postgres://u:p@h/axion_e2e_prod', 'postgres://u:p@h/my_axion_e2e',
    'postgres://u:p@h/axion', 'postgres://u:p@h/axion_e2e/extra', 'postgres://u:p@h/', 'postgres://u:p@h', 'not a url', '', 'postgres://u:p@h/axion_e2e%2Fx', 'postgres://u:p@h/%2Faxion_e2e',
    'postgres://u:p@h/axion_e2e%ZZ',
  ];
  it.each(ok)('accepts %s', (u) => expect(isE2eDatabaseUrl(u)).toBe(true));
  it.each(bad)('rejects %s', (u) => expect(isE2eDatabaseUrl(u)).toBe(false));
  it('rejects undefined and non-strings', () => { expect(isE2eDatabaseUrl(undefined)).toBe(false); expect(isE2eDatabaseUrl(5 as never)).toBe(false); });
});
