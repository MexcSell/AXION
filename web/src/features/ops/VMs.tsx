import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { create } from 'zustand';
import { Server, Play, Square, RotateCw, Camera, TerminalSquare, Cpu, MemoryStick, Gpu, Plus, Globe, Boxes, Users, Trash2 } from 'lucide-react';
import { RingGauge, Sparkline } from '@/components/viz/Charts';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { Chip, Dot, DemoTag } from '@/components/ui/Chips';
import { Tip } from '@/components/ui/Tip';
import { IconButton } from '@/components/ui/IconButton';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Modal } from '@/components/ui/Modal';
import { Field, Segmented, Switch } from '@/components/ui/Form';
import { AGENT_BY_ID, seeded } from '@/data/agents';
import { activityFor, fmtMb, fmtTokens } from '@/data/activity';
import { BROWSER_HOSTS } from '@/data/operations';
import { MODELS } from '@/data/models';
import { useVisibleMissions } from '@/store/data';
import { toast } from '@/store/ui';
import { cx } from '@/lib/format';
import '@/theme/pages/vms.css';

/**
 * System Operations › VMs (owner update 2026-11-20 u1). The machines that run agent instances, browser contexts
 * and local models. DEMO: state changes stay in this browser; Stage 5 wires the real hypervisor API.
 */
export type VmState = 'running' | 'stopped' | 'starting' | 'stopping';
export interface Vm { id: string; name: string; role: 'agents' | 'browser' | 'gpu' | 'general'; vcpu: number; ramGB: number; diskGB: number; gpu?: string; vramGB?: number; image: string; state: VmState; created: string; base: number }

const SEED_VMS: Vm[] = [
  { id: 'vm-01', name: 'vm-01', role: 'agents', vcpu: 16, ramGB: 64, diskGB: 500, image: 'ubuntu-24.04-agents', state: 'running', created: '42 d ago', base: 46 },
  { id: 'vm-02', name: 'vm-02', role: 'agents', vcpu: 8, ramGB: 32, diskGB: 250, image: 'ubuntu-24.04-agents', state: 'running', created: '30 d ago', base: 71 },
  { id: 'vm-03', name: 'vm-03', role: 'browser', vcpu: 8, ramGB: 32, diskGB: 200, image: 'chromium-host-1.56', state: 'running', created: '18 d ago', base: 38 },
  { id: 'vm-gpu-01', name: 'vm-gpu-01', role: 'gpu', vcpu: 32, ramGB: 128, diskGB: 2000, gpu: 'NVIDIA L40S', vramGB: 48, image: 'ubuntu-24.04-cuda', state: 'running', created: '60 d ago', base: 58 },
];
const ROLE_META = { agents: { label: 'Agents', hue: 268, icon: Users }, browser: { label: 'Browser host', hue: 190, icon: Globe }, gpu: { label: 'GPU · models', hue: 150, icon: Gpu }, general: { label: 'General', hue: 225, icon: Server } } as const;

interface VmStore { vms: Vm[]; setState: (id: string, s: VmState) => void; add: (v: Vm) => void; remove: (id: string) => void }
export const useVms = create<VmStore>((set) => ({
  vms: SEED_VMS,
  setState: (id, st) => set((s) => ({ vms: s.vms.map((v) => (v.id === id ? { ...v, state: st } : v)) })),
  add: (v) => set((s) => ({ vms: [...s.vms, v] })),
  remove: (id) => set((s) => ({ vms: s.vms.filter((v) => v.id !== id) })),
}));

function useTick(ms = 2200) { const [t, setT] = useState(0); useEffect(() => { const i = window.setInterval(() => setT((x) => x + 1), ms); return () => window.clearInterval(i); }, [ms]); return t; }

export function VMs() {
  const vms = useVms((s) => s.vms);
  const missions = useVisibleMissions();
  const t = useTick();
  const [creating, setCreating] = useState(false);
  // which agent instances run where (from every running mission's activity records)
  const placed = useMemo(() => {
    const map: Record<string, { agentId: string; missionId: string; tokens: number; ramMb: number }[]> = {};
    for (const m of missions.filter((x) => ['running', 'planning', 'verifying', 'waiting'].includes(x.status))) {
      for (const id of m.agentIds) { const a = activityFor(m, id); (map[a.vm] ??= []).push({ agentId: id, missionId: m.id, tokens: a.tokens, ramMb: a.ramMb }); }
    }
    return map;
  }, [missions]);
  const running = vms.filter((v) => v.state === 'running');
  const totals = { cpu: running.reduce((s, v) => s + v.vcpu, 0), ram: running.reduce((s, v) => s + v.ramGB, 0), inst: Object.values(placed).reduce((s, x) => s + x.length, 0) };
  return (
    <div className="vm-page">
      <div className="vm-sum">
        <span><Server size={15} className="info" /><b className="tnum">{running.length}/{vms.length}</b> running</span>
        <span><Cpu size={15} /><b className="tnum">{totals.cpu}</b> vCPU</span>
        <span><MemoryStick size={15} /><b className="tnum">{totals.ram}</b> GB RAM</span>
        <span><Users size={15} className="violet" /><b className="tnum">{totals.inst}</b> agent instances</span>
        <HelpTrigger k="ops.vms" /><DemoTag />
        <span className="spacer" />
        <button className="btn primary" onClick={() => setCreating(true)}><Plus size={15} />Create VM</button>
      </div>
      <div className="vm-grid">
        <AnimatePresence initial={false}>
          {vms.map((v, i) => <VmCard key={v.id} v={v} i={i} t={t} agents={placed[v.id] ?? []} />)}
        </AnimatePresence>
      </div>
      {creating && <CreateVm close={() => setCreating(false)} />}
    </div>
  );
}

