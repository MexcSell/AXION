import { motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, ListChecks, Layers, Users, UserX, FileX2, Ruler, ArrowDownUp, Crown, Copy } from 'lucide-react';
import type { OrgCoverage, OrgCoverageChange } from '@contracts';
import { Panel } from '@/components/ui/Panel';
import { Chip } from '@/components/ui/Chips';
import { useAgentsCatalog } from '@/api/agents';
import { useOrgCoverage } from '@/api/orgProposals';
import { AGENT_BY_ID } from '@/data/agents';
import { roleMeta } from '@/data/roles';

/* Improvement cycle 20 (api mode): does the structure cover the company's needs? Facts about the chart only (roles with
   no active agent, duplicate roles, departments without a head, managers with no reports, agents with no duty, span of
   control, depth). Warnings for the reader: they never block an approval. */
const name = (id: string) => AGENT_BY_ID[id]?.name ?? id;
const role = (r: string) => roleMeta(r).label;

/** The facts as compact chips; `none` facts show a quiet "ok" chip so the reader sees they were checked. */
export function CoverageFacts({ c, id }: { c: OrgCoverage; id?: string }) {
  const covered = c.roles.length - c.missingRoles.length;
  return (
    <div className="oa-cov" data-coverage={id ?? ''} data-coverage-missing={c.missingRoles.join(',')} data-coverage-depth={c.depth} data-coverage-span={c.span.max}>
      <div className="row wrap" style={{ gap: 6 }}>
        <Chip hue={c.missingRoles.length ? 38 : 145} icon={c.missingRoles.length ? AlertTriangle : CheckCircle2} size="sm" title="Catalog roles held by an active agent that is in the chart">
          <span data-cov="roles">{covered}/{c.roles.length} roles covered</span>
        </Chip>
        <Chip hue={225} icon={Ruler} size="sm" title={c.span.agentId ? `Largest span of control: ${name(c.span.agentId)}` : 'Nobody manages anyone'}>
          <span data-cov="span">span {c.span.max}</span>{c.span.agentId ? <> · {name(c.span.agentId)}</> : null}
        </Chip>
        <Chip hue={225} icon={ArrowDownUp} size="sm" title="Levels in the longest reporting chain, the GM being level 1"><span data-cov="depth">depth {c.depth}</span></Chip>
      </div>
      <ul className="oa-cov-list">
        <Fact on={c.missingRoles.length > 0} icon={Layers} cov="missing" label="No active agent for" items={c.missingRoles.map(role)} ok="Every catalog role has an agent" />
        <Fact on={c.duplicateRoles.length > 0} icon={Copy} cov="duplicate" label="Role held twice" items={c.duplicateRoles.map((d) => `${role(d.role)} (${d.agentIds.map(name).join(', ')})`)} ok="No role is held twice" />
        <Fact on={c.deptsWithoutHead.length > 0} icon={Crown} cov="nohead" label="Department without a head" items={c.deptsWithoutHead} ok="Every department has a head" />
        <Fact on={c.managersWithoutReports.length > 0} icon={Users} cov="noreports" label="Manager with no reports" items={c.managersWithoutReports.map(name)} ok="Every manager has reports" />
        <Fact on={c.agentsWithoutDuty.length > 0} icon={FileX2} cov="noduty" label="Agent with no duty" items={c.agentsWithoutDuty.map(name)} ok="Every agent has a duty" />
      </ul>
    </div>
  );
}
function Fact({ on, icon: I, cov, label, items, ok }: { on: boolean; icon: typeof Users; cov: string; label: string; items: string[]; ok: string }) {
  return (
    <li className={on ? 'warn' : 'ok'} data-cov-fact={cov} data-cov-on={on ? '1' : '0'}>
      {on ? <I size={13} aria-hidden /> : <CheckCircle2 size={13} aria-hidden />}
      <span>{on ? <><b>{label}:</b> {items.join(', ')}</> : ok}</span>
    </li>
  );
}

/** What a proposal changes in the coverage (from the server's dry run). Nothing is shown when nothing changes. */
export function CoverageChanges({ changes }: { changes: OrgCoverageChange[] }) {
  if (!changes.length) return null;
  const bad = (c: OrgCoverageChange) => c.code === 'ROLE_UNCOVERED' || c.code === 'HEAD_LOST' || c.code === 'MANAGER_ORPHANED';
  return (
    <div className="oa-covchg" data-coverage-changes={changes.length}>
      <div className="row" style={{ gap: 6, fontSize: 11.5 }} ><ListChecks size={12} aria-hidden /><b>Roles and structure</b></div>
      {changes.map((c, i) => (
        <motion.div key={c.code + (c.role ?? c.dept ?? c.agentId ?? '') + i} className={'oa-issue ' + (bad(c) ? 'warn' : 'ok')} data-cov-change={c.code} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * .03 }}>
          {bad(c) ? <AlertTriangle size={13} aria-hidden /> : <CheckCircle2 size={13} aria-hidden />}<span>{c.role ? c.message.replace(`role ${c.role}`, `role ${role(c.role)}`) : c.message}</span>
        </motion.div>
      ))}
    </div>
  );
}

/** Agents › Policies (api mode): the active revision's coverage. */
export function CoverageCard() {
  useAgentsCatalog(); // names follow the live catalog
  const { data, error } = useOrgCoverage();
  return (
    <Panel icon={UserX} title="Org Coverage" help="org.coverage" sub={data ? `Active revision ${data.revision}: facts, not errors.` : 'Does the structure cover the company?'} delay={.12} data-coverage-card="">
      {error && !data ? <div className="oa-banner" role="alert"><AlertTriangle size={15} /><span>Coverage not loaded: {error}</span></div>
        : !data ? <div className="dim" style={{ padding: 12 }}>Loading coverage…</div>
        : <CoverageFacts c={data.coverage} id="active" />}
    </Panel>
  );
}
