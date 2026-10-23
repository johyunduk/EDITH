// 런 타임라인 — 런 화면 기본 보기. 실행기가 노드 상태가 바뀔 때마다 적는 events.jsonl 을 노드 시도 하나씩으로 묶고,
// 그 시도의 결과(스킬은 result.json 요약, 명령은 출력 마지막 줄)를 붙여 일어난 차례대로 늘어놓는다(맨 아래가 지금).
// 통과한 명령 · 건너뛴 노드는 이어진 것끼리 한 줄로 묶고, 맨 위 체인 · 엔진에 처음 들어간 때를 가름줄로, 되돌림을 줄로 끼운다.
import type { Ev } from './analysis.ts';
import type { ClaudeUsed, NodeState, Run } from './runner.ts';

// 시도 하나 — 보내기 시작한 때부터 끝(끝 · 건너뜀 · 확인 필요 · 멈춤, 또는 실패해 기다림으로 돌아감)까지. end 가 없으면 지금 도는 것.
export type Try = { key: string; attempt: number; start: number; end?: number; how?: NodeState; work: number; human: number };
export type Entry = {
  kind: 'node' | 'pass' | 'skip' | 'rewind' | 'phase'; t: number; keys: string[]; titles: string[];
  place?: string; tone?: 'now' | 'done' | 'warn' | 'fail'; state?: NodeState; how?: NodeState; attempt?: number; fixOnly?: boolean;
  work?: number; human?: number; text?: string; line?: string;   // line = 사람용 한 줄(결과 파일 「한줄」)
  claude?: ClaudeUsed;   // 그 시도에 띄운 Claude 설정 · 엔진이 적은 이유(판단자 등)
};
export type Got = { summary?: string; line?: string; out?: string; claude?: ClaudeUsed };

const ACTIVE: NodeState[] = ['sending', 'running', 'blocked'];

export function tries(events: Ev[]): Try[] {
  const out: Try[] = [], open = new Map<string, Try>(), last = new Map<string, Ev>();
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    const p = last.get(e.key);
    if (p && p.state === e.state && p.attempt === e.attempt) continue;   // EDITH 를 다시 켜면 같은 상태를 또 적는다
    last.set(e.key, e);
    const c = open.get(e.key);
    if (c && p) {
      if (p.state === 'running' || p.state === 'sending') c.work += e.t - p.t;
      else if (p.state === 'blocked') c.human += e.t - p.t;
    }
    if (ACTIVE.includes(e.state)) {
      if (!c || c.attempt !== e.attempt) { const n = { key: e.key, attempt: e.attempt, start: e.t, work: 0, human: 0 }; out.push(n); open.set(e.key, n); }
      continue;
    }
    if (c) { c.end = e.t; c.how = e.state; open.delete(e.key); }   // wait = 실패해 고치는 노드로(또는 멈춤 뒤 다시)
    else if (e.state === 'skipped') out.push({ key: e.key, attempt: e.attempt, start: e.t, end: e.t, how: 'skipped', work: 0, human: 0 });
  }
  return out;
}

export function timeline(r: Run, events: Ev[], got: (key: string, attempt: number) => Got): Entry[] {
  const by = new Map(r.steps.map(s => [s.key, s])), list = tries(events).filter(x => by.has(x.key));
  const items: Entry[] = [], seen = new Set<string>();
  for (const x of list) {
    const s = by.get(x.key)!, n = r.nodes[x.key], g = got(x.key, x.attempt), mine = x.attempt === n.attempt;
    const place = s.boxes?.map(b => b.name).join(' › ') ?? s.lane, top = s.boxes?.[0]?.name;
    // 맨 위 체인 · 엔진에 처음 들어간 때 — 그 노드 바로 위(1ms 앞)에 놓인다
    if (top && !seen.has(top)) { seen.add(top); items.push({ kind: 'phase', t: x.start - 1, keys: [], titles: [top] }); }
    if (x.how === 'skipped') { items.push({ kind: 'skip', t: x.start, keys: [x.key], titles: [s.title], text: g.line ?? g.summary ?? (mine ? n.line ?? n.reason : undefined) }); continue; }
    if (x.how === 'done' && s.kind === 'command') { items.push({ kind: 'pass', t: x.start, keys: [x.key], titles: [s.title], text: g.out }); continue; }
    const tone = !x.end ? 'now' : x.how === 'done' ? 'done' : x.how === 'check' || x.how === 'stopped' ? 'warn' : 'fail';
    const text = !x.end ? undefined : s.kind === 'command' ? g.out ?? (mine ? n.reason : undefined) : g.summary ?? (mine ? n.summary ?? n.reason : undefined);
    items.push({ kind: 'node', t: x.start, keys: [x.key], titles: [s.title], place, tone, state: x.end ? undefined : n.state, how: x.how, attempt: x.attempt,
      fixOnly: s.fixOnly, work: x.work, human: x.human, text, line: !x.end || s.kind === 'command' ? undefined : g.line ?? (mine ? n.line : undefined), ...(g.claude ? { claude: g.claude } : {}) });
  }
  for (const w of r.rewinds ?? []) items.push({ kind: 'rewind', t: w.at, keys: by.has(w.to) ? [w.to] : [], titles: [w.name], text: `${w.by} — ${w.reason}` });
  items.sort((a, b) => a.t - b.t);
  // 이어진 통과 · 건너뜀은 한 줄로
  return items.reduce<Entry[]>((acc, e) => {
    const p = acc.at(-1);
    if (p && p.kind === e.kind && (e.kind === 'pass' || e.kind === 'skip')) { p.keys.push(...e.keys); p.titles.push(...e.titles); p.text = undefined; }
    else acc.push({ ...e, keys: [...e.keys], titles: [...e.titles] });
    return acc;
  }, []);
}

// 명령 출력의 마지막 말 줄 — 「}」 같은 기호만 있는 줄은 건너뛴다
export const lastLine = (t?: string) => t?.split('\n').map(x => x.trim()).filter(x => /[\p{L}\p{N}]{2}/u.test(x)).at(-1)?.slice(0, 300);
