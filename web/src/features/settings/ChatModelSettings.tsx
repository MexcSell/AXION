import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Bot, ArrowUp, ArrowDown, Route, RotateCcw, Save, BarChart3, CircleCheck, CircleAlert, CircleMinus, Hourglass, RefreshCw } from 'lucide-react';
import type { ChatRouteEntryDto } from '@contracts';
import { Panel } from '@/components/ui/Panel';
import { Chip } from '@/components/ui/Chips';
import { Switch, Segmented } from '@/components/ui/Form';
import { EmptyState } from '@/components/ui/EmptyState';
import { LiveStatus } from '@/components/ui/LiveStatus';
import { useChatModelRoute, useChatUsage } from '@/api/chatModel';
import { useUI } from '@/store/ui';
import { plainError } from '@/lib/plainError';
import '@/theme/pages/chat-model.css';

/**
 * Settings › AI Chat (owner 2026-11-25): administrators choose which cloud models answer the General Manager and agent chats, in order.
 * The first usable model answers; the server's model router moves to the next one when a model is disabled, removed, limited or failing.
 */
const until = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

function StateChip({ e, active }: { e: ChatRouteEntryDto; active: boolean }) {
  if (active) return <Chip hue={150} icon={CircleCheck} size="sm">answering now</Chip>;
  if (e.usable) return <Chip hue={210} icon={CircleCheck} size="sm">ready</Chip>;
  if (e.until) return <Chip hue={38} icon={Hourglass} size="sm" title={e.reason ?? ''}>{e.reason} · back {until(e.until)}</Chip>;
  if (!e.configured) return <Chip hue={0} icon={CircleAlert} size="sm">not configured</Chip>;
  return <Chip hue={0} icon={CircleMinus} size="sm">{e.reason ?? 'unusable'}</Chip>;
}

export function ChatModelSettings({ admin }: { admin: boolean }) {
  const { data, error, save, refresh } = useChatModelRoute();
  const [order, setOrder] = useState<string[] | null>(null); // the edited order; null = untouched
  const [busy, setBusy] = useState(false);
  useEffect(() => { setOrder(null); }, [data?.updatedAt, data?.custom]);
  const cur = order ?? data?.models ?? [];
  const dirty = !!data && order !== null && order.join() !== data.models.join();
  const byId = useMemo(() => new Map((data?.entries ?? []).map((e) => [e.id, e])), [data]);
  const others = (data?.entries ?? []).filter((e) => !cur.includes(e.id));
  const toast = useUI((s) => s.toast);

  const move = (i: number, d: -1 | 1) => { const n = [...cur]; [n[i], n[i + d]] = [n[i + d], n[i]]; setOrder(n); };
  const toggle = (id: string, on: boolean) => setOrder(on ? [...cur, id] : cur.filter((x) => x !== id));
  const run = async (models: string[] | null) => {
    setBusy(true);
    try { await save(models); toast({ tone: 'success', title: models ? 'Chat model order saved' : 'Default order restored', body: 'The next chat answer uses it.' }); }
    catch (e) { toast({ tone: 'error', title: 'Not saved', body: plainError(e) }); }
    finally { setBusy(false); }
  };

  if (!data) return <Panel icon={Bot} title="AI Chat">{error ? <EmptyState icon={Bot} title="Could not load the chat model" body={error} /> : <LiveStatus className="dim">Loading…</LiveStatus>}</Panel>;
  const row = (e: ChatRouteEntryDto, i: number | null) => (
    <motion.li key={e.id} layout className="chatm-row" data-chat-model={e.id} data-usable={e.usable ? '1' : '0'} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
      {i !== null ? <b className="chatm-rank tnum">{i + 1}</b> : <span className="chatm-rank dim">–</span>}
      <Bot size={16} className={e.usable ? 'good' : 'dim'} />
      <span className="chatm-name"><b>{e.label}</b><span className="dim mono">{e.model || e.id}</span></span>
      <StateChip e={e} active={i !== null && data.active === e.id && !dirty} />
      <span className="chatm-actions">
        {admin && i !== null && <>
          <button className="btn sm ghost" aria-label={`Move ${e.label} up`} disabled={i === 0 || busy} onClick={() => move(i, -1)}><ArrowUp size={13} /></button>
          <button className="btn sm ghost" aria-label={`Move ${e.label} down`} disabled={i === cur.length - 1 || busy} onClick={() => move(i, 1)}><ArrowDown size={13} /></button>
        </>}
        {admin && e.configured && <Switch label={`Use ${e.label} for chat`} checked={i !== null} disabled={busy || (i !== null && cur.length === 1)} onChange={(on) => toggle(e.id, on)} />}
      </span>
    </motion.li>
  );

  return (
    <div className="chatm">
      <Panel icon={Route} title="Chat model" sub="which model answers the General Manager and agent chats" help="settings.chatModel" delay={.02}
        actions={<button className="btn sm ghost" onClick={refresh} aria-label="Refresh model states"><RefreshCw size={13} /></button>}>
        <p className="dim" style={{ fontSize: 12.5, margin: '0 0 10px' }}>
          The first usable model answers. When it is disabled or removed on Models, reaches a usage limit, times out or fails, the model router moves to the next one and goes back once it recovers.
          {!data.custom && ' This is the default order.'}
        </p>
        <ol className="chatm-list" aria-label="Chat model order">{cur.map((id, i) => row(byId.get(id) ?? { id, label: id, model: '', configured: false, enabled: false, usable: false, reason: 'not configured on this server', until: null }, i))}</ol>
        {others.length > 0 && <>
          <div className="chatm-sub dim">Not used for chat</div>
          <ul className="chatm-list">{others.map((e) => row(e, null))}</ul>
        </>}
        {data.active === null && <div className="warn" style={{ fontSize: 12.5, marginTop: 8 }}>No model in this order can answer now: the chats show a note instead of an answer.</div>}
        {admin ? (
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button className="btn primary sm" disabled={!dirty || busy || !cur.length} onClick={() => void run(cur)}><Save size={13} /> Save order</button>
            {dirty && <button className="btn sm ghost" disabled={busy} onClick={() => setOrder(null)}>Undo changes</button>}
            {data.custom && !dirty && <button className="btn sm ghost" disabled={busy} onClick={() => void run(null)}><RotateCcw size={13} /> Use the default order</button>}
            {data.updatedAt && <span className="dim" style={{ fontSize: 11.5, marginLeft: 'auto' }}>Changed {new Date(data.updatedAt).toLocaleString()}</span>}
          </div>
        ) : <div className="dim" style={{ fontSize: 12, marginTop: 10 }}>Only administrators can change the chat model.</div>}
      </Panel>
      {admin && <ChatUsage />}
    </div>
  );
}

