import { useEffect } from 'react';
import { create } from 'zustand';
import type { DomainEvent, MessageDto, ThreadDto } from '@contracts';
import { fixtureMissionControl, setMissionControlProvider, threadKey, type MissionControlData } from '@/data/missions';
import type { Approval, Artifact, Attachment, Message, Mission, MissionEdge, MissionNode, Task, TimelineEvent } from '@/data/types';
import { useData, missionGone } from '@/store/data';
import { api, ApiFailure, newKey } from './client';
import { isApi } from './mode';

/**
 * Mission Control from the server (Stage 6). In api mode the hierarchy, tasks and conversation threads of a mission come
 * from GET /missions/:id/hierarchy|tasks|threads (fetched by the useMissionControl hook, per part) and are kept current
 * by the event stream (instance.*, task.*, conversation.*). Thread messages load a page at a time (newest 50 first).
 * getMissionControl(m) keeps its signature: data/missions.ts asks the provider registered here.
 * Approvals come from the Stage 5 approvals store; artifacts and the timeline stay the DEMO fixture for demo missions
 * and are empty for real ones (Stage 8).
 */

/** The human side of a mission thread, as the prototype's thread keys name it. */
export const HUMAN = 'human:owner';
export type Part = 'hierarchy' | 'tasks' | 'threads';
const ALL: Part[] = ['hierarchy', 'tasks', 'threads'];

export interface ThreadState {
  id: string; key: string; kind: string; a: string; b: string;
  count: number; unread: number; last: Message | null;
  /** null until the thread is opened; then the loaded pages, oldest first */
  messages: Message[] | null;
  hasMore: boolean; nextBefore: number | null; loading: boolean; loadingOlder: boolean;
}
export interface McEntry {
  nodes?: MissionNode[]; edges?: MissionEdge[]; tasks?: Task[];
  /** by thread id */
  threads?: Record<string, ThreadState>;
}
interface McState { byMission: Record<string, McEntry> }
export const useMC = create<McState>(() => ({ byMission: {} }));

const patchEntry = (mid: string, f: (e: McEntry) => McEntry) => useMC.setState((s) => ({ byMission: { ...s.byMission, [mid]: f(s.byMission[mid] ?? {}) } }));
const patchThread = (mid: string, tid: string, f: (t: ThreadState) => ThreadState) => patchEntry(mid, (e) => {
  const t = e.threads?.[tid];
  return t ? { ...e, threads: { ...e.threads, [tid]: f(t) } } : e;
});

/* ------------------------------------------------------------------ messages */
const toMsg = (d: MessageDto): Message => ({
  id: d.id, from: d.from, to: d.to, kind: d.kind, text: d.text, agoMin: d.agoMin, ts: d.ts, seq: d.seq, simulated: d.simulated, authorName: d.author?.name,
  ...(d.taskId ? { taskId: d.taskId } : {}), ...(d.replyTo ? { replyTo: d.replyTo } : {}), ...(d.status ? { status: d.status } : {}),
  ...(d.attachments?.length ? { attachments: d.attachments } : {}),
});
const RANK: Record<string, number> = { sent: 0, queued: 1, delivered: 2, acknowledged: 3 };
/** Receipts only move forward (an event may arrive after a fresher page). */
const laterStatus = (a?: Message['status'], b?: Message['status']) => (RANK[b ?? 'sent'] >= RANK[a ?? 'sent'] ? b ?? a : a);
const bySeq = (x: Message, y: Message) => (x.seq ?? Number.MAX_SAFE_INTEGER) - (y.seq ?? Number.MAX_SAFE_INTEGER);

/** Insert or replace by id, keep server order (local pending messages last), receipts never go backwards. */
function upsert(list: Message[], incoming: Message[]): Message[] {
  const out = new Map(list.map((m) => [m.id, m]));
  for (const m of incoming) {
    const cur = out.get(m.id);
    out.set(m.id, cur ? { ...m, status: laterStatus(cur.status, m.status) } : m);
  }
  return [...out.values()].sort(bySeq);
}

/* ------------------------------------------------------------------ threads */
const sideOf = (x: string, agentId: string | null) => (x === 'human' ? HUMAN : agentId ?? x);
function threadState(d: ThreadDto, cur?: ThreadState): ThreadState {
  const last = d.lastMessage ? toMsg(d.lastMessage) : null;
  return {
    id: d.id, key: threadKey(sideOf(d.a, d.aAgentId), sideOf(d.b, d.bAgentId)), kind: d.kind, a: d.a, b: d.b,
    count: d.count, unread: d.unread, last: cur?.last && last && (cur.last.seq ?? 0) > (last.seq ?? 0) ? cur.last : last,
    messages: cur?.messages ?? null, hasMore: cur?.hasMore ?? false, nextBefore: cur?.nextBefore ?? null, loading: cur?.loading ?? false, loadingOlder: cur?.loadingOlder ?? false,
  };
}
export const findThread = (e: McEntry | undefined, key: string) => Object.values(e?.threads ?? {}).find((t) => t.key === key);

