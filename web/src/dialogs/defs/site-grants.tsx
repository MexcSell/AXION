import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyRound, Loader2, ShieldAlert, Info, CircleCheck, CircleX } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Form';
import { Chip } from '@/components/ui/Chips';
import { isApi } from '@/api/mode';
import { checkOrigin, issueGrant, newKey } from '@/api/siteGrants';
import { useVisibleMissions } from '@/store/data';
import { cx } from '@/lib/format';
import { toast } from '@/store/ui';
import type { DialogComponentProps } from '@/dialogs/DialogHost';
import '@/theme/pages/overview-org-agent.css';
import '@/theme/pages/site-grants.css';

const CAPS: { key: string; label: string; hint: string }[] = [
  { key: 'read', label: 'read', hint: 'Open and read a page' },
  { key: 'screenshot', label: 'screenshot', hint: 'Capture what the page shows' },
  { key: 'summarize', label: 'summarize', hint: 'Summarise page content' },
  { key: 'fill_draft', label: 'fill draft', hint: 'Fill a form without submitting it' },
];
const DURATIONS: { key: string; label: string; ms: number }[] = [
  { key: '15m', label: '15 min', ms: 15 * 60_000 }, { key: '1h', label: '1 hour', ms: 3_600_000 }, { key: '2h', label: '2 hours', ms: 7_200_000 },
  { key: '1d', label: '1 day', ms: 86_400_000 }, { key: '7d', label: '7 days', ms: 7 * 86_400_000 }, { key: '30d', label: '30 days', ms: 30 * 86_400_000 - 60_000 },
];

/* DL-90: Grant a site (c36, api mode). The origin is checked as you type by the server's own normaliser (a pure check: nothing
   is stored or fetched). Granting is an R3 action; the administrator who grants is the approver the policy names. */
