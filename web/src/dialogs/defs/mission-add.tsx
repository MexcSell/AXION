import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Target, Image as ImageIcon, Music, Film, FileText, FileType2, FileCode, X, Send, Users, Lock, Crown, UserCog, Bot, Activity, ArrowRight, Paperclip, Sparkles, Upload, File as FileIcon,
} from 'lucide-react';
import type { DialogComponentProps } from '@/dialogs/DialogHost';
import { Modal } from '@/components/ui/Modal';
import { Switch } from '@/components/ui/Form';
import { Chip } from '@/components/ui/Chips';
import { Tip } from '@/components/ui/Tip';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { useData, useMission } from '@/store/data';
import { useMe } from '@/store/auth';
import { isApi } from '@/api/mode';
import { toast } from '@/store/ui';
import { AGENT_BY_ID } from '@/data/agents';
import type { MissionFile, MissionFileKind } from '@/data/types';
import { deriveTitle, fileKind, guessKind, staffingPlan } from '@/features/mission/staffing';
import { KIND_META } from '@/features/mission/MissionBits';
import { cx } from '@/lib/format';
import '@/theme/pages/mission-add.css';

export const FILE_META: Record<MissionFileKind, { icon: typeof FileText; label: string; hue: number }> = {
  image: { icon: ImageIcon, label: 'Image', hue: 190 }, audio: { icon: Music, label: 'Audio', hue: 290 }, video: { icon: Film, label: 'Video', hue: 330 },
  doc: { icon: FileType2, label: 'Doc', hue: 215 }, pdf: { icon: FileText, label: 'PDF', hue: 0 }, txt: { icon: FileCode, label: 'Text', hue: 150 }, file: { icon: FileIcon, label: 'File', hue: 225 },
};
const PICKERS: { kind: MissionFileKind; accept: string }[] = [
  { kind: 'image', accept: 'image/*' }, { kind: 'audio', accept: 'audio/*' }, { kind: 'video', accept: 'video/*' },
  { kind: 'doc', accept: '.doc,.docx,.odt,.rtf,.ppt,.pptx,.xls,.xlsx' }, { kind: 'pdf', accept: 'application/pdf,.pdf' }, { kind: 'txt', accept: 'text/*,.txt,.md,.csv,.json,.log' },
];
const IDEAS = [
  'Research our three main competitors and write a short report with sources.',
  'Build a plug-in app for the rail that tracks prices on two shopping sites.',
  'Turn the attached recording into meeting notes with action items.',
  'Redesign the landing page from the attached screenshots, mobile first.',
];
const fmtSize = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
let seq = 1;

