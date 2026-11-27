import { describe, it, expect } from 'vitest';
// same setup as evolve2-web-parts.test.ts: the web's pure parts render here with the react and react-dom the web ships
// @ts-ignore
import { createElement } from '../../web/node_modules/react/index.js';
// @ts-ignore
import { renderToStaticMarkup } from '../../web/node_modules/react-dom/server.node.js';
// @ts-ignore the server's tsconfig has no jsx setting (it is a protected file); vitest compiles the file with the web's
import { EvolveReport } from '../../web/src/features/mission/EvolveReport.tsx';
import type { EvolveInfo } from '../../web/src/data/types.ts';

const html = (el: unknown): string => renderToStaticMarkup(el);
const render = (evolve: EvolveInfo) => html(createElement(EvolveReport, { evolve, view: 'results' }));

describe('the change report header: updated time', () => {
  it('a valid date shows its toLocaleString() text and a dateTime attribute', () => {
    const at = '2026-11-27T10:00:00.000Z';
    const out = render({ state: 'queued', attempt: 1, updatedAt: at });
    expect(out.toLowerCase()).toContain(`datetime="${at.toLowerCase()}"`);
    expect(out).toContain(`updated ${new Date(at).toLocaleString()}`.replace(/&/g, '&amp;'));
    expect(out).not.toContain('Invalid Date');
  });
  it('a missing or invalid date shows "updated —" and no dateTime attribute', () => {
    for (const updatedAt of [undefined, '', 'not a date']) {
      const out = render({ state: 'queued', attempt: 1, updatedAt } as unknown as EvolveInfo);
      expect(out).toContain('updated —');
      expect(out).not.toContain('Invalid Date');
      expect(out).not.toMatch(/datetime=/i);
    }
  });
});
