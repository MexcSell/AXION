import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Newspaper, Plus, Search, ExternalLink, Target, Pin, Trash2, Radar, Loader2, Link2, Users, Bot, Check, X, Ban, UserPlus } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Chip } from '@/components/ui/Chips';
import { Tip } from '@/components/ui/Tip';
import { IconButton } from '@/components/ui/IconButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Segmented, Field } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { AGENT_BY_ID } from '@/data/agents';
import { useNews, domainOf, type NewsItem } from '@/store/news';
import { useAuth, useMe, isAdmin, usePendingApprovals } from '@/store/auth';
import { openDialog, toast } from '@/store/ui';
import { agoFromTs, cx } from '@/lib/format';
import { DEVICE_ICON } from '@/features/settings/UsersSettings';
import '@/theme/pages/news.css';
import '@/theme/pages/users-settings.css';

/** Notifications › News (owner update 2026-11-20 u1): posts from users, URLs and content from search & research agents. */
export function NewsTab() {
  const items = useNews((s) => s.items);
  const [src, setSrc] = useState<'all' | 'user' | 'agent'>('all');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);
  const list = useMemo(() => [...items].filter((n) => (src === 'all' || n.source.kind === src) && (!q || (n.title + n.content + n.tags.join(' ') + (n.url ?? '')).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.at - a.at), [items, src, q]);
  const scan = () => {
    setScanning(true);
    window.setTimeout(() => {
      setScanning(false);
      const n = useNews.getState().scan();
      toast(n ? { tone: 'success', title: `${AGENT_BY_ID[(n.source as { agentId: string }).agentId]?.name ?? 'An agent'} found news`, body: n.title } : { tone: 'info', title: 'Nothing new right now', body: 'The research agents found no new URLs since the last scan.' });
    }, 1800);
  };
  return (
    <div className="news">
      <div className="news-bar">
        <Segmented ariaLabel="News source" size="sm" value={src} onChange={setSrc} options={[{ key: 'all', label: 'All' }, { key: 'user', label: <><Users size={13} />Users</> }, { key: 'agent', label: <><Bot size={13} />Agents</> }]} />
        <div className="input-wrap" style={{ width: 240 }}><Search size={15} /><input className="input" placeholder="Search news…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search news" /></div>
        <span className="spacer" />
        <Tip label="Researcher-01, Browser-01 and Knowledge-01 look for new URLs and content"><button className="btn" onClick={scan} disabled={scanning}>{scanning ? <><Loader2 size={15} className="spin" />Agents searching…</> : <><Radar size={15} />Ask agents to search</>}</button></Tip>
        <button className="btn primary" onClick={() => setAdding(true)}><Plus size={15} />Add news</button>
      </div>
      <div className="news-grid">
        <AnimatePresence initial={false}>
          {scanning && (
            <motion.div key="scan" className="news-card scanning glass-card" initial={{ opacity: 0, scale: .95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
              <div className="news-radar"><span /><span /><RobotAvatar role="research" size={44} animated /></div>
              <b>Searching sources…</b><span className="dim" style={{ fontSize: 12 }}>Only granted, public sites are read.</span>
            </motion.div>
          )}
          {list.map((n, i) => <NewsCard key={n.id} n={n} i={i} />)}
        </AnimatePresence>
        {list.length === 0 && !scanning && <EmptyState icon={Newspaper} title="No news" body="Add news yourself, or ask the agents to search." />}
      </div>
      {adding && <AddNews close={() => setAdding(false)} />}
    </div>
  );
}

function NewsCard({ n, i }: { n: NewsItem; i: number }) {
  const me = useMe();
  const author = useAuth((s) => (n.source.kind === 'user' ? s.accounts.find((a) => a.id === (n.source as { userId: string }).userId) : undefined));
  const agent = n.source.kind === 'agent' ? AGENT_BY_ID[n.source.agentId] : undefined;
  const mine = n.source.kind === 'user' && n.source.userId === me?.id;
  const d = domainOf(n.url);
  return (
    <motion.article className={cx('news-card glass-card hoverable', n.pinned && 'pinned', n.source.kind)} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: .95 }} transition={{ delay: Math.min(i, 10) * .035 }}>
      <div className="news-src">
        {agent ? <RobotAvatar role={agent.role} size={30} /> : <UserAvatar account={author} size={28} />}
        <div className="col" style={{ minWidth: 0, flex: 1 }}><b className="ellipsis" style={{ fontSize: 12.5 }}>{agent?.name ?? author?.name ?? 'User'}</b><span className="dim" style={{ fontSize: 11 }}>{agent ? 'research agent' : 'user'} · {agoFromTs(n.at)}</span></div>
        {n.pinned && <Pin size={13} className="warn" />}
      </div>
      <h3 className="news-title">{n.title}</h3>
      {d && <a className="news-url" href={n.url} target="_blank" rel="noopener noreferrer"><Link2 size={12} />{d}<ExternalLink size={11} /></a>}
      <p className="news-body">{n.content}</p>
      <div className="row wrap" style={{ gap: 4 }}>{n.tags.map((t) => <Chip key={t} hue={200} size="sm">{t}</Chip>)}</div>
      <div className="news-actions">
        <Tip label="Turn this into a mission"><button className="btn ghost sm" onClick={() => openDialog('mission-create', { text: `${n.title}${n.url ? ` (${n.url})` : ''}. ${n.content}` })}><Target size={13} />Mission</button></Tip>
        <span className="spacer" />
        <IconButton size="xs" icon={Pin} label={n.pinned ? 'Unpin' : 'Pin to top'} onClick={() => useNews.getState().togglePin(n.id)} />
        {(mine || isAdmin(me)) && <IconButton size="xs" icon={Trash2} label="Remove" onClick={() => { useNews.getState().remove(n.id); toast({ tone: 'info', title: 'News removed' }); }} />}
      </div>
    </motion.article>
  );
}

