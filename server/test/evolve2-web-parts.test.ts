import { describe, it, expect } from 'vitest';
// the web has no test runner of its own: its pure parts render here with the react and react-dom the web ships (no types from this side)
// @ts-ignore
import { createElement } from '../../web/node_modules/react/index.js';
// @ts-ignore
import { renderToStaticMarkup } from '../../web/node_modules/react-dom/server.node.js';
// @ts-ignore the server's tsconfig has no jsx setting (it is a protected file); vitest compiles the file with the web's
import { EvolveReport, ImproveOption, shortCommit } from '../../web/src/features/mission/EvolveReport.tsx';
import { missionCreateBody } from '../../web/src/features/mission/create-body.ts';
import type { EvolveInfo } from '../../web/src/data/types.ts';

const SHA = 'abc1234def5678900000000000000000000000ff';
const live: EvolveInfo = {
  state: 'live', attempt: 1, updatedAt: '2026-11-27T10:00:00.000Z', commit: SHA, base: 'f'.repeat(40),
  filesChanged: ['web/src/pages/Missions.tsx', 'server/src/missions/routes.ts'], diffStat: ' 2 files changed, 12 insertions(+), 3 deletions(-)',
  checks: 'server tests: 4836 passed', guard: { outcome: 'live' }, report: 'The missions list is denser now.',
};
const html = (el: unknown): string => renderToStaticMarkup(el);

describe('Add mission: the Improve AXION option', () => {
  const opt = (admin: boolean, checked = false) => html(createElement(ImproveOption, { admin, checked, onChange: () => undefined }));
  it('renders for an administrator with the label and the help line', () => {
    const out = opt(true);
    expect(out).toContain('type="checkbox"');
    expect(out).toContain('Improve AXION itself — agents change this website');
    expect(out).toContain("An engineer agent changes AXION&#x27;s code; checks run; it goes live automatically unless it touches a protected area");
    expect(out).not.toContain('checked=""');
    expect(opt(true, true)).toContain('checked=""');
  });
  it('renders nothing for anyone else', () => expect(opt(false)).toBe(''));
  it('the create body carries improve:true only when ticked', () => {
    expect(missionCreateBody({ text: 'x', shared: false, improve: true }, ['f1'])).toEqual({ text: 'x', files: ['f1'], shared: false, improve: true });
    expect(missionCreateBody({ text: 'x', shared: true }, [])).toEqual({ text: 'x', files: [], shared: true });
    expect(missionCreateBody({ text: 'x', shared: true, improve: false }, [])).not.toHaveProperty('improve');
  });
});

describe('the change report of an improve mission', () => {
  it('results view: state, short commit, files and report', () => {
    const out = html(createElement(EvolveReport, { evolve: live, view: 'results' }));
    expect(out).toContain('Live');
    expect(out).toContain('abc1234');
    expect(out).toContain('>abc1234<');
    expect(out).not.toContain('>abc1234d');
    expect(shortCommit(SHA)).toBe('abc1234');
    expect(out).toContain('web/src/pages/Missions.tsx');
    expect(out).toContain('server/src/missions/routes.ts');
    expect(out).toContain('2 files changed');
    expect(out).toContain('The missions list is denser now.');
  });
  it('reports view: checks, guard outcome and the report', () => {
    const out = html(createElement(EvolveReport, { evolve: { ...live, state: 'rejected', guard: { outcome: 'rejected', failedStep: 'tests', reason: 'a test failed' }, hits: ['web/vite.config.ts'] }, view: 'reports' }));
    expect(out).toContain('Rejected');
    expect(out).toContain('server tests: 4836 passed');
    expect(out).toContain('tests');
    expect(out).toContain('a test failed');
    expect(out).toContain('web/vite.config.ts');
  });
  it('a just-queued mission (only the required fields) renders without a commit or files', () => {
    const out = html(createElement(EvolveReport, { evolve: { state: 'queued', attempt: 1, updatedAt: '2026-11-27T10:00:00.000Z' }, view: 'results' }));
    expect(out).toContain('Queued');
    expect(out).not.toContain('Commit');
  });
  it('report text is escaped, not rendered as html', () => {
    const out = html(createElement(EvolveReport, { evolve: { ...live, report: '<img src=x onerror=alert(1)>' }, view: 'results' }));
    expect(out).not.toContain('<img');
  });
});