/** DL-01 Add mission (owner update 2026-11-20 u1): only the mission's content — text and files. The GM does the rest. */
function MissionAdd({ close, props }: DialogComponentProps<{ text?: string; cloneFrom?: string; template?: string }>) {
  const nav = useNavigate();
  const me = useMe();
  const add = useData((s) => s.addMission);
  const clone = useMission(props.cloneFrom);
  const [text, setText] = useState(props.text ?? clone?.content.text ?? '');
  const [files, setFiles] = useState<MissionFile[]>([]);
  const [shared, setShared] = useState(clone?.shared ?? false);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const empty = !text.trim() && files.length === 0;

  const addFiles = (list: FileList | File[]) => {
    const arr = Array.from(list).map((f): MissionFile => {
      const kind = fileKind(f.name, f.type);
      const mf: MissionFile = { id: 'mf' + seq++, name: f.name, kind, size: f.size, mime: f.type, url: ['image', 'audio', 'video'].includes(kind) ? URL.createObjectURL(f) : undefined, blob: f };
      if (kind === 'txt' && f.size < 2_000_000) f.text().then((t) => setFiles((cur) => cur.map((x) => (x.id === mf.id ? { ...x, excerpt: t.slice(0, 240) } : x)))).catch(() => undefined);
      return mf;
    });
    setFiles((cur) => [...cur, ...arr]);
  };
  const openPicker = (accept: string) => { if (pick.current) { pick.current.accept = accept; pick.current.click(); } };

  const kind = guessKind(text, files);
  const title = deriveTitle(text, files);
  const plan = useMemo(() => staffingPlan(kind, text), [kind, text]);
  const exec = AGENT_BY_ID[plan.executorId];

  const submit = () => {
    if (empty || !me || busy) return;
    setBusy(true);
    window.setTimeout(async () => {
      try {
        const m = await add({ text, files, shared }, me);
        toast({ tone: 'success', title: `${m.id} added`, body: `The General Manager is appointing ${exec?.name ?? 'an executor'}, who will bring the agents.` });
        close();
        nav(`/missions/${m.id}?tab=overview`);
      } catch (e) {
        setBusy(false);
        toast({ tone: 'error', title: 'Mission not added', body: e instanceof Error ? e.message : 'Try again.' });
      }
    }, isApi() ? 0 : 450);
  };

  return (
    <Modal title="Add mission" icon={Target} help="mission.create" dialogId="DL-01" size="lg" onClose={close}
      sub="Write what you want done and attach anything useful. The General Manager appoints an executor, who brings the agents."
      footer={<>
        <label className="ma-share">
          {shared ? <Users size={15} className="info" /> : <Lock size={15} className="dim" />}
          <span><b>{shared ? 'Shared with all users' : 'Only you and administrators'}</b><span className="dim">{shared ? 'Everyone can see and follow it' : 'Turn on to share it'}</span></span>
          <Switch checked={shared} onChange={setShared} label="Share this mission with all users" />
          <HelpTrigger k="mission.visibility" />
        </label>
        <span className="spacer" />
        <button className="btn ghost" onClick={close}>Cancel</button>
        <motion.button className="btn primary" disabled={empty || busy} onClick={submit} whileTap={{ scale: .96 }} title="Ctrl Enter">
          {busy ? <><Sparkles size={15} className="spin" />Adding…</> : <><Send size={15} />Add mission</>}
        </motion.button>
      </>}>
      <div className={cx('ma-composer', over && 'over')}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}>
        <textarea ref={taRef} className="textarea ma-text" data-autofocus rows={6} value={text} onChange={(e) => setText(e.target.value)}
          onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}
          placeholder="What should the company do? Write it the way you would tell a person. Paste or drop images, audio, video, documents, PDFs or text files." aria-label="Mission content" />
        <div className="ma-bar">
          <span className="ma-bar-l"><Paperclip size={14} />Attach</span>
          {PICKERS.map((p) => { const M = FILE_META[p.kind]; return (
            <Tip key={p.kind} label={`Attach ${M.label.toLowerCase()} files`}><button type="button" className="ma-pick" style={{ ['--h' as string]: M.hue }} onClick={() => openPicker(p.accept)} aria-label={`Attach ${M.label}`}><M.icon size={15} /><span>{M.label}</span></button></Tip>
          ); })}
          <span className="spacer" />
          <span className="dim tnum" style={{ fontSize: 11.5 }}>{text.trim().length} chars · {files.length} file{files.length === 1 ? '' : 's'}</span>
        </div>
        <input ref={pick} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
        <AnimatePresence>{over && <motion.div className="ma-drop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><Upload size={28} /><b>Drop to attach</b></motion.div>}</AnimatePresence>
      </div>

      <AnimatePresence initial={false}>
        {files.length > 0 && (
          <motion.div className="ma-files" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <AnimatePresence>{files.map((f) => <FileCard key={f.id} f={f} onRemove={() => setFiles(files.filter((x) => x.id !== f.id))} />)}</AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {empty ? (
        <div className="ma-ideas">
          <span className="dim"><Sparkles size={13} /> Try:</span>
          {IDEAS.map((i, n) => <motion.button key={i} className="ma-idea" onClick={() => { setText(i); taRef.current?.focus(); }} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .05 * n }}>{i}</motion.button>)}
        </div>
      ) : (
        <motion.div className="ma-preview" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <span className="dim">Reads as</span><b className="ellipsis">{title}</b><Chip hue={KIND_META[kind]?.hue ?? 210}>{KIND_META[kind]?.label ?? kind}</Chip>
        </motion.div>
      )}

      <div className="ma-flow" aria-label="What happens after you add it">
        {[
          { icon: UserCog, t: 'You', s: 'add the content', who: null },
          { icon: Crown, t: 'General Manager', s: 'appoints the executor', who: 'manager' as const },
          { icon: Bot, t: exec?.name ?? 'Executor', s: `brings ${plan.plan.length} agents`, who: exec?.role ?? null },
          { icon: Activity, t: 'Agents', s: 'work and record tokens, time, CPU, RAM', who: null },
        ].map((st, i, arr) => (
          <div key={st.t} className="ma-step-wrap">
            <motion.div className="ma-step" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .08 * i }}>
              <span className="ma-step-ico">{st.who ? <RobotAvatar role={st.who} size={30} /> : <st.icon size={17} />}</span>
              <span className="col" style={{ minWidth: 0 }}><b className="ellipsis">{st.t}</b><span className="dim ellipsis">{st.s}</span></span>
            </motion.div>
            {i < arr.length - 1 && <ArrowRight size={15} className="ma-arrow" />}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function FileCard({ f, onRemove }: { f: MissionFile; onRemove: () => void }) {
  const M = FILE_META[f.kind];
  return (
    <motion.div className={cx('ma-file', f.kind)} layout initial={{ opacity: 0, scale: .85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .85 }} style={{ ['--h' as string]: M.hue }}>
      <div className="ma-file-media">
        {f.kind === 'image' && f.url ? <img src={f.url} alt={f.name} />
          : f.kind === 'video' && f.url ? <video src={f.url} muted playsInline preload="metadata" onMouseEnter={(e) => void e.currentTarget.play().catch(() => undefined)} onMouseLeave={(e) => e.currentTarget.pause()} />
          : f.kind === 'audio' && f.url ? <div className="ma-audio"><span className="ma-wave" aria-hidden>{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ height: `${20 + ((i * 37) % 60)}%` }} />)}</span><audio src={f.url} controls preload="none" /></div>
          : f.kind === 'txt' && f.excerpt ? <pre className="ma-excerpt">{f.excerpt}</pre>
          : <span className="ma-file-big"><M.icon size={30} /></span>}
      </div>
      <div className="ma-file-meta">
        <M.icon size={13} /><span className="ellipsis" title={f.name}>{f.name}</span><span className="dim tnum">{fmtSize(f.size)}</span>
      </div>
      <button className="ma-file-x" aria-label={`Remove ${f.name}`} onClick={onRemove}><X size={12} /></button>
    </motion.div>
  );
}

export const dialogs = { 'mission-create': MissionAdd };