function VmCard({ v, i, t, agents }: { v: Vm; i: number; t: number; agents: { agentId: string; missionId: string; tokens: number; ramMb: number }[] }) {
  const setState = useVms((s) => s.setState);
  const remove = useVms((s) => s.remove);
  const on = v.state === 'running';
  const r = seeded(v.id);
  const wob = (k: number) => Math.round(Math.max(3, Math.min(97, v.base + Math.sin(t * .8 + k + i) * 9 + (r() - .5) * 6)));
  const cpu = on ? wob(1) : 0, ram = on ? wob(2) - 6 : 0, disk = Math.round(28 + r() * 40);
  const spark = useMemo(() => Array.from({ length: 24 }, (_, k) => Math.round(Math.max(2, v.base + Math.sin((t + k) * .7 + i) * 14))), [t, v.base, i]);
  const M = ROLE_META[v.role];
  const models = v.gpu ? MODELS.filter((m) => m.weights?.loaded) : [];
  const browsers = v.role === 'browser' ? BROWSER_HOSTS : [];
  const act = (to: VmState, final: VmState, msg: string) => { setState(v.id, to); window.setTimeout(() => { setState(v.id, final); toast({ tone: 'success', title: `${v.name} ${msg}` }); }, 1600); };
  return (
    <motion.div className={cx('vm-card glass-card hoverable', v.state)} style={{ ['--h' as string]: M.hue }} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: .95 }} transition={{ delay: i * .05 }}>
      <div className="vm-head">
        <span className="vm-ico"><M.icon size={18} /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 6 }}><b className="mono">{v.name}</b><Chip hue={M.hue} size="sm">{M.label}</Chip></div>
          <div className="dim ellipsis" style={{ fontSize: 11.5 }}>{v.vcpu} vCPU · {v.ramGB} GB · {v.diskGB} GB{v.gpu ? ` · ${v.gpu} ${v.vramGB} GB` : ''} · {v.image}</div>
        </div>
        <span className={cx('vm-state', v.state)}><Dot tone={on ? 'good' : v.state === 'stopped' ? 'muted' : 'warn'} pulse={on || v.state.endsWith('ing')} />{v.state}</span>
      </div>
      <div className="vm-gauges">
        <RingGauge value={cpu} size={78} stroke={7} label="CPU" />
        <RingGauge value={Math.max(0, ram)} size={78} stroke={7} label="RAM" colors={['#a78bfa', '#22d3ee']} />
        <RingGauge value={disk} size={78} stroke={7} label="Disk" colors={['#fbbf24', '#fb923c']} />
        {v.gpu && <RingGauge value={on ? wob(3) : 0} size={78} stroke={7} label="GPU" colors={['#2ee98a', '#22d3ee']} />}
      </div>
      <div className="vm-spark"><span className="dim">CPU · last 2 min</span><Sparkline data={on ? spark : spark.map(() => 1)} w={220} h={30} color={`hsl(${M.hue} 85% 62%)`} /></div>
      <div className="vm-sec">
        <div className="vm-sec-h"><Users size={12} />Agents here<span className="dim">{agents.length}</span></div>
        {agents.length === 0 ? <span className="dim" style={{ fontSize: 12 }}>{on ? 'No agent instances right now.' : 'Stopped.'}</span> : (
          <div className="vm-agents">
            {agents.slice(0, 9).map((a) => { const ag = AGENT_BY_ID[a.agentId]; return ag && (
              <Tip key={a.agentId + a.missionId} label={`${ag.name} in ${a.missionId} · ${fmtTokens(a.tokens)} tokens · ${fmtMb(a.ramMb)}`}>
                <Link to={`/missions/${a.missionId}?tab=activity`} className="vm-agent"><RobotAvatar role={ag.role} size={26} /></Link>
              </Tip>
            ); })}
            {agents.length > 9 && <span className="dim" style={{ fontSize: 12 }}>+{agents.length - 9}</span>}
          </div>
        )}
      </div>
      {models.length > 0 && <div className="vm-sec"><div className="vm-sec-h"><Boxes size={12} />Models loaded by the Model Loader</div><div className="row wrap" style={{ gap: 4 }}>{models.map((m) => <Chip key={m.id} hue={150} size="sm">{m.name}</Chip>)}</div></div>}
      {browsers.length > 0 && <div className="vm-sec"><div className="vm-sec-h"><Globe size={12} />Browser contexts</div><div className="row wrap" style={{ gap: 4 }}>{browsers.map((b) => <Chip key={b.id} hue={b.state === 'orphan' ? 30 : 190} size="sm">{b.id} · {b.mem} MB</Chip>)}</div></div>}
      <div className="vm-actions">
        {on ? <button className="btn sm" onClick={() => act('stopping', 'stopped', 'stopped')} disabled={agents.length > 0} title={agents.length ? 'Move its agents first' : undefined}><Square size={13} />Stop</button>
          : <button className="btn sm good" disabled={v.state !== 'stopped'} onClick={() => act('starting', 'running', 'is running')}><Play size={13} />Start</button>}
        <IconButton size="sm" icon={RotateCw} label="Restart" disabled={!on} onClick={() => act('starting', 'running', 'restarted')} />
        <IconButton size="sm" icon={Camera} label="Snapshot" onClick={() => toast({ tone: 'success', title: `Snapshot of ${v.name} queued (demo)`, body: 'Consistent disk snapshot; agents keep running.' })} />
        <IconButton size="sm" icon={TerminalSquare} label="Console" onClick={() => toast({ tone: 'info', title: `Console for ${v.name} (demo)`, body: 'Opens a read-only serial console once the hypervisor API is connected (Stage 5).' })} />
        <span className="spacer" />
        {v.state === 'stopped' && <IconButton size="sm" variant="danger" icon={Trash2} label={`Delete ${v.name}`} onClick={() => { remove(v.id); toast({ tone: 'warning', title: `${v.name} deleted (demo)` }); }} />}
      </div>
    </motion.div>
  );
}

