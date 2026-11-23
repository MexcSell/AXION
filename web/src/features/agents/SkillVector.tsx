import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { BarChart3, ClipboardCheck, Code2, Globe, ListChecks, MessageSquare, PenLine, Search, Shield, Users, Layers, Equal, Diff, type LucideIcon } from 'lucide-react';
import { SKILL_MIN_N, type AgentSkillsDto, type SkillCellDto, type SkillCompareDto, type TaskClassId } from '@contracts';
import { Panel } from '@/components/ui/Panel';
import { Tip } from '@/components/ui/Tip';
import { DemoTag } from '@/components/ui/Chips';
import { AGENTS } from '@/data/agents';
import { demoSkills, demoCompare } from '@/data/skillDemo';
import { useAgentSkills, useSkillCompare } from '@/api/agentSkills';
import { isApi } from '@/api/mode';
import { cx } from '@/lib/format';
import '@/theme/pages/c72-skills.css';

/**
 * c72 (R3-7): the skill vector on the Agent Profile's Performance tab. One row per task class in the FIXED class order (never sorted by a rating),
 * with n, the 95% interval and "not enough evidence" below 5. It never shows a rank or a position. The optional comparison says only
 * "distinguishable" or "indistinguishable" per class, from the levels both agents share.
 */
const ICON: Record<TaskClassId, LucideIcon> = { research: Search, writing: PenLine, coding: Code2, data: BarChart3, browsing: Globe, planning: ListChecks, review: ClipboardCheck, communication: MessageSquare };

/** [1,2,3,5] -> "1–3, 5" */
export function levelText(levels: number[]): string {
  if (!levels.length) return '';
  const out: string[] = []; let a = levels[0], b = levels[0];
  for (const d of levels.slice(1).concat([99])) { if (d === b + 1) { b = d; continue; } out.push(a === b ? `${a}` : `${a}–${b}`); a = b = d; }
  return (levels.length === 1 ? 'level ' : 'levels ') + out.join(', ');
}

function Bar({ c }: { c: SkillCellDto }) {
  const a = c.adjusted;
  return (
    <span className={cx('sk-bar', !a && 'none')} aria-hidden>
      {a && <>
        <motion.i className="sk-range" initial={{ opacity: 0, scaleX: .2 }} animate={{ opacity: 1, scaleX: 1 }} transition={{ duration: .5 }} style={{ left: `${a.lo}%`, width: `${Math.max(2, a.hi - a.lo)}%` }} />
        <motion.b className="sk-dot" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: .25 }} style={{ left: `${a.value}%` }} />
      </>}
    </span>
  );
}

function Row({ c, i, verdict }: { c: SkillCellDto; i: number; verdict?: SkillCompareDto['classes'][number] }) {
  const Icon = ICON[c.classId];
  const a = c.adjusted;
  const lv = c.levels.map((l) => l.difficulty);
  return (
    <motion.li className={cx('sk-row', !a && 'none')} data-skill-class={c.classId} data-skill-state={c.state} data-skill-n={c.n} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .03 * i }}>
      <span className="sk-name"><Icon size={14} aria-hidden />{c.label}</span>
      <span className="sk-n tnum" title="finished tasks with a stated class and difficulty">n={c.n}</span>
      {a ? (
        <Tip label={c.evidence}>
          <span className="sk-val" tabIndex={0} data-skill-value={a.value}><b className="tnum">{a.value}%</b><small className="tnum">{a.lo}–{a.hi}</small><Bar c={c} /></span>
        </Tip>
      ) : (
        <span className="sk-val none" data-skill-null>{c.n === 0 ? 'no tasks yet' : `not enough evidence (${c.n} of ${SKILL_MIN_N})`}<Bar c={c} /></span>
      )}
      <span className="sk-lv" title="The difficulty levels the adjusted rate is built from. Rates are comparable between agents only on the same levels.">{lv.length ? <span className="chip sm">{levelText(lv)}</span> : null}</span>
      <span className="sk-raw tnum dim" title="Raw pass rate, not adjusted for difficulty">{c.raw ? `raw ${c.raw.value}%` : ''}</span>
      {verdict !== undefined && <VerdictChip v={verdict} />}
    </motion.li>
  );
}

