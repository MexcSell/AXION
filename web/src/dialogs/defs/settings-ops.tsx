import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Accessibility, AlertTriangle, BookOpen, Bug, Copy, DatabaseBackup, LifeBuoy, Palette, RefreshCw, RotateCw, ScanFace, Save, ShieldAlert } from 'lucide-react';
import type { DialogComponentProps } from '@/dialogs/DialogHost';
import { Modal } from '@/components/ui/Modal';
import { Field, Segmented, SwitchRow } from '@/components/ui/Form';
import { HelpBody } from '@/components/ui/HelpTrigger';
import { Chip } from '@/components/ui/Chips';
import { AppearanceControls } from '@/components/settings/AppearanceControls';
import { FaceControls, FacePreview, RoleGallery, SynthNote } from '@/components/settings/FaceEditor';
import { getHelp } from '@/help/registry';
import { SERVICES, SNAPSHOTS } from '@/data/operations';
import { useSettings, type TextScale } from '@/store/settings';
import { toast } from '@/store/ui';
import type { RoleKey } from '@/data/types';
import '@/theme/pages/settings-ops-help.css';

type Snap = ReturnType<typeof useSettings.getState>;
const pick = (s: Snap) => ({ themeMode: s.themeMode, skin: s.skin, motion: s.motion, density: s.density, textScale: s.textScale, highContrast: s.highContrast, accent: s.accent, particles: s.particles });

/* DL-56 */
function Appearance({ close }: DialogComponentProps) {
  const before = useRef({ ...pick(useSettings.getState()), avatar: useSettings.getState().avatar });
  const revert = () => { useSettings.getState().set(before.current); useSettings.getState().setAvatar(before.current.avatar); close(); };
  return (
    <Modal title="Appearance Studio" icon={Palette} help="dialog.appearance" size="lg" dialogId="DL-56" sub="Changes preview live. Save keeps them, Cancel restores your previous look." onClose={revert}
      footer={<>
        <button className="btn" data-autofocus onClick={revert}>Cancel</button>
        <button className="btn primary" onClick={() => { toast({ tone: 'success', title: 'Appearance saved', body: 'Stored in this browser.' }); close(); }}><Save size={14} />Save appearance</button>
      </>}>
      <AppearanceControls compact />
    </Modal>
  );
}

/* DL-57 */
function AvatarCustomizer({ close, props }: DialogComponentProps<{ role?: RoleKey }>) {
  const before = useRef(useSettings.getState().avatar);
  const [role, setRole] = useState<RoleKey>(props.role ?? 'dev');
  const revert = () => { useSettings.getState().setAvatar(before.current); close(); };
  return (
    <Modal title="Avatar customizer" icon={ScanFace} help="dialog.avatarCustomizer" size="lg" dialogId="DL-57" sub="Generated robot avatars only" onClose={revert}
      footer={<>
        <button className="btn" data-autofocus onClick={revert}>Cancel</button>
        <button className="btn primary" onClick={() => { toast({ tone: 'success', title: 'Avatar style applied', body: 'All avatars in the app now use it.' }); close(); }}>Apply avatar</button>
      </>}>
      <div className="col" style={{ gap: 12 }}>
        <SynthNote />
        <div className="face-editor"><FacePreview role={role} size={190} /><FaceControls /></div>
        <RoleGallery value={role} onPick={setRole} size={44} />
      </div>
    </Modal>
  );
}

/* DL-58 */
function AccessibilityPrefs({ close }: DialogComponentProps) {
  const s = useSettings();
  const before = useRef(pick(useSettings.getState()));
  const [focus, setFocus] = useState(true);
  const [audio, setAudio] = useState(false);
  const revert = () => { useSettings.getState().set(before.current); close(); };
  return (
    <Modal title="Accessibility preferences" icon={Accessibility} help="dialog.accessibility" size="md" dialogId="DL-58" onClose={revert}
      footer={<>
        <button className="btn ghost" onClick={() => { s.set({ textScale: 'md', highContrast: false, motion: 'full' }); toast({ tone: 'info', title: 'Accessibility reset' }); }}>Reset</button>
        <span className="spacer" />
        <button className="btn" onClick={revert}>Cancel</button>
        <button className="btn primary" onClick={() => { toast({ tone: 'success', title: 'Accessibility preferences saved' }); close(); }}>Save accessibility</button>
      </>}>
      <div className="col" style={{ gap: 12 }}>
        <Field label="Text size" help="settings.textScale">
          <Segmented ariaLabel="Text size" value={s.textScale} onChange={(v: TextScale) => s.set({ textScale: v })} options={[{ key: 'md', label: 'Medium' }, { key: 'lg', label: 'Large' }, { key: 'xl', label: 'Extra large' }]} />
        </Field>
        <SwitchRow label="High contrast" help="settings.contrast" desc="Stronger borders and text" checked={s.highContrast} onChange={(v) => s.set({ highContrast: v })} />
        <SwitchRow label="Reduce motion" help="settings.motion" desc="Fades only, no movement" checked={s.motion === 'reduced'} onChange={(v) => s.set({ motion: v ? 'reduced' : 'full' })} />
        <SwitchRow label="Visible focus ring" desc="Keyboard focus is always shown" checked={focus} onChange={() => { setFocus(true); toast({ tone: 'info', title: 'Focus ring stays on (demo)' }); }} />
        <SwitchRow label="Audio alerts" desc="Soft tone when an approval arrives" checked={audio} onChange={setAudio} />
        <div className="subpanel"><b style={{ fontSize: 15 }}>Preview text</b><div className="muted">Verified progress counts only tasks whose evidence passed independent checks.</div></div>
      </div>
    </Modal>
  );
}

