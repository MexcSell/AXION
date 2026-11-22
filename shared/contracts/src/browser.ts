/** Browser action contract (spec §10.7). Types and limits only: the strict validator lives in server/src/browser/schema.ts.
 *  The model proposes structured actions; it never supplies JavaScript, CDP, shell or SQL. */

export type Locator =
  | { by: 'role'; role: string; name: string; exact?: boolean }
  | { by: 'label'; label: string; exact?: boolean }
  | { by: 'testId'; testId: string }
  | { by: 'css'; selector: string }; // restricted fallback

export type BrowserAction =
  | { type: 'navigate'; url: string }
  | { type: 'observe' }
  | { type: 'click'; target: Locator }
  | { type: 'fill'; target: Locator; valueRef: string }
  | { type: 'select'; target: Locator; value: string }
  | { type: 'scroll'; direction: 'up' | 'down'; pixels: number }
  | { type: 'waitFor'; target: Locator; timeoutMs: number }
  | { type: 'screenshot' }
  | { type: 'download'; target: Locator }
  | { type: 'finish'; summary: string };

export const BROWSER_ACTION_TYPES = ['navigate', 'observe', 'click', 'fill', 'select', 'scroll', 'waitFor', 'screenshot', 'download', 'finish'] as const;
export const LOCATOR_KINDS = ['role', 'label', 'testId', 'css'] as const;

export const BROWSER_LIMITS = Object.freeze({
  urlMax: 2048, pathQueryMax: 1500, nameMax: 200, testIdMax: 100, cssMax: 200, valueMax: 200, summaryMax: 2000,
  pixelsMax: 10_000, timeoutMsMax: 30_000, roleMax: 30,
});
