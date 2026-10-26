// 런 분석 — 노드마다 걸린 시간(일한 시간 · 사람 대기 · 멈춤) · 결과 · 시도 · 고침 · 되돌려 온 수 · Claude 토큰, 그리고 엔진이 남긴 기록 표.
// 시간은 실행기가 노드 상태가 바뀔 때마다 적는 runs/<번호>/events.jsonl 에서, 토큰은 작업 폴더의 Claude 세션 기록에서 읽는다.
// 엔진이 자기 기록(단계 · 사유 등)을 같이 보이고 싶으면 작업 문서의 edith-records.jsonl 에 한 줄에 JSON 하나씩 쓴다.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';
import { transcriptDir } from './chat.ts';
import { claudeOf, listRuns, loadRun, readEvents, RUNS, type NodeState, type Run } from './runner.ts';
import { tries } from './timeline.ts';

export type Ev = { t: number; key: string; state: NodeState; attempt: number; fp?: string };   // fp = 시도가 시작될 때 코드 지문(runner codeFp)
type Time = { work: number; human: number; stop: number; first?: number; last?: number };
type Tok = { input: number; output: number; cacheRead: number; cacheWrite: number; models: string[] };

// 노드마다 상태 구간을 더한다 — 도는 중 · 보내는 중은 일한 시간, 답 기다림 · 확인 필요는 사람 대기, 멈춤은 따로. 마지막 구간은 end 까지.
export function timings(events: Ev[], end: number) {
  const out: Record<string, Time> = {}, open = new Map<string, Ev>();
  const add = (e: Ev, t: number) => {
    const o = out[e.key] ??= { work: 0, human: 0, stop: 0 }, d = Math.max(0, t - e.t);
    if (e.state === 'running' || e.state === 'sending') o.work += d;
    else if (e.state === 'blocked' || e.state === 'check') o.human += d;
    else if (e.state === 'stopped') o.stop += d;
  };
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    const p = open.get(e.key);
    if (p) add(p, e.t);
    open.set(e.key, e);
    const o = out[e.key] ??= { work: 0, human: 0, stop: 0 };
    if (e.state !== 'wait') o.first ??= e.t;
    // 끝난 때는 끝으로 바뀐 순간만 — EDITH 를 다시 켜면 모든 노드를 같은 상태로 또 적는다
    if ((e.state === 'done' || e.state === 'skipped') && p?.state !== e.state) o.last = e.t;
  }
  for (const e of open.values()) add(e, end);
  return out;
}

// 흐름 — 벽시계로 런을 나눈다: 어느 노드든 돌면 「일」, 아니고 답 · 확인을 기다리면 「사람」, 멈춤이면 「멈춤」, 아무것도 아니면 「빈」(노드 사이 · 합침 대기 등).
// 갈래가 겹쳐 도는 시간을 두 번 세지 않는다. 사람 · 빈 구간은 긴 것부터(무엇을 기다렸는지 노드 키와 함께).
export type Span = { from: number; to: number; kind: 'human' | 'idle' | 'stop'; keys: string[] };
export function flow(events: Ev[], start: number, end: number) {
  const evs = [...events].sort((a, b) => a.t - b.t), st = new Map<string, Ev['state']>(), sum = { work: 0, human: 0, stop: 0, idle: 0 }, spans: Span[] = [];
  let i = 0;
  for (let t = start; t < end;) {
    while (i < evs.length && evs[i].t <= t) { st.set(evs[i].key, evs[i].state); i++; }
    const next = Math.min(end, evs[i]?.t ?? end), d = next - t, s = [...st];
    const on = (xs: Ev['state'][]) => s.filter(([, v]) => xs.includes(v)).map(([k]) => k);
    const kind = on(['running', 'sending']).length ? 'work' : on(['blocked', 'check']).length ? 'human' : on(['stopped']).length ? 'stop' : 'idle';
    sum[kind] += d;
    if (kind !== 'work' && d > 0) {
      const keys = kind === 'human' ? on(['blocked', 'check']) : kind === 'stop' ? on(['stopped']) : [];
      const last = spans.at(-1);
      if (last && last.kind === kind && last.to === t && last.keys.join() === keys.join()) last.to = next; else spans.push({ from: t, to: next, kind, keys });
    }
    t = next > t ? next : end;
  }
  return { ...sum, spans: spans.filter(x => x.to - x.from >= 60_000).sort((a, b) => (b.to - b.from) - (a.to - a.from)).slice(0, 8) };
}
// 갈래 — 갈래마다 처음 시작 · 마지막 끝 · 일한 · 사람 시간, 합치는 노드가 시작할 때까지 기다린 시간(먼저 끝난 갈래가 기다림 — 늦게 끝난 갈래가 병목)
export function lanes(steps: { key: string; track?: string; deps: string[] }[], events: Ev[], time: Record<string, { work: number; human: number; first?: number; last?: number }>) {
  const tracks = [...new Set(steps.flatMap(s => s.track ? [s.track] : []))];
  if (!tracks.length) return [];
  const trackOf = new Map(steps.map(s => [s.key, s.track]));
  const join = steps.find(s => !s.track && s.deps.some(d => trackOf.get(d)));
  const joinAt = join ? time[join.key]?.first : undefined;
  return tracks.map(track => {
    const ks = steps.filter(s => s.track === track).map(s => s.key), ts = ks.map(k => time[k]).filter(Boolean);
    const first = Math.min(...ts.flatMap(x => x.first ?? [])), last = Math.max(...ts.flatMap(x => x.last ?? []));
    return {
      track, first: Number.isFinite(first) ? first : null, last: Number.isFinite(last) ? last : null,
      work: ts.reduce((a, x) => a + x.work, 0), human: ts.reduce((a, x) => a + x.human, 0),
      waited: joinAt && Number.isFinite(last) ? Math.max(0, joinAt - last) : null, join: join?.key ?? null,
    };
  });
}

