// 공방 — 노드를 이은 「체인」과 체인을 이은 「엔진」을 만들고 고치는 폴더. 하나가 workshop/<id>/ 하나다:
// engine.json(노드 · 연결 · 위치 — 화면만 쓴다)과 skills/<이름>/SKILL.md(공방 Claude pane 이 쓴다).
// engine.json 을 쓰는 쪽을 화면 하나로 둬서 Claude 와 서로 덮어쓰지 않는다. 경로는 이름 규칙 + realpath 로 공방 폴더 안만 연다.
// 화면 말: 노드 · 체인 · 엔진 · 런(한 번 돌린 것). 코드의 engine(Engine · engine.json)은 체인과 엔진을 함께 가리키고 kind 로 가른다 —
// 체인은 스킬 · 명령 노드만, 엔진은 다른 체인 · 엔진을 부르는 노드(node.engine)도 넣는다. 종류는 만들 때 정한다.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, REPO } from './config.ts';
import { describe } from './complete.ts';
import { newWorkspace, snapshot, start } from './herdr.ts';

export const ROOT = join(DATA_DIR, 'workshop');
// 엔진 폴더 · 노드 id · 엔진 스킬 이름 — 경로 한 칸으로만 쓰이게 영문 소문자 · 숫자 · - 만
export const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

export type SkillRef = { from: 'engine' | 'installed'; id: string };
// 노드는 셋 중 하나를 가리킨다 — 스킬(Claude 가 한다), 명령(실행기가 돌린다), 다른 엔진(그 자리에서 그 엔진의 노드들이 돈다). 아무것도 없으면 빈 노드.
export type Node = { id: string; title: string; skill: SkillRef | null; command?: string; engine?: string; x: number; y: number };
// 실패 화살표 — from 이 실패하면 to(고치는 노드)를 돌리고 from 을 다시 돌린다. 최대 max 번.
export type Edge = { from: string; to: string; fail?: true; max?: number };
// 작업 폴더 — 실행할 때 고르기(기본) · 늘 같은 폴더 · 레포에서 새 워크트리(브랜치는 실행할 때). 실행하는 맨 바깥 엔진의 것만 쓴다.
export type Workdir = { kind: 'ask' } | { kind: 'fixed'; dir: string } | { kind: 'worktree'; repo: string; base?: string };
// common — 이 엔진의 모든 스킬 노드 지시 앞에 같이 붙는 스킬(공통 규칙). kind 가 없으면 체인(check 는 늘 채운다).
export type Engine = { name: string; kind?: 'chain' | 'engine'; nodes: Node[]; edges: Edge[]; common?: SkillRef; workdir?: Workdir };
// 브랜치 이름 — 인자로만 넘기지만 git 이 받는 꼴로 미리 거른다(- 로 시작 · .. 금지)
export const BRANCH = /^(?!-)(?!.*\.\.)[\p{L}\p{N}._/-]{1,100}$/u;

const path = (v: unknown) => typeof v === 'string' && v.length <= 500 && !/[\x00-\x1f]/.test(v);   // 쓰는 중이면 빈 칸도 둔다 — 실행할 때 거른다
const text = (v: unknown, max: number) => typeof v === 'string' && v.trim() !== '' && v.length <= max && !/[\x00-\x1f]/.test(v);
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e6;
const skillRef = (v: unknown): SkillRef | null | undefined => {
  const s = v as Record<string, unknown> | null | undefined;
  return s == null ? null
    : s.from === 'engine' && typeof s.id === 'string' && NAME.test(s.id) ? { from: 'engine', id: s.id }
    : s.from === 'installed' && text(s.id, 200) ? { from: 'installed', id: s.id as string } : undefined;
};

