import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { KeyRound, Plus, Globe, Ban, Check, X, Clock3, CircleCheck, CircleSlash, Timer, ShieldAlert, AlertOctagon } from 'lucide-react';
import type { SiteGrantDto, SiteGrantState } from '@contracts';
import { Panel } from '@/components/ui/Panel';
import { Chip } from '@/components/ui/Chips';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { EmptyState } from '@/components/ui/EmptyState';
import { useSiteGrants, revokeGrant } from '@/api/siteGrants';
import { openDialog, toast } from '@/store/ui';
import { cx } from '@/lib/format';
import '@/theme/pages/overview-org-agent.css';
import '@/theme/pages/site-grants.css';

/* Improvement cycle 36 (api mode, administrators): site grants. Exact origins only; each grant has an expiry (at most 30 days)
   and can be revoked once. Only stored facts are shown. */
const STATE: Record<SiteGrantState, { label: string; hue: number; icon: typeof CircleCheck }> = {
  active: { label: 'Active', hue: 148, icon: CircleCheck },
  expired: { label: 'Expired', hue: 38, icon: Timer },
  revoked: { label: 'Revoked', hue: 225, icon: CircleSlash },
};

export function remaining(expiresAt: string, now: number): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return 'ended';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'under 1 min left';
  if (m < 60) return `${m} min left`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min left`;
  return `${Math.floor(h / 24)} d ${h % 24} h left`;
}
const stamp = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function Row({ g, now, index }: { g: SiteGrantDto; now: number; index: number }) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const live = g.state === 'active' && new Date(g.expiresAt).getTime() > now;
  const S = STATE[live ? 'active' : g.state === 'active' ? 'expired' : g.state];
  const go = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    const r = await revokeGrant(g.id, reason);
    setBusy(false);
    if (!r.ok) { setErr(r.message); return; }
    setConfirming(false); setReason('');
    toast({ tone: 'success', title: 'Grant revoked', body: `${g.origin} no longer works for ${g.missionId}.` });
  };
  return (
    <motion.li layout className="sg-row" data-grant={g.id} data-origin={g.origin} data-state={S.label.toLowerCase()} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: Math.min(index, 6) * .04 }}>
      <div className="sg-main">
        <Globe size={16} className={cx('sg-ico', live && 'on')} aria-hidden />
        <div style={{ minWidth: 0, flex: 1 }}>
          <b className="mono sg-origin" title={g.origin}>{g.origin}</b>
          <div className="dim sg-meta">{g.missionId} · {g.capabilities.join(', ')} · by {g.issuedByName}</div>
        </div>
        <div className="sg-when" data-expiry={g.expiresAt}>
          <Chip hue={S.hue} icon={S.icon} size="sm" solid={live}>{S.label}</Chip>
          <span className="dim tnum" title={`Expires ${new Date(g.expiresAt).toLocaleString()}`}>{g.state === 'revoked' ? `revoked ${stamp(g.revokedAt!)}` : live ? remaining(g.expiresAt, now) : `ended ${stamp(g.expiresAt)}`}</span>
        </div>
        {live && !confirming && <button className="icon-btn sg-revoke" aria-label={`Revoke the grant for ${g.origin}`} title="Revoke now" onClick={() => setConfirming(true)}><Ban size={14} /></button>}
      </div>
      {g.state === 'revoked' && <div className="dim sg-meta" data-revoked>Revoked by {g.revokedByName}{g.reason ? <> · “{g.reason}”</> : null}</div>}
      {confirming && (
        <div className="row sg-confirm" style={{ gap: 8 }}>
          <input className="input" style={{ flex: 1, minWidth: 0, height: 30 }} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" aria-label={`Reason for revoking ${g.origin}`} data-autofocus />
          <button className="btn sm primary" disabled={busy} onClick={go}><Check size={13} />Revoke</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => setConfirming(false)}><X size={13} />Back</button>
        </div>
      )}
      {err && <div className="oa-banner" role="alert" data-card-error><AlertOctagon size={15} /><span>{err}</span></div>}
    </motion.li>
  );
}

/** Settings › Browser, administrators, api mode. */
export function SiteGrants() {
  const { data, error, retry } = useSiteGrants(true);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 15_000); return () => window.clearInterval(t); }, []);
  const list = data?.grants ?? [];
  const activeN = list.filter((g) => g.state === 'active' && new Date(g.expiresAt).getTime() > now).length;
  return (
    <Panel icon={KeyRound} title="Site grants" help="browser.originGrant" delay={.1} sub="Exact origin · one mission"
      actions={<div className="row" style={{ gap: 6 }}><button className="btn primary sm" disabled={!data} onClick={() => openDialog('site-grant', {})}><Plus size={14} />Grant a site</button><HelpTrigger k="grants.add" /></div>}>
      <div data-site-grants={data ? 'ready' : error ? 'error' : 'loading'}>
        {error && <div className="oa-banner" role="alert"><ShieldAlert size={15} /><span>Site grants not loaded: {error}</span><button className="btn sm" onClick={retry}>Retry</button></div>}
        <div className="row" style={{ gap: 8, margin: '0 0 8px' }}>
          <Chip hue={268} icon={ShieldAlert} size="sm" title="Granting a site is an R3 action: the policy names an administrator as approver">R3 · administrator approves</Chip>
          <Chip hue={205} icon={Clock3} size="sm">max {data?.maxDays ?? 30} days</Chip>
          {data && <span className="dim tnum" style={{ fontSize: 12 }} data-active-count={activeN}>{activeN} active of {list.length}</span>}
          <span className="spacer" /><HelpTrigger k="grants.panel" />
        </div>
        {!data && !error ? <div className="dim" style={{ padding: 10 }}>Loading grants…</div>
          : list.length === 0 ? <EmptyState icon={Globe} title="No site grants" body="Agents have no website access. New sites always need a separate, exact grant." />
          : <ul className="sg-list" aria-label="Site grants"><AnimatePresence initial={false}>{list.map((g, i) => <Row key={g.id} g={g} now={now} index={i} />)}</AnimatePresence></ul>}
      </div>
    </Panel>
  );
}