// 다시 돈 시간 — 같은 노드의 두 번째 이후 시도(실패 뒤 · 되돌림 뒤 · 이어서)와 고치는 노드가 일한 시간
export function redo(steps: { key: string; fixOnly?: boolean }[], events: Ev[]) {
  const fix = new Set(steps.filter(s => s.fixOnly).map(s => s.key)), out = { again: 0, fixing: 0 };
  for (const x of tries(events)) {
    if (fix.has(x.key)) out.fixing += x.work;
    else if (x.attempt > 1) out.again += x.work;
  }
  return out;
}
// Codex 사용량 — 엔진이 남긴 기록의 {"kind":"usage","node","codex":{"in","out","cacheR"},"weekly"} 줄을 노드마다 더하고, 주간 한도 %는 처음 · 끝
export function codexUsage(records: Record<string, unknown>[]) {
  const nodes: Record<string, { in: number; out: number; cacheR: number }> = {}, weekly: number[] = [];
  for (const o of records) {
    if (o.kind !== 'usage') continue;
    const c = (o.codex ?? {}) as Record<string, unknown>, k = typeof o.node === 'string' ? o.node : '';
    const n = nodes[k] ??= { in: 0, out: 0, cacheR: 0 }, num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : 0;
    n.in += num(c.in); n.out += num(c.out); n.cacheR += num(c.cacheR);
    if (typeof o.weekly === 'number') weekly.push(o.weekly);
  }
  return { nodes, weekly: weekly.length ? [weekly[0], weekly.at(-1)!] as [number, number] : null };
}
// 헛도는 검사 — 같은 노드의 다음 시도가 앞 시도와 같은 코드 지문(fp)으로 시작했다: 실패 · 고치기 · 사람 판단 뒤에도 코드가 그대로인 채 다시 돌았다.
// lost = 그런 시도마다 앞 시도 시작부터 이 시도 시작까지(앞 시도 · 고치기 · 사람 대기), passed = 마지막 시도가 끝남(코드 그대로 통과면 거짓 경보 의심)
export function sameCode(events: Ev[]) {
  const starts = new Map<string, { attempt: number; fp: string; t: number }[]>();
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    if (e.state !== 'running' || !e.fp) continue;
    const xs = starts.get(e.key) ?? [];
    if (xs.at(-1)?.attempt === e.attempt) continue;   // EDITH 를 다시 켜면 같은 시도를 또 적는다
    xs.push({ attempt: e.attempt, fp: e.fp, t: e.t });
    starts.set(e.key, xs);
  }
  const ts = tries(events);
  return [...starts].flatMap(([key, xs]) => {
    const same = xs.flatMap((x, i) => i > 0 && x.fp === xs[i - 1].fp ? [x.t - xs[i - 1].t] : []);
    if (!same.length) return [];
    return [{ key, attempts: xs.length, same: same.length, lost: same.reduce((a, b) => a + b, 0), passed: ts.filter(x => x.key === key).at(-1)?.how === 'done' }];
  });
}
// 레포 판단 — 엔진 기록의 마지막 {"kind":"repo-pick","must","check","human"} 을 런이 실제로 쓴 레포(작업 문서 edith-repos.json)와 그 레포에 커밋한 수에 견준다
const repoName = (dir: string) => {
  const g = spawnSync('git', ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', timeout: 3000 }).stdout?.trim();
  return g ? basename(dirname(g)) : basename(dir);
};
export function repoPick(id: number, records: Record<string, unknown>[]) {
  const p = records.findLast(o => o.kind === 'repo-pick');
  if (!p) return null;
  const list = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  let used: { path?: unknown; start?: unknown }[] = [];
  try { used = JSON.parse(readFileSync(join(RUNS, String(id), 'work', 'edith-repos.json'), 'utf8')); } catch { /* 워크트리를 아직 안 만들었다 */ }
  const picked = (Array.isArray(used) ? used : []).flatMap(x => typeof x?.path === 'string' && existsSync(x.path) ? [x as { path: string; start?: unknown }] : []).map(x => ({
    repo: repoName(x.path),
    commits: typeof x.start === 'string' ? Number(spawnSync('git', ['-C', x.path, 'rev-list', '--count', `${x.start}..HEAD`], { encoding: 'utf8', timeout: 3000 }).stdout?.trim() || 0) : null,
  }));
  return { must: list(p.must), check: list(p.check), human: p.human === true, picked };
}
// 큰 단계(맨 위 엔진의 체인 · 엔진)마다 처음 시작부터 마지막 끝까지 — 런 비교 표가 쓴다
export function phaseTimes(steps: { key: string; title: string; boxes?: { name: string }[] }[], events: Ev[]) {
  const name = new Map(steps.map(s => [s.key, s.boxes?.[0]?.name ?? s.title])), out = new Map<string, [number, number]>();
  for (const x of tries(events)) {
    const n = name.get(x.key);
    if (!n || !x.end) continue;
    const p = out.get(n);
    out.set(n, p ? [Math.min(p[0], x.start), Math.max(p[1], x.end)] : [x.start, x.end]);
  }
  return [...out].map(([n, [a, b]]) => ({ name: n, ms: b - a }));
}
// 같은 엔진으로 돈 다른 런(최근 6개)과 나란히 — 큰 단계마다 걸린 시간 · 전체 · 사람 대기
function compare(r: Run) {
  return listRuns().filter(x => x.engine === r.engine).slice(0, 6).flatMap(x => {
    const o = loadRun(x.id), ev = o ? readEvents(x.id) : [];
    if (!o || !ev.length) return [];
    const end = Math.max(...ev.map(e => e.t)), t = timings(ev, end);
    return [{ id: x.id, state: o.state, created: o.created, elapsed: end - o.created, human: Object.values(t).reduce((a, v) => a + v.human, 0), phases: phaseTimes(o.steps, ev) }];
  });
}

// Claude 토큰 — 작업 폴더의 세션 기록에서 EDITH 가 보낸 글(「[EDITH 런 #번호 ·」 · 결과 파일 nodes/<키>/<시도>/)을 찾아,
// 그 뒤의 답(같은 message.id 는 한 번)을 그 노드에 더한다. 노드마다 /clear 라 보통 노드 시도 하나가 세션 파일 하나다.
// shortcut: 런 시작 뒤 바뀐 세션 파일을 통째로 읽는다 — 같은 폴더에서 다른 큰 세션이 돌면 느려진다. 그러면 (파일 · 크기) 로 캐시한다
// 노드 안쪽 — 그 노드 대화의 처음 · 끝 시각과 도구별 걸린 시간(도구 호출 → 결과). 모델이 생각 · 글 쓴 시간은 나머지로 본다
export type Inside = { first: number; last: number; tools: Record<string, number>; busy: number; spans?: [number, number][]; turns?: number; reads?: Record<string, number>; readChars?: number };   // busy = 도구가 하나라도 돈 시간(겹친 것은 한 번)
// 읽기 — 읽은 파일(Read 도구, cat · head · sed 같은 Bash 가 연 파일)과 그 결과 글자 수. 경로는 끝 세 마디로
const READ_CMD = /\b(cat|head|tail|sed|less)\b/, FILE = /[^\s'"`;|&>()]+\.[A-Za-z]{1,5}\b/g;   // 확장자가 있는 낱말(읽기 명령 안에서만)
export function readPaths(name: string, input: unknown): string[] {
  const i = (input ?? {}) as { file_path?: unknown; command?: unknown };
  if (name === 'Read' && typeof i.file_path === 'string') return [i.file_path];
  if (name === 'Bash' && typeof i.command === 'string' && READ_CMD.test(i.command)) return [...new Set(i.command.match(FILE) ?? [])];
  return [];
}
const shortPath = (p: string) => p.split(/[\\/]/).filter(Boolean).slice(-3).join('/');
const resultChars = (c: unknown) => typeof c === 'string' ? c.length : Array.isArray(c) ? c.reduce((n, x) => n + (typeof x?.text === 'string' ? x.text.length : 0), 0) : 0;
// 도구 이름 — Bash 는 부른 스크립트(없으면 첫 낱말), 질문 창은 사람, MCP 는 끝 이름
export function toolLabel(name: string, input: unknown) {
  if (name === 'AskUserQuestion') return '질문 창(사람)';
  if (name === 'Bash') {
    const c = String((input as { command?: unknown })?.command ?? '');
    const word = c.split(/\s*(?:&&|;|\|)\s*|\s+/).find(w => /^[a-z][\w.-]*$/.test(w) && w !== 'cd');
    return `Bash ${c.match(/[\w.-]+\.(?:ts|mjs|js|sh|py)\b/)?.[0] ?? word ?? ''}`.trim();
  }
  return name.startsWith('mcp__') ? `MCP ${name.split('__').at(-1)}` : name;
}
export function tokensIn(lines: string[], run: number, into: Record<string, Tok>, inside: Record<string, Inside> = {}) {
  let cur: string | null = null;
  const seen = new Set<string>(), head = `[EDITH 런 #${run} ·`, open = new Map<string, { t: number; label: string; node: string; paths: string[] }>();
  const mark = (node: string, t: number) => { if (!Number.isFinite(t)) return; const x = inside[node] ??= { first: t, last: t, tools: {}, busy: 0 }; x.first = Math.min(x.first, t); x.last = Math.max(x.last, t); };
  for (const l of lines) {
    if (!l.includes('"type":"user"') && !(cur && l.includes('"type":"assistant"'))) continue;
    let o: { type?: string; timestamp?: string; message?: { id?: string; model?: string; content?: unknown; usage?: Record<string, number> } };
    try { o = JSON.parse(l); } catch { continue; }
    const at = Date.parse(o.timestamp ?? ''), c = o.message?.content, blocks = Array.isArray(c) ? c as { type?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; text?: string; content?: unknown }[] : [];
    if (o.type === 'user') {
      const raw = typeof c === 'string' ? c : blocks.map(x => x?.text ?? '').join('\n');
      const text = raw.replace(/^\s*<pasted_content[^>]*>\s*/, '');   // 긴 글은 herdr 가 붙여넣기로 보내 <pasted_content> 로 감싸인다
      // 다른 런 노드의 글이면 그 뒤는 이 런 것이 아니다
      if (text.startsWith('[EDITH 런 #')) cur = text.startsWith(head) ? text.match(/nodes[\\/]([^\\/\s]+)[\\/]\d+[\\/]result\.json/)?.[1] ?? null : null;
      for (const b of blocks) {
        const p = b?.type === 'tool_result' && b.tool_use_id ? open.get(b.tool_use_id) : undefined;
        if (!p || !Number.isFinite(at)) continue;
        open.delete(b.tool_use_id!);
        const x = inside[p.node] ??= { first: p.t, last: at, tools: {}, busy: 0 };
        x.tools[p.label] = (x.tools[p.label] ?? 0) + Math.max(0, at - p.t);
        (x.spans ??= []).push([p.t, at]);
        if (p.paths.length) {
          const n = resultChars(b.content);
          x.readChars = (x.readChars ?? 0) + n;
          for (const f of p.paths) (x.reads ??= {})[shortPath(f)] = (x.reads[shortPath(f)] ?? 0) + Math.round(n / p.paths.length);
        }
        mark(p.node, at);
      }
      if (cur) mark(cur, at);
      continue;
    }
    if (!cur) continue;
    mark(cur, at);
    for (const b of blocks) if (b?.type === 'tool_use' && b.id && !open.has(b.id) && Number.isFinite(at)) open.set(b.id, { t: at, label: toolLabel(b.name ?? '', b.input), node: cur, paths: readPaths(b.name ?? '', b.input) });
    const id = o.message?.id, u = o.message?.usage;
    if (!u || !id || seen.has(id)) continue;
    seen.add(id);
    if (inside[cur]) inside[cur].turns = (inside[cur].turns ?? 0) + 1;   // 대화 턴 — 답 하나(같은 message.id 는 한 번)
    const t = into[cur] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, models: [] };
    t.input += u.input_tokens ?? 0; t.output += u.output_tokens ?? 0;
    t.cacheRead += u.cache_read_input_tokens ?? 0; t.cacheWrite += u.cache_creation_input_tokens ?? 0;
    if (o.message?.model && !t.models.includes(o.message.model)) t.models.push(o.message.model);
  }
  // 이 세션 파일의 도구 구간을 겹친 것은 한 번으로 더한다(노드 시도마다 세션 파일이 따로라 파일끼리는 더해도 겹치지 않는다)
  for (const x of Object.values(inside)) {
    if (!x.spans) continue;
    let end = -Infinity;
    for (const [a, b] of x.spans.sort((p, q) => p[0] - q[0])) { if (b > end) { x.busy += b - Math.max(a, end); end = b; } }
    delete x.spans;
  }
}
function tokens(r: Run, inside: Record<string, Inside>) {
  const out: Record<string, Tok> = {}, dir = transcriptDir(r.cwd);
  let files: string[] = [];
  try { files = readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => join(dir, f)).filter(f => statSync(f).mtimeMs >= r.created); } catch { return out; }
  for (const f of files) {
    const t = readFileSync(f, 'utf8');
    if (t.includes(`[EDITH 런 #${r.id} ·`)) tokensIn(t.split('\n'), r.id, out, inside);
  }
  return out;
}

