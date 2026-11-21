import { useMemo } from 'react';
import { useMe, isAdmin, type Account } from '@/store/auth';
import { useChat, channelId, parseChannel } from '@/store/chat';
import { isApi } from '@/api/mode';
import { useChannelList } from '@/api/chat';

// Split out of ChatDock so the top bar's unread badge does not pull the whole chat window into the first load.
/** Channels this account takes part in (admins also see every user's administrator line). */
export function useMyChannels(me?: Account) {
  const channels = useChat((s) => s.channels);
  const reads = useChat((s) => s.reads);
  const { list: server } = useChannelList(); // api mode: GM, administrator and agent channels come from the server
  return useMemo(() => {
    if (!me) return [];
    if (isApi()) {
      const out = (server ?? []).map((c) => ({ id: c.id, info: parseChannel(c.id), last: c.last ?? undefined, unread: c.unread, userName: c.userName as string | undefined }));
      for (const id of [channelId.gm(me.id), channelId.admin(me.id)]) if (!out.some((o) => o.id === id)) out.unshift({ id, info: parseChannel(id), last: undefined, unread: 0, userName: undefined });
      for (const id of Object.keys(channels)) { const c = parseChannel(id); if (c.kind === 'plugin' && c.userId === me.id) { const msgs = channels[id] ?? []; out.push({ id, info: c, last: msgs[msgs.length - 1], unread: msgs.slice(reads[`${me.id}|${id}`] ?? 0).filter((m) => m.from !== `human:${me.id}`).length, userName: undefined }); } }
      return out;
    }
    const ids = new Set<string>([channelId.gm(me.id), channelId.admin(me.id)]);
    for (const id of Object.keys(channels)) {
      const c = parseChannel(id);
      if (c.userId === me.id) ids.add(id);
      else if (c.kind === 'admin' && isAdmin(me) && channels[id]?.length) ids.add(id);
    }
    return [...ids].map((id) => {
      const msgs = channels[id] ?? [];
      const read = reads[`${me.id}|${id}`] ?? 0;
      const unread = msgs.slice(read).filter((m) => m.from !== `human:${me.id}`).length;
      return { id, info: parseChannel(id), last: msgs[msgs.length - 1], unread, userName: undefined as string | undefined };
    });
  }, [channels, reads, me, server]);
}
export function useChatUnread() {
  const me = useMe();
  return useMyChannels(me).reduce((s, c) => s + c.unread, 0);
}

