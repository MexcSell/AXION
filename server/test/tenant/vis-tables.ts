import type { VViolation } from './vis.ts';

/**
 * Improvement cycle 87: the two reviewed tables behind the visibility sweep. A route that fails V1, V2, ID or IDW must be in exactly one of them, or the suite fails
 * (a route in neither table is an unreviewed difference); an entry that no longer matches any violation also fails the suite (a fixed leak must leave the table).
 *  - VISIBILITY_ALLOWED (BY-DESIGN): a company-wide aggregate that an earlier review explicitly accepted. Numbers only: a marker (V2, SSE) is never excused. Each entry lists the JSON paths it covers, the reason and the file:line of the ruling.
 *  - VISIBILITY_FINDINGS: anything else. It keeps the run green and the route visible. `backlog` is the id the controller assigns ("TBD" until then).
 */
export interface Allowed { route: string; relation: 'V1'; paths: string[]; reason: string; citation: string }
export interface Finding { /** set when the leak is already fixed on another branch: the entry may match nothing (the integrator removes it at merge) */ fixedBy?: string; route: string; relation: VViolation['relation']; paths?: string[]; leaks: string; repro: string; fix: string; backlog: string }

export const VISIBILITY_ALLOWED: Allowed[] = [
  {
    route: 'GET /approvals/quality', relation: 'V1', paths: ['quality.n'],
    reason: 'Accepted residual (c58 review F3, c58-review.md:83; n allowed by the c58 brief), not an endorsement: a tenant-wide count of decided approvals in the window. Every other value is null below 5 items and 3 approvers for a member; the count itself stays visible.',
    citation: 'web/docs/improve/cycles/c58-review.md:83 ("Backlog only: ... n/approverCount visibility below the floor (F3 residue)"), c58-review.md:79 (floor for a non-admin), c58-brief.md:25',
  },
  {
    route: 'GET /review-capacity', relation: 'V1', paths: ['review.total.n', 'review.departments[].n'],
    reason: 'The c65 review-capacity view is tenant-wide: "everyone else sees aggregates with c58\'s floor". Below the floor a member gets the item count n with every other figure null; the c65 reviewer accepted n.',
    citation: 'web/docs/improve/cycles/c65-brief.md:32 (item 5: aggregates with the c58 floor; n allowed), c65-review.md:20 ("n is allowed by the brief"), server/test/c65-privacy.test.ts:42 ("n stays visible"), c65-report.md:66',
  },
];

export const VISIBILITY_FINDINGS: Finding[] = [
  {
    fixedBy: "fixed by c81 (batch 40): 404 for an invisible id, nothing stored; not in this branch's base. The integrator removes this entry at merge. Until then it tolerates either outcome (200 here, 404 after the merge).",
    route: 'POST /notifications/:id/ack', relation: 'IDW',
    leaks: 'Not a read leak: the route answers 200 for ANY well-formed notice id, including a private mission\'s notification, and stores a read marker for the caller without looking the notice up. It gives the same answer for a nonexistent id, so it reveals nothing; but the id is a sequential number (n-8), the route never checks visibility, and it breaks "404 for an id you may not see". Known since c79 (concern 3).',
    repro: 'As M: POST /notifications/<id of a notification of O\'s private mission>/ack answers 200 {"ok":true}, and so does a nonexistent id. (vis.test.ts, IDW.)',
    fix: 'Look the notification up with the viewer\'s visibility and answer 404 when it is missing or not visible (c79 suggested the same).',
    backlog: 'TBD',
  },
];

export interface Classified { byDesign: VViolation[]; findings: VViolation[]; unexplained: VViolation[]; usedAllowed: Set<number>; usedFindings: Set<number> }
/** Sort every violation into BY-DESIGN, FINDING or unexplained (which fails the suite). A V1 violation is excused by ALLOWED only for the paths the entry lists; the remaining paths need a FINDING. */
export function classify(vs: VViolation[], allowed = VISIBILITY_ALLOWED, findings = VISIBILITY_FINDINGS): Classified {
  const out: Classified = { byDesign: [], findings: [], unexplained: [], usedAllowed: new Set(), usedFindings: new Set() };
  for (const v of vs) {
    if (v.relation === 'CONTROL' || v.relation === 'POSITIVE') { out.unexplained.push(v); continue; } // the detector itself is invalid: never excusable
    let residual = v.paths ?? [];
    if (v.relation === 'V1' && residual.length) {
      allowed.forEach((a, i) => { if (a.route === v.route && residual.some((p) => a.paths.includes(p))) { out.usedAllowed.add(i); residual = residual.filter((p) => !a.paths.includes(p)); } });
      if (!residual.length) { out.byDesign.push(v); continue; }
    }
    const fi = findings.findIndex((f) => f.route === v.route && f.relation === v.relation && (!f.paths || residual.every((p) => f.paths!.includes(p))));
    if (fi >= 0) { out.usedFindings.add(fi); out.findings.push(v); } else out.unexplained.push(v);
  }
  return out;
}
