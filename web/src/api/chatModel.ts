import { useCallback, useEffect, useState } from 'react';
import type { ChatModelRouteDto, ChatUsageDto } from '@contracts';
import { api } from './client';
import { plainError } from '@/lib/plainError';

/**
 * The chat model route (owner 2026-11-25), Settings › AI Chat: which cloud models answer the GM and agent chats, in order.
 * GET /chat-model (everyone), PUT /chat-model (administrators), GET /chat-model/usage (administrators).
 */
export function useChatModelRoute() {
  const [n, setN] = useState(0);
  const [st, setSt] = useState<{ data: ChatModelRouteDto | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    let live = true;
    api<ChatModelRouteDto>('GET', '/chat-model').then((d) => { if (live) setSt({ data: d, error: null }); })
      .catch((e) => { if (live) setSt((x) => ({ data: x.data, error: plainError(e) })); });
    return () => { live = false; };
  }, [n]);
  const save = async (models: string[] | null) => {
    const d = await api<ChatModelRouteDto>('PUT', '/chat-model', { models });
    setSt({ data: d, error: null });
    return d;
  };
  return { ...st, save, refresh: useCallback(() => setN((x) => x + 1), []) };
}

export function useChatUsage(days: number, active: boolean) {
  const [st, setSt] = useState<{ data: ChatUsageDto | null; error: string | null }>({ data: null, error: null });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    let live = true;
    api<ChatUsageDto>('GET', `/chat-model/usage?days=${days}`).then((d) => { if (live) setSt({ data: d, error: null }); })
      .catch((e) => { if (live) setSt((x) => ({ data: x.data, error: plainError(e) })); });
    return () => { live = false; };
  }, [days, active, n]);
  return { ...st, refresh: useCallback(() => setN((x) => x + 1), []) };
}
