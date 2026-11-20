# AXION UI kit — quick reference for page authors

Visual target: `/home/thomas/subnet-scout/docs/update_2026-11-15/40-4.png`. A dark neon-glass command center.
Sibling screens in the same style are `40-1.png` … `40-14.png` in the same folder. Look at them for page ideas.
`src/pages/Agents.tsx` is the gold-standard page. Copy its patterns.

## Rules
- **Files you may create or edit:** only your own pages, `src/data/<area>.ts`, `src/help/pages/<area>.ts`,
  `src/dialogs/defs/<area>.tsx` and `src/theme/pages/<area>.css`. Import that CSS file from your page or dialog file.
- **Do NOT edit shared files:** `components/**`, `theme/*.css`, `store/*`, existing `data/*.ts`, `App.tsx`, `config/*`.
  If you need a kit change, describe it in your final report.
- **Data:** everything is DEMO fixture data (deterministic: use `seeded()` from `@/data/agents`, never `Math.random`
  at module level). Show `<DemoTag />` where a panel shows fabricated live data.
- **No dead controls:** every button navigates, opens a dialog, changes local state, or shows a `toast()` explaining
  the DEMO behavior. Icon-only buttons use `<IconButton icon label>` (label = tooltip + aria-label).
- **Help:** every panel title, KPI and specialised field has a `?`. Use `help="key"` on Panel, `<HelpTrigger k="key"/>`,
  or `<Field help="key">`. Define keys in `src/help/pages/<area>.ts` as `export default { 'area.key': { title, what, why?, how?, example?, permission? } }`.
- **Every tab needs real, distinct content.** Also design the empty, loading and permission-denied states where they make sense.
- **Animation everywhere, but tasteful:** motion entrance (`initial/animate`), hover lift (`glass-card hoverable`),
  animated bars/rings, AnimatePresence on tab and list changes. Respect `var(--motion-scale)` in CSS transforms.
- **Theme-safe colors only:** use CSS vars (`--text`, `--text-2`, `--text-muted`, `--text-dim`, `--panel`, `--panel-2`,
  `--panel-3`, `--border`, `--border-soft`, `--border-strong`, `--accent`, `--accent-2`, `--good`, `--warn`, `--bad`,
  `--info`, `--violet`, `--gold` and their `-rgb` forms). Hue-based chips: `<Chip hue={145}>`. Never hardcode white text
  on panels, because light mode must work.
- **No Bittensor, wallet, token, Docker or Finance-department features** (spec §0.3).

## Imports
```ts
import { Panel, PageHeader } from '@/components/ui/Panel';      // <Panel icon title sub help actions delay tight flush titleSize="lg">
import { Tabs, TabPanel } from '@/components/ui/Tabs';          // <Tabs tabs={[{key,label,icon,count}]} value onChange variant="pill|underline" size="sm" ariaLabel/>
import { useTab } from '@/hooks/useTab';                        // const [tab, setTab, tabs] = useTab('models')  (labels from config/nav ROUTE_TABS, URL ?tab=)
import { IconButton } from '@/components/ui/IconButton';        // <IconButton icon={Plus} label="Add" size="sm|xs" variant="bordered|active|danger" badge={3}/>
import { HelpTrigger } from '@/components/ui/HelpTrigger';      // <HelpTrigger k="models.route"/>
import { Tip } from '@/components/ui/Tip';                      // <Tip label="..."><button/></Tip>
import { Chip, RoleChip, AgentStatusChip, MissionStatusChip, InstanceStateChip, TaskStateChip, DemoTag, Dot } from '@/components/ui/Chips';
import { Field, Switch, SwitchRow, Segmented } from '@/components/ui/Form';
import { Menu } from '@/components/ui/Menu';                    // <Menu trigger={<button/>} items={[{label, icon, onSelect, danger, sep}]}/>
import { Modal } from '@/components/ui/Modal';                  // <Modal title icon help sub size="sm|md|lg|xl" tone="danger|warn" onClose footer dialogId="DL-41" drawer>
import { CountUp } from '@/components/ui/CountUp';
import { EmptyState } from '@/components/ui/EmptyState';
import { RingGauge, Donut, Legend, Sparkline, AreaChart, ColumnBars, MeterRow, Radar } from '@/components/viz/Charts';
import { RobotAvatar } from '@/components/art/RobotAvatar';     // <RobotAvatar role="dev" size={48} faceMode="face|emblem" animated status="good"/>
import { CoreCube, LogoGlyph } from '@/components/art/CoreArt';
import { AgentCard } from '@/components/agents/AgentCard';
import { CommandCenter } from '@/components/layout/CommandCenter'; // KPI header + Company Health (used on Agents)
import { AGENTS, AGENT_BY_ID, seeded } from '@/data/agents';
import { ROLES, AGENT_STATUS, MISSION_STATUS } from '@/data/roles';
import { MISSIONS, getMissionControl } from '@/data/missions';   // per-mission nodes/edges/threads/tasks/artifacts/approvals/timeline
import { useData, allApprovals } from '@/store/data';          // live demo state: missions, approvalDecisions, decideApproval(), ...
import { useSettings } from '@/store/settings';                // theme/skin/motion/density/avatar prefs + set()/setAvatar()
import { toast, openDialog } from '@/store/ui';                 // toast({tone:'success|info|warning|error', title, body}); openDialog('id', props)
import { ago, clock, money, cx } from '@/lib/format';
```

