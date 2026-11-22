/**
 * Object arrays that no call of a route ever filled, and nullable fields that were never non-null, each with the reason it is
 * accepted. Matched against `${route} ${finding}`. Anything not listed fails the coverage run, so a validator cannot silently
 * go unexercised: populate it in the flow, or say here why that is not possible without execution.
 */
const FIRST_STATE = 'a create response shows the record in its first state: its decided, closed, revoked, approved and note fields are null by construction, and the second-read pass shows them filled on the same records';
const ONE_OUTCOME = 'a decision, close or withdraw response shows the record in one outcome: the fields of the other outcomes (retired, closed, promoted, withdrawn, overridden...) are null by construction';
export const UNEXERCISED_ALLOWED: [RegExp, string][] = [
  [/^event .* \.seq never non-null$/, 'seq is a per-mission counter; events about people, agents or the organisation have no mission, so their seq is always null'],
  [/^POST \/(agents\/:id\/lessons|agents\/:id\/mentoring|agents\/:id\/version-proposals|failure-tags|organization\/proposals|organization\/revisions\/:seq\/rollback-proposal|site-grants|skills|agents) \S+ never non-null$/, FIRST_STATE],
  [/^POST \/(mentoring\/:pid\/milestones\/:mid\/done|skills\/:sid\/(approve|retire)|version-proposals\/:pid\/(decision|withdraw)|organization\/proposals\/:id\/(decision|withdraw)|lessons\/:lid\/decision|approvals\/:id\/decision|agents\/:id\/playbook\/rollback|agents\/:id\/rollback) \S+ never non-(null|empty)$/, ONE_OUTCOME],
  [/^POST \/missions \.mission\.criteria\[\] never non-empty$/, 'the create body has no criteria; a mission gets them from a later edit (PATCH), which the flow validates'],
  [/^(GET|POST|PATCH) \/agents(\/:id)? \S*reliability\.value never non-null$/, 'reliability needs at least MIN_EVIDENCE (5) finished tasks in the window; the flow has two'],
  [/^POST \/agents \.agent\.versions\[\]\.parentVersionId never non-null$/, 'a new agent has only its first version, which has no parent'],
  [/^GET \/company\/scorecard \.rows\[\]\.trend never non-null$/, 'a trend needs at least 3 samples in both windows; the flow starts a handful of missions today only'],
  [/^(GET|POST) \/tasks\/:id\/reviews \S*(modelFamily|rate) never non-null$/, 'a reviewer model family exists only for agent reviewers (agents do not execute), and an agreement rate needs at least 5 comparable reviews'],
  [/^GET \/missions\/:id\/ledgers \.moreVersions\.\w+ never non-null$/, 'the cursor appears only above the page size (100 versions of one ledger kind); the versions route pages with ?limit and is exercised'],
  [/^GET \/missions\/:id\/threads \S*(bAgentId|withInstanceId|withAgentId) never non-null$/, 'agent-to-agent threads need agents that talk to each other; agents do not execute, so only human threads exist'],
  [/^GET \/operations\/anchors \.(lastAnchorAt|restartedAt|tenants\[\]\.(anchoredSeq|anchoredAt)) never non-null$/, 'a checkpoint needs AUDIT_ANCHOR_KEY, a domain and a file written by the operator CLI (npm run audit:anchor), and a rotation needs a signed rotate; the flow has none configured. audit-anchor.test.ts validates the route against a written checkpoint and a rotated file, and api-c49 does it in the browser'],
  [/^GET \/operations\/health \.backup\.(last|file) never non-null$/, 'no backup job has run in the test database'],
  [/^(GET \/lessons|GET \/lessons\/:lid|POST \/agents\/:id\/lessons) \S*submittedBy never non-null$/, 'submittedBy is set only when a lesson is proposed by an agent on a person\'s behalf; no route sets it'],
];
