// Browser action contract: parse, canonical digest, classify. PURE. No executor, no browser, no network, no model.
// Spec §10.7 and §13.2. The tier of an action comes from its STRUCTURE (action type, the resolved element's facts reported by
// the trusted executor, the revalidated origin) and the policy service (evaluate). Page text (titles, visible text, accessible
// names) is untrusted: it can only RAISE a tier through a keyword list, never lower it and never change the origin.
// Ambiguity fails closed: the higher tier, with reason `ambiguous_effect`.
import { createHash } from 'node:crypto';
import type { BrowserAction, Locator } from '../../../shared/contracts/src/browser.ts';
import { CURRENT_BASELINE, evaluate, tierRank, type Action, type Decision, type Grant, type ReasonCode, type RiskTier, type TenantPolicy, type Requester } from '../policy/index.ts';
import { browserActionSchema, forbiddenKeysIn, originOfUrl } from './schema.ts';

export type { BrowserAction, Locator };

// ---------------------------------------------------------------- parse
export type ParseResult = { ok: true; action: BrowserAction; warnings: string[] } | { ok: false; reasons: string[] };

export function parseAction(raw: unknown): ParseResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reasons: ['not_an_object: an action is one JSON object'] };
  const reasons: string[] = forbiddenKeysIn(raw).map((k) => `forbidden_field: "${k}" carries code or a protocol call; actions are structured data only`);
  const r = browserActionSchema.safeParse(raw);
  if (!r.success) {
    for (const i of r.error.issues) reasons.push(`${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`);
  }
  if (reasons.length) return { ok: false, reasons };
  const action = (r as { success: true; data: BrowserAction }).data;
  const warnings: string[] = [];
  if ('target' in action && action.target.by === 'css') warnings.push('css_fallback');
  return { ok: true, action, warnings };
}

// ---------------------------------------------------------------- digest (compatible with approvals digestOf)
export interface DigestContext { tenantId: string; missionId: string; taskId: string; origin: string; requestedBy: string }
/** Same canonical JSON as approvals/service.ts: keys sorted at every level. Kept local so this module stays free of the database. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v as object).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson((v as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(v);
}
export interface BoundAction { missionId: string; kind: 'browser-action'; payload: { v: 1; tenantId: string; taskId: string; origin: string; requestedBy: string; action: BrowserAction }; digest: string }
/** The action bound to the exact tenant, mission, task, origin and requester. `digest` equals approvals `digestOf(missionId, kind, payload)`. */
export function canonicalActionDigest(action: BrowserAction, context: DigestContext): BoundAction {
  const p = parseAction(action);
  if (!p.ok) throw new Error('canonicalActionDigest: invalid action: ' + p.reasons.join('; '));
  const o = originOfUrl(context.origin);
  if (!o.ok || o.origin !== context.origin) throw new Error('canonicalActionDigest: context.origin must be a normalised origin');
  const payload = { v: 1 as const, tenantId: context.tenantId, taskId: context.taskId, origin: context.origin, requestedBy: context.requestedBy, action: p.action };
  const digest = createHash('sha256').update(canonicalJson({ missionId: context.missionId, kind: 'browser-action', payload })).digest('hex');
  return { missionId: context.missionId, kind: 'browser-action', payload, digest };
}

// ---------------------------------------------------------------- classify
/** Facts about the resolved target, reported by the (trusted, future) executor from the DOM. `name` is page text: untrusted. */
export interface ElementFacts {
  role?: string; name?: string; matches?: number; inForm?: boolean; formMethod?: 'get' | 'post';
  submits?: 'yes' | 'no' | 'unknown'; autoSubmit?: boolean; href?: string;
}
export interface PageContext {
  /** The origin the plan expected the action to run on. A different actual origin denies. */
  expectedOrigin?: string;
  /** The URL the browser is actually on, revalidated before this action. The only source of the origin. */
  actualUrl: string;
  /** For navigate: every URL of the redirect chain. Each hop's origin must be granted. */
  redirects?: string[];
  title?: string; visibleText?: string; element?: ElementFacts;
}
export interface ClassifyOptions { requester: Requester; grants: readonly Grant[]; now: number; missionId?: string; tenantPolicy?: TenantPolicy }
export interface Classification {
  decision: Decision;
  tier: RiskTier;
  /** The policy kind that was evaluated. */
  kind: string;
  /** The revalidated origin the decision is about (null when it could not be determined). */
  origin: string | null;
  quarantine: boolean;
  /** Policy reason codes plus browser reasons (ambiguous_effect, submit_path, keyword_raise, origin_changed, ...). */
  reasons: string[];
  policyAction: Action | null;
}