/* DL-59 */
function BackupRestore({ close, props }: DialogComponentProps<{ snapshot?: string }>) {
  const [id, setId] = useState(props.snapshot ?? SNAPSHOTS[0].id);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const snap = SNAPSHOTS.find((x) => x.id === id) ?? SNAPSHOTS[0];
  const ok = snap.compat.startsWith('Compat');
  const log = useMemo(() => [`[dry-run] unpack ${snap.id} (${snap.size})`, `[dry-run] sha256 ${snap.hash} OK`, ok ? '[dry-run] schema 0041 == 0041 OK' : '[dry-run] schema 0041 < 0042 migration 0042 required', '[dry-run] smoke test api: 200, workers: 6/6', `[dry-run] ${ok ? 'PASS' : 'PASS with migration'} - live data untouched`], [snap, ok]);
  const submit = () => {
    if (reason.trim().length < 10) { setErr('Describe why you need this restore (10 characters or more).'); return; }
    toast({ tone: 'success', title: 'Restore request sent', body: `Owner approval is needed before ${snap.id} is restored (demo).` }); close();
  };
  return (
    <Modal title="Request restore" icon={DatabaseBackup} help="dialog.backupRestore" size="lg" tone="warn" dialogId="DL-59" sub="Nothing changes until an Owner approves" onClose={close}
      footer={<><button className="btn" data-autofocus onClick={close}>Cancel</button><button className="btn primary" onClick={submit}>Request restore</button></>}>
      <div className="col" style={{ gap: 12 }}>
        <Field label="Snapshot">
          <select className="select" value={id} onChange={(e) => setId(e.target.value)} aria-label="Snapshot">{SNAPSHOTS.map((x) => <option key={x.id} value={x.id}>{x.id} · {x.date}</option>)}</select>
        </Field>
        <div className="grid g-3" style={{ gap: 10 }}>
          <div className="subpanel"><div className="dim" style={{ fontSize: 11.5 }}>Hash</div><div className="mono" style={{ fontSize: 12 }}>{snap.hash}</div></div>
          <div className="subpanel"><div className="dim" style={{ fontSize: 11.5 }}>Size</div><b>{snap.size}</b></div>
          <div className="subpanel"><div className="dim" style={{ fontSize: 11.5 }}>Compatibility</div><Chip hue={ok ? 148 : 40} size="sm">{snap.compat}</Chip></div>
        </div>
        <div className="terminal short" aria-label="Dry-run log">{log.map((l, i) => <div key={i} className="term-line info"><span className="msg">{l}</span></div>)}</div>
        <Field label="Reason" required error={err} hint="Shown to the approving Owner.">
          <textarea className="textarea" rows={2} value={reason} onChange={(e) => { setReason(e.target.value); setErr(''); }} placeholder="Example: roll back the knowledge index after a bad import" aria-label="Reason" />
        </Field>
      </div>
    </Modal>
  );
}

/* DL-60 */
function ServiceRestart({ close, props }: DialogComponentProps<{ unit?: string }>) {
  const svc = SERVICES.find((s) => s.unit === props.unit) ?? SERVICES[0];
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [err, setErr] = useState('');
  const submit = () => {
    if (!reason.trim()) { setErr('A reason is required.'); return; }
    if (!ack) { setErr('Confirm that you reviewed the impact.'); return; }
    toast({ tone: 'success', title: `Restart requested for ${svc.unit}`, body: 'An Admin must approve it. Nothing was restarted (demo).' }); close();
  };
  return (
    <Modal title="Request service restart" icon={RotateCw} help="dialog.serviceRestart" size="md" tone="warn" dialogId="DL-60" sub={<span className="mono">{svc.unit}</span>} onClose={close}
      footer={<><button className="btn" data-autofocus onClick={close}>Cancel</button><button className="btn primary" onClick={submit}>Request Admin approval</button></>}>
      <div className="col" style={{ gap: 12 }}>
        <div className="subpanel"><div className="section-label">User impact</div><div style={{ fontSize: 13 }}>{svc.users}</div></div>
        <div className="grid g-2" style={{ gap: 10 }}>
          <div className="subpanel"><div className="section-label">Depends on</div><div className="mono" style={{ fontSize: 12 }}>{svc.deps.length ? svc.deps.join(', ') : 'nothing'}</div></div>
          <div className="subpanel"><div className="section-label">Command (run by approver)</div><div className="mono" style={{ fontSize: 12 }}>systemctl restart {svc.unit}</div></div>
        </div>
        <div className="subpanel"><div className="section-label">Rollback steps</div>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}><li>Watchdog confirms health within 60 s.</li><li>If unhealthy, the previous unit file is restored.</li><li>Incident is logged in Recovery.</li></ol></div>
        <Field label="Reason" required error={err}><input className="input" value={reason} onChange={(e) => { setReason(e.target.value); setErr(''); }} placeholder="Why is a restart needed?" aria-label="Reason" /></Field>
        <label className="row" style={{ gap: 8, fontSize: 13 }}><input type="checkbox" checked={ack} onChange={(e) => { setAck(e.target.checked); setErr(''); }} />I reviewed the impact and rollback steps</label>
      </div>
    </Modal>
  );
}