const SIZES = { s: { vcpu: 4, ram: 16, disk: 100, label: 'Small · 4 vCPU · 16 GB' }, m: { vcpu: 8, ram: 32, disk: 250, label: 'Medium · 8 vCPU · 32 GB' }, l: { vcpu: 16, ram: 64, disk: 500, label: 'Large · 16 vCPU · 64 GB' } } as const;
function CreateVm({ close }: { close: () => void }) {
  const vms = useVms((s) => s.vms);
  const add = useVms((s) => s.add);
  const [name, setName] = useState(`vm-0${vms.length + 1}`);
  const [role, setRole] = useState<Vm['role']>('agents');
  const [size, setSize] = useState<keyof typeof SIZES>('m');
  const [gpu, setGpu] = useState(false);
  const err = !/^[a-z0-9-]{3,24}$/.test(name) ? 'Use 3–24 lowercase letters, digits or dashes' : vms.some((v) => v.name === name) ? 'A VM with this name exists' : '';
  const create = () => {
    if (err) return;
    const S = SIZES[size];
    const v: Vm = { id: name, name, role: gpu ? 'gpu' : role, vcpu: S.vcpu, ramGB: S.ram, diskGB: S.disk, gpu: gpu ? 'NVIDIA L4' : undefined, vramGB: gpu ? 24 : undefined, image: gpu ? 'ubuntu-24.04-cuda' : role === 'browser' ? 'chromium-host-1.56' : 'ubuntu-24.04-agents', state: 'starting', created: 'just now', base: 12 };
    add(v);
    window.setTimeout(() => useVms.getState().setState(v.id, 'running'), 2200);
    toast({ tone: 'success', title: `${name} is starting (demo)`, body: gpu ? 'The Model Loader will place local models on it.' : 'New agent instances can be scheduled on it.' });
    close();
  };
  return (
    <Modal title="Create VM" icon={Server} help="ops.vms" size="md" onClose={close} footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={!!err} onClick={create}><Plus size={14} />Create</button></>}>
      <div className="col" style={{ gap: 12 }}>
        <Field label="Name" error={err || undefined}><input className="input mono" data-autofocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Used for"><Segmented ariaLabel="VM role" size="sm" value={role} onChange={setRole} options={[{ key: 'agents', label: 'Agents' }, { key: 'browser', label: 'Browser host' }, { key: 'general', label: 'General' }]} /></Field>
        <Field label="Size"><select className="select" value={size} onChange={(e) => setSize(e.target.value as keyof typeof SIZES)}>{Object.entries(SIZES).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</select></Field>
        <label className="row" style={{ gap: 10, fontSize: 13 }}><Switch checked={gpu} onChange={setGpu} label="Attach a GPU" />Attach a GPU (for local models)</label>
      </div>
    </Modal>
  );
}