// 형식 검사 — 맞으면 아는 칸만 남긴 엔진, 틀리면 사람이 읽을 사유 목록
export function check(v: unknown): Engine | string[] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return ['engine.json 이 객체가 아니다'];
  const e = v as Record<string, unknown>, errs: string[] = [];
  if (!text(e.name, 100)) errs.push('name 은 1~100자 한 줄 글');
  const common = skillRef(e.common);
  if (common === undefined) errs.push('common 은 null 또는 { from: engine|installed, id }');
  const w = e.workdir as Record<string, unknown> | null | undefined;
  const workdir: Workdir | undefined | null = w == null || w.kind === 'ask' ? undefined
    : w.kind === 'fixed' && path(w.dir) ? { kind: 'fixed', dir: (w.dir as string).trim() }
    : w.kind === 'worktree' && path(w.repo) && (w.base == null || w.base === '' || (typeof w.base === 'string' && BRANCH.test(w.base)))
      ? { kind: 'worktree', repo: (w.repo as string).trim(), ...(w.base ? { base: w.base as string } : {}) } : null;
  if (workdir === null) errs.push('workdir 는 { kind: ask } · { kind: fixed, dir } · { kind: worktree, repo, base? }');
  if (!Array.isArray(e.nodes) || e.nodes.length > 200) return [...errs, 'nodes 는 200개까지의 배열'];
  if (!Array.isArray(e.edges) || e.edges.length > 1000) return [...errs, 'edges 는 1000개까지의 배열'];
  const nodes: Node[] = [];
  e.nodes.forEach((raw: unknown, i) => {
    const n = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>, at = `${i + 1}번째 노드`;
    if (typeof n.id !== 'string' || !NAME.test(n.id)) return errs.push(`${at}의 id 는 영문 소문자 · 숫자 · - 만(40자까지)`);
    if (nodes.some(x => x.id === n.id)) return errs.push(`${at}의 id ${n.id} 가 겹친다`);
    if (!text(n.title, 100)) return errs.push(`${at}(${n.id})의 title 은 1~100자 한 줄 글`);
    if (!num(n.x) || !num(n.y)) return errs.push(`${at}(${n.id})의 x · y 가 숫자가 아니다`);
    const skill = skillRef(n.skill);
    if (skill === undefined) return errs.push(`${at}(${n.id})의 skill 은 null 또는 { from: engine|installed, id }`);
    if (n.command != null && n.command !== '' && !text(n.command, 500)) return errs.push(`${at}(${n.id})의 command 는 500자까지 한 줄`);
    if (n.engine != null && n.engine !== '' && (typeof n.engine !== 'string' || !NAME.test(n.engine))) return errs.push(`${at}(${n.id})의 engine 은 체인 폴더 이름`);
    const command = n.command ? (n.command as string).trim() : undefined, engine = (n.engine as string) || undefined;
    if ([skill, command, engine].filter(Boolean).length > 1) return errs.push(`${at}(${n.id})는 스킬 · 명령 · 체인 중 하나만 가리킨다`);
    nodes.push({ id: n.id, title: n.title as string, skill, ...(command ? { command } : {}), ...(engine ? { engine } : {}), x: n.x as number, y: n.y as number });
  });
  const byId = new Map(nodes.map(n => [n.id, n])), edges: Edge[] = [];
  e.edges.forEach((raw: unknown, i) => {
    const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>, at = `${i + 1}번째 연결`;
    if (typeof d.from !== 'string' || typeof d.to !== 'string' || !byId.has(d.from) || !byId.has(d.to)) return errs.push(`${at}의 from · to 가 없는 노드다`);
    if (d.from === d.to) return errs.push(`${at}이 자기 자신을 가리킨다`);
    if (edges.some(x => x.from === d.from && x.to === d.to)) return errs.push(`${at}(${d.from} → ${d.to})이 겹친다`);
    if (d.fail !== true) return edges.push({ from: d.from, to: d.to });
    const max = Number.isInteger(d.max) && (d.max as number) >= 1 && (d.max as number) <= 9 ? d.max as number : 3;
    edges.push({ from: d.from, to: d.to, fail: true, max });
  });
  // 종류 — 없으면(종류를 적기 전 파일) 노드로 정한다
  if (e.kind != null && e.kind !== 'chain' && e.kind !== 'engine') errs.push('kind 는 chain 또는 engine');
  const kind = e.kind === 'chain' || e.kind === 'engine' ? e.kind : nodes.some(n => n.engine) ? 'engine' : 'chain';
  if (kind === 'chain') for (const n of nodes) if (n.engine) errs.push(`노드 ${n.id}: 체인에는 다른 체인 · 엔진을 넣지 않는다 — 엔진을 만들어 거기에 넣는다`);
  if (errs.length) return errs;
  // 실패 화살표 — 스킬 · 명령 노드끼리만, 노드마다 하나, 고치는 노드는 실패 화살표로만 들어오고 나가는 화살표가 없다
  for (const f of edges.filter(x => x.fail)) {
    const at = `실패 화살표 ${f.from} → ${f.to}`;
    if (byId.get(f.from)!.engine || byId.get(f.to)!.engine) errs.push(`${at}: 체인 · 엔진 노드에는 실패 화살표를 잇지 않는다`);
    if (edges.filter(x => x.fail && x.from === f.from).length > 1) errs.push(`${at}: 한 노드에서 실패 화살표는 하나만`);
    if (edges.some(x => !x.fail && x.to === f.to)) errs.push(`${at}: 고치는 노드(${f.to})에는 보통 화살표가 들어오지 않는다`);
    if (edges.some(x => x.from === f.to)) errs.push(`${at}: 고치는 노드(${f.to})에서는 화살표가 나가지 않는다`);
  }
  // 보통 화살표는 고리를 만들지 않는다 — 되돌아가는 길은 실패 화살표로
  const left = new Map(nodes.map(n => [n.id, edges.filter(x => !x.fail && x.to === n.id).length])), queue = nodes.filter(n => !left.get(n.id)).map(n => n.id);
  for (let i = 0; i < queue.length; i++) for (const x of edges.filter(x => !x.fail && x.from === queue[i])) if (left.set(x.to, left.get(x.to)! - 1).get(x.to) === 0) queue.push(x.to);
  if (queue.length < nodes.length) errs.push('화살표가 고리를 만든다 — 되돌아가는 길은 「실패하면」 화살표로 잇는다');
  return errs.length ? [...new Set(errs)] : { name: (e.name as string).trim(), kind, nodes, edges, ...(common ? { common } : {}), ...(workdir ? { workdir } : {}) };
}

