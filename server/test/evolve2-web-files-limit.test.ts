import { describe, it, expect } from 'vitest';
// same setup as evolve2-web-parts.test.ts: the web's pure parts render here with the react and react-dom the web ships
// @ts-ignore
import { createElement } from '../../web/node_modules/react/index.js';
// @ts-ignore
import { renderToStaticMarkup } from '../../web/node_modules/react-dom/server.node.js';
// @ts-ignore the server's tsconfig has no jsx setting (it is a protected file); vitest compiles the file with the web's
import { EvolveReport, FILES_SHOWN, visibleFiles } from '../../web/src/features/mission/EvolveReport.tsx';
import type { EvolveInfo } from '../../web/src/data/types.ts';

const html = (el: unknown): string => renderToStaticMarkup(el);
const files = (n: number) => Array.from({ length: n }, (_, i) => `src/file-${i + 1}.ts`);
const render = (filesChanged: string[]) =>
  html(createElement(EvolveReport, { evolve: { state: 'live', attempt: 1, commit: 'abcdef1234567', filesChanged } as EvolveInfo, view: 'results' }));
const items = (out: string) => (out.match(/<li><code>src\/file-\d+\.ts<\/code><\/li>/g) ?? []).length;

describe('the change report: long "Files changed" list', () => {
  it('21 files: the first 20 are shown with a "Show all 21 files" button; the heading keeps the total', () => {
    const out = render(files(21));
    expect(FILES_SHOWN).toBe(20);
    expect(items(out)).toBe(20);
    expect(out).toContain('src/file-20.ts');
    expect(out).not.toContain('src/file-21.ts');
    expect(out).toContain('Files changed (21)');
    expect(out).toMatch(/<button[^>]*type="button"[^>]*aria-expanded="false"[^>]*>Show all 21 files<\/button>/);
  });
  it('20 files: all are shown and there is no button', () => {
    const out = render(files(20));
    expect(items(out)).toBe(20);
    expect(out).toContain('Files changed (20)');
    expect(out).not.toContain('<button');
    expect(out).not.toContain('Show all');
  });
  it('expanded shows every file; collapsed shows the first 20; short lists are never cut', () => {
    expect(visibleFiles(files(21), true)).toHaveLength(21);
    expect(visibleFiles(files(21), false)).toEqual(files(21).slice(0, 20));
    expect(visibleFiles(files(5), false)).toHaveLength(5);
  });
});