function ChatUsage() {
  const [days, setDays] = useState<'1' | '7' | '30'>('7');
  const { data, error } = useChatUsage(Number(days), true);
  const total = (data?.rows ?? []).reduce((s, r) => ({ calls: s.calls + r.calls, errors: s.errors + r.errors, inT: s.inT + r.inputTokens, outT: s.outT + r.outputTokens }), { calls: 0, errors: 0, inT: 0, outT: 0 });
  return (
    <Panel icon={BarChart3} title="Chat usage" sub="model calls made by the chats (from the audit log)" help="settings.chatUsage" delay={.06}
      actions={<Segmented ariaLabel="Period" size="sm" value={days} onChange={setDays} options={[{ key: '1', label: 'Today' }, { key: '7', label: '7 days' }, { key: '30', label: '30 days' }]} />}>
      {!data ? <LiveStatus kind={error ? 'error' : 'loading'} className="dim">{error ?? 'Loading…'}</LiveStatus> : !data.rows.length ? <EmptyState icon={BarChart3} title="No chat answers in this period" body="Answers from the General Manager and the agents show up here." /> : <>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }} data-chat-usage-total>
          <Chip hue={210} size="sm">{total.calls} calls</Chip>
          <Chip hue={total.errors ? 0 : 150} size="sm">{total.errors} failed</Chip>
          <Chip hue={268} size="sm">{data.fallbacks} answered by a fallback model</Chip>
          <Chip hue={38} size="sm">{total.inT.toLocaleString()} in · {total.outT.toLocaleString()} out tokens</Chip>
        </div>
        <table className="table chatm-usage">
          <thead><tr><th>Day (UTC)</th><th>Model</th><th className="num">Calls</th><th className="num">Failed</th><th className="num">Messages answered</th><th className="num">Tokens in / out</th></tr></thead>
          <tbody>{data.rows.map((r) => (
            <tr key={r.day + r.modelId}><td className="tnum">{r.day}</td><td className="mono">{r.modelId}</td><td className="num tnum">{r.calls}</td><td className="num tnum">{r.errors}</td><td className="num tnum">{r.answered}</td><td className="num tnum">{r.inputTokens.toLocaleString()} / {r.outputTokens.toLocaleString()}</td></tr>
          ))}</tbody>
        </table>
      </>}
    </Panel>
  );
}
