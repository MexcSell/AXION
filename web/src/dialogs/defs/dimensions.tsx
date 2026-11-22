import { useState } from 'react';
import { motion } from 'motion/react';
import { Layers, Brain, Wrench, Globe2, Users, BookOpen, Dna, ArrowUp, ArrowDown, ArrowRight, EyeOff, Hourglass, type LucideIcon } from 'lucide-react';
import { DIMENSION_KEYS, type DimensionCell, type DimensionKey, type DimensionWindow } from '@contracts';
import { Modal } from '@/components/ui/Modal';
import { Segmented } from '@/components/ui/Form';
import { DemoTag } from '@/components/ui/Chips';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Tip } from '@/components/ui/Tip';
import { LiveStatus } from '@/components/ui/LiveStatus';
import { isApi } from '@/api/mode';
import { useDimensions } from '@/api/dimensions';
import { demoDimensions } from '@/data/dimensionsDemo';
import { cx } from '@/lib/format';
import type { DialogComponentProps } from '@/dialogs/DialogHost';
import '@/theme/pages/c46-dimensions.css';

/* DL-98: Six dimensions (improvement cycle 46). Spec §16.1: company and department levels with sample sizes, evidence and
   trend, never one number. Every cell is value + n + window, or "not enough evidence (n = k)". Nothing here adds cells up. */
const ICON: Record<DimensionKey, LucideIcon> = { cognitive: Brain, capability: Wrench, environmental: Globe2, collective: Users, knowledge: BookOpen, evolutionary: Dna };
const WIN: Record<DimensionWindow, string> = { '7d': 'last 7 days', '30d': 'last 30 days', '90d': 'last 90 days' };
const TREND = { up: ArrowUp, down: ArrowDown, flat: ArrowRight } as const;

export function fmtCell(c: Pick<DimensionCell, 'value' | 'unit'>): string {
  if (c.value === null) return '—';
  if (c.unit === '%') return `${Number.isInteger(c.value) ? c.value : c.value.toFixed(1)}%`;
  if (c.unit === 'h') return `${c.value < 10 ? c.value.toFixed(1) : Math.round(c.value)} h`;
  return String(c.value);
}
const windowText = (c: DimensionCell, w: DimensionWindow) => (c.basis === 'none' ? 'not measured' : c.basis === 'snapshot' ? 'as of now' : w);
/** Below this n a value is drawn small and plain: it is a handful of rows, not a grade. */
export const LOW_N = 10;
export const scopeText = (c: Pick<DimensionCell, 'scope'>, demo: boolean) => demo ? 'SAMPLE data: invented, nothing here was measured'
  : c.scope === 'missions' ? 'missions you can see · simulated and DEMO rows are never counted'
    : 'recorded company-wide, not limited to missions · these records carry no simulated or DEMO flag';
const faceText = (c: DimensionCell) => c.state === 'none' ? `not enough evidence (n = ${c.n})` : c.state === 'hidden' ? 'hidden for your role' : c.evidence;

function Cell({ c, w, i, selected, onSelect }: { c: DimensionCell; w: DimensionWindow; i: number; selected: boolean; onSelect: () => void }) {
  const T = c.trend ? TREND[c.trend] : null;
  const prev = c.previous.value !== null ? fmtCell({ value: c.previous.value, unit: c.unit }) : '';
  const face = c.state === 'ok' ? null : faceText(c);
  const aria = c.state === 'ok' ? `${c.label}: ${fmtCell(c)}, n = ${c.n}, ${windowText(c, w)}` : `${c.label}: ${face}`;
  const Mark = c.state === 'hidden' ? EyeOff : c.state === 'unmeasured' ? Hourglass : null;
  return (
    <Tip label={c.evidence}>
      <motion.div className={cx('dim-cell', c.state !== 'ok' && 'none', `st-${c.state}`, selected && 'sel', c.state === 'ok' && (c.n ?? 0) < LOW_N && 'low')} tabIndex={0} role="button" aria-pressed={selected} aria-label={aria}
        onClick={onSelect} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
        data-cell={c.key} data-state={c.state} data-value={c.value ?? ''} data-n={c.n ?? ''} data-trend={c.trend ?? ''} data-scope={c.scope}
        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .05 + i * .03 }}>
        <span className="dim-cl">{c.label}</span>
        {c.state === 'ok'
          ? <span className="dim-cv"><b className="tnum">{fmtCell(c)}</b><span className="dim-nn tnum">n = {c.n}</span>{T && <small className="dim-tr" title={`previous window: ${prev} (n = ${c.previous.n})`}><T size={12} aria-hidden />{prev}</small>}</span>
          : <span className="dim-cv">{Mark && <Mark size={13} aria-hidden />}{face}</span>}
        <span className="dim-cm tnum">{c.state === 'ok' ? `${windowText(c, w)} · ${c.scope === 'missions' ? 'missions' : 'company'}` : c.state === 'none' ? `${windowText(c, w)} · ${c.scope === 'missions' ? 'missions' : 'company'}` : c.state === 'hidden' ? 'administrators only' : 'no source yet'}</span>
      </motion.div>
    </Tip>
  );
}

