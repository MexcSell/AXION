import type { LessonCandidateDto, PlaybookDto, PlaybookItem, PlaybookVersionRow, SkillDto, SourceRef } from '@contracts';

/**
 * DEMO samples for the Playbook panel (demo mode only; api mode reads the server). Invented to show the layout: they say
 * nothing about real agents, and nothing here is read by an agent.
 */
const src = (kind: SourceRef['kind'], id: string, note?: string): SourceRef => ({ kind, id, ...(note ? { note } : {}) });
const item = (n: number, text: string, sources: SourceRef[], extra: Partial<PlaybookItem> = {}): PlaybookItem => ({
  lessonId: `LC-DEMO-${n}`, text, trust: 'reviewed', addedInVersion: n, sources, sha256: 'd'.repeat(64), reviewBy: null, contradiction: false, contradicts: [], overrideNote: null, needsReReview: false, originChannel: 'human_entry', originClass: 'human', ...extra,
});
export const DEMO_ITEMS: PlaybookItem[] = [
  item(1, 'Write the failing test first, then the code that makes it pass.', [src('review', 'REV-DEMO-12', 'Reviewer asked twice')]),
  item(2, 'Keep pull requests under 300 changed lines.', [src('mission', 'M-126'), src('failure_tag', 'late-review')], { reviewBy: '2026-12-31' }),
  item(3, 'Run the linter locally before pushing.', [src('failure_tag', 'ci-lint-red')], { reviewBy: '2026-01-15', needsReReview: true }),
];
export const DEMO_PLAYBOOK = (agentId: string, agentName: string, role: string): PlaybookDto => ({
  agentId, agentName, role, version: 3, items: DEMO_ITEMS, kind: 'accept', createdBy: 'demo', createdByName: 'DEMO reviewer', createdAt: '2026-11-20T10:00:00.000Z', rollbackTo: null, note: null, activeCap: 25,
});
export const DEMO_VERSIONS: PlaybookVersionRow[] = [3, 2, 1].map((v) => ({ version: v, kind: 'accept' as const, items: v, createdBy: 'demo', createdByName: 'DEMO reviewer', createdAt: `2026-11-${17 + v}T10:00:00.000Z`, rollbackTo: null, note: null, lessonId: `LC-DEMO-${v}` }));
const cand = (id: string, agentId: string, agentName: string, text: string, extra: Partial<LessonCandidateDto> = {}): LessonCandidateDto => ({
  id, agentId, agentName, role: 'dev', text, sources: [src('failure_tag', 'flaky-selector')], proposedBy: 'demo', proposedByName: 'DEMO proposer', proposedByKind: 'human', submittedBy: null,
  status: 'proposed', sha256: 'e'.repeat(64), reviewBy: null, createdAt: '2026-11-21T09:00:00.000Z', decidedBy: null, decidedByName: null, decidedAt: null, decisionNote: null, overrideNote: null,
  acceptedInVersion: null, withdrawnInVersion: null, inPlaybook: false, conflicts: [], canDecide: false, cannotDecideWhy: 'DEMO samples are read only. Playbooks are stored on the server.', originChannel: 'human_entry', originClass: 'human', ...extra,
});
export const DEMO_LESSONS = (agentId: string, agentName: string): LessonCandidateDto[] => [
  cand('LC-DEMO-A', agentId, agentName, 'Prefer role-based locators over CSS selectors in browser checks.', { proposedByKind: 'agent', proposedByName: 'Tester-01', originChannel: 'agent_output', originClass: 'agent' }),
  cand('LC-DEMO-B', agentId, agentName, 'Never run the linter locally before pushing.', { conflicts: [{ lessonId: 'LC-DEMO-3', text: 'Run the linter locally before pushing.' }] }),
];
export const DEMO_SKILLS: SkillDto[] = [
  { id: 'SK-DEMO-1', name: 'Triage a failing check', version: 2, description: 'Find the cause of a red check and attach the evidence.', steps: [{ kind: 'navigate', detail: 'Open the report', origin: 'https://example.com' }, { kind: 'observe', detail: 'Name the failing selector' }, { kind: 'check', detail: 'Compare with the last green run' }, { kind: 'note', detail: 'Attach the screenshot' }], preconditions: ['A report exists'], sources: [src('review', 'REV-DEMO-3')], status: 'approved', proposedBy: 'demo', proposedByName: 'DEMO proposer', createdAt: '2026-11-19T10:00:00.000Z', approvedBy: 'demo2', approvedByName: 'DEMO reviewer', approvedAt: '2026-11-19T12:00:00.000Z', retiredBy: null, retiredAt: null, retireNote: null, canDecide: false, cannotDecideWhy: null, originChannel: 'human_entry', originClass: 'human' },
  { id: 'SK-DEMO-2', name: 'Summarise a mission for the owner', version: 1, description: 'A three-line status for the mission owner.', steps: [{ kind: 'observe', detail: 'List verified outcomes' }, { kind: 'observe', detail: 'List open risks' }, { kind: 'ask_human', detail: 'State the next decision needed' }], preconditions: [], sources: [src('mission', 'M-126')], status: 'draft', proposedBy: 'demo', proposedByName: 'DEMO proposer', createdAt: '2026-11-21T10:00:00.000Z', approvedBy: null, approvedByName: null, approvedAt: null, retiredBy: null, retiredAt: null, retireNote: null, canDecide: false, cannotDecideWhy: 'DEMO samples are read only. Playbooks are stored on the server.', originChannel: 'agent_output', originClass: 'agent' },
];
