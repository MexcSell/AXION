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

export const FAILURE_SUBJECT_KINDS = ['task', 'task_attempt', 'message', 'mission'] as const;
export type FailureSubjectKind = (typeof FAILURE_SUBJECT_KINDS)[number];
export type FailureTagStatus = 'proposed' | 'confirmed' | 'rejected';

export interface FailureTagDto {
  id: string; subjectKind: FailureSubjectKind; subjectId: string; missionId: string; taxonomyVersion: string;
  modeId: string; modeName: string; categoryId: string; categoryName: string; note: string | null;
  taggedBy: string; taggedByName: string; taggedByKind: 'user' | 'agent'; status: FailureTagStatus; selfConfirmed: boolean; createdAt: string;
  decidedBy: string | null; decidedByName: string | null; decidedAt: string | null;
}
export interface FailureSubjectInfo { kind: FailureSubjectKind; id: string; missionId: string; demo: boolean; failed: boolean; retried: boolean }
/** Counts per mode and category over CONFIRMED tags only; `count` is null (never 0) while n = 0 (nothing to count yet). */
export interface FailureModeCount { id: string; name: string; count: number | null }
export interface FailureCategoryCount { id: string; name: string; count: number | null; modes: FailureModeCount[] }
export interface FailureModesDto {
  window: '7d' | '30d' | '90d'; from: string; to: string; includeDemo: boolean; taxonomyVersion: string; source: string;
  n: number; /** of n: tags on DEMO missions (0 unless includeDemo) */ demo: number; /** of n: confirmed by the person who tagged them */ selfConfirmed: number; proposed: number; categories: FailureCategoryCount[];
}
