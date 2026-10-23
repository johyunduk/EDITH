// 공방 「흐름 지도」 — 엔진을 단계 칸과 줄로 본다(펼치기는 「펼쳐 보기」 와 같은 flatten). 읽기만 한다.
// 맨 위 엔진 폴더의 map.json 이 있으면 칸 · 갈래 · 줄 이름 · 역할 · 설명 · 지시 파일을 그대로 따르고, 없으면 맨 위 노드마다 한 칸
// (스킬 = Claude, 명령 = 자동 검사, 고치는 노드는 숨김, 설명은 SKILL.md 의 description, 지시는 그 SKILL.md).
// map.json — {"summary", "phases": [{"name", "nodes"?: [맨 위 노드 id], "lanes"?: [{"name", "nodes"}]}], "hide"?: ["<노드가 든 폴더>/<노드 id>"], "rest"?: "hidden",
//   (hide 가 있으면 거기 든 노드만 숨기고 나머지는 보인다 — 캔버스에서 더한 노드가 map.json 을 고치기 전에도 보이게. 없으면 rest: "hidden" 일 때 nodes 에 없는 노드를 숨긴다)
//   "fold"?: {"<엔진 폴더>": {"title", "role", "tag"?, "desc"?}}, "nodes": {"<노드가 든 폴더>/<노드 id>": {"role", "tag"?, "desc"?, "instr"?: [공방 폴더 기준 경로]}}}
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { previewSteps, type Step } from './runner.ts';
import { readEngine, ROOT, type Engine } from './workshop.ts';

export type Role = 'claude' | 'check' | 'human' | 'wait';
export type File = { path: string; rel?: string };   // path = 보이는 경로(공방 폴더 기준, 밖이면 ~), rel = 공방 폴더 안이면 「전체 보기」 로 읽을 경로
export type Row = {
  id: string; title: string; role: Role; tag?: string; desc?: string; keys: string[]; engine: string;
  skill?: File; command?: string; files: File[]; excerpt?: string; fail?: string; prev: string[]; next: string[]; inner?: number;
};
export type Phase = { name: string; groups: { label: string; rows: Row[] }[]; hidden: string[] };
type Spec = { role?: Role; tag?: string; desc?: string; title?: string; instr?: string[] };
type Read = (abs: string) => string | null;

const ROLES: Role[] = ['claude', 'check', 'human', 'wait'];
const str = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : undefined;
const obj = (v: unknown) => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const spec = (v: unknown): Spec | null => {
  const o = obj(v);
  return o && { role: ROLES.includes(o.role as Role) ? o.role as Role : undefined, tag: str(o.tag), desc: str(o.desc), title: str(o.title),
    instr: Array.isArray(o.instr) ? o.instr.filter((x): x is string => typeof x === 'string').slice(0, 8) : undefined };
};
const ids = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