function SixDimensions({ close }: DialogComponentProps) {
  const api_ = isApi();
  const [w, setW] = useState<DimensionWindow>('30d');
  const [dept, setDept] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const live = useDimensions(w, dept);
  const demoData = !api_ ? demoDimensions(w, dept) : null;
  const shown = api_ ? (live.data && live.data.window === w && live.data.department === dept ? live.data : null) : demoData;
  const departments = shown?.departments ?? [];
  return (
    <Modal title="Six dimensions" icon={Layers} help="dimensions.panel" dialogId="DL-98" size="xl" onClose={close}
      sub="Cognitive, Capability, Environmental, Collective, Knowledge, Evolutionary. Each cell stands alone: value, sample size, window. There is no total.">
      <div data-dimensions={shown ? 'ready' : live.error ? 'error' : 'loading'} data-window={w} data-department={dept ?? ''}>
        <div className="dim-bar">
          <span className="dim-ctl">
            <select className="select" aria-label="Department" value={dept ?? ''} onChange={(e) => setDept(e.target.value || null)}>
              <option value="">Whole company</option>
              {departments.map((d) => <option key={d} value={d}>{d}</option>)}
              {dept && !departments.includes(dept) && <option value={dept}>{dept}</option>}
            </select>
            <HelpTrigger k="dimensions.department" />
          </span>
          <span className="dim-ctl">
            <Segmented size="sm" ariaLabel="Window" value={w} onChange={setW} options={(['7d', '30d', '90d'] as const).map((k) => ({ key: k, label: k, title: WIN[k] }))} />
            <HelpTrigger k="dimensions.window" />
          </span>
          <span className="spacer" />
          {!api_ && <DemoTag title="SAMPLE cells: invented numbers that only show the layout. Switch to the server version for measured ones." />}
          <span className="dim-ctl dim" style={{ fontSize: 12 }}>reading a cell <HelpTrigger k="dimensions.cell" /></span>
        </div>
        {!shown ? (live.error ? <LiveStatus kind="error" className="dim">{live.error}</LiveStatus> : <LiveStatus className="dim">Reading the six dimensions…</LiveStatus>) : (
          <div className="dim-rows" role="list" aria-label="Six dimensions">
            {DIMENSION_KEYS.map((k, ri) => {
              const row = shown.dimensions.find((d) => d.key === k);
              const Icon = ICON[k];
              return (
                <motion.section key={k} className="dim-row" role="listitem" data-dimension={k} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: ri * .05 }}>
                  <div className="dim-name"><Icon size={17} className="dim-ico" aria-hidden />{row?.label ?? k}<HelpTrigger k={`dimensions.${k}`} /></div>
                  <div className="dim-cells">{(row?.cells ?? []).map((c, i) => <Cell key={c.key} c={c} w={w} i={i} selected={sel === c.key} onSelect={() => setSel((k) => (k === c.key ? null : c.key))} />)}</div>
                </motion.section>
              );
            })}
          </div>
        )}
        {(() => { const c = shown?.dimensions.flatMap((d) => d.cells).find((x) => x.key === sel);
          return <div className="dim dim-note" data-evidence={c ? c.key : ''} aria-live="polite">{c
            ? <><b>{c.label}</b>: {c.evidence}. <span className="dim">{c.basis === 'none' ? 'No window' : `${WIN[w]}, ${new Date(c.from ?? shown!.from).toLocaleDateString()} to ${new Date(c.to ?? shown!.to).toLocaleDateString()}`} · {scopeText(c, !api_)}.</span></>
            : shown ? `Tap or press a cell to read how it was counted. ${shown.department ?? 'Whole company'} · ${new Date(shown.from).toLocaleDateString()} to ${new Date(shown.to).toLocaleDateString()}.` : ' '}</div>; })()}
      </div>
    </Modal>
  );
}

export const dialogs = { 'six-dimensions': SixDimensions };
