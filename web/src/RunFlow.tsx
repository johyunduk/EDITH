// 런 흐름 — 런 화면 「캔버스」. 큰 단계(맨 위 엔진의 체인 · 엔진)를 다 펼친 상자로 왼쪽→오른쪽, 갈래는 줄로 위아래(자리 — runFlow.ts).
// 노드 줄은 상태 점 · 제목 · 걸린 시간 · 결과 첫 줄, 사람 대기 · 막힘은 꼬리표. 선은 지나온 길(초록) · 지금 가는 길(흐르는 점선) · 갈 길(회색 점선).
// 시간 · 꼬리표는 서버 타임라인(src/timeline.ts)에서. 노드를 누르면 onPick, 열 때와 도는 상자가 바뀔 때 그 상자를 가운데로 옮긴다.
// 공방 캔버스와 같은 손놀림 — 휠로 확대 · 축소(커서 자리 기준), 왼쪽 단추로 끌어 옮긴다(노드 줄을 잡고 끌어도 — 끌었으면 그 클릭은 버린다).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { columns, dur, merge, phases, short, statusOf, type Phase, type Status } from './runFlow.ts';
import type { FlowStep } from './stepFlow.ts';
import type { NodeState } from './StepFlow.tsx';

type Node = { state: NodeState; attempt: number; summary?: string; line?: string; reason?: string };
type Entry = { kind: string; t: number; keys: string[]; tone?: string; attempt?: number; work?: number; human?: number };
type Tone = 'flow' | 'done' | 'todo';

const DOT: Record<NodeState, string> = {
  done: 'bg-emerald-500', skipped: 'bg-muted-foreground/40', running: 'bg-sky-500 animate-pulse', sending: 'bg-sky-500 animate-pulse',
  blocked: 'bg-amber-500 animate-pulse', check: 'bg-amber-500', stopped: 'bg-muted-foreground', wait: 'border-[1.5px] border-muted-foreground/50',
};
const BOX: Record<Status, string> = {
  live: 'border-sky-500 bg-linear-to-b from-sky-500/8 to-card to-40% ring-4 ring-sky-500/15', done: 'border-emerald-500/45 bg-card',
  part: 'bg-card', wait: 'border-dashed bg-card/60',
};
const HEAD: Record<Status, string> = { live: 'bg-sky-500 animate-pulse', done: 'bg-emerald-500', part: 'bg-muted-foreground/60', wait: 'border-2 border-muted-foreground/40' };
const toneOf = (s: Status): Tone => s === 'live' ? 'flow' : s === 'wait' ? 'todo' : 'done';
// 선 — 가로(h) · 세로(v)
const H: Record<Tone, string> = { done: 'h-0.5 bg-emerald-500', flow: 'h-0.5 wire-flow', todo: 'h-0 border-t-2 border-dashed border-muted-foreground/30' };
const V: Record<Tone, string> = { done: 'w-0.5 bg-emerald-500', flow: 'w-0.5 bg-sky-500', todo: 'w-0 border-l-2 border-dashed border-muted-foreground/30' };

