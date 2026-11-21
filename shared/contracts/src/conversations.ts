/** Mission conversation contracts (Stage 6). `MessageDto` is the web's `Message` plus server fields. */
export type MessageKind = 'delegation' | 'report' | 'consult' | 'command' | 'reply' | 'question' | 'ack' | 'result' | 'system';
export const HUMAN_POST_KINDS = ['command', 'reply'] as const;
export const MAX_BODY = 8000;
export const HONEST_NOTE = "Agents don't act yet — this message is stored and will be delivered when execution starts.";

export interface AttachmentDto { id: string; name: string; kind: 'image' | 'audio' | 'video' | 'doc' | 'file' | 'link'; size?: string; url?: string }
export interface MessageDto {
  id: string; seq: number; threadId: string;
  from: string;               // agentId, 'human:<userId>' or 'system'
  to: string;                 // agentId, 'human' / 'human:<userId>' or ''
  kind: MessageKind; text: string; agoMin: number; ts: number;
  taskId?: string; replyTo?: string; attachments?: AttachmentDto[];
  status?: 'sent' | 'delivered' | 'acknowledged' | 'queued';
  simulated: boolean;
  author: { kind: 'human' | 'agent' | 'system'; id: string; name: string; instanceId?: string };
}
export interface ThreadDto {
  id: string; missionId: string | null; kind: string;
  a: string; b: string;              // instance ids, or 'human'
  aAgentId: string | null; bAgentId: string | null;   // null for the human side
  count: number; unread: number; lastMessage: MessageDto | null; createdAt: string;
}
export interface PostMessageIn { kind: 'command' | 'reply'; text: string; to: string; replyTo?: string; uploadIds?: string[] }
