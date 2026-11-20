import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Send, Paperclip, Image as ImageIcon, AtSign, X, CheckCheck, Check, Clock, ArrowDown, MoreHorizontal, Info, UserRound,
  ChevronUp, ChevronDown, Crown, Users, ArrowLeftRight, CornerDownRight, Rows3, Rows2, FileText, ShieldAlert, Map as MapIcon,
} from 'lucide-react';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { IconButton } from '@/components/ui/IconButton';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Segmented } from '@/components/ui/Form';
import { Chip, InstanceStateChip } from '@/components/ui/Chips';
import { Tip } from '@/components/ui/Tip';
import { Splitter, usePaneWidth } from '@/components/ui/Splitter';
import { AGENT_BY_ID } from '@/data/agents';
import { ROLES } from '@/data/roles';
import { getMissionControl, threadKey } from '@/data/missions';
import type { Attachment, Message, MessageKind, Mission } from '@/data/types';
import { useData } from '@/store/data';
import { openDialog, toast } from '@/store/ui';
import { useLive } from './live';
import { clock, cx, dateLabel } from '@/lib/format';
import { filesFrom, type LocalFile } from './files';
import { EvidenceThumb } from './EvidenceThumb';
import { ThreadMinimap } from './ThreadMinimap';

const MINIMAP_KEY = 'axion.thread.minimap';
const readMinimap = () => { try { return localStorage.getItem(MINIMAP_KEY) !== '0'; } catch { return true; } };
const writeMinimap = (v: boolean) => { try { localStorage.setItem(MINIMAP_KEY, v ? '1' : '0'); } catch { /* per-viewer convenience only */ } };

const HUMAN = 'human:owner';
type Relation = 'superior' | 'subordinate' | 'peer' | 'owner';
interface Counterpart { id: string; relation: Relation; }

const KIND_HUE: Record<MessageKind, number> = { delegation: 190, report: 268, consult: 210, command: 30, reply: 40, question: 38, ack: 150, result: 145, system: 225 };

export function useCounterparts(mission: Mission, agentId: string): Counterpart[] {
  return useMemo(() => {
    const mc = getMissionControl(mission);
    const me = mc.nodes.find((n) => n.agentId === agentId);
    if (!me) return [{ id: HUMAN, relation: 'owner' as const }];
    const sup = me.parent ? mc.nodes.find((n) => n.instanceId === me.parent) : undefined;
    const subs = mc.nodes.filter((n) => n.parent === me.instanceId);
    const peersByEdge = mc.edges.filter((e) => (e.kind === 'consults' || e.kind === 'verifies' || e.kind === 'mentors') && (e.from === me.instanceId || e.to === me.instanceId))
      .map((e) => mc.nodes.find((n) => n.instanceId === (e.from === me.instanceId ? e.to : e.from))!).filter(Boolean);
    const out: Counterpart[] = [];
    if (sup) out.push({ id: sup.agentId, relation: 'superior' });
    else out.push({ id: HUMAN, relation: 'owner' });
    subs.forEach((s) => out.push({ id: s.agentId, relation: 'subordinate' }));
    peersByEdge.forEach((p) => { if (!out.some((o) => o.id === p.agentId)) out.push({ id: p.agentId, relation: 'peer' }); });
    if (sup) out.push({ id: HUMAN, relation: 'owner' });
    return out;
  }, [mission, agentId]);
}

const REL_META: Record<Relation, { label: string; icon: typeof Crown; hue: number }> = {
  superior: { label: 'Superior', icon: Crown, hue: 40 },
  subordinate: { label: 'Subordinate', icon: CornerDownRight, hue: 190 },
  peer: { label: 'Peer', icon: ArrowLeftRight, hue: 210 },
  owner: { label: 'You (Owner)', icon: UserRound, hue: 30 },
};

