import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search, CornerDownLeft, Plus, SunMoon, Palette, Bot, Target, Hash, Sparkles, UserPlus, Boxes, RotateCcw, PanelTop } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { NAV, ROUTE_TABS, slug } from '@/config/nav';
import { useUI, openDialog, toast } from '@/store/ui';
import { useData } from '@/store/data';
import { useSettings } from '@/store/settings';
import { AGENTS } from '@/data/agents';

interface Cmd { id: string; group: string; label: string; hint?: string; icon: LucideIcon; run: () => void; }

/** Ctrl/Cmd+K command palette (spec DL-63). */
export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const setOpen = useUI((s) => s.setPalette);
  const nav = useNavigate();
  const missions = useData((s) => s.missions);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) { setQ(''); setSel(0); window.setTimeout(() => inputRef.current?.focus(), 20); } }, [open]);

  const all = useMemo<Cmd[]>(() => {
    const go = (p: string) => () => { nav(p); setOpen(false); };
    const act = (f: () => void) => () => { setOpen(false); f(); };
    const cmds: Cmd[] = [
      { id: 'a-new-mission', group: 'Actions', label: 'Add mission', hint: 'Create mission wizard', icon: Plus, run: act(() => openDialog('mission-create')) },
      { id: 'a-new-agent', group: 'Actions', label: 'New agent', hint: 'Create draft agent', icon: Bot, run: act(() => openDialog('agent-create')) },
      { id: 'a-add-model', group: 'Actions', label: 'Add model / provider', icon: Boxes, run: act(() => openDialog('model-add')) },
      { id: 'a-invite', group: 'Actions', label: 'Invite user', icon: UserPlus, run: act(() => openDialog('user-invite')) },
      { id: 'a-theme', group: 'Actions', label: 'Toggle light / dark', icon: SunMoon, run: act(() => { const s = useSettings.getState(); s.set({ themeMode: s.themeMode === 'light' ? 'dark' : 'light' }); }) },
      { id: 'a-appearance', group: 'Actions', label: 'Appearance studio', hint: 'Skins, motion, density', icon: Palette, run: act(() => openDialog('appearance')) },
      { id: 'a-header', group: 'Actions', label: 'Show / hide header banner', hint: 'Top strip with logo and loop', icon: PanelTop, run: act(() => { const s = useSettings.getState(); s.set({ headerBanner: !s.headerBanner }); }) },
      { id: 'a-avatar', group: 'Actions', label: 'Customize agent faces', icon: Sparkles, run: act(() => openDialog('avatar-customizer')) },
      { id: 'a-reset', group: 'Actions', label: 'Reset DEMO data', hint: 'Restore fixture missions, chats and approvals', icon: RotateCcw, run: act(() => { useData.getState().resetDemo(); toast({ tone: 'success', title: 'DEMO data reset', body: 'Fixture missions, conversations and approvals restored.' }); }) },
    ];
    for (const n of NAV) {
      cmds.push({ id: 'n-' + n.key, group: 'Go to', label: n.label, icon: n.icon, run: go(n.path) });
      for (const t of ROUTE_TABS[n.key] ?? []) cmds.push({ id: `t-${n.key}-${t}`, group: 'Tabs', label: `${n.label} › ${t}`, icon: Hash, run: go(`${n.path}?tab=${slug(t)}`) });
    }
    for (const m of missions) cmds.push({ id: 'm-' + m.id, group: 'Missions', label: `${m.id} · ${m.title}`, hint: m.status, icon: Target, run: go(`/missions/${m.id}`) });
    for (const a of AGENTS) cmds.push({ id: 'g-' + a.id, group: 'Agents', label: a.name, hint: a.dept, icon: Bot, run: go(`/agents/${a.id}`) });
    return cmds;
  }, [missions, nav, setOpen]);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return all.filter((c) => c.group === 'Actions' || c.group === 'Go to');
    const words = s.split(/\s+/);
    return all.filter((c) => words.every((w) => (c.label + ' ' + (c.hint ?? '') + ' ' + c.group).toLowerCase().includes(w))).slice(0, 60);
  }, [q, all]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(results.length - 1, x + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(0, x - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); results[sel]?.run(); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  };

  let lastGroup = '';
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="palette-layer" onKeyDown={onKey}>
          <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
          <motion.div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" data-dialog="DL-63"
            initial={{ opacity: 0, y: -16, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: .98 }} transition={{ duration: .2 }}>
            <div style={{ position: 'relative' }}>
              <Search size={18} style={{ position: 'absolute', left: 17, top: 18, color: 'var(--accent-2)' }} />
              <input ref={inputRef} className="palette-input" placeholder="Search screens, tabs, missions, agents or actions…" value={q} onChange={(e) => setQ(e.target.value)}
                role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={results[sel] ? 'pc-' + results[sel].id : undefined} />
            </div>
            <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
              {results.length === 0 && <div className="empty" style={{ padding: 24 }}>No matches for “{q}”.</div>}
              {results.map((c, i) => {
                const head = c.group !== lastGroup ? (lastGroup = c.group) : null;
                return (
                  <div key={c.id}>
                    {head && <div className="palette-group">{head}</div>}
                    <button id={'pc-' + c.id} role="option" aria-selected={i === sel} className="palette-item" onMouseEnter={() => setSel(i)} onClick={c.run}>
                      <c.icon size={16} style={{ color: 'var(--accent-2)', flex: 'none' }} />
                      <span className="ellipsis">{c.label}</span>
                      {c.hint && <span className="dim" style={{ fontSize: 12, marginLeft: 'auto' }}>{c.hint}</span>}
                      {i === sel && <CornerDownLeft size={14} style={{ marginLeft: c.hint ? 8 : 'auto', color: 'var(--text-dim)' }} />}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="row" style={{ padding: '8px 14px', borderTop: '1px solid var(--border-soft)', fontSize: 11.5, color: 'var(--text-dim)', gap: 14 }}>
              <span><span className="kbd">↑↓</span> navigate</span><span><span className="kbd">Enter</span> open</span><span><span className="kbd">Esc</span> close</span>
              <span style={{ marginLeft: 'auto' }}>{results.length} results</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
