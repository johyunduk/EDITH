// 실행기 — 공방의 체인 · 엔진을 실제로 돌린다(한 번 돌린 것이 「런」). 시작할 때 폴더를 통째로(안에 든 체인까지) 사본으로 뜨고 노드 한 줄로 펼친 뒤,
// 노드를 하나씩: 스킬 노드는 런 pane 의 Claude 에게 새 대화(/clear)로 보내고(일은 Claude 가 한다), 명령 노드는 실행기가 직접 돌린다.
// 노드 사이는 작업 문서(work/) 파일로만 넘긴다. 진행은 runs/<번호>/run.json 에 적고(쓰는 쪽은 실행기 하나), EDITH 를 다시 켜면 이어 간다.
// 확실하지 않은 일(보냈는지 모름 · 결과 없이 멈춤 · pane 사라짐)은 다시 보내지 않고 「확인 필요」로 멈춰 사람에게 넘긴다.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { CONFIG_DIR, DATA_DIR } from './config.ts';
import { bgShells, keys, limitHit, limitReset, newWorkspace, newWorktree, promptAgent, snapshot, split, start, statusline } from './herdr.ts';
import { firstLine } from './sh.ts';
import { skills } from './skills.ts';
import type { Ev } from './analysis.ts';
import { lastLine, timeline } from './timeline.ts';
import { refWarnings } from './refs.ts';
import { livePort } from './live.ts';
import { readSummary } from './runSummary.ts';
import { readRefs } from './repos.ts';
import { BRANCH, check, NAME, readEngine, ROOT as WORKSHOP, type Engine, type SkillRef } from './workshop.ts';

// 엔진 브랜치(feature/edith-engine)의 runs/ 와 섞이지 않게 따로 둔다
export const RUNS = join(DATA_DIR, 'workshop-runs');

// 펼친 노드 하나. key 는 엔진 노드를 거쳐 온 id 길(n4.n2) — 경로에 그대로 써도 되는 글자만.
export type Step = {
  key: string; title: string; lane: string; group: string;   // lane = 든 엔진 이름(화면 묶음), group = 그 엔진 자리(같은 엔진을 두 번 써도 따로)
  kind: 'skill' | 'command'; skill?: string; command?: string; engine: string;   // skill = SKILL.md 실제 경로, engine = 든 엔진 id($EDITH_ENGINE)
  common?: string; deps: string[]; failTo?: string; max?: number; fixOnly?: boolean;
  track?: string;   // 갈래 — 화살표가 갈려 따로(동시에) 도는 줄의 이름. 없으면 본 줄
  boxes?: { name: string; kind: 'chain' | 'engine' }[];   // 맨 위 엔진 밑에서 이 노드까지 든 체인 · 엔진(바깥부터, group 의 마디마다) — 펼친 캔버스의 상자. 옛 런엔 없다
};
export type NodeState = 'wait' | 'sending' | 'running' | 'blocked' | 'done' | 'skipped' | 'check' | 'stopped';
export type NodeRun = { state: NodeState; attempt: number; fails: number; summary?: string; line?: string; reason?: string; idle?: number; nudged?: boolean; wake?: number; auto?: number };   // line = 사람용 한 줄(결과 파일 「한줄」), wake = 사용량 한도가 풀려 이어 갈 시각, auto = 무인 런이 다시 돌린 횟수
export type Run = {
  id: number; engine: string; name: string; cwd: string; input: string; created: number; branch?: string;   // branch = 새 워크트리로 돌 때 그 브랜치
  def?: string;   // 공방 런(kind run)으로 시작했으면 그 폴더 — 런 설정 사본은 run/, engine 은 그 런이 돌린 엔진
  unattended?: boolean;   // 무인 — 사람을 기다리지 않는다(unattend). 엔진은 run.json · $EDITH_UNATTENDED 로 안다
  state: 'queued' | 'running' | 'check' | 'stopped' | 'done' | 'dropped'; reason?: string;   // queued = 동시 런 한도에 걸려 줄 서 있다, dropped = 버림(끝 — 기록만)
  owner?: { pid: number; port: number }; pane?: string;
  steps: Step[]; nodes: Record<string, NodeRun>; fixing?: { fixer: string; for: string }[];   // 고치는 중 — 갈래마다 하나
  panes?: Record<string, { pane?: string; claude?: string[] }>;   // 갈래의 pane · Claude 인자(본 줄은 pane · claude)
  rewinds?: { at: number; to: string; name: string; by: string; reason: string }[];
  claude?: string[];   // 런 pane Claude 를 띄운 덧붙임 인자(--add-dir 빼고) — 노드가 원하는 것과 다르면 다시 띄운다   // 「이 노드부터 다시」 기록 — to 는 노드 키나 체인 · 엔진 자리, by 는 되돌린 명령 노드(또는 사람)
};
export type Outcome = { result: '통과' | '건너뜀' | '실패' | '막힘'; summary?: string; line?: string; reason?: string };   // 건너뜀 = 할 일이 없어 넘어감(통과처럼 다음으로)

// ── 펼치기 — 엔진 노드는 그 엔진의 노드들로. 바깥 화살표는 안쪽 엔진의 첫 노드들 · 끝 노드들에 잇는다 ──
type Load = (id: string) => Engine | string;
type Resolve = (engine: string, ref: SkillRef) => string | null;
export function flatten(top: string, load: Load, resolve: Resolve): Step[] | string[] {
  const errs: string[] = [], steps: Step[] = [];
  const walk = (id: string, prefix: string, inherited: string | undefined, path: string[], trail: Step['boxes'] = []): { entries: Step[]; exits: Step[] } => {
    const none = { entries: [], exits: [] };
    if (path.includes(id)) { errs.push(`체인이 서로를 부르는 고리가 생긴다 — ${[...path, id].join(' → ')}`); return none; }
    const e = load(id);
    if (typeof e === 'string') { errs.push(`체인 ${id}: ${e}`); return none; }
    if (!e.nodes.length) { errs.push(`「${e.name}」에 노드가 없다`); return none; }
    let common = inherited;
    const boxes = prefix ? [...trail!, { name: e.name, kind: e.kind === 'engine' ? 'engine' as const : 'chain' as const }] : [];   // 런은 노드가 없어 위에서 멈춘다
    if (e.common) { const c = resolve(id, e.common); if (c) common = c; else errs.push(`「${e.name}」: 공통 규칙 스킬 ${e.common.id} 이 없다`); }
    const ends = new Map<string, { entries: Step[]; exits: Step[] }>();
    for (const n of e.nodes) {
      if (n.engine) { ends.set(n.id, walk(n.engine, `${prefix}${n.id}.`, common, [...path, id], boxes)); continue; }
      const base = { key: `${prefix}${n.id}`, title: n.title, lane: e.name, group: prefix || '.', engine: id, deps: [] as string[], ...(common ? { common } : {}), ...(boxes.length ? { boxes } : {}) };
      let s: Step;
      if (n.command) s = { ...base, kind: 'command', command: n.command };
      else if (n.skill) {
        const p = resolve(id, n.skill);
        if (!p) errs.push(`「${e.name}」의 「${n.title}」: 스킬 ${n.skill.id} 이 없다`);
        s = { ...base, kind: 'skill', skill: p ?? '' };
      } else { errs.push(`「${e.name}」의 「${n.title}」: 스킬 · 명령 · 체인이 없는 빈 노드`); continue; }
      steps.push(s);
      ends.set(n.id, { entries: [s], exits: [s] });
    }
    const normal = e.edges.filter(x => !x.fail), fix = new Set(e.edges.filter(x => x.fail).map(x => x.to));
    for (const x of normal) for (const a of ends.get(x.from)?.exits ?? []) for (const b of ends.get(x.to)?.entries ?? []) b.deps.push(a.key);
    for (const x of e.edges.filter(x => x.fail)) {
      const from = ends.get(x.from)?.exits[0], to = ends.get(x.to)?.entries[0];
      if (from && to) { from.failTo = to.key; from.max = x.max ?? 3; to.fixOnly = true; }
    }
    const live = e.nodes.filter(n => !fix.has(n.id));
    return {
      entries: live.filter(n => !normal.some(x => x.to === n.id)).flatMap(n => ends.get(n.id)?.entries ?? []),
      exits: live.filter(n => !normal.some(x => x.from === n.id)).flatMap(n => ends.get(n.id)?.exits ?? []),
    };
  };
  walk(top, '', undefined, []);
  if (errs.length) return [...new Set(errs)];
  // 도는 차례 — 앞 노드가 먼저, 같으면 엔진에 놓인 차례. 고치는 노드는 맨 뒤(불릴 때만 돈다)
  const order: Step[] = [], left = new Map(steps.map(s => [s.key, s.deps.length]));
  for (let more = true; more;) {
    more = false;
    for (const s of steps) if (!s.fixOnly && left.get(s.key) === 0 && !order.includes(s)) {
      order.push(s); more = true;
      for (const t of steps) if (t.deps.includes(s.key)) left.set(t.key, left.get(t.key)! - 1);
    }
  }
  if (order.length < steps.filter(s => !s.fixOnly).length) return ['노드 차례를 정할 수 없다(화살표 고리)'];
  if (!order.length) return ['돌릴 노드가 없다'];
  const all = [...order, ...steps.filter(s => s.fixOnly)];
  tracks(all);
  return all;
}

// 갈래 — 화살표가 둘 이상으로 갈리면 갈래마다 따로(동시에, 갈래마다 pane 하나) 돈다. 갈래 이름은 갈린 노드와 갈라지는 자리의 노드 id
// (맨 위 엔진의 be · fe 노드로 갈리면 be · fe — 이름을 정하려면 그 노드 id 를 정한다), 안에서 또 갈리면 「바깥.안」, 겹치면 -2.
// 합류 노드(앞 노드가 여럿)는 앞 갈래들의 공통 바깥 갈래로 돌아간다. 처음부터 여럿이면(앞 노드 없는 노드가 둘 이상) 그것도 갈래. 고치는 노드는 고칠 노드의 갈래.
const SEP = '.';
function tracks(steps: Step[]) {
  const live = steps.filter(s => !s.fixOnly), by = new Map(steps.map(s => [s.key, s])), kids = new Map<string, number>(), t = new Map<string, string>(), used = new Map<string, number>();
  for (const s of live) for (const d of s.deps) kids.set(d, (kids.get(d) ?? 0) + 1);
  const name = (s: Step, from?: Step) => {
    const a = s.key.split('.'), b = from?.key.split('.') ?? [];
    let i = 0;
    while (i < a.length - 1 && a[i] === b[i]) i++;
    return a[i];
  };
  const fresh = (base: string, n: string) => { const x = base ? `${base}${SEP}${n}` : n, k = (used.get(x) ?? 0) + 1; used.set(x, k); return k > 1 ? `${x}-${k}` : x; };
  const common = (ts: string[]) => {
    const ps = ts.map(x => x ? x.split(SEP) : []), out: string[] = [];
    for (let i = 0; ps.every(p => i < p.length && p[i] === ps[0][i]); i++) out.push(ps[0][i]);
    return out.join(SEP);
  };
  const roots = live.filter(s => !s.deps.length).length;
  for (const s of live)
    t.set(s.key, !s.deps.length ? (roots > 1 ? fresh('', name(s)) : '')
      : s.deps.length > 1 ? common(s.deps.map(d => t.get(d) ?? ''))
      : (kids.get(s.deps[0]) ?? 0) > 1 ? fresh(t.get(s.deps[0]) ?? '', name(s, by.get(s.deps[0]))) : t.get(s.deps[0]) ?? '');
  for (const s of steps) if (s.failTo) t.set(s.failTo, t.get(s.key) ?? '');
  for (const s of steps) { const x = t.get(s.key); if (x) s.track = x; }
}

