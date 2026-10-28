// 첨부 폴더 — 화면이 올린 파일 · 스크린샷 단추 그림(~/.local/share/edith/uploads). 에이전트는 받자마자 읽는다.
// 7일 지난 것은 올리거나 찍을 때 지우고, 배포 「정리」 는 그 항목의 런 · 대화가 쓴 첨부를 바로 지운다.
import { existsSync, lstatSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, HOME } from './config.ts';

export const UPLOADS = join(DATA_DIR, 'uploads');
export const UPLOAD_KEEP = 7 * 86_400_000;

export function prune(dir: string, keep: number, now = Date.now()) {
  for (const f of readdirSync(dir)) try { if (now - statSync(join(dir, f)).mtimeMs > keep) unlinkSync(join(dir, f)); } catch { /* 그새 지워짐 */ }
}

// 글 속 첨부 경로 → 파일 이름(그 폴더 바로 아래 것만). 절대 경로 · ~ 꼴 둘 다, JSON 안이면 \/ 도
// shortcut: 경로를 / 로 적은 것만 본다 — Windows 의 \ 경로는 못 잡는다(7일 지우기로만 빠진다). Windows 정리를 쓰면 \\ 꼴도 더한다
export function uploadRefs(text: string, dir = UPLOADS, home = HOME): Set<string> {
  const out = new Set<string>(), esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tilde = dir.startsWith(home) ? `~${dir.slice(home.length)}` : dir;
  for (const base of new Set([dir, tilde])) {
    const re = new RegExp(`${esc(base).replaceAll('/', '\\\\?/')}\\\\?/([^/\\s"'\`<>()\\\\]+)`, 'g');
    for (const m of text.matchAll(re)) out.add(m[1]);
  }
  return out;
}

// 파일 · 폴더(안의 글 파일까지)에서 첨부 이름을 모은다 — 큰 파일(영상 · 덤프)은 건너뛴다
const TEXT = /\.(json|jsonl|md|txt|log)$/;
export function refsIn(paths: string[], dir = UPLOADS, max = 20 * 1024 * 1024): Set<string> {
  const out = new Set<string>();
  const walk = (p: string) => {
    let st; try { st = statSync(p); } catch { return; }
    if (st.isDirectory()) { for (const f of readdirSync(p)) walk(join(p, f)); return; }
    if (!TEXT.test(p) || st.size > max) return;
    try { for (const n of uploadRefs(readFileSync(p, 'utf8'), dir)) out.add(n); } catch { /* 읽는 사이 지워짐 */ }
  };
  for (const p of paths) walk(p);
  return out;
}

// 런이 첨부를 적는 곳 — 런 입력(run.json) · 일어난 일(질문 카드 답 등) · 노드 기록 · 입력 나누기 목록. 작업 문서의 다른 것(레포 사본 · 영상)은 안 본다
export const runRefPaths = (runDir: string) => ['run.json', 'events.jsonl', 'nodes', join('work', 'inputs', 'note.md'), join('work', 'inputs', 'list.md')].map(p => join(runDir, p));
// 워크트리에서 돈 Claude 대화 기록 — Claude 는 작업 폴더의 영숫자 아닌 글자를 - 로 바꾼 폴더에 남긴다
export const transcriptDir = (cwd: string, home = HOME) => join(home, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));

// 지운다 — 이름이 그 폴더 바로 아래 파일일 때만(경로 조각 · 링크로 밖을 가리키지 못하게)
export function removeUploads(names: Iterable<string>, dir = UPLOADS) {
  let n = 0;
  for (const name of names) {
    if (!name || name.includes('/') || name.includes('\\') || name.startsWith('.')) continue;
    const f = join(dir, name);
    try { if (existsSync(f) && lstatSync(f).isFile()) { unlinkSync(f); n++; } } catch { /* 그새 지워짐 */ }   // 링크는 건드리지 않는다
  }
  return n;
}
