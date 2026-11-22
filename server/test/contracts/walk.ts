import { check, type V } from './validate.ts';

/** Strip opt()/nullable() wrappers and pick the union branch that accepts `x`; undefined when none does. */
export function resolve(v: V<any>, x: unknown): V<any> | undefined {
  let cur: V<any> | undefined = v;
  for (let i = 0; cur && i < 20; i++) {
    const m: NonNullable<V<any>['meta']> = cur.meta ?? {};
    if (m.inner) { cur = m.inner; continue; }
    if (m.alts) { cur = m.alts.find((a) => !check('', a, x).length); continue; }
    return cur;
  }
  return cur;
}

export interface Visit { v: V<any>; node: V<any> | undefined; x: unknown; ptr: (string | number)[]; path: string }
/** Walk a body together with its validator tree. Arrays contribute `[]` to the path; `first` limits the walk to the first elements (mutation), otherwise every element is visited. */
export function walk(v: V<any>, x: unknown, visit: (n: Visit) => void, first = 0, ptr: (string | number)[] = [], path = ''): void {
  const node = x === null || x === undefined ? undefined : resolve(v, x);
  visit({ v, node, x, ptr, path });
  if (!node || x === null || typeof x !== 'object') return;
  const m = node.meta ?? {};
  if (m.item && Array.isArray(x)) (first ? x.slice(0, first) : x).forEach((e, i) => walk(m.item!, e, visit, first, [...ptr, i], path + '[]'));
  else if (m.dictItem) for (const [k, e] of Object.entries(x)) walk(m.dictItem, e, visit, first, [...ptr, k], path + '.*');
  else if (m.shape) for (const [k, kv] of Object.entries(m.shape)) if (k in (x as object)) walk(kv, (x as any)[k], visit, first, [...ptr, k], path + '.' + k);
}

const at = (root: any, ptr: (string | number)[]) => ptr.reduce((o, k) => o[k], root);
const accepts = (v: V<any>, x: unknown) => !check('', v, x).length;

/**
 * Mutate every object node of a real body: add an extra key, drop each key, set each key to null. Returns the mutations the
 * validator accepted although the contract says it must not: an extra key on a closed object, a dropped key whose validator
 * does not accept absence, a null on a validator that does not accept null.
 */
export function lenientMutations(root: V<any>, body: unknown, label: string, first = 3): { lenient: string[]; tried: number } {
  const lenient: string[] = [];
  let tried = 0;
  walk(root, body, ({ node, x, ptr, path }) => {
    if (!node?.meta?.shape || Array.isArray(x) || typeof x !== 'object' || x === null) return;
    const shape = node.meta.shape;
    const run = (what: string, mutate: (o: any) => void) => {
      const copy = structuredClone(body) as any;
      const target = ptr.length ? at(copy, ptr) : copy;
      mutate(target);
      tried++;
      if (accepts(root, copy)) lenient.push(`${label}${path} ${what}`);
    };
    if (!node.meta.open) run('accepts an extra key', (o) => { o.zzExtra = 1; });
    for (const [k, kv] of Object.entries(shape)) {
      if (!(k in (x as object))) continue;
      if (!accepts(kv, undefined)) run(`accepts "${k}" missing`, (o) => { delete o[k]; });
      if ((x as any)[k] !== null && !accepts(kv, null)) run(`accepts "${k}" = null`, (o) => { o[k] = null; });
    }
  }, first);
  return { lenient, tried };
}

/** What a set of bodies never exercised: object arrays that were always empty, nullable fields that were never non-null. */
export function unexercised(root: V<any>, bodies: unknown[]): string[] {
  const arrays = new Map<string, boolean>(), nullables = new Map<string, { nul: boolean; non: boolean }>();
  for (const b of bodies) {
    walk(root, b, ({ v, node, x, path }) => {
      if (v.meta?.wrap === 'nullable') { const s = nullables.get(path) ?? { nul: false, non: false }; if (x === null) s.nul = true; else s.non = true; nullables.set(path, s); }
      const m = node?.meta;
      if (m?.item && Array.isArray(x) && (resolve(m.item, {}) === undefined || m.item.meta?.shape || m.item.meta?.alts || resolve(m.item, {})?.meta?.shape)) arrays.set(path, (arrays.get(path) ?? false) || x.length > 0);
    });
  }
  return [
    ...[...arrays].filter(([, seen]) => !seen).map(([p]) => `${p}[] never non-empty`),
    ...[...nullables].filter(([, s]) => s.nul && !s.non).map(([p]) => `${p} never non-null`),
  ];
}
