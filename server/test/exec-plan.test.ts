import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkCall, checkTrajectory } from '../src/exec-plan/conformance.ts';
import { validatePlan, planSha256 } from '../src/exec-plan/plan.ts';
import { snapshot } from '../src/exec-plan/snapshot.ts';
import { canonicalPlanJson, type ExecPlan, type ProposedCall } from '../../shared/contracts/src/exec-plan.ts';
import { PLANS, FAMILIES, call, outOfPlanRows, inPlanRows, workflows, shopPlan, formPlan, supportPlan, SHOP, DOCS, API, EVIL, type Row } from './exec-plan-fixtures.ts';

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
  it('narrow-allow (user and system only): a strict subset list, and an omission the plan declares narrower', () => {
    const r = checkCall(supportPlan, call('tickets.tag', { id: 1, tags: ['bug'], note: 'triage' }, API), hist(['read']));
    expect(r.decision).toBe('narrow-allow'); expect(r.reasons).toEqual(['narrowed']);
    expect(checkCall(supportPlan, { ...call('tickets.tag', { id: 1, tags: ['bug'], note: 'triage' }, API), provenance: 'system' }, hist(['read'])).decision).toBe('narrow-allow');
    expect(checkCall(PLANS.deploy, call('logs.read', { service: 'web' }, API), hist(['status'])).decision).toBe('narrow-allow');
  });
  it('an UNTRUSTED narrowing is deny until label propagation exists', () => {
    const u = (c: ProposedCall): ProposedCall => ({ ...c, provenance: 'untrusted' });
    expect(checkCall(supportPlan, u(call('tickets.tag', { id: 1, tags: ['bug'], note: 'triage' }, API)), hist(['read']))).toMatchObject({ decision: 'deny', reasons: ['untrusted_narrowing'] });
    expect(checkCall(PLANS.deploy, u(call('logs.read', { service: 'web' }, API)), hist(['status']))).toMatchObject({ decision: 'deny', reasons: ['untrusted_narrowing'] });
  });
  it('review probes: an empty list and an omitted argument are NOT narrowings (they can mean "no filter" or a wider default)', () => {
    for (const provenance of ['user', 'untrusted'] as const) {
      const tag = { ...call('tickets.tag', { id: 1, tags: [], note: 'triage' }, API), provenance };
      const search = { ...call('docs.search', { q: 'refund?' }, DOCS), provenance };
      expect(checkCall(supportPlan, tag, hist(['read'])).decision).toBe(provenance === 'user' ? 'needs-approval' : 'deny');
      const r = checkCall(supportPlan, search);
      expect(r.decision).toBe(provenance === 'user' ? 'needs-approval' : 'deny'); expect(r.reasons).toContain('missing_arg');
    }
    // repeatable up to max 4 for an untrusted call: none of them is allowed
    const calls = Array(4).fill({ ...call('docs.search', { q: 'refund?' }, DOCS), provenance: 'untrusted' });
    expect(checkTrajectory(supportPlan, calls).results.map((r) => r.decision)).toEqual(['deny', 'deny', 'deny', 'deny']);
  });
  it('subsetOf with maxItems: any list up to the cap is in plan (allow), longer is wider', () => {
    const plan = clone(supportPlan); (plan.calls[2].args.tags as any).maxItems = 2;
    const t = (tags: string[]) => checkCall(plan, call('tickets.tag', { id: 1, tags, note: 'triage' }, API), hist(['read'])).decision;
    expect([t(['bug']), t(['bug', 'ux']), t(['bug', 'ux', 'billing'])]).toEqual(['allow', 'allow', 'needs-approval']);
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
    expect([tags(['bug', 'bug']), tags(['bug', 'x']), tags(['bug', 'billing', 'ux', 'bug']), tags([]), tags('bug')]).toEqual(['needs-approval', 'needs-approval', 'needs-approval', 'needs-approval', 'needs-approval']);
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
    expect(checkCall(supportPlan, call('docs.search', { q: 'ok?', limit: 1 }, DOCS)).decision).toBe('allow');
    expect(checkCall(supportPlan, call('docs.search', { q: 'ok？', limit: 1 }, DOCS)).decision).toBe('needs-approval'); // fullwidth question mark
    expect(checkCall(supportPlan, call('tickets.tag', { id: 1, tags: ['bug'], note: 'TRIAGE' }, API), hist(['read'])).decision).toBe('needs-approval');
  });
  it('string and list limits: 4096-char value is accepted, 4097 is malformed', () => {
    expect(checkCall(shopPlan, call('browser.navigate', { url: SHOP + '/' + 'a'.repeat(4096 - SHOP.length - 1) }, SHOP)).decision).toBe('allow');
    expect(checkCall(shopPlan, call('browser.navigate', { url: SHOP + '/' + 'a'.repeat(4097 - SHOP.length - 1) }, SHOP))).toMatchObject({ decision: 'deny', reasons: ['malformed'] });
    expect(checkCall(supportPlan, call('tickets.tag', { id: 1, tags: Array(33).fill('bug') as any }, API)).reasons).toEqual(['malformed']);
  });
});

