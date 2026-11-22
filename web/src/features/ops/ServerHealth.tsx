import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Database, Radio, ScrollText, HardDriveDownload, Ban, Server, RefreshCw, Anchor } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Chip, Dot } from '@/components/ui/Chips';
import { IconButton } from '@/components/ui/IconButton';
import { Tip } from '@/components/ui/Tip';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { api, ApiFailure } from '@/api/client';
import { useData } from '@/store/data';

interface Health {
  version: string;
  api: { status: 'up'; uptimeSec: number };
  db: { status: 'up' | 'down'; sizeBytes?: number; missions?: number };
  events: { count: number; lastAt: string | null };
  sse: { clients: number };
  backup: { last: string | null; file: string | null; count: number };
  execution: 'disabled';
  checkedAt: string;
}

interface AnchorInfo { configured: boolean; ok: boolean; lastAnchorAt: string | null; reason: string | null; tenants: { tenant: string; status: string; anchoredSeq: number | null; reason: string | null }[] }
const ANCHOR_WORDS: Record<string, string> = { ok: 'Matches', truncated: 'Rows were removed', rewritten: 'History was rewritten', bad_signature: 'Anchor file was edited', anchor_missing: 'Not verifiable', rolled_back: 'Anchor file was cut back' };

const dur = (s: number) => (s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} d`);
const mb = (b?: number) => (b === undefined ? '—' : `${(b / 1048576).toFixed(1)} MB`);
const ago = (iso: string | null) => { if (!iso) return 'never'; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? 'just now' : m < 90 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

/** Stage 5: read-only status of the real AXION server (administrators). Refreshes every 15 s and on live events. */
export function ServerHealth() {
  const [h, setH] = useState<Health | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [an, setAn] = useState<AnchorInfo | null>(null);
  const lastEventAt = useData((s) => s.lastEventAt);
  const load = async () => {
    setBusy(true);
    try { setH(await api<Health>('GET', '/operations/health')); setErr(''); }
    catch (e) { setErr(e instanceof ApiFailure ? e.message : 'Not reachable'); }
    finally { setBusy(false); }
  };
  const loadAnchor = async () => { try { setAn(await api<AnchorInfo>('GET', '/operations/anchors')); } catch { setAn(null); } };
  useEffect(() => { void loadAnchor(); }, []);
  useEffect(() => { void load(); const t = window.setInterval(() => void load(), 15000); return () => window.clearInterval(t); }, []);
  useEffect(() => { const t = window.setTimeout(() => void load(), 400); return () => window.clearTimeout(t); }, [lastEventAt]);

  const tiles = h ? [
    { icon: Server, label: 'API', value: 'Up', sub: `v${h.version} · up ${dur(h.api.uptimeSec)}`, tone: 'good' as const },
    { icon: Database, label: 'Database', value: h.db.status === 'up' ? 'Up' : 'Down', sub: `${mb(h.db.sizeBytes)} · ${h.db.missions ?? 0} missions`, tone: h.db.status === 'up' ? 'good' as const : 'bad' as const },
    { icon: ScrollText, label: 'Event log', value: h.events.count.toLocaleString(), sub: `last ${ago(h.events.lastAt)}`, tone: 'good' as const },
    { icon: Radio, label: 'Live streams', value: String(h.sse.clients), sub: 'open tabs receiving updates', tone: 'good' as const },
    { icon: HardDriveDownload, label: 'Last backup', value: ago(h.backup.last), sub: h.backup.file ? `${h.backup.count} kept · ${h.backup.file}` : 'run npm run db:backup', tone: h.backup.last && Date.now() - new Date(h.backup.last).getTime() < 86400000 * 2 ? 'good' as const : 'warn' as const },
    { icon: Ban, label: 'Execution', value: 'Disabled', sub: 'Stage 5: nothing runs; agents arrive in Stage 6', tone: 'warn' as const },
  ] : [];

  return (
    <Panel icon={Server} titleSize="lg" title="AXION server" help="ops.serverHealth" delay={.02} className="ops-server-health"
      sub={h ? `Checked ${ago(h.checkedAt)} · read-only` : 'Read-only status of the API and database'}
      actions={<><Chip hue={err ? 0 : 148} size="sm">{err ? 'unreachable' : 'live data'}</Chip><IconButton size="xs" icon={RefreshCw} label="Refresh now" onClick={() => { void load(); void loadAnchor(); }} className={busy ? 'spin' : undefined} /></>}>
      {err ? <div className="dim" style={{ fontSize: 13 }}>{err}</div> : (
        <div className="grid g-3" data-testid="server-health">
          {tiles.map((t, i) => (
            <motion.div key={t.label} className="subpanel glass-card svc-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .04 }}>
              <div className="row" style={{ gap: 8 }}>
                <Dot tone={t.tone} pulse={t.tone !== 'good'} />
                <t.icon size={15} />
                <b style={{ fontSize: 13 }}>{t.label}</b>
                <span className="spacer" />
                <Tip label={t.sub}><b className={t.tone} style={{ fontSize: 14 }}>{t.value}</b></Tip>
              </div>
              <div className="dim ellipsis" style={{ fontSize: 11.5, marginTop: 4 }} title={t.sub}>{t.sub}</div>
            </motion.div>
          ))}
          {an && (() => {
            const bad = an.tenants.find((t) => t.status !== 'ok');
            const tone = an.ok ? 'good' as const : an.configured && bad && bad.status !== 'anchor_missing' ? 'bad' as const : 'warn' as const;
            const word = an.ok ? 'Matches' : bad ? (ANCHOR_WORDS[bad.status] ?? bad.status) : 'Not verifiable';
            const sub = an.lastAnchorAt ? `last checkpoint ${ago(an.lastAnchorAt)} · ${an.tenants.map((t) => `${t.status === 'ok' ? 'ok' : t.status.replace('_', ' ')}${t.anchoredSeq ? ` through #${t.anchoredSeq}` : ''}`).join(', ')}` : (an.reason ?? 'run npm run audit:anchor');
            return (
              <motion.div className="subpanel glass-card svc-card" data-testid="audit-anchor" data-status={an.ok ? 'ok' : bad?.status ?? 'anchor_missing'} style={{ gridColumn: '1 / -1' }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .26 }}>
                <div className="row" style={{ gap: 8 }}>
                  <Dot tone={tone} pulse={tone !== 'good'} />
                  <Anchor size={15} />
                  <b style={{ fontSize: 13 }}>Audit anchor</b>
                  <HelpTrigger k="ops.auditAnchor" />
                  <span className="spacer" />
                  <Tip label={sub}><b className={tone} style={{ fontSize: 14 }}>{word}</b></Tip>
                </div>
                <div className="dim ellipsis" style={{ fontSize: 11.5, marginTop: 4 }} title={sub}>{sub}</div>
              </motion.div>
            );
          })()}
        </div>
      )}
    </Panel>
  );
}
