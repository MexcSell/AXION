/**
 * Security headers on every API response (cycle 14). JSON never needs to load anything, so the API's own CSP denies
 * everything and any framing. A route that sets its own Content-Security-Policy (uploads: `sandbox; …`) keeps it.
 * The hijacked SSE response gets the same headers in its writeHead (onSend never runs there).
 */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";
export const API_SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
};
