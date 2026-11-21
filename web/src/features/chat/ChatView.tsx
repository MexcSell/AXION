import { AnimatePresence, motion } from 'motion/react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Send, Paperclip, Image as ImageIcon, AtSign, X, CheckCheck, Check, Clock, ArrowDown, Info, FileText, ShieldAlert, Map as MapIcon, Rows3, Rows2, Music, Film, Loader2 } from 'lucide-react';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { IconButton } from '@/components/ui/IconButton';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Segmented } from '@/components/ui/Form';
import { Tip } from '@/components/ui/Tip';
import { AGENT_BY_ID } from '@/data/agents';
import { useAgentsCatalog } from '@/api/agents';
import type { Attachment, Message, MessageKind } from '@/data/types';
import { useAuth } from '@/store/auth';
import { openDialog } from '@/store/ui';
import { clock, cx } from '@/lib/format';
import { layoutRows, mapRows, rangeFor, type RowGeo } from './threadWindow';
import { fileKind } from '@/features/mission/staffing';
import { EvidenceThumb } from '@/features/mission/EvidenceThumb';
import { ThreadMinimap } from '@/features/mission/ThreadMinimap';
import '@/theme/pages/mission-control.css';
import '@/theme/pages/chat.css';

/**
 * The one chat component (owner update 2026-11-20 u1: "merge into one"). Mission threads, direct agent chat,
 * the GM / Administrator dock and plug-in agent chat all render through ChatThreadView → ChatBubble + ChatComposer.
 */
export const KIND_HUE: Record<MessageKind, number> = { delegation: 190, report: 268, consult: 210, command: 30, reply: 40, question: 38, ack: 150, result: 145, system: 225 };

const MINIMAP_KEY = 'axion.thread.minimap';
const readMinimap = () => { try { return localStorage.getItem(MINIMAP_KEY) !== '0'; } catch { return true; } };
const writeMinimap = (v: boolean) => { try { localStorage.setItem(MINIMAP_KEY, v ? '1' : '0'); } catch { /* per-viewer convenience only */ } };

/** Who wrote it: an agent, a human account, or the system. `fallback` is the server's author name (api mode). */
function useAuthor(id: string, fallback?: string) {
  // the agent catalog is updated in place (api mode): a memoised bubble re-renders when it changes (rename, new avatar)
  useAgentsCatalog();
  const acc = useAuth((s) => (id.startsWith('human:') ? s.accounts.find((a) => a.id === id.slice(6)) : undefined));
  if (id.startsWith('human:')) return { kind: 'human' as const, name: acc?.name ?? fallback ?? (id === 'human:owner' ? 'Owner' : 'User'), account: acc };
  const ag = AGENT_BY_ID[id];
  if (ag) return { kind: 'agent' as const, name: ag.name, agent: ag };
  return { kind: 'system' as const, name: id === 'system' ? 'System' : id };
}

/** Tag on content the server simulated for a DEMO mission (Stage 6, decision E5): no agent acted. */
export function SimTag() {
  return <span className="sim-tag" title="Simulated on a DEMO mission. No agent acted; agents do not execute yet.">Simulated</span>;
}

/**
 * Memoised (improvement cycle 22): a thread re-renders on every new message or receipt, and only the bubbles whose
 * message object changed render again. The store keeps unchanged messages as the same objects.
 */
