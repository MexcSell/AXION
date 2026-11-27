import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classify, parseRules, globToRegExp, isCanonicalPath, touches } from './classify.ts';

const rules = parseRules(readFileSync(new URL('../protected.txt', import.meta.url), 'utf8'));
const hit = (path: string, status: 'A' | 'M' | 'D' | 'R' = 'M', oldPath?: string) =>
  classify([{ path, status, ...(oldPath ? { oldPath } : {}) }], rules).hits;

test('protected.txt parses to exactly the agreed rule list', () => {
  assert.deepEqual(rules, [
    'server/migrations/**', 'server/src/auth/**', 'server/src/approvals/**', 'server/src/policy/**', 'server/src/grants/**',
    'server/src/cloud/claude-cli.ts', '**/.env*', '**/.env*/**',
    'server/src/main.ts', 'server/src/migrate.ts', 'server/src/migrate-cli.ts', 'server/src/leader.ts', 'server/src/locks.ts', 'server/src/health.ts',
    'server/src/cli/evolve-missions.ts', 'server/src/jobs/run-halts.ts', 'server/src/db.ts', 'server/src/missions/machine.ts', 'server/src/events/log.ts',
    'evolve/**', '.dockerignore', '**/Dockerfile*', '**/*.Dockerfile', '**/docker-compose*', '**/.gitattributes',
    '.claude/**', '**/.claude/**', '**/CLAUDE.md', '**/CLAUDE.local.md', '**/AGENTS.md', '**/.mcp.json',
    '**/.vscode/**', '**/.cursor/**', '**/.idea/**', '**/*.code-workspace', '**/.devcontainer/**', '**/.devcontainer.json',
    '.github/**', '.husky/**', '**/.envrc',
    'web/docs/evolve/**', 'web/docs/improve/**',
    '**/package.json', '**/package-lock.json', '**/.npmrc',
    'server/vitest.config.ts', 'server/tsconfig.json', 'web/tsconfig.json', 'web/vite.config.ts', 'web/security-headers.ts', 'server/test/setup.ts', 'server/test/helpers.ts', 'web/scripts/api-e2e.sh',
    'modify:server/test/**', 'modify:web/scripts/**',
  ]);
});

test('plain rules hit any status, including new files', () => {
  for (const s of ['A', 'M', 'D', 'R'] as const) {
    assert.deepEqual(hit('server/migrations/0066_x.up.sql', s), ['server/migrations/0066_x.up.sql'], s);
  }
  assert.deepEqual(hit('evolve/guard/deploy.ts', 'A'), ['evolve/guard/deploy.ts']);
  assert.deepEqual(hit('evolve/protected.txt'), ['evolve/protected.txt']);
  assert.deepEqual(hit('server/src/auth/session.ts'), ['server/src/auth/session.ts']);
  assert.deepEqual(hit('server/src/cloud/claude-cli.ts'), ['server/src/cloud/claude-cli.ts']);
  assert.deepEqual(hit('server/test/setup.ts', 'A'), ['server/test/setup.ts']);
  assert.deepEqual(hit('web/scripts/api-e2e.sh'), ['web/scripts/api-e2e.sh']);
  // fix wave I4: what shapes the judge or the deploy contract
  for (const p of ['server/tsconfig.json', 'web/tsconfig.json', 'web/vite.config.ts', 'web/security-headers.ts', 'server/src/main.ts', 'server/src/migrate.ts',
    'server/src/migrate-cli.ts', 'server/src/leader.ts', 'server/src/locks.ts', 'server/src/health.ts', 'server/src/cli/evolve-missions.ts', 'server/.env.d/x', '.env.d/a/b', '.npmrc', 'server/.npmrc', 'web/.npmrc',
    'web/.env.local.d/x.txt']) {
    assert.deepEqual(hit(p, 'A'), [p], p);
  }
  for (const p of ['server/src/app.ts', 'server/src/healthx.ts', 'web/vite.config.js.md', 'server/src/main.tsx']) assert.deepEqual(hit(p), [], p);
});

test('**/ rules match at the repo root and at any depth', () => {
  for (const p of ['Dockerfile', 'web/Dockerfile.dev', 'evolve/docker/app.Dockerfile', 'x/y/app.Dockerfile', '.env', 'server/.env',
    'server/.env.local', 'package.json', 'web/package.json', 'package-lock.json', 'server/package-lock.json', 'docker-compose.yml',
    'deploy/docker-compose.prod.yaml', '.dockerignore']) {
    assert.deepEqual(hit(p, 'A'), [p], p);
  }
});