// 엔진이 남긴 기록 — 작업 문서의 edith-records.jsonl(링크면 런 폴더 안을 가리킬 때만). 끝 500줄.
function records(id: number) {
  try {
    const base = realpathSync(join(RUNS, String(id))), f = realpathSync(join(base, 'work', 'edith-records.jsonl'));
    if (!f.startsWith(base + sep)) return [];
    return readFileSync(f, 'utf8').split('\n').filter(Boolean).slice(-500).flatMap(l => {
      try { const o = JSON.parse(l); return o && typeof o === 'object' && !Array.isArray(o) ? [o as Record<string, unknown>] : []; } catch { return []; }
    });
  } catch { return []; }
}

export function runAnalysis(id: number) {
  const r = loadRun(id);
  if (!r) return null;
  const inside: Record<string, Inside> = {};
  const events = readEvents(id), time = timings(events, Date.now()), tok = tokens(r, inside);   // 옛 런은 기록이 없어 시간 없음
  const nodes = r.steps.map(s => {
    const n = r.nodes[s.key];
    return {
      key: s.key, title: s.title, place: s.boxes?.map(b => b.name).join(' › ') ?? s.lane, phase: s.boxes?.[0]?.name ?? s.title, kind: s.kind, fixOnly: !!s.fixOnly,
      state: n.state, attempts: n.attempt, fails: n.fails, summary: n.summary,
      rewound: (r.rewinds ?? []).filter(x => s.key === x.to || s.key.startsWith(`${x.to}.`)).length,
      time: time[s.key] ?? null, tokens: tok[s.key] ?? null, inside: inside[s.key] ?? null, claude: s.kind === 'skill' && n.attempt ? claudeOf(id, s.key, n.attempt) : null,
    };
  });
  const last = Math.max(r.created, ...events.map(e => e.t));
  const end = r.state === 'done' ? last : Date.now(), recs = records(id);
  return { id, name: r.name, state: r.state, created: r.created, elapsed: end - r.created, timed: events.length > 0, nodes, rewinds: r.rewinds ?? [], records: recs,
    flow: events.length ? flow(events, r.created, end) : null, phases: phaseTimes(r.steps, events), lanes: lanes(r.steps, events, time), redo: redo(r.steps, events), codex: codexUsage(recs), compare: compare(r),
    sameCode: sameCode(events), repoPick: repoPick(id, recs) };
}
