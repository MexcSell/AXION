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
export interface DigestContext { tenantId: string; missionId: string; taskId: string; origin: string; requestedBy: string; /** The resolved element facts the approver is shown. Bound by hash so an approval covers that element, not whatever the locator resolves to later. */ element?: ElementFacts | null }
/** Same canonical JSON as approvals/service.ts: keys sorted at every level. Kept local so this module stays free of the database. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v as object).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson((v as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(v);
}
export interface BoundAction { missionId: string; kind: 'browser-action'; payload: { v: 1; tenantId: string; taskId: string; origin: string; requestedBy: string; element: string | null; action: BrowserAction }; digest: string }
/** The action bound to the exact tenant, mission, task, origin and requester. `digest` equals approvals `digestOf(missionId, kind, payload)`. */
export function canonicalActionDigest(action: BrowserAction, context: DigestContext): BoundAction {
  const p = parseAction(action);
  if (!p.ok) throw new Error('canonicalActionDigest: invalid action: ' + p.reasons.join('; '));
  const o = originOfUrl(context.origin);
  if (!o.ok || o.origin !== context.origin) throw new Error('canonicalActionDigest: context.origin must be a normalised origin');
  const payload = { v: 1 as const, tenantId: context.tenantId, taskId: context.taskId, origin: context.origin, requestedBy: context.requestedBy, element: context.element ? createHash('sha256').update(canonicalJson(context.element)).digest('hex') : null, action: p.action };
  const digest = createHash('sha256').update(canonicalJson({ missionId: context.missionId, kind: 'browser-action', payload })).digest('hex');
  return { missionId: context.missionId, kind: 'browser-action', payload, digest };
}

// ---------------------------------------------------------------- classify
/** Facts about the resolved target, reported by the (trusted, future) executor from the DOM. `name` is page text: untrusted. */
/**
 * TRUST BOUNDARY (see STAGE7.md). Everything here except `name` must come from the executor's OWN DOM inspection of the one element the
 * locator resolved to, never from the model and never from page text. The classifier trusts these facts: a lying executor defeats it.
 * `name` (accessible name) is page text, so it is untrusted and can only RAISE a tier. `submits: 'no'` is the only value that lets a
 * click or select stay at R1: the executor must report it positively (type=button outside a form, a tab or toggle, a same-document anchor).
 * Absent, 'unknown' or any other value means R2 (ambiguous_effect).
 */
export interface ElementFacts {
  role?: string; name?: string; matches?: number; inForm?: boolean; formMethod?: 'get' | 'post';
  submits?: 'yes' | 'no' | 'unknown'; autoSubmit?: boolean; href?: string;
  /** <input type=...>, e.g. 'password'. */ inputType?: string;
  /** The autocomplete attribute, e.g. 'cc-number', 'current-password', 'one-time-code'. */ autocomplete?: string;
  /** The input's name/id attribute (untrusted text, may only raise). */ fieldName?: string;
}
/** Obligations the executor MUST honour. A download is `quarantine`d (scanned, not exposed as an artifact) before anything reads it. */
export type Obligation = 'quarantine';
/**
 * The policy decision plus obligations. `obligations` is required on the type and present on every decision. When the policy allows an
 * action that has obligations, the outcome is `allow_with_obligations`, NOT `allow`: an executor that switches on `outcome` and only runs
 * `allow` can never run such an action without going through the obligation code path, so the obligation cannot be dropped by reading
 * only the outcome.
 */
