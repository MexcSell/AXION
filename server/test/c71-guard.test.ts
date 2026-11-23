import { describe, it, expect } from 'vitest';
import { assertC71Wipe } from '../scripts/c71-guard.ts';

const u = (db: string, tail = '') => `postgres://u:p@127.0.0.1:5432/${db}${tail}`;
describe('c71-scale wipe guard', () => {
  it('accepts a lane e2e database and the integrator one, with CONFIRM_WIPE=1', () => {
    expect(assertC71Wipe(u('axion_e2e14'), '1')).toBe('axion_e2e14');
    expect(assertC71Wipe(u('axion_e2e'), '1')).toBe('axion_e2e');
  });
  it('refuses the live database and every other name, whatever the confirmation', () => {
    for (const db of ['axion', 'axion_test', 'axion_lane_disabled', 'axion_e2ex', 'axion_e2e14_old', 'postgres']) expect(() => assertC71Wipe(u(db), '1'), db).toThrow(/refusing/);
  });
  it('refuses a URL with a query string or fragment (?host= would redirect the wipe)', () => {
    for (const tail of ['?host=other.example', '?host=/tmp', '?sslmode=disable', '#x']) expect(() => assertC71Wipe(u('axion_e2e14', tail), '1'), tail).toThrow(/query string/);
    expect(() => assertC71Wipe(u('axion', '?host=x'), '1')).toThrow(/query string/);
  });
  it('refuses a remote host, a missing or unparseable URL, and a missing CONFIRM_WIPE=1', () => {
    expect(() => assertC71Wipe('postgres://u:p@db.example:5432/axion_e2e14', '1')).toThrow(/host/);
    expect(() => assertC71Wipe(undefined, '1')).toThrow(/not set/);
    expect(() => assertC71Wipe('not a url', '1')).toThrow(/parse/);
    for (const c of [undefined, '', '0', 'axion_e2e14', 'yes']) expect(() => assertC71Wipe(u('axion_e2e14'), c), String(c)).toThrow(/CONFIRM_WIPE=1/);
  });
});
