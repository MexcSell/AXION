import { useEffect, type ReactNode } from 'react';
import { Crown, ShieldCheck } from 'lucide-react';
import { useChannels, openChannel, loadOlderChannel, markChannelRead, flushChannelMark, sendChannelMessage } from '@/api/chat';
import { Chip } from '@/components/ui/Chips';
import { AGENT_BY_ID } from '@/data/agents';
import type { Message } from '@/data/types';
import { useMe, isAdmin } from '@/store/auth';
import { parseChannel } from '@/store/chat';
import { useUI } from '@/store/ui';
import { ChatThreadView, ChatComposer, AckLabel, type ChatMode } from './ChatView';
import '@/theme/pages/chat-model.css';

const EMPTY: Message[] = [];

export function ChannelChat({ channel, title, compact, className }: { channel: string; title?: ReactNode; compact?: boolean; className?: string }) {
  const me = useMe();
  const info = parseChannel(channel);
  const ch = useChannels((s) => s.by[channel]);
  const userName = useChannels((s) => s.list?.find((c) => c.id === channel)?.userName);
  const messages = ch?.messages ?? EMPTY;

  useEffect(() => { if (!ch && me) void openChannel(channel); }, [ch, me, channel]);
  useEffect(() => { if (me) markChannelRead(channel); }, [me, channel, messages.length]);
  useEffect(() => () => flushChannelMark(channel), [channel]);
  if (!me) return null;

  const adminReply = info.kind === 'admin' && info.userId !== me.id && isAdmin(me);
  const agent = info.agentId ? AGENT_BY_ID[info.agentId] : undefined;
  const toName = info.kind === 'admin' ? (adminReply ? userName ?? 'User' : 'Administrators')
    : info.kind === 'gm' ? 'General Manager' : agent?.name ?? info.agentId ?? 'Agent';
  const modes: ChatMode[] = [{ key: 'message', label: 'Message', placeholder: `Write to ${toName}… (Enter to send)` }];
  if (info.kind === 'agent') modes.push({ key: 'task', label: 'Task', help: 'agent.directTask', placeholder: `Give ${toName} an individual task… (Enter to send)` });

  const onSend = async (text: string, mode: string, attachments: Message['attachments']) => {
    const result = await sendChannelMessage(channel, { kind: mode === 'task' ? 'command' : 'reply', text, attachments }, me);
    if (!result.ok) useUI.getState().toast({ tone: 'error', title: 'Not sent', body: `${result.message} Your message is back in the box.` });
    return result.ok;
  };

  // the chat model took my newest message and is writing (receipt 'delivered'); a reply or a failure note ends it
  const last = messages[messages.length - 1];
  const typing = info.kind !== 'admin' && last && last.from === `human:${me.id}` && last.status === 'delivered'
    ? { name: toName, role: (info.kind === 'gm' ? AGENT_BY_ID.gm : agent)?.role } : null;
  const defaultTitle = info.kind === 'gm' ? <><Crown size={14} className="warn" /><b>General Manager</b><Chip hue={268} size="sm">company</Chip></>
    : info.kind === 'admin' ? <><ShieldCheck size={14} className="info" /><b>{adminReply ? `${toName} → administrators` : toName}</b></>
    : <b className="ellipsis">{toName}</b>;
  return (
    <AckLabel.Provider value={info.kind === 'admin' ? 'acknowledged' : 'answered'}>
    <ChatThreadView className={className} title={title ?? defaultTitle} messages={messages}
      isRight={(m) => m.from === `human:${me.id}`} typing={typing} minimap={!compact} mmMe={`human:${me.id}`}
      labelFor={(m) => m.from.startsWith('human:') ? m.kind === 'command' ? 'TASK' : 'MESSAGE' : m.kind === 'system' ? 'INFO' : undefined}
      emptyState={ch?.messages ? undefined : ch?.error ? 'error' : 'loading'}
      emptyTitle={ch?.messages ? undefined : ch?.error ? 'Could not load this conversation' : 'Loading the conversation…'}
      emptyText={ch?.error ? <>{ch.error} <button className="btn sm" onClick={() => void openChannel(channel, true)}>Retry</button></> : ch?.messages ? 'Write the first message.' : ''}
      hasOlder={ch?.hasMore} loadingOlder={ch?.loadingOlder} onLoadOlder={() => void loadOlderChannel(channel)}
      composer={<ChatComposer key={channel} compact={compact} toName={toName} draftKey={`axion.draft.${channel}`} modes={modes} onSend={onSend} />}
    />
    </AckLabel.Provider>
  );
}
