import { useEffect } from 'react';
import { create } from 'zustand';
import type { ChannelDto, DomainEvent, MessageDto } from '@contracts';
import type { Attachment, Message } from '@/data/types';
import { parseChannel } from '@/store/chat';
import { api, ApiFailure, newKey } from './client';
import { isApi } from './mode';
import { laterStatus, toMsg, upsert } from './missionControl';

/**
 * Direct channels from the server (Stage 6, decision E6): the General Manager, the administrators and one agent per user.
 * Channel ids stay the web's (gm:<uid>, admin:<uid>, agent:<agentId>:<uid>); the server paths are /channels/gm, /channels/admin
 * (an administrator reaches another user's line with /channels/admin/<userId>) and /channels/agent:<agentId>.
 * The list (last message, unread) and the open channels' messages are kept current by conversation.messageCreated events that carry
 * `payload.channel`. Nothing is invented: gm and agent channels get the server's honest note instead of a reply.
 * Loading failures show an error with a Retry button (backed-off retry, and again after every reconnect), never an empty chat.
 * Plug-in channels are not here: they stay in the local DEMO store.
 */
const PAGE = 50;

export const channelIdOf = (c: Pick<ChannelDto, 'kind' | 'userId' | 'agentId'>) => (c.kind === 'agent' ? `agent:${c.agentId}:${c.userId}` : `${c.kind}:${c.userId}`);
/** The server path of a channel as the signed-in user uses it; null for channels that are not on the server (plug-ins). */
export function channelPath(id: string, meId: string): string | null {
  const c = parseChannel(id);
  if (c.kind === 'gm') return '/channels/gm';
  if (c.kind === 'admin') return c.userId === meId ? '/channels/admin' : `/channels/admin/${encodeURIComponent(c.userId)}`;
  if (c.kind === 'agent' && c.agentId) return `/channels/agent:${encodeURIComponent(c.agentId)}`;
  return null;
}

export interface ChannelState {
  /** null until opened; then oldest first (contiguous by seq, plus my unsent messages) */
  messages: Message[] | null;
  hasMore: boolean; nextBefore: number | null; loading: boolean; loadingOlder: boolean;
  error?: string; failures?: number;
  /** my own posts whose POST answer has not arrived: their event copies wait here */
  mine?: Message[];
}
export interface ChanEntry { id: string; kind: ChannelDto['kind']; userId: string; userName?: string; agentId?: string; count: number; unread: number; last: Message | null }
interface ChanStore { list: ChanEntry[] | null; listError?: string; by: Record<string, ChannelState> }
export const useChannels = create<ChanStore>(() => ({ list: null, by: {} }));

const msgOf = (e: unknown) => (e instanceof ApiFailure ? e.message : 'Something went wrong.');
const patchCh = (id: string, f: (c: ChannelState) => ChannelState) => useChannels.setState((s) => (s.by[id] ? { by: { ...s.by, [id]: f(s.by[id]) } } : s));
const entryOf = (c: ChannelDto): ChanEntry => ({ id: channelIdOf(c), kind: c.kind, userId: c.userId, userName: c.userName, agentId: c.agentId, count: c.count, unread: c.unread, last: c.last ? toMsg(c.last) : null });

let meId = '';
export const setChatUser = (id: string) => { meId = id; };

const timers = new Map<string, number>();
const backoff = (n: number) => Math.min(30_000, 2000 * 2 ** Math.max(0, n - 1));
const later = (k: string, ms: number, f: () => void) => { const t = timers.get(k); if (t) window.clearTimeout(t); timers.set(k, window.setTimeout(() => { timers.delete(k); f(); }, ms)); };
const gens = new Map<string, number>();
const nextGen = (k: string) => { const g = (gens.get(k) ?? 0) + 1; gens.set(k, g); return g; };
let listFailures = 0;
let wantList = false;

