/**
 * Improvement cycle 33: the MAST failure taxonomy, versioned.
 * Attribution: the three category names, the 14 failure-mode ids and their short names are taken unchanged from
 * Cemri, Pan, Yang, Agrawal et al., "Why Do Multi-Agent LLM Systems Fail?", arXiv:2503.13657v3 (26 Oct 2025),
 * https://arxiv.org/abs/2503.13657 , Section 4 and Appendix A.1-A.3. The paper is licensed CC BY-NC-ND 4.0.
 * The one-sentence descriptions below are AXION's own plain-words summaries (not the paper's text); read the paper for its definitions.
 * The list is frozen data: a change is a new taxonomy version, never an edit of this one (tags keep the version they were made under).
 */
export const FAILURE_TAXONOMY_VERSION = 'mast-arxiv-2503.13657v3' as const;
export const FAILURE_TAXONOMY_SOURCE = 'Cemri, Pan, Yang, Agrawal et al., "Why Do Multi-Agent LLM Systems Fail?", arXiv:2503.13657v3 (CC BY-NC-ND 4.0), https://arxiv.org/abs/2503.13657' as const;

export interface FailureModeDef { id: string; name: string; definition: string }
export interface FailureCategoryDef { id: string; name: string; definition: string; appendix: string; modes: readonly FailureModeDef[] }

export const FAILURE_TAXONOMY: readonly FailureCategoryDef[] = Object.freeze([
  Object.freeze({ id: "FC1", name: "System Design Issues", appendix: "A.1",
    definition: "Problems that start in how the system, its prompts and its roles were set up, rather than in what happened during a run.",
    modes: Object.freeze([
      Object.freeze({ id: "FM-1.1", name: "Disobey task specification",
        definition: "The agent did not follow the requirements or limits that the task set." }),
      Object.freeze({ id: "FM-1.2", name: "Disobey role specification",
        definition: "The agent stepped outside the duties of its own role, for example doing another agent's job." }),
      Object.freeze({ id: "FM-1.3", name: "Step repetition",
        definition: "The agent went through steps again that were already done." }),
      Object.freeze({ id: "FM-1.4", name: "Loss of conversation history",
        definition: "The agent lost track of what was said earlier and carried on as if it had not happened." }),
      Object.freeze({ id: "FM-1.5", name: "Unaware of termination conditions",
        definition: "The agent did not recognise that the work was finished and kept going." }),
    ]) }),
  Object.freeze({ id: "FC2", name: "Inter-Agent Misalignment", appendix: "A.2",
    definition: "Problems in how agents talk and work together while a task is running, so that needed information or direction is lost.",
    modes: Object.freeze([
      Object.freeze({ id: "FM-2.1", name: "Conversation reset",
        definition: "The conversation started over for no good reason, and earlier progress was lost." }),
      Object.freeze({ id: "FM-2.2", name: "Fail to ask for clarification",
        definition: "The agent guessed instead of asking, although the input was unclear or incomplete." }),
      Object.freeze({ id: "FM-2.3", name: "Task derailment",
        definition: "The work drifted away from the goal of the task into something unrelated." }),
      Object.freeze({ id: "FM-2.4", name: "Information withholding",
        definition: "An agent kept back information that another agent needed to decide well." }),
      Object.freeze({ id: "FM-2.5", name: "Ignored other agent’s input",
        definition: "An agent overlooked or brushed aside what another agent had contributed." }),
      Object.freeze({ id: "FM-2.6", name: "Reasoning-action mismatch",
        definition: "What the agent said it would do and what it actually did did not match." }),
    ]) }),
  Object.freeze({ id: "FC3", name: "Task Verification", appendix: "A.3",
    definition: "Problems in checking the result: work that stops too early, is not checked, or is checked badly.",
    modes: Object.freeze([
      Object.freeze({ id: "FM-3.1", name: "Premature termination",
        definition: "The task was ended before the needed information was exchanged or the goal was reached." }),
      Object.freeze({ id: "FM-3.2", name: "No or incomplete verification",
        definition: "The result was not checked, or only partly checked, before it was accepted." }),
      Object.freeze({ id: "FM-3.3", name: "Incorrect verification",
        definition: "A check was done, but it was too weak or wrong to catch the problem." }),
    ]) }),
]);

export const FAILURE_MODE_IDS: readonly string[] = FAILURE_TAXONOMY.flatMap((c) => c.modes.map((m) => m.id));
export const failureModeOf = (id: string): { category: FailureCategoryDef; mode: FailureModeDef } | undefined => {
  for (const category of FAILURE_TAXONOMY) { const mode = category.modes.find((m) => m.id === id); if (mode) return { category, mode }; }
  return undefined;
};

