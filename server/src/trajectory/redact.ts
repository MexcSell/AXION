/**
 * Phase A (A1): redaction of tool arguments BEFORE they are hashed and stored in trajectory_steps. Pure. Nothing here reads a file, a network or a clock.
 *
 * What is removed (each replaced by `[redacted:secret]` or `[redacted:pii]`, and counted):
 *  - by KEY NAME: any value under a key that names a secret (password, token, api key, authorization, cookie, session, credential, signature, ...) or personal data
 *    (email, phone, address, date of birth, card, IBAN, SSN, passport, first / last / full name, ...), whatever the value looks like and however deep it sits;
 *  - by CALLER FLAG: keys the caller names in `piiFields` (a field the caller knows holds personal data, e.g. a free-text note about a person);
 *  - by SHAPE, inside any string: PEM private keys, credentials in a URL, JWTs, Bearer / Basic headers, well-known provider key formats (sk-, ghp_, AKIA, xox, AIza, ...),
 *    `secret=value` assignments, secret-named query parameters, e-mail addresses, card numbers (Luhn), IBANs (mod 97), US social security numbers, international
 *    phone numbers, and a whole value that is one long mixed-case token.
 * LIMITS, stated plainly: this is pattern based. A secret with no known shape in free text, a name or a postal address inside a sentence, or a national phone number without
 * a country code is NOT detected unless the caller flags the field (`piiFields`). It lowers the risk; it does not prove absence.
 * The result is bounded (depth, list length, string length, total size) so a huge or hostile argument cannot fill the table; a bounded value is replaced by a marker, never kept raw.
 */
const SECRET = '[redacted:secret]';
const PII = '[redacted:pii]';
const MAX_DEPTH = 8, MAX_ITEMS = 100, MAX_STR = 2000, MAX_SCAN = 8000, MAX_KEY = 200, MAX_TOTAL = 16_000;

const norm = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const segs = (k: string) => norm(k).split(/[^a-z0-9]+/).filter(Boolean);
const SECRET_SEG = new Set(['password', 'passwd', 'passphrase', 'pass', 'pwd', 'secret', 'secrets', 'token', 'apikey', 'bearer', 'auth', 'authorization', 'cookie', 'cookies', 'csrf', 'xsrf', 'session', 'credential', 'credentials', 'signature', 'jwt', 'otp', 'key']);
const SECRET_COMPACT = /(password|passwd|passphrase|secret|apikey|accesstoken|authtoken|refreshtoken|bearer|authorization|credential|privatekey|accesskey|setcookie)/;
const PII_SEG = new Set(['email', 'mail', 'phone', 'mobile', 'telephone', 'fax', 'ssn', 'dob', 'birthdate', 'birthday', 'birth', 'address', 'street', 'zip', 'postcode', 'iban', 'cvv', 'cvc', 'passport', 'surname']);
const PII_PAIRS = ['first_name', 'last_name', 'full_name', 'given_name', 'family_name', 'card_number', 'credit_card', 'postal_code', 'date_of_birth', 'social_security', 'account_number', 'zip_code'];

export function isSecretKey(k: string): boolean {
  const s = segs(k);
  if (s.some((x) => SECRET_SEG.has(x))) return true;
  if (s.some((x, i) => x === 'api' && s[i + 1] === 'key')) return true;
  return SECRET_COMPACT.test(s.join(''));
}
export function isPiiKey(k: string, flagged: ReadonlySet<string>): boolean {
  const n = norm(k).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (flagged.has(n)) return true;
  const s = segs(k);
  if (s.some((x) => PII_SEG.has(x))) return true;
  return PII_PAIRS.some((p) => n.includes(p));
}

const luhn = (d: string) => { let sum = 0, alt = false; for (let i = d.length - 1; i >= 0; i--) { let n = d.charCodeAt(i) - 48; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; } return sum % 10 === 0; };
const ibanOk = (s: string) => { const r = s.slice(4) + s.slice(0, 4); let rem = 0; for (const ch of r) { const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch; for (const c of v) rem = (rem * 10 + (c.charCodeAt(0) - 48)) % 97; } return rem === 1; };