// 공방의 「펼쳐 보기」 — 돌리지 않고 지금 공방 폴더로 노드 한 줄을 만든다. 초안이 있으면 초안 짜임(목록과 같게),
// 스킬 파일은 찾지 않는다(아직 안 쓴 스킬이 있어도 짜임은 보이게 — 없는 스킬은 런을 시작할 때 거절한다).
// paths — 「흐름 지도」 용: 찾을 수 있는 스킬은 SKILL.md 경로까지(없는 것은 빈 경로), 검사(warnings)는 하지 않는다
export function previewSteps(id: string, root = WORKSHOP, paths = false) {
  let draft = false;
  const load: Load = e => {
    try { const r = readEngine(e, root); if (r.draft?.engine) draft = true; return r.draft?.engine ?? r.engine ?? r.errors.join(' · '); } catch { return '공방에 없다'; }
  };
  const find = resolver(root), steps = flatten(id, load, paths ? (e, ref) => find(e, ref) ?? '' : (_, ref) => ref.id);
  if (typeof steps[0] === 'string') return { steps: [], errors: steps as string[], draft };
  return { steps: steps as Step[], errors: [], draft, ...(paths ? {} : { warnings: warnings(id, load, root) }) };
}
// 「적용」 전 검사(src/refs.ts) — 스킬 파일까지 찾아 펼친 노드로. 스킬이 아직 없으면(펼치기 오류) 검사하지 않는다
function warnings(id: string, load: Load, root: string) {
  const steps = flatten(id, load, resolver(root));
  if (typeof steps[0] === 'string') return [];
  const seen = new Map<string, string>();   // 앞 노드 글을 노드마다 다시 모으므로 파일은 한 번만 읽는다
  const read = (f: string) => { if (!seen.has(f)) { try { seen.set(f, readFileSync(f, 'utf8').slice(0, 200_000)); } catch { seen.set(f, ''); } } return seen.get(f)!; };
  // 명령이 부르는 엔진 폴더 파일은 글을, 폴더(예: 통째로 까는 kit/)는 그 안 파일 이름을 — 두 겹까지(명령 → 스크립트 → 스크립트가 까는 폴더)
  const engineRefs = (s: Step, text: string, depth: number): string => [...text.matchAll(/\$\{?EDITH_ENGINE\}?\/([\w./-]+)/g)].map(m => {
    const f = join(root, s.engine, m[1].replace(/\/\.?$/, ''));
    try { if (statSync(f).isDirectory()) return readdirSync(f).join('\n'); } catch { return ''; }
    const x = read(f);
    return depth > 1 ? `${x}\n${engineRefs(s, x, depth - 1)}` : x;
  }).join('\n');
  const textOf = (s: Step) => s.kind === 'skill' ? `${read(s.skill ?? '')}\n${s.common ? read(s.common) : ''}` : `${s.command ?? ''}\n${engineRefs(s, s.command ?? '', 2)}`;
  return refWarnings(steps as Step[], textOf);
}

