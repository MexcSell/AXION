import { useEffect } from 'react';
import { create } from 'zustand';
import type { DomainEvent, MessageDto, ThreadDto } from '@contracts';
import { fixtureMissionControl, setMissionControlProvider, threadKey, type MissionControlData } from '@/data/missions';
import type { Approval, Artifact, Attachment, Message, Mission, MissionEdge, MissionNode, Task, TimelineEvent } from '@/data/types';
import { useData, confirmMissionGone } from '@/store/data';
import { api, ApiFailure, newKey } from './client';
import { isApi } from './mode';

/**
 * Mission Control from the server (Stage 6). In api mode the hierarchy, tasks and conversation threads of a mission come
 * from GET /missions/:id/hierarchy|tasks|threads (fetched by the useMissionControl hook, per part) and are kept current
 * by the event stream (instance.*, task.*, conversation.*). Thread messages load a page at a time (newest 50 first).
 * getMissionControl(m) keeps its signature: data/missions.ts asks the provider registered here.
 * Approvals come from the Stage 5 approvals store; artifacts and the timeline stay the DEMO fixture for demo missions
 * and are empty for real ones (Stage 8).
 * Failures are never shown as "empty": each part and each thread carries a loading / error state, retries with backoff,
 * again on every stream reconnect, and on the views' Retry buttons.
 */

/** The human side of a mission thread, as the prototype's thread keys name it. */
export const HUMAN = 'human:owner';
export type Part = 'hierarchy' | 'tasks' | 'threads';
const ALL: Part[] = ['hierarchy', 'tasks', 'threads'];
const PAGE = 50;

export interface ThreadState {
  id: string; key: string; kind: string; a: string; b: string;
  count: number; unread: number; last: Message | null;
  /** null until the thread is opened; then the loaded pages, oldest first (contiguous by seq, plus my unsent messages) */
  messages: Message[] | null;
  hasMore: boolean; nextBefore: number | null; loading: boolean; loadingOlder: boolean;
  /** the first page failed to load: shown with a Retry button; retried with backoff and on reconnect */
  error?: string; failures?: number;
  /** events that arrive while the first page loads, merged into it */
  early?: Message[]; earlyReceipts?: Record<string, Message['status']>;
  /** my own posts whose POST answer has not arrived yet: their event copies wait here (matched by the returned id) */
  mine?: Message[];
}
export type PartState = 'loading' | 'error' | 'ready';
export interface McEntry {
  nodes?: MissionNode[]; edges?: MissionEdge[]; tasks?: Task[];
  /** by thread id */
  threads?: Record<string, ThreadState>;
  /** parts whose last load failed, with the message */
  errors?: Partial<Record<Part, string>>;
}
interface McState { byMission: Record<string, McEntry> }
export const useMC = create<McState>(() => ({ byMission: {} }));

/** Every other writer applies the live events still queued first, so it sees (and keeps) them in arrival order. */
const patchEntry = (mid: string, f: (e: McEntry) => McEntry) => { flushMissionControlEvents(); useMC.setState((s) => ({ byMission: { ...s.byMission, [mid]: f(s.byMission[mid] ?? {}) } })); };
const patchThread = (mid: string, tid: string, f: (t: ThreadState) => ThreadState) => patchEntry(mid, (e) => {
  const t = e.threads?.[tid];
  return t ? { ...e, threads: { ...e.threads, [tid]: f(t) } } : e;
});
const msgOf = (e: unknown) => (e instanceof ApiFailure ? e.message : 'Something went wrong.');

/* ------------------------------------------------------------------ messages */
export const toMsg = (d: MessageDto): Message => ({
  id: d.id, from: d.from, to: d.to, kind: d.kind, text: d.text, agoMin: d.agoMin, ts: d.ts, seq: d.seq, simulated: d.simulated, authorName: d.author?.name,
  ...(d.taskId ? { taskId: d.taskId } : {}), ...(d.replyTo ? { replyTo: d.replyTo } : {}), ...(d.status ? { status: d.status } : {}),
  ...(d.attachments?.length ? { attachments: d.attachments } : {}),
});
const RANK: Record<string, number> = { sent: 0, queued: 1, delivered: 2, acknowledged: 3 };
/** Receipts only move forward (an event may arrive after a fresher page). */
export const laterStatus = (a?: Message['status'], b?: Message['status']) => (RANK[b ?? 'sent'] >= RANK[a ?? 'sent'] ? b ?? a : a);
const bySeq = (x: Message, y: Message) => (x.seq ?? Number.MAX_SAFE_INTEGER) - (y.seq ?? Number.MAX_SAFE_INTEGER);

