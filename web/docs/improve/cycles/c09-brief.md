# Cycle 9 — Lane w7 · code health H1: server minors batch

## Hypothesis
Reviews in Stage 6 and cycles 1–3 deferred a set of small server defects. Each one is cheap to fix now and gets more
expensive once more code builds on it. Fix them as a batch, each with a test.

## The list
Sources: `web/docs/stage6-ledger.md` lines "minor (deferred)", and `web/docs/improve/cycles/c0*-review.md` Minor sections.
1. **`replyTo` validation (T3 M4, T6 M6):** `replyTo` on POST messages and channels must reference a message in the
   same thread, else 422.
2. **Duplicated post validation (T6 M5):** the `PostIn` schema and checks are copied between
   `conversations/routes.ts` and `direct.ts`. Extract one shared validator.
3. **`task.delegated` payloads (T5):** two shapes under one type (task vs instance subjectKind). Unify the payload so
   both carry `{taskId?, fromInstance, toInstance}`. Update `shared/contracts`.
4. **Reassign target state (T5):** reassigning to an instance that has `ended_at` or state `done` → 422.
5. **`listInstances` (T2 M8):** it silently truncates at 500 rows. Add paging (`?before=&limit=`) or raise the limit
   with an explicit `truncated: true` flag. The cycle 2 "Staffed Agents" tile must count correctly either way; test it.
6. **The trailing read-mark timer (final review minor, web `chat.ts:452`)** fires after a channel closes: cancel it on
   close. This is web, but tiny.
7. **Hard-coded "Luca (Owner)" in the web app's AgentProfile and Notifications (final review minor):** use the real
   owner or user name in api mode.
8. Any other one-line "minor (deferred)" item in the ledger that is server-side and clearly safe. List what you took and
   what you left.

## Measure and pass threshold (fixed now)
Each item has a test that failed first (RED) and passes after (GREEN). The whole server suite, the api-mode browser
checks (`api-auth-flow`, `api-flows`, `api-stage6`, `api-improve`) and verify-all stay green.

## Migration
Only if needed: 0018.

## Lane
You are lane w7: worktree `/home/luca/AXION-w7`. Follow `/home/luca/AXION/web/docs/improve/LANES.md` exactly (ports, the `heavy.sh` gate, the dev-server override config `/home/luca/AXION-lanes/vite-w7.config.ts`, migrations, commits, report). Safety rules: `/home/luca/AXION/web/docs/improve/PROCESS.md`.
