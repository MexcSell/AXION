import type { Db, Tx } from '../db.ts';
import { VISIBLE_SQL } from '../missions/visibility.ts';
import { VISIBLE_NOTICE_SQL } from '../notifications/routes.ts';

/**
 * The company data a chat agent sees (owner 2026-11-25: "What the GM can see: company data").
 *
 * An explicit allowlist, read-only, always scoped to the asker's tenant, and missions (with their tasks and approvals) limited to the
 * ones the asker may see on the Missions page (VISIBLE_SQL). Other users' names and roles only for an administrator. Never: other
 * people's direct chats, emails, sessions, passwords, audit rows, idempotency keys, uploads, tokens or the server environment.
 * The text goes to the model on stdin (the cloud CLI runner), never on the command line.
 */
export interface Asker { tenantId: string; userId: string; admin: boolean }
export interface ModelInfo { id: string; label: string; model: string }

const CAP = 60_000; // characters of company data in one prompt
const clip = (s: unknown, n: number) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const day = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—');

/** The web app's screens (web/src/config/nav.ts and App.tsx); "/" opens Missions. */
const APP_PAGES = `AXION web app pages (the home page "/" opens Missions):
- Missions (/missions): add missions and follow their agents live. Workspace tabs: Overview, Activity, Hierarchy, Task Flow, Conversations, Results, Approvals, Reports, Timeline, Ledger.
- Notifications (/notifications): Inbox, Pending decisions, Resolved.
- Settings (/settings): General, Users, Forecasts, Navigation, Appearance, Avatars & Faces, Accessibility, Browser.
- Overview (/overview, hidden from the rail by default): Pulse, Needs you, Portfolio, Activity, Health.
- Results & Versions (/results): Library, Releases.
- System Operations (/operations): Services, Agents (Directory, Development, Lineage, Live Instances, Departments, Policies, Proposals, Dimensions), Models (Providers, Playground), Queues.
- Help Center (/help): New Features, Guides, Context Help, Shortcuts, Troubleshooting, Glossary.
- The Chat dock (General Manager, Administrators, one chat per agent). Ctrl K searches every page and tab.`;