// SKILL.md 앞부분 — 머리(frontmatter)를 떼고 빈 줄 빼고 n줄, 긴 줄은 자른다
export function excerpt(text: string, n = 8) {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').split(/\r?\n/).filter(l => l.trim()).slice(0, n)
    .map(l => l.length > 160 ? `${l.slice(0, 159)}…` : l).join('\n');
}
export const description = (text: string) =>
  text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1].match(/^description:\s*(.+)$/m)?.[1].trim().replace(/^(["'])(.*)\1$/, '$2') || undefined;

// 펼친 노드 + 맨 위 엔진 + map.json → 칸 · 줄. inside(키) = 그 노드를 품은 엔진 폴더들(바깥부터), inRoot(절대 경로) = 공방 폴더 안인가
export function buildMap(steps: Step[], top: Engine, raw: unknown, inside: (key: string) => string[], read: Read, root: string, inRoot: (abs: string) => boolean) {
  const m = obj(raw), nodes = obj(m?.nodes) ?? {}, folds = obj(m?.fold) ?? {}, hide = Array.isArray(m?.hide) ? new Set(ids(m!.hide)) : null, hideRest = m?.rest === 'hidden';
  const by = new Map(steps.map(s => [s.key, s])), tail = (k: string) => k.slice(k.lastIndexOf('.') + 1), topOf = (k: string) => k.split('.')[0];
  const show = (abs: string): File => inRoot(abs) ? { path: relative(root, abs), rel: relative(root, abs) } : { path: abs.replace(homedir(), '~') };
  const fileOf = (p: string) => { const abs = join(root, p); return !isAbsolute(p) && inRoot(abs) ? abs : null; };

  // 칸 자리 — map 의 칸 · 갈래에 놓인 맨 위 노드, 없는 맨 위 노드는 뒤에 노드마다 한 칸(map 이 없으면 모두 그렇게)
  const phases: (Phase & { place: Map<string, string> })[] = [];
  for (const p of Array.isArray(m?.phases) ? m!.phases as unknown[] : []) {
    const o = obj(p), name = str(o?.name);
    if (!o || !name) continue;
    const place = new Map<string, string>();
    for (const n of ids(o.nodes)) place.set(n, '');
    for (const l of Array.isArray(o.lanes) ? o.lanes : []) { const lo = obj(l); for (const n of ids(lo?.nodes)) place.set(n, str(lo?.name) ?? ''); }
    phases.push({ name, groups: [], hidden: [], place });
  }
  const phaseOf = (s: Step) => {
    const t = topOf(s.key), hit = phases.find(p => p.place.has(t));
    if (hit) return { p: hit, label: hit.place.get(t)! };
    let p = phases.find(x => x.name === `\0${t}`);   // \0 + 맨 위 노드 id — 이름은 끝에 그 노드 제목으로
    if (!p) phases.push(p = { name: `\0${t}`, groups: [], hidden: [], place: new Map() });
    return { p, label: m ? '' : s.track ?? '' };
  };
  const group = (p: Phase, label: string) => { let g = p.groups.find(x => x.label === label); if (!g) p.groups.push(g = { label, rows: [] }); return g; };

  const rows: Row[] = [], rep = new Map<string, string>(), inner = new Map<string, number>();
  for (const s of steps) {
    const { p, label } = phaseOf(s);
    // 접는 폴더 안 노드는 그 폴더의 줄 하나로(처음 나온 자리에)
    const f = inside(s.key).find(e => obj(folds[e]));
    if (f) {
      const id = `fold:${f}`, fs = spec(folds[f])!;
      rep.set(s.key, id); inner.set(id, (inner.get(id) ?? 0) + 1);
      const row = rows.find(r => r.id === id);
      if (row) { row.keys.push(s.key); continue; }
      const r: Row = { id, title: fs.title ?? f, role: fs.role ?? 'claude', tag: fs.tag, desc: fs.desc, keys: [s.key], engine: f, files: [], prev: [], next: [] };
      rows.push(r); group(p, label).rows.push(r);
      continue;
    }
    const k = `${s.engine}/${tail(s.key)}`, sp = spec(nodes[k]);
    if (hide ? hide.has(k) || (!sp && s.fixOnly) : !sp && (s.fixOnly || hideRest)) { p.hidden.push(s.title); continue; }
    const text = s.skill ? read(s.skill) : null, instr = (sp?.instr ?? []).map(fileOf).filter((x): x is string => !!x);
    const files = instr.length ? instr : s.skill ? [s.skill] : [], last = files.at(-1), body = last ? read(last) : null;
    const role = sp?.role ?? (s.kind === 'command' ? 'check' : 'claude');
    const r: Row = {
      id: s.key, title: s.title, role, tag: sp?.tag, desc: sp?.desc ?? (text ? description(text) : undefined), keys: [s.key], engine: s.engine,
      ...(s.skill ? { skill: show(s.skill) } : {}), ...(s.command ? { command: s.command } : {}), files: files.map(show),
      excerpt: role === 'check' && s.command ? `$ ${s.command}` : body ? excerpt(body) : s.command ? `$ ${s.command}` : undefined,
      ...(s.failTo ? { fail: by.get(s.failTo)?.title ?? s.failTo } : {}), prev: [], next: [],
    };
    rep.set(s.key, r.id); rows.push(r); group(p, label).rows.push(r);
  }
  for (const r of rows) if (inner.has(r.id)) r.inner = inner.get(r.id);

  // 흐름 — 앞 · 다음은 보이는 줄끼리(숨긴 노드는 건너 그 앞으로, 접은 줄 안쪽끼리는 빼고)
  const memo = new Map<string, string[]>();
  const before = (k: string): string[] => {
    if (memo.has(k)) return memo.get(k)!;
    memo.set(k, []);
    const out = new Set<string>();
    for (const d of by.get(k)?.deps ?? []) { const r = rep.get(d); if (r) out.add(r); else for (const x of before(d)) out.add(x); }
    memo.set(k, [...out]);
    return memo.get(k)!;
  };
  for (const r of rows) r.prev = [...new Set(r.keys.flatMap(before))].filter(x => x !== r.id);
  for (const r of rows) r.next = rows.filter(x => x.prev.includes(r.id)).map(x => x.id);

  // 숨긴 노드 — 칸마다 이름(같은 이름은 수로 묶어), 접은 줄 안쪽 수도
  const count = (xs: string[]) => [...new Set(xs)].map(x => { const n = xs.filter(y => y === x).length; return n > 1 ? `${x} ${n}` : x; });
  const out: Phase[] = phases.filter(p => p.groups.length || p.hidden.length).map(p => ({
    name: p.name.startsWith('\0') ? top.nodes.find(n => n.id === p.name.slice(1))?.title ?? p.name.slice(1) : p.name,
    groups: p.groups, hidden: [...count(p.hidden), ...p.groups.flatMap(g => g.rows.filter(r => r.inner).map(r => `「${r.title}」 안쪽 ${r.inner}`))],
  }));
  const hidden = phases.reduce((a, p) => a + p.hidden.length, 0) + [...inner.values()].reduce((a, n) => a + n, 0);
  return { summary: str(m?.summary), phases: out, hidden, mapped: !!m };
}

// 공방 엔진 하나의 흐름 지도 — 초안이 있으면 초안 짜임(펼쳐 보기와 같게)
export function engineMap(id: string, root = ROOT) {
  const p = previewSteps(id, root, true);
  if (p.errors.length) return { summary: undefined, phases: [], hidden: 0, mapped: false, errors: p.errors, draft: p.draft };
  const load = (e: string) => { try { const r = readEngine(e, root); return r.draft?.engine ?? r.engine; } catch { return null; } };
  // 노드 키 앞마디 → 그 자리의 엔진 폴더 — fold 가 「그 폴더에서 나온 노드」 를 찾는다
  const at: [string, string][] = [];
  const walk = (e: string, prefix: string, seen: string[]) => {
    for (const n of load(e)?.nodes ?? []) if (n.engine && !seen.includes(n.engine)) { at.push([`${prefix}${n.id}.`, n.engine]); walk(n.engine, `${prefix}${n.id}.`, [...seen, n.engine]); }
  };
  walk(id, '', [id]);
  const inside = (key: string) => at.filter(([x]) => key.startsWith(x)).sort((a, b) => a[0].length - b[0].length).map(([, e]) => e);
  let raw: unknown = null;
  try { raw = JSON.parse(readFileSync(join(root, id, 'map.json'), 'utf8')); } catch { /* 없거나 깨졌으면 기본 지도 */ }
  const base = realpathSync(root), inRoot = (abs: string) => { try { return realpathSync(abs).startsWith(base + sep); } catch { return false; } };
  const read: Read = f => { try { return readFileSync(f, 'utf8').slice(0, 200_000); } catch { return null; } };
  return { ...buildMap(p.steps, load(id)!, raw, inside, read, root, inRoot), errors: [], draft: p.draft };
}

// 「전체 보기」 — 공방 폴더 안 파일만(브라우저가 보낸 경로라 realpath 뒤 확인), 1MB 까지
export function workshopFile(rel: string, root = ROOT) {
  try {
    const base = realpathSync(root), f = realpathSync(join(base, rel));
    if (!f.startsWith(base + sep) || !statSync(f).isFile() || statSync(f).size > 1_000_000) return null;
    return readFileSync(f, 'utf8');
  } catch { return null; }
}