export const ChatBubble = memo(function ChatBubble({ m, right, compact, missionId, label, enter = true }: { m: Message; right: boolean; compact?: boolean; missionId?: string; label?: string; /** false: no entrance animation (a row scrolled back into a virtualised thread) */ enter?: boolean }) {
  const au = useAuthor(m.from, m.authorName);
  const human = au.kind === 'human';
  // system notes (Stage 6: the honest "agents don't act yet" note) are a centred line, not anyone's speech bubble
  if (m.kind === 'system' && m.from === 'system' && m.seq !== undefined) return (
    <motion.div className="bubble-row system" role="note" initial={enter ? { opacity: 0, y: 6 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: .25 }}>
      <div className="bubble-note"><Info size={13} /><span>{m.text}</span><span className="dim">{clock(m.agoMin, m.ts)}</span>{m.simulated && <SimTag />}</div>
    </motion.div>
  );
  return (
    <motion.div className={cx('bubble-row', right ? 'right' : 'left', human && 'human')} layout initial={enter ? { opacity: 0, y: 10, scale: .98 } : false} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .25 }}>
      {!right && (au.kind === 'agent' ? <RobotAvatar role={au.agent.role} size={28} /> : au.kind === 'human' ? <UserAvatar account={au.account} name={au.name} size={28} /> : <span className="bubble-sys"><Info size={14} /></span>)}
      <div className={cx('bubble', `k-${m.kind}`, compact && 'compact')}>
        <div className="bubble-meta">
          <span className="chip sm" style={{ ['--h' as string]: KIND_HUE[m.kind] }}>{label ?? `${human ? 'HUMAN · ' : ''}${m.kind.toUpperCase()}`}</span>
          <b>{au.name}</b>
          <span className="dim">{clock(m.agoMin, m.ts)}</span>
          {m.simulated && <SimTag />}
          {m.taskId && <span className="mono dim">{m.taskId}</span>}
          <button className="bubble-more" aria-label="Message details" onClick={() => openDialog('message-details', { message: m })}><Info size={12} /></button>
        </div>
        <div className="bubble-text">{m.text}</div>
        {m.attachments && m.attachments.length > 0 && (
          <div className="bubble-atts">
            {m.attachments.map((at) => (
              <button key={at.id} className="att" onClick={() => openDialog('attachment-preview', { attachment: at })} aria-label={`Open ${at.name}`}>
                {at.url && at.kind === 'image' ? <img src={at.url} alt={at.name} /> : at.kind === 'image' ? <EvidenceThumb seed={at.name} /> : at.kind === 'audio' ? <Music size={20} /> : at.kind === 'video' ? <Film size={20} /> : <FileText size={20} />}
                <span className="ellipsis">{at.name}</span>
              </button>
            ))}
          </div>
        )}
        {human && right && (
          <div className="bubble-status" aria-label={`Status: ${m.status ?? 'sent'}`}>
            {m.pending ? <><Loader2 size={12} className="spin" /> sending</> : m.status === 'acknowledged' ? <><CheckCheck size={13} className="good" /> acknowledged</> : m.status === 'delivered' ? <><CheckCheck size={13} /> delivered</> : m.status === 'queued' ? <><Clock size={12} /> queued</> : <><Check size={13} /> sent</>}
          </div>
        )}
        {m.kind === 'question' && missionId && (
          <div className="row warn" style={{ gap: 5, fontSize: 11.5, marginTop: 4 }}>
            <ShieldAlert size={12} />Waiting for your reply · {m.replyTo ?? m.id}
            <button className="btn sm" style={{ marginLeft: 'auto', height: 24 }} onClick={() => openDialog('send-command', { missionId, agentId: m.from, mode: 'reply', replyTo: m.replyTo ?? m.id, question: m.text })}>Reply…</button>
          </div>
        )}
      </div>
    </motion.div>
  );
});