// ── 다음 노드 · 결과 반영 · 다시 켰을 때 — 파일 · herdr 없이 run 만 바꾼다(테스트하기 쉽게) ──
const ok = (r: Run, k: string) => r.nodes[k].state === 'done' || r.nodes[k].state === 'skipped';
export const ACTIVE: NodeState[] = ['sending', 'running', 'blocked'];
export const trackOf = (r: Run, key: string) => r.steps.find(s => s.key === key)?.track ?? '';
// 다음에 돌 노드 — 갈래마다 하나(도는 노드가 있는 갈래는 빼고). 고치는 중인 갈래는 고치는 노드만 — 그게 멈춰 있으면 실패한 노드를 그냥 다시 돌리지 않고 기다린다.
export function nextSteps(r: Run): Step[] | 'done' {
  const out: Step[] = [], held = new Set(r.steps.filter(s => ACTIVE.includes(r.nodes[s.key].state)).map(s => s.track ?? ''));
  for (const f of r.fixing ?? []) {
    const t = trackOf(r, f.fixer);
    if (r.nodes[f.fixer].state === 'wait' && !held.has(t)) out.push(r.steps.find(s => s.key === f.fixer)!);
    held.add(t);
  }
  for (const s of r.steps) {
    if (s.fixOnly || held.has(s.track ?? '') || r.nodes[s.key].state !== 'wait' || !s.deps.every(d => ok(r, d))) continue;
    held.add(s.track ?? ''); out.push(s);
  }
  return out.length || !r.steps.every(s => s.fixOnly || ok(r, s.key)) ? out : 'done';
}
export function nextStep(r: Run): Step | 'done' | null {
  const n = nextSteps(r);
  return n === 'done' ? 'done' : n[0] ?? null;
}
const unfix = (r: Run, drop: (f: { fixer: string; for: string }) => boolean) => { r.fixing = r.fixing?.filter(f => !drop(f)); if (!r.fixing?.length) r.fixing = undefined; };
const hold = (r: Run, s: Step, reason: string) => {
  const n = r.nodes[s.key];
  n.state = 'check'; n.reason = reason; r.state = 'check'; r.reason = `「${s.title}」 — ${reason}`;
};
// 실패 화살표가 있고 한도 안이면 고치는 노드를 돌린 뒤 다시. 막힘 · 한도 넘김 · 화살표 없음은 사람에게.
export function settle(r: Run, s: Step, o: Outcome) {
  const n = r.nodes[s.key];
  n.summary = o.summary; n.line = o.line; n.reason = o.reason; n.idle = 0; n.nudged = false;
  if (o.result === '통과' || o.result === '건너뜀') { n.state = o.result === '통과' ? 'done' : 'skipped'; unfix(r, f => f.fixer === s.key); return; }
  if (o.result === '실패' && s.failTo && n.fails < (s.max ?? 3)) {
    n.fails++; n.state = 'wait'; r.nodes[s.failTo].state = 'wait'; r.fixing = [...r.fixing ?? [], { fixer: s.failTo, for: s.key }];
    return;
  }
  hold(r, s, o.result === '막힘' ? `막힘${o.reason ? ` · ${o.reason}` : ''}`
    : s.failTo ? `${n.fails}번 고쳐도 실패 — 한도 ${s.max}번${o.reason ? ` · ${o.reason}` : ''}` : o.reason ?? '실패');
}
// EDITH 를 다시 켰을 때 — 보내는 중이던 노드는 받았는지 모르고, 명령은 EDITH 와 함께 끝났다. 둘 다 다시 보내지 않고 사람에게.
export function recover(r: Run) {
  for (const s of r.steps) {
    const n = r.nodes[s.key];
    if (n.state === 'sending') hold(r, s, '보내는 중에 EDITH 가 꺼졌다 — 받았는지 모른다. pane 을 보고 「이어서」(다시 보냄) 또는 「건너뛰기」');
    else if (s.kind === 'command' && n.state === 'running') hold(r, s, '명령이 EDITH 와 함께 끝났다 — 「이어서」로 다시 돌린다');
  }
}
// 이어서 — 멈춘 · 확인 필요 노드는 이번 시도 결과가 이미 있으면 받고, 없으면 새 시도로 다시 보낸다
export function resume(r: Run, result: (s: Step) => Outcome | null) {
  for (const s of r.steps) {
    const n = r.nodes[s.key];
    if (n.state !== 'check' && n.state !== 'stopped') continue;
    const got = s.kind === 'skill' ? result(s) : null;
    if (got) settle(r, s, got);
    if (n.state === 'check' || n.state === 'stopped') { n.state = 'wait'; n.reason = undefined; n.wake = undefined; }
  }
  r.state = r.steps.some(s => r.nodes[s.key].state === 'check') ? 'check' : 'running';
  if (r.state === 'running') r.reason = undefined;
}
// 건너뛰기 끝 코드 — 명령 노드가 이것으로 끝나면 자기가 든 체인 · 엔진(group)의 남은 노드를 「건너뜀」 으로 통과시킨다.
// automake · meson 의 「건너뜀」 끝 코드와 같은 값. 맨 위 엔진에 놓인 명령이면 런의 남은 노드 전부.
export const SKIP_CODE = 77;
export function skipRest(r: Run, s: Step) {
  const left = r.steps.filter(x => x.key !== s.key && (s.group === '.' || x.key.startsWith(s.group)) && r.nodes[x.key].state === 'wait');
  for (const x of left) { r.nodes[x.key].state = 'skipped'; r.nodes[x.key].reason = `건너뜀 — 「${s.title}」 끝 코드 ${SKIP_CODE}`; }
  const n = r.nodes[s.key];
  n.state = 'done'; n.idle = 0; n.reason = undefined;
  n.summary = `끝 코드 ${SKIP_CODE} — 「${s.lane}」 의 남은 노드 ${left.filter(x => !x.fixOnly).length}개를 건너뜀`;
  unfix(r, f => ok(r, f.fixer));
}
// 노드 자리 이름 — 바깥 엔진부터(백엔드 › 계획 › 「구현」). 옛 런(boxes 없음)은 든 엔진 이름만
export const where = (s: Step) => [...s.boxes?.map(b => b.name) ?? [s.lane], `「${s.title}」`].join(' › ');
// 이 노드부터 다시 — to(노드 키, 또는 체인 · 엔진 자리 n2.n3)의 노드와 화살표로 그 뒤에 이어진 노드(그 고치는 노드까지)를 처음 상태로.
// 작업 문서는 그대로, 지난 시도 폴더도 남는다(다음 시도 번호로 돈다). 고친 횟수도 처음부터. 잘못된 to 면 그 까닭을 돌려준다.
export function rewind(r: Run, to: string, by: string, reason: string): string | null {
  const start = r.steps.filter(s => s.key === to || s.key.startsWith(`${to}.`));
  if (!start.some(s => !s.fixOnly)) return start.length ? `고치는 노드로는 되돌리지 않는다: ${to}` : `런에 없는 노드 · 자리다: ${to}`;
  const back = new Set(start.map(s => s.key));
  for (let more = true; more;) {
    more = false;
    for (const s of r.steps) if (!back.has(s.key) && s.deps.some(d => back.has(d))) { back.add(s.key); more = true; }
  }
  for (const s of r.steps) if (s.failTo && back.has(s.key)) back.add(s.failTo);
  for (const k of back) Object.assign(r.nodes[k], { state: 'wait', fails: 0, summary: undefined, line: undefined, reason: undefined, idle: 0, nudged: false, wake: undefined, auto: undefined });
  unfix(r, f => back.has(f.for));
  const first = start.find(s => !s.fixOnly)!, depth = to.split('.').length;
  const name = first.key === to ? where(first) : first.boxes?.slice(0, depth).map(b => b.name).join(' › ') || to;
  r.rewinds = [...r.rewinds ?? [], { at: Date.now(), to, name, by, reason: reason.slice(0, 600) }];
  // 되돌린 곳 밖에 확인 필요 · 멈춤 노드가 남았으면 런은 그대로 두고 「이어서」 를 기다린다
  if (!r.steps.some(s => ['check', 'stopped'].includes(r.nodes[s.key].state))) { r.state = 'running'; r.reason = undefined; }
  return null;
}
// 명령 노드가 남긴 되돌림 요청($EDITH_REWIND) — 없으면 null, 틀렸으면 그 까닭
export function parseRewind(t: string): { to: string; reason: string } | string {
  let o: Record<string, unknown>;
  try { o = JSON.parse(t); } catch { return '되돌림 파일이 JSON 이 아니다'; }
  if (typeof o?.to !== 'string' || !/^[\w.-]{1,200}$/.test(o.to)) return '되돌림 파일의 "to" 가 노드 키(n2.n3 꼴)가 아니다';
  return { to: o.to, reason: typeof o.reason === 'string' && o.reason.trim() ? o.reason.trim() : '(이유 없음)' };
}
// 스킬 노드의 Claude 띄우기 설정 — 작업 문서의 edith-claude.json {"model", "effort", "mcpConfig": [절대 경로]}(갈래 노드는 edith-claude.<갈래>.json 을 먼저). 없거나 비면 기본.
// 이 셋만 받는다 — 작업 문서는 런의 Claude 도 쓰는 곳이라, 권한 · 설정 인자로 스스로를 넓히지 못하게.
export const CLAUDE_FILE = 'edith-claude.json';
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export function claudeArgs(t: string | null): string[] | string {
  if (!t?.trim()) return [];
  let o: Record<string, unknown>;
  try { o = JSON.parse(t); } catch { return `${CLAUDE_FILE} 이 JSON 이 아니다`; }
  const a: string[] = [], mcp = o.mcpConfig === undefined ? [] : [o.mcpConfig].flat();
  if (o.model !== undefined) { if (typeof o.model !== 'string' || !/^[\w.[\]-]{1,80}$/.test(o.model)) return `${CLAUDE_FILE} 의 model 이 모델 이름이 아니다`; a.push('--model', o.model); }
  if (o.effort !== undefined) { if (!EFFORTS.includes(o.effort as string)) return `${CLAUDE_FILE} 의 effort 는 ${EFFORTS.join(' · ')}`; a.push('--effort', o.effort as string); }
  if (!mcp.every(x => typeof x === 'string' && isAbsolute(x))) return `${CLAUDE_FILE} 의 mcpConfig 는 MCP 설정 파일의 절대 경로(들)`;
  if (mcp.length) a.push('--mcp-config', ...mcp as string[]);
  return a;
}
// 이 시도에 띄운 Claude 설정 — 화면 칩용(모델 · 강도 · MCP 수, 엔진이 적은 이유 why). 설정 파일이 없으면 빈 것(기본 Claude)
export type ClaudeUsed = { model?: string; effort?: string; mcp?: number; why?: string };
export function claudeUsed(t: string | null): ClaudeUsed {
  let o: Record<string, unknown> = {};
  try { if (t?.trim()) o = JSON.parse(t); } catch { return {}; }
  const mcp = o.mcpConfig === undefined ? 0 : [o.mcpConfig].flat().length, why = typeof o.why === 'string' && o.why.trim() ? o.why.trim().slice(0, 160) : undefined;
  return { ...(typeof o.model === 'string' ? { model: o.model } : {}), ...(typeof o.effort === 'string' ? { effort: o.effort } : {}), ...(mcp ? { mcp } : {}), ...(why ? { why } : {}) };
}
export const claudeOf = (id: number, key: string, attempt: number): ClaudeUsed | null => {
  try { return JSON.parse(readFileSync(join(attemptDir(id, key, attempt), 'claude.json'), 'utf8')) as ClaudeUsed; } catch { return null; }
};
// 통과한 노드가 시도 폴더에 rewind.json 을 남겼으면 그 노드부터 다시(명령 노드는 $EDITH_REWIND, 스킬 노드는 결과 파일 옆). 틀렸으면 확인 필요.
export function rewindAfter(r: Run, s: Step, at: string) {
  let t: string;
  try { t = readFileSync(join(at, 'rewind.json'), 'utf8'); } catch { return; }
  const b = parseRewind(t);
  if (typeof b === 'string') return hold(r, s, b);
  const n = r.nodes[s.key];
  n.summary = [n.summary, `되돌림 → ${b.to}`].filter(Boolean).join(' · ');
  const e = rewind(r, b.to, where(s), b.reason);
  if (e) hold(r, s, e);
}
export function skip(r: Run, key: string) {
  const n = r.nodes[key];
  if (!n || n.state === 'done') return;
  n.state = 'skipped'; n.reason = '건너뜀';
  unfix(r, f => f.fixer === key);
  if (r.state === 'check' && !r.steps.some(s => r.nodes[s.key].state === 'check')) { r.state = 'running'; r.reason = undefined; }
}
// 무인 런 — 확인 필요가 된 노드를 사람을 기다리지 않고 새 시도로 다시 돌린다(노드마다 2번까지). 그래도 안 되면 그 까닭을 남기고 건너뛴다(뒤 노드는 돈다).
// 질문 · 승인 화면(blocked)은 건드리지 않는다 — 권한 승인을 대신 누르지 않는다
export const AUTO_TRIES = 2;
export function unattend(r: Run) {
  if (!r.unattended) return;
  for (const s of r.steps) {
    const n = r.nodes[s.key];
    if (n.state !== 'check') continue;
    if ((n.auto ?? 0) < AUTO_TRIES) { n.auto = (n.auto ?? 0) + 1; n.state = 'wait'; n.reason = undefined; continue; }
    const why = n.reason;
    skip(r, s.key);
    n.reason = `무인 — ${AUTO_TRIES}번 다시 돌려도 안 돼 건너뜀${why ? ` · ${why}` : ''}`;
  }
  if (r.state === 'check' && !r.steps.some(s => r.nodes[s.key].state === 'check')) { r.state = 'running'; r.reason = undefined; }
}
const ASK = '사람에게 물을 것이 있으면 질문 창으로 묻는다.';
const NO_ASK = '무인 런이다 — 사람이 답하지 않는다. 질문 창으로 묻지 말고, 정할 것은 추천 · 안전한 쪽으로 정해 진행한 뒤 그 가정을 요약에 「가정:」 으로 적는다.';

// 스킬 노드에 보내는 글 — 공통 규칙 · 단계 지시 · 폴더 · 결과 파일을 줄로
export function promptFor(r: Run, s: Step, dir: string, res: string, extra: string[] = []) {
  return [
    `[EDITH 런 #${r.id} · ${where(s)}]`,
    ...(s.track ? [`갈래: ${s.track} — 다른 갈래가 같은 작업 폴더에서 동시에 돈다. 이 갈래 일만 한다.`] : []),
    ...(s.common ? [`공통 규칙: ${s.common}`] : []),
    `단계 지시: ${s.skill} — 이 파일을 읽고 그대로 한다. 이 노드 하나만 하고 다음 노드로 넘어가지 않는다.`,
    `작업 폴더: ${r.cwd}`,
    `작업 문서: ${join(dir, 'work')} — 앞 노드들이 남긴 것을 여기서 읽고, 다음 노드에 넘길 것을 여기에 남긴다.`,
    ...(r.input ? [`런 입력: ${r.input}`] : []),
    ...(r.unattended ? [NO_ASK] : []),
    ...extra,
    `결과 파일: ${res} — 끝나면 {"결과": "통과" | "건너뜀" | "실패" | "막힘", "한줄": "<사람이 한눈에 볼 한 줄 — 40자 안, 코드 · 키 · 경로 · 해시 없이 무엇을 했는지>", "요약": "<한국어 3줄 이내>"} 를 ${res}.tmp 에 쓰고 mv 로 옮긴다. 이 노드에서 할 일이 없었으면(조건이 안 맞아 넘어감) "건너뜀". 결과 파일을 쓰는 것이 마지막 동작이다.${r.unattended ? '' : ` ${ASK}`}`,
  ].join('\n');
}
export function parseResult(t: string): Outcome | string {
  let o: Record<string, unknown>;
  try { o = JSON.parse(t); } catch { return '결과 파일이 JSON 이 아니다'; }
  if (o?.결과 !== '통과' && o?.결과 !== '건너뜀' && o?.결과 !== '실패' && o?.결과 !== '막힘') return '결과 파일의 "결과" 가 통과 · 건너뜀 · 실패 · 막힘 이 아니다';
  const summary = typeof o.요약 === 'string' ? o.요약.slice(0, 600) : undefined;
  const line = typeof o.한줄 === 'string' && o.한줄.trim() ? o.한줄.trim().slice(0, 80) : undefined;
  return { result: o.결과, summary, ...(line ? { line } : {}), reason: o.결과 === '통과' || o.결과 === '건너뜀' ? undefined : summary };
}

