# AXION Web — Build Log & Decisions

Autonomous build session started 2026-11-20. The owner was away for ~8h and said: "make your own decision".

## Authority / scope decisions
- The master spec (ACO-MASTER-001) says "design only; Stage 0 first; stop after each stage".
  The owner's direct instruction overrides that **only for building the frontend UI prototype unattended**
  (≈ spec Stages 1–4: shell, design system, all routes/tabs, dialogs, using clearly-marked DEMO fixtures).
- OUT of scope (not started): backend/API, DB, auth, real Playwright browser sessions, systemd, deployment.
- `/home/thomas/subnet-scout` was read-only. `update/2026-11-20/` was not modified.
- New project: `/home/luca/AXION/web`. Git on `main` since Stage 5 (commit per task; `node_modules/`, `dist/`, `.env` ignored).

## Design decisions
- Visual target: `/home/thomas/subnet-scout/docs/update_2026-11-15/40-4.png` (1672×941), a dark neon-glass command center.
  This look is the default skin ("Luminous", dark).
- Skins (spec §7.2): Luminous (default, = 40-4), Flat, Pretty, Fancy. Each skin has Light, Dark and System.
- Brand: **AXION** (project folder and prototype name). The image says "AXoR". The name lives in one constant: `src/config/brand.ts`.
- Navigation and routes follow the spec and readme, not the image's nav. Finance and Bittensor are out.
  Models, Users, Browser Studio and Results & Versions are in.
- Raster art from the mock is not reused (it has baked-in text). Robots, hero skyline and core cube are parametric SVG
  components. The robot SVG also powers the Avatars & Faces editor.
- Stack: React 19 + TS + Vite 8, react-router 7, motion (Framer Motion), lucide-react, zustand, Radix (popover/tooltip/dropdown).
  Charts, graphs and avatars are custom SVG.
- Servers bind to 127.0.0.1 only.
- Playwright verification uses the preinstalled Chromium:
  `/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`.

## Deviations from spec §10.2 (library choices), and why
| Spec suggestion | Used here | Reason |
|---|---|---|
| Tailwind + shadcn | Hand-written CSS tokens (`theme/*.css`) and Radix primitives (Popover, Tooltip, DropdownMenu) | The 4-skin × light/dark neon look needs fine control over glows, gradients and per-skin overrides. The accessible primitives still come from Radix. |
| React Flow / XYFlow | Custom SVG hierarchy graph and task DAG (tidy-tree layout, pan/zoom/fit, list alternative) | Exact control over directional animated edges (delegate ↓ / report ↑ pulses) and node styling, with fewer dependencies. Can be swapped in later. |
| TanStack Query, React Hook Form + Zod | Not yet; zustand DEMO store and local validation | There is no API until Stage 5. Add them together with the typed contracts. |
| Vitest | Playwright scripts (`crawl`, `crawl-deep`, `flows`, `dialog-smoke`, `check-help`, `check-dialogs`) | These verify the real rendered UI. Add Vitest when backend logic (state machines, policy) exists. |
| Versions unpinned | React 19.3, Vite 8.3, TypeScript 7.0 (native), motion 14, react-router 7.18, zustand 5, lucide 1.76. Exact versions are locked in `package-lock.json` (in git since Stage 5). | — |

## Owner update 2026-11-20 u1 (`update/2026-11-20_u1.md`)
Plan, interpretations and review notes: `docs/plan-2026-11-20_u1.md`. Executed in 11 steps; each step was typechecked and screenshot-checked, and crawl/flows ran after steps 1, 4, 6, 7 and at the end.

**Owner decisions taken before starting**
- Rail: the top section shows only Missions, Notifications, Settings. Overview, Results, System Operations and Help are *hidden* (search, links, URLs still work; Settings › Navigation can show them). Plug-ins sit at the bottom.
- "Merge face-to-face aspects into one" = **one chat system**: one chat component and one conversation store for every chat.

