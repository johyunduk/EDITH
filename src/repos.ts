// 런 화면 「레포」 — 엔진이 작업 문서에 남긴 edith-repos.json 의 레포마다 git 으로 커밋 상태를 읽는다(쓰지 않는다 — fetch 도 안 해서 원격 기준은 마지막 fetch 때):
// [{"path": "<워크트리 절대 경로>", "branch"?: "<브랜치 — 다르면 알린다>", "base"?: "<기준 — 기본 origin/master>", "also"?: ["<더 볼 기준 — 예: origin/dev>"](3개까지), "start"?: "<워크트리를 딴 커밋>"}]
// 커밋 안 한 파일 수 · 기준(들)에 없는 커밋 수(0 이면 다 들어 있음) · 올렸는지(upstream 과 같은지). start 가 있고 그 뒤 커밋이 없으면 「커밋 없음」(fresh) —
// 커밋이 없어도 기준에 없는 커밋은 0 이라, 그것만으로는 「다 들어 있음」 과 가르지 못한다. 커밋 · 정리 · 버리기는 엔진의 런 단추가 한다.
// 경로는 런 작업 폴더 안의 git 작업 트리만 — 런의 Claude · 명령이 쓰는 파일이라 그 밖은 보지 않는다(파일 이름도 수만 센다).
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import { sh } from './sh.ts';

export const REPOS_FILE = 'edith-repos.json';
export type RepoRef = { path: string; branch?: string; base: string; also?: string[]; start?: string };
export type Repo = RepoRef & { name: string; error?: string; head?: string; dirty?: number; ahead?: number; pushed?: boolean | null; fresh?: boolean; more?: { base: string; ahead: number | null }[] };

const REF = /^[\w][\w./-]{0,120}$/, SHA = /^[0-9a-f]{7,40}$/;
// 틀린 줄은 빼고 읽는다(파일이 깨졌으면 빈 것). 12개까지
export function parseRepos(t: string): RepoRef[] {
  let a: unknown;
  try { a = JSON.parse(t); } catch { return []; }
  if (!Array.isArray(a)) return [];
  return a.flatMap((x: { path?: unknown; branch?: unknown; base?: unknown; also?: unknown; start?: unknown }) => {
    if (typeof x?.path !== 'string' || !x.path.startsWith('/')) return [];
    const also = Array.isArray(x.also) ? x.also.filter((b): b is string => typeof b === 'string' && REF.test(b)).slice(0, 3) : [];
    return [{ path: x.path, ...(typeof x.branch === 'string' && REF.test(x.branch) ? { branch: x.branch } : {}), base: typeof x.base === 'string' && REF.test(x.base) ? x.base : 'origin/master',
      ...(also.length ? { also } : {}), ...(typeof x.start === 'string' && SHA.test(x.start) ? { start: x.start } : {}) }];
  }).slice(0, 12);
}

export const inside = (p: string, root: string) => { try { const a = realpathSync(p), b = realpathSync(root); return a === b || a.startsWith(b + sep); } catch { return false; } };
const git = (cwd: string, ...args: string[]) => sh('git', ['-C', cwd, ...args], { ok: true, timeoutMs: 15_000 });

// 작업 문서 안의 파일만(링크로 밖을 가리키면 없는 것으로)
export function readRefs(work: string): RepoRef[] {
  try { const f = join(work, REPOS_FILE); return inside(f, work) ? parseRepos(readFileSync(f, 'utf8')) : []; } catch { return []; }
}
export async function repoStatus(work: string, cwd: string): Promise<Repo[]> {
  return Promise.all(readRefs(work).map(async (x): Promise<Repo> => {
    const name = basename(x.path);
    if (!inside(x.path, cwd)) return { ...x, name, error: '런 작업 폴더 밖이라 보지 않는다' };
    if ((await git(x.path, 'rev-parse', '--is-inside-work-tree')).stdout.trim() !== 'true') return { ...x, name, error: 'git 작업 트리가 아니다' };
    const count = (ref: string) => git(x.path, 'rev-list', '--count', `${ref}..HEAD`).then(r => r.code === 0 ? Number(r.stdout.trim()) : null);
    const [head, status, ahead, up, since, more] = await Promise.all([
      git(x.path, 'rev-parse', '--abbrev-ref', 'HEAD'), git(x.path, 'status', '--porcelain'),
      git(x.path, 'rev-list', '--count', `${x.base}..HEAD`), git(x.path, 'rev-list', '--count', '@{u}..HEAD'),
      x.start ? count(x.start) : null, Promise.all((x.also ?? []).map(async b => ({ base: b, ahead: await count(b) }))),
    ]);
    return {
      ...x, name, head: head.stdout.trim(), ...(since === 0 ? { fresh: true } : {}), ...(more.length ? { more } : {}),
      dirty: status.stdout.split('\n').filter(Boolean).length,
      ...(ahead.code === 0 ? { ahead: Number(ahead.stdout.trim()) } : { error: `기준 ${x.base} 을 찾지 못했다(fetch 전?)` }),
      pushed: up.code === 0 ? up.stdout.trim() === '0' : null,   // null = upstream 없음(아직 안 올림)
    };
  }));
}

// 「변경 보기」 — i 번째 레포에서, 딴 커밋(start — 없으면 기준과 갈라진 곳)부터 지금 작업 트리까지 바뀐 것(커밋한 것 + 안 한 것).
// 추적 전 새 파일도 diff 꼴로 붙인다(50개 · 파일마다 200KB 까지 · 글 파일만 · 링크는 빼고 — 레포 밖을 읽지 않게). 2MB 넘으면 자른다
const DIFF_MAX = 2 * 1024 * 1024, NEW_MAX = 200 * 1024;
export async function repoDiff(work: string, cwd: string, i: number): Promise<{ name: string; from: string; text: string }> {
  const x = readRefs(work)[i];
  if (!x) throw new Error('없는 레포다');
  if (!inside(x.path, cwd)) throw new Error('런 작업 폴더 밖이라 보지 않는다');
  const from = x.start ?? ((await git(x.path, 'merge-base', x.base, 'HEAD')).stdout.trim() || 'HEAD');
  const [d, others] = await Promise.all([git(x.path, 'diff', '--no-color', '--no-ext-diff', from), git(x.path, 'ls-files', '--others', '--exclude-standard', '-z')]);
  if (d.code !== 0) throw new Error(`git diff 실패 — ${d.stderr.split('\n')[0]}`);
  const added = others.stdout.split('\0').filter(Boolean).slice(0, 50).flatMap(f => {
    const p = join(x.path, f);
    try {
      if (!lstatSync(p).isFile() || lstatSync(p).size > NEW_MAX || !inside(p, x.path)) return [];
      const body = readFileSync(p, 'utf8');
      if (body.includes('\0')) return [];
      const lines = body.replace(/\n$/, '').split('\n');
      return [`diff --git a/${f} b/${f}\nnew file mode 100644\n--- /dev/null\n+++ b/${f}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(l => `+${l}`).join('\n')}\n`];
    } catch { return []; }
  });
  const text = d.stdout + added.join('');
  return { name: basename(x.path), from: from.slice(0, 7), text: text.length > DIFF_MAX ? `${text.slice(0, DIFF_MAX)}\n… (2MB 에서 잘림)\n` : text };
}