// ── 파일 ──
const dirOf = (id: number) => join(RUNS, String(id));
const attemptDir = (id: number, key: string, attempt: number) => join(dirOf(id), 'nodes', key, String(attempt));
export function loadRun(id: number): Run | null {
  let r: Run;
  try { r = JSON.parse(readFileSync(join(dirOf(id), 'run.json'), 'utf8')) as Run; } catch { return null; }
  if (r.fixing && !Array.isArray(r.fixing)) r.fixing = [r.fixing];   // 갈래 전 런 — 고치는 중이 하나였다
  return r;
}
const saved = new Map<number, Record<string, string>>();
function saveRun(r: Run) {
  const f = join(dirOf(r.id), 'run.json'), tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(r, null, 2), { mode: 0o600 });
  renameSync(tmp, f);
  // 노드 상태가 바뀐 때를 events.jsonl 에 — 런 분석(걸린 시간 · 사람 대기)이 쓴다. EDITH 를 다시 켜면 처음 한 번은 모든 노드를 다시 적는다(구간이 나뉠 뿐).
  const was = saved.get(r.id), now = Object.fromEntries(r.steps.map(s => [s.key, `${r.nodes[s.key].state}:${r.nodes[s.key].attempt}`])), t = Date.now();
  const changed = r.steps.filter(s => was?.[s.key] !== now[s.key]);
  // 시도가 시작될 때 코드 지문 — 분석 「헛도는 검사」 가 실패 뒤 코드가 그대로인 채 다시 돈 시도를 찾는다
  const fp = changed.some(s => r.nodes[s.key].state === 'running') ? codeFp(r) : undefined;
  const ev = changed.map(s => JSON.stringify({ t, key: s.key, state: r.nodes[s.key].state, attempt: r.nodes[s.key].attempt, ...(fp && r.nodes[s.key].state === 'running' ? { fp } : {}) }));
  if (ev.length) appendFileSync(join(dirOf(r.id), 'events.jsonl'), `${ev.join('\n')}\n`, { mode: 0o600 });
  saved.set(r.id, now);
}
// 코드 지문 — 런의 레포(작업 문서 edith-repos.json 의 path, 없으면 작업 폴더가 git 이면 그것)마다 HEAD · 바뀐 파일 목록 · 커밋 안 한 diff 를 묶은 해시.
// shortcut: 새 파일(untracked)은 이름만 본다 — 내용만 바뀐 새 파일은 같은 지문이 된다. 그런 헛돎을 놓치면 git add -N 을 더한다
export function codeFp(r: { id: number; cwd?: string }) {
  let dirs: string[] = [];
  try { dirs = (JSON.parse(readFileSync(join(dirOf(r.id), 'work', 'edith-repos.json'), 'utf8')) as { path?: unknown }[]).flatMap(x => typeof x?.path === 'string' ? [x.path] : []); } catch { /* 레포 칸이 아직 없다 */ }
  if (!dirs.length && r.cwd && existsSync(join(r.cwd, '.git'))) dirs = [r.cwd];
  const h = createHash('sha1');
  for (const d of dirs.filter(d => existsSync(d))) for (const args of [['rev-parse', 'HEAD'], ['status', '--porcelain'], ['diff', 'HEAD']]) {
    h.update(spawnSync('git', ['-C', d, ...args], { encoding: 'utf8', timeout: 5000, maxBuffer: 64 << 20 }).stdout ?? '');
  }
  return dirs.length ? h.digest('hex').slice(0, 12) : undefined;
}
const ids = () => { try { return readdirSync(RUNS).filter(f => /^\d+$/.test(f)).map(Number).sort((a, b) => b - a); } catch { return []; } };
// 런 이름표 — 티켓(받은 요청 · 고르기의 tag)과 짧은 제목(엔진 요약 → 요청 제목 → 입력 첫 줄, 주소뿐이면 없음). 앞의 이모지 · 기호는 뗀다
const clean = (v: unknown, n: number) => typeof v === 'string' && v.trim() ? v.trim().replace(/^[^\p{L}\p{N}[(]+/u, '').slice(0, n) || undefined : undefined;
export function runLabel(req: { tag?: unknown; title?: unknown } | null, summary: string | undefined, input: string) {
  const line = input.split('\n')[0].trim(), tag = clean(req?.tag, 40);
  const title = clean(summary, 120) ?? clean(req?.title, 120) ?? (line && !/^https?:\/\/\S+$/.test(line) ? clean(line, 120) : undefined);
  return { ...(tag ? { tag } : {}), ...(title ? { title } : {}) };
}
// 작업 문서 안의 요청 파일만(링크로 밖을 가리키면 없는 것으로)
function requestOf(id: number) {
  try { const w = realpathSync(join(dirOf(id), 'work')), f = realpathSync(join(w, 'edith-request.json')); return f.startsWith(w + sep) ? JSON.parse(readFileSync(f, 'utf8')) as { tag?: unknown; title?: unknown } : null; } catch { return null; }
}
const labelOf = (r: Run) => runLabel(requestOf(r.id), readSummary(join(dirOf(r.id), 'work'))?.title, r.input);
export function listRuns() {
  return ids().flatMap(id => {
    const r = loadRun(id);
    if (!r) return [];
    const live = r.steps.filter(s => !s.fixOnly);
    return [{ id, name: r.name, engine: r.engine, ...(r.def ? { def: r.def } : {}), state: r.state, reason: r.reason, created: r.created, total: live.length, done: live.filter(s => ok(r, s.key)).length, ...labelOf(r) }];
  });
}
// 화면에 줄 것 — run 과 노드마다 보낸 글 · 명령 출력 끝(실행 폴더 안에서 서버가 정한 경로만)
// 노드 상태 기록 — 깨진 줄은 뺀다(옛 런은 없다)
export function readEvents(id: number): Ev[] {
  let t = '';
  try { t = readFileSync(join(dirOf(id), 'events.jsonl'), 'utf8'); } catch { return []; }
  return t.split('\n').flatMap(l => { try { return l ? [JSON.parse(l) as Ev] : []; } catch { return []; } });
}
const tail = (f: string, n = 4000) => { try { const t = readFileSync(f, 'utf8'); return t.length > n ? `…${t.slice(-n)}` : t; } catch { return undefined; } };
export function runView(id: number) {
  const r = loadRun(id);
  if (!r) return null;
  const detail = Object.fromEntries(r.steps.map(s => {
    const a = r.nodes[s.key].attempt, d = attemptDir(id, s.key, a);
    return [s.key, a ? { prompt: tail(join(d, 'prompt.txt'), 6000), output: tail(join(d, 'output.log')), claude: claudeOf(id, s.key, a) ?? undefined } : {}];
  }));
  // 타임라인 — 시도마다 결과(스킬은 결과 파일 요약, 명령은 출력 마지막 줄)
  const kind = new Map(r.steps.map(s => [s.key, s.kind]));
  const got = (key: string, a: number) => {
    const d = attemptDir(id, key, a);
    if (kind.get(key) === 'command') return { out: lastLine(tail(join(d, 'output.log'))) };
    const o = parseResult(tail(join(d, 'result.json'), 1e5) ?? '');
    const claude = claudeOf(id, key, a) ?? undefined;
    return typeof o === 'string' ? { claude } : { summary: o.summary, line: o.line, claude };
  };
  return { ...r, ...labelOf(r), detail, timeline: timeline(r, readEvents(id), got), dir: dirOf(id), actions: readActions(r), acted: acted(id), live: livePort(join(dirOf(id), 'work')) !== null,
    summary: r.state === 'done' ? readSummary(join(dirOf(id), 'work')) : null };   // 끝난 런만 — 「요약」 보기(src/runSummary.ts)
}

// 엔진 사본 — 이 엔진과 안에 든 엔진을 통째로(스킬까지) 실행 폴더로. 실행은 사본으로 돈다(공방에서 고쳐도 이 실행은 그대로).
function copyEngines(top: string, to: string) {
  const seen = new Set<string>(), walk = (id: string) => {
    if (seen.has(id) || !NAME.test(id) || !existsSync(join(WORKSHOP, id, 'engine.json'))) return;
    seen.add(id);
    cpSync(join(WORKSHOP, id), join(to, id), { recursive: true });
    const e = check(JSON.parse(readFileSync(join(WORKSHOP, id, 'engine.json'), 'utf8')));
    if (!Array.isArray(e)) for (const n of e.nodes) if (n.engine) walk(n.engine);
  };
  walk(top);
}
// 스킬 경로 — 엔진 스킬은 사본 안(링크로 밖을 가리키면 없는 것으로), 설치 스킬은 스킬 목록의 그 파일
function resolver(engines: string): Resolve {
  return (engine, ref) => {
    if (ref.from === 'installed') {
      const n = skills().find(x => x.id === ref.id);
      try { const f = n && (statSync(n.path).isDirectory() ? join(n.path, 'SKILL.md') : n.path); return f && existsSync(f) ? f : null; } catch { return null; }
    }
    try {
      const base = realpathSync(join(engines, engine, 'skills')), d = realpathSync(join(base, ref.id));
      return d.startsWith(base + sep) && statSync(join(d, 'SKILL.md')).isFile() ? join(d, 'SKILL.md') : null;
    } catch { return null; }
  };
}

// 새 실행 — 검사하고 사본을 떠 run.json 을 만든 뒤 돌려준다. 작업 폴더는 엔진 설정대로:
// 실행할 때 고르기(cwd) · 늘 같은 폴더 · 새 워크트리(branch — herdr 가 워크트리와 워크스페이스를 만들고 실행 pane 은 그 워크스페이스의 첫 pane).
// Claude 는 실행기가 첫 스킬 노드 때 띄운다.
const folderOf = (v: unknown, what: string) => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${what}가 비었다`);
  const f = v.trim().replace(/^~(?=[\\/]|$)/, homedir());
  if (!existsSync(f) || !statSync(f).isDirectory()) throw new Error(`${what}가 없다: ${f}`);
  return f;
};
// request — 받은 요청에서 연 런이면 그 요청(요청자 · 방 · meta)을 작업 문서 edith-request.json 에 두고 시작한다(노드가 요청 쪽에 알릴 때 쓴다)
// what — 공방 런(kind run — 그 런이 정한 엔진을 그 설정으로) 또는 엔진 · 체인(시험 — 그 엔진 설정으로)
export async function startRun(what: unknown, cwd: unknown, input: unknown, branch: unknown, port: number, unattended?: unknown, request?: object) {
  const read = (id: unknown) => {
    if (typeof id !== 'string' || !NAME.test(id) || !existsSync(join(WORKSHOP, id, 'engine.json'))) throw new Error('공방에 없다');
    const e = check(JSON.parse(readFileSync(join(WORKSHOP, id, 'engine.json'), 'utf8')));
    if (Array.isArray(e)) throw new Error(e.join(' · '));
    return e;
  };
  const def = read(what), run = def.kind === 'run' ? def : null, engine = run ? run.engine! : what as string;
  const top0 = run ? read(engine) : def;
  if (top0.kind === 'run') throw new Error(`런 「${def.name}」 이 돌릴 것이 또 런이다 — 엔진 · 체인을 고른다`);
  // 작업 폴더 — 런에 있으면 런 것, 없으면 엔진 것(런으로 옮기기 전 엔진에 적어 둔 것)
  const wd = run?.workdir ?? top0.workdir ?? { kind: 'ask' as const };
  let folder = wd.kind === 'ask' ? folderOf(cwd, '작업 폴더') : wd.kind === 'fixed' ? folderOf(wd.dir, '공방 설정의 작업 폴더') : '';
  const repo = wd.kind === 'worktree' ? folderOf(wd.repo, '공방 설정의 레포 폴더') : '';
  if (wd.kind === 'worktree' && (typeof branch !== 'string' || !BRANCH.test(branch.trim()))) throw new Error('브랜치 이름을 넣는다(영문 · 숫자 · 한글 · . _ / -, - 로 시작하지 않게)');
  if (input !== undefined && (typeof input !== 'string' || input.length > 4000)) throw new Error('입력은 4000자까지');
  const id = (ids()[0] ?? 0) + 1, dir = dirOf(id);
  mkdirSync(join(dir, 'work'), { recursive: true, mode: 0o700 });
  copyEngines(engine, join(dir, 'engine'));
  if (run) cpSync(join(WORKSHOP, what as string), join(dir, 'run'), { recursive: true });   // 런 설정 · 단추도 시작할 때의 사본으로
  const load: Load = e => {
    try { const r = check(JSON.parse(readFileSync(join(dir, 'engine', e, 'engine.json'), 'utf8'))); return Array.isArray(r) ? r.join(' · ') : r; } catch { return '공방에 없다'; }
  };
  const steps = flatten(engine, load, resolver(join(dir, 'engine')));
  if (typeof steps[0] === 'string') { rmSync(dir, { recursive: true, force: true }); throw new Error((steps as string[]).join(' · ')); }
  const top = load(engine) as Engine;
  let pane: string | undefined, br: string | undefined;
  if (wd.kind === 'worktree') {
    br = (branch as string).trim();
    try { ({ path: folder, pane } = await newWorktree(repo, br, wd.base, `▶ ${run?.name ?? top.name} #${id} · ${br}`)); }
    catch (e) { rmSync(dir, { recursive: true, force: true }); throw new Error(`워크트리를 만들지 못했다 — ${firstLine(e)}`); }
  }
  const r: Run = {
    id, engine, ...(run ? { def: what as string } : {}), name: run?.name ?? top.name, cwd: folder, input: (input as string | undefined)?.trim() ?? '', created: Date.now(), state: 'running', owner: { pid: process.pid, port },
    ...(br ? { branch: br } : {}), ...(pane ? { pane } : {}), ...(unattended === true ? { unattended: true } : {}),
    steps: steps as Step[], nodes: Object.fromEntries((steps as Step[]).map(s => [s.key, { state: 'wait', attempt: 0, fails: 0 } as NodeRun])),
  };
  if (busy() >= runLimit()) { r.state = 'queued'; r.reason = WAIT; }
  if (request) writeFileSync(join(dir, 'work', 'edith-request.json'), JSON.stringify(request, null, 2), { mode: 0o600 });
  saveRun(r);
  if (r.state === 'running') drive(id);
  return { id };
}