test('R26: agent and tool configuration is protected at the root (leading-dot segments) and, for **/ rules, at any depth', () => {
  for (const p of ['.claude/settings.json', '.claude/hooks/x.sh', 'web/.claude/settings.local.json', 'CLAUDE.md', 'web/CLAUDE.md',
    'CLAUDE.local.md', 'server/src/CLAUDE.local.md', 'AGENTS.md', 'web/src/AGENTS.md', '.mcp.json', 'web/.mcp.json', '.vscode/tasks.json',
    '.github/workflows/ci.yml', '.husky/pre-commit', '.devcontainer/devcontainer.json', '.envrc', 'server/.envrc']) {
    for (const s of ['A', 'M'] as const) assert.deepEqual(hit(p, s), [p], `${p} ${s}`);
  }
  // R33: editor and dev-container settings at any depth; the owner's evolution and improvement docs
  for (const p of ['web/.vscode/settings.json', '.vscode/tasks.json', 'server/.cursor/rules/x.mdc', '.cursor/mcp.json', 'web/.idea/workspace.xml', '.idea/x.iml',
    'axion.code-workspace', 'web/w.code-workspace', 'web/.devcontainer/devcontainer.json', '.devcontainer.json', 'server/.devcontainer.json',
    'web/docs/evolve/2026-11-26-step2-plan.md', 'web/docs/evolve/new-ruling.md', 'web/docs/improve/BACKLOG.md', 'web/docs/improve/cycles/c99-brief.md',
    'server/src/jobs/run-halts.ts', 'server/src/db.ts', 'server/src/missions/machine.ts', 'server/src/events/log.ts']) {
    for (const s of ['A', 'M', 'D'] as const) assert.deepEqual(hit(p, s), [p], `${p} ${s}`);
  }
  // .github and .husky are root-only rules; near-misses are not protected
  for (const p of ['docs/.github/x.md', 'web/src/vscode.ts', 'web/src/idea.ts', 'web/.cursorrules.md', 'web/docs/evolvex/a.md', 'web/docs/x/evolve/a.md',
    'web/src/docs/improve/a.ts', 'server/src/jobs/run-halts.test.ts', 'server/src/dbx.ts', 'server/src/events/hooks.ts', 'server/src/missions/service.ts', 'web/src/claude.ts', 'web/src/CLAUDE.md.ts', 'web/src/agents.tsx', 'notes/.claudex/a',
    'web/.mcp.json.bak', 'web/envrc']) {
    assert.deepEqual(hit(p, 'A'), [], p);
  }
});

test('ordinary app code is not protected', () => {
  for (const p of ['server/src/missions/x.ts', 'web/src/pages/Home.tsx', 'server/src/cloud/other.ts', 'README.md',
    'server/src/authx/a.ts', 'web/package.json.md', 'server/migrationsx/a.sql', 'evolvex/a.ts', 'server/src/auth', 'xevolve/a.ts',
    'my.dockerignore', 'server/test-setup.ts', 'web/src/Docker.ts', 'server/src/cli/demo.ts', 'server/src/cli/evolve-missions.tsx']) {
    assert.deepEqual(hit(p, 'M'), [], p);
  }
});

test('modify: rules allow new files and hit modified, deleted and renamed ones', () => {
  assert.deepEqual(hit('server/test/new-feature.test.ts', 'A'), []);
  assert.deepEqual(hit('web/scripts/api-new.mjs', 'A'), []);
  assert.deepEqual(hit('server/test/auth.test.ts', 'M'), ['server/test/auth.test.ts']);
  assert.deepEqual(hit('server/test/auth.test.ts', 'D'), ['server/test/auth.test.ts']);
  assert.deepEqual(hit('web/scripts/api-c05.mjs', 'M'), ['web/scripts/api-c05.mjs']);
  assert.deepEqual(hit('server/test/sub/dir/x.test.ts', 'M'), ['server/test/sub/dir/x.test.ts']);
});

test('renamed files are checked on both the old and the new path', () => {
  // moving a protected file out of a protected dir: old path hits
  assert.deepEqual(hit('server/src/x/session.ts', 'R', 'server/src/auth/session.ts'), ['server/src/auth/session.ts']);
  // moving an ordinary file into a protected dir: new path hits
  assert.deepEqual(hit('evolve/guard/x.ts', 'R', 'server/src/x.ts'), ['evolve/guard/x.ts']);
  // renaming an existing test away (deleting it from the suite): modify: rule hits the old path
  assert.deepEqual(hit('server/src/old.test.ts', 'R', 'server/test/auth.test.ts'), ['server/test/auth.test.ts']);
  // a rename inside server/test/ hits (R is a modification), on both paths
  assert.deepEqual(hit('server/test/b.test.ts', 'R', 'server/test/a.test.ts'), ['server/test/a.test.ts', 'server/test/b.test.ts']);
  // a rename between ordinary paths is fine
  assert.deepEqual(hit('web/src/b.ts', 'R', 'web/src/a.ts'), []);
});

