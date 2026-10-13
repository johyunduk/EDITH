// 대화 — Claude·Codex pane 의 세션 기록(JSONL)을 화면용 대화로 푼다. 터미널 대신 브라우저에서 읽고 스크롤하려고.
// herdr(0.8.0)는 pane 의 세션 파일을 알려 주지 않는다.
// - Claude: pane 작업 폴더의 기록 중 제목(custom-title·ai-title)이 pane 창 제목과 같은 것. 없으면 같은 폴더의 다른 Claude pane 제목이
//   아닌 것 중 가장 최근 것. 창 제목이 기본값(「Claude Code」)이면 아직 대화가 없는 새 세션이라 고르지 않는다.
// - Codex: 창 제목 「스레드 이름 | 폴더」 의 이름으로 ~/.codex/session_index.jsonl 에서 스레드 ID 를 찾고(최근 것부터),
//   ~/.codex/sessions/ 아래 그 ID 의 rollout 중 작업 폴더가 같은 것.
// 기록은 수십 MB 가 되므로 처음엔 끝 4MB 만 읽고 그 뒤엔 늘어난 만큼만 읽는다.
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { agentSince, until } from './herdr.ts';
import { sh } from './sh.ts';

// at 은 그 항목이 나온 줄의 파일 안 바이트 위치 — 화면이 「이전 대화 더 보기」 로 그 앞을 달라고 할 때 쓴다.
export type Item = { t: number; kind: 'user' | 'text' | 'tool' | 'out'; text: string; id?: string; result?: string; error?: boolean; at?: number };
type Block = { type?: string; text?: string; name?: string; id?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: unknown; is_error?: boolean };

const TAIL = 4 * 1024 * 1024, KEEP = 600, FILES = 8;
const cut = (s: string, n: number) => s.length > n ? `${s.slice(0, n)}…` : s;
const arg = (i: Record<string, unknown> = {}) => String(i.command ?? i.file_path ?? i.pattern ?? i.url ?? i.description ?? i.prompt ?? JSON.stringify(i));
const resultText = (c: unknown): string => typeof c === 'string' ? c
  : Array.isArray(c) ? c.map(x => (x as Block).type === 'text' ? (x as Block).text ?? '' : `[${(x as Block).type}]`).join('\n') : '';

// Claude 기록 한 줄 → 화면 항목. 도구 결과는 앞의 도구 호출 항목에 붙인다(byId).
export function claudeLine(items: Item[], byId: Map<string, Item>, line: string) {
  let o: { type?: string; isMeta?: boolean; timestamp?: string; message?: { content?: string | Block[] } };
  try { o = JSON.parse(line); } catch { return; }
  const t = Date.parse(o.timestamp ?? '') || 0, c = o.message?.content;
  if (o.type === 'user' && !o.isMeta) {
    if (typeof c === 'string') { local(items, t, c); return; }
    for (const b of c ?? []) {
      if (b.type === 'text' && b.text && !b.text.startsWith('<')) items.push({ t, kind: 'user', text: b.text });
      if (b.type === 'tool_result' && b.tool_use_id) {
        const it = byId.get(b.tool_use_id);
        if (it) { it.result = cut(resultText(b.content), 4000); it.error = !!b.is_error; }
      }
    }
  }
  if (o.type === 'assistant' && Array.isArray(c)) for (const b of c) {
    if (b.type === 'text' && b.text) items.push({ t, kind: 'text', text: b.text });
    if (b.type === 'tool_use') {
      // 선택 질문은 질문 글로 — 답은 결과(User has answered…)에 붙는다
      const qs = b.name === 'AskUserQuestion' ? (b.input?.questions as { question?: string }[] | undefined)?.map(q => q.question).join(' / ') : undefined;
      const it: Item = { t, kind: 'tool', text: qs ? `질문 · ${cut(qs, 300)}` : `${b.name} ${cut(arg(b.input), 300)}`, id: b.id };
      items.push(it);
      if (b.id) byId.set(b.id, it);
    }
  }
}