/* ------------------------------------------------------------------ loading */
const requested = new Set<string>(); // `${missionId}|${part}`
const gens = new Map<string, number>();
const nextGen = (k: string) => { const g = (gens.get(k) ?? 0) + 1; gens.set(k, g); return g; };

async function fetchPart(mid: string, part: Part) {
  const k = `${mid}|${part}`;
  const g = nextGen(k);
  try {
    if (part === 'hierarchy') {
      const r = await api<{ nodes: MissionNode[]; edges: MissionEdge[] }>('GET', `/missions/${mid}/hierarchy`);
      if (gens.get(k) === g) patchEntry(mid, (e) => ({ ...e, nodes: r.nodes, edges: r.edges }));
    } else if (part === 'tasks') {
      const r = await api<Task[]>('GET', `/missions/${mid}/tasks`);
      if (gens.get(k) === g) patchEntry(mid, (e) => ({ ...e, tasks: r }));
    } else {
      const r = await api<{ threads: ThreadDto[] }>('GET', `/missions/${mid}/threads`);
      if (gens.get(k) === g) patchEntry(mid, (e) => ({ ...e, threads: Object.fromEntries(r.threads.map((t) => [t.id, threadState(t, e.threads?.[t.id])])) }));
    }
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) forget(mid); // the mission went away; the mission store handles leaving it
    else if (gens.get(k) === g) requested.delete(k); // try again on the next mount or reconnect
  }
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

export function forget(mid: string) {
  for (const p of ALL) { requested.delete(`${mid}|${p}`); nextGen(`${mid}|${p}`); }
  useMC.setState((s) => { if (!s.byMission[mid]) return {}; const b = { ...s.byMission }; delete b[mid]; return { byMission: b }; });
}
export function clearMissionControl() {
  requested.clear(); gens.clear(); refreshTimers.forEach((t) => window.clearTimeout(t)); refreshTimers.clear();
  useMC.setState({ byMission: {} });
}

/** Opening a thread loads its newest page (the server also records it as read). */
export async function openThread(mid: string, tid: string) {
  const t = useMC.getState().byMission[mid]?.threads?.[tid];
  if (!t || t.messages || t.loading) return;
  patchThread(mid, tid, (x) => ({ ...x, loading: true }));
  try {
    const r = await api<{ messages: MessageDto[]; hasMore: boolean; nextBefore: number | null }>('GET', `/threads/${tid}/messages?limit=50`);
    patchThread(mid, tid, (x) => {
      const page = r.messages.map(toMsg).reverse();
      const top = page.length ? page[page.length - 1].seq ?? 0 : 0;
      const newer = [...(x.last && (x.last.seq ?? 0) > top ? [x.last] : []), ...(x.messages ?? [])];
      return { ...x, messages: upsert(page, newer), hasMore: r.hasMore, nextBefore: r.nextBefore, loading: false, unread: 0 };
    });
  } catch (e) {
    patchThread(mid, tid, (x) => ({ ...x, loading: false }));
    if (e instanceof ApiFailure && e.status === 404) missionGone(mid);
  }
}

/** Scrolled to the top: the next older page. */
export async function loadOlder(mid: string, tid: string) {
  const t = useMC.getState().byMission[mid]?.threads?.[tid];
  if (!t || !t.messages || !t.hasMore || t.loadingOlder || t.nextBefore == null) return;
  patchThread(mid, tid, (x) => ({ ...x, loadingOlder: true }));
  try {
    const r = await api<{ messages: MessageDto[]; hasMore: boolean; nextBefore: number | null }>('GET', `/threads/${tid}/messages?before=${t.nextBefore}&limit=50`);
    patchThread(mid, tid, (x) => ({ ...x, messages: upsert(x.messages ?? [], r.messages.map(toMsg)), hasMore: r.hasMore, nextBefore: r.nextBefore, loadingOlder: false }));
  } catch {
    patchThread(mid, tid, (x) => ({ ...x, loadingOlder: false }));
  }
}

/** After a reconnect: everything already loaded is read again (a gap never loses or doubles anything). */
export function refreshLoadedMissionControl() {
  for (const k of requested) { const [mid, p] = k.split('|'); void fetchPart(mid, p as Part); }
  for (const [mid, e] of Object.entries(useMC.getState().byMission)) {
    for (const t of Object.values(e.threads ?? {})) {
      if (!t.messages) continue;
      void api<{ messages: MessageDto[] }>('GET', `/threads/${t.id}/messages?limit=50`)
        .then((r) => patchThread(mid, t.id, (x) => ({ ...x, messages: upsert(x.messages ?? [], r.messages.map(toMsg)) })))
        .catch(() => undefined);
    }
  }
}

