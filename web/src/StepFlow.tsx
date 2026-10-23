// 펼친 캔버스 — 공방 「펼쳐 보기」(info 없음)와 런 화면(info = 노드 상태)이 같이 쓴다. 자리는 stepFlow.ts.
// 체인 상자는 처음엔 접어 둔다(이름 · 노드 수 · 진행). 런에서는 지금 노드가 든 체인만 펼치고, 지금 노드가 바뀌면 그리로 화면을 옮긴다.
// 상자 머리를 누르면 접고 펴고, 노드를 누르면 onPick. 끌어서 옮기고 ⌘/Ctrl + 휠로 확대한다(휠만은 옮기기).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ancestors, boxesOf, layout, NH, NW, type FlowStep, type Laid } from './stepFlow.ts';
import { Icon } from './ui.tsx';

export type NodeState = 'wait' | 'sending' | 'running' | 'blocked' | 'done' | 'skipped' | 'check' | 'stopped';
// 런 노드 상태 — 말과 점 색(런 화면 상세도 쓴다)
export const NODE: Record<NodeState, [string, string]> = {
  wait: ['기다림', 'bg-muted-foreground/40'], sending: ['보내는 중', 'bg-sky-500 animate-pulse'], running: ['도는 중', 'bg-sky-500 animate-pulse'],
  blocked: ['답 기다림', 'bg-amber-500 animate-pulse'], done: ['끝', 'bg-emerald-500'], skipped: ['건너뜀', 'bg-muted-foreground/40'],
  check: ['확인 필요', 'bg-amber-500'], stopped: ['멈춤', 'bg-muted-foreground'],
};
const TONE: Partial<Record<NodeState, string>> = {
  done: 'border-emerald-500/50 bg-emerald-500/10', running: 'border-sky-500 bg-sky-500/10 ring-3 ring-sky-500/25', sending: 'border-sky-500 bg-sky-500/10 ring-3 ring-sky-500/25',
  blocked: 'border-amber-500 bg-amber-500/10', check: 'border-amber-500 bg-amber-500/10', skipped: 'text-muted-foreground line-through', wait: 'text-muted-foreground',
};
const LIVE: NodeState[] = ['running', 'sending'], ASK: NodeState[] = ['check', 'blocked'];
type Info = { state: NodeState; fails: number };
type View = { k: number; x: number; y: number };
const CHEVRON = <path d="m9 18 6-6-6-6" />;
const EDGE = 'var(--muted-foreground)', HOT = '#0ea5e9', FAIL = '#e5484d';

