import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSchema } from './helpers.ts';
import { discoverAppendOnly } from './append-only-guards.ts';
import { lintMigration, type LintFinding } from './migration-lint.ts';

// c80 item 2 (R4-6): a lint over migration files. Existing migrations are a frozen baseline (name + sha256 of the up and down file);
// every migration NOT in the baseline (0058 onward, or an unused reserved number that lands later) is linted.
const HERE = dirname(fileURLToPath(import.meta.url));
const MIG = join(HERE, '..', 'migrations');
const BASELINE: Record<string, { up: string; down: string }> = JSON.parse(readFileSync(join(HERE, 'fixtures', 'c80-migration-baseline.json'), 'utf8'));
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const AO = new Set(['audit_events', 'events', 'messages', 'task_reviews', 'approval_requests', 'mission_ledgers']);
const DOWN = 'drop table if exists fx;';
const lint = (up: string, down: string | null = DOWN) => lintMigration({ name: '9999_fx', up, down }, AO);
const rules = (f: LintFinding[]) => f.map((x) => x.rule);

// Bad fixture migrations: each must be flagged with the stated rule.
const BAD: [string, string, string | null, LintFinding['rule']][] = [
  ['drops an append-only table', 'drop table messages;', DOWN, 'drop-append-only'],
  ['drops an append-only table, schema-qualified and quoted', 'DROP TABLE IF EXISTS "public"."Events" CASCADE;', DOWN, 'drop-append-only'],
  ['drops a column of an append-only table', 'alter table events drop column detail;', DOWN, 'drop-append-only'],
  ['drops a constraint of an append-only table among other changes', 'alter table task_reviews add column z int, drop constraint task_reviews_pkey;', DOWN, 'drop-append-only'],
  ['drops a CHECK and never re-adds it', 'alter table approval_requests drop constraint approval_requests_digest_version_check;', DOWN, 'drop-append-only'],
  ['drops a CHECK and re-adds it under another name', 'alter table approval_requests drop constraint a_check; alter table approval_requests add constraint b_check check (x in (1,2,3));', DOWN, 'drop-append-only'],
  ['drops a CHECK and re-adds the name as UNIQUE, not CHECK', 'alter table approval_requests drop constraint a_check; alter table approval_requests add constraint a_check unique (x);', DOWN, 'drop-append-only'],
  ['re-adds the CHECK before dropping it (the drop wins)', 'alter table approval_requests add constraint a_check check (x > 0); alter table approval_requests drop constraint a_check;', DOWN, 'drop-append-only'],
  ['re-adds the CHECK on another table', 'alter table approval_requests drop constraint a_check; alter table events add constraint a_check check (x > 0);', DOWN, 'drop-append-only'],
  ['swaps a primary key for a CHECK of the same name', 'alter table messages drop constraint messages_pkey; alter table messages add constraint messages_pkey check (id is not null);', DOWN, 'drop-append-only'],
  ['widens a CHECK but also drops a column in the same statement', 'alter table approval_requests drop constraint a_check, drop column payload; alter table approval_requests add constraint a_check check (x in (1,2,3));', DOWN, 'drop-append-only'],
  ['drops a guard trigger and does not recreate it', 'drop trigger events_no_update on events;', DOWN, 'drop-append-only'],
  ['disables a guard trigger and never re-enables it', 'alter table audit_events disable trigger audit_events_no_update; alter table audit_events add column x int;', DOWN, 'guard-disabled'],
  ['disables ALL triggers', 'alter table messages disable trigger all;', DOWN, 'guard-disabled'],
  ['re-enables a different trigger than the one it disabled', 'alter table events disable trigger events_no_update; alter table events enable trigger events_no_truncate;', DOWN, 'guard-disabled'],
  ['turns triggers off for the session', "set session_replication_role = replica; create table fx_t (id int);", DOWN, 'guard-disabled'],
  ['updates append-only rows', "update messages set body = 'x' where true;", DOWN, 'rewrite-rows'],
  ['updates append-only rows inside a DO block', "do $$ begin update task_reviews set verdict = 'ok'; end $$;", DOWN, 'rewrite-rows'],
  ['updates append-only rows even with the purge flag set (the flag only allows DELETE)', "set local axion.purge_demo = 'on'; update events set detail = '{}';", DOWN, 'rewrite-rows'],
  ['deletes append-only rows', "delete from audit_events where tenant_id = 'x';", DOWN, 'rewrite-rows'],
  ['deletes append-only rows before the purge flag is set', "delete from events; set local axion.purge_demo = 'on';", DOWN, 'rewrite-rows'],
  ['deletes append-only rows with the flag set to off', "set local axion.purge_demo = 'off'; delete from events;", DOWN, 'rewrite-rows'],
  ['truncates an append-only table', 'truncate table approval_requests;', DOWN, 'rewrite-rows'],
  ['changes the type of a chain-hash column', 'alter table audit_events alter column detail type text;', DOWN, 'chain-column'],
  ['renames a chain-hash column', 'alter table audit_events rename column row_hash to rh;', DOWN, 'chain-column'],
  ['has no down file', 'create table fx (id int);', null, 'missing-down'],
  ['has an empty down file', 'create table fx (id int);', '-- nothing here\n  ', 'missing-down'],
];

