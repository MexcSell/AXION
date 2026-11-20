import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, ClipboardList, KeyRound, Gauge, ScrollText, FileText, Lock, Timer, AlertTriangle, CheckCircle2, XCircle, Eye, Search, Download, RotateCw, Ban, Plus, Link2, Hash, GitBranch, ArrowRight, Check, Shield } from 'lucide-react';
import { TopBoard, FrameBody, type KpiItem } from '@/components/layout/PageFrame';
import { Tabs } from '@/components/ui/Tabs';
import { Chip, DemoTag } from '@/components/ui/Chips';
import { IconButton } from '@/components/ui/IconButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { useTab } from '@/hooks/useTab';
import { useData, allApprovals } from '@/store/data';
import { AGENT_BY_ID } from '@/data/agents';
import { MISSION_STATUS } from '@/data/roles';
import { toast, openDialog } from '@/store/ui';
import { ago, cx } from '@/lib/format';
import { AUTONOMY_LABEL, AUTONOMY_NOTE, CONSTITUTION, GOV_AUDIT, PERMISSION_GRANTS, POLICY_DIFF, RISK_TIER, useUG } from '@/data/users-governance';
import type { Approval } from '@/data/types';
import '@/theme/pages/users-governance-notifications.css';

export default function GovernancePage() {
  const [tab, setTab, tabs] = useTab('governance');
  const icons = [ClipboardList, Shield, Gauge, FileText, KeyRound, ScrollText];
  const missions = useData((s) => s.missions);
  const decisions = useData((s) => s.approvalDecisions);
  const all = useMemo(() => allApprovals(missions, decisions), [missions, decisions]);
  const pending = all.filter((a) => a.status === 'pending');
  const secrets = useUG((s) => s.secrets);
  const kpis: KpiItem[] = [
    { key: 'pend', icon: ClipboardList, value: pending.length, label: 'Pending approvals', hint: 'across missions', color: '#fbbf24', help: 'gv.kpi.pending', onClick: () => setTab('Approvals') },
    { key: 'risk', icon: AlertTriangle, value: pending.filter((a) => a.risk === 'high' || a.risk === 'critical').length, label: 'High risk (R3+)', hint: 'Admin / Owner gate', color: '#fb7185', help: 'gv.kpi.risk', onClick: () => setTab('Approvals') },
    { key: 'exp', icon: Timer, value: pending.filter((a) => a.expiresMin <= 45).length, label: 'Expiring soon', hint: 'under 45 min', color: '#22d3ee', help: 'gv.kpi.expiring', onClick: () => setTab('Approvals') },
    { key: 'rot', icon: KeyRound, value: secrets.filter((s) => s.state === 'due' || s.state === 'overdue').length, label: 'Rotations due', hint: 'secret references', color: '#a78bfa', help: 'gv.kpi.rotations', onClick: () => setTab('Secrets') },
  ];
  return (
    <div className="page ug-page">
      <TopBoard icon={ShieldCheck} title="Governance" help="gv.page" sub="Exact-action approvals, grants, autonomy limits and the company constitution."
        actions={<><DemoTag /><span className="ug-chain"><Lock size={13} />Audit chain verified</span></>}
        kpis={kpis}
        tabs={{ tabs, value: tab, onChange: setTab, icons, ariaLabel: 'Governance views', counts: { Approvals: pending.length } }}
        toolbar={<span>{{ Approvals: 'Exact actions waiting for a human decision.', Permissions: 'Grants per agent, site and tool, with expiry.', Autonomy: 'How far each risk tier may act alone.', Policies: 'Company rules agents cannot change.', Secrets: 'Secret references and rotation.', Audit: 'Hash-chained record of every decision.' }[tab]}</span>} />
      <FrameBody tab={tab}>
        {tab === 'Approvals' && <Approvals all={all} />}
        {tab === 'Permissions' && <Permissions />}
        {tab === 'Autonomy' && <Autonomy />}
        {tab === 'Policies' && <Policies />}
        {tab === 'Secrets' && <Secrets />}
        {tab === 'Audit' && <AuditTab />}
      </FrameBody>
    </div>
  );
}

