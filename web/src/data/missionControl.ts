import type { Approval, Artifact, Message, Mission, MissionEdge, MissionNode, Task, TimelineEvent } from './types';

export interface MissionControlData {
  nodes: MissionNode[];
  edges: MissionEdge[];
  threads: Record<string, Message[]>; // key = sorted pair "a|b"
  tasks: Task[];
  artifacts: Artifact[];
  approvals: Approval[];
  timeline: TimelineEvent[];
}

export const threadKey = (a: string, b: string) => [a, b].sort().join('|');

type Provider = (mission: Mission) => MissionControlData;
let provider: Provider | undefined;

const empty: MissionControlData = {
  nodes: [], edges: [], threads: {}, tasks: [], artifacts: [], approvals: [], timeline: [],
};

export function setMissionControlProvider(read: Provider) {
  provider = read;
}

export function getMissionControl(mission: Mission): MissionControlData {
  return provider?.(mission) ?? empty;
}
