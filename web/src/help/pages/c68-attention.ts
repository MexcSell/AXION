import { ATTENTION_REASONS, ATTENTION_RANKING_TEXT } from '@contracts';
import type { HelpEntry } from '../registry';

const h = (title: string, what: string, why?: string, how?: string, example?: string, permission?: string): HelpEntry => ({ title, what, why, how, example, permission });

/**
 * Improvement cycle 68: the "Needs you" queue. One entry per reason code, generated from the same table the server and the screen use.
 * No entry claims that the screen prevents mistakes or makes anyone check more: it says where an item came from and which check to run.
 */
const entries: Record<string, HelpEntry> = {
  'attention.tab': h('Needs you', 'One list of what needs a person now: approvals waiting, reviews that no longer match their task, tasks waiting on a person, failures nobody recorded a detection channel for, proposals about to expire, and lessons waiting for review.',
    'These items sit in different screens. Here they are in one place, in a fixed order, each with the reason it is listed.',
    'Choose a row. Activity lists the items behind it, Action says what you can do, and Evidence gives the check that would expose a defect in the item. Every row has a ? that explains its reason.',
    'An R3 "release" approval is first. Choose it, open Evidence, and compare the bound digest with the recomputed one before deciding.',
    'You see only what the screens it comes from already show you. Reading this list changes nothing.'),
  'attention.ranking': h('How the list is ordered', ATTENTION_RANKING_TEXT,
    'A fixed order is easy to predict and to test: the same data always gives the same list. It is a design choice made for this screen, not something a study found. It does not change any decision, tier or approval.',
    `1. Tier: an approval's tier counts, R4 first, then R3, then R2; everything without a tier comes next. 2. Expiry: rows that expire come before rows that do not, the soonest first. 3. Wait: the longest first. 4. The id, to break ties. A folded row is ranked by its best item. Nothing about you, and nobody's name, is used.`,
    undefined, 'There is no alert budget and nothing is suppressed. The only rows folded together are related items, and each stays listed under its row.'),
  'attention.collapsed': h('Folded rows', 'Related items are shown as one row with a count: pending approvals of the same tier from one mission, stale reviews or waiting tasks of one mission, failures of the same mode, lessons for the same agent.',
    'Twelve failures of the same mode are one thing to look at, not twelve.',
    'The count on the row is exactly the number of items inside it, and the header shows how many items are folded. Open the row to see every item under Activity. R3 and R4 approvals are never folded: each has its own row.',
    '5 R2 approvals from mission M-126 appear as one row "×5". Under Activity they are listed one by one.'),
  'attention.levels': h('Three levels of detail', 'Activity is what the row stands for. Action is what you can do, by the same rule the deciding screen uses. Evidence is the check that would expose a defect, with the stored facts to run it against.',
    'The evidence is a check to run, not a summary that says the item is fine.', undefined, undefined, 'Evidence is two clicks from the list: choose the row, then Evidence.'),
};
for (const r of ATTENTION_REASONS) entries[`attention.reason.${r.code}`] = h(r.label, r.what, undefined, `Where it comes from: ${r.source} What you can do: ${r.action}`);
export default entries;
