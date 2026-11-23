import { motion } from 'motion/react';
import { Crosshair, Sigma, Activity, Scale, ShieldAlert, ListChecks, BarChart3, BookOpen, Layers, CircleCheck, CircleX, Hourglass, Ban, Clock, CloudOff } from 'lucide-react';
import { CALIBRATION_MIN_N, FORECAST_CLASS_MIN_N, type ForecastDto, type ForecastLedgerDto, type ForecastState } from '@contracts';
import { KpiBoard, type KpiItem } from '@/components/layout/PageFrame';
import { Panel } from '@/components/ui/Panel';
import { Chip } from '@/components/ui/Chips';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { EmptyState } from '@/components/ui/EmptyState';
import { LiveStatus } from '@/components/ui/LiveStatus';
import { useMyForecasts, type LedgerRead } from '@/api/forecasts';
import { isApi } from '@/api/mode';
import { fixed, percent } from '@/lib/plainError';
import { agoFromTs } from '@/lib/format';
import '@/theme/pages/c89-plans-forecasts.css';

const STATE: Record<ForecastState, { label: string; hue: number; icon: typeof Hourglass; hint: string }> = {
  open: { label: 'Open', hue: 225, icon: Hourglass, hint: 'Waiting for the first review' },
  resolved: { label: 'Resolved', hue: 150, icon: CircleCheck, hint: 'Scored' },
  void: { label: 'Void', hue: 38, icon: Ban, hint: 'The task was canceled or its mission archived: not scored' },
  late: { label: 'Late', hue: 38, icon: Clock, hint: 'A review already existed: shown, never scored' },
};

export function kpisOf(l: ForecastLedgerDto): KpiItem[] {
  const n = l.counts.resolved;
  const sk = l.skill;
  return [
    { key: 'count', icon: Crosshair, value: l.counts.total, label: 'Forecasts', color: '#3b82f6', help: 'forecasts.count', hint: <span data-fc-counts>{l.counts.resolved} resolved · {l.counts.open} open · {l.counts.void} void · {l.counts.late} late</span> },
    { key: 'brier', icon: Sigma, value: l.meanBrier ?? 0, decimals: 3, label: 'Mean Brier', color: '#10b981', help: 'forecasts.brier', badge: `n=${n}`, ...(l.meanBrier === null ? { text: 'none resolved yet' } : {}), hint: 'lower is better' },
    { key: 'log', icon: Activity, value: l.meanLogLoss ?? 0, decimals: 3, label: 'Mean log loss', color: '#8b5cf6', help: 'forecasts.log', badge: `n=${n}`, ...(l.meanLogLoss === null ? { text: 'none resolved yet' } : {}), hint: 'lower is better' },
    { key: 'skill', icon: Scale, value: sk.skill ?? 0, decimals: 2, label: 'Skill against the baseline', color: '#f59e0b', help: 'forecasts.skill',
      ...(sk.state === 'ok' && sk.skill !== null ? {} : { text: sk.state === 'ok' ? 'no comparison' : sk.text }), hint: sk.state === 'ok' ? sk.text : `${sk.needed} with a baseline are needed` },
  ];
}

function Calibration({ l }: { l: ForecastLedgerDto }) {
  return (
    <Panel icon={BarChart3} title="Calibration" help="forecasts.calibration" sub="what you said, against what happened" delay={.06} data-fc-calibration>
      <div className="fc-bins">
        {l.calibration.map((b, i) => {
          const lo = Math.round(b.lo * 100), hi = Math.round(b.hi * 100);
          const shown = b.rate !== null && b.meanForecast !== null;
          return (
            <motion.div key={lo} className="fc-bin" data-fc-bin={`${lo}-${hi}`} data-n={b.n} data-rate={shown ? 'shown' : 'hidden'} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .08 + i * .04 }}>
              <span className="row" style={{ gap: 4 }}><b className="tnum">{lo}–{hi}%</b><HelpTrigger k="forecasts.bin" /></span>
              {shown
                ? <div className="bar" role="img" aria-label={`Accepted ${percent(b.rate)} of ${b.n}; you said ${percent(b.meanForecast)} on average`}>
                    <motion.i initial={{ width: 0 }} animate={{ width: `${Math.round(b.rate! * 100)}%` }} transition={{ duration: .8, delay: .15 + i * .05 }} />
                    <span className="fc-mark" style={{ left: `${Math.round(b.meanForecast! * 100)}%` }} />
                  </div>
                : <span className="dim" style={{ fontSize: 12 }}>{b.n === 0 ? 'no forecasts here' : `not enough forecasts to show a rate (${b.n} of ${CALIBRATION_MIN_N})`}</span>}
              <span className="tnum dim" style={{ fontSize: 12 }}>{shown ? `accepted ${percent(b.rate)} · said ${percent(b.meanForecast)} · n=${b.n}` : `n=${b.n}`}</span>
            </motion.div>
          );
        })}
      </div>
      <div className="dim" style={{ fontSize: 11.5, marginTop: 8 }}>The bar is the share accepted; the line is the average you said. A range shows its share from {CALIBRATION_MIN_N} forecasts.</div>
    </Panel>
  );
}