// also — current 밖에 지금 도는 노드(다른 갈래). 그 체인도 펼쳐 둔다(화면이 따라가는 것은 current 하나).
export function StepFlow({ steps, info, current, also = [], sel, onPick, className = '' }: {
  steps: FlowStep[]; info?: (key: string) => Info | undefined; current?: string; also?: string[]; sel?: string | null; onPick: (s: FlowStep) => void; className?: string;
}) {
  const boxes = useMemo(() => boxesOf(steps), [steps]), by = useMemo(() => new Map(steps.map(s => [s.key, s])), [steps]);
  const [opened, setOpened] = useState(new Set<string>()), [closed, setClosed] = useState(new Set<string>());
  const up = (k?: string) => k && by.get(k) ? ancestors(boxes, by.get(k)!.group) : [];
  const here = up(current), live = [...here, ...also.flatMap(up)];
  const folded = (k: string) => closed.has(k) || (!opened.has(k) && boxes.get(k)?.kind === 'chain' && !live.includes(k));
  const laid = useMemo(() => layout(steps, boxes, folded), [steps, boxes, opened, closed, live.join()]);   // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (k: string) => {
    const shut = folded(k);
    setOpened(s => { const n = new Set(s); if (shut) n.add(k); else n.delete(k); return n; });
    setClosed(s => { const n = new Set(s); if (shut) n.delete(k); else n.add(k); return n; });
  };
  const chains = () => new Set([...boxes.values()].filter(b => b.kind === 'chain').map(b => b.key));

  // ── 옮기기 · 확대 ──
  const vp = useRef<HTMLDivElement>(null), [v, setV] = useState<View>({ k: 1, x: 24, y: 24 }), drag = useRef<{ x: number; y: number; v: View } | null>(null);
  const box = () => vp.current?.getBoundingClientRect() ?? { width: 800, height: 500, left: 0, top: 0 };
  const zoom = (f: number, px: number, py: number) => setV(o => { const k = Math.min(2, Math.max(0.1, o.k * f)); return { k, x: px - (px - o.x) * k / o.k, y: py - (py - o.y) * k / o.k }; });
  const fitK = (l: Laid) => { const r = box(); return Math.min(1, (r.width - 40) / l.w, (r.height - 40) / l.h); };
  const fit = () => { const r = box(), k = fitK(laid); setV({ k, x: (r.width - laid.w * k) / 2, y: 20 }); };
  // 지금 노드(접혀 있으면 그 카드)를 가운데로
  const toCurrent = (l: Laid) => {
    if (!current) return false;
    const n = l.nodes.find(x => x.key === current), b = n ? null : l.boxes.find(x => x.fold && here.includes(x.key));
    const t = n ? { x: n.x, y: n.y, w: NW, h: NH } : b;
    if (!t) return false;
    const r = box();
    setV(o => { const k = Math.max(o.k, 0.75); return { k, x: r.width / 2 - (t.x + t.w / 2) * k, y: r.height / 2 - (t.y + t.h / 2) * k }; });
    return true;
  };
  // 처음 한 번은 다 보이게(너무 작아지면 왼쪽 위부터), 그 뒤엔 지금 노드가 바뀔 때만 따라간다 — 5초마다 다시 읽어도 사람이 옮긴 화면은 그대로
  const shown = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (shown.current === (current ?? null)) return;
    const first = shown.current === undefined;
    shown.current = current ?? null;
    if (toCurrent(laid) || !first) return;
    if (fitK(laid) >= 0.45) fit(); else setV({ k: 0.8, x: 24, y: 24 });
  }, [current, laid]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = vp.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoom(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      else setV(o => ({ ...o, x: o.x - e.deltaX, y: o.y - e.deltaY }));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  // ── 상태 ──
  const st = (k: string) => info?.(k);
  const boxTone = (keys: string[]) => {
    if (!info) return '';
    const s = keys.map(k => st(k)?.state);
    return s.some(x => x && LIVE.includes(x)) ? 'border-sky-500 ring-3 ring-sky-500/20' : s.some(x => x && ASK.includes(x)) ? 'border-amber-500' : s.every(x => x === 'done' || x === 'skipped') ? 'border-emerald-500/60' : '';
  };
  const curRep = current && (laid.nodes.some(n => n.key === current) ? `S:${current}` : `B:${laid.boxes.find(b => b.fold && here.includes(b.key))?.key}`);
  const done = (k: string) => ['done', 'skipped'].includes(st(k)?.state ?? '');

  return (
    <div ref={vp} className={`relative touch-none overflow-hidden rounded-lg border bg-background cursor-grab active:cursor-grabbing ${className}`}
      style={{ backgroundImage: 'radial-gradient(var(--border) 1.2px, transparent 1.2px)', backgroundSize: '20px 20px' }}
      onPointerDown={e => { if ((e.target as HTMLElement).closest('[data-hit]')) return; drag.current = { x: e.clientX, y: e.clientY, v }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { const d = drag.current; if (d) setV({ ...d.v, x: d.v.x + e.clientX - d.x, y: d.v.y + e.clientY - d.y }); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <div className="absolute top-0 left-0 origin-top-left" style={{ width: laid.w, height: laid.h, transform: `translate(${v.x}px,${v.y}px) scale(${v.k})` }}>
        <svg width={laid.w} height={laid.h} className="pointer-events-none absolute top-0 left-0 overflow-visible">
          <defs>
            {([['e', EDGE], ['h', HOT], ['f', FAIL]] as const).map(([id, c]) => (
              <marker key={id} id={`sf-${id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill={c} /></marker>
            ))}
          </defs>
          {laid.edges.map(e => {
            const hot = !e.fail && e.b === curRep && e.a.startsWith('S:') && done(e.a.slice(2));
            const c = e.fail ? FAIL : hot ? HOT : EDGE;
            return <path key={`${e.a}>${e.b}${e.fail ? '!' : ''}`} d={e.d} fill="none" stroke={c} strokeOpacity={hot || e.fail ? 1 : 0.55} strokeWidth={hot ? 2.2 : 1.4}
              strokeDasharray={e.fail ? '4 3' : undefined} markerEnd={`url(#sf-${e.fail ? 'f' : hot ? 'h' : 'e'})`} />;
          })}
        </svg>
        {[...laid.boxes].sort((a, b) => a.key.length - b.key.length).map(b => {
          const engine = b.kind === 'engine', n = b.steps.filter(done).length;
          return (
            <div key={b.key} className={`absolute rounded-xl border-[1.5px] ${b.fold ? 'border-border bg-card shadow-xs' : engine ? 'border-primary/40 bg-primary/[0.03]' : 'border-dashed border-primary/30 bg-accent/30'} ${boxTone(b.steps)}`}
              style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
              <button type="button" data-hit onClick={() => toggle(b.key)} aria-expanded={!b.fold} title={b.fold ? '펼치기' : '접기'}
                className={`flex h-[26px] w-full items-center gap-1.5 rounded-t-xl px-2.5 text-left text-xs font-semibold text-accent-foreground hover:text-primary ${engine && !b.fold ? 'bg-accent' : ''}`}>
                <Icon className={`size-3 transition-transform ${b.fold ? '' : 'rotate-90'}`}>{CHEVRON}</Icon>
                <span className="min-w-0 truncate">{b.name}</span>
                <span className="shrink-0 font-normal text-muted-foreground">{engine ? '엔진' : '체인'}</span>
                <span className="ml-auto shrink-0 font-normal text-muted-foreground tabular-nums">{info ? `${n}/${b.steps.length}` : `노드 ${b.steps.length}`}</span>
              </button>
              {b.fold && info && (
                <div className="absolute inset-x-2.5 bottom-2.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-emerald-500" style={{ width: `${b.steps.length ? n / b.steps.length * 100 : 0}%` }} /></div>
              )}
            </div>
          );
        })}
        {laid.nodes.map(({ key, x, y }) => {
          const s = by.get(key)!, i = st(key), state = i?.state;
          return (
            <button key={key} type="button" data-hit onClick={() => onPick(s)} title={`${s.title}${state ? ` — ${NODE[state][0]}` : ''}`}
              className={`absolute flex items-center gap-1.5 rounded-lg border bg-card px-2.5 text-[0.75rem] font-medium shadow-xs hover:border-primary/60
                ${state ? TONE[state] ?? '' : ''} ${s.fixOnly ? 'border-dashed' : ''} ${s.fixOnly && state === 'wait' ? 'opacity-60' : ''} ${sel === key ? 'ring-2 ring-primary' : ''}`}
              style={{ left: x, top: y, width: NW, height: NH }}>
              {state && !s.fixOnly && <span className={`size-2 shrink-0 rounded-full ${NODE[state][1]}`} />}
              {s.kind === 'command' && <span className="font-mono text-[0.625rem] text-muted-foreground">$</span>}
              <span className="min-w-0 flex-1 truncate text-left">{s.title}</span>
              {s.fixOnly && <span className="shrink-0 text-[0.625rem] text-rose-600 dark:text-rose-400">고칠 때</span>}
              {!!i?.fails && <span className="shrink-0 text-[0.625rem] text-rose-600 tabular-nums dark:text-rose-400">고침 {i.fails}</span>}
            </button>
          );
        })}
      </div>
      <div data-hit className="absolute right-2 bottom-2 flex flex-wrap items-center justify-end gap-1">
        <Button size="sm" variant="outline" className="h-7 bg-card text-xs" onClick={() => { setOpened(chains()); setClosed(new Set()); }}>모두 펼치기</Button>
        <Button size="sm" variant="outline" className="h-7 bg-card text-xs" onClick={() => { setOpened(new Set()); setClosed(chains()); }}>모두 접기</Button>
        {current && <Button size="sm" variant="outline" className="h-7 bg-card text-xs" onClick={() => toCurrent(laid)}>지금 노드</Button>}
        <Button size="sm" variant="outline" className="h-7 w-7 bg-card p-0 text-xs" aria-label="축소" onClick={() => { const r = box(); zoom(0.8, r.width / 2, r.height / 2); }}>−</Button>
        <Button size="sm" variant="outline" className="h-7 w-7 bg-card p-0 text-xs" aria-label="확대" onClick={() => { const r = box(); zoom(1.25, r.width / 2, r.height / 2); }}>+</Button>
        <Button size="sm" variant="outline" className="h-7 bg-card text-xs" onClick={fit}>전체</Button>
      </div>
    </div>
  );
}
