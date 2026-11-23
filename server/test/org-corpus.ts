import type { GuardAgent } from '../src/organization/guardrails.ts';
import type { EdgeIn } from '../src/organization/validate.ts';

/**
 * The org guardrail corpus (c64 R3-6 item 2), shared by org-guardrails.test.ts (the pure function) and c78-org-corpus-routes.test.ts (the
 * real proposal routes). c78 (O1c) moved it here unchanged and added the shapes marked "c78". A bad case passes the OLD dry run cleanly and
 * breaks a NEW rule only; a good case passes both, boundaries included.
 */
export const N = 6;
export const A = (id: string, model: string, o: Partial<GuardAgent> = {}): GuardAgent => ({ id, model, status: 'active', dept: id === 'gm' ? 'Exec' : 'Dept', role: 'dev', ...o });
export const BASE_AGENTS: GuardAgent[] = [
  A('gm', 'claude-opus-5-5', { role: 'manager' }),
  A('lead-a', 'claude-sonnet-5-5'), A('a1', 'gpt-5'), A('a2', 'gpt-5'), A('a3', 'llama-4-70b'),
  A('lead-b', 'gpt-5'), A('b1', 'mystery-model'), A('b2', 'claude-haiku-5-5'),
  A('lead-c', 'mystery-model'), A('c1', 'mystery-model'), A('c2', 'claude-haiku-5-5'), A('c3', 'claude-haiku-5-5'),
  A('lead-d', 'claude-sonnet-5-5'), A('d1', 'claude-haiku-5-5'),
  A('s1', 'claude-haiku-5-5'), A('s2', 'gpt-5'), A('s3', 'mystery-model'),
  ...Array.from({ length: 10 }, (_, i) => A('t' + (i + 1), i % 2 ? 'gpt-5' : 'claude-haiku-5-5')),
];
export const up = (sub: string, sup: string): EdgeIn => ({ supervisorId: sup, subordinateId: sub });
export const BASE: EdgeIn[] = [
  ...['lead-a', 'lead-b', 'lead-c', 'lead-d', 's1', 's2', 's3', ...Array.from({ length: 10 }, (_, i) => 't' + (i + 1))].map((x) => up(x, 'gm')),
  up('a1', 'lead-a'), up('a2', 'lead-a'), up('a3', 'lead-a'),
  up('b1', 'lead-b'), up('b2', 'lead-b'),
  up('c1', 'lead-c'), up('c2', 'lead-c'), up('c3', 'lead-c'),
  up('d1', 'lead-d'),
];
/** The proposed lines: the base with each `[subordinate, newManager]` re-pointed. */
export const moves = (...m: [string, string][]): EdgeIn[] => { const to = new Map(m); return BASE.map((e) => (to.has(e.subordinateId) ? up(e.subordinateId, to.get(e.subordinateId)!) : e)); };
export const m = (s: string, p: string): [string, string] => [s, p];
export type Case = { name: string; edges: EdgeIn[]; agents?: GuardAgent[]; expect?: string; /** c78: further codes the same proposal must raise */ also?: string[]; /** c78: an operator setting for the escalation limit (the default is N) */ max?: number };
export const retire = (...ids: string[]) => BASE_AGENTS.map((a) => (ids.includes(a.id) ? { ...a, status: 'retired' } : a));
export const model = (id: string, mdl: string) => BASE_AGENTS.map((a) => (a.id === id ? { ...a, model: mdl } : a));