export type BrowserDecision = Omit<Decision, 'outcome'> & { outcome: Decision['outcome'] | 'allow_with_obligations'; obligations: readonly Obligation[] };
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
  decision: BrowserDecision;
  tier: RiskTier;
  /** Same as decision.obligations. Required, never undefined. */
  obligations: readonly Obligation[];
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
// Cyrillic/Greek letters that look like Latin ones, folded to the Latin letter for keyword matching (a small UTS #39 style skeleton).
const CONFUSABLE: Readonly<Record<string, string>> = Object.fromEntries(
  ('а:a е:e о:o р:p с:c у:y х:x ѕ:s і:i ј:j ԁ:d ӏ:l һ:h ԛ:q ԝ:w ɡ:g ο:o α:a ν:v ρ:p ι:i τ:t κ:k υ:u β:b ε:e η:n μ:u χ:x ʏ:y ᴅ:d ɑ:a ɴ:n ꜱ:s').split(' ').map((p) => [p[0], p[2]] as const));
/** NFKC, then NFD with every mark (\p{M}) removed, hidden characters removed, case-folded. */
const fold = (s: string) => s.normalize('NFKC').normalize('NFD').replace(/\p{M}/gu, '').replace(HIDDEN_ALL, '').toLowerCase();
const skeleton = (f: string) => Array.from(f, (ch) => CONFUSABLE[ch] ?? ch).join('');
/** True when some word mixes Latin letters with letters of another script (the classic homoglyph shape). */
const mixedScript = (s: string) => s.normalize('NFKC').replace(HIDDEN_ALL, '').split(/[^\p{L}\p{M}]+/u).some((w) => /\p{Script=Latin}/u.test(w) && /(?!\p{Script=Latin})\p{L}/u.test(w));
/** True when nothing visible is left: spaces of every kind (NBSP, ideographic, em), zero-width, Hangul fillers. */
const blank = (s: string) => s.replace(HIDDEN_ALL, '').replace(/[\s\p{Z}ㅤᅟᅠ]/gu, '') === '';

// Keyword raise list. Latin words match at a word start, optionally after re/un/pre/auto ("Display" does not match "pay"; "Resend", "Prepay" do);
// CJK words match anywhere. Over-raising is safe. This list is a SUPPLEMENT: the structural rules (submits must be a positive 'no') come first.
const kw = (latin: string[], cjk: string[]) => new RegExp(`(?<![\\p{L}\\p{N}])(?:re|un|pre|auto)?(?:${latin.join('|')})|(?:${cjk.join('|')})`, 'u');
const KEYWORDS: readonly (readonly [string, RegExp])[] = [
  ['release', kw(['deploy', 'bereitstellen', 'desplegar', 'deployer', 'distribuire'], ['デプロイ', '部署'])],
  ['send_message', kw(['send', 'invite', 'message', 'reply', 'envoyer', 'enviar', 'senden', 'einladen', 'invi[ao]re', 'inviar', 'invitar', 'inviter', 'comment', 'share'], ['送信', '发送', '發送', '送る', '邀请'])],
  ['publish_post', kw(['publish', 'ver[o]ffentlichen', 'publicar', 'publier', 'pubblica', 'post', 'tweet'], ['公開', '发布', '發布'])],
  ['submit_bid', kw(['bid', 'bieten', 'pujar', 'enchere'], ['入札', '投标'])],
  ['change_external_setting', kw(['delete', 'remove', 'l[o]schen', 'eliminar', 'supprimer', 'elimina', 'entfernen', 'unsubscribe', 'cancel', 'close account', 'deactivate', 'log ?out', 'sign ?out'], ['削除', '删除', '刪除'])],
  ['submit_form', kw(['submit', 'pay', 'buy', 'purchase', 'checkout', 'check ?out', 'place order', 'order', 'donate', 'subscribe', 'register', 'apply', 'sign ?up', 'join', 'vote', 'add to cart', 'confirm', 'transfer', 'withdraw', 'best[a]tigen', 'confirmar', 'confirmer', 'confermare', 'kaufen', 'bezahlen', 'pagar', 'comprar', 'acheter', 'payer', 'acquista', '[u]berweisen', 'transferir'], ['支払', '购买', '購入', '确认', '確認', '转账', '振込', '付款'])],
];
// Sensitive-field names (a fill into one needs a sec_ reference).
const SENSITIVE = /(?<![\p{L}\p{N}])(?:card|cvv|cvc|csc|iban|ssn|password|passcode|passwort|contrasena|mot de passe)/u;
const SENSITIVE_AUTOCOMPLETE = /^(?:cc-|current-password|new-password|one-time-code)/i;

