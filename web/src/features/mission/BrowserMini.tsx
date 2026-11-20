import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Lock, RotateCw, ArrowLeft, ArrowRight, Pause, Play, Camera, Hand, ShieldCheck, ExternalLink, MousePointer2, EyeOff, Globe } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { IconButton } from '@/components/ui/IconButton';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Chip, DemoTag, Dot } from '@/components/ui/Chips';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import type { Mission } from '@/data/types';
import { openDialog, toast } from '@/store/ui';
import { clock } from '@/lib/format';

const STEPS = [
  { action: 'navigate', target: '/account/settings', locator: "page.goto('/account/settings')", conf: 1, box: null as null | [number, number, number, number] },
  { action: 'observe', target: 'Settings form', locator: "getByRole('form', { name: 'Profile' })", conf: .98, box: [8, 30, 56, 52] as [number, number, number, number] },
  { action: 'fill', target: 'Display name', locator: "getByLabel('Display name')", conf: .97, box: [10, 40, 40, 7] as [number, number, number, number] },
  { action: 'click', target: 'Theme: Dark', locator: "getByRole('radio', { name: 'Dark' })", conf: .95, box: [10, 56, 18, 7] as [number, number, number, number] },
  { action: 'click', target: 'Save changes', locator: "getByRole('button', { name: 'Save changes' })", conf: .97, box: [10, 72, 16, 8] as [number, number, number, number], gated: true },
];

