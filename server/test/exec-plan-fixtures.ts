// c96 fixtures: plans, in-plan calls, out-of-plan families and benign workflows. Design: web/docs/improve/cycles/c96-thresholds.md.
import type { ExecPlan, ProposedCall, ConformanceDecision, ExecProvenance } from '../../shared/contracts/src/exec-plan.ts';

export const SHOP = 'https://shop.example.com';
export const DOCS = 'https://docs.example.com';
export const API = 'https://api.example.com';
export const EVIL = 'https://evil.example.org';

export const call = (tool: string, args: ProposedCall['args'] = {}, origin: string | null = null, provenance: ExecProvenance = 'user'): ProposedCall => ({ tool, args, origin, provenance });

export const shopPlan: ExecPlan = {
  v: 1, grants: [SHOP, DOCS], forbiddenTools: ['browser.download', 'browser.evaluate', 'shell.exec'],
  calls: [
    { id: 'nav', tool: 'browser.navigate', args: { url: { kind: 'text', op: 'prefix', value: SHOP + '/' } }, origins: [SHOP], max: 5 },
    { id: 'obs', tool: 'browser.observe', args: {}, origins: [SHOP], max: 10 },
    { id: 'click', tool: 'browser.click', args: { by: { kind: 'exact', value: 'role' }, role: { kind: 'oneOf', values: ['link', 'tab'] }, name: { kind: 'oneOf', values: ['Next', 'Details', 'Specs'] } }, origins: [SHOP], after: ['nav'], max: 4 },
    { id: 'scroll', tool: 'browser.scroll', args: { direction: { kind: 'oneOf', values: ['up', 'down'] }, pixels: { kind: 'range', min: 0, max: 2000 } }, origins: [SHOP], max: 5 },
    { id: 'fin', tool: 'browser.finish', args: { summary: { kind: 'text', op: 'prefix', value: 'Summary:' } }, origins: [], after: ['obs'] },
  ],
};
export const formPlan: ExecPlan = {
  v: 1, grants: [SHOP], forbiddenTools: ['browser.download', 'browser.evaluate'],
  calls: [
    { id: 'nav', tool: 'browser.navigate', args: { url: { kind: 'text', op: 'prefix', value: SHOP + '/form' } }, origins: [SHOP] },
    { id: 'fill', tool: 'browser.fill', args: { by: { kind: 'exact', value: 'label' }, label: { kind: 'oneOf', values: ['Name', 'Email', 'Card'] }, valueRef: { kind: 'text', op: 'prefix', value: 'sec_' } }, origins: [SHOP], after: ['nav'], max: 3 },
    { id: 'select', tool: 'browser.select', args: { by: { kind: 'exact', value: 'label' }, label: { kind: 'exact', value: 'Plan' }, value: { kind: 'oneOf', values: ['basic', 'pro'] } }, origins: [SHOP], after: ['nav'] },
    { id: 'save', tool: 'browser.click', args: { by: { kind: 'exact', value: 'role' }, role: { kind: 'exact', value: 'button' }, name: { kind: 'exact', value: 'Save draft' } }, origins: [SHOP], after: ['fill'] },
  ],
};
export const supportPlan: ExecPlan = {
  v: 1, grants: [API, DOCS], forbiddenTools: ['tickets.delete', 'email.send'],
  calls: [
    { id: 'read', tool: 'tickets.read', args: { id: { kind: 'range', min: 1, max: 99999 } }, origins: [API], max: 5 },
    { id: 'comment', tool: 'tickets.comment', args: { id: { kind: 'range', min: 1, max: 99999 }, body: { kind: 'text', op: 'prefix', value: 'Re: ' }, visibility: { kind: 'exact', value: 'internal' } }, origins: [API], after: ['read'], max: 2 },
    { id: 'tag', tool: 'tickets.tag', args: { id: { kind: 'range', min: 1, max: 99999 }, tags: { kind: 'subsetOf', values: ['bug', 'billing', 'ux'], maxItems: 3 }, note: { kind: 'text', op: 'contains', value: 'triage', optional: true } }, origins: [API], after: ['read'], max: 3 },
    { id: 'search', tool: 'docs.search', args: { q: { kind: 'text', op: 'suffix', value: '?' }, limit: { kind: 'range', min: 1, max: 10, optional: true } }, origins: [DOCS], max: 4 },
  ],
};
export const reportPlan: ExecPlan = {
  v: 1, grants: [], forbiddenTools: ['files.delete', 'net.fetch'],
  calls: [
    { id: 'read', tool: 'files.read', args: { path: { kind: 'text', op: 'prefix', value: '/workspace/reports/' } }, origins: [], max: 8 },
    { id: 'write', tool: 'files.write', args: { path: { kind: 'exact', value: '/workspace/reports/out.md' }, content: { kind: 'text', op: 'prefix', value: '# Report' } }, origins: [], after: ['read'] },
  ],
};
export const deployPlan: ExecPlan = {
  v: 1, grants: [API], forbiddenTools: ['deploy.run', 'deploy.rollback', 'secrets.read'],
  calls: [
    { id: 'status', tool: 'ci.status', args: { service: { kind: 'oneOf', values: ['web', 'api', 'worker'] } }, origins: [API], max: 3 },
    { id: 'logs', tool: 'logs.read', args: { service: { kind: 'oneOf', values: ['web', 'api', 'worker'] }, lines: { kind: 'range', min: 1, max: 500, optional: true } }, origins: [API], after: ['status'], max: 3 },
    { id: 'metric', tool: 'metrics.query', args: { metric: { kind: 'oneOf', values: ['latency', 'errors'] } }, origins: [API], max: 4 },
  ],
};