/** Insert or replace by id, keep server order (local pending messages last), receipts never go backwards. */
export function upsert(list: Message[], incoming: Message[]): Message[] {
  // the common live case: one new message after the newest one loaded (no local pending message at the end)
  if (incoming.length === 1) {
    const m = incoming[0], tail = list[list.length - 1];
    if (m.seq !== undefined && (!tail || (tail.seq !== undefined && m.seq > tail.seq)) && !list.some((x) => x.id === m.id)) return [...list, m];
  }
  const out = new Map(list.map((m) => [m.id, m]));
  for (const m of incoming) {
    const cur = out.get(m.id);
    out.set(m.id, cur ? { ...m, status: laterStatus(cur.status, m.status) } : m);
  }
  return [...out.values()].sort(bySeq);
}
const maxSeq = (list: Message[]) => list.reduce((s, m) => (m.seq !== undefined && m.seq > s ? m.seq : s), 0);

/* ------------------------------------------------------------------ threads */
const sideOf = (x: string, agentId: string | null) => (x === 'human' ? HUMAN : agentId ?? x);
function threadState(d: ThreadDto, cur?: ThreadState): ThreadState {
  const last = d.lastMessage ? toMsg(d.lastMessage) : null;
  return {
    ...(cur ?? { messages: null, hasMore: false, nextBefore: null, loading: false, loadingOlder: false }),
    id: d.id, key: threadKey(sideOf(d.a, d.aAgentId), sideOf(d.b, d.bAgentId)), kind: d.kind, a: d.a, b: d.b,
    count: Math.max(d.count, cur?.count ?? 0), unread: d.unread, last: cur?.last && last && (cur.last.seq ?? 0) > (last.seq ?? 0) ? cur.last : last,
  } as ThreadState;
}
export const findThread = (e: McEntry | undefined, key: string) => Object.values(e?.threads ?? {}).find((t) => t.key === key);

/* ------------------------------------------------------------------ loading */
/** Parts some view wants (kept after a failure, so reconnects and Retry still load them). */
const requested = new Set<string>(); // `${missionId}|${part}`
/** Generation per key: only the newest request may write. Never reset (a request from a previous session must not match). */
const gens = new Map<string, number>();
const nextGen = (k: string) => { const g = (gens.get(k) ?? 0) + 1; gens.set(k, g); return g; };
const timers = new Map<string, number>();
const failures = new Map<string, number>();
const backoff = (n: number) => Math.min(30_000, 2000 * 2 ** Math.max(0, n - 1));
const later = (k: string, ms: number, f: () => void) => { const t = timers.get(k); if (t) window.clearTimeout(t); timers.set(k, window.setTimeout(() => { timers.delete(k); f(); }, ms)); };

async function fetchPart(mid: string, part: Part) {
  const k = `${mid}|${part}`;
  if (!requested.has(k)) return; // forgotten meanwhile (mission gone, signed out)
  const g = nextGen(k);
  try {
    if (part === 'hierarchy') {
      const r = await api<{ nodes: MissionNode[]; edges: MissionEdge[] }>('GET', `/missions/${mid}/hierarchy`);
      if (gens.get(k) === g) patchEntry(mid, (e) => ({ ...e, nodes: r.nodes, edges: r.edges, errors: { ...e.errors, hierarchy: undefined } }));
    } else if (part === 'tasks') {
      const r = await api<Task[]>('GET', `/missions/${mid}/tasks`);
      if (gens.get(k) === g) patchEntry(mid, (e) => ({ ...e, tasks: r, errors: { ...e.errors, tasks: undefined } }));
    } else {
      const r = await api<{ threads: ThreadDto[] }>('GET', `/missions/${mid}/threads`);
      if (gens.get(k) === g) patchEntry(mid, (e) => ({ ...e, threads: { ...Object.fromEntries(Object.entries(e.threads ?? {}).filter(([, t]) => !t.a)), ...Object.fromEntries(r.threads.map((t) => [t.id, threadState(t, e.threads?.[t.id])])) }, errors: { ...e.errors, threads: undefined } }));
    }
    if (gens.get(k) === g) failures.delete(k);
  } catch (e) {
    if (gens.get(k) !== g || !requested.has(k)) return;
    if (e instanceof ApiFailure && e.status === 404 && await confirmMissionGone(mid)) { forget(mid); return; }
    // keep what was loaded before; mark the part failed (views show an error, not "empty") and try again later
    patchEntry(mid, (x) => ({ ...x, errors: { ...x.errors, [part]: msgOf(e) } }));
    const n = (failures.get(k) ?? 0) + 1;
    failures.set(k, n);
    later(k, backoff(n), () => { if (requested.has(k)) void fetchPart(mid, part); });
  }
}

