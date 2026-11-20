import type { HelpEntry } from '../registry';

const h: Record<string, HelpEntry> = {
  'mission.create': { title: 'Create a mission', what: 'A four-step wizard: Goal → Resources → Team, policy & budget → Review. You cannot start a mission without at least one measurable success criterion.', how: 'Create Draft saves without running anything. Create & Start lets GM plan and staff the team. External actions still need approval.', shortcut: 'Ctrl + Enter = next step' },
  'mission.revision': { title: 'Mission revisions', what: 'Editing a mission creates a new definition revision. Running tasks keep the terms they started with unless you apply the change to them explicitly.' },
  'mission.delete': { title: 'Archive vs purge', what: 'Archive hides the mission but keeps everything recoverable until the retention date. Purge permanently deletes it and needs the Owner role plus a typed confirmation.' },
  'mission.lifecycle': { title: 'Start, pause, stop, retry', what: 'Pause stops agents before their next action and keeps their state. Stop finishes in-flight actions at a safe boundary and cancels the remaining tasks. Retry resumes from the last verified checkpoint.', permission: 'Form submissions and publishes are never auto-replayed.' },
  'mission.controls': { title: 'Mission controls', what: '▶ start/resume · ⏸ pause · ⟳ retry from checkpoint · ■ stop at safe boundary. Every control opens a confirmation that shows exactly what will happen.' },
  'gov.autonomy': { title: 'Autonomy level', what: 'Safe read: observe only. Prepare: draft changes. Review each: every action needs approval. Execute (gated): routine actions run; consequential ones still need approval.' },
};
export default h;