export interface Row { plan: string; name: string; call: ProposedCall; history: (string | null)[]; expect: ConformanceDecision }
export const PLANS: Record<string, ExecPlan> = { shop: shopPlan, form: formPlan, support: supportPlan, report: reportPlan, deploy: deployPlan };
const H = (...ids: (string | null)[]) => ids;

/** Per plan: one valid call with its history, one forbidden tool, one wider value, one missing arg, the history that exhausts it. */
interface Family { good: ProposedCall; hist: (string | null)[]; planCallId: string; forbidden: string; wider: ProposedCall; missing: ProposedCall; exhaust: (string | null)[]; evilOrigin: ProposedCall | null; otherGrant: ProposedCall | null; unordered: ProposedCall | null }
export const FAMILIES: Record<string, Family> = {
  shop: {
    good: call('browser.click', { by: 'role', role: 'link', name: 'Next' }, SHOP), hist: H('nav'), planCallId: 'click', forbidden: 'browser.download',
    wider: call('browser.click', { by: 'role', role: 'button', name: 'Buy now' }, SHOP), missing: call('browser.click', { by: 'role', role: 'link' }, SHOP),
    exhaust: H('nav', 'click', 'click', 'click', 'click'), evilOrigin: call('browser.navigate', { url: EVIL + '/' }, EVIL), otherGrant: call('browser.observe', {}, DOCS), unordered: call('browser.click', { by: 'role', role: 'link', name: 'Next' }, SHOP),
  },
  form: {
    good: call('browser.fill', { by: 'label', label: 'Email', valueRef: 'sec_email' }, SHOP), hist: H('nav'), planCallId: 'fill', forbidden: 'browser.evaluate',
    wider: call('browser.fill', { by: 'label', label: 'Email', valueRef: 'plain-text-password' }, SHOP), missing: call('browser.fill', { by: 'label', label: 'Email' }, SHOP),
    exhaust: H('nav', 'fill', 'fill', 'fill'), evilOrigin: call('browser.navigate', { url: EVIL + '/form' }, EVIL), otherGrant: null, unordered: call('browser.fill', { by: 'label', label: 'Name', valueRef: 'sec_name' }, SHOP),
  },
  support: {
    good: call('tickets.comment', { id: 42, body: 'Re: refund', visibility: 'internal' }, API), hist: H('read'), planCallId: 'comment', forbidden: 'email.send',
    wider: call('tickets.comment', { id: 42, body: 'Re: refund', visibility: 'public' }, API), missing: call('tickets.comment', { id: 42, body: 'Re: refund' }, API),
    exhaust: H('read', 'comment', 'comment'), evilOrigin: call('docs.search', { q: 'refund policy?' }, EVIL), otherGrant: call('tickets.read', { id: 7 }, DOCS), unordered: call('tickets.comment', { id: 42, body: 'Re: refund', visibility: 'internal' }, API),
  },
  report: {
    good: call('files.write', { path: '/workspace/reports/out.md', content: '# Report 1' }), hist: H('read'), planCallId: 'write', forbidden: 'files.delete',
    wider: call('files.write', { path: '/etc/cron.d/x', content: '# Report 1' }), missing: call('files.write', { path: '/workspace/reports/out.md' }),
    exhaust: H('read', 'write'), evilOrigin: null, otherGrant: null, unordered: call('files.write', { path: '/workspace/reports/out.md', content: '# Report 1' }),
  },
  deploy: {
    good: call('logs.read', { service: 'api', lines: 100 }, API), hist: H('status'), planCallId: 'logs', forbidden: 'deploy.run',
    wider: call('logs.read', { service: 'database', lines: 100 }, API), missing: call('logs.read', { lines: 100 }, API),
    exhaust: H('status', 'logs', 'logs', 'logs'), evilOrigin: call('ci.status', { service: 'web' }, EVIL), otherGrant: null, unordered: call('logs.read', { service: 'api' }, API),
  },
};
const asUntrusted = (c: ProposedCall): ProposedCall => ({ ...c, provenance: 'untrusted' });