function ByClass({ l }: { l: ForecastLedgerDto }) {
  if (!l.byClass.length) return null;
  return (
    <Panel icon={Layers} title="By task class" help="forecasts.class" delay={.1} data-fc-classes>
      <div className="col" style={{ gap: 5 }}>
        {l.byClass.map((c) => (
          <div key={c.classId} className="row" style={{ gap: 8, fontSize: 12.5 }} data-fc-class={c.classId}>
            <b>{c.label}</b><span className="spacer" />
            <span className="dim tnum">n={c.n}</span>
            <span className="tnum">{c.meanBrier === null ? <span className="dim">Brier needs {FORECAST_CLASS_MIN_N} (n={c.n})</span> : <>Brier {fixed(c.meanBrier)} · log {fixed(c.meanLogLoss)}</>}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Item({ f, i }: { f: ForecastDto; i: number }) {
  const S = STATE[f.state];
  return (
    <motion.div className="fc-item" data-state={f.state} data-fc-item={f.taskId} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 10) * .03 }}>
      <b className="tnum" style={{ minWidth: 40 }}>{percent(f.probability)}</b>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="ellipsis" title={f.taskTitle}>{f.taskTitle}</div>
        <div className="dim" style={{ fontSize: 11.5 }}><span className="mono">{f.taskId}</span> · made {agoFromTs(new Date(f.madeAt).getTime())}</div>
      </div>
      {f.state === 'resolved' && <>
        {f.accepted ? <Chip hue={150} icon={CircleCheck} size="sm">accepted</Chip> : <Chip hue={355} icon={CircleX} size="sm">not accepted</Chip>}
        <span className="tnum" title={`log loss ${fixed(f.logLoss)}`}>Brier {fixed(f.brier)}</span>
      </>}
      <Chip hue={S.hue} icon={S.icon} size="sm" title={S.hint}>{S.label}</Chip>
    </motion.div>
  );
}

/** The forecast record of ONE person: `mine` is the viewer; an administrator opens another person's from Settings › Users. Never a list of people. */
export function ForecastLedgerView({ read, who }: { read: LedgerRead; who?: string }) {
  const l = read.data;
  if (!isApi()) return <EmptyState icon={CloudOff} title="Forecasts are stored on the server" body="In demo mode there is nothing to show. Connect to the AXION server to forecast tasks and see your record." />;
  if (!l) return read.error
    ? <div className="oa-banner" role="alert"><ShieldAlert size={15} /><span>Forecasts were not loaded: {read.error}</span><button className="btn sm" onClick={read.retry}>Retry</button></div>
    : <LiveStatus className="dim" style={{ padding: 20 }}>Reading the forecasts…</LiveStatus>;
  return (
    <div className="col" style={{ gap: 12 }} data-forecasts={l.counts.total}>
      <KpiBoard items={kpisOf(l)} />
      <div className="fc-grid">
        <div className="col" style={{ gap: 12 }}>
          <Calibration l={l} />
          <ByClass l={l} />
          <Panel icon={BookOpen} title="How it is scored" help="forecasts.method" delay={.14} data-fc-method>
            <p className="fc-method" style={{ margin: 0 }}>{l.method}</p>
            <p className="fc-method dim" style={{ margin: '6px 0 0' }}>{l.skill.text}</p>
          </Panel>
        </div>
        <Panel icon={ListChecks} title={who ? `Forecasts of ${who}` : 'Your forecasts'} help="forecasts.list" delay={.08} actions={<Chip hue={225} size="sm">{l.counts.total}</Chip>}>
          {l.forecasts.length === 0
            ? <EmptyState icon={Crosshair} title="No forecasts yet" body="Open a task that has no review yet and record how likely you think it is to be accepted. It is final and scored after the first review." />
            : <div className="fc-list" data-fc-list>{l.forecasts.map((f, i) => <Item key={f.id} f={f} i={i} />)}</div>}
        </Panel>
      </div>
    </div>
  );
}

/** Settings › Forecasts: the viewer's own record. */
export function MyForecasts() {
  const read = useMyForecasts(isApi());
  return <ForecastLedgerView read={read} />;
}
