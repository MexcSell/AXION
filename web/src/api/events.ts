import { useEffect } from 'react';
import type { DomainEvent } from '@contracts';
import { useData, loadSnapshot, refreshMission, refreshApprovals, refreshNotices, clearServerData } from '@/store/data';
import { authApi, useAuth } from '@/store/auth';
import { isApi } from './mode';
import { api, ApiFailure } from './client';

/**
 * Live sync (Stage 5, spec §12.2): one EventSource per tab. The browser resends Last-Event-ID on reconnect;
 * on every (re)open we also reload the snapshot, so a gap or a server restart never loses or duplicates rows.
 * Events only trigger re-reads of the affected records — the server stays the only source of truth —
 * so open dialogs, drafts, selection and scroll position are never reset.
 */
const STALE_AFTER_MS = 30_000;
/** The server sends `ping` every 15 s; silence for this long means a dead link (proxy, tunnel): reconnect. */
const SILENCE_MS = 35_000;

function debounceKeyed(fn: (k: string) => void, ms: number) {
  const t = new Map<string, number>();
  const call = (k: string) => { const x = t.get(k); if (x) window.clearTimeout(x); t.set(k, window.setTimeout(() => { t.delete(k); fn(k); }, ms)); };
  call.cancel = () => { t.forEach((x) => window.clearTimeout(x)); t.clear(); };
  return call;
}

export function startSync(): () => void {
  let es: EventSource | null = null;
  let closed = false;
  let downSince = 0;
  let staleTimer = 0;
  const seen = new Set<string>();
  const set = (connection: 'live' | 'reconnecting' | 'stale' | 'off') => { if (useData.getState().connection !== connection) useData.setState({ connection }); };

  const mission = debounceKeyed((id) => { void refreshMission(id).then((r) => { if (r === 'gone') window.dispatchEvent(new CustomEvent('axion:mission-gone', { detail: id })); }).catch(() => undefined); }, 120);
  const approvals = debounceKeyed(() => { void refreshApprovals().catch(() => undefined); }, 150);
  const notices = debounceKeyed(() => { void refreshNotices().catch(() => undefined); }, 150);
  const people = debounceKeyed(() => { void authApi.refresh(); }, 200);

  let retries = 0;
  /** The stream closed for good (non-200): find out whether the session is still valid before reopening. */
  const recover = async () => {
    try { await api('GET', '/me', undefined, { quietAuth: true }); }
    catch (e) {
      if (e instanceof ApiFailure && e.status === 401) { await authApi.boot(); return; } // review I5: back to Connect with the reason
    }
    if (closed) return;
    const delay = Math.min(30_000, 2000 * 2 ** retries++);
    window.setTimeout(open, delay);
  };

  const onEvent = (type: string, raw: MessageEvent) => {
    if (raw.lastEventId) { if (seen.has(raw.lastEventId)) return; seen.add(raw.lastEventId); if (seen.size > 5000) seen.clear(); }
    let e: DomainEvent;
    try { e = JSON.parse(raw.data); } catch { return; }
    useData.setState({ lastEventAt: Date.now() });
    if (e.subject.kind === 'mission') mission(e.subject.id);
    if (type.startsWith('approval.')) approvals('a');
    if (type === 'notification.created') notices('n');
    if (type.startsWith('user.') || type.startsWith('auth.')) people('p');
  };

  let lastHeard = Date.now();
  const heard = () => { lastHeard = Date.now(); };
  const watchdog = window.setInterval(() => {
    if (closed || !es || Date.now() - lastHeard < SILENCE_MS) return;
    es.close(); es = null;
    if (!downSince) { downSince = Date.now(); set('reconnecting'); staleTimer = window.setTimeout(() => set('stale'), STALE_AFTER_MS); }
    heard(); open();
  }, 5000);

  const open = () => {
    if (closed) return;
    es = new EventSource('/api/v1/events/stream');
    es.onmessage = heard;
    es.addEventListener('ping', heard);
    es.addEventListener('hello', () => {
      heard();
      downSince = 0; retries = 0; window.clearTimeout(staleTimer);
      set('live');
      // the snapshot is read after the stream's cursor exists, so nothing committed in between is missed
      void loadSnapshot().catch(() => undefined);
    });
    for (const t of ['mission.created', 'mission.revised', 'mission.stateChanged', 'mission.shared', 'mission.deleted', 'staffing.progressed', 'approval.requested', 'approval.decided', 'notification.created', 'user.requested', 'user.changed', 'auth.approved'])
      es.addEventListener(t, (ev) => { heard(); onEvent(t, ev as MessageEvent); });
    // the server ends the stream when this session was revoked: re-check, which returns to Connect with the reason
    es.addEventListener('auth', () => {
      es?.close(); es = null;
      // review I6: re-check; if this browser is (again) signed in as the same user, follow it with a fresh stream
      // (another user means a new meId, and useServerSync restarts sync from scratch)
      void authApi.boot().then(() => { if (!closed && useAuth.getState().server.phase === 'connected') { downSince = Date.now(); open(); } });
    });
    es.onerror = () => {
      if (closed) return;
      if (!downSince) { downSince = Date.now(); set('reconnecting'); staleTimer = window.setTimeout(() => set('stale'), STALE_AFTER_MS); }
      if (es && es.readyState === EventSource.CLOSED) { es = null; void recover(); } // e.g. 401, or a proxy 502 while the API restarts
    };
  };

  open();
  // if the stream can't open at all, still show the data
  const fallback = window.setTimeout(() => { if (!useData.getState().loaded) void loadSnapshot().catch(() => undefined); }, 3000);
  return () => {
    closed = true; es?.close(); window.clearTimeout(staleTimer); window.clearTimeout(fallback); window.clearInterval(watchdog);
    mission.cancel(); approvals.cancel(); notices.cancel(); people.cancel(); // no refresh fires after sign-out
    set('off');
  };
}

/** Mounted once in the signed-in shell (api mode only). */
export function useServerSync() {
  const meId = useAuth((s) => (s.server.phase === 'connected' ? s.server.meId : ''));
  useEffect(() => {
    if (!isApi() || !meId) return;
    const stop = startSync();
    return () => { stop(); clearServerData(); };
  }, [meId]);
}
