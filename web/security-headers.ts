// Security headers for the built web app (cycle 14). `vite preview` sends them (vite.config.ts) and the reverse-proxy
// snippet in server/README.md repeats them. The dev server can't use this CSP: Vite's HMR and the React plugin inject
// inline scripts there.
//  - scripts only from this origin, no inline script, no eval;
//  - stylesheets from this origin; style="" attributes in markup blocked; <style> elements allowed (see STYLE_NOTE);
//  - images/media from this origin, data: (inlined small assets) and blob: (local previews of a chosen file);
//  - fetch / EventSource only to this origin (the API sits behind the same origin at /api);
//  - no plugins, no <base>, no framing, forms only to this origin.
export const CSP_DIRECTIVES: [string, string][] = [
  ['default-src', "'self'"],
  ['script-src', "'self'"],
  ['style-src', "'self'"],
  ['style-src-elem', "'self' 'unsafe-inline'"],
  ['img-src', "'self' data: blob:"],
  ['font-src', "'self' data:"],
  ['media-src', "'self' blob:"],
  ['connect-src', "'self'"],
  ['worker-src', "'self'"],
  ['manifest-src', "'self'"],
  ['object-src', "'none'"],
  ['frame-src', "'none'"],
  ['base-uri', "'none'"],
  ['form-action', "'self'"],
  ['frame-ancestors', "'none'"],
];
/** Measured under `vite preview` (api-c14.mjs): the only violation with style-src 'self' alone was a <style> element that
 *  react-remove-scroll (used by the Radix dropdown menu) adds with the scrollbar width in it, so its content varies and a
 *  hash can't match, and a static server has no nonce. So style-src-elem allows inline <style> elements; style="" attributes
 *  (style-src-attr falls back to style-src 'self') stay blocked. React's style prop goes through CSSOM and is unaffected. */
export const STYLE_NOTE = "style-src-elem allows inline <style> elements (react-remove-scroll); everything else stays 'self'.";

export const CSP = CSP_DIRECTIVES.map(([k, v]) => `${k} ${v}`).join('; ');

export const WEB_SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