/* ------------------------------------------------------------------ the list */
export async function loadChannels() {
  wantList = true;
  const g = nextGen('list');
  try {
    const r = await api<{ channels: ChannelDto[] }>('GET', '/channels');
    if (gens.get('list') !== g) return;
    listFailures = 0;
    useChannels.setState((s) => {
      const fresh = r.channels.map(entryOf);
      // an entry a live event made newer than this answer keeps its newer last message and count
      const merged = fresh.map((f) => { const cur = s.list?.find((x) => x.id === f.id); return cur && cur.last && f.last && (cur.last.seq ?? 0) > (f.last.seq ?? 0) ? { ...f, last: cur.last, count: Math.max(f.count, cur.count), unread: cur.unread } : f; });
      return { list: merged, listError: undefined };
    });
  } catch (e) {
    if (gens.get('list') !== g || !wantList) return;
    useChannels.setState({ listError: msgOf(e) });
    later('list', backoff(++listFailures), () => { if (wantList) void loadChannels(); });
  }
}
export const retryChannels = () => { listFailures = 0; void loadChannels(); };

/** Subscribe the component to the list (loads it once). Demo mode: nothing happens. */
export function useChannelList() {
  const list = useChannels((s) => s.list);
  const listError = useChannels((s) => s.listError);
  useEffect(() => { if (isApi() && !wantList) void loadChannels(); }, []);
  return { list, listError };
}

/* ------------------------------------------------------------------ one channel's pages */
type Page = { messages: MessageDto[]; hasMore: boolean; nextBefore: number | null };
const blank = (): ChannelState => ({ messages: null, hasMore: false, nextBefore: null, loading: false, loadingOlder: false });
const bySeq = (m: Message) => m.seq ?? 0;

/** Open a channel: its newest page (the server records it as read). Failures are kept and retried with backoff. */
export async function openChannel(id: string, manual = false) {
  const path = channelPath(id, meId);
  if (!path) return;
  const cur = useChannels.getState().by[id];
  if (cur?.messages || (cur?.loading && !manual)) return;
  const g = nextGen('c:' + id);
  if (manual) { const x = timers.get('c:' + id); if (x) { window.clearTimeout(x); timers.delete('c:' + id); } }
  useChannels.setState((s) => ({ by: { ...s.by, [id]: { ...(s.by[id] ?? blank()), loading: true, error: undefined } } }));
  try {
    const r = await api<Page>('GET', `${path}/messages?limit=${PAGE}`);
    if (gens.get('c:' + id) !== g) return;
    patchCh(id, (x) => {
      const page = r.messages.map(toMsg).reverse();
      // merge, never replace: events that arrived while the page loaded stay
      const top = page.reduce((s, m) => Math.max(s, bySeq(m)), 0);
      const newer = [...(x.messages ?? []), ...(x.mine ?? []).filter((m) => bySeq(m) > top)];
      return { ...x, mine: undefined, messages: upsert(page, newer), hasMore: r.hasMore, nextBefore: r.nextBefore, loading: false, error: undefined, failures: 0 };
    });
    setUnread(id, 0);
  } catch (e) {
    if (gens.get('c:' + id) !== g) return;
    const n = (useChannels.getState().by[id]?.failures ?? 0) + 1;
    patchCh(id, (x) => ({ ...x, loading: false, error: msgOf(e), failures: n }));
    later('c:' + id, backoff(n), () => { const c = useChannels.getState().by[id]; if (c && !c.messages && c.error) void openChannel(id); });
  }
}

export async function loadOlderChannel(id: string) {
  const path = channelPath(id, meId);
  const c = useChannels.getState().by[id];
  if (!path || !c?.messages || !c.hasMore || c.loadingOlder || c.nextBefore == null) return;
  patchCh(id, (x) => ({ ...x, loadingOlder: true }));
  try {
    const r = await api<Page>('GET', `${path}/messages?before=${c.nextBefore}&limit=${PAGE}`);
    patchCh(id, (x) => ({ ...x, messages: upsert(x.messages ?? [], r.messages.map(toMsg)), hasMore: r.hasMore, nextBefore: r.nextBefore, loadingOlder: false }));
  } catch { patchCh(id, (x) => ({ ...x, loadingOlder: false })); }
}

