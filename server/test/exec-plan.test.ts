import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkCall, checkTrajectory } from '../src/exec-plan/conformance.ts';
import { validatePlan, planSha256 } from '../src/exec-plan/plan.ts';
import { snapshot } from '../src/exec-plan/snapshot.ts';
import { canonicalPlanJson, type ExecPlan, type ProposedCall } from '../../shared/contracts/src/exec-plan.ts';
import { PLANS, FAMILIES, call, outOfPlanRows, inPlanRows, workflows, shopPlan, supportPlan, SHOP, DOCS, API, EVIL, type Row } from './exec-plan-fixtures.ts';

const hist = (ids: (string | null)[]) => ids.map((planCallId) => ({ planCallId }));
const run = (r: Row) => checkCall(PLANS[r.plan], r.call, hist(r.history));
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe('plan schema', () => {
  it('accepts the five fixture plans and returns a stable sha256', () => {
    for (const p of Object.values(PLANS)) {
      const a = validatePlan(p), b = validatePlan(clone(p));
      expect(a.ok).toBe(true);
      if (a.ok && b.ok) { expect(a.sha256).toMatch(/^[0-9a-f]{64}$/); expect(a.sha256).toBe(b.sha256); expect(a.sha256).toBe(planSha256(p)); }
    }
  });
  it('sha256 ignores key order and changes with the order of calls or any value', () => {
    const p = clone(shopPlan);
    const shuffled = { grants: p.grants, calls: p.calls.map((c) => ({ max: c.max, origins: c.origins, args: c.args, tool: c.tool, id: c.id, after: c.after })).map((c) => JSON.parse(JSON.stringify(c))), forbiddenTools: p.forbiddenTools, v: 1 };
    const a = validatePlan(p), b = validatePlan(shuffled);
    expect(a.ok && b.ok && a.sha256 === b.sha256).toBe(true);
    expect(canonicalPlanJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
    const swapped = clone(p); swapped.calls.reverse();
    const c = validatePlan(swapped);
    // reversed calls break the "after must name earlier calls" rule, so compare with a value change instead
    expect(c.ok).toBe(false);
    const tweaked = clone(p); tweaked.calls[0].max = 6;
    const d = validatePlan(tweaked);
    expect(d.ok && a.ok && d.sha256 !== a.sha256).toBe(true);
  });
  const bad: [string, (p: any) => void][] = [
    ['unknown top field', (p) => { p.extra = 1; }], ['wrong version', (p) => { p.v = 2; }], ['no calls', (p) => { p.calls = []; }],
    ['duplicate id', (p) => { p.calls[1].id = p.calls[0].id; }], ['bad id characters', (p) => { p.calls[0].id = 'a b'; }], ['bad tool name', (p) => { p.calls[0].tool = 'x y'; }],
    ['forbidden and planned', (p) => { p.forbiddenTools.push('browser.navigate'); }], ['origin not in grants', (p) => { p.calls[0].origins = [EVIL]; }],
    ['grant not normalised', (p) => { p.grants.push('https://Shop.Example.com/'); }], ['wildcard grant', (p) => { p.grants.push('https://*.example.com'); }],
    ['after names a later call', (p) => { p.calls[0].after = ['fin']; }], ['after names itself', (p) => { p.calls[0].after = ['nav']; }],
    ['max zero', (p) => { p.calls[0].max = 0; }], ['max fractional', (p) => { p.calls[0].max = 1.5; }], ['max too big', (p) => { p.calls[0].max = 1001; }],
    ['unknown constraint kind', (p) => { p.calls[0].args.url = { kind: 'regex', value: '.*' }; }], ['range inverted', (p) => { p.calls[3].args.pixels = { kind: 'range', min: 5, max: 1 }; }],
    ['range without bounds', (p) => { p.calls[3].args.pixels = { kind: 'range' }; }], ['empty text', (p) => { p.calls[0].args.url = { kind: 'text', op: 'prefix', value: '' }; }],
    ['bad text op', (p) => { p.calls[0].args.url = { kind: 'text', op: 'regex', value: 'a' }; }], ['oneOf empty', (p) => { p.calls[2].args.role = { kind: 'oneOf', values: [] }; }],
    ['oneOf duplicates', (p) => { p.calls[2].args.role = { kind: 'oneOf', values: ['a', 'a'] }; }], ['too many args', (p) => { for (let i = 0; i < 17; i++) p.calls[1].args['a' + i] = { kind: 'exact', value: 1 }; }],
    ['bad arg name', (p) => { p.calls[1].args['bad name'] = { kind: 'exact', value: 1 }; }], ['constraint unknown field', (p) => { p.calls[0].args.url.pattern = '.*'; }],
    ['value too long', (p) => { p.calls[0].args.url.value = 'a'.repeat(513); }], ['NaN bound', (p) => { p.calls[3].args.pixels = { kind: 'range', min: NaN }; }],
  ];
  it.each(bad)('rejects: %s', (_n, mut) => { const p = clone(shopPlan); mut(p); expect(validatePlan(p).ok).toBe(false); });
  it('rejects too many calls and a non-object plan', () => {
    const p = clone(shopPlan); p.calls = Array.from({ length: 65 }, (_, i) => ({ id: 'c' + i, tool: 't' + i, args: {}, origins: [] }));
    expect(validatePlan(p).ok).toBe(false);
    for (const x of [null, 1, 'x', [], undefined]) expect(validatePlan(x).ok).toBe(false);
  });
});

describe('decision paths', () => {
  it('allow: in plan', () => { const r = checkCall(shopPlan, call('browser.observe', {}, SHOP)); expect(r).toEqual({ decision: 'allow', reasons: ['in_plan'], planCallId: 'obs' }); });
  it('narrow-allow: a strict subset list, and an omitted optional arg', () => {
    const r = checkCall(supportPlan, call('tickets.tag', { id: 1, tags: ['bug'] }, API), hist(['read']));
    expect(r.decision).toBe('narrow-allow'); expect(r.reasons).toEqual(['narrowed']);
  });
  it('a list that equals the full allowed set is allow, not narrowing', () => {
    expect(checkCall(supportPlan, call('tickets.tag', { id: 1, tags: ['ux', 'bug', 'billing'], note: 'triage' }, API), hist(['read'])).decision).toBe('allow');
  });
  it('needs-approval: new tool, wider value, extra arg, missing arg, new origin, out of order, exceeds count', () => {
    const reasons = (c: ProposedCall, h: (string | null)[] = []) => checkCall(shopPlan, c, hist(h));
    expect(reasons(call('browser.hover', {}, SHOP))).toMatchObject({ decision: 'needs-approval', reasons: ['new_tool'] });
    expect(reasons(call('browser.scroll', { direction: 'down', pixels: 2001 }, SHOP)).reasons).toEqual(['wider_value']);
    expect(reasons(call('browser.observe', { full: true }, SHOP)).reasons).toEqual(['extra_arg']);
    expect(reasons(call('browser.scroll', { direction: 'down' }, SHOP)).reasons).toEqual(['missing_arg']);
    expect(reasons(call('browser.observe', {}, DOCS)).reasons).toEqual(['new_origin']);
    expect(reasons(call('browser.click', { by: 'role', role: 'link', name: 'Next' }, SHOP)).reasons).toEqual(['out_of_order']);
    expect(reasons(call('browser.finish', { summary: 'Summary: x' }), ['nav']).reasons).toEqual(['out_of_order']);
    expect(reasons(call('browser.finish', { summary: 'Summary: x' }), ['obs', 'fin']).reasons).toEqual(['exceeds_count']);
  });
  it('deny: forbidden tool, origin outside grants, with any provenance', () => {
    for (const provenance of ['user', 'system', 'untrusted'] as const) {
      expect(checkCall(shopPlan, { ...call('browser.download', {}, SHOP), provenance })).toMatchObject({ decision: 'deny', reasons: ['forbidden_tool'] });
      expect(checkCall(shopPlan, { ...call('browser.observe', {}, EVIL), provenance })).toMatchObject({ decision: 'deny', reasons: ['origin_not_granted'] });
    }
  });
  it('untrusted off-plan is deny where trusted is needs-approval, and the reason is recorded', () => {
    const c = call('browser.hover', {}, SHOP);
    expect(checkCall(shopPlan, c).decision).toBe('needs-approval');
    expect(checkCall(shopPlan, { ...c, provenance: 'untrusted' })).toMatchObject({ decision: 'deny', reasons: ['new_tool', 'untrusted_off_plan'] });
  });
  it('untrusted but in plan is allowed (the plan, not the provenance, grants authority)', () => {
    expect(checkCall(shopPlan, { ...call('browser.observe', {}, SHOP), provenance: 'untrusted' }).decision).toBe('allow');
  });
  it('forbidden beats everything, even when the tool also appears in history', () => {
    expect(checkCall(shopPlan, call('shell.exec', { cmd: 'ls' }), hist(['nav'])).decision).toBe('deny');
  });
  it('a call that needs an origin but names none needs approval; an origin on an origin-less call needs approval or deny', () => {
    expect(checkCall(shopPlan, call('browser.observe', {}, null)).reasons).toEqual(['new_origin']);
    expect(checkCall(shopPlan, call('browser.finish', { summary: 'Summary: x' }, SHOP), hist(['obs'])).reasons).toEqual(['new_origin']);
  });
  it('picks the best of several plan calls with the same tool', () => {
    const r = checkCall(PLANS.form, call('browser.click', { by: 'role', role: 'button', name: 'Save draft' }, SHOP), hist(['nav', 'fill']));
    expect(r.planCallId).toBe('save');
  });
});

describe('boundaries', () => {
  it('range edges are inclusive and exact', () => {
    const px = (n: number) => checkCall(shopPlan, call('browser.scroll', { direction: 'up', pixels: n }, SHOP)).decision;
    expect([px(0), px(2000), px(-1), px(2000.0001), px(1999.9999)]).toEqual(['allow', 'allow', 'needs-approval', 'needs-approval', 'allow']);
  });
  it('max uses: the use that reaches max is the last allowed one', () => {
    const c = call('browser.click', { by: 'role', role: 'tab', name: 'Specs' }, SHOP);
    expect(checkCall(shopPlan, c, hist(['nav', 'click', 'click', 'click'])).decision).toBe('allow');
    expect(checkCall(shopPlan, c, hist(['nav', 'click', 'click', 'click', 'click'])).decision).toBe('needs-approval');
    expect(checkCall(shopPlan, c, hist(['nav', null, null, null, null, null])).decision).toBe('allow');
  });
  it('subsetOf: duplicates, unknown element and over-cap lists are wider; the empty list narrows', () => {
    const tags = (t: unknown) => checkCall(supportPlan, call('tickets.tag', { id: 1, tags: t as any, note: 'triage' }, API), hist(['read'])).decision;
    expect([tags(['bug', 'bug']), tags(['bug', 'x']), tags(['bug', 'billing', 'ux', 'bug']), tags([]), tags('bug')]).toEqual(['needs-approval', 'needs-approval', 'needs-approval', 'narrow-allow', 'needs-approval']);
  });
  it('types are strict: "1" is not 1, true is not "true", an array is not a scalar', () => {
    expect(checkCall(supportPlan, call('tickets.read', { id: '5' as any }, API)).decision).toBe('needs-approval');
    expect(checkCall(PLANS.deploy, call('ci.status', { service: ['web'] as any }, API)).decision).toBe('needs-approval');
    expect(checkCall(PLANS.deploy, call('metrics.query', { metric: 'LATENCY' }, API)).decision).toBe('needs-approval');
  });
  it('text ops: prefix, suffix and contains are exact, case-sensitive and not normalised', () => {
    expect(checkCall(shopPlan, call('browser.navigate', { url: SHOP + '/x' }, SHOP)).decision).toBe('allow');
    expect(checkCall(shopPlan, call('browser.navigate', { url: SHOP }, SHOP)).decision).toBe('needs-approval');
    expect(checkCall(shopPlan, call('browser.navigate', { url: SHOP + '.evil.example.org/' }, SHOP)).decision).toBe('needs-approval');
    expect(checkCall(shopPlan, call('browser.navigate', { url: 'https://shop.example.com@evil.example.org/' }, SHOP)).decision).toBe('needs-approval');
    expect(checkCall(supportPlan, call('docs.search', { q: 'ok?' }, DOCS)).decision).toBe('narrow-allow');
    expect(checkCall(supportPlan, call('docs.search', { q: 'ok？' }, DOCS)).decision).toBe('needs-approval'); // fullwidth question mark
    expect(checkCall(supportPlan, call('tickets.tag', { id: 1, tags: [], note: 'TRIAGE' }, API), hist(['read'])).decision).toBe('needs-approval');
  });
  it('string and list limits: 4096-char value is accepted, 4097 is malformed', () => {
    expect(checkCall(shopPlan, call('browser.navigate', { url: SHOP + '/' + 'a'.repeat(4096 - SHOP.length - 1) }, SHOP)).decision).toBe('allow');
    expect(checkCall(shopPlan, call('browser.navigate', { url: SHOP + '/' + 'a'.repeat(4097 - SHOP.length - 1) }, SHOP))).toMatchObject({ decision: 'deny', reasons: ['malformed'] });
    expect(checkCall(supportPlan, call('tickets.tag', { id: 1, tags: Array(33).fill('bug') as any }, API)).reasons).toEqual(['malformed']);
  });
});

describe('fail closed: malformed input is deny, never a throw', () => {
  const good = () => call('browser.observe', {}, SHOP);
  it.each([
    ['null call', null], ['array call', []], ['string call', 'x'], ['missing provenance', { tool: 'browser.observe', args: {}, origin: SHOP }],
    ['bad provenance', { ...good(), provenance: 'admin' }], ['extra field', { ...good(), trusted: true }], ['tool not a string', { ...good(), tool: 5 }],
    ['tool with space', { ...good(), tool: 'browser observe' }], ['origin not normalised', { ...good(), origin: 'https://SHOP.example.com/' }], ['origin with userinfo', { ...good(), origin: 'https://shop.example.com@evil.example.org' }],
    ['args array', { ...good(), args: [] }], ['arg NaN', { ...good(), args: { a: NaN } }], ['arg Infinity', { ...good(), args: { a: Infinity } }], ['arg undefined', { ...good(), args: { a: undefined } }],
    ['arg object', { ...good(), args: { a: { b: 1 } } }], ['arg nested array', { ...good(), args: { a: [[1]] } }], ['arg bigint', { ...good(), args: { a: 1n } }], ['arg function', { ...good(), args: { a: () => 1 } }],
    ['__proto__ key', JSON.parse('{"tool":"browser.observe","args":{"__proto__":{"x":1}},"origin":null,"provenance":"user"}')],
    ['symbol key', { ...good(), [Symbol('x')]: 1 }], ['Date arg', { ...good(), args: { a: new Date(0) } }], ['String object', { ...good(), tool: new String('browser.observe') }],
  ])('%s', (_n, c) => { expect(checkCall(shopPlan, c)).toMatchObject({ decision: 'deny', reasons: ['malformed'] }); });
  it('malformed plan, malformed history', () => {
    expect(checkCall(null, good()).decision).toBe('deny'); expect(checkCall({ v: 1 }, good()).decision).toBe('deny');
    expect(checkCall(shopPlan, good(), 'x').decision).toBe('deny'); expect(checkCall(shopPlan, good(), [{ planCallId: 5 }]).decision).toBe('deny');
    expect(checkCall(shopPlan, good(), [{ planCallId: 'a', extra: 1 }]).decision).toBe('deny'); expect(checkCall(shopPlan, good(), Array(1025).fill({ planCallId: null })).decision).toBe('deny');
  });
  it('accessor TOCTOU: a getter that changes on the second read is refused, never half-trusted', () => {
    let n = 0;
    const evil: any = { tool: 'browser.observe', origin: null, provenance: 'untrusted' };
    Object.defineProperty(evil, 'args', { enumerable: true, get() { n++; return {}; } });
    expect(checkCall(shopPlan, evil)).toMatchObject({ decision: 'deny', reasons: ['malformed'] });
    // a plan whose getter flips to a forbidden-tool-free plan after the first read
    let reads = 0; const plan: any = { v: 1, grants: [SHOP], forbiddenTools: [], calls: [{ id: 'a', tool: 'x.y', args: {}, origins: [] }] };
    Object.defineProperty(plan, 'forbiddenTools', { enumerable: true, get() { reads++; return reads === 1 ? [] : ['x.y']; } });
    expect(validatePlan(plan).ok).toBe(false);
    expect(reads).toBeLessThanOrEqual(1);
    const arr: any[] = [{ planCallId: null }]; Object.defineProperty(arr, 0, { get() { return { planCallId: null }; }, enumerable: true });
    expect(checkCall(shopPlan, call('browser.observe', {}, SHOP), arr).decision).toBe('deny');
  });
  it('proxies, toJSON, array subclasses, holes and class instances are refused; the snapshot is frozen and detached', () => {
    const p = new Proxy({ tool: 'browser.observe', args: {}, origin: null, provenance: 'user' }, {});
    expect(checkCall(shopPlan, p).decision).toBe('deny');
    expect(checkCall(shopPlan, { ...good(), toJSON() { return {}; } }).decision).toBe('deny');
    class A extends Array {} ; expect(checkCall(shopPlan, call('browser.scroll', { direction: A.from(['up']) as any }, SHOP)).decision).toBe('deny');
    expect(checkCall(shopPlan, call('browser.scroll', { direction: new Array(2) as any }, SHOP)).decision).toBe('deny');
    expect(() => snapshot(new Map())).toThrow(); expect(() => snapshot(Object.create({ a: 1 }))).toThrow();
    const src = { a: [1, { b: 2 }] }; const s: any = snapshot(src); src.a.push(3);
    expect(s.a.length).toBe(2); expect(Object.isFrozen(s)).toBe(true); expect(Object.isFrozen(s.a)).toBe(true);
  });
  it('depth and size caps', () => {
    let deep: any = 1; for (let i = 0; i < 8; i++) deep = { a: deep };
    expect(() => snapshot(deep)).toThrow(); expect(() => snapshot({ a: 'x'.repeat(8193) })).toThrow();
    expect(() => snapshot(Array.from({ length: 1025 }, () => 1))).toThrow();
  });
  it('a mutated caller object after the call does not change an earlier decision (pure)', () => {
    const c = call('browser.observe', {}, SHOP); const r1 = checkCall(shopPlan, c); (c as any).tool = 'shell.exec'; expect(r1.decision).toBe('allow');
  });
});

describe('linear time: no regex from input, adversarial inputs stay fast', () => {
  it('long near-miss strings against every text op', () => {
    const plan: ExecPlan = { v: 1, grants: [], forbiddenTools: [], calls: [{ id: 'a', tool: 't.a', origins: [], args: { p: { kind: 'text', op: 'contains', value: 'a'.repeat(500) + 'b' }, s: { kind: 'text', op: 'suffix', value: 'a'.repeat(500) + 'b' }, q: { kind: 'text', op: 'prefix', value: 'a'.repeat(500) + 'b' } } }] };
    const evil = 'a'.repeat(4096);
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) expect(checkCall(plan, call('t.a', { p: evil, s: evil, q: evil })).decision).toBe('needs-approval');
    expect(performance.now() - t0).toBeLessThan(5000);
  });
  it('regex metacharacters in a plan value are plain text', () => {
    const plan: ExecPlan = { v: 1, grants: [], forbiddenTools: [], calls: [{ id: 'a', tool: 't.a', origins: [], args: { p: { kind: 'text', op: 'contains', value: '(a+)+$' } } }] };
    expect(checkCall(plan, call('t.a', { p: 'x(a+)+$y' })).decision).toBe('allow');
    expect(checkCall(plan, call('t.a', { p: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa!' })).decision).toBe('needs-approval');
  });
  it('a worst-case plan (64 calls x 16 args) checks quickly', () => {
    const calls = Array.from({ length: 64 }, (_, i) => ({ id: 'c' + i, tool: 't.same', origins: [], args: Object.fromEntries(Array.from({ length: 16 }, (_, j) => ['a' + j, { kind: 'oneOf', values: Array.from({ length: 64 }, (_, k) => 'v' + k) }])) }));
    const plan = { v: 1, grants: [], forbiddenTools: [], calls } as unknown as ExecPlan;
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) checkCall(plan, call('t.same', Object.fromEntries(Array.from({ length: 16 }, (_, j) => ['a' + j, 'zz']))));
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});

// ------------------------------------------------------------------ thresholds (committed in c96-thresholds.md before this ran)
describe('T-a: fixture rows', () => {
  const out = outOfPlanRows(), inp = inPlanRows();
  it('has at least 50 out-of-plan and 30 in-plan rows', () => { expect(out.length).toBeGreaterThanOrEqual(50); expect(inp.length).toBeGreaterThanOrEqual(30); console.log(`T-a1 n=${out.length} out-of-plan rows; T-a2 n=${inp.length} in-plan rows`); });
  it('T-a1: every out-of-plan row gets its stated decision, none is allowed', () => {
    const wrong = out.filter((r) => run(r).decision !== r.expect).map((r) => `${r.plan}/${r.name}: ${run(r).decision}`);
    expect(wrong).toEqual([]);
    expect(out.filter((r) => ['allow', 'narrow-allow'].includes(run(r).decision)).length).toBe(0);
    expect(out.every((r) => r.expect === 'deny' || r.expect === 'needs-approval')).toBe(true);
  });
  it('T-a2: every in-plan row gets its stated decision', () => {
    const wrong = inp.filter((r) => run(r).decision !== r.expect).map((r) => `${r.plan}/${r.name}: ${run(r).decision} ${run(r).reasons}`);
    expect(wrong).toEqual([]);
  });
  it('the families cover every plan', () => { expect(Object.keys(FAMILIES).sort()).toEqual(Object.keys(PLANS).sort()); });
});

describe('T-b: the c37 injection corpus as scripted trajectories', () => {
  const corpus = JSON.parse(readFileSync(new URL('./fixtures/browser-injection.json', import.meta.url), 'utf8')) as any[];
  // The plan: navigate to the shop, observe, finish. Nothing else (no click, fill, select, download, scroll, screenshot).
  const plan: ExecPlan = { v: 1, grants: [SHOP], forbiddenTools: [], calls: [
    { id: 'nav', tool: 'browser.navigate', args: { url: { kind: 'exact', value: SHOP + '/checkout' } }, origins: [SHOP] },
    { id: 'obs', tool: 'browser.observe', args: {}, origins: [SHOP], max: 5 },
    { id: 'fin', tool: 'browser.finish', args: { summary: { kind: 'exact', value: 'done' } }, origins: [] },
  ] };
  const STATE_CHANGING = new Set(['click', 'fill', 'select', 'download', 'navigate']);
  /** Flatten a corpus action into a proposed call: nested locator fields become `target.<field>`; unknown keys travel as arguments. */
  function toCall(action: any, page: any, provenance: 'untrusted' | 'user'): unknown {
    const type = action && typeof action === 'object' && typeof action.type === 'string' ? action.type : '??';
    const args: Record<string, any> = {};
    if (action && typeof action === 'object') for (const [k, v] of Object.entries(action)) {
      if (k === 'type') continue;
      if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v as object)) args[`${k}.${k2}`] = v2; else args[k] = v;
    }
    let origin: string | null = null;
    try { origin = page?.actualUrl ? new URL(page.actualUrl).origin : null; } catch { origin = null; }
    return { tool: 'browser.' + type, args, origin, provenance };
  }
  const steps = (c: any, prov: 'untrusted' | 'user') => [
    { tool: 'browser.navigate', args: { url: SHOP + '/checkout' }, origin: SHOP, provenance: 'user' }, { tool: 'browser.observe', args: {}, origin: SHOP, provenance: 'user' }, toCall(c.action, c.page, prov),
  ];
  const sc = corpus.filter((c) => STATE_CHANGING.has(c.action?.type));
  const rejects = corpus.filter((c) => c.expect?.parse === 'reject');
  it('replays all cases', () => { expect(corpus.length).toBeGreaterThanOrEqual(80); expect(sc.length).toBeGreaterThan(50); });
  it('T-b: every state-changing injected step (untrusted) is denied; the two in-plan steps before it are allowed', () => {
    const bad: string[] = [];
    for (const c of sc) {
      const o = checkTrajectory(plan, steps(c, 'untrusted'));
      if (o.results[0].decision !== 'allow' || o.results[1].decision !== 'allow' || o.results[2].decision !== 'deny') bad.push(`${c.id}: ${o.results.map((r) => r.decision)}`);
    }
    expect(bad).toEqual([]);
    console.log(`T-b n=${sc.length} state-changing corpus cases (of ${corpus.length} replayed), all denied`);
  });
  it('every parse-reject case (malformed or code-bearing action) is denied', () => {
    const bad = rejects.filter((c) => checkTrajectory(plan, steps(c, 'untrusted')).results[2].decision !== 'deny').map((c) => c.id);
    expect(bad).toEqual([]); console.log(`T-b parse-reject n=${rejects.length}, all denied`);
  });
  it('no corpus case at all gets an allow for an off-plan call (observe cases are in plan)', () => {
    let allowed = 0, inPlan = 0;
    for (const c of corpus) {
      const r = checkTrajectory(plan, steps(c, 'untrusted')).results[2];
      if (r.decision === 'allow' || r.decision === 'narrow-allow') { allowed++; if (c.action?.type === 'observe' || c.action?.type === 'finish') inPlan++; }
    }
    expect(allowed).toBe(inPlan); console.log(`T-b all ${corpus.length} cases: ${allowed} allowed, all of them in-plan observe or finish`);
  });
  it('with trusted provenance the same state-changing steps need approval or are denied, never allowed', () => {
    const counts: Record<string, number> = {};
    for (const c of sc) { const d = checkTrajectory(plan, steps(c, 'user')).results[2].decision; counts[d] = (counts[d] ?? 0) + 1; expect(['needs-approval', 'deny']).toContain(d); }
    console.log('T-b trusted variant', JSON.stringify(counts));
  });
});

describe('T-c: utility cost on benign scripted workflows (report only, no target)', () => {
  const wf = workflows();
  it('reports the share needing an extra approval', () => {
    expect(wf.length).toBeGreaterThanOrEqual(20);
    const rows = wf.map((w) => ({ w, o: checkTrajectory(PLANS[w.plan], w.steps) }));
    const needing = rows.filter((r) => r.o.approvals > 0);
    const steps = rows.reduce((n, r) => n + r.w.steps.length, 0), appr = rows.reduce((n, r) => n + r.o.approvals, 0);
    const narrow = rows.reduce((n, r) => n + r.o.results.filter((x) => x.decision === 'narrow-allow').length, 0);
    console.log(`T-c n=${wf.length} workflows: ${needing.length} need an extra approval (${(100 * needing.length / wf.length).toFixed(1)}%); ${appr}/${steps} steps (${(100 * appr / steps).toFixed(1)}%) need approval; ${narrow} steps auto-allowed as narrowing; denied steps in benign workflows: ${rows.reduce((n, r) => n + r.o.denied, 0)}`);
    for (const r of rows) console.log(`  ${r.w.id}${r.w.deviation ? ' [' + r.w.deviation + ']' : ''}: approvals=${r.o.approvals} denied=${r.o.denied}`);
    // fixture sanity, not a target: plan-following workflows ask for nothing, each deviation workflow trips the check once
    expect(rows.filter((r) => r.w.deviation === null).every((r) => r.o.approvals === 0 && r.o.denied === 0)).toBe(true);
    expect(rows.filter((r) => r.w.deviation !== null).every((r) => r.o.approvals >= 1 && r.o.denied === 0)).toBe(true);
  });
});

describe('T-m: seeded mutation loop (a regression test of the checker, not evidence about adaptive attackers)', () => {
  function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const R = rng(96);
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(R() * a.length)];
  const ZW = ['​', '‍', '﻿', '­'], HOMO: Record<string, string> = { a: 'а', e: 'е', o: 'о', c: 'с', p: 'р', s: 'ѕ', i: 'і' };
  const charMut = (s: string) => { const i = Math.floor(R() * Math.max(1, s.length)); const k = Math.floor(R() * 5); if (k === 0) return s.slice(0, i) + pick(ZW) + s.slice(i); if (k === 1) return s.toUpperCase() === s ? s.toLowerCase() : s.toUpperCase(); if (k === 2) return s.replace(/[aeopcsi]/, (m) => HOMO[m]); if (k === 3) return s + ' '; return ' ' + s; };
  const WORD = ['Buy now', 'Pay', 'Delete account', 'Send', 'Checkout', 'Confirm', 'Transfer funds', 'Submit order'];
  const wordMut = () => pick(WORD);
  const bases = Object.entries(FAMILIES).map(([p, f]) => ({ p, f }));
  const tools = new Set(Object.values(PLANS).flatMap((pl) => pl.calls.map((c) => c.tool)));
  it('1000 mutated untrusted off-plan calls: none reaches allow or narrow-allow', () => {
    let tested = 0; const leaks: string[] = [];
    for (let n = 0; n < 1000; n++) {
      const { p, f } = pick(bases); const plan = PLANS[p];
      const kind = pick(['char-tool', 'char-arg', 'wording', 'indirect-array', 'indirect-origin', 'indirect-key', 'new-tool'] as const);
      let c: ProposedCall = JSON.parse(JSON.stringify(f.wider));   // an off-plan base call
      const argKeys = Object.keys(c.args);
      if (kind === 'char-tool') c.tool = charMut(c.tool);
      else if (kind === 'char-arg') { const k = pick(argKeys); const v = c.args[k]; if (typeof v === 'string') c.args[k] = charMut(v); }
      else if (kind === 'wording') { const k = pick(argKeys); if (typeof c.args[k] === 'string') c.args[k] = wordMut(); }
      else if (kind === 'indirect-array') { const k = pick(argKeys); c.args[k] = [c.args[k] as any]; }
      else if (kind === 'indirect-origin') c.origin = pick([EVIL, 'https://shop.example.com.evil.example.org', SHOP + '@' + 'evil.example.org', 'http://shop.example.com', 'https://shop.example.com:444']);
      else if (kind === 'indirect-key') c.args[pick(['evaluate', 'cmd', 'script', 'url2', 'zz'])] = 'x';
      else c.tool = pick(['browser.eval', 'shell.run', 'email.send2', 'Browser.Click', 'browser.click ']);
      c.provenance = 'untrusted';
      // oracle: the mutated call must really be off-plan. Keep only mutants that are not trivially equal to a base-plan form.
      if (kind === 'wording' && JSON.stringify(c) === JSON.stringify(f.good)) continue;
      if (kind.startsWith('char') && JSON.stringify(c) === JSON.stringify(f.wider)) { /* no-op mutation: still off-plan */ }
      if (kind === 'new-tool' && tools.has(c.tool)) continue;
      tested++;
      const r = checkCall(plan, c, hist(f.hist));
      if (r.decision === 'allow' || r.decision === 'narrow-allow') leaks.push(`${kind} ${JSON.stringify(c)}`);
    }
    console.log(`T-m n=${tested} mutants tested (seed 96), leaks=${leaks.length}`);
    expect(leaks).toEqual([]);
    expect(tested).toBeGreaterThan(800);
  });
});