/** Loading (never loaded, no error), error (the last load failed, nothing usable) or ready. */
export function partState(e: McEntry | undefined, part: Part): PartState {
  const has = part === 'hierarchy' ? !!e?.nodes : part === 'tasks' ? !!e?.tasks : !!e?.threads;
  if (has) return 'ready';
  return e?.errors?.[part] ? 'error' : 'loading';
}
/** The view's Retry button. */
export function retryPart(mid: string, part: Part) {
  const k = `${mid}|${part}`;
  requested.add(k);
  failures.delete(k);
  const t = timers.get(k); if (t) { window.clearTimeout(t); timers.delete(k); }
  patchEntry(mid, (e) => ({ ...e, errors: { ...e.errors, [part]: undefined } }));
  void fetchPart(mid, part);
}

function ensure(mid: string, parts: Part[]) {
  for (const p of parts) {
    const k = `${mid}|${p}`;
    if (requested.has(k)) continue;
    requested.add(k);
    void fetchPart(mid, p);
  }
}

/** Fetch and subscribe: the component re-renders when this mission's server data changes. No-op in demo mode. */
export function useMissionControl(missionId: string | undefined, parts: Part[] = ALL): McEntry | undefined {
  const entry = useMC((s) => (missionId ? s.byMission[missionId] : undefined));
  const pk = parts.join(',');
  useEffect(() => { if (isApi() && missionId) ensure(missionId, pk.split(',') as Part[]); }, [missionId, pk]);
  return entry;
}
/** The same for views that read several missions (agent profile, live instances); returns a value that changes with any of them. */
export function useMissionControls(missionIds: string[], parts: Part[] = ALL): Record<string, McEntry> {
  const all = useMC((s) => s.byMission);
  const ids = missionIds.join(',');
  const pk = parts.join(',');
  useEffect(() => { if (isApi() && ids) for (const id of ids.split(',')) ensure(id, pk.split(',') as Part[]); }, [ids, pk]);
  return all;
}

const clearTimersOf = (prefix: string) => { for (const [k, t] of timers) if (k.startsWith(prefix)) { window.clearTimeout(t); timers.delete(k); } };
export function forget(mid: string) {
  dropQueued(mid);
  for (const p of ALL) { requested.delete(`${mid}|${p}`); failures.delete(`${mid}|${p}`); nextGen(`${mid}|${p}`); }
  clearTimersOf(`${mid}|`); clearTimersOf(`t:${mid}|`); clearTimersOf(`r:${mid}|`);
  useMC.setState((s) => { if (!s.byMission[mid]) return {}; const b = { ...s.byMission }; delete b[mid]; return { byMission: b }; });
}
export function clearMissionControl() {
  dropQueued();
  // generations keep counting: an answer to a request from the previous session can never match a new one
  for (const k of requested) nextGen(k);
  requested.clear(); failures.clear();
  timers.forEach((t) => window.clearTimeout(t)); timers.clear();
  useMC.setState({ byMission: {} });
}

/* ------------------------------------------------------------------ thread pages */
type Page = { messages: MessageDto[]; hasMore: boolean; nextBefore: number | null };
const threadGens = new Map<string, number>();

