# AXION — Autonomous AI Company OS (UI prototype)

A React + TypeScript frontend for the Agent Company OS described in
`../update/2026-11-20/AGENT_COMPANY_OS_MASTER_DESIGN_AND_CLAUDE_CODE_PLAN_2026-11-20.md`,
updated by the owner's change list `../update/2026-11-20_u1.md`. The u1 plan and decisions are in `docs/plan-2026-11-20_u1.md`.

- The visual design follows `/home/thomas/subnet-scout/docs/update_2026-11-15/40-4.png`: a dark neon-glass command center.
- It covers spec Stages 1–4 (UI only).
- **All data is deterministic DEMO data, kept in this browser.** No backend, real Playwright browser, model provider or deployment is connected.

## Run

```bash
cd /home/luca/AXION/web
npm install            # already done
npm run dev            # http://127.0.0.1:5190   (bound to localhost only)
npm run build          # typecheck + production bundle in dist/
npm run preview        # serve dist/ at http://127.0.0.1:4190
```

From your workstation, use an SSH tunnel: `ssh -L 5190:127.0.0.1:5190 <vps>`, then open <http://localhost:5190>.
`dist/` is a static SPA. Serve it with any static server that falls back to `index.html`.

### First start: sign-in
Everyone registers with a **name, a password and Connect**. The **first user becomes the administrator** and is connected at once.
Later users and new devices wait until an administrator approves them in **Settings › Users** or **Notifications › Pending**.
The waiting screen then connects automatically, even when the admin approves in another tab.
Each browser tab has its own session, so two tabs can be two different people.
Demo members (Mina Park, Kenji Sato, Sara Lind; password `demo`) are created right after the first account.

## Verify

The scripts drive the running app, so start `npm run dev` first (or set `BASE=http://127.0.0.1:4190` for the preview build).
Every script signs in as the first administrator through `scripts/_session.mjs`. Set `NO_LOGIN=1` to see the Connect screen.

```bash
./scripts/verify-all.sh                          # everything below + typecheck/build
node scripts/crawl.mjs <outDir> dark luminous    # every route × tab (incl. Ops › Agents/Models sub-tabs): console errors, empty check, screenshots
node scripts/crawl-deep.mjs                      # every mission (incl. edge cases) + every agent profile, long dwells on live views
node scripts/flows.mjs                           # mission flows: add, edit, archive, approve, hierarchy, conversation + image, palette, a11y
node scripts/u1-flows.mjs                        # rail, navigation settings, search everything, chat dock, job sites, news, sharing, redirects
node scripts/auth-flow.mjs                       # register → wait → admin approves in another tab → auto-connect; sign out; wrong password
node scripts/dialog-smoke.mjs                    # opens every dialog with/without props → docs/dialog-ledger.txt
node scripts/check-dialogs.mjs                   # every openDialog('id') exists in the runtime registry
node scripts/check-help.mjs                      # every referenced help key exists
node scripts/fit-check.mjs                       # every view fills exactly one screen (desktop)
node scripts/gallery.mjs                         # regenerate docs/screenshots/
node scripts/u1-shots.mjs <outDir> [dark|light]  # screenshots of the u1 screens, incl. interactive states
node scripts/shot.mjs '/missions/M-126?tab=activity' out.png 1672 941 dark luminous
```

Playwright uses the preinstalled Chromium at `/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`.
Override it with `PW_CHROME=...`.
The test hook `window.__axion` is always on in dev. In production builds it is on only when `localStorage['axion.testhook'] = '1'`; the scripts set this.

## What's inside

**Rail.** The top section shows Missions, Notifications and Settings. Overview, Results, System Operations and Help are hidden but reachable
with search, links and URLs, and Settings › Navigation can show them again. The bottom section holds plug-in apps (Job Search).

