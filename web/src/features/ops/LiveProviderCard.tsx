import { useEffect, useState } from 'react';
import { AlertTriangle, Cloud, Power, RefreshCcw, Trash2 } from 'lucide-react';
import type { CloudModelAction, CloudModelStatusDto } from '@contracts';
import { Chip } from '@/components/ui/Chips';
import { providerError } from '@/api/cloudModel';

const resetFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
function untilReset(at: string, now: number) {
  const min = Math.ceil((Date.parse(at) - now) / 60_000);
  if (min <= 0) return 'reset time passed';
  const hours = Math.floor(min / 60);
  return hours ? `in ${hours} h ${min % 60} min` : `in ${min} min`;
}

interface Props {
  model: CloudModelStatusDto;
  admin: boolean;
  maxInFlight: number;
  manage: (id: string, action: CloudModelAction) => Promise<void>;
}

export function LiveProviderCard({ model, admin, maxInFlight, manage }: Props) {
  const [busy, setBusy] = useState<CloudModelAction | null>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [now, setNow] = useState(Date.now);
  const { check, lastCall } = model;
  useEffect(() => {
    if (!check?.resetsAt && !check?.windows.length) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [check]);

  async function act(action: CloudModelAction) {
    setError(''); setBusy(action);
    try { await manage(model.id, action); setConfirm(false); }
    catch (e) { setError(providerError(e)); }
    finally { setBusy(null); }
  }

  const quotaResetPassed = check?.status === 'limited' && check.resetsAt && Date.parse(check.resetsAt) <= now;
  const quotaStillApplies = check?.status === 'limited' && !quotaResetPassed && !lastCall?.ok;
  const latestCheck = lastCall && check && lastCall.at > check.checkedAt && !quotaStillApplies ? null : check;
  let status = lastCall ? (lastCall.ok ? 'available' : 'unavailable') : 'unchecked';
  if (latestCheck) status = latestCheck.status === 'available' ? 'available' : 'unavailable';
  if (latestCheck && quotaResetPassed) status = 'unchecked';
  if (!model.enabled) status = 'disabled';
  const hue = status === 'available' ? 150 : status === 'unavailable' ? 40 : 215;
  return (
    <section className="subpanel glass-card provider-card" data-testid="live-cloud-model" data-model-id={model.id} aria-label={model.label}>
      <div className="row" style={{ gap: 10 }}>
        <span className="emu-model-ico" style={{ ['--h' as string]: hue }}><Cloud size={20} /></span>
        <div><b>{model.label}</b><div className="mono dim">{model.model} · Claude Code CLI</div></div>
        <span className="spacer" /><Chip hue={200} size="sm">live</Chip>
      </div>
      <dl className="provider-details">
        <dt>Status</dt><dd><Chip hue={hue} size="sm">{status}</Chip>{model.enabled && latestCheck?.status === 'limited' && !quotaResetPassed && <span>Usage limit reached{latestCheck.resetsAt && <> · resets <time dateTime={latestCheck.resetsAt}>{latestCheck.resetsAt.slice(0, 16).replace('T', ' ')} UTC</time></>}</span>}
          {model.enabled && latestCheck && quotaResetPassed && 'Reset time passed. Refresh to check availability.'}
          {model.enabled && latestCheck?.status === 'timeout' && 'Connection test timed out'}</dd>
        {admin && <><dt>Account</dt><dd>{check?.account ?? (check ? 'Not reported' : 'Refresh to check')}</dd></>}
        <dt>Credential</dt><dd className="mono">{model.tokenVar} · server only</dd>
      </dl>
      <div className="provider-usage">
        <b>Usage</b>
        {check?.windows.length ? check.windows.map(w => (
          <div key={w.label} className="provider-window">
            <div className="row wrap"><span>{w.label}</span><span className={'tnum' + (w.percent >= 100 ? ' warn' : '')}>{w.percent}% used{w.percent >= 100 && ' · at the limit'}</span></div>
            <progress aria-label={w.label} max={100} value={Math.min(w.percent, 100)} className={w.percent >= 100 ? 'full' : ''} />
            {w.resetsAt && <small className="dim">Resets <time dateTime={w.resetsAt}>{resetFormat.format(Date.parse(w.resetsAt))}</time> · {untilReset(w.resetsAt, now)}</small>}
          </div>
        )) : <span className="dim">{check ? 'The provider did not report usage.' : 'Refresh to retrieve current usage.'}</span>}
      </div>
      <div className="dim provider-meta">
        {check && <span>Checked {new Date(check.checkedAt).toLocaleString()}</span>}
        <span>Running {model.inFlight} / {maxInFlight}</span>
        {lastCall && <span>Last call {lastCall.ok ? 'succeeded' : 'failed'} · {(lastCall.durationMs / 1000).toFixed(1)} s</span>}
      </div>
      {admin && <div className="row wrap" style={{ gap: 8 }}>
        {confirm ? <>
          <span>Remove {model.label} from AXION?</span>
          <button className="btn sm" disabled={!!busy} onClick={() => setConfirm(false)}>Cancel</button>
          <button className="btn sm danger" disabled={!!busy} onClick={() => void act('remove')}>Delete model</button>
        </> : <>
          <button className="btn sm" disabled={!!busy} onClick={() => void act(model.enabled ? 'disable' : 'enable')}><Power size={14} />{model.enabled ? 'Disable' : 'Enable'}</button>
          <button className="btn sm" disabled={!!busy || !model.enabled} title="Test connection and retrieve current usage" onClick={() => void act('refresh')}><RefreshCcw size={14} className={busy === 'refresh' ? 'emu-spin' : ''} />{busy === 'refresh' ? 'Refreshing…' : 'Refresh'}</button>
          <button className="btn sm ghost danger" disabled={!!busy} onClick={() => setConfirm(true)}><Trash2 size={14} />Remove</button>
        </>}
      </div>}
      {error && <div role="alert" className="row warn"><AlertTriangle size={14} />{error}</div>}
    </section>
  );
}
