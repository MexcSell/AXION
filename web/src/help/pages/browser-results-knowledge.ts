import type { HelpEntry } from '../registry';

const h: Record<string, HelpEntry> = {
  /* ---------------- Mission browser sessions ---------------- */
  'browser.originGrant': { title: 'Origin grant', what: 'A grant authorizes only the listed origin, actions and mission for a limited period. New sites require separate permission.', why: 'It stops an agent from wandering to sites you never approved.', how: 'The worker revalidates the real origin before every action and after redirects.', example: 'status.example.com, read-only, mission M-132, 2 hours.', permission: 'Owner or Operator approval. Submit and purchase actions are always gated.' },
  'browser.actionApproval': { title: 'Action approval', what: 'A one-time decision for a consequential step, such as placing an order or submitting a form.', why: 'External effects cannot be undone from the dashboard.', how: 'The approval is bound to the exact step and a nonce. It is consumed after one execution.', permission: 'Owner or a delegated approver.' },
  'browser.humanTakeover': { title: 'Human takeover', what: 'Takeover gives you temporary direct control in the isolated VPS browser session. All browser boundaries remain enforced.', why: 'Some steps, like a CAPTCHA, need a person.', how: 'Control is time-boxed, recorded and limited to the granted origin.' },
  'browser.takeoverScope': { title: 'Takeover time box', what: 'How long you control the session before it returns to the agent.' },
  'browser.actions': { title: 'Action timeline', what: 'Every step moves through proposal, policy, execution and observation.', why: 'You can see what the agent wanted, what policy decided and what really happened.', example: 'Proposal: click "Place order". Policy: needs approval. Execution: after approval. Observation: confirmation page.' },
  /* ---------------- Results & Versions ---------------- */
  'results.library': { title: 'Results library', what: 'All artifacts produced by missions, with type, version, provenance and a verification badge.', why: 'One place to find what the company built, and to trust it.', how: 'Filter by type, mission or verification. Select a card to preview it in a safe viewer.' },
  'results.verification': { title: 'Verification', what: 'A version is verified when independent checks passed with evidence.', why: 'Pending versions can be previewed but should not be released.' },
  'results.versions': { title: 'Immutable versions', what: 'Each version has its own bytes and checksum. A newer version never overwrites an older one.', why: 'You can always return to, compare, or download any retained version.' },
  'results.preview': { title: 'Safe preview', what: 'A sandboxed renderer that shows a website, document or dataset without running anything on the host.', how: 'The sandbox has no network egress, a read-only filesystem and an expiry.', permission: 'Previews of unverified builds are labelled as such.' },
  'results.run': { title: 'Run a result', what: 'Run creates an isolated preview or execution request. It is not a host shell command and not a deployment.', why: 'Keeps code execution inside approved isolation.', permission: 'Execution of source code stays disabled until isolation is approved.' },
  'results.timeline': { title: 'Version timeline', what: 'An immutable, time-ordered list of versions, grouped by mission, with contributor and verification.', how: 'Pick any version to compare it to the current one or download it.' },
  'results.branch': { title: 'Branch graph', what: 'The lineage of a mission: baseline, mission lines, commits with evidence, and protected merges into main.', why: 'You see how a change travels from work-in-progress to the protected main line.', how: 'Merges need passing checks and review. A dashed edge means checks are still pending.', permission: 'There is no one-click bypass of checks.' },
  'results.compare': { title: 'Comparison', what: 'A side-by-side line diff of two versions, plus visual and benchmark deltas.', how: 'Added lines are green and removed lines are red. Accept or reject with evidence.' },
  'results.downloads': { title: 'Downloads', what: 'Download any retained, authorized version or a ZIP bundle with a manifest and checksums.', how: 'The manifest lists every file and its SHA-256. Verify hash recomputes the manifest digest.', example: 'DEMO: the downloaded file is a manifest JSON generated in your browser.' },
  'results.release': { title: 'Release pipeline', what: 'Candidate, tested, approved, deployed, rolled back. The current and last-known-good versions are always retained.', why: 'Deployment and rollback are consequential, so they need owner approval.' },
  'results.canary': { title: 'Canary share', what: 'The percentage of traffic that sees the new version first.', why: 'If errors rise, the release rolls back before most users are affected.' },
  'results.rollback': { title: 'Rollback', what: 'Switches production back to the last-known-good version.', why: 'Restores service quickly. The failed version stays retained for analysis.', permission: 'Owner authorization.' },

  /* ---------------- Knowledge ---------------- */
};
export default h;