export const BAD: Case[] = [
  // --- a changed team is left with fewer than two members able to review
  { name: 'b2 leaves team B: only lead-b is able (b1 is unknown)', edges: moves(m('b2', 'lead-a')), expect: 'TEAM_REVIEWERS' },
  { name: 'c2 leaves team C: only c3 is able', edges: moves(m('c2', 'lead-a')), expect: 'TEAM_REVIEWERS' },
  { name: 'c3 leaves team C: only c2 is able', edges: moves(m('c3', 'lead-a')), expect: 'TEAM_REVIEWERS' },
  { name: 'c2 and c3 leave team C: nobody is able', edges: moves(m('c2', 'lead-d'), m('c3', 'lead-d')), expect: 'TEAM_REVIEWERS' },
  { name: 'd1 reports to unknown c1: the new team c1 has one able member', edges: moves(m('d1', 'c1')), expect: 'TEAM_REVIEWERS' },
  { name: 'd1 reports to unknown b1: the new team b1 has one able member', edges: moves(m('d1', 'b1')), expect: 'TEAM_REVIEWERS' },
  { name: 's3 (unknown) becomes the manager of s1: new team with one able member', edges: moves(m('s1', 's3')), expect: 'TEAM_REVIEWERS' },
  { name: 's3 (unknown) becomes the manager of a1: new team with one able member (and a1 leaves team A)', edges: moves(m('a1', 's3')), expect: 'TEAM_REVIEWERS' },
  { name: 'b2 reports to unknown s3: team s3 has one able, team B loses its able member', edges: moves(m('b2', 's3')), expect: 'TEAM_REVIEWERS' },
  { name: 'a2 reports to unknown s3 (team A keeps three)', edges: moves(m('a2', 's3')), expect: 'TEAM_REVIEWERS' },
  { name: 's2 reports to unknown c1 while c2 and c3 go away', edges: moves(m('s2', 'c1'), m('c2', 'lead-d'), m('c3', 'lead-d')), expect: 'TEAM_REVIEWERS' },
  { name: 'every report of lead-c except unknown c1 leaves (two moves), lead-c unknown', edges: moves(m('c2', 'lead-b'), m('c3', 'lead-b')), expect: 'TEAM_REVIEWERS' },
  // --- the same rule with the agents changed since the chart was drawn
  { name: 'c2 was retired meanwhile; c3 leaves team C: nobody able', edges: moves(m('c3', 'lead-a')), agents: retire('c2'), expect: 'TEAM_REVIEWERS' },
  { name: 'c2 and c3 retired; c1 moves: team C has no able member', edges: moves(m('c1', 'lead-a')), agents: retire('c2', 'c3'), expect: 'TEAM_REVIEWERS' },
  { name: 'b2 was retired meanwhile; b1 (unknown) leaves team B: only lead-b is able', edges: moves(m('b1', 'lead-a')), agents: retire('b2'), expect: 'TEAM_REVIEWERS' },
  { name: 'c2, c3 and s1 were retired; s2 joins unknown lead-c: team C has one able member', edges: moves(m('s2', 'lead-c')), agents: retire('c2', 'c3', 's1'), expect: 'TEAM_REVIEWERS' },
  { name: 'a1 leaves; a2 and a3 are retired; team A has lead-a only (one able)', edges: moves(m('a1', 'lead-d')), agents: retire('a2', 'a3'), expect: 'TEAM_REVIEWERS' },
  { name: 'a2 leaves; a1 and a3 retired', edges: moves(m('a2', 'lead-d')), agents: retire('a1', 'a3'), expect: 'TEAM_REVIEWERS' },
  { name: 'a3 leaves; a1 and a2 retired', edges: moves(m('a3', 'lead-d')), agents: retire('a1', 'a2'), expect: 'TEAM_REVIEWERS' },
  { name: 'new team of two unknown agents: c1 manages s3', edges: moves(m('s3', 'c1'), m('c2', 'lead-d'), m('c3', 'lead-d')), expect: 'TEAM_REVIEWERS' },
  // --- an escalation chain deeper than N = 6 levels (each team on the chain stays able to review)
  { name: 'chain of 7 levels: t1 > t2 > ... > t7 under the GM', edges: moves(m('t2', 't1'), m('t3', 't2'), m('t4', 't3'), m('t5', 't4'), m('t6', 't5'), m('t7', 't6')), expect: 'ESCALATION_TOO_DEEP' },
  { name: 'chain of 8 levels', edges: moves(m('t2', 't1'), m('t3', 't2'), m('t4', 't3'), m('t5', 't4'), m('t6', 't5'), m('t7', 't6'), m('t8', 't7')), expect: 'ESCALATION_TOO_DEEP' },
  { name: 'chain of 10 levels', edges: moves(m('t2', 't1'), m('t3', 't2'), m('t4', 't3'), m('t5', 't4'), m('t6', 't5'), m('t7', 't6'), m('t8', 't7'), m('t9', 't8'), m('t10', 't9')), expect: 'ESCALATION_TOO_DEEP' },
  { name: 'a deep chain hung under lead-a (7 levels)', edges: moves(m('t1', 'lead-a'), m('t2', 't1'), m('t3', 't2'), m('t4', 't3'), m('t5', 't4'), m('t6', 't5')), expect: 'ESCALATION_TOO_DEEP' },
  { name: 'deep chain through the s agents', edges: moves(m('s1', 't1'), m('s2', 's1'), m('t1', 't2'), m('t2', 't3'), m('t3', 't4'), m('t4', 't5')), expect: 'ESCALATION_TOO_DEEP' },
  { name: 'two chains, one over the limit', edges: moves(m('t2', 't1'), m('t3', 't2'), m('t4', 't3'), m('t5', 't4'), m('t6', 't5'), m('t7', 't6'), m('t9', 't8')), expect: 'ESCALATION_TOO_DEEP' },
  { name: 'the lower end of the chain is a whole team (a1..a3 under t6, which is at level 6)', edges: moves(m('t2', 't1'), m('t3', 't2'), m('t4', 't3'), m('t5', 't4'), m('t6', 't5'), m('a1', 't6'), m('a2', 't6'), m('a3', 't6')), expect: 'ESCALATION_TOO_DEEP' },
  { name: 'the chain is made by moving lead-d under lead-c under lead-b under lead-a under t1..t3', edges: moves(m('lead-a', 't3'), m('t3', 't2'), m('t2', 't1'), m('lead-b', 'lead-a'), m('lead-c', 'lead-b'), m('lead-d', 'lead-c')), expect: 'ESCALATION_TOO_DEEP' },
  { name: 'chain of 7 levels hung under lead-d', edges: moves(m('t1', 'lead-d'), m('t2', 't1'), m('t3', 't2'), m('t4', 't3'), m('t5', 't4'), m('t6', 't5')), expect: 'ESCALATION_TOO_DEEP' },
  { name: 'chain of 9 levels', edges: moves(m('t2', 't1'), m('t3', 't2'), m('t4', 't3'), m('t5', 't4'), m('t6', 't5'), m('t7', 't6'), m('t8', 't7'), m('t9', 't8')), expect: 'ESCALATION_TOO_DEEP' },
  { name: 'b2 and d1 both go to unknown s3: two teams fail', edges: moves(m('b2', 's3'), m('d1', 's3')), expect: 'TEAM_REVIEWERS' },
  { name: 'c3 reports to unknown s3: team C and team s3 both fail', edges: moves(m('c3', 's3')), expect: 'TEAM_REVIEWERS' },
  { name: 'd1 reports to unknown s3', edges: moves(m('d1', 's3')), expect: 'TEAM_REVIEWERS' },
  // --- c78 (O1c, c64 review S7): five more distinct shapes, none a permutation of the above
  { name: 'c78 merge of two weak teams: d1 becomes the manager of the unknown c1 and b1 (both old teams keep two able)', edges: moves(m('c1', 'd1'), m('b1', 'd1')), expect: 'TEAM_REVIEWERS' },
  { name: 'c78 family drift: a1 and a3 now run an unknown model, then a2 leaves: team A has one able member', edges: moves(m('a2', 'lead-d')), agents: BASE_AGENTS.map((a) => (['a1', 'a3'].includes(a.id) ? { ...a, model: 'mystery-model' } : a)), expect: 'TEAM_REVIEWERS' },
  { name: 'c78 a whole team moves under the end of a 5-deep chain (lead-a lands at level 6, its reports at 7)', edges: moves(m('t2', 't1'), m('t3', 't2'), m('t4', 't3'), m('t5', 't4'), m('lead-a', 't5')), expect: 'ESCALATION_TOO_DEEP' },
  { name: 'c78 two rules in one proposal: b2 goes to unknown s3 AND a 7-level chain is built', edges: moves(m('b2', 's3'), m('t2', 't1'), m('t3', 't2'), m('t4', 't3'), m('t5', 't4'), m('t6', 't5'), m('t7', 't6')), expect: 'TEAM_REVIEWERS', also: ['ESCALATION_TOO_DEEP'] },
  { name: 'c78 the operator tightened the limit to 3: a 4-level chain under lead-a is refused (it passes at the default 6)', edges: moves(m('t1', 'lead-a'), m('t2', 't1'), m('t3', 't2')), max: 3, expect: 'ESCALATION_TOO_DEEP' },
];