/** Messenger: counterpart directory + thread + command/reply composer (spec §4.4, J-02, J-03). */
export function Messenger({ mission, agentId, layout = 'narrow', onCounterpartChange, initialCounterpart }: {
  mission: Mission; agentId: string; layout?: 'narrow' | 'wide'; onCounterpartChange?: (id: string) => void; initialCounterpart?: string;
}) {
  const a = AGENT_BY_ID[agentId];
  const mc = getMissionControl(mission);
  const node = mc.nodes.find((n) => n.agentId === agentId);
  const cps = useCounterparts(mission, agentId);
  const [cp, setCp] = useState<string>(initialCounterpart && cps.some((c) => c.id === initialCounterpart) ? initialCounterpart : cps[0]?.id ?? HUMAN);
  const [listOpen, setListOpen] = useState(true);
  useEffect(() => { if (!cps.some((c) => c.id === cp)) setCp(cps[0]?.id ?? HUMAN); }, [agentId]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (id: string) => { setCp(id); onCounterpartChange?.(id); };
  const [cpW, setCpW, resetCpW] = usePaneWidth('conv.partners', 270);
  if (!a) return null;

  const directory = (
    <div className={cx('cp-list', layout)} role="listbox" aria-label={`Conversation partners of ${a.name}`}>
      {cps.map((c, i) => <CounterpartItem key={c.id} mission={mission} me={agentId} c={c} selected={c.id === cp} onClick={() => choose(c.id)} index={i} compact={layout === 'narrow'} />)}
    </div>
  );

  return (
    <div className={cx('messenger', layout)}>
      <header className="msg-head">
        <RobotAvatar role={a.role} size={42} faceMode="face" animated status={node?.state === 'working' ? 'good' : node?.state === 'waiting' ? 'warn' : 'info'} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="row" style={{ gap: 6, minWidth: 0 }}><b className="nowrap" style={{ flex: 'none' }}>{a.name}</b>{node && <span className="msg-head-state" style={{ minWidth: 0, overflow: 'hidden' }}><InstanceStateChip state={node.state} size="sm" /></span>}</div>
          <div className="dim ellipsis" style={{ fontSize: 11.5 }}>{ROLES[a.role].label} · instance {mission.id}:{a.id} · {a.version}</div>
        </div>
        <HelpTrigger k="agent.instance" />
        <IconButton icon={Send} label="Send a command with impact preview" size="sm" onClick={() => openDialog('send-command', { missionId: mission.id, agentId })} />
        <IconButton icon={MoreHorizontal} label="Agent instance details" size="sm" onClick={() => openDialog('agent-inspector', { missionId: mission.id, agentId })} />
      </header>
      {layout === 'narrow' ? (
        <div className="cp-wrap">
          <button className="cp-toggle" onClick={() => setListOpen(!listOpen)} aria-expanded={listOpen}>
            <Users size={13} /> Conversation partners ({cps.length}) {listOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          <AnimatePresence initial={false}>
            {listOpen && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>{directory}</motion.div>}
          </AnimatePresence>
        </div>
      ) : null}
      <div className={cx('msg-main', layout)}>
        {layout === 'wide' && <>
          <div className="cp-col" style={{ ['--cp-w' as string]: `${cpW}px` }}><div className="section-label" style={{ padding: '4px 8px 8px' }}>Conversation partners</div>{directory}</div>
          <Splitter pane="prev" width={cpW} onChange={setCpW} onReset={resetCpW} min={170} maxFrac={.4} label="Resize conversation partners" />
        </>}
        <Thread key={agentId + '|' + cp} mission={mission} me={agentId} other={cp} relation={cps.find((c) => c.id === cp)?.relation ?? 'owner'} />
      </div>
    </div>
  );
}

function CounterpartItem({ mission, me, c, selected, onClick, index, compact }: { mission: Mission; me: string; c: Counterpart; selected: boolean; onClick: () => void; index: number; compact: boolean }) {
  const extra = useData((s) => s.extraMessages);
  const base = getMissionControl(mission).threads[threadKey(me, c.id)] ?? [];
  const msgs = [...base, ...(extra[`${mission.id}::${threadKey(me, c.id)}`] ?? [])];
  const last = msgs[msgs.length - 1];
  const other = AGENT_BY_ID[c.id];
  const R = REL_META[c.relation];
  const unread = !selected && last && last.from !== me && (last.kind === 'result' || last.kind === 'question' || last.kind === 'report') ? 1 : 0;
  return (
    <motion.button role="option" aria-selected={selected} className={cx('cp-item', selected && 'selected', compact && 'compact')} onClick={onClick}
      initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * .03 }}>
      {selected && <motion.span layoutId={`cp-sel-${me}-${compact}`} className="cp-sel" transition={{ type: 'spring', stiffness: 480, damping: 40 }} />}
      {other ? <RobotAvatar role={other.role} size={compact ? 30 : 36} /> : <span className="human-av" style={{ width: compact ? 30 : 36, height: compact ? 30 : 36 }}>LU</span>}
      <div style={{ minWidth: 0, flex: 1, position: 'relative' }}>
        <div className="row" style={{ gap: 5 }}>
          <b className="ellipsis" style={{ fontSize: 13 }}>{other?.name ?? 'Luca (You)'}</b>
          <Chip hue={R.hue} size="sm" icon={R.icon}>{R.label}</Chip>
        </div>
        {!compact && <div className="dim ellipsis" style={{ fontSize: 11.5 }}>{last ? `${last.from === me ? 'You: ' : ''}${last.text}` : 'No messages yet'}</div>}
      </div>
      {last && !compact && <span className="dim cp-time" style={{ fontSize: 10.5, position: 'relative' }}>{clock(last.agoMin, last.ts)}</span>}
      {unread > 0 && <span className="badge" style={{ position: 'relative' }}>{unread}</span>}
    </motion.button>
  );
}