interface NameFacts { kinds: string[]; mixed: boolean; blank: boolean }
function nameFacts(names: readonly (string | undefined)[]): NameFacts {
  const kinds = new Set<string>();
  let mixed = false, isBlank = false;
  for (const n of names) {
    if (typeof n !== 'string') continue;
    if (blank(n)) { isBlank = true; continue; }
    if (mixedScript(n)) mixed = true;
    const f = fold(n);
    for (const v of [f, skeleton(f)]) for (const [kind, re] of KEYWORDS) if (re.test(v)) kinds.add(kind);
  }
  return { kinds: [...kinds], mixed, blank: isBlank };
}
const isSensitiveName = (names: readonly (string | undefined)[]) => names.some((n) => typeof n === 'string' && [fold(n), skeleton(fold(n))].some((v) => SENSITIVE.test(v)));

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

function deny(tier: RiskTier, reasons: string[], origin: string | null, kind: string, extra: Partial<Classification> = {}, policyReason: ReasonCode = 'no_grant'): Classification {
  const obligations: readonly Obligation[] = extra.quarantine ? ['quarantine'] : [];
  const decision: BrowserDecision = { outcome: 'deny', tier, approver: null, reasons: [policyReason], policyVersion: CURRENT_BASELINE.version, obligations };
  return { decision, tier, kind, origin, quarantine: false, obligations, reasons: [policyReason, ...reasons], policyAction: null, ...extra };
}

const higher = (a: string, b: string) => (tierRank(CURRENT_BASELINE.kinds[b]!.tier) > tierRank(CURRENT_BASELINE.kinds[a]!.tier) ? b : a);

const withObligations = (d: Decision, obligations: readonly Obligation[]): BrowserDecision =>
  ({ ...d, outcome: d.outcome === 'allow' && obligations.length ? 'allow_with_obligations' : d.outcome, obligations });

