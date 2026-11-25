/** Mission conversation contracts (Stage 6). `MessageDto` is the web's `Message` plus server fields. */
export type MessageKind = 'delegation' | 'report' | 'consult' | 'command' | 'reply' | 'question' | 'ack' | 'result' | 'system';
export const HUMAN_POST_KINDS = ['command', 'reply'] as const;
export const MAX_BODY = 8000;
export const HONEST_NOTE = "Agents don't act yet — this message is stored and will be delivered when execution starts.";

export const HONEST_NOTE_GM = "The General Manager can't answer yet — this is stored and will be answered when agents start working.";
export const honestNoteAgent = (name: string) => `${name} can't answer yet — this is stored and will be delivered when execution starts.`;

/** A user's direct channel (Stage 6, E6): their General Manager line, their line to the administrators, or one agent. */
export interface ChannelDto {
  kind: 'gm' | 'admin' | 'agent';
  /** the user the channel belongs to (an administrator also sees other users' admin lines) */
  userId: string; userName?: string;
  agentId?: string; threadId: string | null;
  count: number; unread: number; last: MessageDto | null;
}

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
  /** owner 2026-11-25: a GM chat reply may carry a mission draft the person creates with one click (nothing executes) */
  draft?: MissionDraftDto;
}
export interface MissionDraftDto { title: string; text: string; criteria: string[] }
export const DRAFT_TITLE_MAX = 120, DRAFT_TEXT_MAX = 4000, DRAFT_CRITERIA_MAX = 8, DRAFT_CRITERION_MAX = 300;
export interface ThreadDto {
  id: string; missionId: string | null; kind: string;
  a: string; b: string;              // instance ids, or 'human'
  aAgentId: string | null; bAgentId: string | null;   // null for the human side
  count: number; unread: number; lastMessage: MessageDto | null; createdAt: string;
}
export interface PostMessageIn { kind: 'command' | 'reply'; text: string; to: string; replyTo?: string; uploadIds?: string[] }
