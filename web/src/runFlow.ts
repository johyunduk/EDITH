// 런 흐름(런 화면 「캔버스」)의 자리 — 런이 펼친 노드 한 줄(runner.ts flatten)을 큰 단계 상자와 갈래 줄로 묶는다.
// 큰 단계 = 맨 위 엔진에 놓인 체인 · 엔진(펼친 상자 맨 바깥) 하나. 엔진 상자 안은 그 아래 체인(둘째 상자)마다 소제목으로 나눈다.
// 같은 갈래(track)의 큰 단계가 이어지면 갈래마다 줄 하나로 묶어 위아래로 세운다(갈림 · 합침은 그 앞뒤). 고치는 노드는 상자에 넣되 세지 않는다.
// React 없이 — src/runFlow.test.ts 가 확인한다.
import type { FlowStep } from './stepFlow.ts';

export type Phase = { id: string; name: string; kind: 'chain' | 'engine' | 'node'; track?: string; keys: string[]; groups: { name: string; keys: string[] }[] };
export type Col = { kind: 'box'; phase: Phase } | { kind: 'lanes'; rows: { track: string; phases: Phase[] }[] };
export type Status = 'live' | 'done' | 'part' | 'wait';

export function phases(steps: FlowStep[]): Phase[] {
  const m = new Map<string, Phase>();
  for (const s of steps) {
    const id = s.boxes?.length ? s.key.split('.')[0] : s.key;
    let p = m.get(id);
    if (!p) { p = { id, name: s.boxes?.[0]?.name ?? s.title, kind: s.boxes?.[0]?.kind ?? 'node', track: s.track, keys: [], groups: [] }; m.set(id, p); }
    if (!s.fixOnly) { if (p.track !== s.track) p.track = undefined; p.keys.push(s.key); }
    const g = s.boxes?.[1]?.name ?? '', last = p.groups.at(-1);
    if (last?.name === g) last.keys.push(s.key); else p.groups.push({ name: g, keys: [s.key] });
  }
  return [...m.values()];
}

// 갈래가 있는 큰 단계는 바로 앞 칸이 갈래 묶음이면 거기에(그 갈래 줄 끝에), 아니면 새 묶음을 연다
export function columns(ps: Phase[]): Col[] {
  const cols: Col[] = [];
  for (const p of ps) {
    const last = cols.at(-1);
    if (!p.track) { cols.push({ kind: 'box', phase: p }); continue; }
    if (last?.kind !== 'lanes') { cols.push({ kind: 'lanes', rows: [{ track: p.track, phases: [p] }] }); continue; }
    const row = last.rows.find(r => r.track === p.track);
    if (row) row.phases.push(p); else last.rows.push({ track: p.track, phases: [p] });
  }
  return cols;
}

// 노드 상태들의 묶음 상태 — 하나라도 돌거나 사람을 기다리면 live, 다 끝(건너뜀 포함)이면 done, 몇은 끝이면 part
export function statusOf(states: string[]): Status {
  if (states.some(x => x === 'running' || x === 'sending' || x === 'blocked' || x === 'check')) return 'live';
  const n = states.filter(x => x === 'done' || x === 'skipped').length;
  return n && n === states.length ? 'done' : n ? 'part' : 'wait';
}
// 이름들이 모두 같은 낱말로 시작하면(엔진 이름 「가다 …」 같은) 그 낱말을 뗀다 — 칩 · 표가 같은 말로 시작해 읽기 어렵다. 전체 이름은 title 로
export function dropShared(names: string[]) {
  const w = names[0]?.split(' ')[0] ?? '', all = names.length > 1 && !!w && names.every(n => n.startsWith(`${w} `) && n.length > w.length + 1);
  return (n: string) => all && n.startsWith(`${w} `) ? n.slice(w.length + 1) : n;
}

export const merge = (all: Status[]): Status => statusOf(all.flatMap(s => s === 'live' ? ['running'] : s === 'done' ? ['done'] : s === 'part' ? ['done', 'wait'] : ['wait']));

