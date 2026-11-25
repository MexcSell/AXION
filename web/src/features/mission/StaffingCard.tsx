import '@/theme/pages/mission-activity.css';
import { AnimatePresence, motion } from 'motion/react';
import { Crown, Loader2, CheckCircle2, UserPlus, BookOpen, OctagonAlert, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { isApi } from '@/api/mode';
import { useMe, isAdmin } from '@/store/auth';
import { retryStaffing } from '@/api/missionControl';
import { openDialog, toast } from '@/store/ui';
import '@/theme/pages/c42-delegation.css';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Chip } from '@/components/ui/Chips';
import { AGENT_BY_ID } from '@/data/agents';
import type { Mission } from '@/data/types';
import { FILE_META } from '@/dialogs/defs/mission-add';
import { agoFromTs, cx } from '@/lib/format';

/** GM → executor → agents, animated as it happens (owner update 2026-11-20 u1). */
export function StaffingCard({ m }: { m: Mission }) {
  const s = m.staffing;
  const me = useMe();
  const [busy, setBusy] = useState(false);
  if (!s) return null;
  const stalled = isApi() ? s.stalled : undefined;
  const canRetry = !!me && (isAdmin(me) || me.id === m.ownerId);
  const retry = async () => {
    if (busy) return;
    setBusy(true);
    const r = await retryStaffing(m.id);
    setBusy(false);
    if (!r.ok) toast({ tone: 'error', title: 'Not retried', body: r.message });
  };
  const exec = AGENT_BY_ID[m.executorId ?? ''];
  const done = s.stage === 'working';
  const pct = Math.round(((s.stage === 'reading' ? 0 : 1) + s.joined) / (s.plan.length + 1) * 100);
  return (
    <motion.div className={cx('stf subpanel', done && 'done')} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        {done ? <CheckCircle2 size={16} className="good" /> : stalled ? <OctagonAlert size={16} className="bad" aria-hidden /> : <Loader2 size={16} className="spin warn" />}
        <b>{done ? 'Staffed' : stalled ? 'Staffing stopped' : 'Staffing the mission'}</b><HelpTrigger k="mission.staffing" />
        <span className="spacer" />
        <Chip hue={done ? 150 : 38} size="sm">{done ? `${s.plan.length + 1} agents` : `${pct}%`}</Chip>
      </div>
      {stalled && (
        <div className="stf-stalled" role="alert" data-testid="staffing-stalled">
          <OctagonAlert size={15} aria-hidden /><span className="grow">Staffing stopped: {stalled.reason}</span>
          {canRetry && <button className="btn" disabled={busy} onClick={() => void retry()}><RotateCcw size={14} />Retry</button>}
          <HelpTrigger k="mission.staffing.stalled" />
        </div>
      )}
      <div className="stf-chain">
        <div className="stf-node gm"><RobotAvatar role="manager" size={44} animated={!done} /><span><Crown size={11} />GM</span></div>
        <motion.div className="stf-link" initial={{ scaleX: 0 }} animate={{ scaleX: s.stage === 'reading' ? .3 : 1 }} />
        <div className={cx('stf-node', s.stage === 'reading' && 'ghost')}>
          {exec ? <RobotAvatar role={exec.role} size={44} animated={!done} /> : <span className="stf-q">?</span>}
          <span>{s.stage === 'reading' ? 'appointing…' : `${exec?.name} · executor`}</span>
        </div>
        <motion.div className="stf-link" initial={{ scaleX: 0 }} animate={{ scaleX: s.joined ? 1 : .2 }} />
        <div className="stf-team">
          {s.plan.map((p, i) => {
            const a = AGENT_BY_ID[p.agentId];
            const joined = i < s.joined;
            return (
              <motion.div key={p.agentId} className={cx('stf-mini', !joined && 'ghost')} title={`${a?.name}: ${p.why}`} initial={false} animate={{ scale: joined ? 1 : .85, opacity: joined ? 1 : .35 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }}>
                <RobotAvatar role={a?.role ?? 'dev'} size={30} />
                <span className="ellipsis">{a?.name}</span>
              </motion.div>
            );
          })}
        </div>
      </div>
      <ol className="stf-log">
        <AnimatePresence initial={false}>
          {[...s.log].reverse().slice(0, 4).map((l) => (
            <motion.li key={l.at + l.text} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0 }}>
              {l.by === 'gm' ? <Crown size={12} className="warn" /> : <UserPlus size={12} className="info" />}<span className="grow">{l.text}</span><span className="dim">{agoFromTs(l.at)}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </motion.div>
  );
}

/** What the user entered: text + attached files. */
export function MissionContent({ m }: { m: Mission }) {
  const files = m.content?.files ?? [];
  return (
    <div className="mc-content">
      <p className="mc-content-text">{m.content?.text || m.objective}</p>
      {files.length > 0 && (
        <div className="mc-content-files">
          {files.map((f) => { const M = FILE_META[f.kind]; return (
            <button type="button" key={f.id} className="mc-file" style={{ ['--h' as string]: M.hue }} title={f.name} onClick={() => openDialog('attachment-preview', { attachment: { ...f, size: `${f.size.toLocaleString()} bytes` } })}>
              {f.kind === 'image' && f.url ? <img src={f.url} alt="" /> : <M.icon size={14} />}<span className="ellipsis">{f.name}</span>
            </button>
          ); })}
        </div>
      )}
      {files.length === 0 && !m.content?.text && <span className="dim row" style={{ gap: 5, fontSize: 12 }}><BookOpen size={12} />No content recorded.</span>}
    </div>
  );
}
