import type { HelpEntry } from '../registry';

/** Help for missions and agent activity after the 2026-11-20 u1 owner update. */
const entries: Record<string, HelpEntry> = {
  'mission.activity': { title: 'Agent activity', what: 'Every agent records its own work while it carries out a mission: tokens consumed, active time, current CPU and RAM, and what it is doing right now.', why: 'You see exactly where the effort goes. There are no budgets or funds; tokens and time are the measures.', how: 'The header totals all agents. The Activity tab shows each agent with a live log.' },
  'agent.merge': { title: 'Experience merge', what: 'One agent can work several missions at the same time. Each mission instance learns separately and merges its new experience back into the original agent at a fixed interval.', why: 'Lessons from one mission help the same agent in every other mission, without mixing the missions\' private data.', example: 'Coder-01 works M-126 and M-129. Every 15 min each instance merges what it learned into Coder-01.' },
  'mission.visibility': { title: 'Who can see a mission', what: 'Every mission belongs to the user who added it. Users see their own missions and shared ones; administrators see all missions.', how: 'Turn on Share to make a mission visible to every user. The owner or an administrator can change it later from the mission header.' },
  'mission.staffing': { title: 'Staffing: GM → executor → agents', what: 'After you add a mission, the General Manager reads it and appoints one general executor. The executor brings the agents the work needs, one at a time.', why: 'One accountable executor per mission, and only the agents that are needed. No agent duty appears twice.', example: 'A research mission: GM appoints Researcher-01, who brings Analyst-01, Browser-01, Knowledge-01, Writer-01 and Tester-01.' },
  'mission.content': { title: 'Mission content', what: 'Exactly what the user entered: the text and the attached files (image, audio, video, doc, pdf, txt). The title and kind are read from it.' },
};
export default entries;