// ── 동시 실행 대기열 — 도는 중 · 확인 필요인 런이 한도면 새 런은 「대기」 로 줄을 서고, 자리가 나면 먼저 온 것부터 ──
// 확인 필요도 센다 — 사람을 기다리는 동안에도 그 런의 Claude · 로컬 서버 같은 것을 쥐고 있다
const LIMIT_FILE = join(CONFIG_DIR, 'runs.json'), WAIT = '줄 서 있다 — 도는 런이 끝나면 먼저 온 것부터 시작한다';
export const parseLimit = (t: string | null) => { try { const n = (JSON.parse(t ?? '') as { max?: unknown }).max; return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 10 ? n as number : 2; } catch { return 2; } };
export const runLimit = () => { try { return parseLimit(readFileSync(LIMIT_FILE, 'utf8')); } catch { return 2; } };
export function setRunLimit(n: unknown) {
  if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > 10) throw new Error('동시 런 수는 1~10');
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(LIMIT_FILE, `${JSON.stringify({ max: n })}\n`, { mode: 0o600 });
  startQueued();
  return { max: n as number };
}
const busy = () => ids().filter(i => { const s = loadRun(i)?.state; return s === 'running' || s === 'check'; }).length;
let ownPort = 0;
// 자리가 난 만큼 줄의 런을 시작한다(번호 작은 것 = 먼저 온 것부터)
export function startQueued() {
  let free = runLimit() - busy();
  for (const id of [...ids()].reverse()) {
    if (free <= 0) break;
    const r = loadRun(id);
    if (r?.state !== 'queued') continue;
    r.state = 'running'; r.reason = undefined; r.owner = { pid: process.pid, port: ownPort || r.owner?.port || 0 };
    saveRun(r);
    drive(id);
    free--;
  }
}

// ── 돌리기 — 실행마다 고리 하나(2초마다). 사람이 누른 것(멈춤 · 이어서 · 건너뛰기)은 줄에 넣었다가 고리가 처리한다 ──
// 갈래가 여럿이면 갈래마다 노드 하나씩 동시에 — 한 갈래가 확인 필요로 멈춰도 다른 갈래는 계속 돈다(런은 「확인 필요」 로 보이며).
// 줄의 되돌리기는 런 단추가 넣는다(되돌릴 노드 중 도는 것은 멈추고). 화면의 「이 노드부터 다시」 는 돌지 않을 때만 받는다.
type Action = { do: 'stop' } | { do: 'resume' } | { do: 'skip'; key: string } | { do: 'rewind'; to: string; by: string; reason: string } | { do: 'drop'; reason: string };
const driving = new Set<number>(), queued = new Map<number, Action[]>(), procs = new Map<string, ChildProcess>(), exits = new Map<string, number>();
// 명령 프로세스 · 끝 코드는 시도마다 따로 — 멈춘 시도가 늦게 끝나도 다음 시도의 결과로 읽히지 않게
const pk = (r: Run, key: string) => `${r.id}:${key}:${r.nodes[key].attempt}`;
// 갈래의 pane · Claude 인자 자리 — 본 줄은 run 자신(pane · claude), 갈래는 panes[이름]
const slot = (r: Run, track = ''): { pane?: string; claude?: string[] } => track ? ((r.panes ??= {})[track] ??= {}) : r;
// 고리를 돌릴 것이 있나 — 도는 중이거나, 확인 필요여도 다른 갈래에 도는 노드 · 돌 수 있는 노드가 있으면
const moving = (r: Run) => r.state === 'running' || (r.state === 'check'
  && (r.steps.some(s => ACTIVE.includes(r.nodes[s.key].state)) || (n => n !== 'done' && n.length > 0)(nextSteps(r))));
const checks = (r: Run) => r.steps.filter(s => r.nodes[s.key].state === 'check').length;
function apply(r: Run, a: Action) {
  if (r.state === 'dropped') return;
  if (a.do === 'stop') return stopNow(r);
  if (a.do === 'drop') { stopNow(r); r.state = 'dropped'; r.reason = a.reason; return; }
  if (a.do === 'skip') return skip(r, a.key);
  if (a.do === 'resume') return void (r.state !== 'done' && resume(r, s => readOutcome(r, s)));
  const e = rewindLive(r, a.to, a.by, a.reason);
  if (e) { r.state = 'check'; r.reason = e; }
}
// 도는 노드를 끊는다 — 명령은 끝내고, 스킬은 그 갈래 pane 에 Esc
function interrupt(r: Run, s: Step) {
  if (s.kind === 'command') return void procs.get(pk(r, s.key))?.kill();
  const pane = slot(r, s.track).pane;
  if (pane) void keys(pane, 'esc').catch(() => undefined);
}
// 도는 중에 되돌리기 — 되돌릴 노드 중 돌던 것은 끊는다(다른 갈래의 도는 노드는 그대로)
function rewindLive(r: Run, to: string, by: string, reason: string) {
  const busy = r.steps.filter(s => ACTIVE.includes(r.nodes[s.key].state));
  const e = rewind(r, to, by, reason);
  for (const s of busy) if (r.nodes[s.key].state === 'wait') interrupt(r, s);
  return e;
}

export function act(id: number, a: { do: 'stop' | 'resume' | 'skip' | 'rewind'; key?: unknown }) {
  const r = loadRun(id);
  if (!r) throw new Error('없는 런이다');
  if (r.state === 'dropped') throw new Error('버린 런이다 — 기록만 남았다');
  if ((a.do === 'skip' || a.do === 'rewind') && (typeof a.key !== 'string' || !r.nodes[a.key])) throw new Error('없는 노드다');
  // shortcut: 화면의 되돌리기는 돌지 않을 때만(어느 갈래도) — 멈춘 뒤 되돌린다
  if (a.do === 'rewind' && (driving.has(id) || r.state === 'running')) throw new Error('도는 중이다 — 멈춘 뒤 되돌린다');
  if (a.do === 'resume' && r.state === 'done') throw new Error('끝난 런이다');
  // 줄 서 있는 런 — 「이어서」 는 한도를 넘어 바로 시작, 「멈춤」 은 줄에서 뺀다
  if (r.state === 'queued') {
    if (a.do === 'resume') { r.state = 'running'; r.reason = undefined; saveRun(r); drive(id); return; }
    if (a.do === 'stop') { r.state = 'stopped'; r.reason = '줄에서 뺐다'; saveRun(r); return; }
    throw new Error('아직 시작하지 않은 런이다');
  }
  if (driving.has(id)) return void queue(id, a.do === 'stop' ? { do: 'stop' } : a.do === 'resume' ? { do: 'resume' } : { do: 'skip', key: a.key as string });
  if (a.do === 'stop') { stopNow(r); setTimeout(startQueued, 0); }
  if (a.do === 'skip') skip(r, a.key as string);
  if (a.do === 'resume') resume(r, s => readOutcome(r, s));
  if (a.do === 'rewind') {
    const e = rewind(r, a.key as string, '사람', '화면에서');
    if (e) throw new Error(e);
  }
  saveRun(r);
  if (moving(r)) drive(id);
}
// 버림 — 엔진의 「버리기」 단추가 치운 런(POST /api/runs/:id/drop). 도는 노드는 끊고, 끝 상태라 이어서 · 건너뛰기 · 되돌리기 · 런 단추를 막는다(기록은 남는다)
export function dropRun(id: number, reason: unknown) {
  const r = loadRun(id);
  if (!r) throw new Error('없는 런이다');
  const why = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 300) : '버림';
  if (driving.has(id)) return void queue(id, { do: 'drop', reason: why });
  apply(r, { do: 'drop', reason: why });
  saveRun(r);
  setTimeout(startQueued, 0);
}
function stopNow(r: Run) {
  for (const s of r.steps) {
    if (!ACTIVE.includes(r.nodes[s.key].state)) continue;
    interrupt(r, s);
    Object.assign(r.nodes[s.key], { state: 'stopped', wake: undefined });
  }
  if (r.state !== 'done') { r.state = 'stopped'; r.reason = '멈춤'; }
}
function readOutcome(r: Run, s: Step): Outcome | null {
  const n = r.nodes[s.key];
  if (!n.attempt) return null;
  try { const o = parseResult(readFileSync(join(attemptDir(r.id, s.key, n.attempt), 'result.json'), 'utf8')); return typeof o === 'string' ? null : o; } catch { return null; }
}