// 엔진 폴더 — 이름 규칙을 지나고, 있으면 실제 위치도 공방 폴더 바로 아래여야 한다(링크로 밖을 가리키지 않게)
function dir(root: string, id: string) {
  if (!NAME.test(id)) throw new Error(`폴더 이름이 아니다: ${id}`);
  const d = join(root, id);
  if (existsSync(d) && realpathSync(d) !== join(realpathSync(root), id)) throw new Error(`공방 폴더 밖을 가리킨다: ${id}`);
  return d;
}

// 엔진 스킬 — skills/<이름>/SKILL.md 가 있는 것만(폴더만 막 생긴 것은 아직 아니다). 링크로 skills 밖을 가리키면 뺀다.
function engineSkills(d: string) {
  const s = join(d, 'skills');
  try { if (realpathSync(s) !== join(realpathSync(d), 'skills')) return []; } catch { return []; }
  return readdirSync(s).filter(n => NAME.test(n)).sort().flatMap(n => {
    const md = join(s, n, 'SKILL.md');
    try { if (realpathSync(join(s, n)) !== join(realpathSync(s), n) || !statSync(md).isFile()) return []; } catch { return []; }
    return [{ id: n, desc: describe(md) }];
  });
}

const version = (t: string) => createHash('sha1').update(t).digest('hex').slice(0, 16);

