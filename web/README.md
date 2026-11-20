# AXION — Autonomous AI Company OS (UI prototype)

A React + TypeScript frontend for the Agent Company OS described in
`../update/2026-11-20/AGENT_COMPANY_OS_MASTER_DESIGN_AND_CLAUDE_CODE_PLAN_2026-11-20.md`.

- The visual design follows `/home/thomas/subnet-scout/docs/update_2026-11-15/40-4.png`: a dark neon-glass command center.
- It covers spec Stages 1–4 (UI only).
- **All data is deterministic DEMO data.** No backend, real Playwright browser, model provider or deployment is connected.

## Run

```bash
cd /home/luca/AXION/web
npm install            # already done
npm run dev            # http://127.0.0.1:5190   (bound to localhost only)
npm run build          # typecheck + production bundle in dist/
npm run preview        # serve dist/ at http://127.0.0.1:4190
```

From your workstation, use an SSH tunnel: `ssh -L 5190:127.0.0.1:5190 <vps>`, then open http://localhost:5190.
`dist/` is a static SPA. Serve it with any static server that falls back to `index.html`.

## Verify

The scripts drive the running app, so start `npm run dev` first (or set `BASE=http://127.0.0.1:4190` for the preview build).

```bash
./scripts/verify-all.sh                          # everything below + typecheck/build
node scripts/crawl.mjs <outDir> dark luminous    # every route × tab: console errors, empty/placeholder check, screenshots
node scripts/crawl-deep.mjs                      # every mission's Mission Control + all 38 agent profiles, long dwells, edge-case missions
node scripts/flows.mjs                           # 12 end-to-end owner flows (create/edit/archive mission, chat + image, approvals, a11y…)
node scripts/dialog-smoke.mjs                    # opens all 66 dialogs with/without props → docs/dialog-ledger.txt
node scripts/check-dialogs.mjs                   # every openDialog('id') exists in the runtime registry
node scripts/check-help.mjs                      # every referenced help key exists
node scripts/gallery.mjs                         # regenerate docs/screenshots/
node scripts/shot.mjs '/control/M-126?tab=hierarchy' out.png 1672 941 dark luminous
```

Playwright uses the preinstalled Chromium at `/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`.
Override it with `PW_CHROME=...`.
The test hook `window.__axion` is always on in dev. In production builds it is on only when `localStorage['axion.testhook'] = '1'`; the scripts set this.

## What's inside

| Area | Route | Highlights |
|---|---|---|
| Overview | `/overview` | Command-center KPIs and health ring. Tabs: pulse, portfolio, live activity, health |
| **Missions** | `/missions` | **List on the left and progress on the right.** Each row has ✎ edit beside the title, 🗑 at the far right, the status under the name and an AI summary. 4-step create wizard with image/file attach, revisions, archive/purge |
| **Mission Control** | `/control/:id` | 9 tabs. Animated hierarchy graph with directional arrows (delegated ↓, reports ↑, consults, verifies, mentors). **Click an agent to see its partners (superior, subordinates, peers, you), then the messenger thread.** Command/Reply composer accepts images by paste, drop or file. The agent acknowledges, then reports upward. Also: task DAG, managed-browser view with approval gate, versioned results with per-version download, approvals, reports, immutable timeline |
| Agents | `/agents`, `/agents/:id` | The 40-4 page: agent cards, organization, lifecycle, top performers, evolution pipeline. Profile: player card, capability radar, tools, instances, memory, mentoring, audit |
| Organization | `/organization` | Org chart (tree/graph/matrix). Drag to *propose* a reorg and see a before/after diff. Departments, assignments heatmap, policies, proposals |
| Browser Studio | `/browser` | Sessions, live view (redacted), action timeline, site grants, recipes, replay |
| Results & Versions | `/results` | Library, sandbox previews, branch graph, diff, downloads (real manifest + SHA-256), releases |
| Knowledge | `/knowledge` | Library, research, sources, citations, learning queue |
| Evolution Lab | `/evolution` | L0–L4 ladder, proposals, experiments, benchmarks, promotions (independent review), lineage history |
| Models | `/models` | Catalog (LLM/vision/STT/TTS/…), providers (secrets never shown), routing, playground, voice pipeline |
| Users / Governance | `/users`, `/governance` | Members, roles matrix, invitations, sessions. Cross-mission approvals, autonomy, policies, secrets, audit |
| Usage, Notifications, Settings, Operations, Help | … | Budgets and forecast. Inbox. **Appearance (Light/Dark/System × Luminous/Flat/Pretty/Fancy) and Avatars & Faces editor.** systemd services (no Docker). Context help index |

Global features:
- `Ctrl K` command palette, which deep-links every screen and tab.
- `Ctrl B` collapses the rail; `?` opens the shortcuts.
- A `?` help popover on panels and fields. 306 help entries.
- Toasts, an error boundary, and reduced-motion support.
- A responsive layout from 1672px down to 390px.
- DEMO data persists in this browser. Reset it with "Reset DEMO data" in the command palette.

## Code map

```
src/
  config/      brand.ts (product name AXION in one place), nav.ts (routes + tabs)
  theme/       tokens.css (4 skins × light/dark), base.css, shell.css, pages.css, pages/*.css
  components/  ui/ (Panel, Tabs, IconButton, HelpTrigger, Modal, Chips, Form, Menu, Toasts…)
               art/ (RobotAvatar, CoreCube, HeroScene, ParticleField), viz/ (charts), layout/ (shell)
  features/mission/   HierarchyGraph, Messenger, TaskFlow, BrowserMini, live event bus
  pages/       one file per route
  dialogs/     DialogHost + defs/*.tsx (66 dialogs; spec DL ids on data-dialog — 63 of DL-01…65 are dialogs, DL-63 palette is in layout/, DL-17/18 share one component)
  data/        deterministic fixtures (seeded PRNG)
  store/       zustand: settings (persisted), ui (dialogs/toasts), data (DEMO state, persisted)
  help/        registry.ts + pages/*.ts
```

See `KIT.md` for the component API and `PROGRESS.md` for decisions and the stage report.
