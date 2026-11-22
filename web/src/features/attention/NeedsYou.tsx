import { AnimatePresence, motion } from 'motion/react';
import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellRing, CheckCircle2, ClipboardCheck, GitPullRequest, Hourglass, Layers, Lightbulb, Lock, ArrowRight, ShieldCheck, Siren, SearchCheck, Clock3, Activity, MousePointerClick, ListOrdered, RefreshCw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ATTENTION_REASONS, attentionReason, type AttentionIcon, type AttentionMemberDto, type AttentionRowDto } from '@contracts';
import { useAttention } from '@/api/attention';
import { isApi } from '@/api/mode';
import { Panel } from '@/components/ui/Panel';
import { Chip, DemoTag } from '@/components/ui/Chips';
import { EmptyState } from '@/components/ui/EmptyState';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Segmented } from '@/components/ui/Form';
import { cx } from '@/lib/format';
import '@/theme/pages/c68-attention.css';

/**
 * "Needs you" (c68, R3-9): one ranked list of what needs a person now. Each row has a reason code, a one-sentence why built by the
 * server from stored fields, and a ? that explains the reason. A row opens in three levels: Activity (the items), Action (what you
 * can do, by the source route's own rule) and Evidence (the check that would expose a defect). From the list the evidence is two
 * clicks away (choose the row, choose Evidence). The order is a fixed design choice and changes no decision.
 */
const ICON: Record<AttentionIcon, LucideIcon> = { 'shield-check': ShieldCheck, 'clipboard-check': ClipboardCheck, hourglass: Hourglass, siren: Siren, 'git-pull-request': GitPullRequest, lightbulb: Lightbulb };
const KIND_HUE: Record<string, number> = { approval: 30, task_review: 175, task_waiting: 205, failure: 350, proposal: 270, lesson: 150 };
const TIER_HUE: Record<string, number> = { R2: 45, R3: 22, R4: 350 };

/** "12 min", "2 h 5 min", "31 h", "3 days": whole units, short, for a crowded row. */
export function span(sec: number): string {
  const m = Math.floor(sec / 60);
  if (m < 1) return '<1 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 10) return m % 60 ? `${h} h ${m % 60} m` : `${h} h`;
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}
const LEVELS = [{ key: 'activity', label: 'Activity', icon: Activity }, { key: 'action', label: 'Action', icon: MousePointerClick }, { key: 'evidence', label: 'Evidence', icon: SearchCheck }] as const;
type Level = (typeof LEVELS)[number]['key'];

function Time({ r }: { r: { ageSec: number; expiresInSec: number | null } }) {
  return r.expiresInSec !== null
    ? <span className="ny-time exp tnum" title={`Expires in ${span(r.expiresInSec)}; waiting ${span(r.ageSec)}`}><Clock3 size={12} aria-hidden />{span(r.expiresInSec)}<span className="vh"> until it expires</span></span>
    : <span className="ny-time tnum" title={`Waiting ${span(r.ageSec)}`}>{span(r.ageSec)}<span className="vh"> waiting</span></span>;
}