/** Opening a thread loads its newest page (the server also records it as read). A failure is kept, with backoff. */
export async function openThread(mid: string, tid: string, manual = false) {
  const t = useMC.getState().byMission[mid]?.threads?.[tid];
  if (!t || t.messages || (t.loading && !manual)) return;
  const k = `t:${mid}|${tid}`;
  const g = (threadGens.get(k) ?? 0) + 1; threadGens.set(k, g);
  if (manual) { const x = timers.get(k); if (x) { window.clearTimeout(x); timers.delete(k); } }
  patchThread(mid, tid, (x) => ({ ...x, loading: true, error: undefined }));
  try {
    const r = await api<Page>('GET', `/threads/${tid}/messages?limit=${PAGE}`);
    if (threadGens.get(k) !== g) return;
    patchThread(mid, tid, (x) => {
      // merge, never replace: messages that arrived (as events) while this page was loading stay
      const page = r.messages.map(toMsg).reverse();
      const top = maxSeq(page);
      const newer = [...(x.last && (x.last.seq ?? 0) > top ? [x.last] : []), ...(x.early ?? []), ...(x.messages ?? [])];
      const merged = upsert(page, newer).map((m) => (x.earlyReceipts?.[m.id] ? { ...m, status: laterStatus(m.status, x.earlyReceipts[m.id]) } : m));
      return { ...x, messages: merged, hasMore: r.hasMore, nextBefore: r.nextBefore, loading: false, unread: 0, error: undefined, failures: 0, early: undefined, earlyReceipts: undefined };
    });
  } catch (e) {
    if (threadGens.get(k) !== g) return;
    if (e instanceof ApiFailure && e.status === 404 && await confirmMissionGone(mid)) return;
    const n = (useMC.getState().byMission[mid]?.threads?.[tid]?.failures ?? 0) + 1;
    patchThread(mid, tid, (x) => ({ ...x, loading: false, error: msgOf(e), failures: n }));
    later(k, backoff(n), () => { const cur = useMC.getState().byMission[mid]?.threads?.[tid]; if (cur && !cur.messages && cur.error) void openThread(mid, tid); });
  }
}

/** Scrolled to the top: the next older page. */
export async function loadOlder(mid: string, tid: string) {
  const t = useMC.getState().byMission[mid]?.threads?.[tid];
  if (!t || !t.messages || !t.hasMore || t.loadingOlder || t.nextBefore == null) return;
  patchThread(mid, tid, (x) => ({ ...x, loadingOlder: true }));
  try {
    const r = await api<Page>('GET', `/threads/${tid}/messages?before=${t.nextBefore}&limit=${PAGE}`);
    patchThread(mid, tid, (x) => ({ ...x, messages: upsert(x.messages ?? [], r.messages.map(toMsg)), hasMore: r.hasMore, nextBefore: r.nextBefore, loadingOlder: false }));
  } catch (e) {
    patchThread(mid, tid, (x) => ({ ...x, loadingOlder: false }));
    if (e instanceof ApiFailure && e.status === 404) void confirmMissionGone(mid);
  }
}

/**
 * Re-read an open thread's newest page. When more arrived than one page holds (a long outage), the fresh page does not
 * touch what is loaded: then the thread restarts from that page with its own cursor, so scrolling up fills the rest —
 * there is never a hole in the middle.
 */
async function rereadThread(mid: string, tid: string) {
  try {
    const r = await api<Page>('GET', `/threads/${tid}/messages?limit=${PAGE}&mark=0`); // a background re-read never marks the thread read
    patchThread(mid, tid, (x) => {
      const page = r.messages.map(toMsg);
      const loaded = x.messages ?? [];
      const oldest = page.reduce((s, m) => Math.min(s, m.seq ?? s), Number.MAX_SAFE_INTEGER);
      const gap = r.hasMore && page.length > 0 && oldest > maxSeq(loaded) + 1;
      if (gap) return { ...x, messages: upsert(page, loaded.filter((m) => m.pending)), hasMore: r.hasMore, nextBefore: r.nextBefore, last: page[0] ?? x.last };
      return { ...x, messages: upsert(loaded, page), last: page[0] && (page[0].seq ?? 0) >= (x.last?.seq ?? 0) ? page[0] : x.last };
    });
  } catch { /* the next reconnect tries again */ }
}

/** After a reconnect: everything this tab shows is read again (failed parts and threads too). */
export function refreshLoadedMissionControl() {
  for (const k of requested) { const [mid, p] = k.split('|'); failures.delete(k); void fetchPart(mid, p as Part); }
  for (const [mid, e] of Object.entries(useMC.getState().byMission)) {
    for (const t of Object.values(e.threads ?? {})) {
      if (t.messages) void rereadThread(mid, t.id);
      else if (t.error) void openThread(mid, t.id, true);
    }
  }
}

/* ------------------------------------------------------------------ live events */
function refreshSoon(mid: string, parts: Part[]) {
  for (const p of parts) {
    const k = `${mid}|${p}`;
    if (!requested.has(k)) continue; // never wanted here: the first fetch will be fresh
    later(`r:${k}`, 150, () => void fetchPart(mid, p));
  }
}