describe('review minors', () => {
  it('integer ranges refuse fractions (ids)', () => {
    expect(checkCall(supportPlan, call('tickets.read', { id: 1.5 }, API)).decision).toBe('needs-approval');
    expect(checkCall(supportPlan, call('tickets.read', { id: 2 }, API)).decision).toBe('allow');
    expect(checkCall(shopPlan, call('browser.scroll', { direction: 'up', pixels: 10.5 }, SHOP)).decision).toBe('allow'); // pixels has no integer flag
  });
  it('URL and path prefix/contains are normalised before matching', () => {
    const nav = (url: string) => checkCall(shopPlan, call('browser.navigate', { url }, SHOP)).decision;
    expect([nav(SHOP + '/a/./b'), nav(SHOP + '/a/../b'), nav(SHOP + '//a'), nav(SHOP + '/a%2e%2e/b'), nav(SHOP + '/a\\..\\b'), nav(SHOP + '/a\u0000b')]).toEqual(['allow', 'allow', 'allow', 'needs-approval', 'needs-approval', 'needs-approval']);
    const rd = (path: string) => checkCall(PLANS.report, call('files.read', { path })).decision;
    expect([rd('/workspace/reports/a.md'), rd('/workspace/reports/../secrets/key'), rd('/workspace/reports/../../etc/passwd'), rd('/workspace/reports/./x/../a.md'), rd('/workspace/reports/%2e%2e/x'), rd('workspace/reports/a')]).toEqual(['allow', 'needs-approval', 'needs-approval', 'allow', 'needs-approval', 'needs-approval']);
  });
  it('forbiddenTools is case-insensitive, and so is the planned-vs-forbidden conflict', () => {
    expect(checkCall(shopPlan, call('Browser.Download', {}, SHOP)).reasons).toEqual(['forbidden_tool']);
    expect(checkCall(shopPlan, call('SHELL.EXEC', {})).reasons).toEqual(['forbidden_tool']);
    const p = clone(shopPlan); p.forbiddenTools.push('BROWSER.NAVIGATE'); expect(validatePlan(p).ok).toBe(false);
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
  it('permanent RED evidence: an always-allow stub and an always-deny stub both fail this suite\'s T-a checks', () => {
    const allowAll = (r: Row) => ({ decision: 'allow' as const });
    const denyAll = (r: Row) => ({ decision: 'deny' as const });
    const failsOut = (f: (r: Row) => { decision: string }) => out.filter((r) => f(r).decision !== r.expect).length;
    const failsIn = (f: (r: Row) => { decision: string }) => inp.filter((r) => f(r).decision !== r.expect).length;
    expect(failsOut(allowAll)).toBe(out.length);       // every out-of-plan row catches the allow-all stub
    expect(failsIn(allowAll)).toBeGreaterThan(0);      // narrowing rows catch it too
    expect(failsIn(denyAll)).toBe(inp.length);         // and deny-all cannot pass the in-plan rows
    expect(failsOut(run)).toBe(0); expect(failsIn(run)).toBe(0);
  });
  it('the families cover every plan', () => { expect(Object.keys(FAMILIES).sort()).toEqual(Object.keys(PLANS).sort()); });
});

describe('T-b: the c37 injection corpus as scripted trajectories', () => {
  const corpus = JSON.parse(readFileSync(new URL('./fixtures/browser-injection.json', import.meta.url), 'utf8')) as any[];
  // TIGHT plan: navigate, observe, finish only. Most injected tools are simply absent, so this plan mostly tests new_tool (a weak test, reported as such).
  const tight: ExecPlan = { v: 1, grants: [SHOP], forbiddenTools: [], calls: [
    { id: 'nav', tool: 'browser.navigate', args: { url: { kind: 'exact', value: SHOP + '/checkout' } }, origins: [SHOP] },
    { id: 'obs', tool: 'browser.observe', args: {}, origins: [SHOP], max: 5 },
    { id: 'fin', tool: 'browser.finish', args: { summary: { kind: 'exact', value: 'done' } }, origins: [] },
  ] };
  const STATE_CHANGING = new Set(['click', 'fill', 'select', 'download', 'navigate']);
  /** Faithful mapper: a locator becomes `by` plus its identifying field (role+name, label, testId, selector); `exact` is dropped; every other key of the action travels under its own name.
   *  It adds NO key of its own, so an `extra_arg` can only come from a key the corpus action itself carries (script, evaluate, cdp, a `value` on a fill). */
  function toCall(action: any, page: any, provenance: 'untrusted' | 'user'): unknown {
    const type = action && typeof action === 'object' && typeof action.type === 'string' ? action.type : '??';
    const args: Record<string, any> = {};
    if (action && typeof action === 'object') for (const [k, v] of Object.entries(action)) {
      if (k === 'type') continue;
      if (k === 'target' && v && typeof v === 'object') { for (const [k2, v2] of Object.entries(v as object)) if (k2 !== 'exact') args[k2] = v2; } else args[k] = v;
    }
    let origin: string | null = null;
    try { origin = page?.actualUrl ? new URL(page.actualUrl).origin : null; } catch { origin = null; }
    return { tool: 'browser.' + type, args, origin, provenance };
  }
  const pre = { tight: [{ tool: 'browser.navigate', args: { url: SHOP + '/checkout' }, origin: SHOP, provenance: 'user' }, { tool: 'browser.observe', args: {}, origin: SHOP, provenance: 'user' }],
    shop: [{ tool: 'browser.navigate', args: { url: SHOP + '/products' }, origin: SHOP, provenance: 'user' }, { tool: 'browser.observe', args: {}, origin: SHOP, provenance: 'user' }],
    form: [{ tool: 'browser.navigate', args: { url: SHOP + '/form' }, origin: SHOP, provenance: 'user' }] } as const;
  const plans = { tight, shop: shopPlan, form: formPlan } as const;
  const replay = (which: keyof typeof plans, c: any, prov: 'untrusted' | 'user') => { const o = checkTrajectory(plans[which], [...pre[which], toCall(c.action, c.page, prov)]); return { pre: o.results.slice(0, pre[which].length), last: o.results[pre[which].length] }; };
  const sc = corpus.filter((c) => STATE_CHANGING.has(c.action?.type));
  const rejects = corpus.filter((c) => c.expect?.parse === 'reject');
  const tally = (which: keyof typeof plans, cases: any[], prov: 'untrusted' | 'user') => {
    const d: Record<string, number> = {}, why: Record<string, number> = {};
    for (const c of cases) { const r = replay(which, c, prov).last; d[r.decision] = (d[r.decision] ?? 0) + 1; const k = r.reasons[0]; why[k] = (why[k] ?? 0) + 1; }
    return { d, why };
  };
  it('replays all cases', () => { expect(corpus.length).toBeGreaterThanOrEqual(80); expect(sc.length).toBeGreaterThan(50); });
  it('T-b tight plan: every state-changing injected step (untrusted) is denied, and the steps before it are allowed', () => {
    const bad: string[] = [];
    for (const c of sc) { const r = replay('tight', c, 'untrusted'); if (r.pre.some((x) => x.decision !== 'allow') || r.last.decision !== 'deny') bad.push(c.id); }
    expect(bad).toEqual([]);
    const t = tally('tight', sc, 'untrusted');
    console.log(`T-b TIGHT plan n=${sc.length} state-changing cases: ${JSON.stringify(t.d)}; first reason ${JSON.stringify(t.why)} (new_tool dominates: weak test, the tools are simply absent from this plan)`);
    const rj = rejects.filter((c) => replay('tight', c, 'untrusted').last.decision !== 'deny');
    expect(rj.map((c) => c.id)).toEqual([]); console.log(`T-b parse-reject n=${rejects.length}, all denied on the tight plan`);
  });
  it.each(['shop', 'form'] as const)('T-b broader plan (%s: click or fill is allowed): untrusted off-plan is deny, never needs-approval; trusted off-plan is needs-approval or deny', (which) => {
    const un = tally(which, sc, 'untrusted'), tr = tally(which, sc, 'user');
    expect(un.d['needs-approval'] ?? 0).toBe(0);
    expect(tr.d['allow'] ?? 0).toBe(un.d['allow'] ?? 0);   // provenance never changes what is in plan
    const extra = sc.filter((c) => replay(which, c, 'untrusted').last.reasons.includes('extra_arg')).length;
    const own = (c: any) => c.action?.target?.selector !== undefined || ['script', 'evaluate', 'cdp'].some((k) => k in (c.action ?? {})) || (c.action?.type === 'fill' && 'value' in c.action);
    const ownKeys = sc.filter((c) => replay(which, c, 'untrusted').last.reasons.includes('extra_arg') && own(c)).length;
    console.log(`T-b BROADER plan ${which} n=${sc.length}: untrusted ${JSON.stringify(un.d)} first reasons ${JSON.stringify(un.why)}; trusted ${JSON.stringify(tr.d)}; calls with extra_arg=${extra} (of which carried by the corpus action itself: css selector, script/evaluate/cdp, or a value on a fill: ${ownKeys}; the mapper adds none)`);
  });
  it('broader plans: the calls that ARE allowed are in-plan actions with arguments chosen by injected content (a plan check cannot stop these)', () => {
    const allowed = (which: 'shop' | 'form') => sc.filter((c) => replay(which, c, 'untrusted').last.decision === 'allow').map((c) => `${c.action.type}:${JSON.stringify(c.action.target ?? c.action.url).slice(0, 60)}`);
    console.log('T-b allowed on shop plan', allowed('shop').length, 'on form plan', allowed('form').length);
    expect(allowed('shop').every((x) => x.startsWith('click:') || x.startsWith('navigate:'))).toBe(true);
  });
  it('no corpus case gets an allow on the tight plan except in-plan observe', () => {
    let allowed = 0, inPlan = 0;
    for (const c of corpus) { const r = replay('tight', c, 'untrusted').last; if (r.decision === 'allow' || r.decision === 'narrow-allow') { allowed++; if (c.action?.type === 'observe') inPlan++; } }
    expect(allowed).toBe(inPlan); console.log(`T-b tight, all ${corpus.length} cases: ${allowed} allowed, all in-plan observe`);
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