/* ---------------- Approvals ---------------- */
function Approvals({ all }: { all: Approval[] }) {
  const decide = useData((s) => s.decideApproval);
  const nav = useNavigate();
  const [risk, setRisk] = useState<'all' | 'critical' | 'high' | 'medium' | 'low'>('all');
  const pending = all.filter((a) => a.status === 'pending' && (risk === 'all' || a.risk === risk)).sort((a, b) => RISK_TIER[a.risk].order - RISK_TIER[b.risk].order || a.expiresMin - b.expiresMin);
  const resolved = all.filter((a) => a.status !== 'pending');
  const quick = (a: Approval, d: 'approved' | 'denied') => {
    if (a.risk === 'critical' || d === 'denied') { openDialog('approval-decision', { approvalId: a.id }); return; }
    decide(a.id, d);
    toast({ tone: 'success', title: 'Approved (demo)', body: `${a.title} · ${a.missionId}` });
  };
  return (
    <div className="ug-approvals">
      <div className="col" style={{ gap: 10, minWidth: 0 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="muted" style={{ fontSize: 13 }}>Sorted by risk, then expiry. Each decision covers one exact action.</span><HelpTrigger k="gv.approvals" /><span className="spacer" />
          <Tabs size="sm" ariaLabel="Risk filter" value={risk} onChange={setRisk} tabs={[{ key: 'all', label: 'All' }, { key: 'critical', label: 'R4' }, { key: 'high', label: 'R3' }, { key: 'medium', label: 'R2' }, { key: 'low', label: 'R1' }]} />
        </div>
        <div className="col ug-queue" style={{ gap: 10 }}>
          <AnimatePresence mode="popLayout">
            {pending.map((a, i) => {
              const r = RISK_TIER[a.risk]; const ag = AGENT_BY_ID[a.agentId];
              return (
                <motion.article key={a.id} layout className="glass-card ug-appr" style={{ ['--h' as string]: r.hue }}
                  initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 120, scale: .94, transition: { duration: .35 } }} transition={{ delay: Math.min(i, 6) * .05, type: 'spring', stiffness: 260, damping: 26 }}>
                  <span className="ug-appr-edge" />
                  <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                    {ag ? <RobotAvatar role={ag.role} size={44} /> : null}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="row wrap" style={{ gap: 6 }}>
                        <Chip hue={r.hue} solid size="sm">{r.tier} · {r.label}</Chip><Chip hue={225} size="sm">{a.kind}</Chip>
                        <button className="ug-link mono" onClick={() => nav(`/missions/${a.missionId}?tab=approvals`)}>{a.missionId}</button>
                        <span className="spacer" /><span className={cx('ug-expiry', a.expiresMin <= 30 && 'hot')}><Timer size={13} />expires in {a.expiresMin} min</span>
                      </div>
                      <h3 className="ug-appr-title">{a.title}</h3>
                      <p className="muted" style={{ fontSize: 12.5 }}>{a.detail}</p>
                      <div className="dim" style={{ fontSize: 11.5, marginTop: 4 }}>Requested by <b>{ag?.name ?? a.agentId}</b> · {ago(a.agoMin)} · {a.id}</div>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                    <button className="btn sm ghost" onClick={() => openDialog('approval-decision', { approvalId: a.id })}><Eye size={14} />Details</button>
                    <button className="btn sm danger" onClick={() => quick(a, 'denied')}><XCircle size={14} />Deny</button>
                    <button className="btn sm good" onClick={() => quick(a, 'approved')}><CheckCircle2 size={14} />{a.risk === 'critical' ? 'Review' : 'Approve'}</button>
                  </div>
                </motion.article>
              );
            })}
          </AnimatePresence>
          {pending.length === 0 && <EmptyState icon={CheckCircle2} title="Queue is clear" body={risk === 'all' ? 'No approvals are waiting. New requests from agents appear here.' : 'Nothing at this risk tier.'} action={risk !== 'all' ? <button className="btn" onClick={() => setRisk('all')}>Show all</button> : undefined} />}
        </div>
      </div>
      <aside className="subpanel ug-resolved">
        <div className="row" style={{ marginBottom: 8 }}><b>Resolved</b><HelpTrigger k="gv.resolved" /><span className="spacer" /><Chip hue={225} size="sm">{resolved.length}</Chip></div>
        <div className="col" style={{ gap: 6 }}>
          <AnimatePresence initial={false}>
            {resolved.map((a) => (
              <motion.div key={a.id} layout className="ug-res-row" initial={{ opacity: 0, x: -60, scale: .9 }} animate={{ opacity: 1, x: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 22 }}>
                {a.status === 'approved' ? <CheckCircle2 size={16} className="good" /> : <XCircle size={16} className="bad" />}
                <div style={{ minWidth: 0 }}><b className="ellipsis" style={{ display: 'block', fontSize: 12.5 }}>{a.title}</b><span className="dim" style={{ fontSize: 11.5 }}>{a.status} by Luca · {a.missionId}</span></div>
              </motion.div>))}
          </AnimatePresence>
          {resolved.length === 0 && <div className="dim" style={{ fontSize: 12.5, padding: '14px 4px' }}>Decisions you make appear here, with who, when and why. They cannot be edited.</div>}
        </div>
      </aside>
    </div>
  );
}

