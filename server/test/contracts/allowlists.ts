/** Routes with no role gate that the member sweep skips: they work without a session or manage the session itself. */
export const SWEEP_SKIP: Record<string, string> = {
  'GET /health': 'public liveness probe, no session',
  'GET /auth/hello': 'public, tells the sign-in page whether the first administrator exists',
  'POST /auth/connect': 'public sign-in',
  'GET /auth/wait': 'public, polls the sign-in request by cookie',
  'POST /auth/cancel': 'public, cancels the caller\'s own pending request',
  'POST /auth/logout': 'ends the caller\'s own session (a member may always do this)',
};

/**
 * A 403 from a route that is NOT flagged `admin` must be explained here (an owner rule, a closed action...): anything else that
 * answers 403 to a member is either an administrator route missing its flag or a new access rule nobody reviewed.
 */
export const MEMBER_403_ALLOWED: Record<string, string> = {
  'POST /approvals/:id/decision': 'POLICY_DENIED: who may decide depends on the risk tier the policy stores for the request (R3/R4 need an administrator), not on a route-wide role',
  'POST /missions/:id/delegation-briefs': 'FORBIDDEN: only an administrator or the mission owner can write a root brief (an ownership rule on a mission the member can see)',
  'POST /missions/:id/ledgers/:kind': 'FORBIDDEN: only the mission owner or an administrator can edit its ledgers (ownership rule)',
  'POST /missions/:id/share': 'FORBIDDEN: only the mission owner or an administrator can share it (ownership rule)',
};
