import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Accessibility, AlertTriangle, BookOpen, Bug, Copy, LifeBuoy, Palette, ScanFace, Save } from 'lucide-react';
import type { DialogComponentProps } from '@/dialogs/DialogHost';
import { Modal } from '@/components/ui/Modal';
import { Field, Segmented, SwitchRow } from '@/components/ui/Form';
import { HelpBody } from '@/components/ui/HelpTrigger';
import { Chip } from '@/components/ui/Chips';
import { AppearanceControls } from '@/components/settings/AppearanceControls';
import { FaceControls, FacePreview, RoleGallery, SynthNote } from '@/components/settings/FaceEditor';
import { LOADING_HELP, loadHelp, useHelpRegistry } from '@/help/load';
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
        <div className="subpanel"><b style={{ fontSize: 15 }}>Preview text</b><div className="muted">Verified progress counts only tasks whose evidence passed independent checks.</div></div>
      </div>
    </Modal>
  );
}

/* DL-62 */
function HelpDrawer({ close, props }: DialogComponentProps<{ k?: string }>) {
  const reg = useHelpRegistry();
  if (!reg) void loadHelp();
  const e = reg ? reg.getHelp(props.k ?? '') : LOADING_HELP;
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
  const diagnostic = [props.code, props.category, props.message].filter(Boolean).join('\n') || 'No diagnostic details were supplied.';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(diagnostic);
      toast({ tone: 'success', title: 'Diagnostic copied' });
    } catch {
      toast({ tone: 'info', title: 'Select the diagnostic text to copy it' });
    }
  };
  return (
    <Modal title="Error inspector" icon={Bug} help="dialog.errorInspector" size="md" tone="danger" dialogId="DL-65" onClose={close}
      footer={<><button className="btn" data-autofocus onClick={close}>Close</button><button className="btn primary" onClick={copy}><Copy size={14} />Copy diagnostic</button></>}>
      <pre className="terminal short mono" style={{ margin: 0, padding: 12, whiteSpace: 'pre-wrap' }}>{diagnostic}</pre>
    </Modal>
  );
}

export const dialogs = {
  appearance: Appearance,
  'avatar-customizer': AvatarCustomizer,
  'accessibility-prefs': AccessibilityPrefs,
  'help-drawer': HelpDrawer,
  'unsaved-changes': Unsaved,
  'error-inspector': ErrorInspector,
};