export function RunFlow({ steps, nodes, timeline, sel, onPick }: {
  steps: FlowStep[]; nodes: Record<string, Node>; timeline: Entry[]; sel: string | null; onPick: (key: string) => void;
}) {
  const by = new Map(steps.map(s => [s.key, s])), cols = columns(phases(steps));
  // 노드마다 — 지금 시도의 일한 시간 · 도는 중이면 시작한 때, 모든 시도의 사람 대기 · 확인 필요였던 수
  const info = new Map<string, { work: number; human: number; warn: number; start?: number }>();
  for (const e of timeline) {
    if (e.kind !== 'node') continue;
    const k = e.keys[0], o = info.get(k) ?? { work: 0, human: 0, warn: 0 };
    if (e.attempt === nodes[k]?.attempt) { o.work = e.work ?? 0; if (e.tone === 'now') o.start = e.t; }
    o.human += e.human ?? 0;
    if (e.tone === 'warn') o.warn++;
    info.set(k, o);
  }
  const status = (p: Phase) => statusOf(p.keys.map(k => nodes[k].state));
  const colStatus = (c: (typeof cols)[number]) => c.kind === 'box' ? status(c.phase) : merge(c.rows.flatMap(r => r.phases.map(status)));
  // 큰 단계가 걸린 때 — 처음 시작부터 마지막 끝(도는 중이면 지금)까지
  const span = (p: Phase) => {
    const own = new Set(p.keys), es = timeline.filter(e => e.keys.some(k => own.has(k)));
    if (!es.length) return '';
    const end = status(p) === 'live' ? Date.now() : Math.max(...es.map(e => e.t + (e.work ?? 0) + (e.human ?? 0)));
    return dur(end - Math.min(...es.map(e => e.t)));
  };

  const live = cols.flatMap(c => c.kind === 'box' ? [c.phase] : c.rows.flatMap(r => r.phases)).find(p => status(p) === 'live')?.id;
  const ref = useRef<HTMLElement>(null), view = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ x: 20, y: 20, z: 1 }), drag = useRef<{ x: number; y: number; moved: boolean } | null>(null), dragged = useRef(false);
  // 도는 상자를 가로 가운데 · 위쪽에(상자 자리는 transform 과 상관없는 offset — 안쪽 판이 relative)
  useEffect(() => {
    const el = ref.current, v = view.current;
    if (el && v) setT(o => ({ ...o, x: v.clientWidth / 2 - (el.offsetLeft + el.offsetWidth / 2) * o.z, y: 20 - el.offsetTop * o.z }));
  }, [live]);
  // 휠 — 페이지가 같이 스크롤되지 않게 passive 없이 붙인다(React onWheel 은 preventDefault 가 안 먹는다). 트랙패드 핀치(ctrlKey)는 더 빠르게
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const b = v.getBoundingClientRect(), mx = e.clientX - b.left, my = e.clientY - b.top;
      setT(o => { const z = Math.min(2, Math.max(0.25, o.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))); return { z, x: mx - (mx - o.x) * z / o.z, y: my - (my - o.y) * z / o.z }; });
    };
    v.addEventListener('wheel', wheel, { passive: false });
    return () => v.removeEventListener('wheel', wheel);
  }, []);

  const row = (k: string) => {
    const s = by.get(k)!, n = nodes[k], o = info.get(k), cmd = s.kind === 'command', on = n.state === 'running' || n.state === 'sending';
    if (s.fixOnly && n.state === 'wait' && !n.attempt) return null;   // 고치는 노드는 불린 뒤에만
    const tags = [o?.warn ? `막힘 ${o.warn}` : '', o && o.human >= 60_000 ? `사람 ${Math.round(o.human / 60_000)}분` : '', !o?.warn && n.attempt > 1 ? `${n.attempt}번째` : '',
      n.state === 'check' ? '확인 필요' : ''].filter(Boolean);
    const time = on && o?.start ? dur(Date.now() - o.start) : !cmd && o?.work ? dur(o.work) : '';
    const line = cmd ? undefined : n.state === 'check' ? short(n.reason ?? n.summary) : n.line ?? short(n.summary);
    return (
      <button key={k} type="button" onClick={() => onPick(k)} aria-pressed={sel === k} title={s.title}
        className={`mx-1.5 mt-0.5 block w-[calc(100%-0.75rem)] rounded-lg px-2 text-left hover:bg-muted/70 ${cmd ? 'py-0.5' : 'py-1.5'}
          ${on ? 'bg-sky-500/10 ring-1 ring-sky-500/40' : n.state === 'check' ? 'bg-amber-500/10' : ''} ${sel === k ? 'ring-2 ring-primary/60' : ''}`}>
        <span className="flex items-center gap-2">
          <span className={`shrink-0 rounded-full ${cmd ? 'size-1.5' : 'size-2'} ${DOT[n.state]}`} />
          <span className={`min-w-0 flex-1 truncate ${cmd ? 'text-xs text-muted-foreground' : `text-[0.8125rem] font-semibold ${n.state === 'wait' ? 'font-normal text-muted-foreground' : ''}`}`}>
            {cmd && <span className="font-mono">$ </span>}{s.fixOnly ? '↳ ' : ''}{s.title}
          </span>
          {tags.map(t => <span key={t} className="shrink-0 rounded px-1.5 text-[0.625rem] font-bold bg-amber-500/15 text-amber-800 dark:text-amber-300">{t}</span>)}
          {time && <span className={`shrink-0 font-mono text-[0.6875rem] tabular-nums ${on ? 'text-sky-700 dark:text-sky-300' : 'text-muted-foreground'}`}>{time}</span>}
        </span>
        {line && <span className="mt-0.5 ml-4 block truncate text-[0.71875rem] text-muted-foreground">{line}</span>}
        {on && <span className="shimmer mt-1.5 ml-4 block h-0.5 rounded-full" />}
      </button>
    );
  };
  const box = (p: Phase) => {
    const st = status(p), d = p.keys.filter(k => ['done', 'skipped'].includes(nodes[k].state)).length, t = span(p), named = p.groups.some(g => g.name);
    return (
      <section key={p.id} ref={p.id === live ? ref : undefined} className={`w-[17.5rem] shrink-0 rounded-xl border pb-2 ${BOX[st]}`}>
        <header className={`flex h-14 items-center gap-2.5 border-b px-3.5 ${st === 'live' ? 'border-sky-500/30' : ''}`}>
          <span className={`size-3.5 shrink-0 rounded-full ${HEAD[st]}`} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{p.name}</span>
            <span className="block font-mono text-[0.6875rem] text-muted-foreground">{{ chain: '체인', engine: '엔진', node: '노드' }[p.kind]}{t ? ` · ${t}` : ''}</span>
          </span>
          {p.track && <span className="shrink-0 rounded-md bg-violet-500/12 px-1.5 font-mono text-[0.6875rem] font-semibold text-violet-700 dark:text-violet-300">{p.track}</span>}
          <span className={`ml-auto shrink-0 font-mono text-[0.8125rem] font-bold tabular-nums ${st === 'done' ? 'text-emerald-700 dark:text-emerald-400' : st === 'live' ? 'text-sky-700 dark:text-sky-300' : 'text-muted-foreground'}`}>{d}/{p.keys.length}</span>
        </header>
        {p.groups.map((g, i) => (
          <div key={`${g.name}:${i}`}>
            {named && g.name && (
              <p className="flex items-center gap-2 px-3.5 pt-2.5 pb-0.5 text-[0.6875rem] font-semibold text-muted-foreground">
                {g.name}<span className="h-px flex-1 bg-border" /><span className="font-mono tabular-nums">{g.keys.filter(k => !by.get(k)?.fixOnly && ['done', 'skipped'].includes(nodes[k].state)).length}/{g.keys.filter(k => !by.get(k)?.fixOnly).length}</span>
              </p>
            )}
            {g.keys.map(row)}
          </div>
        ))}
      </section>
    );
  };
  const wire = (tone: Tone, key: string) => <span key={key} aria-hidden className={`mt-[27px] w-8 shrink-0 ${H[tone]}`} />;
  // 갈림 · 합침 — 줄마다 제 몫의 세로선을 그려(첫 줄은 머리 가운데부터, 끝 줄은 머리 가운데까지) 이어 붙인다
  const bracket = (side: 'in' | 'out', tone: Tone, i: number, n: number): ReactNode => (
    <span aria-hidden className="relative w-6 shrink-0 self-stretch">
      <span className={`absolute inset-x-0 top-[27px] ${H[tone]}`} />
      {n > 1 && <span className={`absolute ${side === 'in' ? 'left-0' : 'right-0'} ${i === 0 ? 'top-[27px] bottom-0' : i === n - 1 ? 'top-0 h-[29px]' : 'inset-y-0'} ${V[tone]}`} />}
    </span>
  );

  const out: ReactNode[] = [];
  cols.forEach((c, ci) => {
    const st = colStatus(c), next = cols[ci + 1] ? colStatus(cols[ci + 1]) : null;
    if (ci > 0) out.push(wire(toneOf(st), `w${ci}`));
    if (c.kind === 'box') { out.push(box(c.phase)); return; }
    out.push(
      <div key={`l${ci}`} className="flex shrink-0 flex-col">
        {c.rows.map((r, i) => {
          const rs = merge(r.phases.map(status)), toJoin = rs === 'done' && next && next !== 'wait' ? toneOf(next) : 'todo';
          return (
            <div key={r.track} className="flex items-start pb-7 last:pb-0">
              {bracket('in', toneOf(status(r.phases[0])), i, c.rows.length)}
              {r.phases.map((p, j) => [j > 0 && wire(toneOf(status(p)), `w${p.id}`), box(p)])}
              <span className="relative mt-[27px] min-w-10 flex-1">
                <span className={`block ${H[toJoin]}`} />
                {rs === 'done' && next === 'wait' && <span className="absolute top-1.5 left-1 font-mono text-[0.625rem] font-bold whitespace-nowrap text-emerald-700 dark:text-emerald-400">합침 대기</span>}
              </span>
              {next && bracket('out', next === 'wait' ? 'todo' : 'done', i, c.rows.length)}
            </div>
          );
        })}
      </div>,
    );
  });

  return (
    <div ref={view} className="relative h-[70vh] cursor-grab touch-none overflow-hidden rounded-xl border bg-background select-none active:cursor-grabbing"
      style={{ backgroundImage: 'radial-gradient(var(--border) 1.2px, transparent 1.2px)', backgroundSize: `${20 * t.z}px ${20 * t.z}px`, backgroundPosition: `${t.x}px ${t.y}px` }}
      onPointerDown={e => { if (e.button === 0) { drag.current = { x: e.clientX, y: e.clientY, moved: false }; dragged.current = false; } }}
      onPointerMove={e => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) < 4) return;   // 4px 안은 클릭
        if (!d.moved) { d.moved = true; e.currentTarget.setPointerCapture(e.pointerId); }
        d.x = e.clientX; d.y = e.clientY;
        setT(o => ({ ...o, x: o.x + dx, y: o.y + dy }));
      }}
      onPointerUp={() => { dragged.current = !!drag.current?.moved; drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onClickCapture={e => { if (dragged.current) { e.stopPropagation(); dragged.current = false; } }}>
      <div className="relative flex w-max origin-top-left items-start" style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.z})` }}>{out}</div>
    </div>
  );
}