export async function companyContext(c: Db | Tx, who: Asker, models: ModelInfo[]): Promise<string> {
  const q = async (sql: string, p: unknown[]) => (await c.query(sql, p)).rows as any[];
  const T = who.tenantId;
  const out: string[] = [];

  const tenant = (await q('select name from tenants where id=$1', [T]))[0];
  const me = (await q('select name, role from users where id=$1 and tenant_id=$2', [who.userId, T]))[0];
  out.push(`Company: ${clip(tenant?.name ?? T, 80)}. Today: ${day(new Date())}. You are talking with ${clip(me?.name ?? 'a user', 60)} (${me?.role ?? 'member'}).`);
  out.push(APP_PAGES);

  if (who.admin) {
    const users = await q(`select name, role, status from users where tenant_id=$1 order by created_at limit 100`, [T]);
    out.push(`People (${users.length}): ` + users.map((u) => `${clip(u.name, 40)} (${u.role}${u.status !== 'approved' ? ', ' + u.status : ''})`).join('; '));
  }

  const agents = await q(`select id, name, role, dept, duty, description, status, parent_id, profile->>'grade' as grade, profile->>'level' as level, profile->>'load' as load
    from agent_definitions where tenant_id=$1 order by dept, name limit 200`, [T]);
  const rev = (await q('select id, seq from org_revisions where tenant_id=$1 order by seq desc limit 1', [T]))[0];
  const boss = new Map<string, string>();
  if (rev) for (const e of await q('select supervisor_id, subordinate_id from org_edges where revision_id=$1', [rev.id])) boss.set(e.subordinate_id, e.supervisor_id);
  const nameOf = new Map(agents.map((a) => [a.id, a.name]));
  out.push(`Agents (${agents.length}; reporting lines from org revision ${rev?.seq ?? '—'}):\n` + agents.map((a) =>
    `- ${a.name} [id ${a.id}] ${a.role}, ${a.dept}: ${clip(a.duty, 80)}.${a.status !== 'active' ? ' ' + a.status + '.' : ''}` +
    `${boss.get(a.id) ? ' Reports to ' + (nameOf.get(boss.get(a.id)) ?? boss.get(a.id)) + '.' : ''}${a.parent_id ? ' Derived from ' + (nameOf.get(a.parent_id) ?? a.parent_id) + '.' : ''}` +
    `${a.grade ? ` Grade ${a.grade}, level ${a.level ?? '?'}, load ${a.load ?? '?'}%.` : ''} ${clip(a.description, 160)}`).join('\n'));

  const missions = await q(`select m.id, m.status, m.shared, m.created_at, m.updated_at, m.presentation->>'leadId' as lead, u.name as owner,
      r.title, r.kind, r.priority, r.text, r.criteria
    from missions m join users u on u.id=m.owner_id
    left join mission_revisions r on r.mission_id=m.id and r.revision=m.current_revision
    where m.tenant_id=$1 and m.deleted_at is null and ${VISIBLE_SQL('$2', '$3')}
    order by m.updated_at desc limit 40`, [T, who.admin, who.userId]);
  if (!missions.length) out.push('Missions you can see: none.');
  else {
    const ids = missions.map((m) => m.id);
    const tasks = await q(`select mission_id, title, status, owner_agent from tasks where tenant_id=$1 and mission_id = any($2::text[]) order by mission_id, col, row limit 600`, [T, ids]);
    const byMission = new Map<string, any[]>();
    for (const t of tasks) byMission.set(t.mission_id, [...(byMission.get(t.mission_id) ?? []), t]);
    out.push(`Missions you can see (${missions.length}, newest first):\n` + missions.map((m) => {
      const crit = Array.isArray(m.criteria) ? m.criteria : [];
      const ts = byMission.get(m.id) ?? [];
      const counts = Object.entries(ts.reduce((a: Record<string, number>, t) => ((a[t.status] = (a[t.status] ?? 0) + 1), a), {})).map(([k, v]) => `${v} ${k}`).join(', ');
      return `- ${m.id} "${clip(m.title, 100)}" (${m.kind ?? '?'}, ${m.priority ?? '?'} priority) status ${m.status}; owner ${clip(m.owner, 40)}${m.shared ? ', shared' : ''}; lead ${nameOf.get(m.lead) ?? m.lead ?? '—'}; updated ${day(m.updated_at)}.` +
        `\n  Goal: ${clip(m.text, 300)}` +
        (crit.length ? `\n  Criteria: ${crit.map((x: any) => `${x.done ? '[done]' : '[open]'} ${clip(x.text, 90)}`).join('; ')}` : '') +
        (ts.length ? `\n  Tasks (${counts}): ${ts.slice(0, 12).map((t) => `${clip(t.title, 70)} [${t.status}${t.owner_agent ? ', ' + (nameOf.get(t.owner_agent) ?? t.owner_agent) : ''}]`).join('; ')}${ts.length > 12 ? '; …' : ''}` : '');
    }).join('\n'));
  }

  const approvals = await q(`select a.title, a.kind, a.risk, a.mission_id, a.created_at, a.expires_at from approval_requests a join missions m on m.id=a.mission_id
    where a.tenant_id=$1 and a.state='pending' and m.deleted_at is null and ${VISIBLE_SQL('$2', '$3')} order by a.created_at desc limit 30`, [T, who.admin, who.userId]);
  out.push(approvals.length ? `Pending approvals (${approvals.length}):\n` + approvals.map((a) => `- ${clip(a.title, 100)} (${a.kind}, risk ${a.risk}, mission ${a.mission_id}, expires ${day(a.expires_at)})`).join('\n') : 'Pending approvals: none.');

  const notes = await q(`select n.title, n.severity, n.created_at from notifications n left join missions m on m.id=n.mission_id
    where ${VISIBLE_NOTICE_SQL} order by n.created_at desc limit 10`, [T, who.admin, who.userId]);
  if (notes.length) out.push('Recent notifications: ' + notes.map((n) => `${clip(n.title, 80)} (${n.severity}, ${day(n.created_at)})`).join('; '));

  out.push('Live cloud models on this server: ' + (models.length ? models.map((m) => `${m.label} (${m.model})`).join(', ') : 'none') +
    '. Agents do not execute missions yet: only this chat calls a model.');

  const text = out.join('\n\n');
  return text.length > CAP ? text.slice(0, CAP - 40) + '\n…(company data cut here)' : text;
}
