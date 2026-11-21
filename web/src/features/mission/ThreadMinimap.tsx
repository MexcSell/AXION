import { AnimatePresence, motion } from 'motion/react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AGENT_BY_ID } from '@/data/agents';
import type { Message, MessageKind } from '@/data/types';
import { cx } from '@/lib/format';
import { clockOf, dayOf, type MapRow } from '@/features/chat/threadWindow';

/*
 * VS Code–style minimap for a conversation thread (owner 2026-11-20 (d)): every message is drawn as a tiny block of "text lines"
 * at its real position, colored by kind; times sit beside the blocks, day changes get a marker, the visible area is a draggable
 * slider and a floating time chip tells you where you are while scrolling. Click / drag / keys (↑↓ PgUp PgDn Home End) navigate.
 */

interface Item { id: string; top: number; h: number; w: number; side: 'left' | 'right' | 'human'; hue: number; time: string; day: string; who: string; kind: MessageKind; text: string }

const BLOCK_MIN = 3;
const MAX_SCALE = .2;  // like VS Code: short threads stay small at the top instead of stretching
const LANE = 34;      // px width of the block lane
const SCALE_STEP = 1.12;

export function ThreadMinimap({ scroller, msgs, rows, contentH, me, kindHue }: {
  scroller: RefObject<HTMLDivElement | null>; msgs: Message[]; me: string; kindHue: Record<MessageKind, number>;
  /** improvement cycle 26: where each message sits in the (virtualised) thread, from ChatThreadView's geometry model,
   *  measured or estimated, so every message gets a block whether or not its row is in the DOM; and the thread's height */
  rows: MapRow[]; contentH: number;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [railH, setRailH] = useState(0);
  const [pos, setPos] = useState({ top: 0, client: 1 });
  const geo = { ...pos, height: Math.max(contentH, pos.client, 1) };
  const [hoverY, setHoverY] = useState<number | null>(null);
  const [active, setActive] = useState(false); // scrolling or dragging → show the floating time chip
  const [drag, setDrag] = useState(false);
  const idle = useRef<number>(0);

  const byId = useMemo(() => new Map(msgs.map((m) => [m.id, m])), [msgs]);
  // an unchanged message at an unchanged place keeps its item object, so its chunk of blocks is not rendered again
  const prevItems = useRef<{ list: Item[]; me: string; hue: Record<MessageKind, number> }>({ list: [], me, hue: kindHue });
  const items = useMemo(() => {
    let lastDay = '';
    const prev = prevItems.current.me === me && prevItems.current.hue === kindHue ? prevItems.current.list : [];
    const list = msgs.map((m, i): Item => {
      const r = rows[i] ?? { top: 0, h: 0, w: .3 };
      const day = dayOf(m);
      const human = m.from.startsWith('human:');
      const w = Math.min(LANE - 4, Math.max(8, r.w * LANE)), dd = day !== lastDay ? (lastDay = day) : '';
      const o = prev[i];
      if (o && o.id === m.id && o.top === r.top && o.h === r.h && o.w === w && o.day === dd && o.text === m.text && o.kind === m.kind) return o;
      return {
        id: m.id, top: r.top, h: r.h, w,
        side: human ? 'human' : m.from === me ? 'right' : 'left', hue: kindHue[m.kind], time: clockOf(m),
        day: dd, who: human ? 'You' : AGENT_BY_ID[m.from]?.name ?? m.from, kind: m.kind, text: m.text,
      };
    });
    prevItems.current = { list, me, hue: kindHue };
    return list;
  }, [msgs, rows, me, kindHue]);

  // the scroll position and the viewport's height (the content's height comes from the model: reading scrollHeight after
  // every new message forced a layout and a second render)
  const readGeo = useCallback(() => {
    const el = scroller.current;
    if (el) setPos((p) => (p.top === el.scrollTop && p.client === el.clientHeight ? p : { top: el.scrollTop, client: el.clientHeight }));
  }, [scroller]);
  useLayoutEffect(() => { readGeo(); }, [readGeo]);
  useEffect(() => {
    const el = scroller.current, r = rail.current;
    if (!el || !r) return;
    const obs = new ResizeObserver((ents) => { ents.forEach((e) => { if (e.target === r) setRailH(e.contentRect.height); }); readGeo(); });
    obs.observe(r); obs.observe(el);
    const onScroll = () => {
      readGeo();
      setActive(true);
      window.clearTimeout(idle.current);
      idle.current = window.setTimeout(() => setActive(false), 900);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { obs.disconnect(); el.removeEventListener('scroll', onScroll); window.clearTimeout(idle.current); };
  }, [scroller, readGeo]);

  // content px → rail px
  const s = Math.min(railH / geo.height, MAX_SCALE);
  // Improvement cycle 26: the blocks are laid out at a base scale `sb` (a 12 % step) and the layer holding them is stretched
  // by s / sb (a compositor transform). A thread that grows by a message changes s, and restyling and laying out every
  // block again (one per message) cost tens of ms each time; now that happens once per 12 % of growth.
  const sb = s >= MAX_SCALE || s <= 0 ? s : Math.pow(SCALE_STEP, Math.floor(Math.log(s) / Math.log(SCALE_STEP)));
  const sliderTop = geo.top * s, sliderH = Math.max(14, geo.client * s);
  const scrollable = geo.height > geo.client + 2;

  // which message is at the top edge of the viewport / under the pointer (items are in content order: binary search)
  const atIndex = (contentY: number) => {
    let lo = 1, hi = items.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (items[mid].top <= contentY + 4) lo = mid + 1; else hi = mid; }
    return lo - 1;
  };
  const at = (contentY: number) => items[atIndex(contentY)];
  const cur = items.length ? atIndex(geo.top + 8) : -1;
  const current = cur >= 0 ? items[cur] : undefined;
  const visible = (it: Item) => it.top + it.h > geo.top && it.top < geo.top + geo.client;
  // the blocks in view: [vs, ve)
  let vs = Math.max(0, atIndex(geo.top - 4)), ve = vs;
  while (vs < items.length && !visible(items[vs]) && items[vs].top < geo.top + geo.client) vs++;
  ve = vs;
  while (ve < items.length && visible(items[ve])) ve++;

  // time labels: day markers win, then messages in view, then the rest — never overlapping
  const labels = useMemo(() => {
    const placed: { it: Item; y: number; h: number }[] = [];
    // (a stable partition, the same order the sort by priority gave, in O(n): it runs on every scroll frame)
    const tiers: Item[][] = [[], [], [], []];
    for (const it of items) tiers[3 - ((it.day ? 2 : 0) + (visible(it) ? 1 : 0))].push(it);
    const order = tiers.flat();
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
            <span className="minimap-chip-day">{byId.get(current.id) ? dayOf(byId.get(current.id)!) : ''}</span>
            <b>{current.time}</b>
          </motion.div>
        )}
      </AnimatePresence>

      <div ref={rail} className={cx('minimap', drag && 'dragging')} role="scrollbar" aria-orientation="vertical" aria-label="Conversation minimap — times of messages"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={current ? `${current.time}, ${current.who}` : undefined} tabIndex={0}
        onPointerDown={onPointerDown} onPointerMove={(e) => setHoverY(localY(e))} onPointerLeave={() => setHoverY(null)} onKeyDown={onKey}>

        <div className="mm-blocks" style={{ ['--s' as string]: sb, transform: sb > 0 && s !== sb ? `scaleY(${s / sb})` : undefined }}>
          {Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, c) => {
            const from = c * CHUNK, to = Math.min(items.length, from + CHUNK), clip = (x: number) => Math.min(Math.max(x, from), to);
            return <BlockChunk key={c} items={items} from={from} to={to} vs={clip(vs)} ve={clip(ve)} cur={cur >= from && cur < to ? cur : -1} />;
          })}
        </div>

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