/* ------------------------------------------------------------------ */
function Thread({ mission, me, other, relation }: { mission: Mission; me: string; other: string; relation: Relation }) {
  const extra = useData((s) => s.extraMessages);
  const send = useData((s) => s.sendMessage);
  const patch = useData((s) => s.patchMessage);
  const emit = useLive((s) => s.emit);
  const log = useLive((s) => s.log);
  const [view, setView] = useState<'full' | 'compact'>('full');
  const [minimap, setMinimapState] = useState(readMinimap);
  const setMinimap = (v: boolean) => { setMinimapState(v); writeMinimap(v); };
  const [typing, setTyping] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const mc = getMissionControl(mission);
  const base = mc.threads[threadKey(me, other)] ?? [];
  const msgs = useMemo(() => [...base, ...(extra[`${mission.id}::${threadKey(me, other)}`] ?? [])], [base, extra, mission.id, me, other]);
  const shown = view === 'full' ? msgs : msgs.filter((m) => ['delegation', 'report', 'result', 'command', 'question'].includes(m.kind));
  const a = AGENT_BY_ID[me];
  const o = AGENT_BY_ID[other];
  const pendingQ = [...msgs].reverse().find((m) => m.kind === 'question' && m.from === me);
  const readOnly = mission.status === 'archived' || mission.status === 'completed';

  useLayoutEffect(() => { scroller.current?.scrollTo({ top: 1e6 }); }, []);
  const prevLen = useRef(msgs.length);
  useEffect(() => {
    if (msgs.length > prevLen.current) {
      if (atBottom) window.setTimeout(() => scroller.current?.scrollTo({ top: 1e6, behavior: 'smooth' }), 30);
      else setNewCount((n) => n + msgs.length - prevLen.current);
    }
    prevLen.current = msgs.length;
  }, [msgs.length, atBottom]);

  const onSend = (text: string, mode: 'command' | 'reply', attachments: Attachment[]) => {
    const msg = send(mission.id, me, other, { from: HUMAN, to: me, kind: mode, text, attachments, replyTo: mode === 'reply' ? pendingQ?.replyTo ?? pendingQ?.id : undefined });
    log(mission.id, `Luca sent a ${mode} to ${a.name}`, 'command');
    window.setTimeout(() => patch(mission.id, me, other, msg.id, { status: 'delivered' }), 600);
    window.setTimeout(() => setTyping(true), 1100);
    window.setTimeout(() => {
      setTyping(false);
      patch(mission.id, me, other, msg.id, { status: 'acknowledged' });
      const node = mc.nodes.find((n) => n.agentId === me);
      const supNode = node?.parent ? mc.nodes.find((n) => n.instanceId === node.parent) : undefined;
      const sup = supNode ? AGENT_BY_ID[supNode.agentId] : undefined;
      send(mission.id, me, other, { from: me, to: HUMAN, kind: 'ack', text: mode === 'reply'
        ? `Thanks — reply received${pendingQ ? ` for ${pendingQ.replyTo ?? pendingQ.id}` : ''}. I will proceed exactly as you said and not assume any other permission.`
        : `Acknowledged: “${text.slice(0, 70)}${text.length > 70 ? '…' : ''}”. Starting now; I will report to ${sup?.name ?? 'you'} when done.` });
      log(mission.id, `${a.name} acknowledged the ${mode}`, 'ack');
      // report upward after "execution"
      if (supNode && sup) {
        window.setTimeout(() => {
          send(mission.id, me, sup.id, { from: me, to: sup.id, kind: 'report', text: `Report: executed the Owner's ${mode} “${text.slice(0, 60)}${text.length > 60 ? '…' : ''}”. Evidence attached; ready for verification.`, attachments: [{ id: 'ev-' + Date.now(), name: 'execution-evidence.png', kind: 'image', size: '388 KB' }] });
          emit(mission.id, node!.instanceId, supNode.instanceId, 'reports', `${a.name} reported to ${sup.name} (Owner ${mode})`);
          toast({ tone: 'info', title: `${a.name} reported to ${sup.name}`, body: 'Open the superior thread to see the report.' });
        }, 4200);
      }
    }, 2300);
  };

  let lastDay = '';
  return (
    <div className="thread">
      <div className="thread-head">
        <span className="row" style={{ gap: 6, minWidth: 0 }}>
          <b className="ellipsis">{a?.name} ↔ {o?.name ?? 'You'}</b>
          <span className="thread-rel"><Chip hue={REL_META[relation].hue} size="sm">{REL_META[relation].label}</Chip></span>
        </span>
        <span className="spacer" />
        <span className="dim thread-count nowrap" style={{ fontSize: 11 }}>{msgs.length} msgs</span>
        <IconButton size="sm" icon={MapIcon} variant={minimap ? 'active' : 'default'} label={minimap ? 'Hide minimap (times beside the scroll)' : 'Show minimap (times beside the scroll)'} onClick={() => setMinimap(!minimap)} aria-pressed={minimap} className="thread-mm-toggle" />
        <span className="thread-mm-toggle"><HelpTrigger k="thread.minimap" /></span>
        <Segmented ariaLabel="Thread view" size="sm" value={view} onChange={setView} options={[{ key: 'full', label: <><Rows3 size={12} />Full</>, title: 'Verbatim events' }, { key: 'compact', label: <><Rows2 size={12} />Compact</>, title: 'Assignment → report → outcome' }]} />
      </div>
      <div className={cx('thread-scroll', minimap && 'with-minimap')}>
      <div className="thread-body" ref={scroller} onScroll={(e) => { const el = e.currentTarget; const b = el.scrollHeight - el.scrollTop - el.clientHeight < 40; setAtBottom(b); if (b) setNewCount(0); }} role="log" aria-label="Conversation" aria-live="polite">
        {shown.length === 0 && <div className="empty" style={{ padding: 30 }}><div className="empty-icon"><Send size={22} /></div><h4>No messages yet</h4><p>Send a command to start this conversation.</p></div>}
        <AnimatePresence initial={false}>
          {shown.map((m) => {
            const day = dateLabel(m.agoMin, m.ts);
            const sep = day !== lastDay ? (lastDay = day) : null;
            return (
              <div key={m.id} data-mid={m.id}>
                {sep && <div className="day-sep"><span>{sep}</span></div>}
                <Bubble m={m} me={me} compact={view === 'compact'} missionId={mission.id} />
              </div>
            );
          })}
        </AnimatePresence>
        <AnimatePresence>
          {typing && (
            <motion.div className="typing" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <RobotAvatar role={a.role} size={22} /> {a.name} is composing <span className="dots"><i /><i /><i /></span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {minimap && <ThreadMinimap scroller={scroller} msgs={shown} me={me} kindHue={KIND_HUE} deps={`${shown.length}:${view}:${typing}:${other}`} />}
      </div>
      <AnimatePresence>
        {newCount > 0 && (
          <motion.button className="new-pill" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} onClick={() => { scroller.current?.scrollTo({ top: 1e6, behavior: 'smooth' }); setNewCount(0); }}>
            <ArrowDown size={13} /> {newCount} new
          </motion.button>
        )}
      </AnimatePresence>
      <Composer agentName={a.name} disabled={readOnly} pendingQ={pendingQ} onSend={onSend} missionId={mission.id} agentId={me} />
    </div>
  );
}

function Bubble({ m, me, compact, missionId }: { m: Message; me: string; compact: boolean; missionId?: string }) {
  const human = m.from.startsWith('human:');
  const mine = m.from === me;
  const author = AGENT_BY_ID[m.from];
  const side = human ? 'right human' : mine ? 'right' : 'left';
  return (
    <motion.div className={cx('bubble-row', side)} layout initial={{ opacity: 0, y: 10, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .25 }}>
      {!human && !mine && author && <RobotAvatar role={author.role} size={28} />}
      <div className={cx('bubble', `k-${m.kind}`, compact && 'compact')}>
        <div className="bubble-meta">
          <span className="chip sm" style={{ ['--h' as string]: KIND_HUE[m.kind] }}>{human ? 'HUMAN · ' : ''}{m.kind.toUpperCase()}</span>
          <b>{human ? 'Luca' : author?.name}</b>
          <span className="dim">{clock(m.agoMin, m.ts)}</span>
          {m.taskId && <span className="mono dim">{m.taskId}</span>}
          <button className="bubble-more" aria-label="Message details" onClick={() => openDialog('message-details', { message: m })}><Info size={12} /></button>
        </div>
        <div className="bubble-text">{m.text}</div>
        {m.attachments && m.attachments.length > 0 && (
          <div className="bubble-atts">
            {m.attachments.map((at) => (
              <button key={at.id} className="att" onClick={() => openDialog('attachment-preview', { attachment: at })} aria-label={`Open ${at.name}`}>
                {at.url ? <img src={at.url} alt={at.name} /> : at.kind === 'image' ? <EvidenceThumb seed={at.name} /> : <FileText size={20} />}
                <span className="ellipsis">{at.name}</span>
              </button>
            ))}
          </div>
        )}
        {human && (
          <div className="bubble-status" aria-label={`Status: ${m.status ?? 'sent'}`}>
            {m.status === 'acknowledged' ? <><CheckCheck size={13} className="good" /> acknowledged</> : m.status === 'delivered' ? <><CheckCheck size={13} /> delivered</> : m.status === 'queued' ? <><Clock size={12} /> queued</> : <><Check size={13} /> sent</>}
          </div>
        )}
        {m.kind === 'question' && (
          <div className="row warn" style={{ gap: 5, fontSize: 11.5, marginTop: 4 }}>
            <ShieldAlert size={12} />Waiting for your reply · {m.replyTo ?? m.id}
            {missionId && <button className="btn sm" style={{ marginLeft: 'auto', height: 24 }} onClick={() => openDialog('send-command', { missionId, agentId: m.from, mode: 'reply', replyTo: m.replyTo ?? m.id, question: m.text })}>Reply…</button>}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export { EvidenceThumb };

/* ------------------------------------------------------------------ */
function Composer({ agentName, disabled, pendingQ, onSend, missionId, agentId }: { agentName: string; disabled: boolean; pendingQ?: Message; onSend: (text: string, mode: 'command' | 'reply', att: Attachment[]) => void; missionId: string; agentId: string }) {
  const draftKey = `axion.draft.${missionId}.${agentId}`;
  const [mode, setMode] = useState<'command' | 'reply'>(pendingQ ? 'reply' : 'command');
  const [text, setText] = useState(() => { try { return localStorage.getItem(draftKey) ?? ''; } catch { return ''; } });
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [over, setOver] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const imgIn = useRef<HTMLInputElement>(null);

  useEffect(() => { try { if (text) localStorage.setItem(draftKey, text); else localStorage.removeItem(draftKey); } catch { /* ignore */ } }, [text, draftKey]);
  useLayoutEffect(() => { const el = ta.current; if (el) { el.style.height = '0px'; el.style.height = Math.min(140, el.scrollHeight) + 'px'; } }, [text]);

  const submit = () => {
    if (disabled || (!text.trim() && !files.length)) return;
    onSend(text.trim() || '(attachment)', mode, files.map((f) => ({ id: f.id, name: f.name, kind: f.type.startsWith('image/') ? 'image' : 'file', url: f.url, size: `${(f.size / 1024).toFixed(0)} KB` })));
    setText(''); setFiles([]);
  };

  if (disabled) return <div className="composer disabled"><Info size={14} /> This mission is closed — conversations are read-only.</div>;

  return (
    <div className={cx('composer', over && 'over')} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); setFiles([...files, ...filesFrom(e.dataTransfer.files)]); }}>
      <div className="row" style={{ gap: 8, marginBottom: 6 }}>
        <Segmented ariaLabel="Message mode" size="sm" value={mode} onChange={setMode} options={[{ key: 'command', label: 'Command' }, { key: 'reply', label: 'Reply' }]} />
        <HelpTrigger k={mode === 'command' ? 'conversation.command' : 'conversation.reply'} />
        <span className="dim ellipsis" style={{ fontSize: 11.5 }}>To <b style={{ color: 'var(--text-2)' }}>{agentName}</b>{mode === 'reply' && pendingQ ? ` · re ${pendingQ.replyTo ?? pendingQ.id}` : ''}</span>
      </div>
      {mode === 'reply' && !pendingQ && <div className="dim" style={{ fontSize: 11.5, marginBottom: 6 }}>No open question from {agentName} — your reply is recorded as a general answer.</div>}
      <AnimatePresence>
        {files.length > 0 && (
          <motion.div className="composer-files" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            {files.map((f) => (
              <motion.span key={f.id} className="cf" layout initial={{ scale: .7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                {f.url ? <img src={f.url} alt={f.name} /> : <FileText size={16} />}
                <span className="ellipsis">{f.name}</span>
                <button aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x.id !== f.id))}><X size={11} /></button>
              </motion.span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="composer-box">
        <textarea
          ref={ta}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}
          onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); setFiles([...files, ...filesFrom(e.clipboardData.files)]); } }}
          placeholder={mode === 'command' ? `Give ${agentName} an instruction… (Ctrl+Enter to send)` : `Reply to ${agentName}… (paste a screenshot with Ctrl+V)`}
          aria-label={mode === 'command' ? 'Command' : 'Reply'}
        />
        <div className="row" style={{ gap: 2 }}>
          <IconButton icon={Paperclip} label="Attach file" size="sm" onClick={() => fileIn.current?.click()} />
          <IconButton icon={ImageIcon} label="Attach image / screenshot" size="sm" onClick={() => imgIn.current?.click()} />
          <IconButton icon={AtSign} label="Mention agent" size="sm" onClick={() => { setText((t) => t + (t.endsWith(' ') || !t ? '' : ' ') + '@'); ta.current?.focus(); }} />
          <span className="spacer" />
          <Tip label="Send" shortcut="Ctrl Enter">
            <motion.button className="send-btn" onClick={submit} disabled={!text.trim() && !files.length} whileTap={{ scale: .9 }} aria-label="Send message">
              <Send size={16} />
            </motion.button>
          </Tip>
        </div>
        <input ref={fileIn} type="file" multiple hidden onChange={(e) => { if (e.target.files) setFiles([...files, ...filesFrom(e.target.files)]); e.target.value = ''; }} />
        <input ref={imgIn} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) setFiles([...files, ...filesFrom(e.target.files)]); e.target.value = ''; }} />
      </div>
    </div>
  );
}