/** Compact, redacted managed-browser viewport for Mission Control › Browser (spec §4.4, J-04). */
export function BrowserMini({ mission }: { mission: Mission }) {
  const nav = useNavigate();
  const [i, setI] = useState(1);
  const [paused, setPaused] = useState(false);
  const [shotAt, setShotAt] = useState(Date.now());
  const live = ['running', 'verifying', 'waiting', 'planning'].includes(mission.status);
  const step = STEPS[i];
  useEffect(() => {
    if (paused || !live || step.gated) return;
    const t = window.setTimeout(() => { setI((x) => Math.min(STEPS.length - 1, x + 1)); setShotAt(Date.now()); }, 2600);
    return () => window.clearTimeout(t);
  }, [i, paused, live, step.gated]);

  return (
    <div className="bmini">
      <div className="bmini-main">
        <div className="bwin">
          <div className="bwin-bar">
            <span className="bwin-dots"><i /><i /><i /></span>
            <IconButton icon={ArrowLeft} label="Back (disabled in observe mode)" size="xs" disabled />
            <IconButton icon={ArrowRight} label="Forward (disabled in observe mode)" size="xs" disabled />
            <IconButton icon={RotateCw} label="Refresh screenshot" size="xs" onClick={() => setShotAt(Date.now())} />
            <div className="bwin-url"><Lock size={12} className="good" /><span className="dim">https://</span>www.example.com<span className="dim">{step.target.startsWith('/') ? step.target : '/account/settings'}</span></div>
            <Chip hue={145} size="sm" icon={ShieldCheck}>granted</Chip>
          </div>
          <div className="bwin-progress"><motion.i key={i} initial={{ width: '0%' }} animate={{ width: '100%' }} transition={{ duration: 1.1 }} /></div>
          <div className="bwin-page">
            <AnimatePresence mode="wait">
              <motion.div key={shotAt} className="mock-page" initial={{ opacity: .4 }} animate={{ opacity: 1 }} exit={{ opacity: .4 }} transition={{ duration: .35 }}>
                <div className="mp-nav"><span className="mp-logo" /><span /><span /><span /><span className="mp-av" /></div>
                <div className="mp-h1" />
                <div className="mp-form">
                  <div className="mp-label" /><div className="mp-input"><span className="redact"><EyeOff size={10} /> redacted</span></div>
                  <div className="mp-label" /><div className="mp-input short" />
                  <div className="mp-radios"><span className="on" /><span /><span /></div>
                  <div className="mp-btn">Save changes</div>
                </div>
                <div className="mp-side"><span /><span /><span /><span /></div>
              </motion.div>
            </AnimatePresence>
            {step.box && (
              <motion.div className={'bhl' + (step.gated ? ' gated' : '')} initial={false}
                animate={{ left: `${step.box[0]}%`, top: `${step.box[1]}%`, width: `${step.box[2]}%`, height: `${step.box[3]}%` }} transition={{ type: 'spring', stiffness: 160, damping: 20 }}>
                <span className="bhl-tag">{step.action} · {Math.round(step.conf * 100)}%</span>
              </motion.div>
            )}
            {step.box && (
              <motion.div className="bcursor" initial={false} animate={{ left: `${step.box[0] + step.box[2] * .6}%`, top: `${step.box[1] + step.box[3] * .6}%` }} transition={{ type: 'spring', stiffness: 120, damping: 18 }}>
                <MousePointer2 size={20} fill="#fff" />
              </motion.div>
            )}
            {paused && <div className="bpaused"><Pause size={22} /> Paused by you</div>}
          </div>
          <div className="bwin-foot">
            <Dot tone={paused ? 'warn' : step.gated ? 'warn' : live ? 'good' : 'muted'} pulse={live && !paused && !step.gated} />
            <span>{paused ? 'Paused' : step.gated ? 'Awaiting approval' : live ? 'Active' : 'Idle'} · screenshot {clock(0, shotAt)}</span>
            <span className="spacer" /><DemoTag title="Fixture frames — real Playwright sessions arrive in Stage 7" />
          </div>
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          <button className="btn sm" onClick={() => setPaused(!paused)}>{paused ? <Play size={14} /> : <Pause size={14} />}{paused ? 'Resume' : 'Pause'}</button>
          <button className="btn sm" onClick={() => { setShotAt(Date.now()); toast({ tone: 'success', title: 'Screenshot captured', body: 'Stored as evidence with checksum (demo).' }); }}><Camera size={14} />Screenshot</button>
          <button className="btn sm" onClick={() => openDialog('browser-takeover', { missionId: mission.id })}><Hand size={14} />Request takeover</button>
          <HelpTrigger k="browser.humanTakeover" />
          <span className="spacer" />
          <button className="btn sm ghost" onClick={() => nav('/plugins/job-search')}><ExternalLink size={14} />Job Search</button>
        </div>
      </div>
      <div className="bmini-side">
        <div className="row" style={{ gap: 8 }}><RobotAvatar role="browser" size={34} /><div><b>Browser-01</b><div className="dim" style={{ fontSize: 11.5 }}>session bs-{mission.id.slice(2)}-a · Chromium (isolated)</div></div></div>
        <div className="row" style={{ gap: 6 }}><Globe size={13} className="info" /><span style={{ fontSize: 12.5 }}>Origin <b>www.example.com</b></span><HelpTrigger k="browser.originGrant" /></div>
        <div className="section-label">Action steps</div>
        <div className="col" style={{ gap: 4 }}>
          {STEPS.map((s, k) => (
            <button key={k} className={'bstep' + (k === i ? ' on' : k < i ? ' done' : '')} onClick={() => setI(k)}>
              <span className="bstep-n">{k + 1}</span>
              <div style={{ minWidth: 0, textAlign: 'left' }}>
                <div className="row" style={{ gap: 6 }}><b style={{ textTransform: 'capitalize' }}>{s.action}</b><span className="ellipsis dim">{s.target}</span></div>
                <div className="mono dim ellipsis" style={{ fontSize: 10.5 }}>{s.locator}</div>
              </div>
              {s.gated && <Chip hue={38} size="sm">gate</Chip>}
            </button>
          ))}
        </div>
        {step.gated && (
          <motion.div className="callout warn" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <ShieldCheck size={16} />
            <div className="grow"><b>Approval needed</b><div style={{ fontSize: 12 }}>Click “Save changes” on www.example.com/account/settings. Bound to digest 9f1c…a24e, expires in 15 min.</div>
              <div className="row" style={{ gap: 6, marginTop: 8 }}>
                <button className="btn sm good" onClick={() => { toast({ tone: 'success', title: 'Approved once', body: 'Browser-01 executed the click (demo). Observation recorded.' }); setI(1); }}>Approve once</button>
                <button className="btn sm danger" onClick={() => { toast({ tone: 'warning', title: 'Denied', body: 'No side effect happened. Browser-01 will ask how to proceed.' }); setI(1); }}>Deny</button>
                <button className="btn sm ghost" onClick={() => openDialog('browser-action-approval', { missionId: mission.id })}>Details</button>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