test('hits are unique and keep diff order; a mixed diff reports only the protected paths', () => {
  const r = classify([
    { path: 'web/src/a.ts', status: 'M' },
    { path: 'server/migrations/0066_x.up.sql', status: 'A' },
    { path: 'server/test/new.test.ts', status: 'A' },
    { path: 'package.json', status: 'M' },
    { path: 'server/migrations/0066_x.up.sql', status: 'M' },
  ], rules);
  assert.deepEqual(r.hits, ['server/migrations/0066_x.up.sql', 'package.json']);
});

test('unknown statuses are treated as modifications (fail closed)', () => {
  const r = classify([{ path: 'server/test/a.test.ts', status: 'T' as 'M' }], rules);
  assert.deepEqual(r.hits, ['server/test/a.test.ts']);
});

test('glob semantics: * stays inside one segment, dots are literal, matches are anchored', () => {
  assert.equal(globToRegExp('a/*.ts').test('a/b.ts'), true);
  assert.equal(globToRegExp('a/*.ts').test('a/b/c.ts'), false);
  assert.equal(globToRegExp('a/*.ts').test('a/bxts'), false);
  assert.equal(globToRegExp('a/*.ts').test('x/a/b.ts'), false);
  assert.equal(globToRegExp('a/**').test('a/b/c/d'), true);
  assert.equal(globToRegExp('a/**').test('ab/c'), false);
  assert.equal(globToRegExp('**/b').test('b'), true);
  assert.equal(globToRegExp('**/b').test('x/y/b'), true);
  assert.equal(globToRegExp('**/b').test('xb'), false);
  assert.equal(globToRegExp('a/**/b').test('a/b'), true);
  assert.equal(globToRegExp('a/**/b').test('a/x/y/b'), true);
  assert.equal(globToRegExp('(x)+[y]').test('(x)+[y]'), true);
});

test('parseRules ignores comments, blank lines and surrounding whitespace', () => {
  assert.deepEqual(parseRules('# c\n\n  a/**  \r\nmodify:b/**\n   # indented comment\n'), ['a/**', 'modify:b/**']);
});

test('non-canonical paths are always hits (fail closed): quoted, absolute, ./, empty/./.. segments, backslash, control chars', () => {
  for (const p of ['./evolve/guard/x.ts', '/evolve/x.ts', '"server/migrations/0066_\\303\\244.sql"', 'server//migrations/a.sql',
    'server/src/x/../auth/a.ts', 'server/./migrations/a.sql', 'web/src/a.ts/', 'web\\src\\a.ts', 'web/src/a\nb.ts', 'web/src/a\tb.ts',
    'web/src/\u007f.ts', '..', '']) {
    assert.deepEqual(classify([{ path: p, status: 'A' }], rules).hits, [p], JSON.stringify(p));
  }
  // also on the old side of a rename
  assert.deepEqual(classify([{ path: 'web/src/b.ts', status: 'R', oldPath: './web/src/a.ts' }], rules).hits, ['./web/src/a.ts']);
  // ordinary unicode and dots inside names are canonical
  for (const p of ['web/src/ä.ts', 'web/src/.hidden.ts', 'web/src/a..b.ts']) assert.equal(isCanonicalPath(p), true, p);
});

test('Unicode line/paragraph separators and C1 controls: non-canonical (hit), and ** still matches them', () => {
  const probes = ['evolve/guard/x .ts', 'server/migrations/0067_a b.up.sql', 'server/src/auth/ ',
    'web/src/a\u0085.ts', 'web/src/a\u009b.ts'];
  for (const p of probes) {
    assert.equal(isCanonicalPath(p), false, JSON.stringify(p));
    assert.deepEqual(classify([{ path: p, status: 'A' }], rules).hits, [p], JSON.stringify(p));
  }
  assert.deepEqual(classify([{ path: 'server/test/a .ts', status: 'M' }], rules).hits, ['server/test/a .ts']);
  // the glob layer alone (independent of the canonical check) also matches across these characters
  assert.equal(globToRegExp('evolve/**').test('evolve/guard/x .ts'), true);
  assert.equal(globToRegExp('server/src/auth/**').test('server/src/auth/ '), true);
  assert.equal(globToRegExp('**/package.json').test('a b/package.json'), true);
  assert.equal(globToRegExp('evolve/*.ts').test('evolve/a b.ts'), true);
  assert.equal(touches([{ path: 'server/migrations/0067_a b.up.sql', status: 'A' }], 'server/migrations/**'), true);
  assert.equal(touches([{ path: 'x.sql', status: 'R', oldPath: 'server/migrations/ .sql' }], 'server/migrations/**'), true);
});