/* ---------------- Permissions ---------------- */
function Permissions() {
  const [kind, setKind] = useState('all');
  const [gone, setGone] = useState<Record<string, string>>({});
  const rows = PERMISSION_GRANTS.filter((g) => kind === 'all' || g.kind === kind);
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <span className="muted" style={{ fontSize: 13 }}>Inventory of per-site, per-tool, per-mission and tenant grants. Every grant expires.</span><HelpTrigger k="gv.permissions" /><span className="spacer" />
        <Tabs size="sm" ariaLabel="Grant kind" value={kind} onChange={setKind} tabs={['all', 'site', 'tool', 'mission', 'tenant'].map((k) => ({ key: k, label: k[0].toUpperCase() + k.slice(1) }))} />
        <button className="btn primary" onClick={() => toast({ tone: 'info', title: 'Grant request (demo)', body: 'A request would be raised for exact scope and expiry, then land in the Approvals queue.' })}><Plus size={15} />Request grant</button>
      </div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Subject</th><th>Kind</th><th>Scope</th><th>Level</th><th>Mission</th><th>Tier</th><th>Expires</th><th /></tr></thead>
        <tbody><AnimatePresence initial={false}>{rows.map((g, i) => {
          const st = gone[g.id];
          return (
            <motion.tr key={g.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: st ? .5 : 1, y: 0 }} transition={{ delay: i * .04 }}>
              <td><b>{g.subject}</b></td><td><Chip hue={g.kind === 'site' ? 200 : g.kind === 'tool' ? 275 : g.kind === 'mission' ? 165 : 45} size="sm">{g.kind}</Chip></td>
              <td className="mono">{g.scope}</td><td>{g.level}</td><td className="mono dim">{g.mission}</td><td><Chip hue={g.risk === 'R3' ? 25 : g.risk === 'R1' ? 165 : 200} size="sm">{g.risk}</Chip></td>
              <td className="dim">{st ?? (g.expiresH < 48 ? `in ${g.expiresH} h` : `in ${Math.round(g.expiresH / 24)} d`)}</td>
              <td><span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                <IconButton icon={Timer} label="Expire now" size="xs" disabled={!!st} onClick={() => { setGone({ ...gone, [g.id]: 'expired' }); toast({ tone: 'info', title: 'Grant expired (demo)', body: `${g.subject} · ${g.scope}` }); }} />
                <IconButton icon={Ban} label="Revoke grant" size="xs" variant="danger" disabled={!!st} onClick={() => { setGone({ ...gone, [g.id]: 'revoked' }); toast({ tone: 'success', title: 'Grant revoked (demo)', body: `${g.subject} · ${g.scope}` }); }} />
              </span></td>
            </motion.tr>);
        })}</AnimatePresence></tbody>
      </table></div>
    </div>
  );
}

