export type ChannelKind = 'gm' | 'admin' | 'agent';
export interface ChannelInfo { id: string; kind: ChannelKind; agentId?: string; userId: string }

export function parseChannel(id: string): ChannelInfo {
  const [kind, a, b] = id.split(':');
  if (kind === 'agent') return { id, kind, agentId: a, userId: b };
  return { id, kind: kind as ChannelKind, agentId: kind === 'gm' ? 'gm' : undefined, userId: a };
}
export const channelId = {
  gm: (uid: string) => `gm:${uid}`,
  admin: (uid: string) => `admin:${uid}`,
  agent: (agentId: string, uid: string) => `agent:${agentId}:${uid}`,
};