## CSS classes (theme/base.css, shell.css)
`panel`, `subpanel`, `glass-card hoverable selected`, `grid g-2..g-6`, `row`, `row-3`, `col`, `spacer`, `grow`, `wrap`,
`btn` (`primary`, `danger`, `good`, `ghost`, `sm`, `lg`, `block`), `icon-btn`, `chip`, `badge`, `kbd`, `input`, `select`,
`textarea`, `input-wrap` (with a leading icon), `table-wrap` + `table`, `list-row`, `kv` (dl/dt/dd), `divider`,
`section-label`, `bar` (+`good|warn|bad`, `thin|thick`) with `<i style={{width}}>`, `skeleton`, `kpi` (with
`--kc` colour, `kpi-ico`, `kpi-val`, `kpi-label`, `kpi-delta`), `muted`, `dim`, `good`, `warn`, `bad`, `info`, `violet`,
`mono`, `display`, `ellipsis`, `clamp-2`, `tnum`, `page`, `page-header`.

## Dialogs
Create `src/dialogs/defs/<area>.tsx`:
```tsx
import type { DialogComponentProps } from '@/dialogs/DialogHost';
function AddModel({ close, props }: DialogComponentProps<{ preset?: string }>) {
  return <Modal title="Add model" icon={Plug} help="models.add" dialogId="DL-41" onClose={close}
    footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" onClick={() => { toast({ tone: 'success', title: 'Validated (demo)' }); close(); }}>Validate connection</button></>}>
    ...form...
  </Modal>;
}
export const dialogs = { 'model-add': AddModel };
```
Open it with `openDialog('model-add', { preset: 'x' })`. Each dialog needs a title, a `?`, initial focus
(`data-autofocus`), cancel, validation and a success toast. Destructive dialogs default to Cancel and name the exact object.

## Verify your work
- Type check only your files: `cd /home/luca/AXION/web && npx tsc --noEmit -p . 2>&1 | grep -E "src/(pages/YourPage|data/your|dialogs/defs/your|help/pages/your)"`.
  Other agents edit in parallel, so ignore their errors.
- Screenshot (the dev server is already running on 127.0.0.1:5190 with HMR; do NOT start another one):
  `node scripts/shot.mjs '/models?tab=routing' /tmp/claude-0/-home-luca-AXION/a648e987-ffdb-49cc-888b-0956d510792d/scratchpad/<name>.png 1672 941 dark luminous`
  (arguments: path, out, width, height, theme dark|light, skin luminous|flat|pretty|fancy). Console errors are printed.
  Look at every tab in dark, and at least one tab in light, and fix what looks wrong.
