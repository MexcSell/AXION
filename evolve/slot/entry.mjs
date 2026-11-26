#!/usr/bin/env node
// Slot entry (evolve step 1): the container's one process. Runs from WORKDIR /app (`node evolve/slot/entry.mjs`).
//  - api: `node --import tsx src/main.ts` in server/ (binds 127.0.0.1:5191 inside the container; settings from the environment)
//  - web: `vite preview --host 0.0.0.0 --port 4190 --strictPort` in web/ (serves web/dist, proxies /api to AXION_API, default 127.0.0.1:5191)
// If either exits, the other is stopped and this process exits with the first one's code (a signal = 128 + its number),
// so Docker sees the slot as down. SIGTERM/SIGINT are forwarded to both. Both are spawned as `node` directly (no npm/npx
// wrapper), so the signal reaches the real process.
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KILL_AFTER_MS = 10_000;

const specs = [
  { name: 'api', args: ['--import', 'tsx', 'src/main.ts'], cwd: join(root, 'server') },
  { name: 'web', args: [join(root, 'web', 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--host', '0.0.0.0', '--port', '4190', '--strictPort'], cwd: join(root, 'web') },
];

const log = (msg) => console.error(JSON.stringify({ level: 'info', src: 'slot-entry', msg }));
const children = new Map(); // name -> ChildProcess, while running
let exitCode = null; // set by the first child that exits (or by a signal to us)
let killTimer = null;
const signalled = new Set(); // children already asked to stop (each is signalled once; the SIGKILL timer handles a hang)

function stopAll(sig) {
  for (const [name, c] of children) { if (signalled.has(name)) continue; signalled.add(name); log(`sending ${sig} to ${name}`); c.kill(sig); }
  if (!killTimer && children.size) {
    killTimer = setTimeout(() => { for (const [name, c] of children) { log(`${name} still running after ${KILL_AFTER_MS} ms: SIGKILL`); c.kill('SIGKILL'); } }, KILL_AFTER_MS);
    killTimer.unref();
  }
}

for (const s of specs) {
  const c = spawn(process.execPath, s.args, { cwd: s.cwd, stdio: 'inherit', env: process.env });
  children.set(s.name, c);
  c.on('error', (e) => {
    log(`${s.name} error: ${e.message}`);
    if (c.pid === undefined) c.emit('exit', 1, null); // never started: no 'exit' event will come
  });
  c.on('exit', (code, signal) => {
    children.delete(s.name);
    const rc = code ?? (signal ? 128 + (constants.signals[signal] ?? 0) : 1);
    log(`${s.name} exited (code ${code}, signal ${signal})`);
    if (exitCode === null) { exitCode = rc; stopAll('SIGTERM'); }
    if (children.size === 0) process.exit(exitCode);
  });
}

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    log(`received ${sig}`);
    stopAll(sig);
  });
}