**Interpretations — confirmed by the owner 2026-11-20**
- "Model Louder agent" = **Model Loader** (Loader-01). It picks a model for each agent and replaced the Finance agent (funds are gone).
- "Ilgam" (일감) = job/work; "bid" = a freelance proposal. Jobs show the rate *as listed by the job site* (plain text, no calculation).
- New job sites start with Homepage-01; deriving a brand-new site agent at runtime is not built (the 3 known sites have their own agents).
- Owner answers: Model Loader ✔; job pay stays as plain listed text ✔; Job Search sites, jobs and bidding profile stay **shared** by all users (not per user) ✔;
  a shared mission is **read and write** for every user who can see it (edit, pause, archive); only the share switch stays with the owner and admins ✔.

**What changed**
1. Removed Usage & Budgets, Knowledge, Governance, Evolution Lab, Browser Studio and the Users page (old links redirect). `/` opens Missions.
2. Rail split into core screens (top) and plug-ins (bottom); `config/plugins.ts` registry; Settings › Navigation with a live rail preview.
3. All funds gone: mission budget/cost, model prices, monthly limits, daily caps, department budgets, the `budget` approval kind, the Finance role. Tokens and active time are the measures; model usage is shown as a share of company use.
4. Sign-in (`store/auth.ts`, `features/auth/AuthGate.tsx`): name + password + Connect; first user = admin; later users and new devices wait for an admin and connect automatically (cross-tab via `storage` events + polling). Session per tab (sessionStorage). Settings › Users: avatar (initials/image/robot), name, password change, devices; admin approvals and all-users list. Demo hash only — real auth is Stage 5.
5. Missions: content-only Add mission (`dialogs/defs/mission-add.tsx`); GM → executor → agents staffing (`features/mission/staffing.ts`, driven from the shell); `ownerId`/`shared` with one visibility rule (`useVisibleMissions`, guarded `/missions/:id`); Activity tab with per-agent tokens, time, CPU, RAM, VM, concurrent missions and experience merges (`data/activity.ts`). Data store v2 migration.
6. One chat: `features/chat/ChatView.tsx` (thread, bubble, composer, minimap) used by mission threads, `ChannelChat` (store `store/chat.ts`, synced across tabs), the top-bar **ChatDock** (GM, administrators, agents, plug-ins) and the Agent Profile direct chat with individual tasks.
7. System Operations gained VMs, Agents and Models (their tabs are `?sub=`); Browser Hosts merged into VMs. Agents gained **Lineage**: Coder-01 → Mobile-Dev-01 / Web-Dev-01; Browser-01 → Homepage-01 → Site-Upwork / Site-Freelancer / Site-Wanted, with kept / shared-up / inherited knowledge (`data/lineage.ts`). Every agent has a unique `duty`; Create Agent checks duties.
8. Notifications: foldable top and bottom boards, News tab (`store/news.ts`: user posts + research-agent URLs/content, "ask agents to search"), admin user/device requests in Pending.
9. Job Search plug-in (`pages/plugins/JobSearch.tsx`, `store/jobs.ts`) replaces Browser Studio: sites | live preview + investigation process | mobilized agents + chat (instruct/teach/control); Jobs with bid status and the tailored profile; Profile with documents + text.
10. Search everything in Ctrl K: commands, every screen/tab/sub-tab, missions by content, agents by duty, chat messages, models, VMs, users, job sites, jobs, news, notifications, lessons, help (`/help?tab=context-help&k=` deep-links an entry).
11. Clean-up: stale wording, scripts updated to the new routes, shared sign-in for scripts (`scripts/_session.mjs`), new `auth-flow.mjs`, `u1-flows.mjs`, `u1-shots.mjs`; docs refreshed.

## Deviation from spec §2 (route map): Missions + Mission Control merged (owner request, 2026-11-20)
Spec §2 has two routes: `/missions` (list + progress) and `/control/:id` (Mission Control). They are now **one page, `/missions/:id`**:
- left: mission list (5 status tiles = `?filter=`, search, type, sort, row ✎/🗑); the open mission unfolds its team tree (agent → `?agent=`).
  ⇤ collapses the list to an icon rail (per-viewer, localStorage). The open mission stays pinned in the list even when outside the filter.
- centre: compact mission header (identity, lead, budget, verified ring) + the 9 Mission Control tabs (`?tab=`, icon-first when narrow)
  with the lifecycle toolbar (▶ ⏸ ⟳ ■ ⋯) at the right of the tab row.
