import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Send, MoreHorizontal, UserRound,
  ChevronUp, ChevronDown, Crown, Users, ArrowLeftRight, CornerDownRight } from 'lucide-react';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { IconButton } from '@/components/ui/IconButton';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Chip, InstanceStateChip } from '@/components/ui/Chips';
import { Splitter, usePaneWidth } from '@/components/ui/Splitter';
import { AGENT_BY_ID } from '@/data/agents';
import { ROLES } from '@/data/roles';
import { getMissionControl, threadKey } from '@/data/missions';
import type { Attachment, Mission } from '@/data/types';
import { useData } from '@/store/data';
import { openDialog, toast } from '@/store/ui';
import { isApi } from '@/api/mode';
import { HUMAN, useMissionControl, findThread, openThread, loadOlder, sendMissionMessage, partState, retryPart } from '@/api/missionControl';
import { useLive } from './live';
import { clock, cx } from '@/lib/format';
import { EvidenceThumb } from './EvidenceThumb';
import { ChatThreadView, ChatComposer } from '@/features/chat/ChatView';
import { useMe } from '@/store/auth';

type Relation = 'superior' | 'subordinate' | 'peer' | 'owner';
interface Counterpart { id: string; relation: Relation; }

export function useCounterparts(mission: Mission, agentId: string): Counterpart[] {
  const entry = useMissionControl(mission.id, ['hierarchy']);
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
  }, [mission, agentId, entry?.nodes, entry?.edges]); // eslint-disable-line react-hooks/exhaustive-deps
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
  useMissionControl(mission.id);
  const mc = getMissionControl(mission);
  const node = mc.nodes.find((n) => n.agentId === agentId);
  const cps = useCounterparts(mission, agentId);
  const [cp, setCp] = useState<string>(initialCounterpart && cps.some((c) => c.id === initialCounterpart) ? initialCounterpart : cps[0]?.id ?? HUMAN);
  const [listOpen, setListOpen] = useState(true);
  useEffect(() => { if (!cps.some((c) => c.id === cp)) setCp(cps[0]?.id ?? HUMAN); }, [agentId]); // eslint-disable-line react-hooks/exhaustive-deps
  // api mode: the partners are known once the server's hierarchy arrives; until the reader picks one, follow the default
  const picked = useRef(false);
  const first = cps[0]?.id ?? HUMAN;
  useEffect(() => { if (isApi() && !picked.current && !(initialCounterpart && cps.some((c) => c.id === initialCounterpart))) setCp(first); }, [first]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (id: string) => { picked.current = true; setCp(id); onCounterpartChange?.(id); };
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
          <div className="dim ellipsis" style={{ fontSize: 11.5 }}>{ROLES[a.role].label} · instance {node?.instanceId ?? `${mission.id}:${a.id}`} · {node?.versionLabel ?? a.version}</div>
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
        <Thread key={agentId + '|' + cp} mission={mission} me={agentId} other={cp} relation={cps.find((c) => c.id === cp)?.relation ?? 'owner'} onRedirect={choose} />
      </div>
    </div>
  );
}