export interface ChatMode { key: string; label: ReactNode; help?: string; placeholder: string }
interface LocalAtt { id: string; name: string; size: number; type: string; url?: string; file: File }
let fseq = 1;
const toLocal = (list: FileList | File[]): LocalAtt[] => Array.from(list).map((f) => ({ id: 'a' + fseq++, name: f.name, size: f.size, type: f.type, url: /^(image|audio|video)\//.test(f.type) ? URL.createObjectURL(f) : undefined, file: f }));

export function ChatComposer({ modes, initialMode, toName, draftKey, disabled, disabledText, hint, onSend, compact }: {
  modes: ChatMode[]; initialMode?: string; toName: string; draftKey: string; disabled?: boolean; disabledText?: string; hint?: (mode: string) => ReactNode;
  /** may answer later: false = not sent, the composer puts the text and files back (api mode) */
  onSend: (text: string, mode: string, att: Attachment[]) => void | Promise<boolean>; compact?: boolean;
}) {
  const [mode, setMode] = useState(initialMode ?? modes[0].key);
  const [text, setText] = useState(() => { try { return localStorage.getItem(draftKey) ?? ''; } catch { return ''; } });
  const [files, setFiles] = useState<LocalAtt[]>([]);
  const [over, setOver] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const imgIn = useRef<HTMLInputElement>(null);
  const cur = modes.find((m) => m.key === mode) ?? modes[0];

  useEffect(() => { try { if (text) localStorage.setItem(draftKey, text); else localStorage.removeItem(draftKey); } catch { /* ignore */ } }, [text, draftKey]);
  useLayoutEffect(() => { const el = ta.current; if (el) { el.style.height = '0px'; el.style.height = Math.min(140, el.scrollHeight) + 'px'; } }, [text]);

  const submit = () => {
    if (disabled || (!text.trim() && !files.length)) return;
    const draft = { text, files, mode };
    const r = onSend(text.trim() || '(attachment)', mode, files.map((f) => {
      const k = fileKind(f.name, f.type);
      return { id: f.id, name: f.name, kind: k === 'image' || k === 'audio' || k === 'video' ? k : k === 'doc' || k === 'pdf' ? 'doc' : 'file', url: f.url, size: `${Math.max(1, Math.round(f.size / 1024))} KB`, blob: f.file };
    }));
    setText(''); setFiles([]);
    // not sent: the draft comes back (unless something new was typed meanwhile; then the files still come back)
    if (r && typeof (r as Promise<boolean>).then === 'function') void (r as Promise<boolean>).then((ok) => {
      if (ok) return;
      setText((t) => (t.trim() ? t : draft.text));
      setFiles((f) => [...draft.files, ...f]);
      setMode(draft.mode);
    });
  };

  if (disabled) return <div className="composer disabled"><Info size={14} /> {disabledText ?? 'This conversation is read-only.'}</div>;
  return (
    <div className={cx('composer', over && 'over', compact && 'compact')} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); setFiles([...files, ...toLocal(e.dataTransfer.files)]); }}>
      {(modes.length > 1 || !compact) && (
        <div className="row" style={{ gap: 8, marginBottom: 6 }}>
          {modes.length > 1 && <Segmented ariaLabel="Message mode" size="sm" value={mode} onChange={setMode} options={modes.map((m) => ({ key: m.key, label: m.label }))} />}
          {cur.help && <HelpTrigger k={cur.help} />}
          <span className="dim ellipsis" style={{ fontSize: 11.5 }}>To <b style={{ color: 'var(--text-2)' }}>{toName}</b></span>
        </div>
      )}
      {hint?.(mode)}
      <AnimatePresence>
        {files.length > 0 && (
          <motion.div className="composer-files" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            {files.map((f) => (
              <motion.span key={f.id} className="cf" layout initial={{ scale: .7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                {f.url && f.type.startsWith('image/') ? <img src={f.url} alt={f.name} /> : f.type.startsWith('audio/') ? <Music size={16} /> : f.type.startsWith('video/') ? <Film size={16} /> : <FileText size={16} />}
                <span className="ellipsis">{f.name}</span>
                <button aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x.id !== f.id))}><X size={11} /></button>
              </motion.span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="composer-box">
        <textarea ref={ta} rows={1} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || compact) && !e.shiftKey) { e.preventDefault(); submit(); } }}
          onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); setFiles([...files, ...toLocal(e.clipboardData.files)]); } }}
          placeholder={cur.placeholder} aria-label={typeof cur.label === 'string' ? cur.label : 'Message'} />
        <div className="row" style={{ gap: 2 }}>
          <IconButton icon={Paperclip} label="Attach file (image, audio, video, doc, pdf, txt)" size="sm" onClick={() => fileIn.current?.click()} />
          <IconButton icon={ImageIcon} label="Attach image / screenshot" size="sm" onClick={() => imgIn.current?.click()} />
          {!compact && <IconButton icon={AtSign} label="Mention" size="sm" onClick={() => { setText((t) => t + (t.endsWith(' ') || !t ? '' : ' ') + '@'); ta.current?.focus(); }} />}
          <span className="spacer" />
          <Tip label="Send" shortcut={compact ? 'Enter' : 'Ctrl Enter'}>
            <motion.button className="send-btn" onClick={submit} disabled={!text.trim() && !files.length} whileTap={{ scale: .9 }} aria-label="Send message"><Send size={16} /></motion.button>
          </Tip>
        </div>
        <input ref={fileIn} type="file" multiple hidden onChange={(e) => { if (e.target.files) setFiles([...files, ...toLocal(e.target.files)]); e.target.value = ''; }} />
        <input ref={imgIn} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) setFiles([...files, ...toLocal(e.target.files)]); e.target.value = ''; }} />
      </div>
    </div>
  );
}