- ~~right: conversation inspector~~ — removed in revision (c) below.
- The old progress panel's content (outcome, criteria, Plan/Now/Next, delegation strip, live events) moved into the Overview tab.
- Legacy links still resolve: `/control[/:id]?…` → `/missions[/:id]?…`, `/missions?m=ID`, `/missions?tab=<filter>`.
- `ROUTE_TABS.missions` now lists the workspace tabs; the list filters are `MISSION_FILTERS` in `config/nav.ts`.

## Owner revision 2026-11-20 (c): Missions panes, no global conversation pane, draggable dividers
- The mission list no longer unfolds anything below the selected mission (team tree and collapsed-rail avatars removed).
- The page-wide right conversation inspector is gone on every tab. Clicking an agent no longer opens the conversation drawer.
- The mission header folds to one 44px row (owner 2026-11-20 (e)). The folded row shows the kind icon, title, status, id, budget % and a small progress ring. The ⇕ button sits top-right, and the state is kept in localStorage `axion.missions.headerMin`. `ProgressRing` draws its SVG with `overflow: visible`, so the glow is no longer cut off at the box edge.
- **Conversations** tab = mission agents (`features/mission/MissionAgents.tsx`) | conversation partners | thread. Picking an agent sets `?agent=`.
  The agents pane has five views. **Graph** is the default (owner 2026-11-20 (e)): a compact node-link hierarchy (`features/mission/MiniHierarchy.tsx`) scaled to the pane width, with flowing delegation links, dotted consult/verify/mentor links, a progress bar on each node, and a ⤢ button that opens the Hierarchy tab for the same agent. The other views (owner 2026-11-20 (d)) are: Hierarchy tree with dashed guide lines and foldable branches (+N when folded, expand/collapse all), Levels (L0 lead / L1 managers / L2 specialists as avatar tiles), By status (blocked → done groups) and a flat A–Z list. The chosen view is kept in localStorage `axion.missions.agentsView`. Help: `mission.agentViews`.
- Every conversation thread has a VS Code–style **minimap** beside the scroll (`features/mission/ThreadMinimap.tsx`, owner 2026-11-20 (d)). Each message is drawn as a mini block coloured by kind and sized like its bubble, with its time beside it and a dashed marker where a new day starts. Short threads stay at a fixed small scale; long threads fit the rail. The bright box shows the visible area: click or drag to jump, or use the keys ↑↓ PgUp PgDn Home End. While scrolling, a time chip floats beside the box; hovering shows a preview of the message. The map icon in the thread header toggles it (kept in localStorage `axion.thread.minimap`). It is hidden when the thread is narrower than 340px. Help: `thread.minimap`.
- **Hierarchy** tab = graph | conversation of the selected agent (narrow Messenger). The graph refits on resize via its ResizeObserver.
- Overview team dots (and the graph 💬) jump to Conversations with that agent.
- **Draggable dividers** (`components/ui/Splitter.tsx`, `usePaneWidth`): mission list | main, agents | partners, partners | thread, graph | conversation.
  Pointer drag (clamped to the live container), ←/→ (Shift = 64 px), Home/End, Enter or double-click resets. Widths are per-viewer in localStorage (`axion.split.*`).
  CSS clamps too (e.g. `clamp(180px, var(--pane-w), 32%)`), so a width saved on a big screen can't crush neighbours on a small one. Below 1100 px the panes stack and the dividers hide.
- `scripts/flows.mjs` covers this: hierarchy pane switch, no team tree / no global pane, agents pane switches the thread, and drag + clamp + persist for every divider.