// 엔진 하나 — 형식이 깨졌으면 engine 없이 사유만(화면이 그대로 보여 준다)
export function readEngine(id: string, root = ROOT) {
  const d = dir(root, id), t = readFileSync(join(d, 'engine.json'), 'utf8');
  let r: Engine | string[];
  try { r = check(JSON.parse(t)); } catch (e) { r = [`engine.json 이 JSON 이 아니다 — ${(e as Error).message}`]; }
  const engine = Array.isArray(r) ? null : r;
  return { id, engine, errors: Array.isArray(r) ? r : [], version: version(t), skills: engineSkills(d), draft: draftOf(d, engine) };
}

// 초안 — 공방 Claude 가 쓰는 <엔진>/draft.json(engine.json 과 같은 모양, x · y 는 없어도 된다). 화면이 미리 보고 「적용」 하면 engine.json 이 된다.
// 링크(밖을 가리킬 수 있는)는 읽지 않는다.
function draftOf(d: string, cur: Engine | null) {
  const f = join(d, 'draft.json');
  try { if (!lstatSync(f).isFile()) return null; } catch { return null; }
  let r: Engine | string[];
  try { r = check(place(JSON.parse(readFileSync(f, 'utf8')), cur)); } catch (e) { r = [`draft.json 이 JSON 이 아니다 — ${(e as Error).message}`]; }
  return Array.isArray(r) ? { engine: null, errors: r } : { engine: r, errors: [] };
}
// 초안 자리 — 이름 · 종류가 없으면 지금 것, x · y 가 없는 노드는 지금 엔진의 같은 노드 자리, 그것도 없으면 화살표 깊이로 줄을 세운다(고치는 노드는 고칠 노드 줄에)
export function place(raw: unknown, cur: Engine | null): unknown {
  const e = raw as { name?: unknown; kind?: unknown; nodes?: unknown; edges?: unknown } | null;
  if (!e || typeof e !== 'object' || !Array.isArray(e.nodes)) return raw;
  const edges = (Array.isArray(e.edges) ? e.edges : []) as { from?: unknown; to?: unknown; fail?: unknown }[];
  const depth = new Map<unknown, number>(), row = new Map<number, number>();
  const deep = (id: unknown, seen: unknown[] = []): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.includes(id)) return 0;
    const ins = edges.filter(x => x.to === id && !x.fail).map(x => x.from);
    const k = ins.length ? Math.max(...ins.map(i => deep(i, [...seen, id]) + 1)) : 0;
    depth.set(id, k);
    return k;
  };
  const nodes = (e.nodes as unknown[]).map(n0 => {
    const n = (n0 && typeof n0 === 'object' ? n0 : {}) as Record<string, unknown>;
    if (num(n.x) && num(n.y)) return n;
    const old = cur?.nodes.find(x => x.id === n.id);
    if (old) return { ...n, x: old.x, y: old.y };
    const k = deep(edges.find(x => x.fail && x.to === n.id)?.from ?? n.id), r = row.get(k) ?? 0;
    row.set(k, r + 1);
    return { ...n, x: k * 260, y: r * 120 };
  });
  return { ...e, name: e.name ?? cur?.name, kind: e.kind ?? cur?.kind, nodes };
}
export function applyDraft(id: string, ver: unknown, root = ROOT) {
  const d = dir(root, id), r = readEngine(id, root);
  if (!r.draft) throw new Error('초안이 없다');
  if (!r.draft.engine) throw new Error(r.draft.errors.join(' · '));
  saveEngine(id, r.draft.engine, ver, root);
  rmSync(join(d, 'draft.json'), { force: true });
  return readEngine(id, root);
}
export function discardDraft(id: string, root = ROOT) {
  rmSync(join(dir(root, id), 'draft.json'), { force: true });
  return readEngine(id, root);
}

