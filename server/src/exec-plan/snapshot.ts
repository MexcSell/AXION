// Snapshot discipline (c94 review: accessor TOCTOU). Every input is read ONCE into a frozen, null-prototype copy; all later work uses the
// copy. Getters, Proxies, toJSON, symbol keys, array holes, Array/object subclasses, String objects, BigInt, NaN and Infinity are refused.
import { types } from 'node:util';
import { EXEC_PLAN_LIMITS as L } from '../../../shared/contracts/src/exec-plan.ts';

export class SnapshotError extends Error {}
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype', 'toJSON']);
const MAX_KEYS = 64;
const MAX_STRING = 8192;

function walk(x: unknown, depth: number, budget: { n: number }): unknown {
  if (++budget.n > L.maxNodes) throw new SnapshotError('too_large');
  if (x === null || typeof x === 'boolean') return x;
  if (typeof x === 'string') { if (x.length > MAX_STRING) throw new SnapshotError('string_too_long'); return x; }
  if (typeof x === 'number') { if (!Number.isFinite(x)) throw new SnapshotError('not_finite'); return x; }
  if (typeof x !== 'object') throw new SnapshotError('bad_type');
  if (depth > L.maxDepth) throw new SnapshotError('too_deep');
  if (types.isProxy(x)) throw new SnapshotError('proxy');
  if (Array.isArray(x)) {
    if (Object.getPrototypeOf(x) !== Array.prototype) throw new SnapshotError('array_subclass');
    const keys = Reflect.ownKeys(x);
    const lenDesc = Object.getOwnPropertyDescriptor(x, 'length');
    if (!lenDesc || typeof lenDesc.value !== 'number') throw new SnapshotError('bad_array');
    const len = lenDesc.value;
    if (len > 1024 || keys.length !== len + 1) throw new SnapshotError('bad_array');
    const out: unknown[] = [];
    for (let i = 0; i < len; i++) {
      const d = Object.getOwnPropertyDescriptor(x, String(i));
      if (!d || !('value' in d) || d.get || d.set) throw new SnapshotError('accessor_or_hole');
      out.push(walk(d.value, depth + 1, budget));
    }
    return Object.freeze(out);
  }
  const proto = Object.getPrototypeOf(x);
  if (proto !== Object.prototype && proto !== null) throw new SnapshotError('not_plain');
  const keys = Reflect.ownKeys(x);
  if (keys.length > MAX_KEYS) throw new SnapshotError('too_many_keys');
  const out: Record<string, unknown> = Object.create(null);
  for (const k of keys) {
    if (typeof k !== 'string') throw new SnapshotError('symbol_key');
    if (FORBIDDEN_KEYS.has(k)) throw new SnapshotError('forbidden_key');
    const d = Object.getOwnPropertyDescriptor(x, k);
    if (!d || !('value' in d) || d.get || d.set || !d.enumerable) throw new SnapshotError('accessor');
    out[k] = walk(d.value, depth + 1, budget);
  }
  return Object.freeze(out);
}

/** Read `input` once. Returns the frozen copy, or throws SnapshotError. */
export function snapshot(input: unknown): unknown { return walk(input, 0, { n: 0 }); }
export function trySnapshot(input: unknown): { ok: true; value: unknown } | { ok: false; reason: string } {
  try { return { ok: true, value: snapshot(input) }; } catch (e) { return { ok: false, reason: e instanceof SnapshotError ? e.message : 'snapshot_failed' }; }
}
