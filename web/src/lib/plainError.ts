import { ApiFailure } from '@/api/client';

/**
 * c89: one plain sentence for every refusal the plan and forecast routes can give. The server's own message is kept when it is already plain;
 * the codes below get a sentence that says what to do next. Nothing here can print null, undefined or NaN.
 */
const BY_CODE: Record<string, string> = {
  PLAN_SHA_REQUIRED: 'This proposal has a change plan. Read the plan on the card, then approve again so the approval names it.',
  PROPOSAL_CHANGED: 'The proposal or its plan changed after you opened it. Reload and read it again before deciding.',
  PLAN_LOCKED: 'This proposal is no longer pending, so its plan can no longer be replaced. After approval a change is an amendment.',
  PLAN_NOT_APPLIED: 'Only an applied proposal can be amended; a pending one has its plan replaced instead.',
  PLAN_MISSING: 'This proposal has no change plan.',
  FORBIDDEN: 'Only administrators can read or decide a change plan.',
  NOT_FOUND: 'That item was not found, or you cannot see it.',
  NETWORK: 'The AXION server is not reachable. Nothing was recorded; try again in a moment.',
  UNAUTHENTICATED: 'You are signed out. Sign in again to continue.',
  SESSION_REVOKED: 'You are signed out. Sign in again to continue.',
};
const FORECAST: Record<string, string> = {
  exists: 'You already recorded a forecast for this task. A forecast is final and cannot be changed or repeated.',
  closed: 'This task can no longer take a forecast: its first review already exists, or the task was canceled or archived.',
};
const clean = (s: unknown): string => (typeof s === 'string' && s.trim() && !/\b(null|undefined|NaN)\b/.test(s) ? s.trim() : '');

export function plainError(e: unknown): string {
  if (!(e instanceof ApiFailure)) return 'Something went wrong. Nothing was recorded.';
  const f = e.fieldErrors?.forecast;
  if (e.code === 'CONFLICT' && f && FORECAST[f]) return FORECAST[f];
  if (e.code === 'CONFLICT' && f) return clean(e.message) || 'This forecast conflicts with the task as it is now.';
  if (e.code === 'VALIDATION' || e.code === 'BAD_REQUEST') return clean(e.message) || 'The server did not accept that input.';
  if (BY_CODE[e.code]) return BY_CODE[e.code];
  if (e.status === 429) return 'Too many requests. Wait a moment and try again.';
  if (e.status >= 500) return 'The AXION server could not do that right now. Try again in a moment.';
  return clean(e.message) || 'Something went wrong. Nothing was recorded.';
}

/** A number for display: never "NaN", "null" or "undefined". */
export const fixed = (x: number | null | undefined, d = 3): string => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : 'n/a');
export const percent = (p: number | null | undefined): string => (typeof p === 'number' && Number.isFinite(p) ? `${Math.round(p * 100)}%` : 'n/a');