/* DL-62 */
function HelpDrawer({ close, props }: DialogComponentProps<{ k?: string }>) {
  const e = getHelp(props.k ?? '');
  return (
    <Modal drawer title={e.title} icon={LifeBuoy} size="md" dialogId="DL-62" sub={props.k ? <span className="mono">{props.k}</span> : undefined} onClose={close}
      footer={<><button className="btn" data-autofocus onClick={close}>Dismiss</button><Link className="btn primary" to="/help?tab=guides" onClick={close}><BookOpen size={14} />Open guides</Link></>}>
      <HelpBody e={e} />
    </Modal>
  );
}

/* DL-64 */
function Unsaved({ close, props }: DialogComponentProps<{ fields?: string[]; onDiscard?: () => void }>) {
  const fields = props.fields ?? [];
  return (
    <Modal title="Unsaved changes" icon={AlertTriangle} help="dialog.unsaved" size="sm" tone="warn" dialogId="DL-64" onClose={close}
      footer={<><button className="btn primary" data-autofocus onClick={close}>Continue editing</button><button className="btn danger" onClick={() => { props.onDiscard?.(); toast({ tone: 'info', title: 'Changes discarded' }); close(); }}>Discard changes</button></>}>
      <div className="col" style={{ gap: 8, fontSize: 13 }}>
        <div>You have edits that are not saved. Leaving now will discard them.</div>
        {fields.length > 0 && <div className="row wrap" style={{ gap: 6 }}>{fields.map((f) => <Chip key={f} hue={40} size="sm">{f}</Chip>)}</div>}
      </div>
    </Modal>
  );
}

/* DL-65 */
function ErrorInspector({ close, props }: DialogComponentProps<{ code?: string; message?: string; category?: string }>) {
  const code = typeof props.code === 'string' ? props.code : 'AX-408';
  const message = typeof props.message === 'string' ? props.message : undefined;
  const category = typeof props.category === 'string' ? props.category : undefined;
  const cid = useMemo(() => 'c-7f3a2e', []);
  const diag = `code=${code}\ncategory=${category ?? 'upstream'}\ncorrelation_id=${cid}\nmessage=${message ?? 'Model upstream timeout after 30 s'}\nbuild=v3.2.0 (demo)`;
  const [retrying, setRetrying] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(diag); toast({ tone: 'success', title: 'Diagnostic copied', body: 'It contains no secrets.' }); } catch { toast({ tone: 'info', title: 'Copy not available', body: 'Select the text and copy it manually.' }); } };
  const retry = () => { setRetrying(true); window.setTimeout(() => { toast({ tone: 'success', title: 'Retry succeeded (demo)' }); close(); }, 900); };
  return (
    <Modal title="Error inspector" icon={Bug} help="dialog.errorInspector" size="md" tone="danger" dialogId="DL-65" sub={<span className="mono">{code}</span>} onClose={close}
      footer={<><button className="btn" data-autofocus onClick={close}>Close</button><button className="btn" onClick={copy}><Copy size={14} />Copy diagnostic</button><button className="btn primary" onClick={retry} disabled={retrying}><RefreshCw size={14} />{retrying ? 'Retrying…' : 'Safe retry'}</button></>}>
      <div className="col" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 8 }}><ShieldAlert size={18} className="bad" /><b>{message ?? 'Model upstream timeout after 30 s'}</b></div>
        <div className="grid g-2" style={{ gap: 10 }}>
          <div className="subpanel"><div className="section-label">Category</div><Chip hue={30}>{category ?? 'upstream'}</Chip></div>
          <div className="subpanel"><div className="section-label">Correlation id</div><span className="mono">{cid}</span></div>
        </div>
        <pre className="terminal short mono" style={{ margin: 0, padding: 12, whiteSpace: 'pre-wrap' }}>{diag}</pre>
        <div className="dim" style={{ fontSize: 12 }}>Retry is idempotent. It cannot repeat work that already completed.</div>
      </div>
    </Modal>
  );
}

export const dialogs = {
  appearance: Appearance,
  'avatar-customizer': AvatarCustomizer,
  'accessibility-prefs': AccessibilityPrefs,
  'backup-restore': BackupRestore,
  'service-restart': ServiceRestart,
  'help-drawer': HelpDrawer,
  'unsaved-changes': Unsaved,
  'error-inspector': ErrorInspector,
};
