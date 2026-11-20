# AXION Web — Build Log & Decisions

Autonomous build session started 2026-11-20. The owner was away for ~8h and said: "make your own decision".

## Authority / scope decisions
- The master spec (ACO-MASTER-001) says "design only; Stage 0 first; stop after each stage".
  The owner's direct instruction overrides that **only for building the frontend UI prototype unattended**
  (≈ spec Stages 1–4: shell, design system, all routes/tabs, dialogs, using clearly-marked DEMO fixtures).
- OUT of scope (not started): backend/API, DB, auth, real Playwright browser sessions, systemd, deployment.
- `/home/thomas/subnet-scout` was read-only. `update/2026-11-20/` was not modified.
- New project: `/home/luca/AXION/web` (no git; nothing committed).

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
| Versions unpinned | React 19.3, Vite 8.3, TypeScript 7.0 (native), motion 14, react-router 7.18, zustand 5, lucide 1.76. Exact versions are locked in `package-lock.json`; there is no git repo yet. | — |

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