// Claude 기록의 문자열 입력 — 사람 입력은 그대로, 슬래시 명령(/cost 등)·! 셸 명령은 명령과 출력으로, 그 밖의 <…>(시스템 알림 등)는 뺀다.
const tag = (c: string, name: string) => c.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1];
function local(items: Item[], t: number, c: string) {
  if (!c.startsWith('<')) { items.push({ t, kind: 'user', text: c }); return; }
  const name = tag(c, 'command-name'), input = tag(c, 'bash-input');
  if (name) items.push({ t, kind: 'user', text: `${name} ${tag(c, 'command-args') ?? ''}`.trim() });
  else if (input !== undefined) items.push({ t, kind: 'user', text: `! ${input}` });
  const out = ['local-command-stdout', 'local-command-stderr', 'bash-stdout', 'bash-stderr'].map(n => tag(c, n)?.replace(ANSI, '').trim()).filter(Boolean).join('\n');
  if (out) items.push({ t, kind: 'out', text: cut(out, 4000) });
}
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

// Codex rollout 한 줄 → 화면 항목. 지시문(AGENTS.md·환경·스킬 목록)은 뺀다. 도구는 exec 안의 cmd 들을 보여 준다.
type CodexPayload = { type?: string; role?: string; content?: Block[]; name?: string; input?: string; arguments?: string; call_id?: string; output?: unknown };
function codexLine(items: Item[], byId: Map<string, Item>, line: string) {
  let o: { type?: string; timestamp?: string; payload?: CodexPayload };
  try { o = JSON.parse(line); } catch { return; }
  const p = o.payload, t = Date.parse(o.timestamp ?? '') || 0;
  if (o.type !== 'response_item' || !p) return;
  if (p.type === 'message' && (p.role === 'user' || p.role === 'assistant')) {
    for (const b of p.content ?? []) {
      const text = b.text ?? '';
      if (!text || (p.role === 'user' && (text.startsWith('<') || text.startsWith('# AGENTS.md')))) continue;
      items.push({ t, kind: p.role === 'user' ? 'user' : 'text', text });
    }
  }
  if (p.type === 'custom_tool_call' || p.type === 'function_call') {
    const src = p.input ?? p.arguments ?? '';
    const cmds = [...src.matchAll(/\bcmd"?\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map(m => m[1].replace(/\\"/g, '"'));
    const it: Item = { t, kind: 'tool', text: `${p.name} ${cut(cmds.length ? cmds.join(' · ') : src.split('\n')[0], 300)}`, id: p.call_id };
    items.push(it);
    if (p.call_id) byId.set(p.call_id, it);
  }
  if ((p.type === 'custom_tool_call_output' || p.type === 'function_call_output') && p.call_id) {
    const it = byId.get(p.call_id);
    if (it) it.result = cut(resultText(p.output), 4000);
  }
}

// 파일마다 읽은 자리와 항목을 들고 있다가 늘어난 만큼만 더 읽는다. 최근 본 FILES 개만 들고 있는다(Map 순서 = 최근 사용 순).
type Cache = { size: number; rest: string; items: Item[]; byId: Map<string, Item> };
const caches = new Map<string, Cache>();

function read(file: string, apply: typeof claudeLine) {
  const size = statSync(file).size;
  let c = caches.get(file);
  if (c && size < c.size) c = undefined;   // 줄었으면(새로 쓰임) 처음부터
  if (!c) c = { size: Math.max(0, size - TAIL), rest: '', items: [], byId: new Map() };
  if (size > c.size) {
    const fd = openSync(file, 'r'), buf = Buffer.alloc(size - c.size);
    try { readSync(fd, buf, 0, buf.length, c.size); } finally { closeSync(fd); }
    const fromStart = c.size === 0 || caches.has(file);
    let at = c.size - Buffer.byteLength(c.rest);
    const lines = (c.rest + buf.toString('utf8')).split('\n');
    c.rest = lines.pop() ?? '';
    if (!fromStart) at += Buffer.byteLength(lines.shift() ?? '') + 1;   // 끝 4MB 의 첫 줄은 잘린 줄이다
    at = applyAll(c.items, c.byId, lines, at, apply);
    c.size = size;
    if (c.items.length > KEEP * 2) { c.items = c.items.slice(-KEEP); c.byId = new Map(c.items.filter(i => i.id).map(i => [i.id!, i])); }
  }
  caches.delete(file);
  caches.set(file, c);
  for (const old of caches.keys()) { if (caches.size <= FILES) break; caches.delete(old); }
  return c;
}

