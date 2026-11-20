import { motion, AnimatePresence } from 'motion/react';
import { Link } from 'react-router-dom';
import { PanelTop, Puzzle, Plus, RotateCcw, ArrowUpRight, Eye, EyeOff, Target, Search } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Switch } from '@/components/ui/Form';
import { Chip } from '@/components/ui/Chips';
import { Tip } from '@/components/ui/Tip';
import { NAV } from '@/config/nav';
import { PLUGINS } from '@/config/plugins';
import { useSettings, useRailShown } from '@/store/settings';
import { openDialog, toast } from '@/store/ui';
import { cx } from '@/lib/format';

/** Settings › Navigation: what the rail's top section and plug-in section show (owner update 2026-11-20 u1). */
export function NavigationSettings() {
  const navShown = useSettings((s) => s.navShown);
  const set = useSettings((s) => s.set);
  const shown = useRailShown();
  const toggle = (key: string, v: boolean) => set({ navShown: { ...navShown, [key]: v } });
  const top = NAV.map((n) => ({ ...n, on: shown(n.key, n.shown) }));
  const plugins = PLUGINS.map((p) => ({ ...p, on: shown('plugin:' + p.key, true) }));
  const changed = Object.keys(navShown).length;

  return (
    <div className="nav-set">
      <Panel icon={PanelTop} title="Top section" help="settings.nav.top" delay={.05} className="nav-set-top"
        actions={<button className="btn ghost sm" disabled={!changed} onClick={() => { set({ navShown: {} }); toast({ tone: 'success', title: 'Navigation reset', body: 'Missions, Notifications and Settings are shown; everything else is reachable through search.' }); }}><RotateCcw size={14} />Defaults</button>}>
        <p className="dim nav-set-note"><Search size={13} /> Hidden screens stay reachable with <span className="kbd">Ctrl K</span>, links and URLs. While you visit one, the rail shows it with a dashed outline.</p>
        <div className="nav-set-list">
          {top.map((n, i) => (
            <motion.div key={n.key} className={cx('nav-set-row', n.on && 'on')} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .03 * i }}>
              <span className="nav-set-ico"><n.icon size={18} /></span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}><b>{n.label}</b>{n.shown && <Chip hue={200}>default</Chip>}</div>
                <div className="dim ellipsis" style={{ fontSize: 12 }}>{n.note}</div>
              </div>
              <Tip label={`Open ${n.label}`}><Link className="icon-btn xs" to={n.path} aria-label={`Open ${n.label}`}><ArrowUpRight size={14} /></Link></Tip>
              <Switch checked={n.on} onChange={(v) => toggle(n.key, v)} label={`Show ${n.label} in the rail`} />
            </motion.div>
          ))}
        </div>
      </Panel>

      <Panel icon={Puzzle} title="Plug-in apps" help="settings.nav.plugins" delay={.1} className="nav-set-plugins"
        actions={<button className="btn primary sm" onClick={() => openDialog('mission-create', { text: 'Build a plug-in app for the rail that …' })}><Plus size={14} />Create through a mission</button>}>
        <div className="nav-set-list">
          {plugins.map((p, i) => (
            <motion.div key={p.key} className={cx('nav-set-row plugin', p.on && 'on')} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .05 + .04 * i }}>
              <span className="nav-set-ico plugin"><p.icon size={18} /></span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><b>{p.label}</b><Chip hue={268}>{p.version}</Chip>
                  {p.origin.kind === 'mission' ? <Link to={`/missions/${p.origin.missionId}`}><Chip hue={150}><Target size={11} />{p.origin.missionId}</Chip></Link> : <Chip hue={225}>built-in</Chip>}</div>
                <div className="dim clamp-2" style={{ fontSize: 12 }}>{p.description}</div>
              </div>
              <Tip label={`Open ${p.label}`}><Link className="icon-btn xs" to={p.path} aria-label={`Open ${p.label}`}><ArrowUpRight size={14} /></Link></Tip>
              <Switch checked={p.on} onChange={(v) => toggle('plugin:' + p.key, v)} label={`Show ${p.label} in the rail`} />
            </motion.div>
          ))}
        </div>
        <div className="nav-set-how dim">
          <b>How plug-ins are made:</b> add a mission such as “Build a plug-in that tracks competitor prices”. The general manager appoints an executor,
          the executor brings the agents, and when the result is verified the plug-in is registered here and appears in the rail.
        </div>
      </Panel>

      <Panel icon={Eye} title="Rail preview" help="settings.nav.preview" delay={.15} className="nav-set-preview">
        <div className="nav-prev">
          <div className="nav-prev-sec">
            <AnimatePresence initial={false}>
              {top.filter((n) => n.on).map((n) => (
                <motion.div key={n.key} layout className="nav-prev-item" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}>
                  <n.icon size={15} /><span>{n.label}</span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          <div className="nav-prev-gap"><span>space</span></div>
          <div className="nav-prev-sec">
            <div className="nav-prev-head"><Puzzle size={11} />Plug-ins</div>
            <AnimatePresence initial={false}>
              {plugins.filter((p) => p.on).map((p) => (
                <motion.div key={p.key} layout className="nav-prev-item plugin" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}>
                  <p.icon size={15} /><span>{p.label}</span>
                </motion.div>
              ))}
            </AnimatePresence>
            {!plugins.some((p) => p.on) && <div className="dim" style={{ fontSize: 11.5, padding: 4 }}><EyeOff size={12} /> none shown</div>}
          </div>
        </div>
      </Panel>
    </div>
  );
}
