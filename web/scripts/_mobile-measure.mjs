// The in-page measurement shared by api-mobile.mjs and selftest-mobile.mjs (it runs inside the browser page).
export const MEASURE = () => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return null; const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) return null; if (el.closest('[aria-hidden="true"],[inert]')) return null;
    // c40: an element animating OUT (the app marks it data-exiting) is leaving, not laid out; everything at rest is still measured
    if (el.closest('[data-exiting="true"]')) return null; return r; };
  const sig = (el) => { const t = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24); const c = (typeof el.className === 'string' ? el.className : '').split(' ').filter(Boolean).slice(0, 2).join('.'); return `${el.tagName.toLowerCase()}${c ? '.' + c : ''}[${t}]`; };
  // the topmost layer: an open dialog scopes the checks, otherwise the whole page
  const dlgs = [...document.querySelectorAll('[role="dialog"]')]; const top = dlgs[dlgs.length - 1] || null;
  const root = top || document.body;
  const clipped = [], small = [];
  const scrollAnc = (el) => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); if (/(auto|scroll)/.test(s.overflowX) && a.scrollWidth > a.clientWidth + 1) return a; } return null; };
  for (const el of root.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,[role=tab],[role=button],[role=menuitem]')) {
    const r = vis(el); if (!r) continue;
    // inside a horizontally scrollable strip (tabs, tables): off-screen part is reachable by scrolling, so not clipped
    const out = r.right > vw + 1 || r.left < -1;
    if (out && !scrollAnc(el)) clipped.push(sig(el) + ` x=${Math.round(r.left)}..${Math.round(r.right)}`);
    if (!top && el.closest('.rail, .rail-nav') && out) { /* off-canvas rail items are not shown */ }
    if ((r.width < 39.5 || r.height < 39.5) && r.right > 0 && r.left < vw && r.bottom > 0 && r.top < vh && !(el.tagName === 'INPUT' && /checkbox|radio/.test(el.type) && el.closest('label'))) small.push(sig(el) + ` ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  let dlg = null;
  if (top) { const r = top.getBoundingClientRect(); const body = top.querySelector('.modal-body'); dlg = { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), fits: r.left >= -1 && r.top >= -1 && r.right <= vw + 1 && r.bottom <= vh + 1, bodyScroll: body ? body.scrollHeight > body.clientHeight + 1 : false, bodyX: body ? body.scrollWidth - body.clientWidth : 0, label: (top.querySelector('.modal-title')?.textContent || top.getAttribute('aria-label') || '').slice(0, 40), id: top.getAttribute('data-dialog') }; }
  // page overflow: the document, plus the app's own scrollers that should never scroll sideways
  const over = document.documentElement.scrollWidth - vw;
  return { over, clipped, small, dlg };
};