/**
 * c63 (R3-8): how a failure was noticed and what part of the system let it through. All of it is optional on a tag, and the counts say how many tags lack each field.
 * The lists are AXION's own plain-words choices (no source defines them); each value has a label and a help sentence the dialog shows. A change is a new list version.
 * Evidence honesty: the idea that silent failures are mostly caught by people comes from one author's write-up of one runtime (D2). It motivates the channel field; it gives no rate.
 */
export interface DetectionOption { id: string; label: string; help: string }
export const DETECTION_CHANNELS = Object.freeze([
  Object.freeze({ id: 'test', label: 'An automated test', help: 'A test or check that runs by itself failed and so showed the problem.' }),
  Object.freeze({ id: 'audit', label: 'An audit or review of records', help: 'Someone checking the records afterwards (an audit, a log review, a scorecard) found it.' }),
  Object.freeze({ id: 'human_review', label: 'A person looking at the result', help: 'A person opened the result, read it and saw that it was wrong. Nothing else flagged it first.' }),
  Object.freeze({ id: 'other_agent', label: 'Another agent', help: 'A different agent, such as a reviewer or a verifier, noticed the problem while doing its own work.' }),
  Object.freeze({ id: 'reported_later', label: 'Reported later, by someone affected', help: 'Nobody noticed at the time. It came to light afterwards, when someone downstream reported it.' }),
] as const satisfies readonly DetectionOption[]);
export const FAILURE_MECHANISMS = Object.freeze([
  Object.freeze({ id: 'instructions', label: 'The instructions', help: 'The task description, brief or rules were unclear, wrong or missing something the agent needed.' }),
  Object.freeze({ id: 'context', label: 'Missing or old information', help: 'The agent did not have the information it needed, or had an out-of-date version of it.' }),
  Object.freeze({ id: 'tool', label: 'A tool or integration', help: 'A tool, a connection or an outside service returned something wrong or did not work.' }),
  Object.freeze({ id: 'reasoning', label: "The agent's own judgement", help: "The agent had what it needed, but its plan or reading of the situation was wrong." }),
  Object.freeze({ id: 'handoff', label: 'A handoff between agents', help: 'Work or information passed from one agent to another and something was lost or misread on the way.' }),
  Object.freeze({ id: 'environment', label: 'Something outside the system', help: 'Timing, a change elsewhere or another condition outside the agents and tools caused it.' }),
  Object.freeze({ id: 'other', label: 'Something else (add a note)', help: 'None of the above fits. Say what it was in the note; the note is required.' }),
] as const satisfies readonly DetectionOption[]);
export const FAILURE_CONTROLS = Object.freeze([
  Object.freeze({ id: 'test', label: 'An automated test', help: 'A test that runs by itself.' }),
  Object.freeze({ id: 'review', label: 'A review of the result', help: 'A person or reviewing agent reading the result before it was accepted.' }),
  Object.freeze({ id: 'approval', label: 'An approval step', help: 'A person had to approve the action before it went ahead.' }),
  Object.freeze({ id: 'monitoring', label: 'Monitoring or alerts', help: 'A watcher that raises a flag when something looks wrong while work is running.' }),
  Object.freeze({ id: 'validation', label: 'A check of inputs or outputs', help: 'A rule that checks the shape or content of what goes in or comes out.' }),
  Object.freeze({ id: 'none', label: 'None', help: 'For "should have caught it": no control was meant to catch this. For "did catch it": nothing caught it.' }),
  Object.freeze({ id: 'other', label: 'Something else (add a note)', help: 'None of the above fits. Say what it was in the note; the note is required.' }),
] as const satisfies readonly DetectionOption[]);
export type DetectionChannel = (typeof DETECTION_CHANNELS)[number]['id'];
export type FailureMechanism = (typeof FAILURE_MECHANISMS)[number]['id'];
export type FailureControl = (typeof FAILURE_CONTROLS)[number]['id'];
export const DETECTION_NOTE_MAX = 300;
/** Below this many tags with a recorded channel the "found only by a person" share is null (never a number from a tiny sample). */
export const HUMAN_ONLY_MIN_N = 5;
export const FAILURE_PATTERN_WINDOW: '30d' = '30d';
export const FAILURE_PATTERN_MIN_FAILURES = 3;
export const FAILURE_PATTERN_MIN_DEPARTMENTS = 2;

export const FAILURE_SUBJECT_KINDS = ['task', 'task_attempt', 'message', 'mission'] as const;
export type FailureSubjectKind = (typeof FAILURE_SUBJECT_KINDS)[number];
export type FailureTagStatus = 'proposed' | 'confirmed' | 'rejected';

