// Plan validation and canonical sha256. Pure. The input is snapshotted once; the returned plan is the frozen snapshot.
import { createHash } from 'node:crypto';
import { canonicalPlanJson, EXEC_PLAN_LIMITS as L, type ArgConstraint, type ExecPlan, type PlanCall } from '../../../shared/contracts/src/exec-plan.ts';
import { normaliseOrigin } from '../grants/origin.ts';
import { trySnapshot } from './snapshot.ts';

export type PlanResult = { ok: true; plan: ExecPlan; sha256: string } | { ok: false; reasons: string[] };
type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
/** Linear character-class check; no regex. */
export function nameOk(s: unknown, max: number, extra = ''): s is string {
  if (typeof s !== 'string' || s.length === 0 || s.length > max) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ok = (c >= 48 && c <= 57) || (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95 || c === 45 || extra.includes(s[i]);
    if (!ok) return false;
  }
  return true;
}
export const toolNameOk = (s: unknown): s is string => nameOk(s, L.maxToolName, '.');
const idOk = (s: unknown): s is string => nameOk(s, L.maxId);
const argNameOk = (s: unknown): s is string => nameOk(s, 64, '.');
export const originOk = (s: unknown): s is string => { if (typeof s !== 'string') return false; const r = normaliseOrigin(s); return r.ok && r.origin === s; };
const scalar = (v: unknown): v is string | number | boolean => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
const keysOnly = (o: Obj, allowed: string[]): boolean => Object.keys(o).every((k) => allowed.includes(k));

function constraintErrors(c: unknown, where: string): string[] {
  if (!isObj(c)) return [`${where}: constraint must be an object`];
  const e: string[] = [];
  if (c.optional !== undefined && typeof c.optional !== 'boolean') e.push(`${where}: optional must be boolean`);
  const strOk = (v: unknown) => typeof v === 'string' && v.length <= L.maxString;
  switch (c.kind) {
    case 'exact': if (!keysOnly(c, ['kind', 'value', 'optional'])) e.push(`${where}: unknown field`); if (!('value' in c) || !(c.value === null || scalar(c.value)) || (typeof c.value === 'string' && !strOk(c.value))) e.push(`${where}: exact value invalid`); break;
    case 'oneOf': case 'subsetOf': {
      if (!keysOnly(c, ['kind', 'values', 'optional', 'maxItems'])) e.push(`${where}: unknown field`);
      if (c.kind === 'oneOf' && 'maxItems' in c) e.push(`${where}: maxItems only on subsetOf`);
      if (!Array.isArray(c.values) || c.values.length === 0 || c.values.length > L.maxValues || !c.values.every((v) => scalar(v) && (typeof v !== 'string' || strOk(v)))) e.push(`${where}: values invalid`);
      else if (new Set(c.values.map((v) => typeof v + ':' + String(v))).size !== c.values.length) e.push(`${where}: duplicate values`);
      if (c.maxItems !== undefined && !(Number.isInteger(c.maxItems) && (c.maxItems as number) >= 0 && (c.maxItems as number) <= L.maxList)) e.push(`${where}: maxItems invalid`);
      break;
    }
    case 'text': if (!keysOnly(c, ['kind', 'op', 'value', 'optional'])) e.push(`${where}: unknown field`); if (c.op !== 'prefix' && c.op !== 'suffix' && c.op !== 'contains') e.push(`${where}: op invalid`); if (!strOk(c.value) || (c.value as string).length === 0) e.push(`${where}: text value invalid`); break;
    case 'range': {
      if (!keysOnly(c, ['kind', 'min', 'max', 'optional'])) e.push(`${where}: unknown field`);
      const lo = c.min, hi = c.max;
      if (lo === undefined && hi === undefined) e.push(`${where}: range needs min or max`);
      if ((lo !== undefined && !(typeof lo === 'number' && Number.isFinite(lo))) || (hi !== undefined && !(typeof hi === 'number' && Number.isFinite(hi)))) e.push(`${where}: bounds must be finite numbers`);
      else if (typeof lo === 'number' && typeof hi === 'number' && lo > hi) e.push(`${where}: min above max`);
      break;
    }
    default: e.push(`${where}: unknown constraint kind`);
  }
  return e;
}

export function validatePlan(input: unknown): PlanResult {
  const s = trySnapshot(input);
  if (!s.ok) return { ok: false, reasons: ['snapshot_refused: ' + s.reason] };
  const p = s.value;
  const e: string[] = [];
  if (!isObj(p) || !keysOnly(p, ['v', 'calls', 'forbiddenTools', 'grants'])) return { ok: false, reasons: ['plan must be a closed object'] };
  if (p.v !== 1) e.push('v must be 1');
  if (!Array.isArray(p.grants) || p.grants.length > L.maxGrants || !p.grants.every(originOk) || new Set(p.grants).size !== p.grants.length) e.push('grants must be unique normalised origins');
  if (!Array.isArray(p.forbiddenTools) || p.forbiddenTools.length > L.maxForbidden || !p.forbiddenTools.every(toolNameOk)) e.push('forbiddenTools invalid');
  if (!Array.isArray(p.calls) || p.calls.length === 0 || p.calls.length > L.maxCalls) e.push('calls must hold 1..' + L.maxCalls + ' entries');
  if (e.length === 0) {
    const ids = new Set<string>();
    const grants = p.grants as string[], forbidden = new Set(p.forbiddenTools as string[]);
    for (const [i, c] of (p.calls as unknown[]).entries()) {
      const w = `calls[${i}]`;
      if (!isObj(c) || !keysOnly(c, ['id', 'tool', 'args', 'origins', 'after', 'max'])) { e.push(`${w}: closed object required`); continue; }
      if (!idOk(c.id) || ids.has(c.id)) e.push(`${w}: id invalid or duplicate`);
      if (!toolNameOk(c.tool)) e.push(`${w}: tool invalid`); else if (forbidden.has(c.tool)) e.push(`${w}: tool is also forbidden`);
      if (!isObj(c.args) || Object.keys(c.args).length > L.maxArgs) e.push(`${w}: args invalid`);
      else for (const [k, v] of Object.entries(c.args)) { if (!argNameOk(k)) e.push(`${w}.args: bad name`); e.push(...constraintErrors(v, `${w}.args.${k.slice(0, 20)}`)); }
      if (!Array.isArray(c.origins) || c.origins.length > L.maxOrigins || !c.origins.every((o) => typeof o === 'string' && grants.includes(o)) || new Set(c.origins).size !== c.origins.length) e.push(`${w}: origins must be unique members of grants`);
      if (c.after !== undefined && (!Array.isArray(c.after) || c.after.length > L.maxCalls || !c.after.every((a) => typeof a === 'string' && ids.has(a)))) e.push(`${w}: after must name earlier calls`);
      if (c.max !== undefined && !(Number.isInteger(c.max) && (c.max as number) >= 1 && (c.max as number) <= L.maxMax)) e.push(`${w}: max invalid`);
      if (typeof c.id === 'string') ids.add(c.id);
    }
  }
  if (e.length) return { ok: false, reasons: e.slice(0, 20) };
  const plan = p as unknown as ExecPlan;
  return { ok: true, plan, sha256: planSha256(plan) };
}

/** sha256 of the canonical JSON. Order of calls is part of the plan, so it is part of the hash. */
export function planSha256(plan: ExecPlan): string { return createHash('sha256').update(canonicalPlanJson(plan)).digest('hex'); }
export type { ArgConstraint, PlanCall };
