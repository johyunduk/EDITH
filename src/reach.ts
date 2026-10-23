// 결과 화면 — 끝난 런의 코드가 어느 브랜치까지 들어갔나. 볼 브랜치는 엔진이 edith-repos.json 에 정한 것(also 들 → base 차례 — 예: origin/dev · origin/stage → origin/master).
// 해시로만 보면 스쿼시 · 체리픽 · 다시 만든 머지로 들어간 것을 「없다」 고 하니, 레포 · 브랜치마다 앞에서부터 본다(걸리면 멈춘다):
//   1. in      — 지금 HEAD 가 그 브랜치의 조상(커밋 그대로). 언제 = 그 브랜치에서 HEAD 를 처음 합친 머지(없으면 fast-forward — HEAD 시각)
//   2. content — 딴 커밋(start)부터 HEAD 까지의 변경을 그 브랜치 트리에 거꾸로 적용해 본다(임시 인덱스 — 작업 트리 · 레포 인덱스는 안 건드린다). 다 된다
//      partial — 바꾼 파일 중 몇 개만 된다(k/n · 안 된 파일)
//   3. subject — 이 런의 커밋 제목이 그 브랜치 메시지에 있다(들어간 뒤 고쳐진 듯 — 사람이 확인)
// git 은 읽기만 — 원격은 마지막 fetch 기준이고, 받기는 reachFetch(화면 「새로 받기」)만 한다. 결과는 HEAD · 그 브랜치 커밋이 같은 동안 기억해 둔다.
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { sh } from './sh.ts';
import { inside, readRefs, repoStatus } from './repos.ts';
import { listRuns, loadRun, readActions, RUNS } from './runner.ts';
import { parseResults, RESULTS_FILE } from './results.ts';

export type Reach = { ref: string; state: 'in' | 'content' | 'partial' | 'subject' | 'none' | 'missing'; at?: number; how?: 'merge' | 'ff'; k?: number; n?: number; missing?: string[]; subject?: string };

const git = (cwd: string, args: string[], env?: NodeJS.ProcessEnv, input?: string | Buffer) =>
  sh('git', ['-C', cwd, ...args], { ok: true, timeoutMs: 20_000, ...(env ? { env } : {}), ...(input !== undefined ? { input } : {}) });
const out = async (cwd: string, args: string[]) => { const r = await git(cwd, args); return r.code === 0 ? r.stdout.trim() : null; };
const secs = (s: string | null | undefined) => s && /^\d+$/.test(s) ? Number(s) * 1000 : undefined;