export function drive(id: number) {
  if (driving.has(id)) return;
  driving.add(id);
  void (async () => {
    try {
      for (;;) {
        const r = loadRun(id);
        if (!r) break;
        for (const a of queued.get(id) ?? []) apply(r, a);
        queued.delete(id);
        const held = checks(r);
        if (moving(r)) await tick(r);
        unattend(r);
        if (checks(r) > held) notify(`런 #${id} ${r.name} — 확인 필요`, r.reason);
        saveRun(r);
        if (!moving(r)) break;
        await sleep(2000);
      }
    } catch (e) {
      const r = loadRun(id);
      if (r) { r.state = 'check'; r.reason = `런을 돌리다 오류 — ${firstLine(e)}`; saveRun(r); notify(`런 #${id} ${r.name} — 확인 필요`, r.reason); }
    } finally {
      driving.delete(id);
      startQueued();
      // 고리가 끝나는 사이에 들어온 것 — 버리지 않고 처리한다
      const late = queued.get(id);
      if (late?.length) {
        queued.delete(id);
        const r = loadRun(id);
        if (r) { for (const a of late) apply(r, a); saveRun(r); if (moving(r)) drive(id); }
      }
    }
  })();
}

async function tick(r: Run) {
  // 명령이 끝났으면 받는다(끝 코드는 프로세스 쪽이 적어 두고, run.json 은 이 고리만 쓴다)
  for (const s of r.steps) {
    const code = exits.get(pk(r, s.key));
    if (code === undefined || r.nodes[s.key].state !== 'running') continue;
    exits.delete(pk(r, s.key));
    const at = attemptDir(r.id, s.key, r.nodes[s.key].attempt), log = join(at, 'output.log');
    if (code === SKIP_CODE) { skipRest(r, s); continue; }
    settle(r, s, code === 0 ? { result: '통과', summary: '끝 코드 0' } : { result: '실패', summary: `끝 코드 ${code}`, reason: `명령 실패(끝 코드 ${code}) — 출력: ${log}` });
    if (code === 0) rewindAfter(r, s, at);
  }
  // 도는 스킬 노드는 갈래마다 지켜보고, 빈 갈래는 다음 노드를 시작한다
  for (const s of r.steps) if (s.kind === 'skill' && (r.nodes[s.key].state === 'running' || r.nodes[s.key].state === 'blocked')) await watch(r, s);
  const next = nextSteps(r);
  if (next === 'done') { r.state = 'done'; r.reason = undefined; return; }
  for (const s of next) await begin(r, s);
}

async function begin(r: Run, next: Step) {
  const dir = dirOf(r.id), n = r.nodes[next.key];
  n.attempt++; n.idle = 0; n.nudged = false; n.summary = undefined; n.line = undefined; n.reason = undefined;
  const at = attemptDir(r.id, next.key, n.attempt);
  mkdirSync(at, { recursive: true, mode: 0o700 });
  // 고치는 노드면 무엇이 실패했는지 같이 준다
  const fx = r.fixing?.find(f => f.fixer === next.key), failed = fx && r.steps.find(s => s.key === fx.for);
  const why = failed ? [`고칠 것: 「${failed.title}」 이 실패했다 — ${failed.kind === 'command'
    ? `명령 \`${failed.command}\` 출력: ${join(attemptDir(r.id, failed.key, r.nodes[failed.key].attempt), 'output.log')}`
    : `결과: ${join(attemptDir(r.id, failed.key, r.nodes[failed.key].attempt), 'result.json')}`}`] : [];
  if (next.kind === 'command') return runCommand(r, next, at, why);
  // 스킬 — 그 갈래에 Claude 가 없거나 띄우기 설정이 바뀌었으면 (다시) 띄우고, 「보내는 중」을 먼저 적은 뒤 새 대화로 보낸다
  // 갈래 노드는 그 갈래 것(edith-claude.<갈래>.json)을 먼저
  const read = (f: string) => { try { return readFileSync(join(dir, 'work', f), 'utf8'); } catch { return null; } };
  const conf = (next.track ? read(CLAUDE_FILE.replace(/\.json$/, `.${next.track}.json`)) : null) ?? read(CLAUDE_FILE), want = claudeArgs(conf);
  if (typeof want === 'string') return hold(r, next, want);
  const no = await ensureClaude(r, next.track ?? '', want);
  if (no) return hold(r, next, no);
  writeFileSync(join(at, 'claude.json'), JSON.stringify(claudeUsed(conf)), { mode: 0o600 });
  const pane = slot(r, next.track).pane!;
  n.state = 'sending';
  saveRun(r);
  const res = join(at, 'result.json'), text = promptFor(r, next, dir, res, why);
  writeFileSync(join(at, 'prompt.txt'), text, { mode: 0o600 });
  try {
    await promptAgent(pane, '/clear');
    await sleep(3000);
    await promptAgent(pane, text);
    n.state = 'running';
  } catch (e) {
    hold(r, next, /blocked/.test(String(e)) ? 'Claude 가 질문 · 승인 화면에 멈춰 보내지 못했다 — pane 에서 답하고 「이어서」' : `보내지 못했다 — ${firstLine(e)}`);
  }
}

// 스킬 노드 지켜보기 — Claude 가 쉬는 상태(idle · done)이고 이번 시도 결과 파일이 있으면 끝. 결과 없이 쉬면 한 번 일깨우고, 그래도 없으면 사람에게.
async function watch(r: Run, s: Step) {
  const n = r.nodes[s.key], pane = slot(r, s.track).pane, p = (await snapshot()).panes.find(x => x.id === pane);
  if (!pane || !p || p.agent !== 'claude') return hold(r, s, '런 pane 이 없거나 Claude 가 꺼졌다 — pane 을 보고 「이어서」');
  if (p.status === 'blocked') { if (n.state !== 'blocked') notify(`런 #${r.id} ${r.name} — 답을 기다린다`, where(s)); n.state = 'blocked'; n.idle = 0; return; }
  n.state = 'running';
  if (p.status !== 'idle' && p.status !== 'done') { n.idle = 0; return; }
  const res = join(attemptDir(r.id, s.key, n.attempt), 'result.json');
  if (existsSync(res)) {
    const o = parseResult(readFileSync(res, 'utf8'));
    if (typeof o === 'string') return hold(r, s, o);
    settle(r, s, o);
    if (o.result === '통과' || o.result === '건너뜀') rewindAfter(r, s, attemptDir(r.id, s.key, n.attempt));
    return;
  }
  // 사용량 한도로 멈췄으면 다시 찰 시각(상태줄 · 못 읽으면 30분 뒤)까지 기다렸다가 같은 대화에 이어 하라고 보낸다
  if (n.wake) {
    if (Date.now() < n.wake) return;
    n.wake = undefined; n.idle = 0; n.nudged = false; n.reason = undefined;
    return void await promptAgent(pane, `사용량 한도가 풀렸다. 하던 일을 이어서 하고, 끝나면 결과 파일(${res})을 쓴다.`).catch(() => undefined);
  }
  if (await limitHit(pane).catch(() => false)) {
    await statusline(pane).catch(() => null);
    n.wake = limitReset() ?? Date.now() + 30 * 60_000;
    n.reason = `사용량 한도 — ${new Date(n.wake).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 에 이어 간다`;
    return notify(`런 #${r.id} ${r.name} — 사용량 한도`, n.reason);
  }
  n.idle = (n.idle ?? 0) + 1;
  // 백그라운드 셸이 돌면(Codex 리뷰 기다리기 같은) 셸이 끝날 때 Claude 가 스스로 이어 가니 300틱(10분 넘게)까지 그냥 기다린다 — 띄워 둔 서버처럼 안 끝나는 셸이면 그 뒤에
  if (n.idle < (n.nudged ? 15 : 8) || (n.idle < 300 && await bgShells(pane).catch(() => false))) return;
  if (!n.nudged) {
    n.nudged = true; n.idle = 0;
    await promptAgent(pane, `결과 파일(${res})을 아직 쓰지 않았다. 다 했으면 결과 파일을 쓰고, 막혔으면 "막힘" 으로 적는다. ${r.unattended ? NO_ASK : ASK}`).catch(() => undefined);
  } else hold(r, s, '결과 파일 없이 멈췄다 — 글로 물었을 수 있다. pane 에서 답하고 「이어서」');
}

// Mac 알림 — 런이 사람을 기다리게 되면(확인 필요 · 질문 · 사용량 한도). 글은 인자로 넘긴다(AppleScript 글 속 따옴표를 걱정하지 않게).
// shortcut: macOS 만(osascript) — 다른 OS 는 화면의 승인 대기 알림뿐. 필요하면 notify-send 를 더한다
function notify(title: string, body = '') {
  if (process.platform !== 'darwin') return;
  spawn('osascript', ['-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)', '-e', 'end run', title, body.slice(0, 240)], { stdio: 'ignore' })
    .on('error', () => undefined);
}

// 런 pane — 본 줄은 「▶ 이름 #번호」 워크스페이스를 작업 폴더에서 만들고, 갈래는 본 줄 pane 옆을 나눠(없으면 「▶ 이름 #번호 · 갈래」 워크스페이스)
// Claude 를 띄운다(실행 폴더는 --add-dir 로 쓸 수 있게). 띄운 인자(want — 모델 · 강도 · MCP)가 이번 노드 것과 다르면 /exit 로 끄고
// 그 인자로 다시 띄운다(노드마다 새 대화라 잃는 것이 없다). 못 하면 그 까닭(노드를 확인 필요로), 되면 null.
async function ensureClaude(r: Run, track: string, want: string[]): Promise<string | null> {
  const o = slot(r, track), find = async (id?: string) => (await snapshot()).panes.find(x => x.id === id);
  if (o.pane) {
    const p = await find(o.pane);
    if (p?.agent === 'claude' && JSON.stringify(o.claude ?? []) === JSON.stringify(want)) return null;
    if (!p) { o.pane = undefined; return '런 pane 이 사라졌다 — 「이어서」 로 새로 띄운다'; }
    if (p.agent === 'claude') {
      try {
        await promptAgent(o.pane, '/exit');
        for (let i = 0; ; i++) {
          if (i >= 20) throw new Error('/exit 뒤 20초 안에 꺼지지 않았다');
          await sleep(1000);
          if (!(await find(o.pane))?.agent) break;
        }
      } catch (e) { return `Claude 를 새 설정으로 다시 띄우려다 못 껐다 — ${firstLine(e)}. pane 을 보고 「이어서」`; }
    }
  }
  try {
    if (!o.pane) o.pane = track && r.pane && await find(r.pane) ? await split(r.pane, 'right') : await newWorkspace(`▶ ${r.name} #${r.id}${track ? ` · ${track}` : ''}`, r.cwd);
    saveRun(r);
    // /exit 뒤 herdr 가 Claude 가 꺼진 것을 본 뒤에도 셸이 프롬프트로 돌아오기까지 잠깐 「셸이 아니다」(agent_pane_busy) — 15초까지 다시
    for (let i = 0; ; i++) {
      try { await start(o.pane, 'claude', ['--add-dir', dirOf(r.id), ...want]); break; }
      catch (e) { if (i >= 15 || !/agent_pane_busy/.test(String(e))) throw e; await sleep(1000); }
    }
    o.claude = want;
    return null;
  } catch (e) {
    return `Claude 를 띄우지 못했다 — ${firstLine(e)}. pane 을 보고(폴더 신뢰 질문 등) 「이어서」`;
  }
}