// uses — 이 엔진의 노드가 부르는 체인 · 엔진(노드 순서). 화면 목록이 이것으로 트리를 짠다.
// 이름 · uses 는 초안이 있으면 초안 것(적용하면 그렇게 된다 — 목록이 지금 만드는 모양을 보인다). 노드 수 · 종류는 적용된 것.
export function listEngines(root = ROOT) {
  let ids: string[] = [];
  try { ids = readdirSync(root).filter(f => NAME.test(f)).sort(); } catch { /* 아직 없음 */ }
  return ids.flatMap(id => {
    try {
      const r = readEngine(id, root), show = r.draft?.engine ?? r.engine;
      return [{ id, name: show?.name ?? id, nodes: r.engine?.nodes.length ?? 0, kind: r.engine?.kind ?? 'chain', broken: !r.engine, uses: show?.nodes.flatMap(n => n.engine ? [n.engine] : []) ?? [], draft: !!r.draft }];
    } catch { return []; }
  });
}

// 임시 파일에 쓰고 이름을 바꾼다 — 중간에 끊겨도 반쯤 쓴 engine.json 이 남지 않게
function write(file: string, e: Engine) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(e, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}

export function createEngine(id: unknown, name: unknown, kind: unknown, root = ROOT) {
  if (typeof id !== 'string' || !NAME.test(id) || id === 'claude') throw new Error('폴더 이름은 영문 소문자 · 숫자 · - 만(40자까지)');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const d = dir(root, id);
  if (existsSync(d)) throw new Error(`같은 폴더 이름이 이미 있다: ${id}`);
  const e = check({ name, kind, nodes: [], edges: [] });
  if (Array.isArray(e)) throw new Error(e[0]);
  mkdirSync(join(d, 'skills'), { recursive: true, mode: 0o700 });
  write(join(d, 'engine.json'), e);
  return readEngine(id, root);
}

// 저장 — 화면이 읽은 판(version)이 지금 파일과 같을 때만. 다르면 거절하고 화면이 다시 읽는다.
export function saveEngine(id: string, engine: unknown, ver: unknown, root = ROOT) {
  const d = dir(root, id), file = join(d, 'engine.json');
  if (ver !== version(readFileSync(file, 'utf8'))) throw new Error('다른 곳에서 engine.json 이 바뀌었다 — 다시 읽었다');
  const e = check(engine);
  if (Array.isArray(e)) throw new Error(e.join(' · '));
  const cyc = loop(root, id, e);
  if (cyc) throw new Error(`체인이 서로를 부르는 고리가 생긴다 — ${cyc.join(' → ')}`);
  write(file, e);
  return readEngine(id, root);
}

// 고리 — 체인 · 엔진 노드를 따라 들어가다 저장하려는 엔진에 다시 닿으면 그 길(끝없이 펼쳐진다). 없는 엔진은 실행할 때 거절한다.
export function loop(root: string, id: string, e: Engine): string[] | null {
  const walk = (cur: Engine, path: string[]): string[] | null => {
    for (const n of cur.nodes) {
      if (!n.engine) continue;
      if (n.engine === id) return [...path, id];
      if (path.includes(n.engine)) continue;
      let inner: Engine | null = null;
      try { const r = check(JSON.parse(readFileSync(join(dir(root, n.engine), 'engine.json'), 'utf8'))); inner = Array.isArray(r) ? null : r; } catch { /* 없음 */ }
      const hit = inner && walk(inner, [...path, n.engine]);
      if (hit) return hit;
    }
    return null;
  };
  return walk(e, [id]);
}

