import type { HelpEntry } from '../registry';

/** Help for Stage 5: the AXION server (sign-in, missions, approvals and live updates). Later entries override older demo texts. */
const entries: Record<string, HelpEntry> = {
  'app.connection': {
    title: 'Live connection',
    what: 'Shows whether this tab receives live updates from the AXION server. Live: changes by other users appear at once. Reconnecting: the link dropped and the tab is retrying. Stale: no updates for 30 seconds; what you see may be out of date.',
    how: 'Nothing to do: the tab reconnects by itself, resumes from the last update it saw, and reloads the lists so nothing is lost or shown twice. Unsent text and open dialogs are kept.',
    why: 'Missions, approvals and users are shared by everyone, so every screen must show the same truth.',
  },
  'app.dataMode': {
    title: 'Server connection',
    what: 'AXION reads workspace records from the server after you sign in.',
    how: 'Check the connection indicator in the header. AXION reconnects automatically after a service interruption.',
  },
  'settings.users.password': { title: 'Password change', what: 'Change the password you connect with. You need the current one; the new one needs at least 8 characters.', permission: 'The server keeps only an argon2id hash. Changing it signs out your other devices.' },
  'settings.users.devices': { title: 'My devices', what: 'Every browser you connected from. A new browser waits until an administrator approves it.', how: 'Remove a device to force a new approval next time.' },
  'shell.account': { title: 'Account', what: 'Who is connected in this browser. Every tab of a browser is the same user; use another browser or a private window for a second user.', how: 'Open your profile, or sign out to connect as someone else.' },
  'ops.serverHealth': {
    title: 'AXION server',
    what: 'Live, read-only status of the real server: API uptime, database size and mission count, event-log length, open live streams, the newest backup, the age of the public suffix list snapshot, and whether mission execution is enabled.',
    how: 'Refreshes every 15 seconds and after live events. Backups: npm run db:backup on the server; npm run db:restore-check proves a backup restores. The public suffix list (which decides how broad a site grant is) is a pinned snapshot: the tile warns once it is older than 90 days. Refreshing it is a reviewed code change with a new manifest, never a button.',
    why: 'Execution stays disabled in Stage 5: missions are planned and staffed (simulated), but no agent, model or browser runs yet.',
    permission: 'Administrators only.',
  },
  'ops.publicSuffix': {
    title: 'Public suffix list',
    what: 'The public suffix list decides what counts as one site when you grant access (for example that co.uk is a suffix, so a grant cannot cover all of it). The server uses a pinned snapshot; this tile shows its date and age.',
    how: 'It turns to a warning after 90 days. Refreshing it is a reviewed code change with a new manifest, never a button here. If the age cannot be read, the tile says so: do not assume the list is fresh.',
    permission: 'Administrators only.',
  },
  'ops.jobRecords': {
    title: 'Job records',
    what: 'Durable job records from the server: how many jobs sit in each state (queued, leased, succeeded, failed, canceled, dead), how long the oldest queued job has waited, and how many leases have expired.',
    how: 'Read-only. A job is leased by a worker with a fencing token and a heartbeat; an expired lease is reclaimed, and after the last attempt a job is dead-lettered.',
    why: 'Records only: no workers run in this build, so every count stays at zero until a later stage turns execution on.',
    permission: 'Administrators only. Nothing here enqueues, claims or cancels a job.',
  },
  'ops.auditAnchor': {
    title: 'Audit anchor',
    what: 'The audit log is a hash chain, which on its own only proves it is consistent with itself. The anchor is a signed checkpoint of the newest audit row, kept in a file outside the database. This tile checks that the chain still contains the anchored row with the same hash.',
    how: 'An operator writes a checkpoint with npm run audit:anchor on the server (never automatic). "Matches" means no row at or before the checkpoint was removed or rewritten (hashes at the anchored positions agree); it is not a full content check, which npm run audit:verify and the audit check do. "Rows were removed" or "history was rewritten" means someone with database access changed the log after the checkpoint.',
    why: 'Rows added after the last checkpoint are not covered until the next one, and deleting the whole newest checkpoint cannot be seen. "Not verifiable" means no key or no checkpoint file yet, never a pass.',
    permission: 'Administrators only. The signing key stays in the server environment and is never shown here.',
  },
  'mission.demoTag': { title: 'DEMO mission', what: 'A sample mission from the prototype, stored on the server so the screens have content. It is marked DEMO everywhere.', how: 'An administrator removes all of them with "npm run demo:clear" on the server. Your own missions are never DEMO.' },
};
export default entries;
