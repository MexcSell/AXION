/**
 * Improvement cycle 33: the MAST failure taxonomy, copied from the paper and versioned.
 * Source: Cemri, Pan, Yang, Agrawal et al., "Why Do Multi-Agent LLM Systems Fail?", arXiv:2503.13657v3 (26 Oct 2025),
 * Section 4 (category names) and Appendix A.1-A.3 "MAST Failure Categories: Deep Dive" (mode names and definitions, verbatim,
 * including the paper's own wording and curly apostrophes). The paper is licensed CC BY-NC-ND 4.0: the text is quoted, not changed.
 * The list is frozen data: a change is a new taxonomy version, never an edit of this one (tags keep the version they were made under).
 */
export const FAILURE_TAXONOMY_VERSION = 'mast-arxiv-2503.13657v3' as const;
export const FAILURE_TAXONOMY_SOURCE = 'Cemri et al., "Why Do Multi-Agent LLM Systems Fail?", arXiv:2503.13657v3, Appendix A (CC BY-NC-ND 4.0)' as const;

export interface FailureModeDef { id: string; name: string; definition: string }
export interface FailureCategoryDef { id: string; name: string; definition: string; appendix: string; modes: readonly FailureModeDef[] }

export const FAILURE_TAXONOMY: readonly FailureCategoryDef[] = Object.freeze([
  Object.freeze({ id: "FC1", name: "System Design Issues", appendix: "A.1",
    definition: "This category includes failures that arise from deficiencies in the design of the system architecture, poor conversation management, unclear task specifications or violation of constraints, and inadequate definition or adherence to the roles and responsibilities of the agents.",
    modes: Object.freeze([
      Object.freeze({ id: "FM-1.1", name: "Disobey task specification",
        definition: "Failure to adhere to the specified constraints or requirements of a given task, leading to suboptimal or incorrect outcomes." }),
      Object.freeze({ id: "FM-1.2", name: "Disobey role specification",
        definition: "Failure to adhere to the defined responsibilities and constraints of an assigned role, potentially leading to an agent behaving like another." }),
      Object.freeze({ id: "FM-1.3", name: "Step repetition",
        definition: "Unnecessary reiteration of previously completed steps in a process, potentially causing delays or errors in task completion." }),
      Object.freeze({ id: "FM-1.4", name: "Loss of conversation history",
        definition: "Unexpected context truncation, disregarding recent interaction history and reverting to an antecedent conversational state." }),
      Object.freeze({ id: "FM-1.5", name: "Unaware of termination conditions",
        definition: "Lack of recognition or understanding of the criteria that should trigger the termination of the agents’ interaction, potentially leading to unnecessary continuation." }),
    ]) }),
  Object.freeze({ id: "FC2", name: "Inter-Agent Misalignment", appendix: "A.2",
    definition: "This category includes failures arising from ineffective communication, poor collaboration, conflicting behaviors among agents, and gradual derailment from the initial task.",
    modes: Object.freeze([
      Object.freeze({ id: "FM-2.1", name: "Conversation reset",
        definition: "Unexpected or unwarranted restarting of a dialogue, potentially losing context and progress made in the interaction." }),
      Object.freeze({ id: "FM-2.2", name: "Fail to ask for clarification",
        definition: "Inability to request additional information when faced with unclear or incomplete data, potentially resulting in incorrect actions." }),
      Object.freeze({ id: "FM-2.3", name: "Task derailment",
        definition: "Deviation from the intended objective or focus of a given task, potentially resulting in irrelevant or unproductive actions." }),
      Object.freeze({ id: "FM-2.4", name: "Information withholding",
        definition: "Failure to share or communicate important data or insights that an agent possess and could impact decision-making of other agents if shared." }),
      Object.freeze({ id: "FM-2.5", name: "Ignored other agent’s input",
        definition: "Disregarding or failing to adequately consider input or recommendations provided by other agents in the system, potentially leading to suboptimal decisions or missed opportunities for collaboration." }),
      Object.freeze({ id: "FM-2.6", name: "Reasoning-action mismatch",
        definition: "Discrepancy between the logical reasoning process and the actual actions taken by the agent, potentially resulting in unexpected or undesired behaviors." }),
    ]) }),
  Object.freeze({ id: "FC3", name: "Task Verification", appendix: "A.3",
    definition: "This category includes failures resulting from premature execution termination, as well as insufficient mechanisms to guarantee the accuracy, completeness, and reliability of interactions, decisions, and outcomes.",
    modes: Object.freeze([
      Object.freeze({ id: "FM-3.1", name: "Premature termination",
        definition: "Ending a dialogue, interaction or task before all necessary information has been exchanged or objectives have been met, potentially resulting in incomplete or incorrect outcomes." }),
      Object.freeze({ id: "FM-3.2", name: "No or incomplete verification",
        definition: "(partial) omission of proper checking or confirmation of task outcomes or system outputs, potentially allowing errors or inconsistencies to propagate undetected." }),
      Object.freeze({ id: "FM-3.3", name: "Incorrect verification",
        definition: "Failure to adequately validate or cross-check crucial information or decisions during the iterations, potentially leading to errors or vulnerabilities in the system." }),
    ]) }),
]);

export const FAILURE_MODE_IDS: readonly string[] = FAILURE_TAXONOMY.flatMap((c) => c.modes.map((m) => m.id));
export const failureModeOf = (id: string): { category: FailureCategoryDef; mode: FailureModeDef } | undefined => {
  for (const category of FAILURE_TAXONOMY) { const mode = category.modes.find((m) => m.id === id); if (mode) return { category, mode }; }
  return undefined;
};

export const FAILURE_SUBJECT_KINDS = ['task', 'task_attempt', 'message', 'mission'] as const;
export type FailureSubjectKind = (typeof FAILURE_SUBJECT_KINDS)[number];
export type FailureTagStatus = 'proposed' | 'confirmed' | 'rejected';

export interface FailureTagDto {
  id: string; subjectKind: FailureSubjectKind; subjectId: string; missionId: string; taxonomyVersion: string;
  modeId: string; modeName: string; categoryId: string; categoryName: string; note: string | null;
  taggedBy: string; taggedByName: string; taggedByKind: 'user' | 'agent'; status: FailureTagStatus; createdAt: string;
  decidedBy: string | null; decidedByName: string | null; decidedAt: string | null;
}
export interface FailureSubjectInfo { kind: FailureSubjectKind; id: string; missionId: string; demo: boolean; failed: boolean; retried: boolean }
/** Counts per mode and category over CONFIRMED tags only; `count` is null (never 0) while n = 0 (nothing to count yet). */
export interface FailureModeCount { id: string; name: string; count: number | null }
export interface FailureCategoryCount { id: string; name: string; count: number | null; modes: FailureModeCount[] }
export interface FailureModesDto {
  window: '7d' | '30d' | '90d'; from: string; to: string; includeDemo: boolean; taxonomyVersion: string; source: string;
  n: number; proposed: number; categories: FailureCategoryCount[];
}