let meId = '';
export const setMcUser = (id: string) => { meId = id; };

/**
 * Called by api/events.ts for conversation.*, instance.* and task.* events.
 * Improvement cycle 22: conversation events are queued and applied together, in arrival order, at most every FLUSH_MS
 * (one store write and one render per batch instead of one per event). A burst of hundreds of messages and receipts used
 * to re-render the whole open thread once per event, which kept the page busy for tens of seconds. Every other writer of
 * this store flushes the queue first (patchEntry), and forget / clear drop what is queued for what they remove.
 */
export function onMissionControlEvent(type: string, e: DomainEvent) {
  const mid = e.missionId ?? (e.subject.kind === 'instance' ? e.subject.id.split(':')[0] : undefined);
  if (!mid) return;
  if (type === 'conversation.messageCreated' || type === 'conversation.receipt') {
    queued.push({ type, mid, e });
    if (!flushTimer) flushTimer = window.setTimeout(flushMissionControlEvents, FLUSH_MS);
  } else if (type.startsWith('instance.') || type.startsWith('task.')) {
    refreshSoon(mid, ['hierarchy', 'tasks', 'threads']);
  }
}

const FLUSH_MS = 60;
let queued: { type: string; mid: string; e: DomainEvent }[] = [];
let flushTimer = 0;
function dropQueued(mid?: string) {
  queued = mid ? queued.filter((q) => q.mid !== mid) : [];
  if (!queued.length && flushTimer) { window.clearTimeout(flushTimer); flushTimer = 0; }
}

/** Apply every queued conversation event in one store write. Also called (first) by every other writer. */
export function flushMissionControlEvents() {
  if (flushTimer) { window.clearTimeout(flushTimer); flushTimer = 0; }
  if (!queued.length) return;
  const batch = queued;
  queued = [];
  const before = useMC.getState().byMission;
  let byMission = before;
  const refresh = new Set<string>();
  for (const { type, mid, e } of batch) {
    const entry = byMission[mid];
    const thread = (tid: string, f: (t: ThreadState) => ThreadState) => {
      const t = byMission[mid]?.threads?.[tid];
      if (t) byMission = { ...byMission, [mid]: { ...byMission[mid], threads: { ...byMission[mid].threads, [tid]: f(t) } } };
    };
    if (type === 'conversation.messageCreated') {
      const p = e.payload as { threadId: string; message?: MessageDto };
      const th = entry?.threads?.[p.threadId];
      if (!th || !p.message) { refresh.add(mid); continue; }
      const msg = toMsg(p.message);
      thread(p.threadId, (x) => {
        const known = (x.messages ?? []).some((m) => m.id === msg.id) || (x.early ?? []).some((m) => m.id === msg.id) || (x.mine ?? []).some((m) => m.id === msg.id) || x.last?.id === msg.id;
        const base = { ...x, last: !x.last || (msg.seq ?? 0) >= (x.last.seq ?? 0) ? msg : x.last, count: x.count + (known || (x.last && (msg.seq ?? 0) <= (x.last.seq ?? 0)) ? 0 : 1) };
        if (!x.messages) return x.loading ? { ...base, early: [...(x.early ?? []), msg] } : base;
        // my own post while its POST answer is still out: hold the event copy; the answer's id decides (see sendMissionMessage)
        if (msg.from === `human:${meId}` && x.messages.some((m) => m.pending) && !x.messages.some((m) => m.id === msg.id)) return { ...base, mine: [...(x.mine ?? []), msg] };
        return { ...base, messages: upsert(x.messages, [msg]) };
      });
    } else {
      const p = e.payload as { threadId: string; messageId: string; state: Message['status'] };
      thread(p.threadId, (x) => ({
        ...x,
        messages: x.messages?.map((m) => (m.id === p.messageId ? { ...m, status: laterStatus(m.status, p.state) } : m)) ?? null,
        mine: x.mine?.map((m) => (m.id === p.messageId ? { ...m, status: laterStatus(m.status, p.state) } : m)),
        earlyReceipts: !x.messages && x.loading ? { ...x.earlyReceipts, [p.messageId]: laterStatus(x.earlyReceipts?.[p.messageId], p.state) } : x.earlyReceipts,
        last: x.last?.id === p.messageId ? { ...x.last, status: laterStatus(x.last.status, p.state) } : x.last,
      }));
    }
  }
  if (byMission !== before) useMC.setState({ byMission });
  for (const mid of refresh) refreshSoon(mid, ['threads']);
}

