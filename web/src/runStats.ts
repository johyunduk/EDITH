// 런 분석(런 화면 「분석」)의 자료 꼴과 「먼저 볼 것」 — 숫자 표 대신 어디를 봐야 하는지 몇 줄로 고른다.
// 서버 src/analysis.ts runAnalysis 의 답. React 없이 — src/runStats.test.ts 가 확인한다.
import { dur, type ClaudeUsed } from './runFlow.ts';

export type Tok = { input: number; output: number; cacheRead: number; cacheWrite: number; models: string[] };
// state 는 NodeState(StepFlow.tsx) — 서버 tsc 가 .tsx 를 못 읽어 글자로 둔다
export type StatNode = {
  key: string; title: string; place: string; phase?: string; kind: string; fixOnly: boolean; state: string; attempts: number; fails: number; rewound: number;
  time: { work: number; human: number; stop: number } | null; tokens: Tok | null; claude: ClaudeUsed | null; inside: { first: number; last: number; tools: Record<string, number>; busy: number } | null;
};
export type Stats = {
  id: number; elapsed: number; timed: boolean; rewinds: unknown[]; records: Record<string, unknown>[]; nodes: StatNode[];
  flow: { work: number; human: number; stop: number; idle: number; spans: { from: number; to: number; kind: 'human' | 'idle' | 'stop'; keys: string[] }[] } | null;
  phases?: { name: string; ms: number }[];   // 옛 서버는 없다
  lanes: { track: string; first: number | null; last: number | null; work: number; human: number; waited: number | null; join: string | null }[];
  redo: { again: number; fixing: number };
  codex: { nodes: Record<string, { in: number; out: number; cacheR: number }>; weekly: [number, number] | null };
  compare: { id: number; state: string; created: number; elapsed: number; human: number; phases: { name: string; ms: number }[] }[];
};

export const inTok = (t: Tok) => t.input + t.cacheRead + t.cacheWrite;
// 옛 서버(다시 켜기 전)는 phase · phases 가 없다 — 자리 첫 상자 · 비교 표의 이 런 줄로
const phaseOf = (x: StatNode) => x.phase ?? x.place?.split(' › ')[0] ?? x.title;
const phasesOf = (a: Stats) => a.phases ?? a.compare.find(c => c.id === a.id)?.phases ?? [];
const pct = (a: number, b: number) => `${Math.round(a / (b || 1) * 100)}%`;
// 노드에서 가장 오래 걸린 도구(사람 질문 창 빼고, 30초 넘는 것만)
const topTool = (x: StatNode) => Object.entries(x.inside?.tools ?? {}).filter(([k, v]) => k !== '질문 창(사람)' && v >= 30_000).sort((p, q) => q[1] - p[1])[0];

export type Item = { text: string; sub?: string; key?: string };
export type Row = { label: string; items: Item[]; none?: string };
// 먼저 볼 것 — 오래 걸린 단계 · 노드, 사람을 기다린 곳, 다시 돈 노드, 병목 갈래. 해당 없는 줄은 「none」 글(사람 대기 없음도 알 만한 것)
export function highlights(a: Stats, cut = (n: string) => n): Row[] {
  const name = (k: string) => a.nodes.find(x => x.key === k)?.title ?? k;
  const slowPhases = [...phasesOf(a)].sort((x, y) => y.ms - x.ms).filter(p => p.ms >= 60_000).slice(0, 2);
  const slowNodes = a.nodes.filter(x => (x.time?.work ?? 0) >= 60_000).sort((x, y) => y.time!.work - x.time!.work).slice(0, 3);
  const human = (a.flow?.spans ?? []).filter(s => s.kind === 'human').slice(0, 3);
  const again = a.nodes.filter(x => x.attempts > 1 || x.fails > 0 || x.rewound > 0);
  const rows: Row[] = [
    { label: '오래 걸린 단계', items: slowPhases.map(p => ({ text: cut(p.name), sub: `${dur(p.ms)} · 런의 ${pct(p.ms, a.elapsed)}` })) },
    { label: '오래 걸린 노드', items: slowNodes.map(x => { const t = topTool(x); return { text: x.title, sub: `${dur(x.time!.work)}${t ? ` · 가장 긴 도구 ${t[0]} ${dur(t[1])}` : ''}`, key: x.key }; }) },
    { label: '사람 대기', none: '없음 — 사람을 기다린 시간 없이 돌았다',
      items: human.map(s => ({ text: s.keys.map(name).join(' · ') || '도는 노드 없음', sub: dur(s.to - s.from), key: s.keys[0] })) },
    { label: '다시 돈 노드', none: '없음 — 모든 노드가 한 번에 끝났다',
      items: again.map(x => ({ text: x.title, sub: [x.attempts > 1 && `시도 ${x.attempts}`, x.fails && `고침 ${x.fails}`, x.rewound && `되돌려 옴 ${x.rewound}`].filter(Boolean).join(' · '), key: x.key })) },
  ];
  // 갈래가 여럿이면 늦게 끝난 갈래가 병목 — 먼저 끝난 갈래가 합침 앞에서 기다린 시간
  const late = Math.max(...a.lanes.map(l => l.last ?? 0)), slow = a.lanes.find(l => l.last === late), waited = a.lanes.filter(l => (l.waited ?? 0) >= 60_000);
  if (a.lanes.length > 1 && slow && waited.length) rows.push({ label: '병목 갈래', items: [{ text: `${slow.track} 갈래가 늦게 끝났다`, sub: waited.map(l => `${l.track} 가 합침 앞에서 ${dur(l.waited!)} 기다림`).join(' · ') }] });
  return rows.filter(r => r.items.length || r.none);
}

// 단계별 — 노드를 큰 단계(phase) 이름으로 묶어 런 차례대로. 걸린 시간은 서버 phases(처음 시작 ~ 마지막 끝), 안 돈 단계는 0
export function byPhase(a: Stats) {
  const out = new Map<string, { name: string; ms: number; nodes: StatNode[] }>(), ms = new Map(phasesOf(a).map(p => [p.name, p.ms]));
  for (const x of a.nodes) {
    if (x.fixOnly && !x.attempts) continue;
    const n = phaseOf(x), p = out.get(n) ?? { name: n, ms: ms.get(n) ?? 0, nodes: [] };
    p.nodes.push(x);
    out.set(n, p);
  }
  return [...out.values()];
}