/** Out-of-plan rows. `needs-approval` for trusted provenance, `deny` for untrusted, except forbidden tools and origins outside the grants (deny for both). */
export function outOfPlanRows(): Row[] {
  const rows: Row[] = [];
  for (const [p, f] of Object.entries(FAMILIES)) {
    const add = (name: string, c: ProposedCall, history: (string | null)[], trustedExpect: ConformanceDecision) => {
      rows.push({ plan: p, name: `${name} (trusted)`, call: c, history, expect: trustedExpect });
      rows.push({ plan: p, name: `${name} (untrusted)`, call: asUntrusted(c), history, expect: 'deny' });
    };
    add('new tool', call('mail.draft', { to: 'a@b.c' }, f.good.origin), f.hist, 'needs-approval');
    add('forbidden tool', call(f.forbidden, {}, f.good.origin), f.hist, 'deny');
    add('wider value', f.wider, f.hist, 'needs-approval');
    add('extra arg', { ...f.good, args: { ...f.good.args, zz_extra: 'x' } }, f.hist, 'needs-approval');
    add('missing arg', f.missing, f.hist, 'needs-approval');
    add('count over max', f.good, f.exhaust, 'needs-approval');
    if (f.unordered) add('out of order', f.unordered, [], 'needs-approval');
    if (f.evilOrigin) add('origin outside grants', f.evilOrigin, f.hist, 'deny');
    if (f.otherGrant) add('granted origin the call does not list', f.otherGrant, f.hist, 'needs-approval');
  }
  return rows;
}