/* ------------------------------------------------------------------ task actions */
export type TaskActionResult = { ok: true; task: Task } | { ok: false; message: string };
/** retry / reassign / cancel a task (api mode). The server's message is returned as it is for an illegal move; the Task flow refreshes at once. */
export async function taskAction(mid: string, taskId: string, action: 'retry' | 'reassign' | 'cancel', body: { toInstanceId?: string; reason?: string } = {}): Promise<TaskActionResult> {
  try {
    const r = await api<{ task: Task }>('POST', `/tasks/${encodeURIComponent(taskId)}/${action}`, action === 'reassign' ? body : {}, { idempotencyKey: newKey() });
    patchEntry(mid, (e) => (e.tasks ? { ...e, tasks: e.tasks.map((t) => (t.id === r.task.id ? r.task : t)) } : e));
    refreshSoon(mid, ['tasks', 'hierarchy']);
    return { ok: true, task: r.task };
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404 && await confirmMissionGone(mid)) forget(mid);
    refreshSoon(mid, ['tasks']);
    return { ok: false, message: msgOf(e) };
  }
}

/* ------------------------------------------------------------------ sending */
export type SendResult = { ok: true } | { ok: false; gone: boolean; message: string };
let localSeq = 1;

/** Settle a local pending message: drop it, add the server's copy (if any), and release held event copies when none is pending. */
function settle(mid: string, tid: string, localId: string, real?: Message) {
  patchThread(mid, tid, (x) => {
    let messages = (x.messages ?? []).filter((y) => y.id !== localId);
    let mine = x.mine ?? [];
    if (real) {
      const held = mine.find((m) => m.id === real.id);
      messages = upsert(messages, [held ? { ...real, status: laterStatus(real.status, held.status) } : real]);
      mine = mine.filter((m) => m.id !== real.id);
    }
    if (!messages.some((m) => m.pending) && mine.length) { messages = upsert(messages, mine); mine = []; }
    const last = real && (!x.last || (real.seq ?? 0) >= (x.last.seq ?? 0)) ? real : x.last;
    return { ...x, messages, mine, last };
  });
}

/**
 * Send a command or reply to an agent of a mission (api mode). It goes to the human↔agent thread (created on first use),
 * images are uploaded first, and the message is shown at once and replaced by the server's copy (matched by the id the
 * POST returns). On failure nothing is kept locally: the caller restores the draft and says why.
 */
