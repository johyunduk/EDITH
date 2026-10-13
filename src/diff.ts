// 코드 변경(diff) — 워크트리 하나를 세 기준으로 본다:
//   work   커밋 안 한 것(HEAD 대비, 새 파일 포함)
//   branch 이 브랜치 전체(기준 브랜치와 갈라진 곳 대비, 커밋 안 한 것 포함)
//   commit 이 브랜치의 커밋 하나
// 새 파일까지 보려고 index 복사본에 git add -A 해서 비교한다 — 진짜 index(스테이징)는 건드리지 않는다.
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sh } from './sh.ts';

const BASES = ['origin/dev', 'origin/develop', 'origin/master', 'origin/main'];   // 있는 것 중 앞의 것이 기본
const MAX = 5_000_000;   // 화면에 넘기는 diff 글 상한(lock 파일 등으로 커질 때)
const OPTS = ['--no-color', '--no-ext-diff', '-M'];

const git = async (cwd: string, args: string[], env?: NodeJS.ProcessEnv) =>
  (await sh('git', ['-c', 'core.quotepath=false', ...args], { cwd, env, timeoutMs: 60_000 })).stdout;

// index 복사본(src 가 없으면 빈 index)에 작업 폴더 전체를 올린 뒤 f 를 부른다.
export async function withIndex<T>(root: string, src: string, f: (env: NodeJS.ProcessEnv) => Promise<T>) {
  const tmp = mkdtempSync(join(tmpdir(), 'edith-diff-')), idx = join(tmp, 'index');
  try {
    if (existsSync(src)) copyFileSync(src, idx);
    const env = { ...process.env, GIT_INDEX_FILE: idx, GIT_OPTIONAL_LOCKS: '0' };
    await git(root, ['add', '-A'], env);
    return await f(env);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

export type Commit = { sha: string; short: string; subject: string; when: string };

// base 는 BASES 중 하나, commit 은 이 브랜치 커밋 목록 중 하나만 받는다(git 인자로 아무 글이나 넘기지 않게).
export async function diff(cwd: string, q: { mode?: string | null; base?: string | null; commit?: string | null }) {
  const root = (await sh('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { ok: true })).stdout.trim();
  if (!root) throw new Error('git 레포가 아니다');
  const refs = (await git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'])).split('\n');
  const bases = BASES.filter(b => refs.includes(b));
  const base = bases.find(b => b === q.base) ?? bases[0] ?? null;
  const fork = base ? (await sh('git', ['merge-base', 'HEAD', base], { cwd: root, ok: true })).stdout.trim() : '';
  // 커밋 목록 — 기준 브랜치가 있으면 이 브랜치 것, 없으면(원격 없는 레포) 최근 30개
  const commits: Commit[] = (await git(root, ['log', '--format=%H%x09%h%x09%s%x09%cr', ...(fork ? ['-n', '300', `${fork}..HEAD`] : ['-n', '30', 'HEAD'])]))
    .split('\n').filter(Boolean).map(l => { const [sha, short, subject, when] = l.split('\t'); return { sha, short, subject, when }; });
  const mode = q.mode === 'branch' || q.mode === 'commit' ? q.mode : 'work';
  let text = '', commit: string | null = null;
  if (mode === 'commit') {
    commit = (commits.find(c => c.sha === q.commit) ?? commits[0])?.sha ?? null;
    if (commit) text = await git(root, ['show', '--format=', ...OPTS, commit]);
  } else {
    if (mode === 'branch' && !fork) throw new Error(`기준 브랜치(${BASES.join('·')})를 못 찾았다`);
    const index = resolve(root, (await git(root, ['rev-parse', '--git-path', 'index'])).trim());
    text = await withIndex(root, index, env => git(root, ['diff', '--cached', ...OPTS, mode === 'branch' ? fork : 'HEAD'], env));
  }
  return { root, mode, bases, base, commits, commit, cut: text.length > MAX, text: text.slice(0, MAX) };
}

// 브랜치 — pane 폴더가 있는 레포·브랜치, 워크스페이스가 링크 워크트리면 그 워크트리와 원본 레포(메인 체크아웃)의 브랜치.
// 브랜치가 아니면(분리된 HEAD) 짧은 커밋 id. git 레포가 아니면 null.
async function branchAt(dir: string) {
  const root = (await sh('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { ok: true })).stdout.trim();
  if (!root) return null;
  const b = (await sh('git', ['-C', root, 'branch', '--show-current'], { ok: true })).stdout.trim();
  return { root, branch: b || `(${(await sh('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { ok: true })).stdout.trim()})` };
}
type Wt = { checkout_path: string; repo_root: string; repo_name: string; is_linked_worktree: boolean };
export async function branches(cwd: string, wt?: Wt | null) {
  const linked = wt?.is_linked_worktree ? wt : null;
  const [here, worktree, repo] = await Promise.all([branchAt(cwd), linked ? branchAt(linked.checkout_path) : null, linked ? branchAt(linked.repo_root) : null]);
  return { here, worktree, repo: repo && { ...repo, name: linked!.repo_name } };
}
