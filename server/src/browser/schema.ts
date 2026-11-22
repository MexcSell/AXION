// Strict zod schemas for the browser action contract (spec §10.7). Pure: no I/O, no browser, no network.
// A closed schema: unknown keys, unknown `type`, raw JS/CDP/shell/SQL fields and over-long values are all rejected.
// The shared types live in shared/contracts/src/browser.ts (zod is a server dependency, so the validator lives here).
import { z } from 'zod';
import { BROWSER_LIMITS as LIM } from '../../../shared/contracts/src/browser.ts';
import { normaliseOrigin, type OriginResult } from '../grants/origin.ts';

// C0/C1 controls, zero-width, bidi controls, line/paragraph separators, BOM: never legitimate in a name, label or value.
const HIDDEN = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/;
const HIDDEN_EXCEPT_NEWLINE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/;
const CSS_ALLOWED = /^[A-Za-z0-9 _\-.#[\]="':>+~*,()^$|]+$/;
const CSS_BANNED = [':has(', 'javascript:', 'expression(', 'url(', '@import'];
const BAD_VALUE_SCHEMES = ['javascript:', 'data:', 'vbscript:', 'file:', 'blob:'];
/** Keys that carry code or protocol calls. Reported by name even though `.strict()` would reject them anyway. */
export const FORBIDDEN_KEYS = ['evaluate', 'eval', 'script', 'cdp', 'expression', 'js', 'javascript', 'code', 'shell', 'sql', 'exec', 'cmd', 'command', 'headers', 'cookie', 'cookies'] as const;

/** Split a url into its origin part (validated by the c36 normaliser) and the rest. Never throws. */
export function originOfUrl(url: unknown): OriginResult {
  if (typeof url !== 'string') return { ok: false, reason: 'not_string' };
  const m = /^(https):\/\/([^/?#]*)/i.exec(url);
  if (!m) return { ok: false, reason: 'scheme_required' };
  return normaliseOrigin(`https://${m[2]}`);
}

const text = (max: number, what: string) => z.string().min(1).max(max).refine((s) => !HIDDEN.test(s), `${what} has control, zero-width or bidi characters`);

const urlSchema = z.string().min(1).max(LIM.urlMax).superRefine((u, ctx) => {
  if (/[\s\\]/.test(u) || HIDDEN.test(u)) { ctx.addIssue({ code: 'custom', message: 'url has whitespace, backslash or control characters' }); return; }
  const o = originOfUrl(u);
  if (!o.ok) { ctx.addIssue({ code: 'custom', message: `url origin refused (${o.reason})` }); return; }
  const rest = (/^https:\/\/[^/?#]*(.*)$/is.exec(u) ?? [])[1] ?? '';
  if (rest.length > LIM.pathQueryMax) ctx.addIssue({ code: 'custom', message: 'url path and query are too long' });
});

const locator = z.discriminatedUnion('by', [
  z.strictObject({ by: z.literal('role'), role: z.string().regex(/^[a-z]{2,30}$/, 'role must be a lower-case ARIA role name'), name: text(LIM.nameMax, 'name'), exact: z.boolean().optional() }),
  z.strictObject({ by: z.literal('label'), label: text(LIM.nameMax, 'label'), exact: z.boolean().optional() }),
  z.strictObject({ by: z.literal('testId'), testId: z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/, 'testId has characters outside A-Z a-z 0-9 _ . : -') }),
  z.strictObject({
    by: z.literal('css'),
    selector: z.string().min(1).max(LIM.cssMax).superRefine((s, ctx) => {
      if (!CSS_ALLOWED.test(s)) ctx.addIssue({ code: 'custom', message: 'css selector uses characters outside the allowed set' });
      const flat = s.toLowerCase().replace(/\s+/g, '');
      for (const b of CSS_BANNED) if (flat.includes(b)) ctx.addIssue({ code: 'custom', message: `css selector contains ${b}` });
    }),
  }),
]);

const valueRef = z.string().regex(/^(?:val|sec)_[A-Za-z0-9]{6,64}$/, 'valueRef must be a reference id (val_ or sec_ prefix), never a raw value');
const selectValue = z.string().min(1).max(LIM.valueMax).superRefine((v, ctx) => {
  if (HIDDEN.test(v)) ctx.addIssue({ code: 'custom', message: 'value has control, zero-width or bidi characters' });
  const flat = v.replace(/\s+/g, '').toLowerCase();
  if (BAD_VALUE_SCHEMES.some((s) => flat.startsWith(s))) ctx.addIssue({ code: 'custom', message: 'value starts with a code or data scheme' });
});

export const browserActionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('navigate'), url: urlSchema }),
  z.strictObject({ type: z.literal('observe') }),
  z.strictObject({ type: z.literal('click'), target: locator }),
  z.strictObject({ type: z.literal('fill'), target: locator, valueRef }),
  z.strictObject({ type: z.literal('select'), target: locator, value: selectValue }),
  z.strictObject({ type: z.literal('scroll'), direction: z.enum(['up', 'down']), pixels: z.number().int().min(1).max(LIM.pixelsMax) }),
  z.strictObject({ type: z.literal('waitFor'), target: locator, timeoutMs: z.number().int().min(1).max(LIM.timeoutMsMax) }),
  z.strictObject({ type: z.literal('screenshot') }),
  z.strictObject({ type: z.literal('download'), target: locator }),
  z.strictObject({ type: z.literal('finish'), summary: z.string().min(1).max(LIM.summaryMax).refine((s) => !HIDDEN_EXCEPT_NEWLINE.test(s), 'summary has control, zero-width or bidi characters') }),
]);
export type ParsedBrowserAction = z.infer<typeof browserActionSchema>;

/** Names of forbidden code-carrying keys found anywhere in the first two object levels. */
export function forbiddenKeysIn(raw: unknown): string[] {
  const found: string[] = [];
  const walk = (v: unknown, depth: number) => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || depth > 2) return;
    for (const k of Object.keys(v as object)) {
      if ((FORBIDDEN_KEYS as readonly string[]).includes(k.toLowerCase())) found.push(k);
      walk((v as Record<string, unknown>)[k], depth + 1);
    }
  };
  walk(raw, 0);
  return found;
}
