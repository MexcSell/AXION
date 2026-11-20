export type RoleKey =
  | 'manager' | 'research' | 'analytics' | 'dev' | 'ops' | 'security' | 'comms' | 'planning'
  | 'loader' | 'knowledge' | 'optimize' | 'qa' | 'integration' | 'browser' | 'writer' | 'mentor' | 'release' | 'design';

export type AgentStatus = 'active' | 'in-mission' | 'training' | 'evolving' | 'idle' | 'blocked' | 'offline';

export interface AgentMetrics {
  reliability: number; reasoning: number; coding: number; research: number;
  browser: number; communication: number; toolPrecision: number; tokenEff: number;
}

export interface Agent {
  id: string;
  name: string;
  role: RoleKey;
  dept: string;
  version: string;
  status: AgentStatus;
  missions: number;
  success: number; // percent, verified
  sample: number; // evaluated tasks behind the success number
  grade: 'S' | 'A' | 'B' | 'C';
  model: string;
  managerId?: string;
  /** The agent's own duty. Unique: no two agents hold the same duty (owner rule, u1). */
  duty: string;
  /** Lineage: the agent this one was derived from (it keeps specialised knowledge, shares general lessons upward). */
  parentId?: string;
  /** a derived site agent's website (Homepage Controller lineage) */
  site?: string;
  load: number; // 0-100
  skills: string[];
  metrics: AgentMetrics;
  description: string;
  createdAgo: number; // days
  /** Development — separate from operational status (an in-mission agent can also be learning). */
  growth: GrowthState;
  /** progress of the current learning plan / evolution candidate, 0–100 */
  growthPct: number;
  /** what is being learned or which candidate is being evolved */
  growthNote: string;
  /** development stage 1 Seed … 5 Master */
  level: DevLevel;
  /** progress toward the next development stage, 0–100 */
  xp: number;
  /** evolution stage: number of promoted generations */
  generation: number;
  /** where the evolution candidate is in the pipeline (only while evolving) */
  evoPhase?: EvoPhase;
  candidate?: string;
}

export type GrowthState = 'learning' | 'evolving' | 'stable';
export type DevLevel = 1 | 2 | 3 | 4 | 5;
export type EvoPhase = 'proposal' | 'experiment' | 'benchmark' | 'promotion';

export type MissionStatus = 'draft' | 'planning' | 'running' | 'verifying' | 'waiting' | 'paused' | 'completed' | 'failed' | 'archived';
export type Priority = 'low' | 'normal' | 'high' | 'critical';

export interface MissionPhase { key: string; label: string; state: 'done' | 'active' | 'next' | 'blocked'; date: string; }

export interface Mission {
  id: string;
  title: string;
  kind: 'website' | 'training' | 'research' | 'structure' | 'self-update' | 'data' | 'automation';
  status: MissionStatus;
  priority: Priority;
  /** display name of the user who added it (kept for legacy views; the account is ownerId) */
  owner: string;
  /** account id of the user who added the mission (owner update 2026-11-20 u1) */
  ownerId: string;
  /** shared missions are visible to every user; otherwise only the owner and administrators see it */
  shared: boolean;
  /** what the user entered: text plus attached files (image, audio, video, doc, pdf, txt) */
  content: { text: string; files: MissionFile[] };
  /** the general executor the GM appointed (falls back to the lead / first agent on fixtures) */
  executorId?: string;
  /** GM → executor → agents staffing progress for missions added after u1 */
  staffing?: import('@/features/mission/staffing').Staffing;
  objective: string;
  criteria: { text: string; done: boolean }[];
  progress: number; // verified %
  tasksVerified: number;
  tasksTotal: number;
  blocked: number;
  agentIds: string[];
  leadId: string;
  summary: string;
  summaryAgoMin: number;
  lastEvent: string;
  lastEventAgoMin: number;
  elapsedH: number;
  dueInDays: number;
  revision: number;
  version: string;
  phases: MissionPhase[];
  pendingApprovals: number;
  unread: number;
  createdAgoDays: number;
}

export type MissionFileKind = 'image' | 'audio' | 'video' | 'doc' | 'pdf' | 'txt' | 'file';
export interface MissionFile { id: string; name: string; kind: MissionFileKind; size: number; mime: string; url?: string; /** first lines of a text file */ excerpt?: string }

export type InstanceState = 'working' | 'waiting' | 'blocked' | 'idle' | 'verifying' | 'done' | 'reporting';
export type EdgeKind = 'delegated' | 'reports' | 'consults' | 'verifies' | 'mentors';

export interface MissionNode {
  instanceId: string;
  agentId: string;
  parent?: string; // instanceId of superior
  task: string;
  state: InstanceState;
  tasks: number;
  pending: number;
  progress: number;
}

export interface MissionEdge { from: string; to: string; kind: EdgeKind; label?: string; }

export type MessageKind = 'delegation' | 'report' | 'consult' | 'command' | 'reply' | 'question' | 'ack' | 'result' | 'system';

export interface Attachment { id: string; name: string; kind: 'image' | 'audio' | 'video' | 'doc' | 'file' | 'link'; size?: string; url?: string; }

export interface Message {
  id: string;
  from: string; // agentId or 'human:<userId>'
  to: string;
  kind: MessageKind;
  text: string;
  agoMin: number;
  ts?: number; // absolute when created live
  taskId?: string;
  attachments?: Attachment[];
  status?: 'sent' | 'delivered' | 'acknowledged' | 'queued';
  replyTo?: string;
}

export type TaskState = 'queued' | 'ready' | 'running' | 'waiting-agent' | 'waiting-user' | 'verifying' | 'passed' | 'failed' | 'canceled';

export interface Task {
  id: string;
  title: string;
  owner: string; // agentId
  deps: string[];
  state: TaskState;
  weight: number;
  evidence: number;
  col: number; // layout column
  row: number;
}

export type ArtifactType = 'website' | 'document' | 'image' | 'dataset' | 'code' | 'report' | 'recipe' | 'screenshot' | 'video';

export interface ArtifactVersion {
  v: string;
  hash: string;
  size: string;
  agoMin: number;
  by: string; // agentId
  notes: string;
  verified: boolean;
}

export interface Artifact {
  id: string;
  name: string;
  type: ArtifactType;
  missionId: string;
  versions: ArtifactVersion[]; // newest first
  tags: string[];
  runnable: boolean;
}

export interface Approval {
  id: string;
  missionId: string;
  agentId: string;
  title: string;
  detail: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  kind: 'browser-action' | 'origin-grant' | 'question' | 'release' | 'promotion' | 'reorg';
  expiresMin: number;
  agoMin: number;
  status: 'pending' | 'approved' | 'denied';
}

export interface TimelineEvent {
  id: string;
  agoMin: number;
  actor: string; // agentId | 'system' | 'human:...'
  type: 'create' | 'delegate' | 'browser' | 'model' | 'message' | 'artifact' | 'approval' | 'error' | 'release' | 'verify' | 'report';
  text: string;
  missionId?: string;
  trace: string;
}
