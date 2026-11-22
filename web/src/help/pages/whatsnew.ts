import type { HelpEntry } from '../registry';
import { whatsNewHelp } from '../whatsnew';

/** Help entries for the What's new guide (cycle 17): one ? entry per feature page, plus the tab itself. */
const entries: Record<string, HelpEntry> = {
  ...whatsNewHelp(),
  'help.whatsnew': {
    title: "What's new",
    what: 'A short guide to every feature added since the server arrived: what it does, where to find it, what is real, what is still DEMO, and a link that opens it.',
    why: 'The long write-ups live in files; this is the same story in the app.',
    permission: 'It describes the server version. The offline demo (?data=demo) shows sample data.',
  },
};
export default entries;
