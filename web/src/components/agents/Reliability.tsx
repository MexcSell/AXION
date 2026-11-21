import { AnimatePresence, motion } from 'motion/react';
import { ShieldCheck } from 'lucide-react';
import type { AgentReliability } from '@contracts';
import { MIN_EVIDENCE } from '@contracts';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Tip } from '@/components/ui/Tip';
import { isApi } from '@/api/mode';
import type { Agent } from '@/data/types';
import { cx } from '@/lib/format';

/**
 * Improvement cycle 3: the agent's reliability as the server measured it from recorded tasks (api mode only). It is never
 * mixed with the profile's DEMO fixture numbers: its own stat, its own "measured" chip, its own `?`.
 */
/** The server's value; undefined when the server sent none (shown as "—", never as an invented "0 of 5"; review m10). */
export const reliabilityOf = (a: Agent): AgentReliability | undefined => a.reliability;
const enough = (r: AgentReliability) => r.value != null;
const shortNone = (r: AgentReliability) => `not enough evidence (${r.n} of ${MIN_EVIDENCE})`;
const UNKNOWN = 'not measured: the server sent no reliability';

/** Agent Profile hero: the Reliability stat (value + n + window, or "not enough evidence (n of 5)"). */
export function ReliabilityStat({ agent }: { agent: Agent }) {
  if (!isApi()) return null;
  const r = reliabilityOf(agent);
  const ok = !!r && enough(r);
  const sub = !r ? '—' : ok ? `n=${r.n} · last 90 days` : shortNone(r);
  return (
    <motion.div className={cx('oa-rel', ok ? 'ok' : 'none')} data-reliability={!r ? 'unknown' : ok ? 'ok' : 'none'} data-reliability-n={r?.n ?? ''} data-reliability-value={ok ? r.value! : ''}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .2 }} aria-label={`Reliability: ${!r ? UNKNOWN : ok ? `${r.value}%, n=${r.n}, last 90 days` : shortNone(r)}`}>
      <span className="oa-rel-ico" aria-hidden><ShieldCheck size={18} /></span>
      <div className="oa-rel-main">
        <div className="row" style={{ gap: 6 }}>
          <span className="oa-rel-label">Reliability</span>
          <span className="demo-tag measured" title="Measured on the server from recorded tasks, not a prototype number">measured</span>
          <HelpTrigger k="agent.reliability" />
        </div>
        <Tip label={r?.evidence ?? UNKNOWN}>
          <div className="oa-rel-val" tabIndex={0}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.b key={`${r?.value}-${r?.n}`} className="display tnum" initial={{ opacity: 0, y: 6, scale: .9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: .25 }}>
                {ok ? `${r.value}%` : '–'}
              </motion.b>
            </AnimatePresence>
            <span className="oa-rel-sub" data-reliability-text>{sub}</span>
          </div>
        </Tip>
      </div>
      <i className="oa-rel-bar" aria-hidden><motion.em initial={false} animate={{ width: `${!r ? 0 : ok ? r.value : (r.n / MIN_EVIDENCE) * 100}%` }} transition={{ duration: .8 }} /></i>
    </motion.div>
  );
}

/** Directory card and list row: a small chip, the value or "—", with n in the tooltip. */
export function ReliabilityChip({ agent }: { agent: Agent }) {
  if (!isApi()) return null;
  const r = reliabilityOf(agent);
  const ok = !!r && enough(r);
  return (
    <Tip label={r ? `Reliability ${ok ? `${r.value}%` : '—'} · n=${r.n} of ${MIN_EVIDENCE} needed · ${r.evidence}` : `Reliability — · ${UNKNOWN}`}>
      <span className={cx('rel-chip', ok ? 'ok' : 'none')} tabIndex={0} data-reliability-chip={!r ? 'unknown' : ok ? 'ok' : 'none'} data-reliability-n={r?.n ?? ''} aria-label={`Reliability ${!r ? 'not measured' : ok ? `${r.value}%` : 'not enough evidence'}${r ? `, n=${r.n}` : ''}`}>
        <ShieldCheck size={11} aria-hidden />{ok ? `${r!.value}%` : '—'}
      </span>
    </Tip>
  );
}