// 줄들을 읽어 항목을 쌓고, 새로 생긴 항목에 그 줄의 바이트 위치(at)를 단다. 다음 줄의 위치를 돌려준다.
function applyAll(items: Item[], byId: Map<string, Item>, lines: string[], at: number, apply: typeof claudeLine) {
  for (const l of lines) {
    const n = items.length;
    apply(items, byId, l);
    for (let k = n; k < items.length; k++) items[k].at = at;
    at += Buffer.byteLength(l) + 1;
  }
  return at;
}

// 이전 대화 — before(바이트 위치) 앞을 4MB 씩 거꾸로 읽어 항목이 150개 넘게 모이거나 32MB 를 읽을 때까지(스크린샷 같은 큰 줄이 많으면
// 4MB 에 항목이 몇십 개뿐이다). 덩어리 경계에 걸린 줄은 버퍼째 이어 붙여 읽는다(4MB 보다 긴 한 줄도). 보내는 것은 끝 600개, more 는 그 앞이 더 있는지.
// ponytail: 덩어리 경계를 넘는 도구 호출·결과 짝은 이어 붙이지 않는다(결과가 뒤 덩어리에 있으면 그 도구 줄에 결과가 비어 보인다).
export function older(file: string, before: number, apply: typeof claudeLine) {
  const fd = openSync(file, 'r');
  let from = Math.min(before, statSync(file).size), head = Buffer.alloc(0), items: Item[] = [], scanned = 0;
  try {
    while (from > 0 && items.length < 150 && scanned < 8 * TAIL) {
      const start = Math.max(0, from - TAIL), buf = Buffer.alloc(from - start);
      readSync(fd, buf, 0, buf.length, start);
      scanned += buf.length;
      let all = Buffer.concat([buf, head]), at = start;
      if (start > 0) {   // 첫 줄은 앞 덩어리에서 시작한 줄 — 다음 번에 앞에 이어 붙인다
        const nl = all.indexOf(10);
        head = nl < 0 ? all : all.subarray(0, nl);
        all = nl < 0 ? Buffer.alloc(0) : all.subarray(nl + 1);
        at = start + head.length + 1;
      }
      const lines = all.toString('utf8').split('\n');
      if (lines.at(-1) === '') lines.pop();
      const chunk: Item[] = [];
      applyAll(chunk, new Map(), lines, at, apply);
      items = [...chunk, ...items];
      from = start;
    }
  } finally { closeSync(fd); }
  const kept = items.slice(-KEEP);
  return { items: kept, more: from > 0 || kept.length < items.length };
}

// 파일을 4MB 씩 읽으며 줄마다 f 를 부른다 — 수십 MB 기록을 한 번에 올리지 않으려고.
function eachLine(file: string, f: (line: string) => void) {
  const fd = openSync(file, 'r'), buf = Buffer.alloc(TAIL);
  let rest = '', n: number, at = 0;
  try {
    while ((n = readSync(fd, buf, 0, buf.length, at)) > 0) {
      at += n;
      const lines = (rest + buf.subarray(0, n).toString('utf8')).split('\n');
      rest = lines.pop() ?? '';
      lines.forEach(f);
    }
    if (rest) f(rest);
  } finally { closeSync(fd); }
}

// 세션 파일의 지금 제목 — 사용자가 붙인 것(custom-title)이 있으면 그것, 없으면 자동 제목.
const titles = new Map<string, { size: number; title: string }>();
function titleOf(file: string) {
  const size = statSync(file).size, hit = titles.get(file);
  if (hit && hit.size === size) return hit.title;
  let custom = '', ai = '';
  eachLine(file, l => {
    if (!l.includes('-title"')) return;
    try { const o = JSON.parse(l); if (o.type === 'custom-title') custom = o.customTitle ?? custom; if (o.type === 'ai-title') ai = o.aiTitle ?? ai; } catch { /* 잘린 줄 */ }
  });
  titles.set(file, { size, title: custom || ai });
  return custom || ai;
}

