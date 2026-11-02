// 펼쳐 보기 지도(공방 · 런 설정, 2026-11-02 시안 B) — 펼친 노드 한 줄(runner flatten)을 맨 위 엔진이 부르는 체인 · 엔진(역)으로 묶고,
// 역을 칸(앞 역이 다 끝나야 돈다) · 줄(같은 칸 = 동시에 도는 갈래)에 놓는다. 역 안은 든 체인마다 한 줄. React 없이 — src/stageMap.test.ts 가 확인한다.
import type { FlowStep } from './stepFlow.ts';

export type Row = { key: string; name: string; steps: FlowStep[] };
// row 는 줄 자리 — 역이 하나뿐인 칸은 가운데(소수)
export type Stage = { key: string; name: string; kind: 'chain' | 'engine' | 'node'; rows: Row[]; n: number; fix: number; prev: string[]; col: number; row: number };

// 맨 위 엔진에 바로 놓인 노드는 그 노드 하나가 역
const top = (s: FlowStep) => s.group === '.' ? `.${s.key}` : s.group.slice(0, s.group.indexOf('.') + 1);

// 이름마다 붙은 같은 첫 낱말(「팀 기획 파악」 · 「팀 테스트」 …)은 떼고 보인다 — 좁은 역 칸에서 가려지는 것이 그 낱말뿐이라
export function trimCommon(names: string[]): (s: string) => string {
  const w = names[0]?.split(' ')[0] ?? '', all = names.length > 1 && !!w && names.every(n => n.startsWith(`${w} `));
  return s => all && s.startsWith(`${w} `) ? s.slice(w.length + 1) : s;
}

export function stagesOf(steps: FlowStep[]): { stages: Stage[]; cols: number; rows: number } {
  const m = new Map<string, Stage>(), at = new Map<string, string>();
  for (const s of steps) {
    const k = top(s);
    at.set(s.key, k);
    let g = m.get(k);
    if (!g) m.set(k, g = { key: k, name: s.group === '.' ? s.title : s.boxes?.[0]?.name ?? s.lane, kind: s.group === '.' ? 'node' : s.boxes?.[0]?.kind ?? 'chain', rows: [], n: 0, fix: 0, prev: [], col: 0, row: 0 });
    if (s.fixOnly) { g.fix++; continue; }
    g.n++;
    for (const d of s.deps) { const p = at.get(d); if (p && p !== k && !g.prev.includes(p)) g.prev.push(p); }
    // 줄 — 든 체인(역 밑으로 바깥 › 안)마다, 이어 나오는 것끼리. 역에 바로 놓인 노드는 역 이름. 옛 런(boxes 없음)은 lane
    // ponytail: 줄 안 노드는 도는 차례대로 한 줄 — 체인 안에서 갈리는 화살표는 보이지 않는다
    const name = s.boxes ? s.boxes.slice(1).map(b => b.name).join(' › ') || g.name : s.lane, last = g.rows.at(-1);
    if (last?.key === s.group) last.steps.push(s); else g.rows.push({ key: s.group, name, steps: [s] });
  }
  const stages = [...m.values()].filter(g => g.n), by = new Map(stages.map(g => [g.key, g])), taken = new Set<string>();
  // 칸 — 앞 역 중 가장 늦은 칸 다음(역은 도는 차례로 나오니 앞 역의 칸이 먼저 정해진다)
  for (const g of stages) {
    g.col = Math.max(-1, ...g.prev.map(p => by.get(p)?.col ?? 0)) + 1;
    // 앞 역 하나만 잇고 그 역도 이 역만 이으면 같은 줄로 — 갈래가 제 줄을 지킨다
    const p = g.prev.length === 1 ? by.get(g.prev[0]) : undefined;
    let row = p && p.col === g.col - 1 && stages.filter(x => x.prev.includes(p.key)).length === 1 ? p.row : 0;
    while (taken.has(`${g.col},${row}`)) row++;
    taken.add(`${g.col},${row}`);
    g.row = row;
  }
  const rows = Math.max(0, ...stages.map(g => g.row + 1)), cols = Math.max(0, ...stages.map(g => g.col + 1));
  for (const g of stages) if (stages.filter(x => x.col === g.col).length === 1) g.row = (rows - 1) / 2;
  const t = trimCommon(stages.filter(g => g.kind !== 'node').flatMap(g => [g.name, ...g.rows.map(r => r.name)]));
  for (const g of stages) if (g.kind !== 'node') { g.name = t(g.name); for (const r of g.rows) r.name = t(r.name); }
  return { stages, cols, rows };
}