export const GOOD: Case[] = [
  { name: 'no change at all', edges: BASE },
  { name: 'a1 moves to lead-d: both changed teams keep two able members', edges: moves(m('a1', 'lead-d')) },
  { name: 'boundary: team B keeps exactly two able members after b1 (unknown) leaves', edges: moves(m('b1', 'lead-a')) },
  { name: 'boundary: team D gains an unknown member but keeps two able', edges: moves(m('s3', 'lead-d')) },
  { name: 'the untouched weak team does not block an unrelated change (team B is weak with unknown members, a1 moves elsewhere)', edges: moves(m('a1', 't1')), agents: retire('b2') },
  { name: 'GM team change: s1 under t1 keeps two able in the new team', edges: moves(m('s1', 't1')) },
  { name: 'a lead left alone is a warning of the old rules, not a reviewer failure (d1 leaves)', edges: moves(m('d1', 'lead-a')) },
  { name: 'unknown-family agent joins a team that has three able members', edges: moves(m('s3', 'lead-a')) },
  { name: 'two members swap teams', edges: moves(m('a1', 'lead-d'), m('d1', 'lead-a')) },
  { name: 'boundary: chain of exactly 6 levels is allowed', edges: moves(m('t2', 't1'), m('t3', 't2'), m('t4', 't3'), m('t5', 't4'), m('t6', 't5')) },
  { name: 'boundary: chain of 5 levels', edges: moves(m('t2', 't1'), m('t3', 't2'), m('t4', 't3'), m('t5', 't4')) },
  { name: 'a bushy tree: many reports under one lead, no extra depth', edges: moves(m('t1', 'lead-a'), m('t2', 'lead-a'), m('t3', 'lead-a'), m('t4', 'lead-a')) },
  { name: 'retired agent in an untouched team', edges: moves(m('s1', 's2')), agents: retire('b2') },
  { name: 'a new team of two able agents', edges: moves(m('t2', 't1')) },
  { name: 'unknown manager of a team with two able reports', edges: moves(m('s1', 'b1'), m('s2', 'b1')) },
  { name: 'every report of lead-c moves to the able lead-a team, leaving lead-c alone', edges: moves(m('c1', 'lead-a'), m('c2', 'lead-a'), m('c3', 'lead-a')) },
  { name: 'c78 an agent is promoted above its lead: a1 under the GM, lead-a under a1 (both teams keep two able)', edges: moves(m('a1', 'gm'), m('lead-a', 'a1')) },
  { name: 'c78 boundary: a whole team under the end of a 4-deep chain (lead-a at level 5, its reports at exactly 6)', edges: moves(m('t2', 't1'), m('t3', 't2'), m('t4', 't3'), m('lead-a', 't4')) },
  { name: 'c78 a retired member leaves a team that keeps two able members', edges: moves(m('c1', 'lead-a')), agents: retire('c1') },
];