function SiteGrant({ close, props }: DialogComponentProps<{ missionId?: string }>) {
  const api_ = isApi();
  const missions = useVisibleMissions();
  const [origin, setOrigin] = useState('');
  const [missionId, setMissionId] = useState(props.missionId ?? '');
  useEffect(() => { if (!missionId && missions.length) setMissionId(missions[0].id); }, [missions, missionId]);
  const [caps, setCaps] = useState<string[]>(['read']);
  const [dur, setDur] = useState('2h');
  const [check, setCheck] = useState<{ for: string; ok: boolean; origin?: string; message?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [srvErr, setSrvErr] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const submitKey = useRef(newKey());
  // live validation: the server's normaliser, debounced; a stale answer is dropped
  useEffect(() => {
    if (!api_ || !origin.trim()) return;
    const ac = new AbortController();
    const t = window.setTimeout(() => { void checkOrigin(origin, ac.signal).then((r) => { if (r && !ac.signal.aborted) setCheck({ for: origin, ok: r.ok, origin: r.origin, message: r.message }); }); }, 220);
    return () => { window.clearTimeout(t); ac.abort(); };
  }, [origin, api_]);
  const verdict = check && check.for === origin ? check : null;
  const err = !api_ ? 'Site grants are stored on the server' : !origin.trim() ? 'Enter the exact origin' : verdict && !verdict.ok ? verdict.message ?? 'That origin cannot be granted' : !verdict ? 'Checking the origin…' : !missionId ? 'Choose a mission' : caps.length === 0 ? 'Allow at least one action' : '';
  const touch = () => { setSrvErr(null); setFields({}); };
  const submit = async () => {
    if (err || busy) return;
    const d = DURATIONS.find((x) => x.key === dur)!;
    setBusy(true); touch();
    const r = await issueGrant({ origin, missionId, capabilities: caps, expiresAt: new Date(Date.now() + d.ms).toISOString() }, submitKey.current);
    setBusy(false);
    if (!r.ok) { setSrvErr(r.message); setFields(r.fieldErrors ?? {}); submitKey.current = newKey(); return; }
    toast({ tone: 'success', title: 'Site granted', body: `${r.value.origin} for ${r.value.missionId}, ${d.label}.` });
    close();
  };
  const shown = useMemo(() => (verdict?.ok && verdict.origin ? verdict.origin : ''), [verdict]);
  return (
    <Modal title="Grant a site" icon={KeyRound} help="grants.add" dialogId="DL-90" size="md" onClose={close}
      sub="One exact origin for one mission, for a limited time. New sites always need their own grant."
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={!!err || busy} title={err || undefined} onClick={submit}>{busy ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />}Grant site</button></>}>
      <div className="col" style={{ gap: 12 }}>
        {!api_ && <div className="oa-banner"><Info size={15} /><span>Site grants are stored on the server. In demo mode this dialog only shows the form.</span></div>}
        <Field label="Origin" help="grants.origin" htmlFor="sg-origin" required error={fields.origin} hint="For example https://example.com. No path, wildcard, IP address or local name.">
          <input id="sg-origin" data-autofocus className="input mono" value={origin} maxLength={300} spellCheck={false} autoComplete="off" autoCapitalize="off"
            aria-invalid={verdict ? !verdict.ok : undefined} onChange={(e) => { touch(); setOrigin(e.target.value); }} placeholder="https://example.com" />
        </Field>
        <div className={cx('sg-check', verdict?.ok ? 'ok' : verdict ? 'no' : '')} role="status" aria-live="polite" data-origin-check={verdict ? (verdict.ok ? 'ok' : 'refused') : 'idle'}>
          {verdict ? (verdict.ok ? <><CircleCheck size={14} />Exact origin accepted</> : <><CircleX size={14} />{verdict.message}</>) : origin.trim() ? <><Loader2 size={14} className="spin" />Checking…</> : null}
        </div>
        {shown && <div className="sg-preview" data-normal-form>Will be stored as <b className="mono">{shown}</b></div>}
        <Field label="Mission" help="grants.mission" htmlFor="sg-mission" required error={fields.missionId}>
          <select id="sg-mission" className="select" aria-label="Mission" value={missionId} onChange={(e) => { touch(); setMissionId(e.target.value); }}>
            {missions.length === 0 && <option value="">No missions yet</option>}
            {missions.map((m) => <option key={m.id} value={m.id}>{m.id} · {m.title}</option>)}
          </select>
        </Field>
        <Field label="Allowed actions" help="grants.capabilities" error={fields.capabilities} hint="Low-risk actions only. Submitting or sending is approved one action at a time.">
          <div className="row wrap" style={{ gap: 6 }} role="group" aria-label="Allowed actions">
            {CAPS.map((c) => { const on = caps.includes(c.key); return <button key={c.key} type="button" title={c.hint} className={cx('oa-filter', on && 'on')} aria-pressed={on} onClick={() => { touch(); setCaps(on ? caps.filter((x) => x !== c.key) : [...caps, c.key]); }}>{c.label}</button>; })}
          </div>
        </Field>
        <Field label="Expires after" help="grants.expiry" htmlFor="sg-exp" error={fields.expiresAt} hint="At most 30 days. The grant ends by itself.">
          <select id="sg-exp" className="select" aria-label="Expires after" value={dur} onChange={(e) => setDur(e.target.value)}>{DURATIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</select>
        </Field>
        <div className="row" style={{ gap: 8 }}><Chip hue={268} icon={ShieldAlert} size="sm">R3 · you approve as administrator</Chip></div>
        {err && api_ && origin.trim() === '' && <span className="dim" style={{ fontSize: 12 }} data-dialog-hint>{err}</span>}
        {srvErr && <div className="oa-banner" role="alert" data-dialog-error><ShieldAlert size={15} /><span>{srvErr}</span></div>}
      </div>
    </Modal>
  );
}

export const dialogs = { 'site-grant': SiteGrant };
