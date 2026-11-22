/**
 * Tiny runtime validator toolkit (plain type guards; zod is a server dependency but the contracts must be checked
 * against the shared TypeScript types, so every validator is phantom-typed with the contract type it mirrors: a field
 * that is missing from or extra in a validator, compared with its interface, fails `tsc`).
 */
export type Errs = string[];
export type V<T> = ((v: unknown, path: string, errs: Errs) => void) & { readonly _t?: T };
const mk = <T>(f: (v: unknown, path: string, errs: Errs) => void): V<T> => f as V<T>;

const kind = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

export const str = mk<string>((v, p, e) => { if (typeof v !== 'string') e.push(`${p}: expected string, got ${kind(v)}`); });
export const num = mk<number>((v, p, e) => { if (typeof v !== 'number' || !Number.isFinite(v)) e.push(`${p}: expected finite number, got ${kind(v)}`); });
export const int = mk<number>((v, p, e) => { if (!Number.isInteger(v)) e.push(`${p}: expected integer, got ${kind(v)} ${String(v)}`); });
export const bool = mk<boolean>((v, p, e) => { if (typeof v !== 'boolean') e.push(`${p}: expected boolean, got ${kind(v)}`); });
export const iso = mk<string>((v, p, e) => { if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(v) || Number.isNaN(Date.parse(v))) e.push(`${p}: expected ISO time, got ${String(v)}`); });
export const nul = mk<null>((v, p, e) => { if (v !== null) e.push(`${p}: expected null, got ${kind(v)}`); });
export const unknownV = mk<unknown>(() => {});
export const rec = mk<Record<string, unknown>>((v, p, e) => { if (kind(v) !== 'object') e.push(`${p}: expected object, got ${kind(v)}`); });
export const lit = <T extends string | number | boolean>(...vals: T[]) => mk<T>((v, p, e) => { if (!vals.includes(v as T)) e.push(`${p}: expected one of ${vals.map(String).join('|')}, got ${String(v)}`); });
export const oneOf = <T extends string>(vals: readonly T[]) => lit<T>(...vals);
export const nullable = <T>(inner: V<T>) => mk<T | null>((v, p, e) => { if (v !== null) inner(v, p, e); });
/** Optional key: absent or (never undefined/null in JSON) a valid value. */
export const opt = <T>(inner: V<T>) => mk<T | undefined>((v, p, e) => { if (v !== undefined) inner(v, p, e); });
export const arr = <T>(inner: V<T>) => mk<T[]>((v, p, e) => {
  if (!Array.isArray(v)) { e.push(`${p}: expected array, got ${kind(v)}`); return; }
  v.forEach((x, i) => inner(x, `${p}[${i}]`, e));
});
export const dict = <T>(inner: V<T>) => mk<Record<string, T>>((v, p, e) => {
  if (kind(v) !== 'object') { e.push(`${p}: expected object, got ${kind(v)}`); return; }
  for (const [k, x] of Object.entries(v as object)) inner(x, `${p}.${k}`, e);
});
export const either = <A, B>(a: V<A>, b: V<B>) => mk<A | B>((v, p, e) => {
  const ea: Errs = []; a(v, p, ea);
  if (!ea.length) return;
  const eb: Errs = []; b(v, p, eb);
  if (eb.length) e.push(`${p}: matches no variant (${ea[0]} | ${eb[0]})`);
});

type Shape<T> = { [K in keyof T]-?: V<T[K]> };
/** Closed object: every key of T must validate; unknown keys are drift. Keys whose type includes undefined may be absent. */
export function obj<T>(shape: Shape<T>, opts: { open?: boolean } = {}): V<T> {
  return mk<T>((v, p, e) => {
    if (kind(v) !== 'object') { e.push(`${p}: expected object, got ${kind(v)}`); return; }
    const o = v as Record<string, unknown>;
    for (const [k, f] of Object.entries(shape) as [string, V<unknown>][]) {
      if (!(k in o)) { const probe: Errs = []; f(undefined, '', probe); if (probe.length) e.push(`${p}.${k}: missing`); continue; }
      f(o[k], `${p}.${k}`, e);
    }
    if (!opts.open) for (const k of Object.keys(o)) if (!(k in (shape as object))) e.push(`${p}.${k}: not in the contract`);
  });
}
/** Object whose contract type has an index signature (profile fields): the named keys are checked, the rest is open. */
export const openObj = <T>(shape: Record<string, V<any>>) => obj<T>(shape as Shape<T>, { open: true });

export function check<T>(name: string, v: V<T>, value: unknown): string[] {
  const errs: Errs = [];
  v(value, name, errs);
  return errs;
}