/**
 * Improvement cycle 26: blocks are rendered in chunks of CHUNK. A chunk renders again only when one of its items changed
 * (a new message, a measured row) or its in-view / current marks moved, so a live message in a long thread renders one
 * chunk, not every block. Each chunk is its own layer with contained layout (.mm-chunk), so the browser also lays out and
 * repaints only that chunk.
 */
const CHUNK = 64;
const BlockChunk = memo(function BlockChunk({ items, from, to, vs, ve, cur }: { items: Item[]; from: number; to: number; vs: number; ve: number; cur: number }) {
  const out: ReactNode[] = [];
  for (let i = from; i < to; i++) {
    const it = items[i];
    out.push(<Block key={it.id} id={it.id} cls={cx('mm-block', it.side, i >= vs && i < ve && 'in-view', i === cur && 'current')}
      top={it.top} h={it.h} w={it.w} left={it.side === 'left' ? 2 : LANE - it.w} hue={it.hue} i={i} />);
  }
  return <div className="mm-chunk">{out}</div>;
}, (a, b) => {
  if (a.from !== b.from || a.to !== b.to || a.vs !== b.vs || a.ve !== b.ve || a.cur !== b.cur) return false;
  for (let i = a.from; i < a.to; i++) if (a.items[i] !== b.items[i]) return false;
  return true;
});

/**
 * One message block, in content px; the rail's `--s` scales it (improvement cycle 26: appending a message changes the
 * scale, and with the scale in a CSS variable only the new block renders, not all of them). Memoised (cycle 22).
 */
const Block = memo(function Block({ id, cls, top, h, w, left, hue, i }: { id: string; cls: string; top: number; h: number; w: number; left: number; hue: number; i: number }) {
  // the entrance is a CSS animation (.mm-block, mission-control.css), the same fade and scale the motion component played:
  // a plain element renders much more cheaply, and a long thread has one per message
  return (
    <span className={cls} data-mm={id} style={{ top: `calc(${top}px * var(--s))`, height: `max(${BLOCK_MIN}px, calc(${h}px * var(--s)))`, width: w, left, ['--h' as string]: hue, opacity: 1, animationDelay: `${Math.min(i, 20) * 20}ms` }} />
  );
});
