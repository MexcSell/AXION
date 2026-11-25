import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Crown, ShieldCheck, MessagesSquare, X, Minus, Maximize2, Plus, Target, ChevronLeft } from 'lucide-react';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { IconButton } from '@/components/ui/IconButton';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { AGENTS, AGENT_BY_ID } from '@/data/agents';
import { useAuth, useMe } from '@/store/auth';
import { channelId } from '@/store/chat';
import { useUI } from '@/store/ui';
import { useVisibleMissions } from '@/store/data';
import { ChannelChat } from './ChannelChat';
import { cx } from '@/lib/format';
import { channelPath, retryChannels, useChannelList } from '@/api/chat';

export function ChatDock() {
  const open = useUI((s) => s.chat.open);
  const channel = useUI((s) => s.chat.channel);
  const openChat = useUI((s) => s.openChat);
  const closeChat = useUI((s) => s.closeChat);
  const me = useMe();
  const { list: channels, listError } = useChannelList();
  const list = channels ?? [];
  const accounts = useAuth((s) => s.accounts);
  const missions = useVisibleMissions();
  const nav = useNavigate();
  const [min, setMin] = useState(false);
  const [showList, setShowList] = useState(false);
  const [pick, setPick] = useState('');
  if (!me) return null;
  const cur = channel && channelPath(channel, me.id) ? channel : channelId.gm(me.id);
  const company = list.filter((c) => (c.kind === 'gm' || c.kind === 'admin') && c.userId === me.id);
  const fromUsers = list.filter((c) => c.kind === 'admin' && c.userId !== me.id);
  const agents = list.filter((c) => c.kind === 'agent');
  const asks = missions.filter((m) => m.pendingApprovals > 0 && m.status !== 'archived').slice(0, 3);

  const Item = ({ c }: { c: (typeof list)[number] }) => {
    const ag = c.agentId ? AGENT_BY_ID[c.agentId] : undefined;
    const user = accounts.find((a) => a.id === c.userId);
    const ttl = c.kind === 'gm' ? 'General Manager' : c.kind === 'admin' ? (c.userId === me.id ? 'Administrators' : user?.name ?? c.userName ?? 'User') : ag?.name ?? 'Agent';
    const sub = c.last ? c.last.text : c.kind === 'gm' ? 'General Manager conversation' : c.kind === 'admin' ? (c.userId === me.id ? 'Access, devices, problems' : 'wrote to the administrators') : ag?.description ?? '';
    return (
      <button className={cx('chat-ch', cur === c.id && 'on')} onClick={() => { openChat(c.id); setShowList(false); }} aria-current={cur === c.id || undefined}>
        {c.kind === 'admin' ? (c.userId === me.id ? <span className="nav-set-ico" style={{ width: 30, height: 30 }}><ShieldCheck size={16} /></span> : <UserAvatar account={user} size={30} />) : <RobotAvatar role={ag?.role ?? 'manager'} size={32} />}
        <span className="col" style={{ minWidth: 0, flex: 1 }}><span className="ttl ellipsis">{ttl}{c.kind === 'gm' && <Crown size={11} className="warn" style={{ marginLeft: 4, display: 'inline' }} />}</span><span className="sub ellipsis">{sub}</span></span>
        {c.unread > 0 && <span className="badge">{c.unread}</span>}
      </button>
    );
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className={cx('chat-dock', min && 'min', showList && 'list-open')} role="dialog" aria-label="Chat" data-dialog="chat-dock"
          initial={{ opacity: 0, y: -14, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: .97 }} transition={{ duration: .22, ease: [0.2, 0.8, 0.2, 1] }}
          onKeyDown={(e) => { if (e.key === 'Escape') closeChat(); }}>
          {!min && (
            <aside className="chat-dock-list" aria-label="Conversations">
              <div className="chat-dock-head"><MessagesSquare size={17} className="info" />Chat<HelpTrigger k="chat.dock" /></div>
              <div className="chat-dock-items">
                {listError && <div role="alert">{listError} <button className="btn sm" onClick={retryChannels}>Retry</button></div>}
                <div className="chat-dock-sec">Company</div>
                {company.map((c) => <Item key={c.id} c={c} />)}
                {fromUsers.length > 0 && <><div className="chat-dock-sec">Users → administrators</div>{fromUsers.map((c) => <Item key={c.id} c={c} />)}</>}
                <div className="chat-dock-sec">Agents</div>
                {agents.length === 0 && <div className="dim" style={{ fontSize: 11.5, padding: '2px 8px' }}>Start a chat with any agent below.</div>}
                {agents.map((c) => <Item key={c.id} c={c} />)}
                {asks.length > 0 && <><div className="chat-dock-sec">Missions waiting for you</div>{asks.map((m) => (
                  <button key={m.id} className="chat-ch" onClick={() => { nav(`/missions/${m.id}?tab=conversations`); }}>
                    <span className="nav-set-ico" style={{ width: 30, height: 30 }}><Target size={15} /></span>
                    <span className="col" style={{ minWidth: 0, flex: 1 }}><span className="ttl ellipsis">{m.id}</span><span className="sub ellipsis">{m.title}</span></span>
                    <span className="badge">{m.pendingApprovals}</span>
                  </button>
                ))}</>}
              </div>
              <div className="chat-new">
                <select className="select" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Start a chat with an agent">
                  <option value="">Chat with an agent…</option>
                  {AGENTS.filter((a) => a.id !== 'gm').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <IconButton size="sm" variant="active" icon={Plus} label="Open chat" disabled={!pick} onClick={() => { openChat(channelId.agent(pick, me.id)); setPick(''); setShowList(false); }} />
              </div>
            </aside>
          )}
          <div className="chat-dock-main">
            <div className="row" style={{ gap: 4, padding: '6px 8px 0', justifyContent: 'flex-end' }}>
              {!min && <IconButton size="xs" icon={ChevronLeft} label="Conversations" className="mobile-only" onClick={() => setShowList(!showList)} />}
              <span className="spacer" />
              <IconButton size="xs" icon={min ? Maximize2 : Minus} label={min ? 'Restore chat' : 'Minimize chat'} onClick={() => setMin(!min)} />
              <IconButton size="xs" icon={X} label="Close chat" onClick={closeChat} />
            </div>
            {!min && <ChannelChat key={cur} channel={cur} compact className="dock-thread" />}
            {min && <button className="chat-ch on" style={{ margin: 8, width: 'auto' }} onClick={() => setMin(false)}><MessagesSquare size={16} /><span className="ttl">Chat · {list.reduce((s, c) => s + c.unread, 0)} unread</span></button>}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