function setUnread(id: string, n: number) {
  useChannels.setState((s) => (s.list?.some((c) => c.id === id && c.unread !== n) ? { list: s.list.map((c) => (c.id === id ? { ...c, unread: n } : c)) } : s));
}
const lastRead = new Map<string, number>();
const readTimers = new Map<string, number>();
/** The channel is on screen and shows its newest messages: clear its unread count here and on the server (one cheap read, throttled). */
/** The channel closed: its trailing read mark must not fire later (it would mark a channel nobody is looking at). */
export function cancelChannelMark(id: string) { const x = readTimers.get(id); if (x) { window.clearTimeout(x); readTimers.delete(id); } }
export function markChannelRead(id: string) {
  const path = channelPath(id, meId);
  const have = useChannels.getState().by[id]?.messages;
  if (!path || !have) return;
  setUnread(id, 0);
  const wait = 1500 - (Date.now() - (lastRead.get(id) ?? 0));
  if (wait > 0) { // throttled: one trailing mark, so the newest message is still recorded
    if (!readTimers.has(id)) readTimers.set(id, window.setTimeout(() => { readTimers.delete(id); markChannelRead(id); }, wait));
    return;
  }
  lastRead.set(id, Date.now());
  void api('GET', `${path}/messages?limit=1`).catch(() => undefined);
}

/** After a reconnect: the list and every channel this tab shows are read again (failed ones too). */
export async function refreshLoadedChannels() {
  if (wantList) void loadChannels();
  for (const [id, c] of Object.entries(useChannels.getState().by)) {
    if (!c.messages) { if (c.error) void openChannel(id, true); continue; }
    const path = channelPath(id, meId);
    if (!path) continue;
    try {
      const r = await api<Page>('GET', `${path}/messages?limit=${PAGE}&mark=0`); // a background re-read never marks the channel read
      patchCh(id, (x) => {
        const page = r.messages.map(toMsg);
        const loaded = x.messages ?? [];
        const oldest = page.reduce((s, m) => Math.min(s, bySeq(m)), Number.MAX_SAFE_INTEGER);
        const newest = loaded.reduce((s, m) => Math.max(s, bySeq(m)), 0);
        // more arrived than one page holds: restart from the fresh page (scrolling up fills the rest), never a hole in the middle
        if (r.hasMore && page.length && oldest > newest + 1) return { ...x, messages: upsert(page, loaded.filter((m) => m.pending)), hasMore: r.hasMore, nextBefore: r.nextBefore };
        return { ...x, messages: upsert(loaded, page) };
      });
    } catch { /* the next reconnect tries again */ }
  }
}

export function clearChannels() {
  wantList = false; listFailures = 0;
  for (const k of gens.keys()) nextGen(k);
  timers.forEach((t) => window.clearTimeout(t)); timers.clear(); lastRead.clear(); readTimers.forEach((t) => window.clearTimeout(t)); readTimers.clear();
  useChannels.setState({ list: null, listError: undefined, by: {} });
}

