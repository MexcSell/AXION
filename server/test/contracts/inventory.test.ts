import { describe, it, expect } from 'vitest';
import { makeTestApp } from '../helpers.ts';
import { EVENT_TYPES } from '../../../shared/contracts/src/index.ts';
import { ROUTES } from './registry.ts';
import { EVENT_VALIDATORS } from './events.ts';
import { registeredRoutes, routeProblems, emittedEventTypes, eventProblems } from './inventory.ts';

/**
 * Improvement cycle 50: the inventory. The route list comes from the running Fastify route table and the event list from the
 * shared contracts and the server source, so a new route or event without a contract check fails here on the day it is added.
 */
describe('route inventory', () => {
  it('every registered route has a contract entry or a reasoned exclusion, and every entry is a registered route', async () => {
    const t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000 });
    try {
      const routes = registeredRoutes(t.app.routeTable);
      expect(routes.length, 'the route table was read').toBeGreaterThan(100);
      expect(routeProblems(routes, ROUTES)).toEqual([]);
    } finally { await t.close(); }
  });

  it('RED proof: a dummy route added to the app is reported (a dummy contract entry for no route too)', async () => {
    const t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, configure: (app: any) => { app.get('/api/v1/zz-dummy', async () => ({ ok: true })); } });
    try {
      const routes = registeredRoutes(t.app.routeTable);
      expect(routes).toContain('GET /zz-dummy');
      expect(routeProblems(routes, ROUTES)).toEqual([expect.stringContaining('GET /zz-dummy: registered but has neither a contract entry nor an explicit exclusion')]);
      expect(routeProblems(routes.filter((r) => r !== 'GET /health'), ROUTES).join('\n')).toContain('GET /health: in the registry but no such route is registered');
      expect(routeProblems(['GET /health'], { 'GET /health': { exclude: 'too short' } }).join('\n')).toContain('needs a real reason');
    } finally { await t.close(); }
  });

  it('lists every exclusion with its reason', () => {
    const ex = Object.entries(ROUTES).filter(([, e]) => 'exclude' in e).map(([k, e]) => `${k}: ${(e as { exclude: string }).exclude}`);
    expect(ex.length).toBeLessThanOrEqual(3); // health, static and SSE style routes only; a new exclusion is a deliberate review decision
  });
});

describe('event inventory', () => {
  it('every event type has a payload validator, every validator is a declared type, and the server emits exactly the declared types', () => {
    expect(eventProblems(EVENT_TYPES, Object.keys(EVENT_VALIDATORS), emittedEventTypes())).toEqual([]);
  });

  it('RED proof: a dummy event type with no validator, a dummy validator, and a dummy emit are each reported', () => {
    const v = Object.keys(EVENT_VALIDATORS), em = emittedEventTypes();
    expect(eventProblems([...EVENT_TYPES, 'dummy.happened'], v, em).join('\n')).toContain('dummy.happened: declared in EVENT_TYPES but has no payload validator');
    expect(eventProblems(EVENT_TYPES, [...v, 'dummy.validated'], em).join('\n')).toContain('dummy.validated: has a payload validator but is not in EVENT_TYPES');
    expect(eventProblems(EVENT_TYPES, v, [...em, 'dummy.emitted']).join('\n')).toContain('dummy.emitted: emitted by the server but missing from EVENT_TYPES');
    expect(eventProblems([...EVENT_TYPES, 'dummy.happened'], [...v, 'dummy.happened'], em).join('\n')).toContain('dummy.happened: in EVENT_TYPES but no server code emits it');
  });
});
