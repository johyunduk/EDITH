// 런 화면 「산출물」 — 엔진이 작업 문서에 남긴 edith-outputs.json 의 파일 · 주소를 보여 준다(쓰지 않는다):
// [{"label": "<이름>", "path"?: "<파일 절대 경로>", "url"?: "<https 주소>", "node"?: "<만든 노드 키>", "note"?: "<짧은 설명>",
//   "group"?: "<묶음 — 예: 문서 · 리뷰>", "fold"?: "<묶음 안에서 접어 둘 꾸러미 — 예: Codex 리뷰 원문>",
//   "deploy"?: true — 배포 화면 카드에도 그 런의 링크로(배포 뒤 사람이 따라 해 볼 문서 같은 것),
//   "board"?: true — 런 화면 「결과물」 판에 미리 보기 카드로(흐름도 · ERD · 따라 할 가이드처럼 사람이 자주 여는 것)}] — 50개까지
// 파일은 런 작업 폴더 · 실행 폴더 안의 것만(realpath — 링크로 밖을 가리키면 없는 것으로), 1MB 까지, 글 파일만(NUL 이 있으면 글이 아니다).
// 주소는 http(s) 만 — 화면이 그대로 링크로 걸기 때문.
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

export const OUTPUTS_FILE = 'edith-outputs.json';
export type Output = { label: string; path?: string; url?: string; node?: string; note?: string; group?: string; fold?: string; deploy?: true; board?: true };
export type OutputView = Output & { size?: number; at?: number; error?: string };
const MAX = 1024 * 1024;

const str = (v: unknown, n: number) => typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined;
// 틀린 줄은 빼고 읽는다 — 이름이 없거나, 파일 · 주소가 둘 다 없거나, 상대 경로 · http(s) 아닌 주소
export function parseOutputs(t: string): Output[] {
  let a: unknown;
  try { a = JSON.parse(t); } catch { return []; }
  if (!Array.isArray(a)) return [];
  return a.flatMap((x: Record<string, unknown>) => {
    const label = str(x?.label, 80), path = str(x?.path, 1000), url = str(x?.url, 1000);
    const p = path?.startsWith('/') ? path : undefined, u = url && /^https?:\/\//.test(url) ? url : undefined;
    if (!label || (!p && !u)) return [];
    const node = str(x.node, 200), note = str(x.note, 120), group = str(x.group, 40), fold = str(x.fold, 40);
    return [{ label, ...(p ? { path: p } : u ? { url: u } : {}), ...(node ? { node } : {}), ...(note ? { note } : {}), ...(group ? { group } : {}), ...(fold ? { fold } : {}),
      ...(x.deploy === true ? { deploy: true as const } : {}), ...(x.board === true ? { board: true as const } : {}) }];
  }).slice(0, 50);
}

const real = (p: string) => { try { return realpathSync(p); } catch { return null; } };
const within = (p: string, roots: string[]) => { const a = real(p); return !!a && roots.some(r => { const b = real(r); return !!b && (a === b || a.startsWith(b + sep)); }); };
function read(work: string) {
  const f = join(work, OUTPUTS_FILE);
  try { return within(f, [work]) ? parseOutputs(readFileSync(f, 'utf8')) : []; } catch { return []; }
}

// 목록 — 파일은 크기 · 바뀐 때를 붙이고, 볼 수 없는 것은 그 까닭
export function listOutputs(work: string, roots: string[]): OutputView[] {
  return read(work).map(o => {
    if (!o.path) return o;
    if (!within(o.path, roots)) return { ...o, error: '런 작업 폴더 밖이거나 없다' };
    try { const s = statSync(o.path); return s.isFile() ? { ...o, size: s.size, at: s.mtimeMs } : { ...o, error: '파일이 아니다' }; } catch { return { ...o, error: '없다' }; }
  });
}

// 배포 화면 카드에 걸 산출물 — deploy 표시가 있고 볼 수 있는 파일만. i 는 목록 차례(화면이 #/runs/<번호>/out/<i> 로 바로 연다)
export const deployOutputs = (work: string, roots: string[]) =>
  listOutputs(work, roots).flatMap((o, i) => o.deploy && o.path && !o.error ? [{ label: o.label, i }] : []);

// i 번째 파일의 글 — 목록과 같은 검사를 다시 한다(화면이 보낸 것은 차례 번호뿐)
export function readOutput(work: string, roots: string[], i: number): { label: string; path: string; text: string } {
  const o = read(work)[i];
  if (!o?.path) throw new Error('없는 산출물이다');
  if (!within(o.path, roots)) throw new Error('런 작업 폴더 밖이거나 없다');
  const s = statSync(o.path);
  if (!s.isFile()) throw new Error('파일이 아니다');
  if (s.size > MAX) throw new Error('1MB 가 넘는다');
  const text = readFileSync(o.path, 'utf8');
  if (text.includes('\0')) throw new Error('글 파일이 아니다');
  return { label: o.label, path: o.path, text };
}