/* ---------------- Autonomy ---------------- */
function Autonomy() {
  const missions = useData((s) => s.missions).filter((m) => m.status !== 'archived' && m.status !== 'draft').slice(0, 8);
  const cur = useUG((s) => s.autonomy);
  const set = useUG((s) => s.setAutonomy);
  const base = (id: string, i: number) => 1 + ((id.charCodeAt(id.length - 1) + i) % 3);
  const [applied, setApplied] = useState<Record<string, number>>({});
  const val = (id: string, i: number) => cur[id] ?? applied[id] ?? base(id, i);
  const old = (id: string, i: number) => applied[id] ?? base(id, i);
  const diffs = missions.map((m, i) => ({ m, from: old(m.id, i), to: val(m.id, i) })).filter((d) => d.from !== d.to);
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row wrap"><span className="muted" style={{ fontSize: 13 }}>Bound how far agents act alone per mission. Raising a limit shows a diff first. Execute never bypasses R4 Owner gates.</span><HelpTrigger k="gv.autonomy" /></div>
      <div className="col" style={{ gap: 8 }}>
        {missions.map((m, i) => {
          const v = val(m.id, i); const changed = v !== old(m.id, i);
          return (
            <motion.div key={m.id} className={cx('subpanel glass-card ug-auto', changed && 'selected')} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * .04 }}>
              <div style={{ minWidth: 0, width: 230 }}>
                <div className="row"><span className="mono dim" style={{ fontSize: 11.5 }}>{m.id}</span><Chip hue={MISSION_STATUS[m.status].hue} size="sm">{MISSION_STATUS[m.status].label}</Chip></div>
                <b className="ellipsis" style={{ display: 'block', fontSize: 13.5 }}>{m.title}</b>
              </div>
              <div className="ug-slider" role="slider" aria-label={`Autonomy for ${m.id}`} aria-valuemin={0} aria-valuemax={3} aria-valuenow={v} aria-valuetext={AUTONOMY_LABEL[v]} tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'ArrowRight') set(m.id, Math.min(3, v + 1)); if (e.key === 'ArrowLeft') set(m.id, Math.max(0, v - 1)); }}>
                <div className="ug-slider-track"><motion.i animate={{ width: `${(v / 3) * 100}%` }} transition={{ type: 'spring', stiffness: 300, damping: 30 }} /></div>
                {AUTONOMY_LABEL.map((l, k) => (
                  <button key={l} type="button" tabIndex={-1} className={cx('ug-stop', k <= v && 'on', k === v && 'cur', k === 3 && 'exec')} style={{ left: `${(k / 3) * 100}%` }} onClick={() => set(m.id, k)} aria-label={`Set ${l}`}>
                    <span className="ug-stop-dot" /><span className="ug-stop-lbl">{l}</span>
                  </button>))}
              </div>
              <div className="dim ug-auto-note">{AUTONOMY_NOTE[v]}</div>
            </motion.div>);
        })}
      </div>
      <AnimatePresence>
        {diffs.length > 0 && (
          <motion.div className="ug-diffbar" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}>
            <GitBranch size={18} className="info" />
            <div className="col" style={{ gap: 3, flex: 1, fontSize: 12.5 }}>
              <b>{diffs.length} pending autonomy change(s)</b>
              <div className="row wrap" style={{ gap: 6 }}>{diffs.map((d) => <span key={d.m.id} className={cx('ug-delta-chip', d.to > d.from ? 'up' : 'down')}>{d.m.id}: {AUTONOMY_LABEL[d.from]} <ArrowRight size={11} /> {AUTONOMY_LABEL[d.to]}</span>)}</div>
            </div>
            <button className="btn" onClick={() => { diffs.forEach((d) => set(d.m.id, d.from)); toast({ tone: 'info', title: 'Changes discarded' }); }}>Discard</button>
            <button className="btn primary" onClick={() => { setApplied((a) => ({ ...a, ...Object.fromEntries(diffs.map((d) => [d.m.id, d.to])) })); diffs.forEach((d) => set(d.m.id, d.to)); toast({ tone: 'success', title: 'Autonomy policy applied (demo)', body: diffs.some((d) => d.to === 3) ? 'Execute limits need Owner confirmation in the real product.' : `${diffs.length} mission(s) updated.` }); }}><Check size={15} />Apply policy</button>
          </motion.div>)}
      </AnimatePresence>
    </div>
  );
}