| Area | Route | Highlights |
| --- | --- | --- |
| **Missions** | `/missions/:id` | Add a mission with **only its content: text + files** (image, audio, video, doc, pdf, txt). The **GM appoints a general executor, who brings the agents** one by one (staffing timeline). Missions belong to their owner: users see their own + shared missions, admins see all; a share toggle sits in the header. Tabs: Overview, **Activity** (every agent's tokens, active time, CPU, RAM, VM, its other missions, and experience merges back into the original agent), Hierarchy, Task Flow, Browser, Conversations, Results, Approvals, Reports, Timeline |
| **Notifications** | `/notifications` | Inbox, **News** (posts from users; URLs and content found by research agents), Pending (incl. new users and devices for admins), Resolved, Rules. Top and bottom boards fold |
| **Settings** | `/settings` | General, **Users** (avatar, name, password change, devices; admins approve users and devices), **Navigation** (show/hide rail items, plug-ins), Appearance, Avatars & Faces, Accessibility, Browser, Integrations, Storage, Security, Backups |
| System Operations | `/operations` | Services, **VMs**, **Agents** (Directory, Development, **Lineage** & knowledge, Live Instances, Departments, Assignments, Policies, Proposals), **Models** (Manager, Providers, Routing with the Model Loader's picks, Playground, Usage, Health), Workers, Queues, Storage, Logs, Recovery |
| Agent profile | `/agents/:id` | Player card, capabilities, tools, instances, **direct chat with individual tasks**, memory, performance, mentoring, evolution, audit |
| **Job Search** (plug-in) | `/plugins/job-search` | Investigate: job sites · live site preview with the investigation process · mobilized agents + chat (instruct, teach, control). Jobs: researched jobs, bid status, the profile tailored for each bid. Profile: documents + free text |
| Overview, Results, Help | `/overview`, `/results`, `/help` | Hidden from the rail by default |

Removed by the u1 update: Usage & Budgets, Knowledge, Governance, Evolution Lab, Browser Studio, the Users page, and every budget, cost, price or fund limit.
Old links redirect.

Global features:

- `Ctrl K` **searches everything**: commands, every screen, tab and sub-tab, missions (by content), agents (by duty), chats, models, VMs, users, job sites and jobs, news, notifications, lessons and help.
- The **chat** button left of your avatar is one inbox: the General Manager, the administrators, direct agent chats and plug-in agents. Every chat in the app uses the same component.
- `Ctrl B` collapses the rail; `?` opens the shortcuts. A `?` help popover is on panels and fields.
- A responsive layout from 1672px down to 390px, 4 skins × light/dark, reduced-motion support.
- DEMO data persists in this browser. Reset it with "Reset DEMO data" in the command palette.

## Code map

```text
src/
  config/      brand.ts, nav.ts (rail items + tabs), plugins.ts (plug-in registry)
  theme/       tokens.css (4 skins × light/dark), base.css, shell.css, frame.css, pages/*.css
  components/  ui/ (Panel, Tabs, IconButton, HelpTrigger, Modal, Chips, Form, Menu, Toasts, UserAvatar…)
               art/, viz/, layout/ (AppShell, Rail, TopBar, PageFrame, CommandPalette, usePreferences)
  features/    auth/ (AuthGate), chat/ (ChatView, ChannelChat, ChatDock), mission/ (staffing, ActivityTab, StaffingCard, Messenger…),
               agents/ (Lineage, AgentHierarchy…), ops/ (VMs), notifications/ (News), settings/ (Users, Navigation)
  pages/       one file per route; plugins/JobSearch.tsx; Agents.tsx and Models.tsx are sections embedded in Operations
  dialogs/     DialogHost + defs/*.tsx (mission-add.tsx is the content-only Add mission)
  data/        deterministic fixtures (seeded PRNG): agents (+ derived agents), activity, lineage, missions, models…
  store/       zustand: settings, ui, data (missions, v2 migration), auth (users/devices/session), chat, news, jobs
  help/        registry.ts + pages/*.ts (u1-shell.ts, u1-missions.ts for the u1 additions)
```

See `KIT.md` for the component API and `PROGRESS.md` for decisions and stage reports.