/*
 * Improvement cycle 26: a long thread keeps only the rows near the viewport in the DOM (OVERSCAN px above and below), with
 * spacers standing in for the rest, so a live message costs the same in a 50- and a 5,000-message thread.
 * - Heights are measured once per message (one ResizeObserver) and estimated until then (threadWindow.ts). The minimap is
 *   drawn from the same model, so it still shows every message.
 * - Estimates that turn out wrong above the viewport are absorbed by the browser's scroll anchoring (overflow-anchor is
 *   left at its default, auto). An older page that lands at the top keeps the rendered window on the same rows, so the
 *   older-page anchor below still finds the row it remembered and puts it back (as before).
 * - Accessibility: every row is an article with aria-posinset / aria-setsize (its place in the whole thread), so a screen
 *   reader knows where it is and how many there are. One row is in the Tab order (roving tabindex); on a row, ↑ ↓ PgUp PgDn
 *   Home End move to the next, previous, first or last message, which brings any message into the DOM; the row holding
 *   focus is never unmounted. The log itself is not a live region any more: rows mounted by scrolling would be read out as
 *   new. Messages that really arrive at the end are announced by a status line beside it, in order.
 */
const OVERSCAN = 900;   // px rendered above and below the viewport
const DRIFT = 300;      // the window follows the scroll position in steps of this many px
const EST_SAMPLES = 30; // estimates: the mean of the first N measured rows, then fixed (so the spacers do not churn)

const ThreadRow = memo(function ThreadRow({ m, sep, gk, right, compact, missionId, label, pos, size, tab, seen, live, observe }: {
  m: Message; sep: string | null; gk: string; right: boolean; compact: boolean; missionId?: string; label?: string; pos: number; size: number; tab: boolean;
  seen: Set<string>; live: { current: boolean }; observe: (el: HTMLDivElement | null) => void | (() => void);
}) {
  // the entrance animation plays once per message: not for the rows of the first render, not for a row scrolled back in
  const [enter] = useState(() => live.current && !seen.has(m.id));
  useEffect(() => { seen.add(m.id); }, [seen, m.id]);
  return (
    <div data-mid={m.id} data-gk={gk} ref={observe} className="thread-row" role="article" aria-posinset={pos} aria-setsize={size} tabIndex={tab ? 0 : -1}>
      {sep && <div className="day-sep"><span>{sep}</span></div>}
      <ChatBubble m={m} right={right} compact={compact} missionId={missionId} label={label} enter={enter} />
    </div>
  );
});

const whoOf = (m: Message) => AGENT_BY_ID[m.from]?.name ?? m.authorName ?? (m.from === 'system' ? 'System' : m.from.startsWith('human:') ? 'A user' : m.from);

