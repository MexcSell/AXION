import { AnimatePresence, motion } from 'motion/react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AGENT_BY_ID } from '@/data/agents';
import type { Message, MessageKind } from '@/data/types';
import { clock, cx, dateLabel } from '@/lib/format';

/*
 * VS Code–style minimap for a conversation thread (owner 2026-11-20 (d)): every message is drawn as a tiny block of "text lines"
 * at its real position, colored by kind; times sit beside the blocks, day changes get a marker, the visible area is a draggable
 * slider and a floating time chip tells you where you are while scrolling. Click / drag / keys (↑↓ PgUp PgDn Home End) navigate.
 */

interface Item { id: string; top: number; h: number; w: number; side: 'left' | 'right' | 'human'; hue: number; time: string; day: string; who: string; kind: MessageKind; text: string }

const BLOCK_MIN = 3;
const MAX_SCALE = .2;  // like VS Code: short threads stay small at the top instead of stretching
const LANE = 34;      // px width of the block lane

export function ThreadMinimap({ scroller, msgs, me, kindHue, deps }: {
  scroller: RefObject<HTMLDivElement | null>; msgs: Message[]; me: string; kindHue: Record<MessageKind, number>; deps: unknown;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [railH, setRailH] = useState(0);
  const [geo, setGeo] = useState({ top: 0, client: 1, height: 1 });
  const [items, setItems] = useState<Item[]>([]);
  const [hoverY, setHoverY] = useState<number | null>(null);
  const [active, setActive] = useState(false); // scrolling or dragging → show the floating time chip
  const [drag, setDrag] = useState(false);
  const idle = useRef<number>(0);

  const byId = useMemo(() => Object.fromEntries(msgs.map((m) => [m.id, m])), [msgs]);

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setGeo({ top: el.scrollTop, client: el.clientHeight, height: Math.max(el.scrollHeight, 1) });
    let lastDay = '';
    const out: Item[] = [];
    el.querySelectorAll<HTMLElement>('[data-mid]').forEach((w) => {
      const m = byId[w.dataset.mid!];
      if (!m) return;
      const row = w.querySelector<HTMLElement>('.bubble-row') ?? w;
      const bub = row.querySelector<HTMLElement>('.bubble') ?? row;
      const day = dateLabel(m.agoMin, m.ts);
      const human = m.from.startsWith('human:');
      out.push({
        id: m.id, top: row.offsetTop, h: row.offsetHeight, w: Math.min(LANE - 4, Math.max(8, (bub.offsetWidth / Math.max(el.clientWidth, 1)) * LANE)), // .thread-body is the offsetParent
        side: human ? 'human' : m.from === me ? 'right' : 'left', hue: kindHue[m.kind], time: clock(m.agoMin, m.ts),
        day: day !== lastDay ? (lastDay = day) : '', who: human ? 'You' : AGENT_BY_ID[m.from]?.name ?? m.from, kind: m.kind, text: m.text,
      });
    });
    setItems(out);
  }, [scroller, byId, me, kindHue]);

  // re-measure when content or sizes change
  useLayoutEffect(() => { measure(); }, [measure, deps]);
  // improvement cycle 22: one ResizeObserver for the component's life; new rows are added to it as they arrive (it used to
  // be rebuilt over every row on each new message), and its callbacks share one measure per frame
  const latest = useRef(measure);
  useLayoutEffect(() => { latest.current = measure; }, [measure]);
  const ro = useRef<ResizeObserver | null>(null);
  const observed = useRef(new Set<Element>());
  useEffect(() => {
    const el = scroller.current, r = rail.current;
    if (!el || !r) return;
    let raf = 0;
    const kick = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => latest.current()); };
    const obs = new ResizeObserver((ents) => { ents.forEach((e) => { if (e.target === r) setRailH(e.contentRect.height); }); kick(); });
    ro.current = obs; observed.current = new Set();
    obs.observe(r); obs.observe(el);
    el.querySelectorAll('[data-mid]').forEach((c) => { observed.current.add(c); obs.observe(c); });
    const onScroll = () => {
      setGeo({ top: el.scrollTop, client: el.clientHeight, height: Math.max(el.scrollHeight, 1) });
      setActive(true);
      window.clearTimeout(idle.current);
      idle.current = window.setTimeout(() => setActive(false), 900);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { obs.disconnect(); ro.current = null; el.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); window.clearTimeout(idle.current); };
  }, [scroller]);
  // keyed on the messages, not only their count: a row replaced at the same length (my message's local copy → the server's
  // copy, another thread of the same length, a gap reset) is a new element; rows that left the DOM are let go
  useEffect(() => {
    const el = scroller.current, obs = ro.current;
    if (!el || !obs) return;
    observed.current.forEach((c) => { if (!c.isConnected) { obs.unobserve(c); observed.current.delete(c); } });
    el.querySelectorAll('[data-mid]').forEach((c) => { if (!observed.current.has(c)) { observed.current.add(c); obs.observe(c); } });
  }, [scroller, msgs, deps]);

  const s = Math.min(railH / geo.height, MAX_SCALE); // content px → rail px
  const sliderTop = geo.top * s, sliderH = Math.max(14, geo.client * s);
  const scrollable = geo.height > geo.client + 2;

  // which message is at the top edge of the viewport / under the pointer
  const at = (contentY: number) => {
    let hit = items[0];
    for (const it of items) { if (it.top <= contentY + 4) hit = it; else break; }
    return hit;
  };
  const current = items.length ? at(geo.top + 8) : undefined;
  const visible = (it: Item) => it.top + it.h > geo.top && it.top < geo.top + geo.client;

  // time labels: day markers win, then messages in view, then the rest — never overlapping
  const labels = useMemo(() => {
    const placed: { it: Item; y: number; h: number }[] = [];
    const order = [...items].sort((a, b) => (b.day ? 2 : 0) + (visible(b) ? 1 : 0) - ((a.day ? 2 : 0) + (visible(a) ? 1 : 0)));
    for (const it of order) {
      const hgt = it.day ? 22 : 11;
      const y = Math.min(Math.max(it.top * s - (it.day ? 11 : 0), 0), Math.max(railH - hgt, 0));
      if (placed.every((p) => y + hgt + 2 <= p.y || p.y + p.h + 2 <= y)) placed.push({ it, y, h: hgt });
    }
    // a label that repeats the one right above it adds nothing
    placed.sort((x, y) => x.y - y.y);
    return placed.filter((p, i) => p.it.day || i === 0 || p.it.time !== placed[i - 1].it.time);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, s, railH, geo.top, geo.client]);

  const scrollToRailY = (y: number, smooth: boolean) => {
    const el = scroller.current;
    if (!el || !railH) return;
    el.scrollTo({ top: y / s - geo.client / 2, behavior: smooth ? 'smooth' : 'auto' });
  };
  const localY = (e: { clientY: number }) => { const r = rail.current!.getBoundingClientRect(); return Math.min(Math.max(e.clientY - r.top, 0), r.height); };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const y = localY(e);
    const onSlider = y >= sliderTop && y <= sliderTop + sliderH;
    const grab = onSlider ? y - sliderTop - sliderH / 2 : 0; // keep the grip point under the pointer
    setDrag(true); setActive(true);
    if (!onSlider) scrollToRailY(y, true);
    const move = (ev: PointerEvent) => scrollToRailY(localY(ev) - grab, false);
    const up = () => { setDrag(false); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); idle.current = window.setTimeout(() => setActive(false), 700); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const el = scroller.current;
    if (!el) return;
    const step = { ArrowDown: 60, ArrowUp: -60, PageDown: geo.client * .9, PageUp: -geo.client * .9 }[e.key as string];
    if (step !== undefined) { e.preventDefault(); el.scrollBy({ top: step, behavior: 'smooth' }); }
    else if (e.key === 'Home') { e.preventDefault(); el.scrollTo({ top: 0, behavior: 'smooth' }); }
    else if (e.key === 'End') { e.preventDefault(); el.scrollTo({ top: 1e6, behavior: 'smooth' }); }
  };

  const hoverItem = hoverY !== null && items.length && s > 0 ? at(hoverY / s) : undefined;
  const pct = scrollable ? Math.round((geo.top / (geo.height - geo.client)) * 100) : 100;
  const chipTop = Math.min(Math.max(sliderTop + sliderH / 2 - 11, 0), Math.max(railH - 22, 0));

  return (
    <div className="minimap-wrap">
      <AnimatePresence>
        {(active || drag) && current && scrollable && (
          <motion.div className="minimap-chip" style={{ top: chipTop }} aria-hidden
            initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 6 }} transition={{ duration: .15 }}>
            <span className="minimap-chip-day">{dateLabel(byId[current.id]?.agoMin ?? 0, byId[current.id]?.ts)}</span>
            <b>{current.time}</b>
          </motion.div>
        )}
      </AnimatePresence>

      <div ref={rail} className={cx('minimap', drag && 'dragging')} role="scrollbar" aria-orientation="vertical" aria-label="Conversation minimap — times of messages"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={current ? `${current.time}, ${current.who}` : undefined} tabIndex={0}
        onPointerDown={onPointerDown} onPointerMove={(e) => setHoverY(localY(e))} onPointerLeave={() => setHoverY(null)} onKeyDown={onKey}>

        {items.map((it, i) => (
          <Block key={it.id} cls={cx('mm-block', it.side, visible(it) && 'in-view', current?.id === it.id && 'current')}
            top={it.top * s} h={Math.max(BLOCK_MIN, it.h * s)} w={it.w} left={it.side === 'left' ? 2 : LANE - it.w} hue={it.hue} i={i} />
        ))}

        {items.filter((it) => it.day).map((it) => <span key={'d' + it.id} className="mm-day" style={{ top: Math.max(it.top * s - 2, 0) }} />)}

        {labels.map(({ it, y }) => (
          <span key={'t' + it.id} className={cx('mm-time', it.day && 'day', visible(it) && 'in-view', current?.id === it.id && 'current')} style={{ top: y }}>
            {it.day && <span className="mm-time-day">{it.day}</span>}{it.time}
          </span>
        ))}

        <motion.span className="mm-slider" style={{ top: sliderTop, height: sliderH }} animate={{ opacity: scrollable ? 1 : .35 }} />

        {hoverY !== null && !drag && hoverItem && (
          <>
            <span className="mm-hover-line" style={{ top: hoverY }} />
            <div className="mm-peek" style={{ top: Math.min(Math.max(hoverY - 28, 0), Math.max(railH - 70, 0)), ['--h' as string]: hoverItem.hue }}>
              <div className="row" style={{ gap: 6 }}>
                <span className="chip sm" style={{ ['--h' as string]: hoverItem.hue }}>{hoverItem.kind.toUpperCase()}</span>
                <b className="ellipsis">{hoverItem.who}</b><span className="spacer" />
                <span className="mono">{hoverItem.time}</span>
              </div>
              <div className="mm-peek-text">{hoverItem.text}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** One message block. Memoised (improvement cycle 22): a re-measure only re-renders the blocks that moved or changed. */
const Block = memo(function Block({ cls, top, h, w, left, hue, i }: { cls: string; top: number; h: number; w: number; left: number; hue: number; i: number }) {
  return (
    <motion.span className={cls} style={{ top, height: h, width: w, left, ['--h' as string]: hue }}
      initial={{ opacity: 0, scaleX: .3 }} animate={{ opacity: 1, scaleX: 1 }} transition={{ delay: Math.min(i, 20) * .02, duration: .25 }} />
  );
});
