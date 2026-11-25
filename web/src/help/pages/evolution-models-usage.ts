import type { HelpEntry } from '../registry';

const entries: Record<string, HelpEntry> = {
  'models.page': {
    title: 'Models',
    what: 'System Operations lists the model connections configured on the AXION server.',
  },
  'models.tab.providers': {
    title: 'Model providers',
    what: 'Each card shows a configured connection and its latest check. Refresh retrieves the account and usage windows reported by the provider.',
    permission: 'Administrators can refresh, enable, disable or remove a model.',
  },
  'models.tab.playground': {
    title: 'Model playground',
    what: 'Choose an enabled model and send a prompt. The response includes the model output, token counts and elapsed time. JSON mode checks whether the answer parses as JSON.',
    permission: 'Administrators can send prompts.',
  },
};

export default entries;