export function classifyAction(action: BrowserAction, page: PageContext | null, opts: ClassifyOptions): Classification {
  const reasons: string[] = [];
  let quarantine = false;
  const ev = (kind: string, origin: string, payload: Record<string, unknown>) => {
    const pa = asPolicyAction(kind, origin, opts, payload);
    return { pa, decision: evaluate(pa, opts.grants, opts.tenantPolicy, opts.now) };
  };
  const finish = (kind: string, origin: string, payload: Record<string, unknown>): Classification => {
    const { pa, decision } = ev(kind, origin, payload);
    const obligations: readonly Obligation[] = quarantine ? ['quarantine'] : [];
    return { decision: withObligations(decision, obligations), tier: decision.tier, obligations, kind, origin, quarantine, reasons: [...new Set([...decision.reasons, ...reasons])], policyAction: pa };
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
    const base: Classification = { decision: withObligations(main.decision, []), tier: main.decision.tier, obligations: [], kind: 'read', origin: dest.origin, quarantine: false, reasons: [...main.decision.reasons], policyAction: main.pa };
    if (hopBad) return { ...base, decision: { ...base.decision, outcome: 'deny', approver: null, reasons: [...new Set([...main.decision.reasons, 'out_of_scope' as ReasonCode])] }, reasons: [...main.decision.reasons, 'out_of_scope', 'redirect_ungranted'] };
    return base;
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
      // fail closed: only a positive submits:'no' from the executor's own DOM facts keeps a click at R1
      if (!resolved || !CLICK_ROLES.has(role)) kind = ambiguous();
      else if (e!.submits === 'yes' || (e!.inForm === true && e!.submits !== 'no')) { reasons.push('submit_path'); kind = 'submit_form'; }
      else if (e!.submits !== 'no') kind = ambiguous();
      else kind = 'fill_draft';
      break;
    }
    case 'select': {
      if (!resolved || !SELECT_ROLES.has(role)) kind = ambiguous();
      else if (e!.autoSubmit === true || e!.submits === 'yes' || (e!.inForm === true && e!.submits !== 'no')) { reasons.push('submit_path'); kind = 'submit_form'; }
      else if (e!.submits !== 'no') kind = ambiguous();
      else kind = 'fill_draft';
      break;
    }
    case 'fill': {
      if (!resolved || !INPUT_ROLES.has(role)) kind = ambiguous();
      else if (e!.autoSubmit === true || e!.submits === 'yes') { reasons.push('submit_path'); kind = 'submit_form'; }
      else kind = 'fill_draft';
      // The val_/sec_ prefix is bound to the stored value's secret flag by the Stage 7 value resolver (it rejects a mismatch).
      // Here the SENSITIVE FIELD is decided from the executor's element facts (and, only to raise, names): a sensitive field takes a sec_ ref only.
      const sensitive = resolved && (e!.inputType?.toLowerCase() === 'password' || SENSITIVE_AUTOCOMPLETE.test(e!.autocomplete ?? '')
        || isSensitiveName([e!.name, e!.fieldName, ...(target ? locatorText(target) : [])]));
      if (sensitive && action.valueRef.startsWith('val_')) return deny(CURRENT_BASELINE.kinds.submit_form.tier, [...reasons, 'secret_via_value_ref'], origin, 'submit_form', {}, 'prohibited');
      if (action.valueRef.startsWith('sec_')) { kind = higher(kind, 'submit_form'); reasons.push('secret_value'); }
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
    if (h.kind === 'unsafe') return deny(CURRENT_BASELINE.kinds[kind].tier, ['unsafe_href'], origin, kind, { quarantine, obligations: quarantine ? ['quarantine'] : [] });
    if (h.kind === 'cross') {
      const covered = h.origin !== null && ev('read', h.origin, payload).decision.outcome !== 'deny';
      if (!covered) return deny(CURRENT_BASELINE.kinds[kind].tier, [...reasons, 'link_origin_ungranted'], origin, kind, { quarantine, obligations: quarantine ? ['quarantine'] : [] });
    }
  }

  const structuralKind = kind;
  // page text may only RAISE (keyword list, mixed-script names, blank names), never lower. Runs for click, fill, select and download.
  if (action.type === 'click' || action.type === 'fill' || action.type === 'select' || action.type === 'download') {
    const nf = nameFacts([...(target ? locatorText(target) : []), e?.name]);
    for (const k of nf.kinds) {
      const raised = higher(kind, k);
      if (raised !== kind) { kind = raised; if (!reasons.includes('keyword_raise')) reasons.push('keyword_raise'); }
    }
    if (nf.mixed) { reasons.push('mixed_script_name'); kind = higher(kind, 'submit_form'); }
    if (nf.blank) { reasons.push('blank_name'); kind = higher(kind, 'submit_form'); }
  }

  let c = finish(kind, origin, payload);
  if (kind !== structuralKind) {
    // page text raised the kind. A raise must never turn a refusal into a request for approval: if the structural kind was denied
    // (for example no grant for a draft action), the raised action stays denied.
    const sd = ev(structuralKind, origin, payload).decision;
    if (sd.outcome === 'deny') {
      c = { ...c, decision: { ...c.decision, outcome: 'deny', approver: null, reasons: [...new Set([...c.decision.reasons, ...sd.reasons])] }, reasons: [...new Set([...c.reasons, ...sd.reasons])] };
    }
  }
  if (changed) return { ...c, decision: { ...c.decision, outcome: 'deny', approver: null }, reasons: [...c.reasons, 'origin_changed'] };
  return c;
}