// Good fixtures: must produce no finding (false-positive guard).
const GOOD: [string, string][] = [
  ['an additive column on an append-only table', 'alter table messages add column note text;'],
  ['a new table with its guard trigger and function (function bodies mention update/delete)', `create table fx (id int); create function fx_g() returns trigger language plpgsql as $$ begin update messages set body = 'x'; delete from events; raise exception 'append-only'; end $$; create trigger fx_t before update on fx for each row execute function fx_g();`],
  ['a DELETE under the purge flag', "set local axion.purge_demo = 'on'; delete from events where demo;"],
  ['a DELETE under the purge flag set through set_config inside a DO block', "do $$ begin perform set_config('axion.purge_demo', 'on', true); delete from task_reviews; end $$;"],
  ['disable then enable the same trigger in one file', 'alter table audit_events disable trigger audit_events_no_update; update fx set a = 1; alter table audit_events enable trigger audit_events_no_update;'],
  ['disable then enable ALL', 'alter table events disable trigger all; alter table events enable trigger all;'],
  ['session_replication_role set and reset', 'set session_replication_role = replica; reset session_replication_role;'],
  ['drop and recreate the same guard trigger', 'drop trigger events_no_update on events; create trigger events_no_update before update or delete on events for each row execute function events_append_only();'],
  ['drop, update and delete on tables that are not append-only', 'drop table notifications; alter table users drop column x; update users set a = 1; delete from sessions;'],
  ['a comment or string that mentions the forbidden statements', "-- drop table messages;\n/* delete from events; */ insert into notes(t) values ('update messages set x = 1; drop table events;');"],
  ['an upsert on an append-only table (ON CONFLICT DO UPDATE is not an UPDATE statement)', "insert into messages(id) values ('a') on conflict (id) do update set id = excluded.id;"],
  ['widens a CHECK: drop it and re-add one with the same name later in the file (owner-approved exception, 0064)', 'alter table approval_requests drop constraint approval_requests_digest_version_check;\nalter table approval_requests add constraint approval_requests_digest_version_check check (digest_version in (1,2,3));'],
  ['an alter of a non-chain column of an append-only table', 'alter table audit_events add column memo text, alter column memo set default 0;'],
];

describe('c80: migration lint (fixtures)', () => {
  for (const [name, up, down, rule] of BAD) it(`flags a migration that ${name}`, () => { expect(rules(lint(up, down))).toContain(rule); });
  for (const [name, up] of GOOD) it(`passes ${name}`, () => { expect(lint(up)).toEqual([]); });
  it('has at least 12 bad fixtures', () => { expect(BAD.length).toBeGreaterThanOrEqual(12); });
});

describe('c80: migration lint (the real migrations)', () => {
  const files = readdirSync(MIG).filter((f) => f.endsWith('.up.sql')).sort();
  it('every baseline migration is unchanged (the baseline is frozen)', () => {
    for (const [name, h] of Object.entries(BASELINE)) {
      expect(existsSync(join(MIG, name + '.up.sql')), `${name} up file is gone`).toBe(true);
      expect(sha(readFileSync(join(MIG, name + '.up.sql'), 'utf8')), `${name} up file changed`).toBe(h.up);
      expect(sha(readFileSync(join(MIG, name + '.down.sql'), 'utf8')), `${name} down file changed`).toBe(h.down);
    }
  });
  it('every migration outside the baseline passes the lint', async () => {
    const s = await makeSchema();
    try {
      const ao = new Set(await discoverAppendOnly(s.pool));
      const fresh = files.map((f) => f.replace(/\.up\.sql$/, '')).filter((n) => !(n in BASELINE));
      const found: string[] = [];
      for (const n of fresh) {
        const downFile = join(MIG, n + '.down.sql');
        const f = lintMigration({ name: n, up: readFileSync(join(MIG, n + '.up.sql'), 'utf8'), down: existsSync(downFile) ? readFileSync(downFile, 'utf8') : null }, ao);
        for (const x of f) found.push(`${n}: ${x.rule} ${x.table ?? ''} ${x.detail}`);
      }
      expect(found).toEqual([]);
      console.log(`c80 lint: ${fresh.length} migration(s) outside the baseline, all clean`);
    } finally { await s.drop(); }
  });
  it('reports what the lint would say about the baseline (informational, not a failure)', async () => {
    const s = await makeSchema();
    try {
      const ao = new Set(await discoverAppendOnly(s.pool));
      const hits: string[] = [];
      for (const n of Object.keys(BASELINE)) for (const x of lintMigration({ name: n, up: readFileSync(join(MIG, n + '.up.sql'), 'utf8'), down: readFileSync(join(MIG, n + '.down.sql'), 'utf8') }, ao)) hits.push(`${n}: ${x.rule} ${x.table ?? ''}`);
      console.log(`c80 lint on the ${Object.keys(BASELINE).length} baseline migrations: ${hits.length} finding(s)\n${hits.join('\n')}`);
      expect(Object.keys(BASELINE).length).toBeGreaterThan(30);
    } finally { await s.drop(); }
  });
});
