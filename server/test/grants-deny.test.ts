import { describe, it, expect } from 'vitest';
import { normaliseOrigin } from '../src/grants/origin.ts';
import { isPublicSuffix } from '../src/grants/psl.ts';

// c56 fix round, ruling 2: every entry of c36's removed partial list stays refused (no loosening). The PSL covers most;
// the rest are the additive deny list in origin.ts ("multi-tenant hosts refused in addition to the PSL").
const C36_PARTIAL_LIST = [
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'co.jp', 'co.nz', 'co.za', 'co.in', 'com.br', 'com.cn', 'com.mx', 'co.kr',
  'github.io', 'gitlab.io', 'pages.dev', 'workers.dev', 'vercel.app', 'netlify.app', 'herokuapp.com', 'azurewebsites.net', 'cloudfront.net',
  's3.amazonaws.com', 'amazonaws.com', 'appspot.com', 'web.app', 'firebaseapp.com', 'blogspot.com', 'ngrok.io', 'repl.co', 'glitch.me', 'onrender.com', 'fly.dev',
];
describe('c36 partial list stays refused', () => {
  it('has all 36 entries', () => { expect(C36_PARTIAL_LIST.length).toBe(36); });
  it.each(C36_PARTIAL_LIST.map((h) => [h] as const))('https://%s is refused as public_suffix', (h) => {
    expect(normaliseOrigin('https://' + h)).toEqual({ ok: false, reason: 'public_suffix' });
  });
  it('the deny list is additive: a host the PSL already covers is not duplicated by name only', () => {
    expect(isPublicSuffix('co.uk')).toBe(true);
  });
  it('subdomains of a denied multi-tenant host stay accepted (one exact origin, like any registrable name)', () => {
    expect(normaliseOrigin('https://mybucket.amazonaws.com').ok).toBe(true);
    expect(normaliseOrigin('https://myapp.glitch.me').ok).toBe(true);
  });
});