/* ------------------------------------------------------------------ live events */
const refreshTimers = new Map<string, number>();
function refreshSoon(mid: string, parts: Part[]) {
  for (const p of parts) {
    const k = `${mid}|${p}`;
    if (!requested.has(k)) continue; // never loaded here: the first fetch will be fresh
    const t = refreshTimers.get(k);
    if (t) window.clearTimeout(t);
    refreshTimers.set(k, window.setTimeout(() => { refreshTimers.delete(k); void fetchPart(mid, p); }, 150));
  }
}

let meId = '';
export const setMcUser = (id: string) => { meId = id; };

/** Called by api/events.ts for conversation.*, instance.* and task.* events. */
export function onMissionControlEvent(type: string, e: DomainEvent) {
  const mid = e.missionId ?? (e.subject.kind === 'instance' ? e.subject.id.split(':')[0] : undefined);
  if (!mid) return;
  const entry = useMC.getState().byMission[mid];
  if (type === 'conversation.messageCreated') {
    const p = e.payload as { threadId: string; message?: MessageDto };
    const th = entry?.threads?.[p.threadId];
    if (!th || !p.message) { refreshSoon(mid, ['threads']); return; }
    const msg = toMsg(p.message);
    patchThread(mid, p.threadId, (x) => {
      let messages = x.messages;
      // my own post arrives here before (or after) the POST answer: it replaces the local pending copy
      if (messages && msg.from === `human:${meId}`) {
        const local = messages.find((m) => m.pending && m.text === msg.text);
        if (local) messages = messages.filter((m) => m !== local);
      }
      const isNew = !(messages ?? []).some((m) => m.id === msg.id) && x.last?.id !== msg.id;
      return {
        ...x, messages: messages ? upsert(messages, [msg]) : null,
        last: !x.last || (msg.seq ?? 0) >= (x.last.seq ?? 0) ? msg : x.last,
        count: x.count + (isNew ? 1 : 0),
      };
    });
  } else if (type === 'conversation.receipt') {
    const p = e.payload as { threadId: string; messageId: string; state: Message['status'] };
    patchThread(mid, p.threadId, (x) => ({
      ...x,
      messages: x.messages?.map((m) => (m.id === p.messageId ? { ...m, status: laterStatus(m.status, p.state) } : m)) ?? null,
      last: x.last?.id === p.messageId ? { ...x.last, status: laterStatus(x.last.status, p.state) } : x.last,
    }));
  } else if (type.startsWith('instance.') || type.startsWith('task.')) {
    refreshSoon(mid, ['hierarchy', 'tasks', 'threads']);
  }
}

/* ------------------------------------------------------------------ sending */
let localSeq = 1;
/**
 * Send a command or reply to an agent of a mission (api mode). It goes to the human↔agent thread (created on first use),
 * images are uploaded first, and the message is shown at once and replaced by the server's copy.
 * Returns 'gone' when the mission is no longer visible (404): the caller leaves it.
 */
export async function sendMissionMessage(m: Mission, agentId: string, msg: { kind: 'command' | 'reply'; text: string; attachments?: Attachment[]; replyTo?: string }, me: { id: string }): Promise<'ok' | 'gone' | 'failed'> {
  const key = threadKey(agentId, HUMAN);
  let localId = '';
  let tid = '';
  try {
    let th = findThread(useMC.getState().byMission[m.id], key);
    if (!th) {
      const node = useMC.getState().byMission[m.id]?.nodes?.find((n) => n.agentId === agentId);
      const r = await api<{ threadId: string }>('POST', `/missions/${m.id}/threads`, { instanceId: node?.instanceId ?? `${m.id}:${agentId}` });
      patchEntry(m.id, (e) => (e.threads?.[r.threadId] ? e : {
        ...e, threads: { ...(e.threads ?? {}), [r.threadId]: { id: r.threadId, key, kind: 'human-agent', a: '', b: '', count: 0, unread: 0, last: null, messages: null, hasMore: false, nextBefore: null, loading: false, loadingOlder: false } },
      }));
      await openThread(m.id, r.threadId);
      refreshSoon(m.id, ['threads']);
      th = useMC.getState().byMission[m.id]?.threads?.[r.threadId];
    } else if (!th.messages) await openThread(m.id, th.id);
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
    const real = toMsg(r.message);
    patchThread(m.id, tid, (x) => ({ ...x, messages: upsert((x.messages ?? []).filter((y) => y.id !== localId), [real]), last: !x.last || (real.seq ?? 0) >= (x.last.seq ?? 0) ? real : x.last }));
    return 'ok';
  } catch (e) {
    if (localId && tid) patchThread(m.id, tid, (x) => ({ ...x, messages: (x.messages ?? []).filter((y) => y.id !== localId) }));
    if (e instanceof ApiFailure && e.status === 404) { missionGone(m.id); return 'gone'; }
    const { toast } = await import('@/store/ui');
    toast({ tone: 'error', title: 'Not sent', body: e instanceof ApiFailure ? e.message : 'Something went wrong. Try again.' });
    return 'failed';
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
