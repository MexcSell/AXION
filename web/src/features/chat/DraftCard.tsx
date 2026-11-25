import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, Plus, Check, Loader2, ExternalLink } from 'lucide-react';
import type { MissionDraftDto } from '@contracts';
import { useData } from '@/store/data';
import { useMe } from '@/store/auth';
import { useUI } from '@/store/ui';
import { plainError } from '@/lib/plainError';

/**
 * A GM chat reply's mission draft (owner 2026-11-25): the person creates it as a real mission with one click. Nothing executes;
 * the mission is created like one written in Add Mission (private, then the title and the criteria are set). The created mission
 * is remembered per message in this browser, so the button does not create it twice.
 */
const KEY = (id: string) => `axion.draft.created.${id}`;
export function DraftCard({ draft, messageId }: { draft: MissionDraftDto; messageId: string }) {
  const me = useMe();
  const [created, setCreated] = useState<string | null>(() => { try { return localStorage.getItem(KEY(messageId)); } catch { return null; } });
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!me || busy) return;
    setBusy(true);
    try {
      const m = await useData.getState().addMission({ text: `${draft.title}\n\n${draft.text}`, files: [], shared: false }, { id: me.id, name: me.name });
      useData.getState().updateMission(m.id, { title: draft.title, ...(draft.criteria.length ? { criteria: draft.criteria.map((text) => ({ text, done: false })) } : {}) });
      try { localStorage.setItem(KEY(messageId), m.id); } catch { /* remembered for this view only */ }
      setCreated(m.id);
      useUI.getState().toast({ tone: 'success', title: `Mission ${m.id} created`, body: draft.title });
    } catch (e) {
      useUI.getState().toast({ tone: 'error', title: 'Mission not created', body: plainError(e) });
    } finally { setBusy(false); }
  };
  return (
    <div className="draft-card" data-draft={messageId}>
      <div className="draft-head"><ClipboardList size={14} /><span className="dim">Mission draft</span></div>
      <b className="draft-title">{draft.title}</b>
      <div className="draft-text">{draft.text}</div>
      {draft.criteria.length > 0 && <ul className="draft-crit">{draft.criteria.map((c, i) => <li key={i}>{c}</li>)}</ul>}
      <div className="draft-actions">
        {created
          ? <Link className="btn sm" to={`/missions/${created}`}><Check size={13} className="good" /> Created {created} <ExternalLink size={12} /></Link>
          : <button className="btn primary sm" disabled={busy || !me} onClick={() => void create()}>{busy ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} Create mission</button>}
        <span className="dim" style={{ fontSize: 11 }}>Private to you until you share it. Nothing runs by itself.</span>
      </div>
    </div>
  );
}
