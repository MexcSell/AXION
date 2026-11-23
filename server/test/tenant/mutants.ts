import { dropTenantPredicate, swapTenantParam, writeWithTenant, type Rewrite } from './seam.ts';

/**
 * Seeded-leak mutants (item 2 of c79). Each is applied only inside the test process (a SQL rewrite or a cache hook on one tenant's app,
 * see seam.ts); nothing here is, or touches, product code. `on` is the tenant whose app carries the fault; the detector then runs with
 * `viewer` looking at the other tenant's data. `expect` names the check that SHOULD catch it (a kill by another check still counts as a
 * kill, but is reported as incidental).
 */
export interface Mutant {
  id: string; kind: string; what: string;
  on: 'A' | 'B'; viewer: 'A' | 'B';
  sql?: Rewrite; cache?: true;
  expect: RegExp; // matched against `${relation} ${where}`
}
const ON_A = { on: 'A', viewer: 'A' } as const;
export const MUTANTS: Mutant[] = [
  { id: 'M01', kind: 'missing predicate', what: 'mission list and every statement reading `missions m` loses its tenant_id predicate', ...ON_A, sql: dropTenantPredicate(/\bfrom missions m\b/i), expect: /MR3|MR1/ },
  { id: 'M02', kind: 'missing predicate', what: 'the people and user lists lose the tenant_id predicate on `users`', ...ON_A, sql: dropTenantPredicate(/\bfrom users\b/i), expect: /MR3|MR1/ },
  { id: 'M03', kind: 'missing predicate', what: 'the notification list loses its tenant_id predicate', ...ON_A, sql: dropTenantPredicate(/\bfrom notifications n\b/i), expect: /MR3|MR1/ },
  { id: 'M04', kind: 'missing predicate', what: 'the approval list loses its tenant_id predicate', ...ON_A, sql: dropTenantPredicate(/\bfrom approval_requests a\b/i), expect: /MR3|MR1/ },
  { id: 'M05', kind: 'missing predicate', what: 'the lesson list loses its tenant_id predicate', ...ON_A, sql: dropTenantPredicate(/\bfrom lesson_candidates c\b/i), expect: /MR3|MR1/ },
  { id: 'M06', kind: 'missing predicate', what: 'the skill list loses its tenant_id predicate', ...ON_A, sql: dropTenantPredicate(/\bfrom skills s\b/i), expect: /MR3|MR1/ },
  { id: 'M07', kind: 'missing predicate (aggregate)', what: 'the operations health mission count loses its tenant_id predicate (a number, not text)', ...ON_A, sql: dropTenantPredicate(/select count\(\*\)::int n from missions where tenant_id/i), expect: /MR1 .*operations\/health/ },
  { id: 'M08', kind: 'wrong tenant in a lookup', what: 'every read of `agent_definitions` is given tenant t-b instead of t-1 (agent list, detail, coverage)', ...ON_A, sql: swapTenantParam(/\bfrom agent_definitions\b/i, 't-1', 't-b'), expect: /MR3|MR1/ },
  { id: 'M09', kind: 'SSE channel', what: 'the event stream reads `events` without the tenant predicate, so its wake-ups deliver the other tenant\'s rows', ...ON_A, sql: dropTenantPredicate(/\bfrom events\b/i), expect: /sse/ },
  { id: 'M10', kind: 'cache key', what: 'a response cache keyed by the URL only (no tenant, no user) in front of every GET, shared by both tenants', ...ON_A, cache: true, expect: /MR3|MR1/ },
  { id: 'M11', kind: 'wrong tenant on write', what: 'tenant B\'s event log writes are stored under tenant t-1', on: 'B', viewer: 'A', sql: writeWithTenant(/^\s*insert into events\(tenant_id/i, 't-b', 't-1'), expect: /MR3 (sse|at rest events)/ },
  { id: 'M12', kind: 'export without tenant', what: 'the OTLP export of a mission reads missions, instances, tasks, tags without the tenant predicate', ...ON_A, sql: dropTenantPredicate(/\bfrom missions where id=\$1 and tenant_id|i\.mission_id=\$1 and i\.tenant_id|from tasks where mission_id=\$1 and tenant_id|t\.mission_id=\$1 and t\.tenant_id|from failure_tags where mission_id=\$1|from failure_attributions where mission_id=\$1/i), expect: /export/ },
  { id: 'M13', kind: 'write by foreign id', what: 'the site-grant revoke looks the grant up without the tenant predicate', ...ON_A, sql: dropTenantPredicate(/\bfrom site_grants where id=\$1 and tenant_id/i), expect: /WRITE/ },
  { id: 'M14', kind: 'lookup by foreign id', what: 'the mission lookup by id loses its tenant_id predicate (GET, PATCH, DELETE of a foreign mission)', ...ON_A, sql: dropTenantPredicate(/where m\.id=\$1 and m\.tenant_id=\$2/i), expect: /FOREIGN-GET|WRITE/ },
  { id: 'M15', kind: 'session scope', what: 'the session lookup loses its tenant predicate, so the other tenant\'s cookie is accepted', ...ON_A, sql: dropTenantPredicate(/from sessions s join users u on u\.id = s\.user_id/i), expect: /session of/ },
  // The head lookup without its predicate takes the row with the highest seq of ANY tenant. In this fixture tenant A's chain is the longer one,
  // so on A the fault is an equivalent mutant (A's own head is the global maximum): the first run of this suite showed it surviving there.
  // It is therefore carried by tenant B (the shorter chain), where it changes behaviour; M17 is the same fault as a wrong tenant on A.
  { id: 'M16', kind: 'audit chain head', what: 'tenant B\'s audit chain head is read without the tenant predicate, so its next row chains onto tenant A\'s head', on: 'B', viewer: 'B', sql: dropTenantPredicate(/select seq, row_hash from audit_events where tenant_id/i), expect: /audit\/verify|at rest/ },
  { id: 'M17', kind: 'audit chain head', what: 'tenant A\'s audit chain head is read with tenant t-b, so its next row chains onto tenant B\'s head', ...ON_A, sql: swapTenantParam(/select seq, row_hash from audit_events where tenant_id/i, 't-1', 't-b'), expect: /audit\/verify|at rest|viewer activity/ },
];