// 거꾸로 적용 — 그 브랜치 트리를 담은 임시 인덱스에 patch 를 --reverse --check 로(아무것도 쓰지 않는다). 된 파일 수와 안 된 파일
const FILES_MAX = 60;
async function applies(path: string, start: string, head: string, ref: string, files: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'edith-reach-')), env = { ...process.env, GIT_INDEX_FILE: join(dir, 'index') };
  try {
    if ((await git(path, ['read-tree', ref], env)).code !== 0) return { ok: 0, bad: files };
    const check = async (only: string[]) => {
      const d = await git(path, ['diff', '--binary', '--no-color', '--no-ext-diff', start, head, '--', ...only]);
      return d.code === 0 && (await git(path, ['apply', '--cached', '--reverse', '--check'], env, d.out)).code === 0;
    };
    if (await check(files)) return { ok: files.length, bad: [] };
    // shortcut: 파일이 FILES_MAX 를 넘으면 하나씩 보지 않는다(「없음」 으로) — 큰 런이 흔해지면 묶어서 본다
    if (files.length > FILES_MAX) return { ok: 0, bad: files };
    const each = await Promise.all(files.map(async f => ({ f, ok: await check([f]) })));
    return { ok: each.filter(x => x.ok).length, bad: each.filter(x => !x.ok).map(x => x.f) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

async function compute(path: string, start: string, head: string, ref: string): Promise<Reach> {
  if ((await git(path, ['merge-base', '--is-ancestor', head, ref])).code === 0) {
    const m = (await out(path, ['log', '--ancestry-path', '--merges', '--reverse', '--format=%ct', `${head}..${ref}`]))?.split('\n')[0];
    return m ? { ref, state: 'in', at: secs(m), how: 'merge' } : { ref, state: 'in', at: secs(await out(path, ['log', '-1', '--format=%ct', head])), how: 'ff' };
  }
  const files = ((await out(path, ['diff', '--name-only', '-z', start, head])) ?? '').split('\0').filter(Boolean);
  if (!files.length) return { ref, state: 'none' };
  const a = await applies(path, start, head, ref, files);
  if (a.ok === files.length) return { ref, state: 'content', at: secs(await out(path, ['log', '-1', '--format=%ct', ref, '--', ...files.slice(0, 50)])) };
  if (a.ok > 0) return { ref, state: 'partial', k: a.ok, n: files.length, missing: a.bad.slice(0, 50) };
  // 같은 제목 — 딴 뒤의 커밋만 본다(오래된 같은 제목에 걸리지 않게). 짧은 제목(「fix」 따위)은 빼고
  const since = await out(path, ['log', '-1', '--format=%cI', start]);
  const subjects = [...new Set(((await out(path, ['log', '--no-merges', '--format=%s', `${start}..${head}`])) ?? '').split('\n').map(s => s.trim()).filter(s => s.length >= 8))].slice(0, 10);
  for (const s of subjects) {
    const t = await out(path, ['log', '-1', '--format=%ct', '--fixed-strings', `--grep=${s}`, ...(since ? [`--since=${since}`] : []), ref]);
    if (t) return { ref, state: 'subject', at: secs(t), subject: s };
  }
  return { ref, state: 'none' };
}

const memo = new Map<string, Reach>();
export async function reachOf(path: string, start: string, ref: string): Promise<Reach> {
  const [head, tip] = await Promise.all([out(path, ['rev-parse', 'HEAD']), out(path, ['rev-parse', '--verify', '-q', `${ref}^{commit}`])]);
  if (!head || !tip) return { ref, state: 'missing' };
  const key = `${path}\0${start}\0${head}\0${tip}`, hit = memo.get(key);
  if (hit) return hit;
  const r = await compute(path, start, head, ref);
  if (memo.size > 1000) memo.clear();   // shortcut: 넘치면 통째로 비운다 — 끝난 런이 수백 개가 되면 오래된 것부터
  memo.set(key, r);
  return r;
}

// 한꺼번에 n 개씩 — 런이 많아도 git 을 수백 개 동시에 띄우지 않게
async function each<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) { const j = i++; out[j] = await f(xs[j]); } }));
  return out;
}
// 런 폴더 안 작업 문서의 JSON 하나(링크로 밖을 가리키면 없는 것으로)
function workJson(id: number, file: string): unknown {
  const work = join(RUNS, String(id), 'work'), f = join(work, file);
  try { return inside(f, work) ? JSON.parse(readFileSync(f, 'utf8')) : null; } catch { return null; }
}
const str = (v: unknown, n: number) => typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined;