const CLICK_ROLES = new Set(['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'switch', 'option', 'combobox', 'textbox', 'searchbox', 'menuitemcheckbox', 'menuitemradio', 'treeitem']);
const INPUT_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);
const SELECT_ROLES = new Set(['combobox', 'listbox', 'option', 'menuitem']);

const HIDDEN = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/;
const HIDDEN_ALL = new RegExp(HIDDEN.source, 'g');
const fold = (s: string) => s.normalize('NFKC').replace(HIDDEN_ALL, '').toLowerCase();

// Keyword raise list. Latin words match at a word start (so "Display" does not match "pay"); CJK words match anywhere. Over-raising is safe.
const kw = (latin: string[], cjk: string[]) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${latin.join('|')})|(?:${cjk.join('|')})`, 'u');
const KEYWORDS: readonly (readonly [string, RegExp])[] = [
  ['release', kw(['deploy', 'bereitstellen', 'desplegar', 'd[eé]ployer', 'distribuire'], ['デプロイ', '部署'])],
  ['send_message', kw(['send', 'invite', 'message', 'reply', 'envoyer', 'enviar', 'senden', 'einladen', 'invi[ao]re', 'inviar', 'invitar', 'inviter'], ['送信', '发送', '發送', '送る', '邀请'])],
  ['publish_post', kw(['publish', 'ver[öo]ffentlichen', 'publicar', 'publier', 'pubblica'], ['公開', '发布', '發布'])],
  ['submit_bid', kw(['bid', 'bieten', 'pujar', 'ench[eè]re'], ['入札', '投标'])],
  ['change_external_setting', kw(['delete', 'remove', 'l[öo]schen', 'eliminar', 'supprimer', 'elimina', 'entfernen', 'unsubscribe'], ['削除', '删除', '刪除'])],
  ['submit_form', kw(['submit', 'pay', 'buy', 'purchase', 'checkout', 'confirm', 'transfer', 'withdraw', 'best[äa]tigen', 'confirmar', 'confirmer', 'confermare', 'kaufen', 'bezahlen', 'pagar', 'comprar', 'acheter', 'payer', 'acquista', 'senden', '[üu]berweisen', 'transferir'], ['支払', '购买', '購入', '确认', '確認', '转账', '振込', '付款'])],
];

function keywordKinds(names: readonly (string | undefined)[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    if (!n) continue;
    const f = fold(n);
    for (const [kind, re] of KEYWORDS) if (re.test(f)) out.add(kind);
  }
  return [...out];
}

const locatorText = (l: Locator): string[] => l.by === 'role' ? [l.name] : l.by === 'label' ? [l.label] : l.by === 'testId' ? [l.testId] : [];

function hrefVerdict(href: string | undefined, actualOrigin: string): { kind: 'none' | 'same' | 'unsafe' } | { kind: 'cross'; origin: string | null } {
  if (href === undefined || href === '') return { kind: 'none' };
  if (/[\s\\]/.test(href) || HIDDEN.test(href)) return { kind: 'unsafe' };
  if (href.startsWith('//')) { const o = originOfUrl('https:' + href); return { kind: 'cross', origin: o.ok ? o.origin : null }; }
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    if (!/^https:/i.test(href)) return { kind: 'unsafe' };
    const o = originOfUrl(href);
    if (o.ok && o.origin === actualOrigin) return { kind: 'same' };
    return { kind: 'cross', origin: o.ok ? o.origin : null };
  }
  return { kind: 'same' }; // relative: resolves on the current origin
}

const asPolicyAction = (kind: string, origin: string, opts: ClassifyOptions, payload: Record<string, unknown>): Action =>
  ({ kind, origin, ...(opts.missionId ? { missionId: opts.missionId } : {}), requester: opts.requester, effect: CURRENT_BASELINE.kinds[kind]!.effect, payload });

function deny(tier: RiskTier, reasons: string[], origin: string | null, kind: string, extra: Partial<Classification> = {}): Classification {
  const decision: Decision = { outcome: 'deny', tier, approver: null, reasons: ['no_grant'], policyVersion: CURRENT_BASELINE.version };
  return { decision, tier, kind, origin, quarantine: false, reasons: ['no_grant', ...reasons], policyAction: null, ...extra };
}

const higher = (a: string, b: string) => (tierRank(CURRENT_BASELINE.kinds[b]!.tier) > tierRank(CURRENT_BASELINE.kinds[a]!.tier) ? b : a);

export function classifyAction(action: BrowserAction, page: PageContext | null, opts: ClassifyOptions): Classification {
  const reasons: string[] = [];
  let quarantine = false;
  const ev = (kind: string, origin: string, payload: Record<string, unknown>) => {
    const pa = asPolicyAction(kind, origin, opts, payload);
    return { pa, decision: evaluate(pa, opts.grants, opts.tenantPolicy, opts.now) };
  };
  const finish = (kind: string, origin: string, payload: Record<string, unknown>, extra: string[] = []): Classification => {
    const { pa, decision } = ev(kind, origin, payload);
    return { decision, tier: decision.tier, kind, origin, quarantine, reasons: [...new Set([...decision.reasons, ...reasons, ...extra])], policyAction: pa };
  };

  if (action.type === 'navigate') {
    const dest = originOfUrl(action.url);
    if (!dest.ok) return deny('R4', ['origin_invalid'], null, 'read');
    const payload = { actionType: 'navigate' };
    const main = ev('read', dest.origin, payload);
    const hops = new Set<string>();
    let hopBad = false;
    for (const h of page?.redirects ?? []) {
      const o = originOfUrl(h);
      if (!o.ok) { hopBad = true; continue; }
      if (o.origin !== dest.origin) hops.add(o.origin);
    }
    for (const h of hops) if (ev('read', h, payload).decision.outcome === 'deny') hopBad = true;
    if (hopBad) return { decision: { ...main.decision, outcome: 'deny', approver: null, reasons: [...new Set([...main.decision.reasons, 'out_of_scope' as ReasonCode])] }, tier: main.decision.tier, kind: 'read', origin: dest.origin, quarantine: false, reasons: [...main.decision.reasons, 'out_of_scope', 'redirect_ungranted'], policyAction: main.pa };
    return { decision: main.decision, tier: main.decision.tier, kind: 'read', origin: dest.origin, quarantine: false, reasons: [...main.decision.reasons], policyAction: main.pa };
  }

  // every other action runs on the page the browser is on RIGHT NOW: the origin comes only from the revalidated URL
  if (!page) return deny('R4', ['origin_invalid'], null, 'read');
  const actual = originOfUrl(page.actualUrl);
  if (!actual.ok) return deny('R4', ['origin_invalid'], null, 'read');
  const origin = actual.origin;
  const changed = page.expectedOrigin !== undefined && page.expectedOrigin !== origin;

  let kind: string;
  let payload: Record<string, unknown> = { actionType: action.type };
  const e = page.element;
  const resolved = !!e && e.matches === 1 && typeof e.role === 'string' && e.role.trim() !== '';
  const role = resolved ? e!.role!.trim().toLowerCase() : '';
  const ambiguous = () => { reasons.push('ambiguous_effect'); return 'submit_form'; };
  const target = 'target' in action ? action.target : undefined;
  if (target) payload = { actionType: action.type, locator: target.by };
  if (target?.by === 'css') reasons.push('css_fallback');

  switch (action.type) {
    case 'observe': case 'scroll': case 'waitFor': kind = 'read'; break;
    case 'screenshot': kind = 'screenshot'; break;
    case 'finish': kind = 'summarize'; break;
    case 'click': {
      if (!resolved || !CLICK_ROLES.has(role)) kind = ambiguous();
      else if (e!.submits === 'yes' || (e!.inForm === true && e!.submits !== 'no')) { reasons.push('submit_path'); kind = 'submit_form'; }
      else kind = 'fill_draft';
      break;
    }
    case 'fill': case 'select': {
      const roles = action.type === 'fill' ? INPUT_ROLES : SELECT_ROLES;
      if (!resolved || !roles.has(role)) kind = ambiguous();
      else if (e!.autoSubmit === true || e!.submits === 'yes') { reasons.push('submit_path'); kind = 'submit_form'; }
      else kind = 'fill_draft';
      if (action.type === 'fill' && action.valueRef.startsWith('sec_')) { kind = higher(kind, 'submit_form'); reasons.push('secret_value'); }
      break;
    }
    case 'download': {
      quarantine = true; reasons.push('quarantine');
      kind = !resolved || !CLICK_ROLES.has(role) ? ambiguous() : 'fill_draft';
      break;
    }
  }

  // a link-like target that leaves the origin needs its own grant; an unsafe scheme is refused
  if ((action.type === 'click' || action.type === 'download') && resolved) {
    const h = hrefVerdict(e!.href, origin);
    if (h.kind === 'unsafe') return deny(CURRENT_BASELINE.kinds[kind].tier, ['unsafe_href'], origin, kind, { quarantine });
    if (h.kind === 'cross') {
      const covered = h.origin !== null && ev('read', h.origin, payload).decision.outcome !== 'deny';
      if (!covered) return deny(CURRENT_BASELINE.kinds[kind].tier, [...reasons, 'link_origin_ungranted'], origin, kind, { quarantine });
    }
  }

  // page text may only RAISE: keyword list on the accessible name, never lowering
  if (action.type === 'click' || action.type === 'fill' || action.type === 'select') {
    for (const k of keywordKinds([...(target ? locatorText(target) : []), e?.name])) {
      const raised = higher(kind, k);
      if (raised !== kind) { kind = raised; if (!reasons.includes('keyword_raise')) reasons.push('keyword_raise'); }
    }
  }

  const c = finish(kind, origin, payload);
  if (changed) {
    return { ...c, decision: { ...c.decision, outcome: 'deny', approver: null }, reasons: [...c.reasons, 'origin_changed'] };
  }
  return c;
}