/** Replace every secret and personal-data shape in one string. `hit` is called once per replacement. */
export function scrubString(input: string, hit: () => void): string {
  let s = input.replace(/\u0000/g, '');
  s = s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD'); // a lone surrogate cannot be stored as JSON text
  const sub = (re: RegExp, fn: (m: string, ...g: string[]) => string | null) => { s = s.replace(re, (m: string, ...g: any[]) => { const r = fn(m, ...(g as string[])); if (r === null) return m; hit(); return r; }); };
  sub(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g, () => SECRET);
  sub(/\b([a-z][a-z0-9+.-]*:\/\/)[^\/\s:@?#]+:[^\/\s@?#]+@/gi, (_m, scheme) => `${scheme}${SECRET}@`);
  sub(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, () => SECRET);
  sub(/\bBearer\s+[A-Za-z0-9._~+\/=-]{8,}/gi, () => `Bearer ${SECRET}`);
  sub(/\bBasic\s+([A-Za-z0-9+\/]{8,}={0,2})/g, (m, v) => (/[0-9=]/.test(v) ? `Basic ${SECRET}` : null));
  for (const re of [/\bsk-[A-Za-z0-9_-]{20,}/g, /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, /\bgithub_pat_[A-Za-z0-9_]{20,}/g, /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
    /\bAIza[0-9A-Za-z_-]{30,}/g, /\bglpat-[A-Za-z0-9_-]{16,}/g, /\bnpm_[A-Za-z0-9]{30,}/g, /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, /\bhf_[A-Za-z0-9]{30,}/g, /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/g]) sub(re, () => SECRET);
  // query parameters and form fields whose NAME says secret (the name is judged by the same rule as an object key)
  sub(/([?&;])([^=&#\s]+)=([^&#\s]*)/g, (m, sep, name, val) => (isSecretKey(name) && !val.startsWith('[redacted') ? `${sep}${name}=${SECRET}` : null));
  // `name=value` or `name: value` in free text, where the name says secret
  sub(/\b([A-Za-z0-9_.-]*(?:pass(?:word|wd|phrase)?|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|authorization)[A-Za-z0-9_.-]*)\s*[:=]\s*(?!\[redacted)("[^"]*"|'[^']*'|[^\s"']+)/gi, (_m, name) => `${name}=${SECRET}`);
  sub(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, () => PII);
  sub(/\b(?:\d[ -]?){12,18}\d\b/g, (m) => { const d = m.replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 && luhn(d) ? PII : null; });
  sub(/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, (m) => (ibanOk(m) ? PII : null));
  sub(/\b\d{3}-\d{2}-\d{4}\b/g, () => PII);
  sub(/(?<![\w+])\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}(?!\w)/g, () => PII);
  // a whole value that is one long token with all three of lower case, upper case and digits (pure hex, such as a sha256, is left alone)
  const t = s.trim();
  if (t.length >= 32 && /^[A-Za-z0-9_\-+\/=]+$/.test(t) && /[a-z]/.test(t) && /[A-Z]/.test(t) && /\d/.test(t)) { hit(); return SECRET; }
  return s;
}

export interface RedactOptions { /** keys the caller knows hold personal data (matched case-insensitively, camelCase or snake_case) */ piiFields?: readonly string[] }
export interface Redacted { value: unknown; count: number }

export function redactArgs(input: unknown, opts: RedactOptions = {}): Redacted {
  let count = 0;
  const hit = () => { count++; };
  const flagged = new Set((opts.piiFields ?? []).map((k) => norm(k).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')));
  const walk = (v: unknown, depth: number): unknown => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') {
      // only the first MAX_SCAN characters are scanned (the patterns are not linear on hostile input) and only MAX_STR are kept, so nothing past the scan is ever stored
      const r = scrubString(v.length > MAX_SCAN ? v.slice(0, MAX_SCAN) : v, hit);
      const more = v.length - Math.min(v.length, MAX_STR);
      return r.length > MAX_STR || v.length > MAX_STR ? `${r.slice(0, MAX_STR)}[truncated:+${more} chars]` : r;
    }
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'bigint') return v.toString();
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
    if (typeof v !== 'object') return null; // functions and symbols are not data
    if (depth >= MAX_DEPTH) return '[truncated:depth]';
    if (Array.isArray(v)) {
      const out = v.slice(0, MAX_ITEMS).map((x) => walk(x, depth + 1));
      if (v.length > MAX_ITEMS) out.push(`[truncated:+${v.length - MAX_ITEMS} items]`);
      return out;
    }
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [rawKey, val] of Object.entries(v as Record<string, unknown>)) {
      if (n++ >= MAX_ITEMS) { out['[truncated]'] = `+${Object.keys(v as object).length - MAX_ITEMS} keys`; break; }
      const key = scrubString(rawKey.slice(0, MAX_KEY * 4), hit).slice(0, MAX_KEY);
      if (val === undefined) continue;
      if (isSecretKey(rawKey)) { out[key] = SECRET; hit(); }
      else if (isPiiKey(rawKey, flagged)) { out[key] = PII; hit(); }
      else out[key] = walk(val, depth + 1);
    }
    return out;
  };
  let value = walk(input, 0);
  const bytes = JSON.stringify(value)?.length ?? 0;
  if (bytes > MAX_TOTAL) value = { '[truncated]': `arguments were ${bytes} characters; only this marker is kept` };
  return { value, count };
}