// 지우기 — 다른 엔진이 노드로 쓰고 있으면 거절한다(그 노드가 「없는 체인」 이 된다).
// 폴더는 없애지 않고 휴지통(workshop-trash/<id>-<시각>)으로 옮긴다 — 되살리려면 공방 폴더로 다시 옮긴다. 지난 런은 자기 사본으로 남는다.
export const TRASH = join(DATA_DIR, 'workshop-trash');
export function removeEngine(id: string, root = ROOT, trash = TRASH) {
  const d = dir(root, id);
  if (!existsSync(join(d, 'engine.json'))) throw new Error('공방에 없다');
  const users = listEngines(root).filter(e => e.id !== id && readEngine(e.id, root).engine?.nodes.some(n => n.engine === id)).map(e => `「${e.name}」`);
  if (users.length) throw new Error(`이것을 쓰는 엔진이 있다 — ${users.join(' · ')} 에서 이것을 부르는 노드를 먼저 지운다`);
  mkdirSync(trash, { recursive: true, mode: 0o700 });
  const to = join(trash, `${id}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  renameSync(d, to);
  return to;
}

// 공방 Claude — herdr 「공방」 워크스페이스의 Claude pane. 화면을 열 때는 찾기만 하고, 띄우기는 사람이 누를 때만.
export const LABEL = '공방';
export async function findClaude() {
  const s = await snapshot();
  const ws = (s.workspaces as { workspace_id: string; label: string }[]).filter(w => w.label === LABEL).map(w => w.workspace_id);
  return s.panes.find(p => ws.includes(p.workspace) && p.agent === 'claude')?.id ?? null;
}
// 없으면 공방 폴더에서 띄운다 — 「공방」 워크스페이스에 셸만 남았으면 거기서, 없으면 새로. 안내(CLAUDE.md)는 없을 때만 쓴다.
export async function ensureClaude(root = ROOT) {
  const found = await findClaude();
  if (found) return found;
  mkdirSync(root, { recursive: true, mode: 0o700 });
  syncGuide(root);
  const s = await snapshot();
  const ws = (s.workspaces as { workspace_id: string; label: string }[]).filter(w => w.label === LABEL).map(w => w.workspace_id);
  const id = s.panes.find(p => ws.includes(p.workspace) && !p.agent)?.id ?? await newWorkspace(LABEL, root);
  await start(id, 'claude');
  return id;
}

// 공방 Claude 안내(공방 폴더 CLAUDE.md) — EDITH 가 맡는 파일이라 내용이 다르면 새로 쓴다(EDITH 를 업데이트하면 안내도 바뀐다).
// 체인 · 엔진 만드는 법(만들기 스킬)은 EDITH 레포 workshop/engine-skill.md 에 있고 이 안내가 경로로 가리킨다 — 공방 Claude 만 쓴다(플러그인 아님).
export function syncGuide(root = ROOT) {
  if (!existsSync(root)) return;
  const f = join(root, 'CLAUDE.md'), g = guide();
  try { if (readFileSync(f, 'utf8') === g) return; } catch { /* 없음 */ }
  writeFileSync(f, g, { mode: 0o600 });
}
const guide = () => `# 공방 — EDITH 가 띄운 Claude 에게

이 파일은 EDITH 가 맡는다 — 고쳐도 EDITH 가 다시 쓴다. 내 규칙은 같은 폴더의 \`CLAUDE.local.md\` 에 둔다.

여기는 EDITH 「공방」 폴더다. 말: **노드**(일 하나) · **체인**(노드를 이은 것) · **엔진**(체인 · 엔진을 이은 것) · **런**(체인이나 엔진을 한 번 돌린 것).
체인 · 엔진 하나가 하위 폴더 하나다(파일 꼴은 같다 — \`engine.json\` 의 \`kind\` 로 가른다. 체인은 스킬 · 명령 노드만, 엔진은 체인 · 엔진도 넣는다).

- \`<폴더>/engine.json\` — 노드 · 화살표 · 위치. **EDITH 화면만 쓴다. 고치지 않는다.**
- 체인이나 엔진을 만들거나 고쳐 달라면, 노드가 쓸 스킬을 써 달라면 **만들기 스킬** \`${join(REPO, 'workshop', 'engine-skill.md')}\` 를 먼저 읽고 그대로 한다.
  사용자에게 물어 → \`<폴더>/skills/<이름>/SKILL.md\` 를 쓰고 → 초안 \`<폴더>/draft.json\` 을 쓴다. 사용자가 EDITH 화면에서 미리 보고 「적용」 한다.
`;