/**
 * One person's (or agent's) claim about where a failure came from (c60). Entries are append-only and listed oldest first; a later entry never
 * replaces an earlier one. `agentId` and `stepRef` are free text the attributor wrote, not checked against stored agents or traces.
 */
export interface FailureAttributionDto {
  id: string; agentId: string | null; stepRef: string | null; fullTraceAvailable: boolean;
  attributedBy: string; attributedByName: string; attributedByKind: 'user' | 'agent'; createdAt: string;
}
export interface FailureTagDto {
  id: string; subjectKind: FailureSubjectKind; subjectId: string; missionId: string; taxonomyVersion: string;
  modeId: string; modeName: string; categoryId: string; categoryName: string; note: string | null;
  taggedBy: string; taggedByName: string; taggedByKind: 'user' | 'agent'; status: FailureTagStatus; selfConfirmed: boolean; createdAt: string;
  decidedBy: string | null; decidedByName: string | null; decidedAt: string | null;
  /** c60: attribution entries, oldest first (empty when none) */
  attributions: FailureAttributionDto[];
  /** c60: number of distinct (agent, step) targets among the entries, minus one (0 when there are no entries or all agree). Never hides an entry. */
  attributionDisagreements: number;
  /** c63: optional detection fields; every one is null when the tagger left it out. `detectedAfterSeconds` is worked out by the database (now() minus the stored failure time) when a channel is given and a failure time exists, else null. */
  detectionChannel: DetectionChannel | null; detectedAfterSeconds: number | null; mechanism: FailureMechanism | null;
  controlExpected: FailureControl | null; controlCaught: FailureControl | null; detectionNote: string | null;
}
export interface FailureSubjectInfo { kind: FailureSubjectKind; id: string; missionId: string; demo: boolean; failed: boolean; retried: boolean }
/** Counts per mode and category over CONFIRMED tags only; `count` is null (never 0) while n = 0 (nothing to count yet). */
export interface FailureModeCount { id: string; name: string; count: number | null }
export interface FailureCategoryCount { id: string; name: string; count: number | null; modes: FailureModeCount[] }
/** c63: how many confirmed tags carry a field and how many lack it. The missing count and share are always shown; a share is null while n = 0. */
export interface DetectionFieldCount { have: number; missing: number; missingShare: number | null }
export const DETECTION_FIELD_KEYS = ['channel', 'detectedAfter', 'mechanism', 'controlExpected', 'controlCaught'] as const;
export type DetectionFieldKey = (typeof DETECTION_FIELD_KEYS)[number];
export interface FailureDetectionDto {
  n: number; fields: Record<DetectionFieldKey, DetectionFieldCount>;
  /** confirmed tags per detection channel (only tags that carry one) */
  channels: Record<DetectionChannel, number>;
  /** "Found only by a person": of the confirmed tags with a recorded channel (`withChannel`), how many were found by a person looking at the result. `share` is null below `minN` tags with a channel; `missing` tags have no channel and are not in the share. */
  humanOnly: { humanReview: number; withChannel: number; missing: number; share: number | null; minN: number; window: '7d' | '30d' | '90d' };
}
export interface FailureModesDto {
  window: '7d' | '30d' | '90d'; from: string; to: string; includeDemo: boolean; taxonomyVersion: string; source: string;
  n: number; /** of n: tags on DEMO missions (0 unless includeDemo) */ demo: number; /** of n: confirmed by the person who tagged them */ selfConfirmed: number; proposed: number; categories: FailureCategoryCount[];
  /** c63 */ detection: FailureDetectionDto;
}

/**
 * c60: what the "different views" count means, and where it is rough. Shown as the help text of the count; kept here so the wording is tested.
 * (1) There is no retraction: entries are append-only, so a person who changes their mind adds a second entry and so counts as a disagreement with themselves.
 * (2) An agent-only entry and an agent-plus-step entry are different views, although they are compatible.
 * (3) Comparison is exact-string: "Agent-1" and "agent-1" are different views.
 * (4) Sending the same target again with a different "full trace available" flag is refused with 409 (the flag is not part of the target).
 */
export const ATTRIBUTION_HELP =
  'People attributed this failure differently. Every entry is kept; none replaces another. There is no retraction: a person who changes their mind adds a second entry, which counts as a disagreement. '
  + 'An agent-only entry and an agent-plus-step entry count as different views. The comparison is exact-string, so "Agent-1" and "agent-1" differ. '
  + 'Sending the same target again with a different "full trace available" flag returns 409.';
