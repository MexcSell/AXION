import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { AGENT_BY_ID } from '@/data/agents';
import type { Attachment, Message, MessageKind } from '@/data/types';

/**
 * One conversation store for every chat outside a mission thread (owner update 2026-11-20 u1: "merge into one").
 * Channel ids:
 *   gm:<userId>                         you ↔ the company's General Manager
 *   admin:<userId>                      you ↔ the site administrators (every admin sees every admin:* channel)
 *   agent:<agentId>:<userId>            you ↔ one agent: conversation and individual tasks
 *   plugin:<plugin>:<agentId>:<userId>  you ↔ an agent working inside a plug-in (Job Search)
 * Mission threads keep their own store (useData) but render with the same ChatView.
 * DEMO: persisted in this browser and synced across tabs, so a member and an admin in two tabs really talk.
 */

export type ChannelKind = 'gm' | 'admin' | 'agent' | 'plugin';
export interface ChannelInfo { id: string; kind: ChannelKind; agentId?: string; userId: string; plugin?: string }

export function parseChannel(id: string): ChannelInfo {
  const [kind, a, b, c] = id.split(':');
  if (kind === 'agent') return { id, kind, agentId: a, userId: b };
  if (kind === 'plugin') return { id, kind, plugin: a, agentId: b, userId: c };
  return { id, kind: kind as ChannelKind, agentId: kind === 'gm' ? 'gm' : undefined, userId: a };
}
export const channelId = {
  gm: (uid: string) => `gm:${uid}`,
  admin: (uid: string) => `admin:${uid}`,
  agent: (agentId: string, uid: string) => `agent:${agentId}:${uid}`,
  plugin: (plugin: string, agentId: string, uid: string) => `plugin:${plugin}:${agentId}:${uid}`,
};

/** Greeting shown in an empty channel (not stored until someone writes). */
export function greeting(id: string, userName: string): Message[] {
  const c = parseChannel(id);
  const at = Date.now() - 60_000;
  const g = (from: string, text: string): Message => ({ id: `greet-${id}`, from, to: `human:${c.userId}`, kind: 'system', text, agoMin: 1, ts: at });
  if (c.kind === 'gm') return [g('gm', `Hi ${userName}. I am the General Manager. Tell me what you need: I can turn it into a mission, appoint an executor, or tell you how any mission is going.`)];
  if (c.kind === 'admin') return [g('system', `This is your line to the administrators of this site. Ask for access, a new device, or report a problem.`)];
  if (c.kind === 'agent' && c.agentId) { const a = AGENT_BY_ID[c.agentId]; return a ? [g(a.id, `Hi ${userName}, I am ${a.name}. Chat with me, or switch to Task to give me an individual task. ${a.description}`)] : []; }
  if (c.kind === 'plugin' && c.agentId) { const a = AGENT_BY_ID[c.agentId]; return a ? [g(a.id, `${a.name} here, working in ${c.plugin === 'jobs' ? 'Job Search' : c.plugin}. Give me instructions, teach me, or ask what I am doing.`)] : []; }
  return [];
}

interface ChatState {
  channels: Record<string, Message[]>;
  /** last-read message count per `${userId}|${channel}` */
  reads: Record<string, number>;
  /** who is typing in a channel (not persisted) */
  typing: Record<string, string | null>;
  send: (channel: string, m: { from: string; to: string; kind: MessageKind; text: string; attachments?: Attachment[]; status?: Message['status'] }) => Message;
  patch: (channel: string, id: string, p: Partial<Message>) => void;
  setTyping: (channel: string, who: string | null) => void;
  markRead: (userId: string, channel: string) => void;
}

let seq = 0;
export const useChat = create<ChatState>()(persist((set, get) => ({
  channels: {},
  reads: {},
  typing: {},
  send: (channel, m) => {
    const msg: Message = { id: `c${Date.now().toString(36)}${(seq++).toString(36)}`, agoMin: 0, ts: Date.now(), status: 'sent', ...m };
    set((s) => ({ channels: { ...s.channels, [channel]: [...(s.channels[channel] ?? []), msg] } }));
    return msg;
  },
  patch: (channel, id, p) => set((s) => ({ channels: { ...s.channels, [channel]: (s.channels[channel] ?? []).map((x) => (x.id === id ? { ...x, ...p } : x)) } })),
  setTyping: (channel, who) => set((s) => ({ typing: { ...s.typing, [channel]: who } })),
  markRead: (userId, channel) => {
    const n = get().channels[channel]?.length ?? 0;
    if (get().reads[`${userId}|${channel}`] === n) return;
    set((s) => ({ reads: { ...s.reads, [`${userId}|${channel}`]: n } }));
  },
}), {
  name: 'axion.chat.v1',
  version: 1,
  storage: createJSONStorage(() => localStorage),
  partialize: (s) => ({ channels: Object.fromEntries(Object.entries(s.channels).map(([k, v]) => [k, v.slice(-200).map((m) => ({ ...m, attachments: m.attachments?.map((a) => ({ ...a, url: undefined })) }))])), reads: s.reads }) as unknown as ChatState,
}));

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => { if (e.key === 'axion.chat.v1') void useChat.persist.rehydrate(); });
}

