import type { FastifyInstance } from 'fastify';
import { attachSeams, type Rewrite } from './seam.ts';

/**
 * Seeded visibility leaks for c87 (test-process seams only: a SQL rewrite on the app's pool, or an onSend hook; nothing here touches src).
 * `visibleAnyone` keeps the bind parameters of VISIBLE_SQL used (`... or m.shared or true`), because replacing the predicate by `true` makes
 * PostgreSQL reject the query (c68-review.md:59), which would break the route instead of leaking.
 */
export const visibleAnyone = (read: RegExp): Rewrite => (sql, params) => {
  if (!/^\s*(with|select)/i.test(sql) || !read.test(sql)) return null;
  const out = sql.replace(/(\(\$\d+::boolean or m\.owner_id = \$\d+ or m\.shared)\)/g, '$1 or true)');
  return out === sql ? null : { sql: out, params };
};
/** The event stream's visibility is decided in memory from this SELECT of the mission rows: lie about `shared`. */
export const streamSeesAllShared: Rewrite = (sql, params) => (/^\s*select id, owner_id, shared, deleted_at, tenant_id from missions where id = any/i.test(sql) ? { sql: sql.replace('owner_id, shared,', 'owner_id, true as shared,'), params } : null);

/** A hook that copies one private text into a nested field of one route's body, as a careless "history" or "related items" join would. */
export const LEAK = { on: false, text: '', applied: 0 };
export function attachVisSeams(app: FastifyInstance) {
  attachSeams(app);
  app.addHook('onSend', async (req, _reply, payload) => {
    if (!LEAK.on || req.method !== 'GET' || !/^\/api\/v1\/agents\/coder-01(\?|$)/.test(req.url) || typeof payload !== 'string') return payload;
    try { const j = JSON.parse(payload); (j.agent ??= {}).recent = [{ events: [{ detail: { items: [{ text: LEAK.text }] } }] }]; LEAK.applied++; return JSON.stringify(j); } catch { return payload; }
  });
}

export interface VisMutant { id: string; kind: string; what: string; sql?: Rewrite; leak?: true; expect: RegExp /* matched against `${relation} ${route}` */ }
export const VIS_MUTANTS: VisMutant[] = [
  { id: 'V01', kind: 'list route', what: 'the mission list drops VISIBLE_SQL', sql: visibleAnyone(/order by m\.created_at desc, m\.id desc/), expect: /^(V1|V2) GET \/missions$/ },
  { id: 'V02', kind: 'aggregate (floor)', what: 'the skill cells of an agent count every private mission\'s outcomes: the n >= 5 floor is crossed with hidden outcomes (the c86 shape)', sql: visibleAnyone(/o\.first_status as status|first_status/), expect: /^V1 GET \/agents\/:id\/skills$/ },
  { id: 'V03', kind: 'aggregate (numbers)', what: 'the company scorecard loader reads every mission, not the visible ones', sql: visibleAnyone(/select m\.id, m\.owner_id from missions m/), expect: /^V1 GET \/company\/scorecard$/ },
  { id: 'V04', kind: 'id route', what: 'the task lookup by id drops VISIBLE_SQL (GET /tasks/:id and the review routes)', sql: visibleAnyone(/from tasks t join missions m[\s\S]*where t\.id=\$1/), expect: /^(ID|IDW) (GET|POST) \/tasks\/:id/ },
  { id: 'V05', kind: 'id route', what: 'the thread lookup by id drops VISIBLE_SQL (GET /threads/:id/messages)', sql: visibleAnyone(/from conversation_threads c left join missions m/), expect: /^(ID|IDW) (GET|POST) \/threads\/:id/ },
  { id: 'V06', kind: 'list route', what: 'the approval list drops VISIBLE_SQL', sql: visibleAnyone(/from approval_requests a join missions m/), expect: /^(V1|V2) GET \/approvals$/ },
  { id: 'V09', kind: 'join (c86 shape)', what: 'every department count that joins `missions m` drops VISIBLE_SQL in its join clause (GET /departments)', sql: visibleAnyone(/join missions m/i), expect: /^V1 GET \/departments$/ },
  { id: 'V10', kind: 'gate query feeding later aggregates', what: 'the mission gate of the company process and dimensions loaders drops VISIBLE_SQL, so their task, review, attempt and approval aggregates read private missions', sql: visibleAnyone(/select m\.id, m\.demo from missions m/), expect: /^V1 GET \/company\/(process|dimensions)$/ },
  { id: 'V07', kind: 'nested field', what: 'GET /agents/:id carries a private mission\'s text in a nested field (agent.recent[].events[].detail.items[].text)', leak: true, expect: /^V2 GET \/agents\/:id$/ },
  { id: 'V08', kind: 'SSE', what: 'the event stream treats every mission as shared, so a private mission\'s events reach every member', sql: streamSeesAllShared, expect: /^SSE GET \/events\/stream$/ },
];