export function NeedsYou() {
  const { data, error, loading, retry } = useAttention();
  const rows = data?.rows ?? [];
  const [sel, setSel] = useState<string | null>(null);
  const [item, setItem] = useState<string | null>(null);
  const [level, setLevel] = useState<Level>('activity');
  const refs = useRef(new Map<string, HTMLButtonElement>());
  // keep the selection on a row that still exists (a decision elsewhere removes rows); the first row is the default
  useEffect(() => { if (rows.length && !rows.some((r) => r.id === sel)) { setSel(rows[0].id); setItem(null); } }, [rows, sel]);
  const cur = rows.find((r) => r.id === sel) ?? rows[0] ?? null;
  const pick = (id: string) => { setSel(id); setItem(null); };

  const onKey = (e: KeyboardEvent, i: number) => {
    let n = -1;
    if (e.key === 'ArrowDown') n = Math.min(rows.length - 1, i + 1);
    else if (e.key === 'ArrowUp') n = Math.max(0, i - 1);
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = rows.length - 1;
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { if (e.key === 'Enter' || cur) { e.preventDefault(); setLevel('evidence'); return; } }
    if (n >= 0) { e.preventDefault(); pick(rows[n].id); refs.current.get(rows[n].id)?.focus(); }
  };

  return (
    <div className="ov-row ny-grid">
      <Panel icon={BellRing} title="Needs you" help="attention.tab" delay={.05} className="ny-list-panel"
        sub={data ? <span className="ny-sub tnum">{data.totals.items} {data.totals.items === 1 ? 'item' : 'items'} in {data.totals.rows} {data.totals.rows === 1 ? 'row' : 'rows'}</span> : undefined}
        headExtra={data && data.totals.collapsed > 0 ? <span className="ny-fold"><Chip hue={200} size="sm" icon={Layers} title="Related items are folded into one row. Every folded item is listed when you open its row.">{data.totals.collapsed} folded</Chip><HelpTrigger k="attention.collapsed" /></span> : undefined}
        actions={<>{!isApi() && <DemoTag title="Prototype sample: invented rows, not read from the server" />}<span className="ny-rank"><ListOrdered size={13} aria-hidden /><span className="oa-hide-sm">Tier, expiry, age</span><HelpTrigger k="attention.ranking" /></span></>}>
        {loading ? <div className="ov-fill ny-state" role="status">Reading what needs you…</div>
          : error && !data ? <div className="ov-fill ny-state" role="alert"><span>Could not load the queue. {error}</span><button className="btn sm" onClick={retry}><RefreshCw size={14} />Try again</button></div>
          : rows.length === 0 ? <div className="ov-fill"><EmptyState icon={CheckCircle2} title="Nothing needs you" body="Approvals, stale reviews, waiting tasks, failures without a detection channel, proposals about to expire and lessons to review appear here." /></div>
          : (
            <ul className="ov-fill ny-scroll ny-rows" aria-label="Needs you, in ranked order">
              <AnimatePresence initial={false}>
                {rows.map((r, i) => {
                  const def = attentionReason(r.reason);
                  const Icon = ICON[r.icon];
                  const on = cur?.id === r.id;
                  return (
                    <motion.li key={r.id} layout="position" className={cx('ny-li', on && 'on')} style={{ ['--h' as string]: KIND_HUE[r.kind] }}
                      initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: .25, delay: Math.min(i, 14) * .025 }}>
                      <button ref={(el) => { if (el) refs.current.set(r.id, el); else refs.current.delete(r.id); }} type="button" className="ny-row" aria-current={on ? 'true' : undefined}
                        onClick={() => pick(r.id)} onKeyDown={(e) => onKey(e, i)} data-reason={r.reason}>
                        <span className="ny-n tnum" aria-hidden>{i + 1}</span>
                        <span className="ny-ico"><Icon size={14} aria-hidden /></span>
                        <span className="ny-kind" style={r.tier ? { ['--h' as string]: TIER_HUE[r.tier] ?? 350 } : undefined}>{r.tier && <b>{r.tier}</b>}{def.short}</span>
                        <span className="ny-why ellipsis" title={r.why}>{r.why}</span>
                        {r.count > 1 && <span className="ny-count tnum" title={`${r.count} items folded into this row`}><span aria-hidden>×</span>{r.count}<span className="vh"> items</span></span>}
                        <Time r={r} />
                      </button>
                      <HelpTrigger k={`attention.reason.${r.reason}`} />
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          )}
      </Panel>
      <Detail row={cur} level={level} setLevel={setLevel} item={item} setItem={setItem} />
    </div>
  );
}

function Detail({ row, level, setLevel, item, setItem }: { row: AttentionRowDto | null; level: Level; setLevel: (l: Level) => void; item: string | null; setItem: (i: string | null) => void }) {
  const nav = useNavigate();
  const m: AttentionMemberDto | null = row ? (row.members.find((x) => x.id === item) ?? row.members[0]) : null;
  const def = row ? attentionReason(row.reason) : null;
  const Icon = row ? ICON[row.icon] : BellRing;
  const key = row ? `${row.id}|${level}|${m?.id}` : 'none';
  return (
    <Panel icon={Icon} title={def ? def.label : 'Detail'} help={undefined} delay={.1} className="ny-detail-panel" aria-live="polite"
      headExtra={def ? <HelpTrigger k={`attention.reason.${def.code}`} /> : undefined}
      actions={row && row.count > 1 ? <Chip hue={200} size="sm" icon={Layers}>{row.count} items</Chip> : undefined}>
      {!row || !m ? <div className="ov-fill ny-state">Choose a row to see its activity, the action and the evidence.</div> : (
        <>
          <p className="ny-detail-why">{row.why}</p>
          <div className="ny-levels"><Segmented ariaLabel="Level of detail" size="sm" value={level} onChange={setLevel}
            options={LEVELS.map((l) => ({ key: l.key, label: <><l.icon size={13} aria-hidden />{l.label}</>, title: { activity: 'What the row stands for', action: 'What you can do', evidence: 'The check that would expose a defect' }[l.key] }))} /></div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={key} className="ov-fill ny-scroll ny-level" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .18 }}
              role="region" aria-label={`${LEVELS.find((l) => l.key === level)!.label} of the selected row`}>
              {level === 'activity' && (
                row.count > 1 ? (
                  <ul className="ny-members">
                    {row.members.map((x) => (
                      <li key={x.id}><button type="button" className={cx('ny-mem', x.id === m.id && 'on')} onClick={() => setItem(x.id)} aria-pressed={x.id === m.id}>
                        {x.tier && <b className="ny-tier" style={{ ['--h' as string]: TIER_HUE[x.tier] ?? 350 }}>{x.tier}</b>}
                        <span className="ellipsis">{x.subject}</span>{x.demo && <span className="ny-demo">DEMO</span>}<Time r={x} />
                      </button></li>
                    ))}
                  </ul>
                ) : (
                  <dl className="ny-facts">
                    <dt>Item</dt><dd>{m.subject}{m.demo && <span className="ny-demo">DEMO</span>}</dd>
                    <dt>Waiting</dt><dd className="tnum">{span(m.ageSec)}</dd>
                    <dt>Expires in</dt><dd className="tnum">{m.expiresInSec === null ? 'does not expire' : span(m.expiresInSec)}</dd>
                    {row.groupedBy && <><dt>Folded by</dt><dd>{row.groupedBy}</dd></>}
                  </dl>
                )
              )}
              {level === 'action' && (
                <div className="ny-action">
                  {m.canAct
                    ? <button type="button" className="btn primary" onClick={() => nav(m.route)}>{row.action.label}<ArrowRight size={15} /></button>
                    : <div className="ny-locked"><Lock size={14} aria-hidden /><span>{row.action.note ?? 'You cannot act on this.'}</span></div>}
                  <p className="dim">{m.canAct ? 'Opens the screen where it is decided. Nothing here changes the item.' : 'You can still open it to see the details.'}</p>
                  {!m.canAct && <button type="button" className="btn sm" onClick={() => nav(m.route)}>Open it<ArrowRight size={14} /></button>}
                  {row.count > 1 && <p className="dim">This row stands for {row.count} items. Pick one under Activity to act on that one.</p>}
                </div>
              )}
              {level === 'evidence' && (
                <div className="ny-evidence">
                  <div className="ny-check"><SearchCheck size={16} aria-hidden /><p><b>The check</b>{m.evidence.check}</p></div>
                  <dl className="ny-facts">{m.evidence.facts.map((f) => <Fragment key={f.label}><dt>{f.label}</dt><dd className={cx(f.value.length > 40 && 'long')} title={f.value}>{f.value || 'not recorded'}</dd></Fragment>)}</dl>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </>
      )}
    </Panel>
  );
}

/** Every reason code, for tests and the help page. */
export const REASON_CODES = ATTENTION_REASONS.map((r) => r.code);
