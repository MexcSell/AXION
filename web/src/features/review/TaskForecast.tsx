import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Crosshair, Lock, Loader2, ShieldAlert, CircleCheck, CircleX, Hourglass, Ban, Clock } from 'lucide-react';
import type { ForecastDto } from '@contracts';
import { Chip } from '@/components/ui/Chips';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { LiveStatus } from '@/components/ui/LiveStatus';
import { useMyForecasts, recordForecast, newKey } from '@/api/forecasts';
import type { ReviewsRead } from '@/api/taskReviews';
import { toast } from '@/store/ui';
import { fixed, percent } from '@/lib/plainError';
import '@/theme/pages/c89-plans-forecasts.css';

/** "Your forecast" in the task drawer (api mode). Before the task's first review: one control, one forecast, final. After it: the forecast, the outcome and the Brier for this task. Only the viewer's own forecast is ever read. */
export function TaskForecast({ taskId, rv, canceled }: { taskId: string; rv: ReviewsRead; canceled?: boolean }) {
  const led = useMyForecasts();
  const [pct, setPct] = useState(70);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const key = useRef(newKey());
  const mine: ForecastDto | undefined = led.data?.forecasts.find((f) => f.taskId === taskId);
  const reviewed = !!rv.data && rv.data.reviews.length > 0;
  const head = <div className="row" style={{ gap: 6 }}><div className="section-label" style={{ margin: 0 }}>Your forecast</div><HelpTrigger k="forecast.control" /></div>;

  if (!led.data && !led.error) return <div data-forecast="loading">{head}<LiveStatus className="dim" style={{ fontSize: 12.5 }}>Reading your forecasts…</LiveStatus></div>;
  if (!led.data) return <div data-forecast="error">{head}<div className="oa-banner" role="alert"><ShieldAlert size={15} /><span>Your forecasts were not loaded: {led.error}</span><button className="btn sm" onClick={led.retry}>Retry</button></div></div>;

  if (mine) {
    const st = mine.state;
    return (
      <div data-forecast={st}>
        {head}
        <motion.div className="fc-box" data-forecast-state={st} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <Lock size={13} aria-hidden />
            <span>You forecast <b data-forecast-pct={Math.round(mine.probability * 100)}>{percent(mine.probability)}</b> that the first review accepts this task.</span>
            <HelpTrigger k="forecast.final" />
          </div>
          {st === 'open' && <div className="row dim" style={{ gap: 6, fontSize: 12 }}><Hourglass size={12} aria-hidden />Waiting for the first review. It is scored then; the forecast cannot be changed.</div>}
          {st === 'void' && <div className="row dim" style={{ gap: 6, fontSize: 12 }}><Ban size={12} aria-hidden />This task was canceled or its mission archived before a review, so the forecast will not be scored unless a review is recorded.</div>}
          {st === 'late' && <div className="row dim" style={{ gap: 6, fontSize: 12 }}><Clock size={12} aria-hidden />A review exists that is not later than this forecast, so it is shown and never scored.</div>}
          {st === 'resolved' && (
            <div className="row wrap" style={{ gap: 8 }} data-forecast-result>
              {mine.accepted ? <Chip hue={150} icon={CircleCheck} size="sm">First review: accepted</Chip> : <Chip hue={355} icon={CircleX} size="sm">First review: not accepted</Chip>}
              <span>Brier <b className="tnum" data-forecast-brier={fixed(mine.brier)}>{fixed(mine.brier)}</b></span>
              <span className="dim">log loss <span className="tnum">{fixed(mine.logLoss)}</span></span>
              <HelpTrigger k="forecast.result" />
              <span className="dim" style={{ fontSize: 11.5 }}>lower is better · one task, so it says little alone</span>
            </div>
          )}
        </motion.div>
      </div>
    );
  }
  if (reviewed) return <div data-forecast="closed">{head}<span className="dim" style={{ fontSize: 12.5 }}>You made no forecast before the first review, so there is nothing to score. A forecast can only be made before it.</span></div>;
  if (canceled) return <div data-forecast="closed">{head}<span className="dim" style={{ fontSize: 12.5 }}>This task was canceled, so it takes no new forecast.</span></div>;
  if (!rv.data) return <div data-forecast="wait">{head}<LiveStatus className="dim" style={{ fontSize: 12.5 }}>Reading the reviews…</LiveStatus></div>;

  const submit = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    const r = await recordForecast(taskId, pct, key.current);
    setBusy(false);
    if (!r.ok) { setErr(r.message); key.current = newKey(); return; }
    toast({ tone: 'success', title: `Forecast recorded: ${pct}%`, body: 'It is final. It is scored when the first review is in.' });
  };
  const set = (v: number) => { setErr(null); setPct(Math.min(99, Math.max(1, Math.round(Number.isFinite(v) ? v : 70)))); };
  return (
    <div data-forecast="form">
      {head}
      <div className="fc-box" data-forecast-state="new">
        <span style={{ fontSize: 12.5 }}>How likely is it that the first review of this task is <b>accepted</b>?</span>
        <div className="fc-slider">
          <Crosshair size={15} aria-hidden />
          <input type="range" min={1} max={99} step={1} value={pct} aria-label="Chance of acceptance, percent" data-forecast-range onChange={(e) => set(Number(e.target.value))} />
          <input className="input fc-num tnum" type="number" min={1} max={99} step={1} value={pct} aria-label="Chance of acceptance, whole percent" data-forecast-input onChange={(e) => set(Number(e.target.value))} />
          <span className="dim">%</span>
          <HelpTrigger k="forecast.percent" />
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="dim row" style={{ gap: 5, fontSize: 12 }} data-forecast-final-note><Lock size={12} aria-hidden />One forecast per task. Once recorded it cannot be edited or repeated.</span>
          <span className="spacer" />
          <button className="btn sm primary" disabled={busy} onClick={submit} data-forecast-submit>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={busy ? 'b' : 'i'} initial={{ scale: .6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: .6, opacity: 0 }} transition={{ duration: .12 }} style={{ display: 'inline-flex' }}>
                {busy ? <Loader2 size={13} className="spin" /> : <Crosshair size={13} />}
              </motion.span>
            </AnimatePresence>
            Record forecast, {pct}%
          </button>
        </div>
        {err && <div className="oa-banner" role="alert" data-forecast-error><ShieldAlert size={15} /><span>{err}</span></div>}
      </div>
    </div>
  );
}