/** A full thread: header, messages (day separators, typing, "new" pill, optional minimap and compact view) and composer. */
export function ChatThreadView({ title, headRight, messages, isRight, typing, composer, missionId, minimap: allowMinimap = true, compactFilter, emptyText, emptyTitle, labelFor, emptyState, className, mmMe, hasOlder, loadingOlder, onLoadOlder, total }: {
  title: ReactNode; headRight?: ReactNode; messages: Message[]; isRight: (m: Message) => boolean;
  typing?: { name: string; role?: import('@/data/types').RoleKey } | null;
  composer: ReactNode; missionId?: string; minimap?: boolean; compactFilter?: (m: Message) => boolean; emptyText?: ReactNode; emptyTitle?: ReactNode; emptyState?: 'loading' | 'error';
  labelFor?: (m: Message) => string | undefined; className?: string; mmMe?: string;
  /** api mode (Stage 6): older pages load when the reader scrolls to the top; `total` is the thread's full length */
  hasOlder?: boolean; loadingOlder?: boolean; onLoadOlder?: () => void; total?: number;
}) {
  const [view, setView] = useState<'full' | 'compact'>('full');
  const [minimap, setMinimapState] = useState(readMinimap);
  const setMinimap = (v: boolean) => { setMinimapState(v); writeMinimap(v); };
  const scroller = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const [said, setSaid] = useState(''); // the last arrival, for screen readers
  const compact = view === 'compact';
  const shown = !compact || !compactFilter ? messages : messages.filter(compactFilter);
  const mm = allowMinimap && minimap;
  const n = shown.length;

  // ------------------------------------------------------------ geometry model and rendered window (cycle 26)
  const geo = useRef(new Map<string, RowGeo>());
  const est = useRef({ row: 74, sep: 27, nRow: 0, sumRow: 0, nSep: 0, sumSep: 0 });
  const box = useRef({ gap: 10, pad: 12, width: 0 });
  const [geoV, setGeoV] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = useMemo(() => layoutRows(shown, geo.current, est.current, box.current.gap, compact), [shown, compact, geoV]);
  const [vp, setVp] = useState({ top: 0, h: 800 }); // scroll position the window was cut for (moves in DRIFT steps)
  const vpRef = useRef(vp);
  useLayoutEffect(() => { vpRef.current = vp; }, [vp]);
  const moveVp = (el: HTMLElement) => { const v = { top: el.scrollTop, h: el.clientHeight }; vpRef.current = v; setVp(v); };

  // an older page landed at the top: keep the window on the same rows (they moved down by the new rows' height)
  const firstShown = shown[0]?.id;
  const [prevFirst, setPrevFirst] = useState(firstShown);
  if (firstShown !== prevFirst) {
    const k = prevFirst ? shown.findIndex((m) => m.id === prevFirst) : -1;
    if (k > 0) { const add = layout.tops[k]; setVp((v) => ({ ...v, top: v.top + add })); }
    setPrevFirst(firstShown);
  }

  const pad = box.current.pad;
  let [s, e] = rangeFor(layout, vp.top - pad - OVERSCAN, vp.top - pad + vp.h + OVERSCAN);
  if (atBottom && n) { // pinned to the bottom: the newest rows are rendered at once (the follow-scroll comes after)
    const [bs] = rangeFor(layout, layout.total - vp.h - OVERSCAN, layout.total + 1);
    s = bs <= e ? Math.min(s, bs) : bs; e = n;
  }
  const [focusId, setFocusId] = useState<string | null>(null);
  const fi = focusId ? shown.findIndex((m) => m.id === focusId) : -1;
  const segs: [number, number][] = !n ? [] : fi < 0 || (fi >= s && fi < e) ? [[s, e]] : fi < s ? [[fi, fi + 1], [s, e]] : [[s, e], [fi, fi + 1]];
  const rovingId = fi >= 0 ? focusId : shown[e - 1]?.id;
  const base = !compact && total !== undefined && total > messages.length ? total - messages.length : 0; // older messages not loaded yet
  const size = base + n;

  const seen = useRef(new Set<string>()).current;
  const live = useRef(false);
  useEffect(() => { live.current = true; }, []);
  // one ResizeObserver for the rows and the scroller; a row is measured when it mounts and whenever its size changes
  const [meter] = useState(() => {
    const me = {
      ro: null as ResizeObserver | null,
      row(el: HTMLElement): boolean {
        const gk = el.dataset.gk, sc = scroller.current;
        if (!gk || !sc || !el.isConnected) return false;
        const h = el.offsetHeight;
        if (!h) return false; // not laid out (a hidden tab)
        const row = el.querySelector<HTMLElement>('.bubble-row') ?? el;
        const bub = row.querySelector<HTMLElement>('.bubble') ?? row;
        const g = { h, off: row.offsetTop - el.offsetTop, bh: row.offsetHeight, w: bub.offsetWidth / Math.max(sc.clientWidth, 1) };
        const old = geo.current.get(gk);
        if (old && Math.abs(old.h - g.h) < .5 && Math.abs(old.off - g.off) < .5 && Math.abs(old.bh - g.bh) < .5 && Math.abs(old.w - g.w) < .005) return false;
        geo.current.set(gk, g);
        const x = est.current;
        if (!old && x.nRow < EST_SAMPLES) { x.nRow++; x.sumRow += g.bh; x.row = x.sumRow / x.nRow; }
        if (!old && g.off > 0 && x.nSep < EST_SAMPLES) { x.nSep++; x.sumSep += g.off; x.sep = x.sumSep / x.nSep; }
        return true;
      },
      get(): ResizeObserver {
        return (me.ro ??= new ResizeObserver((ents) => {
          let changed = false;
          const sc = scroller.current;
          for (const en of ents) {
            const t = en.target as HTMLElement;
            if (t === sc) {
              const w = sc.clientWidth;
              if (box.current.width && Math.abs(w - box.current.width) > 1) { // text re-wraps: every cached height is stale
                geo.current.clear();
                sc.querySelectorAll<HTMLElement>('[data-gk]').forEach((r) => me.row(r));
                changed = true;
              }
              box.current.width = w;
              if (sc.clientHeight !== vpRef.current.h) moveVp(sc);
            } else if (me.row(t)) changed = true;
          }
          if (changed) setGeoV((v) => v + 1);
        }));
      },
    };
    return me;
  });
  const observe = useCallback((el: HTMLDivElement | null) => { if (!el) return; const o = meter.get(); o.observe(el); return () => o.unobserve(el); }, [meter]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    box.current = { gap: parseFloat(cs.rowGap) || 0, pad: parseFloat(cs.paddingTop) || 0, width: el.clientWidth };
    const o = meter.get();
    o.observe(el);
    el.querySelectorAll('[data-gk]').forEach((r) => o.observe(r));
    el.scrollTo({ top: 1e6 });
    moveVp(el);
    setGeoV((v) => v + 1);
    return () => { o.disconnect(); meter.ro = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meter]);
  const firstId = messages[0]?.id;
  const lastId = messages[messages.length - 1]?.id;
  const prevLen = useRef(messages.length);
  const prevLast = useRef(lastId);
  // a thread that loads after mounting (api mode) is pinned to the bottom before the top loader is armed
  const armed = useRef(messages.length > 0);
  useLayoutEffect(() => {
    if (armed.current || !messages.length) return;
    scroller.current?.scrollTo({ top: 1e6 });
    armed.current = true; prevLen.current = messages.length; prevLast.current = lastId;
  }, [messages.length, lastId]);
  useEffect(() => {
    // only messages added at the end are new (older pages are prepended)
    if (messages.length > prevLen.current && lastId !== prevLast.current) {
      const i = messages.findIndex((m) => m.id === prevLast.current);
      if (atBottom) window.setTimeout(() => scroller.current?.scrollTo({ top: 1e6, behavior: 'smooth' }), 30);
      else setNewCount((n) => n + Math.max(1, i >= 0 ? messages.length - 1 - i : messages.length - prevLen.current)); // only rows after the last one seen (an older page may land in the same render)
      if (i >= 0) { // announce what arrived from others, in order (the log is not a live region: see above)
        const fresh = messages.slice(i + 1).filter((m) => !isRight(m));
        const m = fresh[fresh.length - 1];
        if (m) { const t = `${whoOf(m)}: ${m.text.length > 200 ? m.text.slice(0, 200) + '…' : m.text}`; setSaid(fresh.length > 1 ? `${fresh.length} new messages. Latest, ${t}` : t); }
      }
    }
    prevLen.current = messages.length; prevLast.current = lastId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, lastId, atBottom]);
  // older pages: remember the first visible message and where it sat, then put it back there once the page is in
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const requestOlder = (el: HTMLDivElement) => {
    if (!onLoadOlder || !hasOlder || loadingOlder || !armed.current) return;
    const box = el.getBoundingClientRect();
    const first = Array.from(el.querySelectorAll<HTMLElement>('[data-mid]')).find((n) => n.getBoundingClientRect().bottom > box.top);
    anchor.current = first ? { id: first.dataset.mid!, top: first.getBoundingClientRect().top - box.top } : null;
    onLoadOlder();
  };
  useLayoutEffect(() => {
    const el = scroller.current, a = anchor.current;
    if (!el || !a) return;
    const n = el.querySelector<HTMLElement>(`[data-mid="${CSS.escape(a.id)}"]`);
    if (n) el.scrollTop += n.getBoundingClientRect().top - el.getBoundingClientRect().top - a.top;
    anchor.current = null;
  }, [firstId]);
  useEffect(() => { if (!loadingOlder) anchor.current = null; }, [loadingOlder]); // a failed or empty load leaves nothing to restore
  useEffect(() => { if (typing && atBottom) window.setTimeout(() => scroller.current?.scrollTo({ top: 1e6, behavior: 'smooth' }), 30); }, [typing, atBottom]);

  // keyboard: on a message, ↑ ↓ PgUp PgDn Home End move between messages; the target is scrolled in, mounted and focused
  const pendingFocus = useRef<string | null>(null);
  const focusRow = (i: number) => {
    const el = scroller.current, m = shown[i];
    if (!el || !m) return;
    const top = pad + layout.tops[i], bottom = pad + layout.tops[i + 1] - layout.gap;
    pendingFocus.current = m.id;
    setFocusId(m.id);
    if (top < el.scrollTop) el.scrollTop = top - 8;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight + 8;
    moveVp(el);
  };
  useLayoutEffect(() => {
    const id = pendingFocus.current, el = scroller.current;
    if (!id || !el) return;
    const row = el.querySelector<HTMLElement>(`[data-mid="${CSS.escape(id)}"]`);
    if (!row) return;
    pendingFocus.current = null;
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: 'nearest' }); // the estimate may have been off
  });
  const onKeyDown = (ev: React.KeyboardEvent<HTMLDivElement>) => {
    const t = ev.target as HTMLElement;
    if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey || !t.matches('[data-mid]')) return; // only on the message itself
    const i = shown.findIndex((m) => m.id === t.dataset.mid);
    const to = ({ ArrowDown: i + 1, PageDown: i + 1, ArrowUp: i - 1, PageUp: i - 1, Home: 0, End: n - 1 } as Record<string, number | undefined>)[ev.key];
    if (to === undefined || i < 0) return;
    ev.preventDefault();
    if (to >= 0 && to < n) { if (to !== i) focusRow(to); }
    else if (to < 0 && scroller.current) requestOlder(scroller.current);
  };

  const rows: ReactNode[] = [];
  let at = 0, sp = 0;
  const spacer = (a: number, z: number) => { const k = `sp${sp++}`; if (z > a) rows.push(<div key={k} className="thread-spacer" aria-hidden style={{ height: Math.max(0, layout.tops[z] - layout.tops[a] - layout.gap) }} />); };
  for (const [a, z] of segs) {
    spacer(at, a);
    for (let i = a; i < z; i++) {
      const m = shown[i];
      rows.push(<ThreadRow key={m.id} m={m} sep={layout.seps[i]} gk={layout.keys[i]} right={isRight(m)} compact={compact} missionId={missionId} label={labelFor?.(m)}
        pos={base + i + 1} size={size} tab={m.id === rovingId} seen={seen} live={live} observe={observe} />);
    }
    at = z;
  }
  spacer(at, n);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mapped = useMemo(() => (mm ? mapRows(shown, layout, geo.current, est.current, pad) : []), [mm, layout, pad]);

  return (
    <div className={cx('thread', className)}>
      <div className="thread-head">
        <span className="row" style={{ gap: 6, minWidth: 0 }}>{title}</span>
        <span className="spacer" />
        <span className="dim thread-count nowrap" style={{ fontSize: 11 }} title={total !== undefined && total > messages.length ? `${messages.length} loaded — scroll up for older messages` : undefined}>{total ?? messages.length} msgs</span>
        {headRight}
        {allowMinimap && <>
          <IconButton size="sm" icon={MapIcon} variant={minimap ? 'active' : 'default'} label={minimap ? 'Hide minimap (times beside the scroll)' : 'Show minimap (times beside the scroll)'} onClick={() => setMinimap(!minimap)} aria-pressed={minimap} className="thread-mm-toggle" />
          <span className="thread-mm-toggle"><HelpTrigger k="thread.minimap" /></span>
        </>}
        {compactFilter && <Segmented ariaLabel="Thread view" size="sm" value={view} onChange={setView} options={[{ key: 'full', label: <><Rows3 size={12} />Full</>, title: 'Verbatim events' }, { key: 'compact', label: <><Rows2 size={12} />Compact</>, title: 'Assignment → report → outcome' }]} />}
      </div>
      <div className={cx('thread-scroll', mm && 'with-minimap')}>
        {loadingOlder && <div className="thread-older" role="status"><Loader2 size={12} className="spin" /> Loading older messages…</div>}
        <div className="thread-body" ref={scroller} onKeyDown={onKeyDown}
          onFocus={(ev) => { const r = (ev.target as HTMLElement).closest<HTMLElement>('[data-mid]'); if (r?.dataset.mid && r.dataset.mid !== focusId) setFocusId(r.dataset.mid); }}
          onScroll={(ev) => {
            const el = ev.currentTarget; const b = el.scrollHeight - el.scrollTop - el.clientHeight < 40; setAtBottom(b); if (b) setNewCount(0); if (el.scrollTop < 80) requestOlder(el);
            if (Math.abs(el.scrollTop - vpRef.current.top) > DRIFT || el.clientHeight !== vpRef.current.h) moveVp(el);
          }}
          {...(emptyState ? {} : { role: 'log', 'aria-label': 'Conversation', 'aria-live': 'off' })} data-has-older={hasOlder ? '1' : undefined}>
          {shown.length === 0 && <div className="empty" style={{ padding: 30 }} {...(emptyState ? { role: emptyState === 'error' ? 'alert' : 'status' } : {})}><div className="empty-icon"><Send size={22} /></div><h4>{emptyTitle ?? 'No messages yet'}</h4>{emptyText && typeof emptyText === 'object' ? <div className="thread-empty-body">{emptyText}</div> : <p>{emptyText ?? 'Write the first message.'}</p>}</div>}
          {rows}
          <AnimatePresence>
            {typing && (
              <motion.div className="typing" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                {typing.role && <RobotAvatar role={typing.role} size={22} />} {typing.name} is composing <span className="dots"><i /><i /><i /></span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {mm && <ThreadMinimap scroller={scroller} msgs={shown} rows={mapped} me={mmMe ?? ''} kindHue={KIND_HUE} deps={`${view}:${!!typing}`} />}
      </div>
      <div className="sr-only" role="status">{said}</div>
      <AnimatePresence>
        {newCount > 0 && (
          <motion.button className="new-pill" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} onClick={() => { scroller.current?.scrollTo({ top: 1e6, behavior: 'smooth' }); setNewCount(0); }}>
            <ArrowDown size={13} /> {newCount} new
          </motion.button>
        )}
      </AnimatePresence>
      {composer}
    </div>
  );
}