## Owner revision 2026-11-20 (b): shared frame, Agents + Organization, development stage, model manager
**Shared page frame** (`components/layout/PageFrame.tsx`, `theme/frame.css`). The parts that are identical on every screen are now one component set:
- `TopBoard`: icon · title · ? · subtitle · actions, then a row of `KpiTile` (one tile design everywhere), then the tab row with a per-tab note or toolbar on the right. An optional `aside` holds side boards such as Company Health on Overview.
- `FrameBody`: the single scroll region per tab. It has an optional fixed `head` row and `scroll={false}` for canvases.
- `BottomBoard`: a foldable row of summary boards, used on Agents, Browser Studio, Knowledge and Evolution (where it holds the Ladder). It starts folded when the viewport is under 880 px tall, unless the viewer chose otherwise (stored in localStorage).
- `TopBoard` folds too, on every page that uses it. A small chevron pill hangs under the board's bottom edge. When folded, the board becomes one compact row of icon, title, ?, tabs, toolbar and actions, about 52 px tall. The subtitle, KPI tiles, extra children and the aside (Overview's Company Health) are hidden. The state is stored per page in localStorage as `axion.top.<id>`, where id defaults to the title slug, and the board starts open. On Agents and Overview, a folded board sends the hero art behind the page so the tabs stay legible.
- Both legacy `KpiStrip` helpers now render `KpiBoard`. `CommandCenter.tsx` now exports `useCompanyKpis()` and `<CompanyHealth/>`.
- Exceptions: Missions keeps its 3-column workspace and Agent Profile keeps its player-card hero, both by design. Results keeps its KPIs in the Summary tab (earlier owner rule).

**Agents = Agents + Organization** (`/organization` → `/agents?view=hierarchy`, and `?tab=departments|assignments|policies|proposals` are kept).
- Tabs: Directory · Development · Live Instances · Departments · Assignments · Policies · Proposals.
- The Directory views are Cards, List and Hierarchy (`?view=`).
- Hierarchy is `features/agents/AgentHierarchy.tsx`: GM → departments → every agent, with connecting lines and pulses. The mouse wheel zooms toward the pointer, the background can be dragged to pan, and there are zoom/fit/reset buttons and keyboard controls (+ - 0 Home, arrows). Filters dim agents that don't match.
- **Teams concept removed** for agents: the Teams tab is gone, "Teams & Agents" is gone, and mission team wording now says agents. Users › "Teams & Access" is about humans and was left as is.
- **No duplicate agents**: one agent per role and skill set, so the roster is 18 (GM + 17). The 20 copies (-02/-03/-04) were folded into their -01 original across all data, and mission agent lists were deduplicated. Create Agent now requires a *new* role and rejects a covered one.
- **Development stage** (`features/agents/Growth.tsx`) is separate from operational status:
  - growth: Learning / Evolving / Stable, with progress and a note;
  - development stage 1–5: Seed, Apprentice, Practitioner, Expert, Master, with progress to the next stage;
  - evolution stage: Gen N plus the candidate's phase (Proposal → Experiment → Benchmark → Promotion).
  - It appears on cards, list rows, hierarchy nodes, the profile hero, the Development tab (stage ladder + 3 lanes) and the bottom boards.

**Models › Manager** (model management window). It has categories LLM · TTS · STT · Local (Ollama · GGUF) · Other · All.
- Each card shows characteristics (trait bars, strengths, best-for), a usage ring (only for models that report usage; amber ≥70%, red ≥90%) and local capacity (disk, VRAM/RAM), plus a host capacity strip.
- Clicking a card opens the `model-manage` dialog (DL-41b): enable, monthly limit, default-for-role, load/unload/remove, Ollama pull and GGUF re-quantize.
- New data fields: `runtime`, `traits`, `usage`, `weights`, and `LOCAL_HOST` in `data/models.ts`.

Verification: fit-check ALL FIT at 1672×941. At 1280×760 every page fits except the Agent Profile hero, which overflowed before this revision too (now 166 px, was 247 px).

