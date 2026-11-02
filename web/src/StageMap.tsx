// 펼쳐 보기(시안 B) — 위는 엔진 전체를 역 지도로(칸 = 도는 차례, 같은 칸 = 동시에 도는 갈래), 아래는 고른 역만 든 체인마다 한 줄로 노드까지.
// 역 · 칸 · 줄은 stageMap.ts. 노드를 누르면 onPick(공방은 그 체인으로 간다). 고치는 노드는 따로 그리지 않고 부르는 노드 옆 「고침」 으로.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ROLE } from './EngineMap.tsx';
import { stagesOf, type Stage } from './stageMap.ts';
import type { FlowStep } from './stepFlow.ts';
import { Icon } from './ui.tsx';

const SH = 34, RG = 10, CG = 36;   // 역 높이 · 줄 사이 · 칸 사이(화살표 자리)
const KIND = { engine: '엔진', chain: '체인', node: '노드' } as const;
const roleOf = (s: FlowStep) => s.humanWait ? 'wait' : s.kind === 'command' ? 'check' : 'claude';
const FIX = <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>;
const ARROW = <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>;

export function StageMap({ steps, draft, onPick }: { steps: FlowStep[]; draft?: boolean; onPick: (s: FlowStep) => void }) {
  const { stages, cols, rows } = useMemo(() => stagesOf(steps), [steps]), by = useMemo(() => new Map(steps.map(s => [s.key, s])), [steps]);
  const [sel, setSel] = useState(0);
  // 역 폭은 지도 칸 폭에 맞춘다 — 너무 좁아지면(칸이 많으면) 옆으로 민다
  const box = useRef<HTMLDivElement>(null), [w, setW] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth - 24));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (!stages.length) return null;
  const i = Math.min(sel, stages.length - 1), g = stages[i], next = stages[i + 1];
  const SW = Math.max(96, Math.min(168, Math.floor((w - CG * (cols - 1)) / cols)));
  const x = (s: Stage) => s.col * (SW + CG), y = (s: Stage) => s.row * (SH + RG) + SH / 2;
  const W = cols * SW + (cols - 1) * CG, H = rows * SH + (rows - 1) * RG;
  // ponytail: 칸을 건너뛰는 화살표는 사이 칸의 역 뒤로 지나간다
  const edges = stages.flatMap(t => t.prev.flatMap(k => {
    const p = stages.find(s => s.key === k);
    if (!p) return [];
    const ax = x(p) + SW, bx = x(t), c = (bx - ax) / 2;
    return [`M${ax} ${y(p)}C${ax + c} ${y(p)} ${bx - c} ${y(t)} ${bx} ${y(t)}`];
  }));
  const live = steps.filter(s => !s.fixOnly).length;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {(['claude', 'check', 'wait'] as const).map(k => <span key={k} className="flex items-center gap-1.5"><Icon className={`size-3.5 ${ROLE[k].tone}`}>{ROLE[k].icon}</Icon>{ROLE[k].label}</span>)}
        <span className="flex items-center gap-1.5"><Icon className="size-3.5 text-rose-600 dark:text-rose-400">{FIX}</Icon>고침 — 실패하면 고치는 노드가 돈다</span>
        {draft && <span className="text-violet-700 dark:text-violet-300">초안 기준(적용하면 이대로)</span>}
        <span className="ml-auto">노드 {live}개 · 고치는 노드 {steps.length - live}개 · 역을 누르면 아래에 펼친다 · 노드를 누르면 그 체인으로 간다</span>
      </div>
      <div ref={box} className="shrink-0 overflow-x-auto rounded-xl border bg-card p-3">
        <div className="relative" style={{ width: W, height: H }}>
          <svg className="absolute inset-0 overflow-visible" width={W} height={H} aria-hidden="true">
            <defs><marker id="stage-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--muted-foreground)" opacity="0.6" /></marker></defs>
            {edges.map(d => <path key={d} d={d} fill="none" stroke="var(--muted-foreground)" strokeOpacity="0.45" strokeWidth="1.5" markerEnd="url(#stage-arrow)" />)}
          </svg>
          {stages.map((s, j) => (
            <button key={s.key} type="button" aria-pressed={j === i} title={`${s.name} — ${KIND[s.kind]} · 노드 ${s.n}`} onClick={() => setSel(j)}
              style={{ left: x(s), top: y(s) - SH / 2, width: SW, height: SH }}
              className={`absolute flex items-center gap-2 rounded-lg border px-2.5 text-xs shadow-xs ${j === i ? 'border-primary bg-accent text-accent-foreground ring-2 ring-primary/20' : 'bg-background hover:bg-muted'}`}>
              <span className="min-w-0 flex-1 truncate text-left font-semibold">{s.name}</span>
              <span className="tabular-nums text-muted-foreground">{s.n}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto rounded-xl border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-2.5 pb-2">
          <span className="grid size-6 place-items-center rounded-full bg-accent text-xs font-bold text-accent-foreground">{i + 1}</span>
          <h3 className="text-base font-bold">{g.name}</h3>
          <span className="text-xs text-muted-foreground">{KIND[g.kind]}{g.kind === 'engine' ? ` · 체인 ${g.rows.length}` : ''} · 노드 {g.n}{g.fix ? ` · 고치는 노드 ${g.fix}` : ''}</span>
          <span className="ml-auto flex gap-1.5">
            <Button size="sm" variant="outline" disabled={!i} onClick={() => setSel(i - 1)}>‹ 이전</Button>
            <Button size="sm" variant="outline" disabled={!next} onClick={() => setSel(i + 1)}>{next ? `다음 · ${next.name}` : '다음'} ›</Button>
          </span>
        </div>
        {g.rows.map(r => (
          <div key={r.steps[0].key} className="grid grid-cols-[9.5rem_minmax(0,1fr)] items-start gap-3.5 border-t border-dashed py-2">
            <div className="pt-1">
              <div className="text-[0.8125rem] font-semibold">{r.name}</div>
              <div className="text-[0.6875rem] text-muted-foreground">노드 {r.steps.length}</div>
            </div>
            <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
              {/* 화살표는 뒤 노드에 붙여 둔다 — 줄이 접히면 다음 줄 앞에 와서 이어짐이 보인다 */}
              {r.steps.map((s, j) => (
                <span key={s.key} className="inline-flex items-center gap-1">
                  {j > 0 && <Icon className="size-3.5 text-muted-foreground/50">{ARROW}</Icon>}
                  <button type="button" onClick={() => onPick(s)} className="inline-flex min-h-[1.875rem] items-center gap-1.5 rounded-lg border bg-background px-2 py-1 text-left text-[0.8125rem] shadow-xs hover:bg-muted">
                    <Icon className={`size-3.5 ${ROLE[roleOf(s)].tone}`}>{ROLE[roleOf(s)].icon}</Icon>
                    <span>{s.title}</span>
                    {s.failTo && (
                      <span title={`실패하면 「${by.get(s.failTo)?.title ?? s.failTo}」`} className="inline-flex items-center gap-0.5 rounded-full bg-rose-500/10 px-1.5 text-[0.65rem] font-semibold leading-[1.125rem] text-rose-600 dark:text-rose-400">
                        <Icon className="size-3">{FIX}</Icon>고침
                      </span>
                    )}
                  </button>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