/* ---------------- Policies ---------------- */
function Policies() {
  const [diff, setDiff] = useState(false);
  const revs = useUG((s) => s.revisions);
  return (
    <div className="ug-pol">
      <div className="col" style={{ gap: 10, minWidth: 0 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <b>Company constitution</b><Chip hue={150} size="sm">v6 · in force</Chip><HelpTrigger k="gv.policies" /><span className="spacer" />
          <button className={cx('btn sm', diff && 'primary')} onClick={() => setDiff(!diff)} aria-pressed={diff}><GitBranch size={14} />{diff ? 'Hide diff' : 'View diff v5 → v6'}</button>
          <button className="btn sm" onClick={() => openDialog('policy-revision', { clause: 'C-2 · Exact-action approval' })}>Propose revision</button>
        </div>
        <AnimatePresence initial={false}>
          {diff && (
            <motion.div className="ug-diff big" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
              {POLICY_DIFF.map((l, i) => <motion.div key={i} className={cx('ug-diff-l', l.t)} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * .05 }}><em>{l.n}</em><i>{l.t === 'add' ? '+' : l.t === 'del' ? '-' : ' '}</i>{l.s}</motion.div>)}
            </motion.div>)}
        </AnimatePresence>
        {CONSTITUTION.map((c, i) => (
          <motion.div key={c.id} className="subpanel glass-card hoverable ug-clause" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .05 }}>
            <span className="ug-clause-n">{i + 1}</span>
            <div style={{ minWidth: 0, flex: 1 }}><b>{c.title}</b><p className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{c.body}</p></div>
            <Chip hue={225} size="sm">{c.version}</Chip>
            <IconButton icon={FileText} label={`Propose revision to ${c.title}`} size="sm" onClick={() => openDialog('policy-revision', { clause: `${c.id} · ${c.title}` })} />
          </motion.div>))}
      </div>
      <div className="col" style={{ gap: 10 }}>
        <div className="subpanel glass-card"><div className="row" style={{ marginBottom: 8 }}><b>Prohibited tools</b><HelpTrigger k="gv.prohibited" /></div>
          <div className="row wrap" style={{ gap: 6 }}>{['wallet transfer', 'token trading', 'credential export', 'unattended delete', 'self-promotion'].map((t) => <Chip key={t} hue={0} size="sm" icon={Ban}>{t}</Chip>)}</div></div>
        <div className="subpanel glass-card"><div className="row" style={{ marginBottom: 8 }}><b>Trust hierarchy</b><HelpTrigger k="gv.trust" /></div>
          {['Owner policy', 'Admin configuration', 'Mission instruction', 'Agent suggestion', 'Web page content'].map((t, i) => (
            <div key={t} className="row" style={{ gap: 8, marginBottom: 6, fontSize: 12.5 }}><span className="dim" style={{ width: 14 }}>{i + 1}</span><div className="bar thin" style={{ flex: 1 }}><motion.i initial={{ width: 0 }} animate={{ width: `${100 - i * 20}%` }} transition={{ delay: .2 + i * .08, duration: .8 }} /></div><span style={{ width: 130 }}>{t}</span></div>))}
        </div>
        <div className="subpanel glass-card"><div className="row" style={{ marginBottom: 8 }}><b>Revision proposals</b></div>
          {revs.length === 0 ? <span className="dim" style={{ fontSize: 12.5 }}>None pending. Submitted proposals appear here until an Owner decides.</span> : revs.map((r) => <div key={r.id} className="list-row"><Chip hue={45} size="sm">awaiting Owner</Chip>{r.title}</div>)}</div>
      </div>
    </div>
  );
}