function AddNews({ close }: { close: () => void }) {
  const me = useMe();
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const [touched, setTouched] = useState(false);
  const urlErr = url.trim() && !/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(url.trim()) ? 'Enter a full http(s):// address' : '';
  const err = !title.trim() ? 'A title is required' : !content.trim() && !url.trim() ? 'Add a link or some content' : urlErr;
  const save = () => {
    setTouched(true);
    if (err || !me) return;
    useNews.getState().add({ title: title.trim(), url: url.trim() || undefined, content: content.trim(), tags: tags.split(',').map((t) => t.trim()).filter(Boolean), source: { kind: 'user', userId: me.id } });
    toast({ tone: 'success', title: 'News posted', body: 'Every user sees it in Notifications › News.' });
    close();
  };
  return (
    <Modal title="Add news" icon={Newspaper} help="nt.news" size="md" onClose={close} footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" onClick={save}><Plus size={14} />Post</button></>}>
      <div className="col" style={{ gap: 12 }}>
        <Field label="Title" required error={touched && !title.trim() ? 'A title is required' : undefined}><input className="input" data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What happened?" /></Field>
        <Field label="Link" error={urlErr || undefined} hint="Optional. The research agents can open it later."><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></Field>
        <Field label="Content" error={touched && !content.trim() && !url.trim() ? 'Add a link or some content' : undefined}><textarea className="textarea" rows={4} value={content} onChange={(e) => setContent(e.target.value)} placeholder="A short summary for everyone" /></Field>
        <Field label="Tags" hint="Comma separated"><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="market, models" /></Field>
      </div>
    </Modal>
  );
}

/** Pending › new users and new devices (administrators only). */
export function UserRequests() {
  const me = useMe();
  const { users, devices } = usePendingApprovals();
  const { approveUser, rejectUser, approveDevice, blockDevice } = useAuth();
  if (!isAdmin(me) || !me) return null;
  return (
    <Panel icon={UserPlus} title={<>New users & devices <span className="dim" style={{ fontSize: 13, fontWeight: 500 }}>({users.length + devices.length})</span></>} help="settings.users.approvals" delay={.08}>
      {users.length + devices.length === 0 ? <EmptyState icon={Check} title="No one is waiting" body="New sign-ups and new devices appear here and in Settings › Users." /> : (
        <div className="col" style={{ gap: 6 }}>
          <AnimatePresence initial={false}>
            {users.map((u) => (
              <motion.div key={u.id} layout className="us-req" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 20 }}>
                <span className="us-req-pulse" /><UserAvatar account={u} size={32} ring="warn" />
                <div className="grow" style={{ minWidth: 0 }}><b className="ellipsis">{u.name}</b><div className="dim" style={{ fontSize: 11.5 }}>new user · {agoFromTs(u.createdAt)}</div></div>
                <IconButton size="sm" variant="danger" icon={X} label={`Decline ${u.name}`} onClick={() => rejectUser(u.id, me.id)} />
                <button className="btn good sm" onClick={() => { approveUser(u.id, me.id); toast({ tone: 'success', title: `${u.name} approved` }); }}><Check size={14} />Approve</button>
              </motion.div>
            ))}
            {devices.map(({ account: a, device: d }) => { const I = DEVICE_ICON[d.kind]; return (
              <motion.div key={a.id + d.id} layout className="us-req" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 20 }}>
                <span className="us-req-pulse" /><span className="us-dev-ico"><I size={16} /></span>
                <div className="grow" style={{ minWidth: 0 }}><b className="ellipsis">{d.name}</b><div className="dim" style={{ fontSize: 11.5 }}>new device · {a.name}</div></div>
                <IconButton size="sm" variant="danger" icon={Ban} label={`Block ${d.name}`} onClick={() => blockDevice(a.id, d.id)} />
                <button className="btn good sm" onClick={() => { approveDevice(a.id, d.id); toast({ tone: 'success', title: `${d.name} approved for ${a.name}` }); }}><Check size={14} />Approve</button>
              </motion.div>
            ); })}
          </AnimatePresence>
        </div>
      )}
    </Panel>
  );
}
