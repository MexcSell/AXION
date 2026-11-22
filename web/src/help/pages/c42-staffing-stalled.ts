import type { HelpEntry } from '../registry';

const entries: Record<string, HelpEntry> = {
  'mission.staffing.stalled': {
    title: 'Staffing stopped',
    what: 'The server tried to staff this mission and the step failed 13 times in a row, so it stopped trying instead of looping forever. Nothing is lost: the mission keeps its plan and the agents that already joined.',
    how: 'Retries wait longer each time (up to 30 seconds). At the 13th failure the server writes an audit row (staffing.gave_up), sends a live event and shows this banner. An administrator or the mission owner can press Retry, which clears the stop and starts again. A server restart does not retry by itself.',
    why: 'A mission that silently stays half staffed looks fine and never finishes. Staffing is a simulation today: no agent executes work.',
  },
};
export default entries;