function VerdictChip({ v }: { v?: SkillCompareDto['classes'][number] }) {
  if (!v) return <span className="sk-vd none dim">—</span>;
  const d = v.verdict === 'distinguishable';
  return (
    <Tip label={`${v.reason}${v.sharedLevels.length ? ` Shared: ${levelText(v.sharedLevels)}.` : ''}`}>
      <span className={cx('sk-vd', d ? 'dist' : 'same')} tabIndex={0} data-verdict={v.verdict}>{d ? <Diff size={12} aria-hidden /> : <Equal size={12} aria-hidden />}{v.verdict}</span>
    </Tip>
  );
}

export function SkillVector({ agentId, agentName }: { agentId: string; agentName: string }) {
  const api_ = isApi();
  const srv = useAgentSkills(agentId);
  const [withId, setWithId] = useState('');
  const srvCmp = useSkillCompare(agentId, withId || null);
  const demo = useMemo(() => (api_ ? null : demoSkills(agentId)), [api_, agentId]);
  const demoCmp = useMemo(() => (api_ || !withId ? null : demoCompare(agentId, withId)), [api_, agentId, withId]);
  const data: AgentSkillsDto | null = api_ ? srv.data : demo;
  const cmp: SkillCompareDto | null = api_ ? srvCmp.data : demoCmp;
  const others = useMemo(() => AGENTS.filter((a) => a.id !== agentId && a.id !== 'gm').sort((x, y) => x.name.localeCompare(y.name)), [agentId]); // listed by name
  const rated = data ? data.classes.filter((c) => c.state === 'ok').length : 0;
  return (
    <Panel icon={Layers} titleSize="lg" title="Skills by task class" help="agent.skillVector" delay={.03} className="sk-panel" data-testid="skill-vector"
      sub={data ? `${rated} of ${data.classes.length} classes have enough evidence (${SKILL_MIN_N} or more tasks)` : undefined}
      actions={<div className="row" style={{ gap: 8 }}>
        <label className="sk-cmp"><span className="dim">Compare with</span>
          <select className="select" aria-label="Compare with another agent" value={withId} onChange={(e) => setWithId(e.target.value)}>
            <option value="">no one</option>
            {others.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        {api_ ? <span className="demo-tag measured" title="Counted on the server from finished tasks">measured</span> : <DemoTag />}
      </div>}>
      {!data ? <div className="dim" style={{ fontSize: 13 }}>{srv.error ?? 'Loading the skill ratings…'}</div> : (
        <>
          <div className="sk-head dim" aria-hidden><span>Task class</span><span>Tasks</span><span>Adjusted pass rate, 95% interval</span><span>Levels used</span><span>Unadjusted</span>{cmp && <span>vs {others.find((o) => o.id === withId)?.name ?? withId}</span>}</div>
          <ul className={cx('sk-rows', cmp && 'cmp')} aria-label={`Skills of ${agentName}, one row per task class`}>
            {data.classes.map((c, i) => <Row key={c.classId} c={c} i={i} verdict={cmp ? cmp.classes.find((x) => x.classId === c.classId) : undefined} />)}
          </ul>
          {withId && (cmp ? <div className="sk-note dim"><Equal size={12} aria-hidden /> Compared only on difficulty levels both agents have. It says whether the two are distinguishable, never who is better.{cmp.classes.length === 0 ? ' Neither agent has any rated task yet.' : ''}</div> : srvCmp.loading ? <div className="sk-note dim">Comparing…</div> : srvCmp.error ? <div className="sk-note dim">{srvCmp.error}</div> : null)}
          <div className="sk-foot dim">
            <Tip label={data.dependsOn.text}><span className="sk-f" tabIndex={0}><Shield size={12} aria-hidden /> Depends on the difficulty the delegator stated{data.unrated ? ` · ${data.unrated} finished task${data.unrated === 1 ? '' : 's'} without class and difficulty left out` : ''}</span></Tip>
            <Tip label={data.pairRatings.why}><span className="sk-f" tabIndex={0}><Users size={12} aria-hidden /> Pair ratings: not built</span></Tip>
          </div>
        </>
      )}
    </Panel>
  );
}