function CounterpartItem({ mission, me, c, selected, onClick, index, compact }: { mission: Mission; me: string; c: Counterpart; selected: boolean; onClick: () => void; index: number; compact: boolean }) {
  const extra = useData((s) => s.extraMessages);
  const base = getMissionControl(mission).threads[threadKey(me, c.id)] ?? [];
  const msgs = isApi() ? base : [...base, ...(extra[`${mission.id}::${threadKey(me, c.id)}`] ?? [])];
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
          <b className="ellipsis" style={{ fontSize: 13 }}>{other?.name ?? 'You'}</b>
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
function Thread({ mission, me, other, relation, onRedirect }: { mission: Mission; me: string; other: string; relation: Relation; onRedirect?: (id: string) => void }) {
  const extra = useData((s) => s.extraMessages);
  const send = useData((s) => s.sendMessage);
  const patch = useData((s) => s.patchMessage);
  const emit = useLive((s) => s.emit);
  const log = useLive((s) => s.log);
  const user = useMe();
  const [typing, setTyping] = useState(false);
  const api = isApi();
  const entry = useMissionControl(mission.id);
  const th = api ? findThread(entry, threadKey(me, other)) : undefined;
  // a failed load is not retried here (that was a tight loop): openThread retries with backoff, on reconnect, and on Retry
  useEffect(() => { if (th && !th.messages && !th.loading && !th.error) void openThread(mission.id, th.id); }, [mission.id, th?.id, th?.messages, th?.loading, th?.error]); // eslint-disable-line react-hooks/exhaustive-deps
  const partners = api ? partState(entry, 'threads') : 'ready';
  const mc = getMissionControl(mission);
  const base = mc.threads[threadKey(me, other)] ?? [];
  const msgs = useMemo(() => (api ? th?.messages ?? [] : [...base, ...(extra[`${mission.id}::${threadKey(me, other)}`] ?? [])]), [api, th?.messages, base, extra, mission.id, me, other]);
  const a = AGENT_BY_ID[me];
  const o = AGENT_BY_ID[other];
  const pendingQ = [...msgs].reverse().find((m) => m.kind === 'question' && m.from === me);
  const readOnly = mission.status === 'archived' || mission.status === 'completed';
  const who = user?.name ?? 'You';

  /**
   * api mode: one path to the server. People only write in their own thread with an agent (Task 3 ruling): under an
   * agent↔agent thread the message goes there, and the view follows once it is stored. Resolves false when it was not
   * sent, so the composer puts the draft back.
   */
  const apiSend = async (text: string, mode: 'command' | 'reply', attachments: Attachment[]): Promise<boolean> => {
    if (!user) return false;
    const replyTo = mode === 'reply' ? pendingQ?.replyTo ?? pendingQ?.id : undefined;
    const r = await sendMissionMessage(mission, me, { kind: mode, text, attachments, replyTo }, user);
    if (r.ok) {
      log(mission.id, `${who} sent a ${mode} to ${a.name}`, 'command');
      if (other !== HUMAN) {
        onRedirect?.(HUMAN);
        toast({ tone: 'info', title: `Sent to your conversation with ${a.name}`, body: `${a.name} ↔ ${o?.name ?? 'agent'} is between agents and read-only for people, so your ${mode} went to your own thread with ${a.name}.` });
      }
      return true;
    }
    // gone: the Missions page leaves the mission with its own toast; elsewhere (a dialog) say it here
    if (!r.gone) toast({ tone: 'error', title: 'Not sent', body: `${r.message} Your message is back in the box.` });
    else if (!window.location.pathname.startsWith(`/missions/${mission.id}`)) toast({ tone: 'warning', title: `${mission.id} is no longer available`, body: 'Its owner made it private, or it was deleted. Your message was not sent.' });
    return false;
  };

  const onSend = (text: string, modeKey: string, attachments: Attachment[]) => {
    const mode = modeKey as 'command' | 'reply';
    if (api) return apiSend(text, mode, attachments);
    // the thread stays keyed to the human side (HUMAN); the author is the signed-in user
    const msg = send(mission.id, me, other, { from: user ? `human:${user.id}` : HUMAN, to: me, kind: mode, text, attachments, replyTo: mode === 'reply' ? pendingQ?.replyTo ?? pendingQ?.id : undefined });
    log(mission.id, `${who} sent a ${mode} to ${a.name}`, 'command');
    window.setTimeout(() => patch(mission.id, me, other, msg.id, { status: 'delivered' }), 600);
    window.setTimeout(() => setTyping(true), 1100);
    window.setTimeout(() => {
      setTyping(false);
      patch(mission.id, me, other, msg.id, { status: 'acknowledged' });
      const node = mc.nodes.find((n) => n.agentId === me);
      const supNode = node?.parent ? mc.nodes.find((n) => n.instanceId === node.parent) : undefined;
      const sup = supNode ? AGENT_BY_ID[supNode.agentId] : undefined;
      send(mission.id, me, other, { from: me, to: msg.from, kind: 'ack', text: mode === 'reply'
        ? `Thanks — reply received${pendingQ ? ` for ${pendingQ.replyTo ?? pendingQ.id}` : ''}. I will proceed exactly as you said and not assume any other permission.`
        : `Acknowledged: “${text.slice(0, 70)}${text.length > 70 ? '…' : ''}”. Starting now; I will report to ${sup?.name ?? 'you'} when done.` });
      log(mission.id, `${a.name} acknowledged the ${mode}`, 'ack');
      // report upward after "execution"
      if (supNode && sup) {
        window.setTimeout(() => {
          send(mission.id, me, sup.id, { from: me, to: sup.id, kind: 'report', text: `Report: executed ${who}'s ${mode} “${text.slice(0, 60)}${text.length > 60 ? '…' : ''}”. Evidence attached; ready for verification.`, attachments: [{ id: 'ev-' + Date.now(), name: 'execution-evidence.png', kind: 'image', size: '388 KB' }] });
          emit(mission.id, node!.instanceId, supNode.instanceId, 'reports', `${a.name} reported to ${sup.name} (${who}'s ${mode})`);
          toast({ tone: 'info', title: `${a.name} reported to ${sup.name}`, body: 'Open the superior thread to see the report.' });
        }, 4200);
      }
    }, 2300);
  };

  return (
    <ChatThreadView
      title={<><b className="ellipsis">{a?.name} ↔ {o?.name ?? 'You'}</b><span className="thread-rel"><Chip hue={REL_META[relation].hue} size="sm">{REL_META[relation].label}</Chip></span></>}
      messages={msgs} isRight={(m) => m.from.startsWith('human:') || m.from === me} mmMe={me}
      typing={typing ? { name: a.name, role: a.role } : null} missionId={mission.id}
      compactFilter={(m) => ['delegation', 'report', 'result', 'command', 'question'].includes(m.kind)}
      emptyState={th?.error || (!th && partners === 'error') ? 'error' : th?.loading || (!th && partners === 'loading') ? 'loading' : undefined}
      emptyTitle={th?.error || (!th && partners === 'error') ? 'Could not load this conversation' : th?.loading || (!th && partners === 'loading') ? 'Loading the conversation…' : undefined}
      emptyText={th?.error ? <>{th.error} <button className="btn sm" onClick={() => void openThread(mission.id, th.id, true)}>Retry</button></>
        : !th && partners === 'error' ? <>{entry?.errors?.threads} <button className="btn sm" onClick={() => retryPart(mission.id, 'threads')}>Retry</button></>
        : th?.loading || (!th && partners === 'loading') ? 'One moment.' : 'Send a command to start this conversation.'}
      hasOlder={th?.hasMore} loadingOlder={th?.loadingOlder} onLoadOlder={th ? () => void loadOlder(mission.id, th.id) : undefined} total={th ? Math.max(th.count, msgs.length) : undefined}
      composer={<ChatComposer key={me + other} toName={a.name} draftKey={`axion.draft.${mission.id}.${me}`} disabled={readOnly} disabledText="This mission is closed — conversations are read-only."
        initialMode={pendingQ ? 'reply' : 'command'}
        modes={[
          { key: 'command', label: 'Command', help: 'conversation.command', placeholder: `Give ${a.name} an instruction… (Ctrl+Enter to send)` },
          { key: 'reply', label: 'Reply', help: 'conversation.reply', placeholder: `Reply to ${a.name}… (paste a screenshot with Ctrl+V)` },
        ]}
        hint={(mode) => (mode === 'reply' ? (pendingQ ? <div className="dim" style={{ fontSize: 11.5, marginBottom: 6 }}>Re {pendingQ.replyTo ?? pendingQ.id}</div> : <div className="dim" style={{ fontSize: 11.5, marginBottom: 6 }}>No open question from {a.name} — your reply is recorded as a general answer.</div>) : null)}
        onSend={onSend} />}
    />
  );
}

export { EvidenceThumb };