// 붙잡은 파일보다 나중에 만든, 제목이 같은 세션 파일 중 가장 새것.
export function newerSame(held: string, files: string[], title: string) {
  const born = (f: string) => statSync(f).birthtimeMs, b = born(held);
  return files.filter(f => f !== held && born(f) > b).sort((x, y) => born(y) - born(x)).find(f => titleOf(f) === title);
}

// pane → 세션 파일. 제목이 바뀌지 않는 동안은 다시 찾지 않는다(제목 찾기는 파일 전체를 읽는다).
const picked = new Map<string, { title: string; file: string }>();
function claudeFile(pane: string, cwd: string, title: string, others: string[]) {
  if (!title || title === 'Claude Code') return null;
  const dir = transcriptDir(cwd);
  if (!existsSync(dir)) return null;
  const all = readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => join(dir, f));
  const hit = picked.get(pane);
  if (hit && hit.title === title && existsSync(hit.file)) {
    // /clear 는 같은 제목(이름 붙인 세션)으로 새 세션 파일을 만든다 — 붙잡은 파일보다 나중에 만든 같은 제목 파일이 있으면 그쪽으로 옮긴다
    const moved = newerSame(hit.file, all, title);
    if (!moved) return hit.file;
    picked.set(pane, { title, file: moved });
    return moved;
  }
  const files = all.map(f => ({ f, m: statSync(f).mtimeMs })).sort((a, b) => b.m - a.m).slice(0, 8).map(x => x.f);
  // 제목이 안 맞으면 다른 pane 이 안 쓰는 최근 파일로 — 단 이 pane 에 에이전트가 새로 떴으면 그 뒤에 만든 파일만(옛 세션을 붙이지 않게)
  const since = agentSince(pane);
  const own = (f: string) => since === undefined || statSync(f).birthtimeMs >= since - 60_000;
  const file = files.find(f => titleOf(f) === title) ?? files.find(f => own(f) && !others.includes(titleOf(f)));
  if (file) picked.set(pane, { title, file });
  return file ?? null;
}

