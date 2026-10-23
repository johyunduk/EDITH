// 결과 — 런이 남긴 할 일 묶음을 모든 런에 걸쳐 태그(안건)로 모아 본다(화면 「결과」). 엔진(스킬 · 명령 노드)이 작업 문서에 edith-results.json 을 쓴다:
// [{"tag": "<안건>", "title": "<제목>", "note"?: "<메모>", "items": [{"text": "<할 일>", "done": false, "group"?: "<묶음 — 예: stage · prod>"}]}]
// 화면은 할 일 체크만 바꾼다 — 누를 때마다 새로 읽어 그 제목 · 할 일을 글로 찾고, 화면이 본 상태(was)와 같을 때만(엔진이 그사이 다시 썼으면 고치지 않는다).
import { readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { listRuns, RUNS } from './runner.ts';

export const RESULTS_FILE = 'edith-results.json';
export type Result = { tag: string; title: string; note?: string; items: { text: string; done: boolean; group?: string }[] };
type Raw = { tag?: unknown; title?: unknown; note?: unknown; items?: { text?: unknown; done?: unknown; group?: unknown }[] };

// 런 폴더 안의 결과 파일 — 링크로 런 폴더 밖을 가리키면 없는 것으로
function fileOf(id: number) {
  try {
    const base = realpathSync(join(RUNS, String(id))), f = realpathSync(join(base, 'work', RESULTS_FILE));
    return f.startsWith(base + sep) ? f : null;
  } catch { return null; }
}
const text = (v: unknown, n: number) => typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined;
// 틀린 묶음 · 할 일은 빼고 읽는다(파일이 깨졌으면 빈 것)
export function parseResults(t: string): Result[] {
  let a: unknown;
  try { a = JSON.parse(t); } catch { return []; }
  if (!Array.isArray(a)) return [];
  return (a as Raw[]).flatMap(r => {
    const title = text(r?.title, 200);
    if (!title || !Array.isArray(r.items)) return [];
    const items = r.items.flatMap(i => typeof i?.text === 'string' && i.text.trim()
      ? [{ text: i.text.slice(0, 1000), done: i.done === true, ...(text(i.group, 50) ? { group: text(i.group, 50) } : {}) }] : []);
    return [{ tag: text(r.tag, 100) ?? '', title, ...(text(r.note, 2000) ? { note: text(r.note, 2000) } : {}), items }];
  });
}
export function listResults() {
  return listRuns().flatMap(r => {
    const f = fileOf(r.id);
    let t = '';
    try { if (f) t = readFileSync(f, 'utf8'); } catch { /* 없다 */ }
    return parseResults(t).map(x => ({ ...x, run: { id: r.id, name: r.name, state: r.state, created: r.created } }));
  });
}
// 할 일 하나 뒤집기 — 그 제목 · 묶음의 그 글이 하나뿐이고 화면이 본 상태와 같을 때만. 새 파일 글을 돌려준다.
// 같은 글이 묶음마다(stage · prod) 있는 일이 흔해 group 까지 본다(''= 묶음 없음, 안 주면 묶음은 안 본다 — 옛 화면)
export function flip(t: string, title: string, item: string, was: boolean, group?: string) {
  const a = JSON.parse(t) as Raw[];
  const hits = (Array.isArray(a) ? a : []).flatMap(r => r?.title === title && Array.isArray(r.items)
    ? r.items.filter(i => i?.text === item && (group === undefined || (text(i.group, 50) ?? '') === group)) : []);
  if (hits.length !== 1) throw new Error(hits.length ? '같은 할 일이 둘 이상이다' : '그 할 일이 없다 — 엔진이 다시 썼을 수 있다(새로 고침)');
  if ((hits[0].done === true) !== was) throw new Error('그사이 바뀌었다 — 새로 고침');
  hits[0].done = !was;
  return JSON.stringify(a, null, 2);
}
export function checkResult(b: { run?: unknown; title?: unknown; text?: unknown; was?: unknown; group?: unknown }) {
  if (typeof b.run !== 'number' || typeof b.title !== 'string' || typeof b.text !== 'string' || typeof b.was !== 'boolean'
    || (b.group !== undefined && typeof b.group !== 'string')) throw new Error('{ run, title, text, was, group? }');
  const f = fileOf(b.run);
  if (!f) throw new Error('결과 파일이 없다');
  const out = flip(readFileSync(f, 'utf8'), b.title, b.text, b.was, b.group as string | undefined), tmp = `${f}.edith.tmp`;
  writeFileSync(tmp, out);
  renameSync(tmp, f);
  // 결과 반영 명령에 넘길 것 — 바뀐 할 일의 태그 · 제목 · 묶음 · 글 · 새 상태
  return { run: b.run, tag: parseResults(out).find(x => x.title === b.title)?.tag ?? '', title: b.title, group: (b.group as string | undefined) ?? '', text: b.text, done: !b.was };
}
