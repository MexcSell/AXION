import { useEffect, useMemo, type ReactNode } from 'react';
import { Crown, ShieldCheck } from 'lucide-react';
import { Chip } from '@/components/ui/Chips';
import { AGENT_BY_ID } from '@/data/agents';
import type { Message } from '@/data/types';
import { useAuth, useMe, isAdmin } from '@/store/auth';
import { useChat, parseChannel, greeting, simulateReply, adminAutoReply } from '@/store/chat';
import { ChatThreadView, ChatComposer, type ChatMode } from './ChatView';

const EMPTY: Message[] = [];

const MODE_KIND: Record<string, Message['kind']> = { message: 'reply', task: 'command', instruct: 'command', teach: 'consult', control: 'command' };

/** One stored channel rendered with the shared ChatView, plus simulated replies (DEMO). */
export function ChannelChat({ channel, title, modes, compact, className, headRight }: { channel: string; title?: ReactNode; modes?: ChatMode[]; compact?: boolean; className?: string; headRight?: ReactNode }) {
  const me = useMe();
  const info = parseChannel(channel);
  const stored = useChat((s) => s.channels[channel] ?? EMPTY);
  const typingId = useChat((s) => s.typing[channel] ?? null);
  const send = useChat((s) => s.send);
  const markRead = useChat((s) => s.markRead);
  const channelUser = useAuth((s) => s.accounts.find((a) => a.id === info.userId));
  const meName = me?.name ?? 'You';
  const msgs = useMemo(() => [...greeting(channel, channelUser?.name ?? meName), ...stored], [channel, stored, channelUser?.name, meName]);
  useEffect(() => { if (me) markRead(me.id, channel); }, [me, channel, stored.length, markRead]);
  if (!me) return null;

  const agent = info.agentId ? AGENT_BY_ID[info.agentId] : undefined;
  const iAmAdminAnswering = info.kind === 'admin' && info.userId !== me.id && isAdmin(me);
  const target = info.kind === 'admin' ? (iAmAdminAnswering ? `human:${info.userId}` : 'admins') : info.agentId ?? 'system';
  const toName = info.kind === 'admin' ? (iAmAdminAnswering ? channelUser?.name ?? 'user' : 'Administrators') : agent?.name ?? 'Agent';
  const defModes: ChatMode[] = info.kind === 'agent'
    ? [{ key: 'message', label: 'Message', placeholder: `Talk with ${toName}… (Enter to send)` }, { key: 'task', label: 'Task', help: 'agent.directTask', placeholder: `Give ${toName} an individual task… (Enter to send)` }]
    : [{ key: 'message', label: 'Message', placeholder: `Write to ${toName}… (Enter to send)` }];
  const useModes = modes ?? defModes;

  const onSend = (text: string, mode: string, attachments: Message['attachments']) => {
    const msg = send(channel, { from: `human:${me.id}`, to: target, kind: MODE_KIND[mode] ?? 'reply', text, attachments });
    if (info.kind === 'admin') { if (!iAmAdminAnswering) adminAutoReply(channel, msg); return; }
    if (info.agentId) simulateReply(channel, info.agentId, msg, mode === 'message' ? 'message' : mode, info.plugin);
  };

  const defaultTitle = info.kind === 'gm' ? <><Crown size={14} className="warn" /><b>General Manager</b><Chip hue={268} size="sm">company</Chip></>
    : info.kind === 'admin' ? <><ShieldCheck size={14} className="info" /><b>{iAmAdminAnswering ? `${channelUser?.name ?? 'User'} → administrators` : 'Administrators'}</b></>
    : <><b className="ellipsis">{agent?.name ?? 'Agent'}</b>{info.kind === 'plugin' && <Chip hue={200} size="sm">{info.plugin === 'jobs' ? 'Job Search' : info.plugin}</Chip>}</>;
  return (
    <ChatThreadView className={className} title={title ?? defaultTitle} headRight={headRight}
      messages={msgs} isRight={(m) => m.from === `human:${me.id}`}
      typing={typingId ? { name: AGENT_BY_ID[typingId]?.name ?? 'Agent', role: AGENT_BY_ID[typingId]?.role } : null}
      minimap={!compact} mmMe={`human:${me.id}`}
      labelFor={(m) => (m.from.startsWith('human:') ? (m.kind === 'command' ? (info.kind === 'plugin' ? 'INSTRUCT' : 'TASK') : m.kind === 'consult' ? 'TEACH' : 'MESSAGE') : m.kind === 'system' ? 'INFO' : undefined)}
      emptyText="Write the first message."
      composer={<ChatComposer key={channel} compact={compact} toName={toName} draftKey={`axion.draft.${channel}`} modes={useModes} onSend={onSend} />}
    />
  );
}