/* ---------------- Secrets ---------------- */
function Secrets() {
  const secrets = useUG((s) => s.secrets);
  const rotate = useUG((s) => s.rotateSecret);
  const revoke = useUG((s) => s.revokeSecret);
  const hue = { ok: 150, due: 45, overdue: 0, revoked: 230 };
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row wrap"><Lock size={15} className="good" /><span className="muted" style={{ fontSize: 13 }}>References only. Values stay in the vault and are never shown, copied or sent to agents.</span><HelpTrigger k="gv.secrets" /><span className="spacer" />
        <button className="btn primary" onClick={() => openDialog('secret-connector')}><Plus size={15} />Connect reference</button></div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Reference</th><th>Value</th><th>Provider</th><th>Scope</th><th>Owner</th><th>Last rotated</th><th>Status</th><th>Accesses</th><th /></tr></thead>
        <tbody><AnimatePresence initial={false}>{secrets.map((s, i) => (
          <motion.tr key={s.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .04 }}>
            <td><span className="row"><KeyRound size={15} className="warn" /><span className="mono">{s.ref}</span></span></td>
            <td className="mono dim" aria-label="Value hidden">••••••••••••</td><td>{s.provider}</td><td className="dim">{s.scope}</td><td>{s.owner}</td>
            <td className="tnum">{s.rotatedDays === 0 ? 'today' : `${s.rotatedDays} d ago`}</td>
            <td><Chip hue={hue[s.state]} size="sm"><span className="dot sm" />{s.state === 'due' ? `due in ${s.dueDays} d` : s.state === 'overdue' ? `overdue ${-s.dueDays} d` : s.state === 'ok' ? `next in ${s.dueDays} d` : 'revoked'}</Chip></td>
            <td className="tnum dim">{s.accesses.toLocaleString()}</td>
            <td><span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
              <IconButton icon={RotateCw} label="Request rotation" size="xs" disabled={s.state === 'revoked'} onClick={() => { rotate(s.id); toast({ tone: 'success', title: 'Rotation recorded (demo)', body: `${s.ref}. A new value would be stored by the vault, never shown here.` }); }} />
              <IconButton icon={Ban} label="Revoke reference" size="xs" variant="danger" disabled={s.state === 'revoked'} onClick={() => { revoke(s.id); toast({ tone: 'info', title: 'Reference revoked (demo)', body: s.ref }); }} />
            </span></td>
          </motion.tr>))}</AnimatePresence></tbody>
      </table></div>
    </div>
  );
}

/* ---------------- Audit ---------------- */
function AuditTab() {
  const [q, setQ] = useState('');
  const [f, setF] = useState<'all' | 'allowed' | 'denied' | 'review'>('all');
  const rows = GOV_AUDIT.filter((r) => (f === 'all' || r.result === f) && (r.actor + r.action + r.target).toLowerCase().includes(q.toLowerCase()));
  const hue = { allowed: 150, denied: 0, review: 45 };
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="input-wrap" style={{ width: 260 }}><Search size={15} /><input className="input" placeholder="Query actor, event, target..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Query audit" /></div>
        <Tabs size="sm" ariaLabel="Policy decision" value={f} onChange={setF} tabs={[{ key: 'all', label: 'All' }, { key: 'allowed', label: 'Allowed' }, { key: 'review', label: 'Review' }, { key: 'denied', label: 'Denied' }]} />
        <HelpTrigger k="gv.audit" /><span className="spacer" />
        <span className="ug-chain"><Link2 size={13} />Append-only · hash chained · signed</span>
        <button className="btn" onClick={() => toast({ tone: 'info', title: 'Export (demo)', body: 'A sanitized, signed evidentiary log would be generated. Nothing is written.' })}><Download size={15} />Export</button>
      </div>
      <div className="ug-ledger">
        {rows.map((r, i) => (
          <motion.div key={r.id} className="ug-ledger-row" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 14) * .025 }}>
            <span className="ug-node"><Hash size={12} /></span>
            <span className="mono dim ug-l-id">{r.id}</span>
            <span className="dim ug-l-when">{ago(r.agoMin)}</span>
            <b className="ug-l-actor">{r.actor}</b>
            <span className="mono ug-l-ev">{r.action}</span>
            <span className="mono dim ellipsis ug-l-target">{r.target}</span>
            <Chip hue={hue[r.result]} size="sm">{r.result}</Chip>
            <span className="mono ug-l-hash" title={`prev ${r.trace}`}>{r.hash}…</span>
            <Lock size={12} className="good" />
          </motion.div>))}
        {rows.length === 0 && <EmptyState icon={ScrollText} title="No events match" body="Adjust the query." />}
      </div>
    </div>
  );
}