## Progress
(updated as work proceeds)
- [x] Scaffold (Vite 8 + React 19 + TS 7), tokens for 4 skins × light/dark, base and shell CSS.
- [x] UI kit: Panel, Tabs (URL-synced), IconButton+Tip, HelpTrigger (help registry + ./help/pages/*.ts), Chips, Form, Menu, Modal, Toasts, CountUp, EmptyState.
- [x] Art: RobotAvatar (parametric, emblem/face modes), CoreCube, LogoGlyph, HeroScene, ParticleField.
- [x] Viz: RingGauge, Donut, Sparkline, AreaChart, ColumnBars, MeterRow, Radar.
- [x] Shell: TopBar (pipeline, DEMO tag, palette, theme, bell, account), Rail (collapsible, mobile drawer), CommandPalette (Ctrl+K), DialogHost (dialogs registered from ./dialogs/defs/*.tsx).
- [x] Agents page matches 40-4 at 1672×941, plus the Live Instances, Teams and Coaching tabs.
- [x] Missions page (left list / right progress) and 17 mission dialogs (wizard, edit-revision, archive/purge, lifecycle, templates, attach, AI-summary sources, agent inspector, reassign, task criteria, message details, send command/reply, attachment preview).
- [x] Mission Control with 9 tabs: hierarchy graph (directional animated edges, pan/zoom/fit, list alternative), messenger (partners → thread, Full/Compact, Command/Reply, image paste/drop/file, ack → report-upward simulation), task DAG, browser mini, results with per-version download, approvals, reports export, timeline export.
- [x] 5 parallel page agents built Overview/Org/AgentProfile, Browser/Results/Knowledge, Evolution/Models/Usage, Users/Governance/Notifications, Settings/Operations/Help (each with own dialogs, help, fixtures, CSS).
- [x] Integration fixes: lazy and isolated dialog loading, badge counts, Pretty-dark contrast, light-mode switch, div.kpi hover, AreaChart reveal bug, ErrorBoundary, CountUp reduced motion, circular import, responsive Mission Control header, collapsed-rail cube.
- [x] DEMO data persisted per browser and resettable from the command palette.

## Stage report (2026-11-20 autonomous session)

**Scope delivered:** a frontend UI prototype equivalent to spec Stages 1–4. No backend, real browser automation,
credentials or deployment. Nothing outside `/home/luca/AXION/web` was modified.
`/home/thomas/subnet-scout` was only read, for reference images.

**Servers left running:** the production preview (`vite preview`) is up at **http://127.0.0.1:4190**, bound to localhost only.
- Open it from your PC with: `ssh -L 4190:127.0.0.1:4190 <vps>`
- Stop it with: `pkill -f "vite preview"`
- The dev server on port 5190 has been stopped. Restart it with `npm run dev`.

**Full suite:** `./scripts/verify-all.sh` (needs `npm run dev` running).

**Verification evidence**
- `npm run build`: typecheck clean, production build OK. Main chunk is 668 kB (223 kB gzip); routes and dialogs are lazy chunks.
- `scripts/crawl.mjs`: 111 route×tab views, **NO PROBLEMS** in dark/luminous (dev), light/luminous (dev) and dark/fancy (production build).
  Checks: no console or page errors, no empty or placeholder tabs.
- `scripts/flows.mjs`: 12/12 PASS, including help-popover-inside-dialog keyboard layering, against both the dev server and the production build.
  - Mission row anatomy.
  - Create wizard with validation.
  - Edit revision.
  - Archive.
  - Approve, which updates the badge.
  - Hierarchy selection and inspector partners.
  - Command with image, then ack, then upward report.
  - Palette.
  - Theme toggle.
  - Help popover with Escape.
  - Modal focus trap.
- `scripts/check-dialogs.mjs`: 66 dialogs in the runtime registry; every `openDialog` id exists and every dialog is opened from somewhere.
- `scripts/dialog-smoke.mjs`: **132/132** checks pass. All 66 dialogs were opened with and without props, rendered as aria-modal with no errors, and closed on Escape.
  The ledger is in `docs/dialog-ledger.txt`, with spec DL ids.
- `scripts/check-help.mjs`: 284 referenced help keys, all defined (306 entries).
- `scripts/crawl-deep.mjs`: every mission's Mission Control and all tabs, including the edge cases (1-agent team, empty draft), and all 38 agent profiles.
  It dwells 4–5.5 s so live timers fire. **NO PROBLEMS.**
- Screenshot gallery (durable): `docs/screenshots/`.
  - Includes `00-reference-vs-implementation.jpg` (40-4 above, AXION below), 20 key screens, the 8 skin×theme combinations, and 1280/900/390 px layouts.
  - Regenerate it with `node scripts/gallery.mjs`.
- Visual review:
  - All 111 views as thumbnail contact sheets in dark (layout-level only).
  - Full-resolution checks: Agents vs 40-4, Missions, every Mission Control tab, Overview Pulse (scrolled), Usage Forecast, Organization graph and the create wizard.
  - Key views in light.
  - Agents and Mission Control in all 8 skin×theme combinations.
  - 1280, 900 and 390 px widths.

**Spec dialog coverage (DL-01…65):** all 65 spec dialogs exist.
- 63 of them are dialogs in the registry (DL-17/18 share one component in Command or Reply mode).
- DL-63 (command palette) is a layout component.
- DL-64 (unsaved changes) exists both as a dialog and inline in the create wizard.
- Extras: agent-evidence, mission-policy, attachment-preview.

**Known gaps / next decisions for the Owner**
0. Visual fidelity: the layout, components and information density match 40-4, and the palette was tuned toward its blue neon.
   - The hero skyline, tree and robot avatars are hand-built vector approximations of the painted reference, not the same artwork.
   - The reference is a raster illustration with baked-in text.
   - If exact art is wanted, drop licensed raster or 3D assets into `components/art/`.
1. Brand: the UI says **AXION**; the reference image says "AXoR". Change it in `src/config/brand.ts`.
2. All numbers, conversations and browser frames are DEMO fixtures. "Live" pulses are a labeled simulation (toggle in the graph toolbar).
3. Language: `ja` is a stored preference only; there is no translation pack yet.
4. Downloads produce manifest JSON with checksums, not real artifact bytes (Stage 8).
5. Some secondary buttons only show a DEMO toast describing the future backend effect.
6. The main bundle could be split further (motion, radix, help registry) if load time matters.
7. Next stage per the spec: **Stage 5** (auth, tenancy, PostgreSQL, mission APIs, SSE). It needs the Owner's approval and a decision on the database and destination.

## Performance pass (2026-11-20, owner: "page switches are slow, the GPU is used a lot, make it as fast as possible, change it in settings")
Measured with `scripts/perf-nav.mjs` (headless Chromium with software rendering, so the numbers are relative).
- **GPU root cause:** every `.panel` had `backdrop-filter: blur(14px)` over an always-animating background (particle canvas and hero SVG twinkles). The blur was recomputed every frame. Idle went from 24 fps to 60 fps with it removed.
- **Slow switch root cause:**
  - `AnimatePresence mode="wait"` held the new page for the 120 ms exit, then ran a 220 ms enter.
  - `React.lazy` suspended on every first visit, and React holds a fallback for at least about 300 ms.
- **Fix:** new preferences in Settings › Appearance (help keys `settings.graphics` and `settings.pageTransition`):
  - **Graphics:** Fast (default) or Full effects. Fast means no panel blur (`[data-gfx='full'] .panel` gates it), no particle canvas, and still hero art.
  - **Page switch:** Instant (default), Fast (a 90 ms opacity fade, no wait) or Smooth (the old behaviour).
  - Route chunks are preloaded on idle, and `preloadable()` in App.tsx renders an already-loaded page without suspending.
- **Results:**

  | Build | Median page switch | Idle frame rate |
  |---|---|---|
  | Production, before | 438 ms | 24 fps |
  | Production, after | 65 ms | 60 fps |
  | Dev, before | 610 ms | 24 fps |
  | Dev, after | 176 ms | 60 fps |

- **Side bug fixed:** the production CSS minifier dropped the unprefixed `backdrop-filter` from `.panel`, so builds had no glass in current Chrome. The gated rule now builds with both forms.

## Stage 5 (2026-11-20, autonomous; owner away 9 h: "make up your own mind and do it. Please refer to the backend in axor.")

**How I read the owner's words.** "Refer to the backend in axor" = use `/home/luca/axor/backend` (Python FastAPI) as a
**read-only pattern source**, not a code base to port or call. The spec names Node + TypeScript + Fastify (§10.2), says to
borrow proven requirements from AXoR rather than import its code (§16), and never to change AXoR assets. If the owner meant
"build it in Python like axor" or "reuse axor's API", the server would need rewriting — that is the main risk of this reading.

**Decisions D1–D6** (plan `docs/plan-2026-11-20_stage5.md`): all taken as recommended.
D1 new PostgreSQL database `axion` (+ `axion_test`, `axion_e2e`, `axion_restore_check`), role `axion`; the other databases on
the server were not touched. D2 code in `/home/luca/AXION/server` and `/home/luca/AXION/shared/contracts`. D3 git baseline
committed, then one commit per task on `main`. D4 one user per browser (HTTP-only cookie). D5 the prototype's missions are
seeded as DEMO rows when the first administrator registers (`npm run demo:clear` removes them). D6 GM → executor → agents
staffing runs on the server as a labelled simulation that sends real events.

**Taken from axor** (file → what I adopted):

| axor | Adopted in AXION |
|---|---|
| `auth.py` PasswordHasher, `_DUMMY` | argon2id hashes; only a sha256 of the session token is stored |
| `auth.py` `new_session`, TTLs | a new token at every sign-in step (waiting → signed in); 30-day absolute + 24-hour idle limit |
| `main.py` CSRF middleware | `X-CSRF` header bound to the session + same-origin `Origin` check on every write |
| `admin.py` | last-administrator guard; admins can't demote/disable themselves; revoke all sessions on disable/reject/password change |
| `missions.py` compare-and-set updates, `company.py` execute gateway | `UPDATE … WHERE status=$old RETURNING` for every mission transition and approval decision |
| `missions.py` `mx_requests` (hash-bound, 72 h expiry) | approvals bound to a sha256 digest of canonical JSON, with expiry and single use |
| `secretbox.fingerprint` / audit rules | the audit log drops every password/token/hash field |
| SSE loops in `main.py`/`workforce.py` | the stream re-checks the session on every wake-up, `X-Accel-Buffering: no` |

Not taken: axor's single-connection SQLite→Postgres shim, ad hoc migrations (AXION has up/down SQL migrations with tests),
and its 12-character password rule (u1 keeps ≥ 4 at sign-up, ≥ 8 for a change).

**What was built** (commits `d3b8606`…, see `git log`):
- **Server** (`server/`, README there): Fastify 5 on 127.0.0.1:5191, error envelope `{code,message,correlationId,retryable}`,
  migrations 0001–0004, sign-in with admin approval of users and devices, missions with the spec §10.6 state machine
  (people can only `start/pause/resume/cancel/retry/archive/restore`), revisions + If-Match, Idempotency-Key, uploads
  (≤ 25 MB, type from the bytes), approvals, notifications with per-user read state, a durable append-only event log and an
  SSE stream with Last-Event-ID replay, the staffing simulation, `GET /operations/health`, backups and a restore check.
  **Execution is disabled**: no task, model, browser or process runs (tested).
- **Web**: `api` data mode by default (`?data=demo` = old prototype). Sign-in, waiting and "Server not reachable" screens;
  missions, approvals and notifications from the server; live updates with a **Live / Reconnecting / Stale** badge in the top
  bar (`?` help); a mission made private while someone has it open moves them off it with a toast; DEMO tags on seeded
  missions; Operations › Services shows the real server's health (admins).

**Deviations from the plan** (all in the ledger with their cost): migration 0003 split into 0003/0004; the demo seed moved to
Task 8 and runs when the first admin registers; `/auth/hello`, `/auth/cancel`, `/people`, `DELETE /me/devices/:id` added;
resume returns to the state the mission was paused from; the sign-in limit is per name (behind the local proxy every client
has the same address); `flows.mjs`/crawls stay demo-mode suites — api mode has its own browser checks.

**Reviews.** Two independent read-only reviews. Every Important item is fixed; most with a test that failed first and then
passed. Exceptions, stated plainly: review-2 C1 (the reconnect storm) has a test that could not run on the old code (the
reviewer reproduced the storm: 7 → 1723 attempts in about 1 s); review-2 I6 and I7 and review-1 M9 were fixed in the client
code without an automated test.
- Review 1 (session axion-53, Tasks 1–4 and 7): 6 Important, 19 Minor. Fixed: the sign-in limit could be bypassed with a forged
  `X-Forwarded-For` or used to lock a user out; password checks ran inside a global lock (anyone could stall sign-in); a
  declined waiting user waited forever; pause → resume skipped a pending approval; idempotency was not atomic with the work;
  the dev server served the whole repo, including database backups. Also fixed: device cookies stored hashed, avatar images
  limited to data URLs, members see only names/avatars of others, members can remove their own devices, a DB outage shows
  "Server not reachable" instead of the sign-in screen.
- Review 2 (fresh reviewer, whole branch): 1 Critical, 7 Important. Fixed: the event listener's reconnect loop multiplied
  itself during a database outage (could exhaust PostgreSQL connections shared with the other apps); a refused action kept its
  optimistic status; If-Match was bumped by system writes (spurious "someone changed it") and the edit dialog didn't send the
  version it opened on (lost update); a decision/cancel race could deadlock; expired approvals stranded missions; a session
  revoked while offline left the tab "stale" forever; re-login in another tab could leave this tab syncing as nobody; a slow
  refresh could re-add a mission that had just become private. Backups are now consistent (dump + row-count manifest from one
  snapshot, uploads archived).
- Deferred minors are listed in the ledger (`docs/stage5-ledger.md`, lines "minor (deferred)"; every decision I made for you is a "Ruling:" line there).

**Evidence (2026-11-20, final run).**
- `cd server && npm test` → **128/128** (migrations up/down/up, append-only audit/events/decisions, sign-in and approvals of
  users/devices, rate limit, CSRF/Origin, state machine (every edge and every illegal pair), visibility matrix, tenants,
  If-Match, idempotency, uploads (0 bytes, 25 MB, wrong content, `../`), event replay/filtering/revocation/ordering,
  approvals digest/expiry/duplicates, notifications, staffing simulation, execution guard, seed, ops health, review fixes).
- `web/scripts/api-e2e.sh` (real server on axion_e2e, two/three browsers) → **api-auth-flow 15/15, api-flows 23/23**;
  in api mode also: the 77-view crawl as administrator and as member (NO PROBLEMS), `fit-check` ALL FIT (both), `ov-fit` NO
  SCROLL, the top bar fits at 390/900/1280 px; `scripts/api-offline.sh` 4/4 (API down → "Server not reachable", the offline
  demo link works, API back → Connect without a reload).
  (live share/pause/approval across users, uploads, un-share moves the other user off the mission, API restart mid-test:
  reconnecting → live, no lost or doubled rows, half-typed draft kept, persistence, rollback of a refused action, revoked
  while offline → Connect).
- `web/scripts/verify-all.sh` (demo mode) → typecheck + build, 77-view crawl, deep crawl (15 missions), flows, u1 flows,
  dialog smoke 104/104, dialog ids, help keys, **dev-server file guard** — all green. `fit-check` ALL FIT, `ov-fit` NO SCROLL.
- Backup + restore check: `npm run db:backup && npm run db:restore-check` → PASS on the real (still empty) database. On the
  populated e2e database: PASS with all 17 tables equal to the backup's manifest (14 missions, 19 events), and still PASS
  after a row was written post-backup.
- README commands run as written against `axion_e2e`: `migrate down 0` / up, `npm run dev`, `demo:clear`, `demo:seed`
  (13 missions, 4 approvals), `admin:approve-device`.
- Screenshots: `docs/screenshots/stage5-{connect,waiting,missions-live,ops-health,users-approvals}-{dark,light}.png`,
  `stage5-offline-dark.png`.

**Things to know.**
- Commit `d4cfd12 "ui"` (22:40) holds most of my Task 8 work but was not made by me: it was an ordinary `git commit` under
  the repo's identity (no git hook does this) — from the editor or another session. I left history as it is.
- The API I started on 127.0.0.1:5191 runs detached and may not outlive my session. To restart it yourself, stop it first
  (`kill $(ss -ltnpH "sport = :5191" | grep -o 'pid=[0-9]*' | cut -d= -f2)`), otherwise `npm run dev` fails with EADDRINUSE.
- Open question: any member who can see a shared mission may decide its approvals (the spec doesn't say). Say if only the
  owner/admins should.
- The seeded DEMO approvals expire after a week (the fixtures said 60–90 minutes, which would have made them vanish soon
  after your first sign-in).

**Still DEMO after Stage 5:** mission conversations and the chat dock (Stage 6), agents, lineage, models and VMs (6/9), Job
Search, News, results/artifacts (8), the Operations tabs other than the AXION server panel, the fixture notices, and the
seeded sample missions (DEMO tag; `npm run demo:clear`).

**Start it:** `cd /home/luca/AXION/server && npm run dev`, then `cd /home/luca/AXION/web && npm run dev`, tunnel
`ssh -L 5190:127.0.0.1:5190 <vps>`, open http://127.0.0.1:5190. **The first name that connects becomes the administrator**
(nobody has connected to the real database yet). Offline prototype: http://127.0.0.1:5190/?data=demo.

**Stage 5 is complete. Do you approve Stage 6?**