/* ------------------------------------------------------------ simulated agent replies (DEMO) */
const short = (t: string, n = 70) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
function replyText(agentId: string, text: string, mode: string, plugin?: string): string {
  const a = AGENT_BY_ID[agentId];
  if (agentId === 'gm') {
    if (/\b(status|progress|how is|how are)\b/i.test(text)) return 'Short status: 7 missions are active, 1 needs your decision (M-126 release candidate). Open Missions › Waiting for the details.';
    if (/\b(mission|build|make|research|create|do)\b/i.test(text)) return `Understood. To start it, add it as a mission — I will appoint an executor and they bring the agents. Want me to prefill it with: “${short(text, 60)}”?`;
    return `Noted, ${short(text, 50)}. I will route it to the right agent and report back here.`;
  }
  if (plugin === 'jobs') {
    if (/\b(learn|remember|always|never|prefer)\b/i.test(text)) return `Learned: “${short(text, 60)}”. I saved it to my experience and will share the general part with the Homepage Controller so the other site agents can use it.`;
    if (/\b(stop|pause|wait)\b/i.test(text)) return 'Paused. I finished the current page and will not submit anything until you say continue.';
    return `On it: “${short(text, 60)}”. I will apply it on this site and show the steps in the preview.`;
  }
  if (mode === 'task') return `Task accepted: “${short(text, 60)}”. I will work on it now and post the result here.`;
  return `${a?.name ?? 'Agent'}: ${/\?\s*$/.test(text) ? 'Good question — ' : ''}I read “${short(text, 60)}”. ${a?.role === 'dev' ? 'I can turn that into a patch with tests.' : a?.role === 'research' ? 'I can find sources and summarize them.' : 'I can take that on.'}`;
}

/** Agent (or GM) answers a user message: delivered → typing → reply (→ task result). */
export function simulateReply(channel: string, agentId: string, userMsg: Message, mode: string, plugin?: string) {
  const st = useChat.getState();
  window.setTimeout(() => st.patch(channel, userMsg.id, { status: 'delivered' }), 500);
  window.setTimeout(() => st.setTyping(channel, agentId), 900);
  window.setTimeout(() => {
    st.setTyping(channel, null);
    st.patch(channel, userMsg.id, { status: 'acknowledged' });
    st.send(channel, { from: agentId, to: userMsg.from, kind: mode === 'task' ? 'ack' : 'reply', text: replyText(agentId, userMsg.text, mode, plugin) });
    if (mode === 'task') {
      window.setTimeout(() => st.setTyping(channel, agentId), 3000);
      window.setTimeout(() => {
        st.setTyping(channel, null);
        st.send(channel, { from: agentId, to: userMsg.from, kind: 'result', text: `Done: “${short(userMsg.text, 60)}”. Evidence attached. I merged what I learned into my experience.`, attachments: [{ id: 'ev' + Date.now(), name: 'task-result.png', kind: 'image', size: '214 KB' }] });
      }, 5200);
    }
  }, 2100);
}

/** Admin channel: if no administrator answers soon, a polite auto-reply (once per channel). */
export function adminAutoReply(channel: string, userMsg: Message) {
  window.setTimeout(() => {
    const msgs = useChat.getState().channels[channel] ?? [];
    const answered = msgs.some((m) => m.from.startsWith('human:') && m.from !== userMsg.from && (m.ts ?? 0) > (userMsg.ts ?? 0));
    const already = msgs.some((m) => m.kind === 'system' && m.text.startsWith('Auto-reply'));
    if (!answered && !already) useChat.getState().send(channel, { from: 'system', to: userMsg.from, kind: 'system', text: 'Auto-reply: your message reached the administrators. They answer here; you get a notification.' });
  }, 3500);
}