/* ------------------------------------------------------------------ live events */
/** conversation.messageCreated of a direct channel (payload.channel). Returns false when the event is not a channel event. */
export function onChannelEvent(e: DomainEvent): boolean {
  const p = e.payload as { channel?: { kind: ChannelDto['kind']; userId: string; agentId?: string }; message?: MessageDto };
  if (!p.channel || !p.message) return false;
  const id = channelIdOf(p.channel);
  const msg = toMsg(p.message);
  const mineMsg = msg.from === `human:${meId}`;
  const st = useChannels.getState();
  const entry = st.list?.find((c) => c.id === id);
  if (!st.list || !entry) void loadChannels(); // a channel this tab has not listed yet (first message, or an administrator's new user line)
  else {
    useChannels.setState((s) => ({ list: s.list!.map((c) => {
      if (c.id !== id) return c;
      const dup = c.last && (msg.seq ?? 0) <= (c.last.seq ?? 0);
      return { ...c, last: dup ? c.last : msg, count: c.count + (dup ? 0 : 1), unread: c.unread + (dup || mineMsg ? 0 : 1) };
    }) }));
  }
  patchCh(id, (x) => {
    if (!x.messages) return x.loading ? { ...x, mine: [...(x.mine ?? []), msg] } : x; // the first page is on its way: merged into it
    if (mineMsg && x.messages.some((m) => m.pending) && !x.messages.some((m) => m.id === msg.id)) return { ...x, mine: [...(x.mine ?? []), msg] };
    return { ...x, messages: upsert(x.messages, [msg]) };
  });
  return true;
}

/* ------------------------------------------------------------------ sending */
export type ChannelSend = { ok: true } | { ok: false; message: string };
let localSeq = 1;

function settle(id: string, localId: string, real?: Message) {
  patchCh(id, (x) => {
    let messages = (x.messages ?? []).filter((y) => y.id !== localId);
    let mine = x.mine ?? [];
    if (real) {
      const held = mine.find((m) => m.id === real.id);
      messages = upsert(messages, [held ? { ...real, status: laterStatus(real.status, held.status) } : real]);
      mine = mine.filter((m) => m.id !== real.id);
    }
    if (!messages.some((m) => m.pending) && mine.length) { messages = upsert(messages, mine); mine = []; }
    return { ...x, messages, mine };
  });
}

/**
 * Send to a direct channel (api mode). The message shows at once and is replaced by the server's copy (matched by the id the POST
 * returns). On failure nothing is kept: the caller restores the draft and says why. The server fixes the author; kind is
 * 'command' (a task) or 'reply'.
 */
export async function sendChannelMessage(id: string, msg: { kind: 'command' | 'reply'; text: string; attachments?: Attachment[] }, me: { id: string }): Promise<ChannelSend> {
  const path = channelPath(id, me.id);
  if (!path) return { ok: false, message: 'This conversation is not on the server.' };
  let localId = '';
  try {
    if (!useChannels.getState().by[id]?.messages) await openChannel(id, true);
    if (!useChannels.getState().by[id]?.messages) return { ok: false, message: 'This conversation could not be loaded yet, so nothing was sent. Try again in a moment.' };
    localId = `local-${localSeq++}`;
    const local: Message = { id: localId, from: `human:${me.id}`, to: '', kind: msg.kind, text: msg.text, agoMin: 0, ts: Date.now(), status: 'sent', pending: true,
      ...(msg.attachments?.length ? { attachments: msg.attachments.map(({ blob: _b, ...a }) => { void _b; return a; }) } : {}) };
    patchCh(id, (x) => ({ ...x, messages: [...(x.messages ?? []), local] }));
    const uploadIds: string[] = [];
    for (const a of msg.attachments ?? []) {
      if (!a.blob) continue;
      const fd = new FormData();
      fd.append('file', a.blob, a.name);
      uploadIds.push((await api<{ id: string }>('POST', '/uploads', fd)).id);
    }
    const r = await api<{ message: MessageDto }>('POST', `${path}/messages`, { kind: msg.kind, text: msg.text, uploadIds }, { idempotencyKey: newKey() });
    const real = toMsg(r.message);
    settle(id, localId, real);
    setUnread(id, 0);
    useChannels.setState((s) => (s.list ? { list: s.list.map((c) => (c.id === id && (!c.last || (real.seq ?? 0) >= (c.last.seq ?? 0)) ? { ...c, last: real, count: Math.max(c.count, real.seq ?? 0) } : c)) } : s));
    if (!useChannels.getState().list?.some((c) => c.id === id)) void loadChannels();
    return { ok: true };
  } catch (e) {
    if (localId) settle(id, localId);
    return { ok: false, message: msgOf(e) };
  }
}