// 명령 노드 — 엔진 작성자가 적은 명령 한 줄이라 셸로 돌린다(사람이 터미널에 치는 것과 같다). 작업 폴더에서, 실행 폴더 · 작업 문서 · 엔진 사본을 환경 변수로.
function runCommand(r: Run, s: Step, at: string, why: string[]) {
  const log = createWriteStream(join(at, 'output.log'), { mode: 0o600 }), k = pk(r, s.key);
  if (why.length) log.write(`${why.join('\n')}\n\n`);
  const child = shell(s.command!, r.cwd, { ...runEnv(r, s.engine), EDITH_REWIND: join(at, 'rewind.json'), EDITH_LANE: s.track ?? '' }, log);
  procs.set(k, child);
  child.on('close', code => { procs.delete(k); exits.set(k, code ?? 1); });
  r.nodes[s.key].state = 'running';
}
const runEnv = (r: Run, engine: string) => ({ EDITH_RUN: dirOf(r.id), EDITH_WORK: join(dirOf(r.id), 'work'), EDITH_ENGINE: join(dirOf(r.id), 'engine', engine), EDITH_INPUT: r.input, EDITH_UNATTENDED: r.unattended ? '1' : '' });
function shell(command: string, cwd: string, env: Record<string, string>, log: ReturnType<typeof createWriteStream>) {
  const [sh, args] = process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', command]] : [process.env.SHELL || '/bin/sh', ['-c', command]];
  const child = spawn(sh, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  child.on('error', e => log.write(`\n[EDITH] 띄우지 못했다 — ${e.message}\n`));
  child.on('close', () => log.end());
  return child;
}
const queue = (id: number, a: Action) => queued.set(id, [...queued.get(id) ?? [], a]);

// ── 런 단추 — 맨 위 엔진 폴더(사본)의 actions.json [{label, command, ask?, hint?, danger?}] 을 런 화면 단추로. 누르면 명령 노드처럼 작업 폴더의 셸로
// (런 env + ask 로 받은 글은 EDITH_ACTION_TEXT). 끝 코드 0 에 $EDITH_REWIND 가 있으면 되돌린다 — 도는 중이면 도는 노드를 멈추고.
// 목록을 작업 문서가 아니라 엔진 폴더에 두는 것은, 런의 Claude 가 단추를 지어내 사람이 누르게 하지 못하게.
// on: "results" — 옛 결과 화면의 체크 훅(배포 화면이 품은 뒤로 부르지 않는다 — 옛 엔진의 actions.json 을 읽어도 단추로 보이지 않게만). on: "picks" — 새 런 칸의 고르기 목록(runPicks).
// when: "done" — 런이 끝난 뒤에만 보이고 눌린다
// flow — 배포 화면이 단추 설명 앞에 붙이는 브랜치 흐름(「{branch} → origin/{branch}」 — {branch} 원본 · {issue} 이슈 브랜치 · {tail} 원본 끝 토막을 그 줄 브랜치로 채운다)
// ready — 배포 화면이 이 단추를 켜는 조건: 그 브랜치(「merge/{tail}」 — {branch} · {tail})에 원본 최신과 단추 칸(reach 가 브랜치면)이 다 들어 있을 때(src/deploy.ts markWait)
// until — 거꾸로, 그 브랜치에 다 들어 있으면 막는다(이미 한 준비 단추)
// row — 배포 화면이 레포 줄마다 놓는다: 누르면 그 줄 워크트리(런이 남긴 edith-repos.json 의 path)만 EDITH_ACTION_REPO 로 — 명령이 그 레포만 다룬다. 런 화면에서 누르면 레포 전부
// on: "prep" · "cleanup" — 배포 화면 훅(deployHook — 배포 조치 뽑기 · 정리 때 엔진 몫의 일). on: "settings" — 설정 › 엔진 설정 표(src/engineSettings.ts)
export type RunAction = { label: string; command: string; ask?: string; on?: 'results' | 'picks' | 'request' | 'prep' | 'cleanup' | 'settings'; hint?: string; danger?: boolean; when?: 'done'; reach?: string; copy?: boolean; flow?: string; ready?: string; until?: string; row?: boolean };   // hint — 단추에 마우스를 올리면 보이는 설명, danger — 지우는 단추(빨강 · 맨 끝)
// reach — 배포 화면에서 이 단추를 놓을 단계: commit · push · via(먼저 합칠 브랜치) · base(레포마다 기본 브랜치 칸) · 브랜치(edith-repos.json 의 also · base 와 같은 이름 — 예: origin/dev)
// copy — 명령의 출력을 사람이 복사해 직접 돌릴 글로 돌려준다(결과 화면 확인 창 · 런 화면 단추 기록에 복사 단추). 이 명령은 아무것도 바꾸지 않아야 한다 — 바꾸는 일은 사람이 그 글로
// 런 설정 사본(run/)에 단추가 있으면 그것, 없으면 엔진 사본의 것
function allActions(r: Run): RunAction[] {
  const own = join(dirOf(r.id), 'run', 'actions.json');
  return parseActions(() => readFileSync(existsSync(own) ? own : join(dirOf(r.id), 'engine', r.engine, 'actions.json'), 'utf8'));
}
function parseActions(text: () => string): RunAction[] {
  try {
    const a = JSON.parse(text()) as RunAction[];
    return Array.isArray(a) ? a.filter(x => typeof x?.label === 'string' && typeof x.command === 'string' && (x.ask === undefined || typeof x.ask === 'string')
      && (x.on === undefined || ['results', 'picks', 'request', 'prep', 'cleanup', 'settings'].includes(x.on)) && (x.when === undefined || x.when === 'done')
      && (x.reach === undefined || (typeof x.reach === 'string' && /^[\w][\w./-]{0,120}$/.test(x.reach))) && (x.copy === undefined || typeof x.copy === 'boolean') && (x.row === undefined || typeof x.row === 'boolean') && (x.flow === undefined || typeof x.flow === 'string') && [x.ready, x.until].every(t => t === undefined || (typeof t === 'string' && /^[\w{][\w{}./-]{0,120}$/.test(t)))).slice(0, 16) : [];
  } catch { return []; }
}
export const readActions = (r: Run) => allActions(r).filter(x => !x.on).slice(0, 12);
type Acted = { label: string; at: number; text?: string; code: number | null; note?: string; repo?: string };   // repo — 레포 줄 단추로 그 레포만 돌렸으면
const acting = new Set<number>();
// copy 단추면 끝날 때까지 기다려 출력(64KB 까지)과 끝 코드를 돌려준다 — 화면이 그 글을 복사하게
export async function runAction(id: number, n: unknown, text: unknown, repo?: unknown): Promise<{ output?: string; code?: number }> {
  const r = loadRun(id);
  if (!r) throw new Error('없는 런이다');
  const a = typeof n === 'number' ? readActions(r)[n] : undefined;
  if (!a) throw new Error('없는 단추다');
  if (r.state === 'dropped') throw new Error('버린 런이다 — 단추를 쓸 수 없다');
  // 화면은 끝나기 전에 감추지만, 목록 차례(n)가 그대로라 여기서도 막는다
  if (a.when === 'done' && r.state !== 'done') throw new Error(`「${a.label}」 는 런이 끝난 뒤에 쓴다`);
  const t = typeof text === 'string' ? text.trim() : '';
  if (a.ask && !t) throw new Error(`${a.ask} — 글을 넣는다`);
  if (t.length > 4000) throw new Error('글은 4000자까지');
  // 레포 줄 단추 — 그 런이 남긴 레포 칸의 워크트리만 받는다(브라우저가 보낸 경로를 그대로 명령에 넘기지 않게)
  const only = typeof repo === 'string' ? repo : '';
  if (only && (!a.row || !readRefs(join(dirOf(id), 'work')).some(x => x.path === only))) throw new Error('이 런의 레포 줄 단추가 아니다');
  if (acting.has(id)) throw new Error('다른 단추 명령이 도는 중이다');
  acting.add(id);
  const env: Record<string, string> = only ? { EDITH_ACTION_REPO: only } : {};
  if (!a.copy) { launch(r, a, t, env, () => acting.delete(id)); return {}; }
  return new Promise(ok => launch(r, a, t, env, (code, log) => { acting.delete(id); ok({ output: tail(log, 64 * 1024) ?? '', code }); }));
}
// 새 런 칸의 고르기 목록 — 공방 엔진 폴더(사본이 아니라 공방 것) actions.json 의 on: "picks" 명령(예: 일감 목록에서 고르면 입력칸에 그 주소).
// 사람이 「고르기」 를 열 때만 그 엔진 폴더에서 돈다(런이 없다 — 환경 변수는 EDITH_ENGINE · EDITH_WORKSHOP). 표준 출력의 JSON [{label, note?, input}] 만 받는다
export function pickAction(engine: string, on: NonNullable<RunAction['on']> = 'picks'): RunAction | undefined {
  if (!NAME.test(engine)) return undefined;
  try {
    const a = JSON.parse(readFileSync(join(actionsHome(engine), 'actions.json'), 'utf8')) as RunAction[];
    return Array.isArray(a) ? a.find(x => x?.on === on && typeof x.label === 'string' && typeof x.command === 'string') : undefined;
  } catch { return undefined; }
}
// 공방 폴더의 단추 자리 — 그 폴더에 actions.json 이 있으면 거기, 런(kind run)인데 없으면 그 런이 돌릴 엔진 폴더(명령은 그 폴더에서 돈다)
function actionsHome(id: string) {
  const own = join(WORKSHOP, id);
  if (existsSync(join(own, 'actions.json'))) return own;
  try { const e = readEngine(id).engine; if (e?.kind === 'run' && e.engine && NAME.test(e.engine)) return join(WORKSHOP, e.engine); } catch { /* 없음 */ }
  return own;
}
// 공방 화면 — 그 폴더(런이면 단추를 빌려 쓰는 엔진까지)의 단추 목록과 어느 폴더 것인지
export function actionsOf(id: string) {
  if (!NAME.test(id)) return { from: id, list: [] as RunAction[] };
  const home = actionsHome(id);
  return { from: home.slice(WORKSHOP.length + 1), list: parseActions(() => readFileSync(join(home, 'actions.json'), 'utf8')) };
}
// 받은 요청에 답했을 때(열어서 시작 · 거절) — 공방 엔진 actions.json 의 on: "request" 명령을 그 엔진 폴더에서(요청 쪽에 알리는 일 — 대화방 글 등).
// 요청 파일 · 답은 환경 변수로 넘긴다(EDITH_REQUEST_FILE · EDITH_REQUEST_STATE started|rejected · EDITH_REQUEST_RUN · EDITH_REQUEST_REASON). 기다리지 않고, 출력은 log 에
export function requestHook(engine: string, env: Record<string, string>, log: string) {
  const a = pickAction(engine, 'request');
  if (!a) return false;
  const dir = actionsHome(engine);
  shell(a.command, dir, { EDITH_ENGINE: dir, EDITH_WORKSHOP: WORKSHOP, ...env }, createWriteStream(log, { mode: 0o600 }));
  return true;
}
// 배포 화면 훅 — 공방 맨 위 엔진 폴더 actions.json 의 on: "prep"(배포 조치 뽑기) · on: "cleanup"(정리 때 엔진 몫 — 작업 문서 등). 그 on 을 가진 첫 폴더(이름 순)의 것
// shortcut: 엔진 여럿이 같은 훅을 가지면 이름 순 첫 것만 — 엔진마다 달라야 하면 항목에 이어진 런의 엔진으로 고른다
export function deployHook(on: 'prep' | 'cleanup') {
  let names: string[] = [];
  try { names = readdirSync(WORKSHOP, { withFileTypes: true }).filter(d => d.isDirectory() && NAME.test(d.name)).map(d => d.name).sort(); } catch { return undefined; }
  for (const n of names) { const a = pickAction(n, on); if (a) return { dir: actionsHome(n), action: a }; }
  return undefined;
}
// 훅을 그 엔진 폴더의 셸로 — 값은 환경 변수로만 넘긴다(명령 글에 붙이지 않는다). 끝 코드와 표준 출력(1MB 까지)을 돌려주고, 출력 · 오류는 log 파일에 다.
// input 은 표준 입력으로(엔진 설정 저장 — 비밀 값이 프로세스 목록 · log 에 남지 않게)
export function runHook(h: { dir: string; action: RunAction }, env: Record<string, string>, log: string, timeoutMs: number, input?: string): Promise<{ code: number; out: string }> {
  const [cmd, args] = process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', h.action.command]] : [process.env.SHELL || '/bin/sh', ['-c', h.action.command]];
  return new Promise(ok => {
    const w = createWriteStream(log, { mode: 0o600 });
    let out = '', ended = false;
    const end = (code: number) => { if (ended) return; ended = true; w.end(); ok({ code, out }); };
    const child = spawn(cmd, args, { cwd: h.dir, env: { ...process.env, EDITH_ENGINE: h.dir, EDITH_WORKSHOP: WORKSHOP, ...env }, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], timeout: timeoutMs });
    if (input !== undefined) { child.stdin?.on('error', () => { /* 읽기 전에 끝난 명령 */ }); child.stdin?.end(input); }
    child.stdout?.on('data', (d: Buffer) => { if (out.length < 1024 * 1024) out += d; w.write(d); });
    child.stderr?.on('data', (d: Buffer) => w.write(d));
    child.on('error', e => { w.write(`\n[EDITH] 띄우지 못했다 — ${e.message}\n`); end(1); });
    child.on('close', code => end(code ?? 1));
  });
}
// title · tag 가 있으면 고른 런이 받은 요청처럼 그 제목 · 꼬리표를 갖는다(결과 화면 등 — pickRequest)
export type Pick = { label: string; note?: string; input: string; title?: string; tag?: string };
export function parsePicks(t: string): Pick[] {
  let a: unknown;
  try { a = JSON.parse(t); } catch { throw new Error('고르기 명령이 JSON 배열을 내지 않았다'); }
  if (!Array.isArray(a)) throw new Error('고르기 명령이 JSON 배열을 내지 않았다');
  return a.flatMap((x: Record<string, unknown>) => typeof x?.label === 'string' && x.label.trim() && typeof x.input === 'string' && x.input.trim()
    ? [{ label: x.label.trim().slice(0, 200), input: x.input.slice(0, 4000), ...(typeof x.note === 'string' && x.note.trim() ? { note: x.note.trim().slice(0, 120) } : {}),
      ...(typeof x.title === 'string' && x.title.trim() ? { title: x.title.trim().slice(0, 200) } : {}), ...(typeof x.tag === 'string' && x.tag.trim() ? { tag: x.tag.trim().slice(0, 40) } : {}) }] : []).slice(0, 200);
}
// 고르기 목록에서 고른 채로 시작한 런 — 그 제목 · 꼬리표를 받은 요청처럼 작업 문서 edith-request.json 에 둔다(from: 고르기). 제목이 없으면 두지 않는다
export function pickRequest(engine: unknown, input: unknown, p: unknown): Record<string, string> | undefined {
  const x = p as { title?: unknown; tag?: unknown } | null, title = typeof x?.title === 'string' ? x.title.trim().slice(0, 200) : '', tag = typeof x?.tag === 'string' ? x.tag.trim().slice(0, 40) : '';
  return title && typeof engine === 'string' && typeof input === 'string' ? { engine, input, title, ...(tag ? { tag } : {}), from: '고르기' } : undefined;
}
export function runPicks(engine: unknown): Promise<Pick[]> {
  const a = typeof engine === 'string' ? pickAction(engine) : undefined;
  if (!a) return Promise.reject(new Error('이 엔진에는 고르기 목록이 없다'));
  const dir = actionsHome(engine as string), [cmd, args] = process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', a.command]] : [process.env.SHELL || '/bin/sh', ['-c', a.command]];
  return new Promise((ok, no) => {
    const child = spawn(cmd, args, { cwd: dir, env: { ...process.env, EDITH_ENGINE: dir, EDITH_WORKSHOP: WORKSHOP }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
    let out = '', err = '';
    child.stdout.on('data', (d: Buffer) => { out += d; if (out.length > 1024 * 1024) child.kill(); });
    child.stderr.on('data', (d: Buffer) => { err = (err + d).slice(-2000); });
    child.on('error', e => no(e));
    child.on('close', code => {
      if (code !== 0) return no(new Error(`고르기 명령이 끝 코드 ${code ?? '없음'} — ${err.trim().split('\n').at(-1) ?? ''}`));
      try { ok(parsePicks(out)); } catch (e) { no(e); }
    });
  });
}

// 단추 · 결과 반영 명령을 작업 폴더의 셸로 — 기록(actions/<시각>.json · .log)을 남기고, 끝 코드 0 에 되돌림 파일이 있으면 되돌린다.
// done 은 기록 파일을 다 쓴 뒤(끝 코드 · 기록 경로와 함께)
function launch(r: Run, a: RunAction, t: string, env: Record<string, string>, done: (code: number, log: string) => void) {
  const id = r.id, d = join(dirOf(id), 'actions'), at = Date.now(), meta: Acted = { label: a.label, at, ...(t ? { text: t } : {}), ...(env.EDITH_ACTION_REPO ? { repo: env.EDITH_ACTION_REPO } : {}), code: null };
  mkdirSync(d, { recursive: true, mode: 0o700 });
  const put = () => writeFileSync(join(d, `${at}.json`), JSON.stringify(meta), { mode: 0o600 });
  put();
  const back = join(d, `${at}.rewind.json`), file = join(d, `${at}.log`), log = createWriteStream(file, { mode: 0o600 });
  shell(a.command, r.cwd, { ...runEnv(r, r.engine), EDITH_REWIND: back, EDITH_ACTION_TEXT: t, ...env }, log)
    .on('close', code => {
      log.on('close', () => done(code ?? 1, file));   // shell 이 같은 close 에서 log.end() — 파일이 닫힌 뒤에 읽게
      meta.code = code ?? 1;
      let b: ReturnType<typeof parseRewind> | null = null;
      if (code === 0) try { b = parseRewind(readFileSync(back, 'utf8')); } catch { /* 되돌림 없음 */ }
      if (typeof b === 'string') meta.note = b;
      else if (b) {
        const go: Action = { do: 'rewind', to: b.to, by: `단추 「${a.label}」`, reason: b.reason };
        if (driving.has(id)) { queue(id, go); meta.note = `되돌림 → ${b.to}`; }
        else {
          const now = loadRun(id)!;
          apply(now, go);
          meta.note = now.state === 'check' && now.reason ? now.reason : `되돌림 → ${b.to}`;
          saveRun(now);
          if (moving(now)) drive(id);
        }
      }
      put();
    });
}
// 최근 단추 기록 5개 — 화면에 출력 끝과 함께
export function acted(id: number) {   // 최근 단추 기록 5개(최근 것부터) — code null 이면 도는 중. 런 화면 · 배포 화면이 쓴다
  const d = join(dirOf(id), 'actions');
  let files: string[] = [];
  try { files = readdirSync(d).filter(f => /^\d+\.json$/.test(f)).sort().slice(-5).reverse(); } catch { /* 아직 없다 */ }
  return files.flatMap(f => {
    try { const m = JSON.parse(readFileSync(join(d, f), 'utf8')) as Acted; return [{ ...m, output: tail(join(d, `${m.at}.log`), 3000) ?? '' }]; } catch { return []; }
  });
}

// EDITH 가 뜰 때 — 돌던 실행을 이어 간다. 다른 EDITH(다른 포트)가 살아서 잡고 있는 실행은 건드리지 않는다.
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
export function resumeRuns(port: number) {
  ownPort = port;
  setInterval(startQueued, 10_000).unref();
  for (const id of ids()) {
    const r = loadRun(id);
    // 확인 필요여도 다른 갈래가 돌던 런은 이어 간다
    if (!r || (r.state !== 'running' && !(r.state === 'check' && r.steps.some(s => ACTIVE.includes(r.nodes[s.key].state))))) continue;
    if (r.owner && r.owner.pid !== process.pid && alive(r.owner.pid)) continue;
    r.owner = { pid: process.pid, port };
    recover(r);
    unattend(r);
    saveRun(r);
    if (moving(r)) drive(id);
  }
  startQueued();
}