export async function sendMissionMessage(m: Mission, agentId: string, msg: { kind: 'command' | 'reply'; text: string; attachments?: Attachment[]; replyTo?: string }, me: { id: string }): Promise<SendResult> {
  const key = threadKey(agentId, HUMAN);
  let localId = '';
  let tid = '';
  try {
    let th = findThread(useMC.getState().byMission[m.id], key);
    if (!th) {
      // the agent's instance in this mission: never guessed (a missing instance is "not joined yet", not "mission gone")
      if (!useMC.getState().byMission[m.id]?.nodes) { requested.add(`${m.id}|hierarchy`); await fetchPart(m.id, 'hierarchy'); }
      const node = useMC.getState().byMission[m.id]?.nodes?.find((n) => n.agentId === agentId);
      if (!node) return { ok: false, gone: false, message: 'This agent has not joined the mission yet, so there is no conversation to write to.' };
      let r: { threadId: string };
      try { r = await api<{ threadId: string }>('POST', `/missions/${m.id}/threads`, { instanceId: node.instanceId }); }
      catch (e) {
        if (e instanceof ApiFailure && e.status === 404) {
          if (await confirmMissionGone(m.id)) return { ok: false, gone: true, message: `${m.id} is no longer available.` };
          return { ok: false, gone: false, message: 'This agent has not joined the mission yet, so there is no conversation to write to.' };
        }
        throw e;
      }
      patchEntry(m.id, (e) => (e.threads?.[r.threadId] ? e : {
        ...e, threads: { ...(e.threads ?? {}), [r.threadId]: { id: r.threadId, key, kind: 'human-agent', a: '', b: '', count: 0, unread: 0, last: null, messages: null, hasMore: false, nextBefore: null, loading: false, loadingOlder: false } },
      }));
      await openThread(m.id, r.threadId);
      refreshSoon(m.id, ['threads']);
      th = useMC.getState().byMission[m.id]?.threads?.[r.threadId];
    } else if (!th.messages) await openThread(m.id, th.id, true);
    tid = th!.id;
    localId = `local-${localSeq++}`;
    const local: Message = { id: localId, from: `human:${me.id}`, to: agentId, kind: msg.kind, text: msg.text, agoMin: 0, ts: Date.now(), status: 'sent', pending: true,
      ...(msg.replyTo ? { replyTo: msg.replyTo } : {}), ...(msg.attachments?.length ? { attachments: msg.attachments.map(({ blob: _b, ...a }) => { void _b; return a; }) } : {}) };
    patchThread(m.id, tid, (x) => ({ ...x, messages: [...(x.messages ?? []), local] }));
    const uploadIds: string[] = [];
    for (const a of msg.attachments ?? []) {
      if (!a.blob) continue;
      const fd = new FormData();
      fd.append('file', a.blob, a.name);
      uploadIds.push((await api<{ id: string }>('POST', '/uploads', fd)).id);
    }
    const r = await api<{ message: MessageDto }>('POST', `/threads/${tid}/messages`, { kind: msg.kind, text: msg.text, to: agentId, ...(msg.replyTo ? { replyTo: msg.replyTo } : {}), uploadIds }, { idempotencyKey: newKey() });
    settle(m.id, tid, localId, toMsg(r.message));
    return { ok: true };
  } catch (e) {
    if (localId && tid) settle(m.id, tid, localId);
    if (e instanceof ApiFailure && e.status === 404 && await confirmMissionGone(m.id)) return { ok: false, gone: true, message: `${m.id} is no longer available.` };
    return { ok: false, gone: false, message: msgOf(e) };
  }
}

/* ------------------------------------------------------------------ getMissionControl provider */
const NO_NODES: MissionNode[] = [];
const NO_EDGES: MissionEdge[] = [];
const NO_TASKS: Task[] = [];
const NO_ARTIFACTS: Artifact[] = [];
const NO_TIMELINE: TimelineEvent[] = [];
const threadMaps = new WeakMap<Record<string, ThreadState>, Record<string, Message[]>>();
const NO_THREADS: Record<string, Message[]> = {};
function threadMap(t: Record<string, ThreadState> | undefined): Record<string, Message[]> {
  if (!t) return NO_THREADS;
  let out = threadMaps.get(t);
  if (!out) {
    out = {};
    // a thread with nothing to show is left out (views read the last message of every listed thread)
    for (const th of Object.values(t)) { const msgs = th.messages?.length ? th.messages : th.last ? [th.last] : null; if (msgs) out[th.key] = msgs; }
    threadMaps.set(t, out);
  }
  return out;
}

const memo = new Map<string, { e?: McEntry; m: Mission; ap: Approval[]; out: MissionControlData }>();
function provide(m: Mission): MissionControlData {
  const e = useMC.getState().byMission[m.id];
  const ap = useData.getState().approvals;
  const c = memo.get(m.id);
  if (c && c.e === e && c.m === m && c.ap === ap) return c.out;
  const fx = m.demo ? fixtureMissionControl(m) : null;
  const prev = c?.out;
  const approvals = ap.filter((a) => a.missionId === m.id);
  const out: MissionControlData = {
    nodes: e?.nodes ?? NO_NODES, edges: e?.edges ?? NO_EDGES, tasks: e?.tasks ?? NO_TASKS, threads: threadMap(e?.threads),
    approvals: prev && prev.approvals.length === approvals.length && prev.approvals.every((a, i) => a === approvals[i]) ? prev.approvals : approvals,
    artifacts: fx?.artifacts ?? NO_ARTIFACTS, timeline: fx?.timeline ?? NO_TIMELINE,
  };
  memo.set(m.id, { e, m, ap, out });
  return out;
}

if (isApi()) {
  setMissionControlProvider(provide);
  // a mission that left the store (made private, deleted, signed out) leaves no server data behind
  useData.subscribe((s, p) => {
    if (s.missions === p.missions) return;
    const ids = new Set(s.missions.map((m) => m.id));
    for (const mid of Object.keys(useMC.getState().byMission)) if (!ids.has(mid)) { forget(mid); memo.delete(mid); }
  });
}
