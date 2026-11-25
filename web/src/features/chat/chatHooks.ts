import { useChannelList } from '@/api/chat';

export function useChatUnread() {
  const { list } = useChannelList();
  return list?.reduce((total, channel) => total + channel.unread, 0) ?? 0;
}