// via — 먼저 합쳐지는 브랜치(이슈 → 안건)에 들어갔나, headAt — 지금 커밋 시각, actions — 엔진 런 단추 중 단계(reach)가 적힌 것(결과 화면이 그 단계 칸에 놓는다)
export type ReachRepo = { name: string; path: string; branch?: string; error?: string; dirty?: number; pushed?: boolean | null; fresh?: boolean; headAt?: number; via?: Reach; envs: Reach[] };
export type ReachAction = { n: number; label: string; reach: string; command: string; hint?: string; ask?: string; danger?: boolean };
export type ReachRun = { id: number; name: string; title: string; tag?: string; ended: number; repos: ReachRepo[]; tasks: { done: number; total: number } | null; fetched?: number; actions: ReachAction[] };
// 끝난 런마다 — 레포 상태(src/repos.ts — 커밋 안 한 파일 · 올렸는지)와 브랜치마다 어디까지, 배포 할 일 수(edith-results.json). 최근에 끝난 것부터
export async function reachList(): Promise<ReachRun[]> {
  const runs = listRuns().filter(r => r.state === 'done');
  const rows = await each(runs, 4, async (r): Promise<ReachRun | null> => {
    const full = loadRun(r.id);
    if (!full) return null;
    const work = join(RUNS, String(r.id), 'work'), refs = readRefs(work);
    const results = parseResults(JSON.stringify(workJson(r.id, RESULTS_FILE) ?? [])), items = results.flatMap(x => x.items);
    if (!refs.length && !items.length) return null;
    const status = await repoStatus(work, full.cwd);
    const repos = await Promise.all(status.map(async (s, i): Promise<ReachRepo> => {
      if (s.error && s.ahead === undefined && s.dirty === undefined) return { name: s.name, path: s.path, error: s.error, envs: [] };
      const x = refs[i], envRefs = [...(x.also ?? []), x.base];
      // 이름은 원격 주소의 레포 이름(워크트리 폴더 이름은 레포마다 같을 수 있다 — FE · BE 를 같은 이름으로 따면)
      const url = await out(x.path, ['config', '--get', 'remote.origin.url']), name = url?.replace(/\/+$/, '').replace(/\.git$/, '').split(/[/:]/).pop() || s.name;
      const base = { name, path: s.path, ...(s.head ? { branch: s.head } : {}), dirty: s.dirty, pushed: s.pushed };
      const start = x.start ?? await out(x.path, ['merge-base', x.base, 'HEAD']), [head, from] = await Promise.all([out(x.path, ['rev-parse', 'HEAD']), start ? out(x.path, ['rev-parse', `${start}^{commit}`]) : null]);
      // 딴 뒤 커밋이 없으면 딴 커밋이 어디에나 들어 있어 「들어감」 으로 보인다 — 커밋 없음으로
      if (!from || from === head) return { ...base, fresh: true, ...(x.via ? { via: { ref: x.via, state: 'none' as const } } : {}), envs: envRefs.map(ref => ({ ref, state: from ? 'none' : 'missing' })) };
      const [envs, via, headAt] = await Promise.all([Promise.all(envRefs.map(ref => reachOf(x.path, from, ref))), x.via ? reachOf(x.path, from, x.via) : undefined, out(x.path, ['log', '-1', '--format=%ct', 'HEAD'])]);
      return { ...base, envs, ...(via ? { via } : {}), ...(secs(headAt) ? { headAt: secs(headAt) } : {}) };
    }));
    const req = workJson(r.id, 'edith-request.json') as { title?: unknown; tag?: unknown } | null, sum = workJson(r.id, 'edith-summary.json') as { title?: unknown } | null;
    let ended = r.created;
    try { ended = statSync(join(RUNS, String(r.id), 'run.json')).mtimeMs; } catch { /* 없으면 시작 시각 */ }
    // 제목 — 요청 · 요약 · 결과 묶음 순서로, 주소뿐인 것은 건너뛴다(없으면 입력 첫 줄)
    const title = [str(req?.title, 120), str(sum?.title, 120), str(results[0]?.title, 120)].find(t => t && !/^https?:\/\/\S+$/.test(t)) ?? (full.input.split('\n')[0] || full.name).slice(0, 120);
    const tag = str(req?.tag, 40) ?? (results[0]?.tag || undefined);
    return { id: r.id, name: r.name, title, ...(tag ? { tag } : {}), ended, repos,
      tasks: items.length ? { done: items.filter(i => i.done).length, total: items.length } : null, fetched: await fetchedAt(repos.map(x => x.path)),
      actions: readActions(full).flatMap((a, n) => a.reach ? [{ n, label: a.label, reach: a.reach, command: a.command, ...(a.hint ? { hint: a.hint } : {}), ...(a.ask ? { ask: a.ask } : {}), ...(a.danger ? { danger: true } : {}) }] : []) };
  });
  return rows.filter((x): x is ReachRun => !!x).sort((a, b) => b.ended - a.ended);
}

// 원격을 마지막으로 받은 때 — 레포마다 FETCH_HEAD 시각 중 가장 오래된 것(그 런의 표가 그때 기준)
async function fetchedAt(paths: string[]) {
  const ts = await Promise.all(paths.map(async p => {
    const d = await out(p, ['rev-parse', '--git-common-dir']);
    try { return d ? statSync(join(isAbsolute(d) ? d : join(p, d), 'FETCH_HEAD')).mtimeMs : undefined; } catch { return undefined; }
  }));
  const ok = ts.filter((t): t is number => t !== undefined);
  return ok.length ? Math.min(...ok) : undefined;
}

// 「새로 받기」 — 끝난 런들의 레포(같은 레포의 워크트리는 한 번만)를 origin 에서 받는다. 런 작업 폴더 안의 작업 트리만
export async function reachFetch() {
  const seen = new Map<string, string>();
  for (const r of listRuns().filter(x => x.state === 'done')) {
    const full = loadRun(r.id);
    if (!full) continue;
    for (const x of readRefs(join(RUNS, String(r.id), 'work'))) {
      if (!inside(x.path, full.cwd)) continue;
      const d = await out(x.path, ['rev-parse', '--git-common-dir']);
      if (d && !seen.has(isAbsolute(d) ? d : join(x.path, d))) seen.set(isAbsolute(d) ? d : join(x.path, d), x.path);
    }
  }
  const errors = (await each([...seen.values()], 3, async p => {
    const r = await sh('git', ['-C', p, 'fetch', '--prune', '--quiet', 'origin'], { ok: true, timeoutMs: 90_000 });
    return r.code === 0 ? null : `${p} — ${(r.stderr || r.stdout).trim().split('\n')[0]}`;
  })).filter((x): x is string => !!x);
  return { repos: seen.size, errors };
}