/** In-plan rows: expected allow, or narrow-allow where stated. */
export function inPlanRows(): Row[] {
  const R = (plan: string, name: string, c: ProposedCall, history: (string | null)[], expect: ConformanceDecision = 'allow'): Row => ({ plan, name, call: c, history, expect });
  const rows: Row[] = [];
  for (const [p, f] of Object.entries(FAMILIES)) rows.push(R(p, 'family good call', f.good, f.hist), R(p, 'family good call (system)', { ...f.good, provenance: 'system' }, f.hist), R(p, 'family good call (untrusted but in plan)', asUntrusted(f.good), f.hist));
  rows.push(
    R('shop', 'navigate', call('browser.navigate', { url: SHOP + '/products' }, SHOP), []),
    R('shop', 'observe', call('browser.observe', {}, SHOP), []),
    R('shop', 'scroll down', call('browser.scroll', { direction: 'down', pixels: 800 }, SHOP), []),
    R('shop', 'scroll boundary 2000', call('browser.scroll', { direction: 'up', pixels: 2000 }, SHOP), []),
    R('shop', 'scroll boundary 0', call('browser.scroll', { direction: 'up', pixels: 0 }, SHOP), []),
    R('shop', 'finish after observe', call('browser.finish', { summary: 'Summary: found it' }), ['obs']),
    R('shop', 'click last allowed use', call('browser.click', { by: 'role', role: 'tab', name: 'Specs' }, SHOP), ['nav', 'click', 'click', 'click']),
    R('form', 'navigate', call('browser.navigate', { url: SHOP + '/form/new' }, SHOP), []),
    R('form', 'select', call('browser.select', { by: 'label', label: 'Plan', value: 'pro' }, SHOP), ['nav']),
    R('form', 'save draft', call('browser.click', { by: 'role', role: 'button', name: 'Save draft' }, SHOP), ['nav', 'fill']),
    R('support', 'read', call('tickets.read', { id: 1 }, API), []),
    R('support', 'read max id', call('tickets.read', { id: 99999 }, API), []),
    R('support', 'search with limit', call('docs.search', { q: 'refund?', limit: 5 }, DOCS), []),
    R('support', 'tag full list', call('tickets.tag', { id: 3, tags: ['bug', 'billing', 'ux'], note: 'triage done' }, API), ['read']),
    R('support', 'tag narrower list', call('tickets.tag', { id: 3, tags: ['bug'], note: 'triage done' }, API), ['read'], 'narrow-allow'),
    R('support', 'tag omits optional note', call('tickets.tag', { id: 3, tags: ['bug', 'ux', 'billing'] }, API), ['read'], 'narrow-allow'),
    R('support', 'search omits optional limit', call('docs.search', { q: 'refund?' }, DOCS), [], 'narrow-allow'),
    R('support', 'tag empty list', call('tickets.tag', { id: 3, tags: [], note: 'triage' }, API), ['read'], 'narrow-allow'),
    R('report', 'read', call('files.read', { path: '/workspace/reports/q3.md' }), []),
    R('report', 'read again 7th use', call('files.read', { path: '/workspace/reports/q3.md' }), H('read', 'read', 'read', 'read', 'read', 'read', 'read')),
    R('deploy', 'status', call('ci.status', { service: 'worker' }, API), []),
    R('deploy', 'metric errors', call('metrics.query', { metric: 'errors' }, API), []),
    R('deploy', 'logs boundary 500', call('logs.read', { service: 'web', lines: 500 }, API), ['status']),
    R('deploy', 'logs boundary 1', call('logs.read', { service: 'web', lines: 1 }, API), ['status']),
    R('deploy', 'logs omits optional lines', call('logs.read', { service: 'web' }, API), ['status'], 'narrow-allow'),
  );
  return rows;
}

/** Benign scripted workflows (T-c). `deviation` names the one authored benign deviation; null means the plan is followed. */
export interface Workflow { id: string; plan: string; deviation: string | null; steps: ProposedCall[] }
const shopBase = (): ProposedCall[] => [call('browser.navigate', { url: SHOP + '/products' }, SHOP), call('browser.observe', {}, SHOP), call('browser.click', { by: 'role', role: 'link', name: 'Details' }, SHOP), call('browser.scroll', { direction: 'down', pixels: 600 }, SHOP), call('browser.observe', {}, SHOP), call('browser.finish', { summary: 'Summary: price is 12' })];
const formBase = (): ProposedCall[] => [call('browser.navigate', { url: SHOP + '/form' }, SHOP), call('browser.fill', { by: 'label', label: 'Name', valueRef: 'sec_name' }, SHOP), call('browser.fill', { by: 'label', label: 'Email', valueRef: 'sec_email' }, SHOP), call('browser.select', { by: 'label', label: 'Plan', value: 'basic' }, SHOP), call('browser.click', { by: 'role', role: 'button', name: 'Save draft' }, SHOP)];
const supportBase = (): ProposedCall[] => [call('tickets.read', { id: 10 }, API), call('docs.search', { q: 'how to refund?', limit: 3 }, DOCS), call('tickets.tag', { id: 10, tags: ['billing'] }, API), call('tickets.comment', { id: 10, body: 'Re: refund steps sent', visibility: 'internal' }, API)];
const reportBase = (): ProposedCall[] => [call('files.read', { path: '/workspace/reports/a.md' }), call('files.read', { path: '/workspace/reports/b.md' }), call('files.write', { path: '/workspace/reports/out.md', content: '# Report merged' })];
const deployBase = (): ProposedCall[] => [call('ci.status', { service: 'api' }, API), call('logs.read', { service: 'api', lines: 200 }, API), call('metrics.query', { metric: 'latency' }, API), call('metrics.query', { metric: 'errors' }, API)];
const BASES: Record<string, () => ProposedCall[]> = { shop: shopBase, form: formBase, support: supportBase, report: reportBase, deploy: deployBase };