export const dur = (ms: number) => { const s = Math.round(ms / 1000); return s < 60 ? `${s}초` : s < 3600 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${Math.floor(s / 3600)}시간 ${Math.floor(s % 3600 / 60)}분`; };

// 타임라인 체인 카드(RunTimeline.tsx) — 체인 = 노드가 든 체인(group, 맨 위 엔진에 바로 놓인 노드는 혼자 한 체인).
// 지금: 도는 · 확인 필요 노드(nowKeys)가 있거나, 시작했는데 다 끝나지 않았다. 끝: 다 끝남 · 건너뜀(마지막으로 끝난 차례). 남음: 아무것도 시작 안 함(끝난 런은 없음)
// 고치는 노드는 돌았을 때만 그 체인에 든다
type ChainStep = { key: string; group: string; fixOnly?: boolean };
export function chainView(steps: ChainStep[], node: (k: string) => { state: string; attempt: number }, endAt: (k: string) => number, nowKeys: string[], over: boolean) {
  const group = new Map(steps.map(s => [s.key, s.group])), of = (k: string) => group.get(k) || k;
  const ids = [...new Set(steps.filter(s => !s.fixOnly).map(s => of(s.key)))];
  const keys = (c: string) => steps.filter(s => of(s.key) === c && (!s.fixOnly || node(s.key).attempt > 0)).map(s => s.key);
  const started = (c: string) => keys(c).some(k => node(k).state !== 'wait');
  const settled = (c: string) => keys(c).every(k => node(k).state === 'done' || node(k).state === 'skipped');
  const now = ids.filter(c => nowKeys.some(k => of(k) === c) || (started(c) && !settled(c)));
  const end = (c: string) => Math.max(0, ...keys(c).map(endAt));
  const done = ids.filter(c => !now.includes(c) && started(c) && settled(c)).sort((a, b) => end(a) - end(b));
  return { of, keys, now, done, ahead: over ? [] : ids.filter(c => !now.includes(c) && !started(c)) };
}

// 런 입력의 노션 주소(노션 기획 · 이슈 페이지로 시작한 런) — 첫 것만. 글 속 괄호 · 낫표 · 끝 문장부호는 주소에서 뺀다
export const notionUrl = (input: string) => input.match(/https?:\/\/(?:[\w-]+\.)*notion\.(?:so|site|com)\/[^\s)\]>」』"']+/)?.[0].replace(/[.,]+$/, '')
  .replace(/^(https?:\/\/app\.notion\.com\/)(?!p\/)/, '$1p/'); // app.notion.com 은 /p/ 없이 열면 404

// 사람용 한 줄 — 결과 파일에 「한줄」 이 없을 때(옛 런 · 안 쓴 스킬) 요약의 첫 문장을 n자 안으로
export function short(t?: string, n = 70) {
  const first = t?.split('\n')[0].trim();
  if (!first) return undefined;
  const cut = first.search(/(?<=다\.|\.)\s|\s—\s/);
  const s = cut >= 8 ? first.slice(0, cut).replace(/\.$/, '') : first;
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// 띄운 Claude 설정 칩 — 「Opus · xhigh · 판단자」(이유 글의 첫 낱말이 누가 정했는지). 설정이 없으면 「기본」
export type ClaudeUsed = { model?: string; effort?: string; mcp?: number; why?: string };
export function claudeChip(c?: ClaudeUsed | null) {
  if (!c) return undefined;
  const m = c.model?.replace(/^claude-/, '').split('-')[0], model = m ? m[0].toUpperCase() + m.slice(1) : '기본';
  return [model, c.effort, c.why?.split(/\s/)[0]].filter(Boolean).join(' · ');
}

// 지난 런 목록(런 화면 「지난 런」 탭) — 찾기 낱말이 모두 들어 있고 상태가 맞는 것만, 만든 날로 묶는다(목록이 새것부터라 같은 날은 붙어 온다). 오늘은 「오늘 M.D」
type PastRun = { id: number; name: string; state: string; created: number; tag?: string; title?: string; agenda?: string };
export function pastDays<T extends PastRun>(past: T[], q: string, only: 'all' | 'done' | 'dropped', now = new Date()): [string, T[]][] {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const day = (t: number) => { const d = new Date(t), s = `${d.getMonth() + 1}.${d.getDate()}`; return d.toDateString() === now.toDateString() ? `오늘 ${s}` : s; };
  return past.filter(r => (only === 'all' || r.state === only) && words.every(w => [`#${r.id}`, r.tag, r.title, r.agenda, r.name].join(' ').toLowerCase().includes(w)))
    .reduce<[string, T[]][]>((a, r) => { const k = day(r.created), last = a.at(-1); if (last?.[0] === k) last[1].push(r); else a.push([k, [r]]); return a; }, []);
}
