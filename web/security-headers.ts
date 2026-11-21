// Security headers for the built web app (cycle 14). `vite preview` sends them (vite.config.ts) and the reverse-proxy
// snippet in server/README.md repeats them. The dev server can't use this CSP: Vite's HMR and the React plugin inject
// inline scripts there.
//  - scripts only from this origin, no inline script, no eval;
//  - styles from this origin, plus inline styles (see STYLE_NOTE);
//  - images/media from this origin, data: (inlined small assets) and blob: (local previews of a chosen file);
//  - fetch / EventSource only to this origin (the API sits behind the same origin at /api);
//  - no plugins, no <base>, no framing, forms only to this origin.
export const CSP_DIRECTIVES: [string, string][] = [
  ['default-src', "'self'"],
  ['script-src', "'self'"],
  ['style-src', "'self'"],
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
export const STYLE_NOTE = "style-src keeps 'unsafe-inline': UI libraries add <style> elements at run time; scripts stay strict.";

export const CSP = CSP_DIRECTIVES.map(([k, v]) => `${k} ${v}`).join('; ');

export const WEB_SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