export function workflows(): Workflow[] {
  const out: Workflow[] = [];
  const W = (id: string, plan: string, deviation: string | null, steps: ProposedCall[]) => out.push({ id, plan, deviation, steps });
  // 12 that follow the plan
  for (const p of Object.keys(PLANS)) W(`${p}-base`, p, null, BASES[p]());
  W('shop-short', 'shop', null, [call('browser.navigate', { url: SHOP + '/' }, SHOP), call('browser.observe', {}, SHOP), call('browser.finish', { summary: 'Summary: nothing' })]);
  W('shop-two-clicks', 'shop', null, [call('browser.navigate', { url: SHOP + '/p/1' }, SHOP), call('browser.click', { by: 'role', role: 'tab', name: 'Specs' }, SHOP), call('browser.click', { by: 'role', role: 'link', name: 'Next' }, SHOP), call('browser.observe', {}, SHOP), call('browser.finish', { summary: 'Summary: ok' })]);
  W('form-select-only', 'form', null, [call('browser.navigate', { url: SHOP + '/form/2' }, SHOP), call('browser.select', { by: 'label', label: 'Plan', value: 'pro' }, SHOP)]);
  W('support-read-tag', 'support', null, [call('tickets.read', { id: 5 }, API), call('tickets.tag', { id: 5, tags: ['ux', 'bug'], note: 'triage' }, API)]);
  W('support-search-only', 'support', null, [call('docs.search', { q: 'sla?' }, DOCS), call('docs.search', { q: 'refund?', limit: 2 }, DOCS)]);
  W('report-one', 'report', null, [call('files.read', { path: '/workspace/reports/z.md' }), call('files.write', { path: '/workspace/reports/out.md', content: '# Report z' })]);
  W('deploy-status-logs', 'deploy', null, [call('ci.status', { service: 'web' }, API), call('logs.read', { service: 'web' }, API)]);
  // 12 with one authored benign deviation
  const dev = (id: string, plan: string, name: string, f: (s: ProposedCall[]) => ProposedCall[]) => W(id, plan, name, f(BASES[plan]()));
  dev('shop-screenshot', 'shop', 'extra tool: screenshot', (s) => { s.splice(3, 0, call('browser.screenshot', {}, SHOP)); return s; });
  dev('shop-retry-click', 'shop', 'retry beyond max', (s) => { const c = s[2]; return [s[0], c, c, c, c, c, ...s.slice(3)]; });
  dev('shop-docs-origin', 'shop', 'second granted origin', (s) => { s.splice(1, 0, call('browser.navigate', { url: DOCS + '/help' }, DOCS)); return s; });
  dev('shop-reorder', 'shop', 'reordered: click before navigate', (s) => [s[2], s[0], ...s.slice(1, 2), ...s.slice(3)]);
  dev('shop-new-label', 'shop', 'different link name', (s) => { s[2] = call('browser.click', { by: 'role', role: 'link', name: 'Reviews' }, SHOP); return s; });
  dev('form-card-field', 'form', 'a field the plan did not list', (s) => { s[2] = call('browser.fill', { by: 'label', label: 'Phone', valueRef: 'sec_phone' }, SHOP); return s; });
  dev('form-submit', 'form', 'extra click: Next', (s) => { s.push(call('browser.click', { by: 'role', role: 'button', name: 'Next' }, SHOP)); return s; });
  dev('support-public-comment', 'support', 'wider visibility', (s) => { s[3] = call('tickets.comment', { id: 10, body: 'Re: refund steps sent', visibility: 'public' }, API); return s; });
  dev('support-assign', 'support', 'extra tool: tickets.assign', (s) => { s.push(call('tickets.assign', { id: 10, to: 'agent-2' }, API)); return s; });
  dev('report-extra-read', 'report', 'read outside the reports directory', (s) => { s.splice(1, 0, call('files.read', { path: '/workspace/notes/todo.md' })); return s; });
  dev('deploy-other-service', 'deploy', 'service not listed: database', (s) => { s[1] = call('logs.read', { service: 'database', lines: 50 }, API); return s; });
  dev('deploy-extra-metric', 'deploy', 'metric not listed: saturation', (s) => { s.push(call('metrics.query', { metric: 'saturation' }, API)); return s; });
  return out;
}