const CODEX = join(homedir(), '.codex');
// Claude 세션 기록 폴더 — 작업 폴더 경로의 글자·숫자 밖을 - 로 바꾼 이름
export const transcriptDir = (cwd: string) => join(homedir(), '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
// rollout 첫 줄(session_meta)의 작업 폴더. 하위 에이전트(승인 검토 guardian 등)의 rollout 은 pane 의 대화가 아니라 뺀다.
function metaCwd(file: string) {
  const fd = openSync(file, 'r'), buf = Buffer.alloc(1024 * 1024);
  try {
    const line = buf.subarray(0, readSync(fd, buf, 0, buf.length, 0)).toString('utf8').split('\n')[0];
    const p = JSON.parse(line).payload as { cwd?: string; source?: unknown };
    return typeof p.source === 'object' && p.source && 'subagent' in p.source ? '' : p.cwd ?? '';
  } catch { return ''; } finally { closeSync(fd); }
}
function codexFile(pane: string, cwd: string, title: string) {
  const hit = picked.get(pane);
  if (hit && hit.title === title && existsSync(hit.file)) return hit.file;
  const name = title.split(' | ')[0];
  let ids: string[] = [];
  try {
    ids = readFileSync(join(CODEX, 'session_index.jsonl'), 'utf8').split('\n').flatMap(l => { try { const o = JSON.parse(l); return o.thread_name === name ? [o.id as string] : []; } catch { return []; } }).reverse();
  } catch { /* 색인 없음 */ }
  // 날짜 폴더를 최근부터 훑는다 — rollout-<시각>-<id>.jsonl
  const days = (d: string, depth: number): string[] => depth ? readdirSync(d).sort().reverse().flatMap(x => days(join(d, x), depth - 1)) : [d];
  const files = existsSync(join(CODEX, 'sessions')) ? days(join(CODEX, 'sessions'), 3).slice(0, 30).flatMap(d => readdirSync(d).map(f => join(d, f))) : [];
  const file = ids.map(id => files.find(f => f.endsWith(`${id}.jsonl`))).find(f => f && metaCwd(f) === cwd)
    ?? files.map(f => ({ f, m: statSync(f).mtimeMs })).sort((a, b) => b.m - a.m).slice(0, 40).find(x => metaCwd(x.f) === cwd)?.f;
  if (file) picked.set(pane, { title, file });
  return file ?? null;
}

// Codex 사용량 — rollout 끝쪽의 마지막 token_count. 컨텍스트는 그 pane 의 rollout(마지막 요청 토큰 ÷ 창 크기라 Codex 화면의
// 「context left」 와 조금 다를 수 있다), 5시간·7일 한도는 계정 전체라 가장 최근에 쓰인 rollout 에서. 다시 찰 시각이 지났으면 그 뒤로 안 썼다는 뜻이라 0%.
type Win = { used_percent: number; window_minutes?: number; resets_at?: number } | null;
type Tokens = { info?: { last_token_usage?: { total_tokens: number }; model_context_window?: number } | null; rate_limits?: { primary?: Win; secondary?: Win } | null };
// 끝 1MB 에서 마지막 token_count 와 마지막 turn_context(모델·effort)
function lastTokens(file: string) {
  const size = statSync(file).size, n = Math.min(size, 1 << 20), buf = Buffer.alloc(n), fd = openSync(file, 'r');
  try { readSync(fd, buf, 0, n, size - n); } finally { closeSync(fd); }
  let tokens: Tokens | null = null, turn: { model?: string; effort?: string } | null = null;
  for (const l of buf.toString('utf8').split('\n').reverse()) {
    const want = !tokens && l.includes('"token_count"') ? 't' : !turn && l.includes('"turn_context"') ? 'c' : '';
    if (!want) continue;
    try { const p = JSON.parse(l).payload; if (want === 't') tokens = p; else turn = p; } catch { /* 쓰는 중인 마지막 줄·잘린 첫 줄 */ }
    if (tokens && turn) break;
  }
  // 한 턴이 길면 turn_context 가 끝 1MB 밖에 있다 — 그 파일을 한 번 통째로 훑어 기억해 둔다(끝에서 새로 보이면 그걸로 바꾼다)
  if (turn) turns.set(file, turn);
  else if (!turns.has(file)) eachLine(file, l => { if (l.includes('"turn_context"')) try { turns.set(file, JSON.parse(l).payload); } catch { /* 깨진 줄 */ } });
  turn ??= turns.get(file) ?? null;
  return tokens || turn ? { tokens, turn } : null;
}
const turns = new Map<string, { model?: string; effort?: string }>();
const latestRollout = () => {
  const root = join(CODEX, 'sessions');
  if (!existsSync(root)) return null;
  const days = (d: string, depth: number): string[] => depth ? readdirSync(d).sort().reverse().slice(0, 3).flatMap(x => days(join(d, x), depth - 1)) : [d];
  return days(root, 3).flatMap(d => readdirSync(d).map(f => join(d, f))).map(f => ({ f, m: statSync(f).mtimeMs })).sort((a, b) => b.m - a.m)[0]?.f ?? null;
};
export function codexUsage(pane: string, cwd: string, title: string) {
  const file = codexFile(pane, cwd, title), latest = latestRollout();
  const mine = file ? lastTokens(file) : null, own = mine?.tokens, acct = (latest && latest !== file ? lastTokens(latest)?.tokens : null) ?? own;
  if (!mine && !acct) return null;
  const ws = [acct?.rate_limits?.primary, acct?.rate_limits?.secondary];
  const lim = (w: Win | undefined, day: boolean) => !w ? null : w.resets_at && w.resets_at * 1000 <= Date.now() ? { pct: 0, reset: null }
    : { pct: Math.round(w.used_percent), reset: w.resets_at ? until(w.resets_at * 1000, day) : null };
  const u = own?.info?.last_token_usage, cw = own?.info?.model_context_window;
  return {
    model: mine?.turn?.model ?? null, effort: mine?.turn?.effort ?? null,
    ctx: u && cw ? Math.round(u.total_tokens / cw * 100) : null,
    five: lim(ws.find(w => w?.window_minutes === 300) ?? ws[0], false), week: lim(ws.find(w => w?.window_minutes === 10080) ?? ws[1], true),
  };
}

// before 가 있으면 그 앞의 이전 대화, 없으면 지금(끝) 대화. more 는 보낸 항목들 앞에 대화가 더 있는지.
export function chat(pane: string, agent: string, cwd: string, title: string, others: string[] = [], before?: number) {
  const file = agent === 'codex' ? codexFile(pane, cwd, title) : claudeFile(pane, cwd, title, others);
  if (!file) return { file: null, items: [] as Item[], more: false };
  const apply = agent === 'codex' ? codexLine : claudeLine;
  if (before !== undefined) return { file, ...older(file, before, apply) };
  const items = read(file, apply).items.slice(-KEEP);
  return { file, items, more: (items[0]?.at ?? 0) > 0 };
}

// 백그라운드 작업 — Claude 가 run_in_background 로 띄운 셸·에이전트. 세션 기록에서 띄운 명령·작업 id·출력 파일·끝남 알림(task-notification)을 모은다.
// 출력은 Claude 가 /tmp/claude-<uid>/… /tasks/<id>.output 에 쓴다. 기록은 늘어난 만큼만 더 읽는다(파일마다 기억).
// ponytail: 끝남 알림 없이 세션이 꺼지면 「실행 중」 으로 남는다 — 화면이 마지막 출력 시각을 같이 보여 준다.
export type Task = { id: string; kind: '셸' | '에이전트'; label: string; command: string; path: string; status: string; t: number };
type TaskCache = { size: number; rest: string; tasks: Map<string, Task>; pending: Map<string, Omit<Task, 'id' | 'path' | 'status'>> };
const taskCaches = new Map<string, TaskCache>();
const xml = (s: string, tag: string) => s.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim();
function taskLine(c: TaskCache, line: string) {
  if (!line.includes('run_in_background') && !line.includes('task-notification') && !line.includes('in background') && !line.includes('TaskStop') && !line.includes('agentId')) return;
  let o: { type?: string; timestamp?: string; message?: { content?: unknown } };
  try { o = JSON.parse(line); } catch { return; }
  const t = Date.parse(o.timestamp ?? '') || 0, content = o.message?.content;
  const blocks = (Array.isArray(content) ? content : [{ type: 'text', text: content }]) as { type?: string; text?: string; name?: string; id?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: unknown }[];
  for (const b of blocks) {
    if (o.type === 'assistant' && b.type === 'tool_use' && b.input?.run_in_background && b.id) {
      const shell = b.name === 'Bash';
      c.pending.set(b.id, { kind: shell ? '셸' : '에이전트', label: String(b.input.description ?? b.input.command ?? b.name).slice(0, 200), command: shell ? String(b.input.command ?? '').slice(0, 2000) : '', t });
    }
    if (o.type === 'assistant' && b.type === 'tool_use' && b.name === 'TaskStop') {
      const task = c.tasks.get(String(b.input?.task_id ?? b.input?.shell_id ?? ''));
      if (task && task.status === '실행 중') task.status = '멈춤';
    }
    if (o.type === 'user' && b.type === 'tool_result' && b.tool_use_id && c.pending.has(b.tool_use_id)) {
      const text = typeof b.content === 'string' ? b.content : resultText(b.content);
      const id = text.match(/(?:with ID|agentId):\s*([\w-]+)/)?.[1];
      if (id) {
        const p = c.pending.get(b.tool_use_id)!;
        c.tasks.set(id, { id, ...p, path: text.match(/written to:\s*(\S+?)\.?(?:\s|$)/)?.[1] ?? '', status: '실행 중' });
        c.pending.delete(b.tool_use_id);
      }
    }
    const text = typeof b.text === 'string' ? b.text : '';
    if (o.type === 'user' && text.includes('<task-notification>')) {
      const id = xml(text, 'task-id'), task = id ? c.tasks.get(id) : undefined;
      if (task) {
        const st = xml(text, 'status') ?? '';
        task.status = st === 'completed' ? '끝남' : st === 'failed' ? '실패' : st === 'killed' || st === 'stopped' ? '멈춤' : st || task.status;
        task.path = xml(text, 'output-file') ?? task.path;
      }
    }
  }
}
export function backgroundTasks(pane: string, cwd: string, title: string, others: string[] = []) {
  const file = claudeFile(pane, cwd, title, others);
  if (!file) return [];
  const size = statSync(file).size;
  let c = taskCaches.get(file);
  if (!c || size < c.size) {
    c = { size: 0, rest: '', tasks: new Map(), pending: new Map() };
    const cc = c;
    eachLine(file, l => taskLine(cc, l));
    c.size = size;
    taskCaches.set(file, c);
  } else if (size > c.size) {
    const fd = openSync(file, 'r'), buf = Buffer.alloc(size - c.size);
    try { readSync(fd, buf, 0, buf.length, c.size); } finally { closeSync(fd); }
    const lines = (c.rest + buf.toString('utf8')).split('\n');
    c.rest = lines.pop() ?? '';
    for (const l of lines) taskLine(c, l);
    c.size = size;
  }
  return [...c.tasks.values()].sort((a, b) => b.t - a.t).slice(0, 40).map(t => {
    let m = 0, n = 0;
    try { const st = statSync(t.path); m = st.mtimeMs; n = st.size; } catch { /* 출력 파일 없음 */ }
    return { ...t, status: t.status === '실행 중' && n ? exitOf(t.path, n) ?? t.status : t.status, outAt: m, outSize: n };
  });
}

// 셸이 아직 사는지 — 그 출력 파일을 열고 있는 프로세스가 있으면 산 것(lsof). 끝 표시 없이 죽은 셸(세션이 꺼짐 등)을 가린다.
// 출력 없이 조용히 도는 dev 서버도 파일은 열고 있어서 살아 있는 것으로 나온다.
export async function checkAlive<T extends { kind: string; status: string; path: string }>(tasks: T[]) {
  return Promise.all(tasks.map(async t => {
    if (t.kind !== '셸' || t.status !== '실행 중' || !t.path) return t;
    const r = await sh('lsof', ['-t', '--', t.path], { ok: true, timeoutMs: 5000 });
    return r.stdout.trim() ? t : { ...t, status: '끝남' };
  }));
}

// 셸 작업이 끝나면 Claude 가 출력 끝에 「[exited with code N]」 이나 「[process exited while detached; …]」 를 남긴다 — 끝남 알림이 기록에 없을 때 이걸로 가린다.
// 0 은 끝남, 128 넘으면 신호로 죽은 것(멈춤), 그 밖은 실패.
function exitOf(path: string, size: number) {
  const n = Math.min(size, 300), buf = Buffer.alloc(n), fd = openSync(path, 'r');
  try { readSync(fd, buf, 0, n, size - n); } finally { closeSync(fd); }
  const m = buf.toString('utf8').match(/\[(?:exited with code (\d+)|process exited[^\]]*)\]\s*$/);
  if (!m) return null;
  const code = m[1] === undefined ? null : Number(m[1]);
  return code === null ? '끝남' : code === 0 ? '끝남' : code > 128 ? `멈춤(코드 ${code})` : `실패(코드 ${code})`;
}

// 백그라운드 작업 출력 끝 64KB — 그 세션 기록에 나온 작업만, Claude 임시 폴더 안 파일만
export function taskOutput(pane: string, cwd: string, title: string, others: string[], id: string) {
  const t = backgroundTasks(pane, cwd, title, others).find(x => x.id === id);
  if (!t?.path) return null;
  let p: string;
  try { p = realpathSync(t.path); } catch { return ''; }
  const uid = process.getuid?.() ?? 0;
  if (![`/private/tmp/claude-${uid}/`, `/tmp/claude-${uid}/`].some(d => p.startsWith(d))) return null;
  const size = statSync(p).size, n = Math.min(size, 65_536), buf = Buffer.alloc(n), fd = openSync(p, 'r');
  try { readSync(fd, buf, 0, n, size - n); } finally { closeSync(fd); }
  // 화면 열쇠가 찍힌 출력(serve 시작 줄의 …/?key=)은 가린다
  return ((size > n ? '… (앞은 잘림)\n' : '') + buf.toString('utf8')).replace(/([?&]key=)[\w-]+/g, '$1(가림)');
}
