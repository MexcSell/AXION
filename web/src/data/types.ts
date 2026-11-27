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
  /** api mode (Stage 6): where this agent's numbers come from */
  provenance?: import('@contracts').Provenance;
  /** api mode (improvement cycle 3): reliability measured by the server from recorded tasks (never a fixture number) */
  reliability?: import('@contracts').AgentReliability;
  /** api mode: the definition's compare-and-set version (If-Match on edit) and its bounded tools */
  rowVersion?: number;
  tools?: string[];
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

export type MissionStatus = 'draft' | 'queued' | 'planning' | 'running' | 'verifying' | 'waiting' | 'paused' | 'completed' | 'failed' | 'canceled' | 'archived';
export type Priority = 'low' | 'normal' | 'high' | 'critical';

export interface MissionPhase { key: string; label: string; state: 'done' | 'active' | 'next' | 'blocked'; date: string; }

/**
 * Evolution step 2: the change report of an `improve` mission (presentation.evolve). Written by the host runner's CLI,
 * only read here. Anything the runner did not know yet is absent.
 */
export type EvolveState = 'queued' | 'claimed' | 'working' | 'checking' | 'deploying' | 'live' | 'rejected' | 'rolled_back' | 'needs_owner' | 'failed';
export interface EvolveInfo {
  state: EvolveState; attempt: number; updatedAt: string;
  commit?: string; base?: string; filesChanged?: string[]; diffStat?: string; checks?: string;
  guard?: { outcome: string; failedStep?: string; reason?: string };
  report?: string; hits?: string[];
  /** earlier changes of this mission (a re-claim after one ended without going live), oldest first, at most 5; not rendered */
  history?: Omit<EvolveInfo, 'history'>[];
}

export interface Mission {
  id: string;
  title: string;
  kind: 'website' | 'training' | 'research' | 'structure' | 'self-update' | 'data' | 'automation' | 'improve';
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
  /** `improve` missions only: the change report written by the host runner (state, commit, files, checks, report) */
  evolve?: EvolveInfo;
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
  /** api mode (Stage 5): the server's version for If-Match, its exact state name, and the DEMO flag of seeded fixtures */
  rowVersion?: number;
  serverStatus?: string;
  demo?: boolean;
  archivedAt?: number;
}

export type MissionFileKind = 'image' | 'audio' | 'video' | 'doc' | 'pdf' | 'txt' | 'file';
export interface MissionFile { id: string; name: string; kind: MissionFileKind; size: number; mime: string; url?: string; /** first lines of a text file */ excerpt?: string; /** api mode: the picked file, uploaded when the mission is added (never persisted) */ blob?: File }

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
  /** api mode (Stage 6): the agent version this instance is pinned to */
  versionLabel?: string;
}

export interface MissionEdge { from: string; to: string; kind: EdgeKind; label?: string; }

export type MessageKind = 'delegation' | 'report' | 'consult' | 'command' | 'reply' | 'question' | 'ack' | 'result' | 'system';

export interface Attachment { id: string; name: string; kind: 'image' | 'audio' | 'video' | 'doc' | 'file' | 'link'; size?: string; url?: string; /** api mode: the picked file, uploaded on send (never persisted) */ blob?: Blob; }

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
  /** a GM chat reply's mission draft (owner 2026-11-25) */
  draft?: import('@contracts').MissionDraftDto;
  /** api mode (Stage 6): server order within the thread, DEMO simulation flag, author display name */
  seq?: number;
  simulated?: boolean;
  authorName?: string;
  /** api mode: still being sent */
  pending?: boolean;
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
  digest?: string;
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
  /** api mode: name of the user who decided it (server) */
  decidedByName?: string | null;
  /** api mode, binding v2 (server): the policy tier, what the action touches and its effect */
  riskTier?: 'R0' | 'R1' | 'R2' | 'R3' | 'R4';
  target?: string | null; origin?: string | null; effect?: string | null; effectWhy?: string | null;
  approver?: 'user' | 'admin' | 'owner' | null; consumed?: boolean;
  /** api mode (server): may the signed-in user decide this request right now? Computed by the same policy path that refuses decisions; never derived on the client. */
  canDecide?: boolean;
  decideBlockedReason?: 'tier_requires_admin' | 'requester_cannot_decide' | 'already_decided' | 'expired' | null;
  /** c58 (server): why approval was asked. Three flags the server derived from the agent's configuration, and whether the Rule of Two fired. */
  ruleOfTwo?: RuleOfTwo | null;
  /** c58 (server, administrators only, decided requests): how the decision was made. Advisory: it never changed the decision. */
  decisionRecord?: DecisionRecord | null;
}
export interface RuleOfTwo {
  flags: { untrustedInput: boolean; sensitiveAccess: boolean; canChangeState: boolean };
  because: { untrustedInput: string[]; sensitiveAccess: string[]; canChangeState: string[] };
  fired: boolean; rule: 'rule_of_two' | null; policyVersion: number;
}
export interface DecisionRecord { latencyMs: number; queueSize: number; fastBulk: boolean }

export interface TimelineEvent {
  id: string;
  agoMin: number;
  actor: string; // agentId | 'system' | 'human:...'
  type: 'create' | 'delegate' | 'browser' | 'model' | 'message' | 'artifact' | 'approval' | 'error' | 'release' | 'verify' | 'report';
  text: string;
  missionId?: string;
  trace: string;
}
