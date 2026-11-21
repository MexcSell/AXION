import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { GraduationCap, Plus, X, ShieldAlert, Info, Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Form';
import { Chip } from '@/components/ui/Chips';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { AGENT_BY_ID, AGENTS } from '@/data/agents';
import { ROLES } from '@/data/roles';
import { isApi } from '@/api/mode';
import { useAgentsCatalog } from '@/api/agents';
import { createMentoringPlan, newKey } from '@/api/mentoring';
import { toast } from '@/store/ui';
import type { DialogComponentProps } from '@/dialogs/DialogHost';
import '@/theme/pages/overview-org-agent.css';

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

/* DL-77: Start a mentoring plan (improvement cycle 19, api mode): mentor (another agent), target skill, 1-5 milestones,
   re-evaluation date. Milestones are ticked off by a person later; nothing is scored. */
function MentoringPlan({ close, props }: DialogComponentProps<{ agentId?: string }>) {
  useAgentsCatalog();
  const api_ = isApi();
  const a = AGENT_BY_ID[props.agentId ?? ''] ?? AGENTS[1];
  const mentors = useMemo(() => AGENTS.filter((x) => x.id !== a.id), [a.id]);
  const [mentorId, setMentorId] = useState('');
  useEffect(() => { if (!mentorId) setMentorId((mentors.find((x) => x.role === 'mentor') ?? mentors[0])?.id ?? ''); }, [mentors, mentorId]);
  const [skill, setSkill] = useState('');
  const [ms, setMs] = useState<string[]>(['']);
  const [reevalOn, setReevalOn] = useState(inDays(14));
  const [busy, setBusy] = useState(false);
  const [srvErr, setSrvErr] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const submitKey = useRef(newKey());
  const texts = ms.map((m) => m.trim()).filter(Boolean);
  const err = !api_ ? 'Mentoring plans are stored on the server' : !mentorId ? 'Choose a mentor' : !skill.trim() ? 'Name the target skill' : texts.length === 0 ? 'Add at least one milestone' : !reevalOn ? 'Pick the re-evaluation date' : reevalOn < inDays(0) ? 'The re-evaluation date is already past' : '';
  const touch = () => { setSrvErr(null); setFields({}); };
  const submit = async () => {
    if (err || busy) return;
    setBusy(true); touch();
    const r = await createMentoringPlan(a.id, { mentorId, skill: skill.trim(), milestones: texts, reevalOn }, submitKey.current);
    setBusy(false);
    if (!r.ok) { setSrvErr(r.message); setFields(r.fieldErrors ?? {}); submitKey.current = newKey(); return; }
    toast({ tone: 'success', title: 'Mentoring plan recorded', body: `${r.value.mentorName} mentors ${r.value.menteeName} on ${r.value.skill}.` });
    close();
  };
  const mentor = AGENT_BY_ID[mentorId];
  return (
    <Modal title={`Start a mentoring plan for ${a.name}`} icon={GraduationCap} help="mentoring.start" dialogId="DL-77" size="lg" onClose={close}
      sub="A mentor agent, a target skill, up to five milestones and a re-evaluation date. A person ticks the milestones off; no score is recorded."
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={!!err || busy} title={err || undefined} onClick={submit}>{busy ? <Loader2 size={14} className="spin" /> : <GraduationCap size={14} />}Record plan</button></>}>
      <div className="col" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 10 }}>
          <RobotAvatar role={a.role} size={44} faceMode="face" />
          <div style={{ minWidth: 0 }}><b>{a.name}</b><div className="dim" style={{ fontSize: 12 }}>{ROLES[a.role]?.label ?? a.role} · {a.dept}</div></div>
          <span className="spacer" />
          {mentor && <Chip hue={205} size="sm">mentor: {mentor.name}</Chip>}
        </div>
        {!api_ && <div className="oa-banner"><Info size={15} /><span>Mentoring plans are stored on the server. In demo mode this dialog only shows the form.</span></div>}
        <div className="oa-diff-cols">
          <div className="col" style={{ gap: 12 }}>
            <Field label="Mentor" help="mentoring.mentor" htmlFor="mp-mentor" error={fields.mentorId} hint="Another active agent, never the agent itself.">
              <select id="mp-mentor" className="select" aria-label="Mentor" value={mentorId} onChange={(e) => { touch(); setMentorId(e.target.value); }}>
                {mentors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="Target skill" help="mentoring.skill" htmlFor="mp-skill" required error={fields.skill}>
              <input id="mp-skill" data-autofocus className="input" value={skill} maxLength={120} onChange={(e) => { touch(); setSkill(e.target.value); }} placeholder="e.g. Code review" />
            </Field>
            <Field label="Re-evaluation date" help="mentoring.reeval" htmlFor="mp-date" required error={fields.reevalOn} hint="When the plan is looked at again. Results need evaluation data: agents don't execute yet.">
              <input id="mp-date" className="input" type="date" min={inDays(0)} value={reevalOn} onChange={(e) => { touch(); setReevalOn(e.target.value); }} />
            </Field>
          </div>
          <div className="col" style={{ gap: 8 }} data-milestone-editor>
            <div className="row" style={{ gap: 6 }}><div className="section-label" style={{ margin: 0 }}>Milestones ({texts.length} of 5)</div><HelpTrigger k="mentoring.milestones" /></div>
            {ms.map((m, i) => (
              <motion.div key={i} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="row" style={{ gap: 6 }}>
                <span className="dim tnum" style={{ width: 16 }}>{i + 1}</span>
                <input className="input" style={{ flex: 1, minWidth: 0, height: 32 }} value={m} maxLength={200} aria-label={`Milestone ${i + 1}`} placeholder="e.g. Review three pull requests"
                  onChange={(e) => { touch(); setMs((xs) => xs.map((x, j) => (j === i ? e.target.value : x))); }} />
                <button type="button" className="icon-btn" style={{ width: 24, height: 24 }} aria-label={`Remove milestone ${i + 1}`} disabled={ms.length === 1} onClick={() => setMs((xs) => xs.filter((_, j) => j !== i))}><X size={12} /></button>
              </motion.div>
            ))}
            <div><button type="button" className="btn sm" disabled={ms.length >= 5} onClick={() => setMs((xs) => [...xs, ''])} aria-label="Add milestone"><Plus size={13} />Add milestone</button></div>
            {fields.milestones && <span className="dim" style={{ fontSize: 12 }}>{fields.milestones}</span>}
          </div>
        </div>
        {err && api_ && <span className="dim" style={{ fontSize: 12 }} data-dialog-hint>{err}</span>}
        {srvErr && <div className="oa-banner" role="alert" data-dialog-error><ShieldAlert size={15} /><span>{srvErr}</span></div>}
      </div>
    </Modal>
  );
}

export const dialogs = { 'mentoring-plan': MentoringPlan };
