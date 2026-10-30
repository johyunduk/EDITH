// 배포 목록 — 레포 · 브랜치마다 안건 이름 · 메모 · 배포일 · 연기 · 환경별 할 일 · 기록(화면 「배포」). 정본은 DATA_DIR/deploy.json 하나:
// {"rev": <판>, "envs": [{"name": "dev", "ref": "origin/dev"}, …(앞에서 뒤 차례 — 마지막이 운영)], "items": [{"id", "repo": "<레포 본 체크아웃 절대 경로>", "branch",
//   "start"?: "<이 브랜치 변경이 시작된 커밋>", "tag"?: "<이름 — 안건 키가 없으면 이것으로 묶는다>", "ticket"?: "<자기 티켓 — PROJ-1 · ISSUE-2>", "agenda"?: "<안건 키 — 같으면 한 카드(QA 이슈는 상위 안건)>", "notes": [], "date"?: "YYYY-MM-DD", "deferred"?, "done"?: "YYYY-MM-DD(보관한 날)",
//   "tasks": [{"env", "text", "done"}], "block"?: {"base", "end", "made"}(할 일을 뽑은 범위 — 그 뒤 커밋이 생기면 「낡음」), "log": [{"t", "text"}]}]}
// 코드가 어디까지 갔나는 볼 때마다 git 에서 — 결과 화면과 같은 reachOf(해시 → 코드 → 커밋 제목)로, 워크트리가 없어도 레포 본 체크아웃에서 브랜치 이름으로 본다
// (지운 이슈 브랜치 · 사람이 손으로 한 일이 모두 같은 꼴). 아직 안 들어간 환경은 머지 충돌 파일 수까지. 원격은 마지막 fetch 기준이고 받기는 deployFetch 만.
// 쓰기는 화면(배포일 · 메모 · 연기 · 보관 · 할 일 체크 · 항목 더하기 · 다음 환경에 올리기 — 파일 판(rev)이 화면이 본 것과 같을 때만)과
// CLI(edith deploy … — 스킬 · 엔진이 등록 · 메모 · 배포 조치 · 보관 · 지우기). 둘이 겹치지 않게 쓰기마다 잠금(deploy.json.lock).
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { DATA_DIR } from './config.ts';
import { sh } from './sh.ts';
import { each, reachOf, runActions, runRepos, runTag, runTitle, type Reach, type ReachAction, type ReachRepo } from './reach.ts';
import { readRefs } from './repos.ts';
import { acted, deployHook, listRuns, loadRun, runHook, RUNS, type Run } from './runner.ts';
import { lastLine } from './timeline.ts';

export const DEPLOY_FILE = join(DATA_DIR, 'deploy.json');
export type Env = { name: string; ref: string };
export type Task = { env: string; text: string; done: boolean; hand?: true };   // hand — 사람이 화면에서 적은 줄(다시 뽑아도 남긴다)
export type Item = {
  id: string; repo: string; branch: string; start?: string; tag?: string; ticket?: string; agenda?: string; notes: string[]; date?: string; deferred?: boolean; done?: string;
  tasks: Task[]; block?: { base: string; end: string; made: string; notes?: string[] }; log: { t: number; text: string }[];
};
export type Store = { rev: number; envs: Env[]; items: Item[] };
export const ENVS: Env[] = [{ name: 'dev', ref: 'origin/dev' }, { name: 'stage', ref: 'origin/stage' }, { name: 'prod', ref: 'origin/master' }];

const KEY = /^[A-Z][A-Z0-9]{0,15}-\d{1,8}$/, REF = /^[\w][\w./-]{0,120}$/, SHA = /^[0-9a-f]{7,40}$/, DAY = /^\d{4}-\d{2}-\d{2}$/, ID = /^[0-9a-f]{8}$/;
const text = (v: unknown, n: number) => typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined;
const newId = () => randomBytes(4).toString('hex');
export const today = () => new Date().toLocaleDateString('sv-SE');   // 이 맥 시간대의 YYYY-MM-DD

// 항목 하나 — 틀린 칸은 버리고, 레포 · 브랜치가 틀리면 항목째 뺀다
function parseItem(x: Record<string, unknown>, envs: Env[], id = typeof x.id === 'string' && ID.test(x.id) ? x.id : newId()): Item | null {
  if (typeof x?.repo !== 'string' || !isAbsolute(x.repo) || typeof x.branch !== 'string' || !REF.test(x.branch)) return null;
  const b = x.block as Record<string, unknown> | undefined, names = new Set(envs.map(e => e.name));
  return {
    id, repo: x.repo, branch: x.branch,
    ...(typeof x.start === 'string' && SHA.test(x.start) ? { start: x.start } : {}),
    ...(text(x.tag, 60) ? { tag: text(x.tag, 60) } : {}),
    ...(typeof x.ticket === 'string' && KEY.test(x.ticket) ? { ticket: x.ticket } : {}), ...(typeof x.agenda === 'string' && KEY.test(x.agenda) ? { agenda: x.agenda } : {}),
    notes: Array.isArray(x.notes) ? x.notes.flatMap(n => text(n, 2000) ?? []).slice(0, 50) : [],
    ...(typeof x.date === 'string' && DAY.test(x.date) ? { date: x.date } : {}),
    ...(x.deferred === true ? { deferred: true } : {}),
    ...(typeof x.done === 'string' && DAY.test(x.done) ? { done: x.done } : {}),
    tasks: Array.isArray(x.tasks) ? (x.tasks as Record<string, unknown>[]).flatMap(t => typeof t?.env === 'string' && names.has(t.env) && text(t.text, 1000)
      ? [{ env: t.env, text: text(t.text, 1000)!, done: t.done === true, ...(t.hand === true ? { hand: true as const } : {}) }] : []).slice(0, 100) : [],
    ...(b && typeof b.base === 'string' && SHA.test(b.base) && typeof b.end === 'string' && SHA.test(b.end) ? { block: { base: b.base, end: b.end, made: text(b.made, 40) ?? '',
      ...(Array.isArray(b.notes) && b.notes.length ? { notes: b.notes.flatMap(n => text(n, 1000) ?? []).slice(0, 30) } : {}) } } : {}),
    log: Array.isArray(x.log) ? (x.log as Record<string, unknown>[]).flatMap(l => typeof l?.t === 'number' && text(l.text, 300) ? [{ t: l.t, text: text(l.text, 300)! }] : []).slice(-100) : [],
  };
}
// 파일이 없거나 깨졌으면 빈 목록(판 0)
export function parseStore(t: string): Store {
  let a: Record<string, unknown>;
  try { a = JSON.parse(t); } catch { return { rev: 0, envs: ENVS, items: [] }; }
  const envs = Array.isArray(a?.envs) && a.envs.length >= 2 && a.envs.every((e: Env) => text(e?.name, 20) && typeof e.ref === 'string' && REF.test(e.ref)) ? (a.envs as Env[]).map(e => ({ name: e.name, ref: e.ref })) : ENVS;
  return { rev: typeof a?.rev === 'number' ? a.rev : 0, envs, items: Array.isArray(a?.items) ? (a.items as Record<string, unknown>[]).flatMap(x => parseItem(x, envs) ?? []) : [] };
}
export function loadStore(file = DEPLOY_FILE): Store {
  try { return parseStore(readFileSync(file, 'utf8')); } catch { return parseStore(''); }
}
function writeStore(file: string, s: Store) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(s, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}
// 쓰기 잠금 — 화면(서버)과 CLI(스킬 · 키트, 다른 프로세스)가 같은 파일을 읽고 고쳐 쓴다. 5초 기다리고, 30초 넘은 잠금은 죽은 것으로 본다
function locked<T>(file: string, f: () => T): T {
  const lock = `${file}.lock`, until = Date.now() + 5000;
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  for (;;) {
    try { writeFileSync(lock, String(process.pid), { flag: 'wx' }); break; }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      try { if (Date.now() - statSync(lock).mtimeMs > 30_000) { rmSync(lock, { force: true }); continue; } } catch { continue; }
      if (Date.now() > until) throw new Error('배포 목록을 다른 쪽이 쓰는 중이다 — 잠시 뒤 다시');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try { return f(); } finally { rmSync(lock, { force: true }); }
}
// 읽고 고쳐 쓰기(잠금 안에서) — 화면은 자기가 본 판(rev)과 같을 때만(그사이 다른 화면 · CLI 가 썼으면 고치지 않는다), CLI 는 ANY(지금 판에 바로)
export const ANY = Symbol('아무 판');
export function change(file: string, rev: unknown, f: (s: Store) => void) {
  return locked(file, () => {
    const s = loadStore(file);
    if (rev !== ANY && rev !== s.rev) throw new Error('그사이 배포 목록이 바뀌었다 — 화면이 다시 읽은 뒤 다시');
    f(s);
    s.rev++;
    writeStore(file, s);
    return { rev: s.rev };
  });
}
export const note = (x: Item, t: string) => { x.log.push({ t: Date.now(), text: t }); if (x.log.length > 100) x.log.splice(0, x.log.length - 100); };

export const git = (repo: string, args: string[], timeoutMs = 20_000) => sh('git', ['-C', repo, ...args], { ok: true, timeoutMs, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
export const out = async (repo: string, args: string[]) => { const r = await git(repo, args); return r.code === 0 ? r.stdout.trim() : null; };
export const commit = (repo: string, ref: string) => out(repo, ['rev-parse', '--verify', '-q', `${ref}^{commit}`]);
export const reached = (r?: Reach) => r?.state === 'in' || r?.state === 'content';

// 브랜치 끝 — 이 맥의 브랜치, 없으면 origin 의 것(워크트리를 지운 뒤에도 원격에 남은 브랜치)
async function tipOf(x: Item) {
  const [local, remote] = await Promise.all([commit(x.repo, `refs/heads/${x.branch}`), commit(x.repo, `refs/remotes/origin/${x.branch}`)]);
  return { local, remote, tip: local ?? remote };
}
// 그 브랜치를 꺼내 둔 워크트리(본 체크아웃 포함)
export async function worktreeOf(repo: string, branch: string) {
  const t = await out(repo, ['worktree', 'list', '--porcelain']);
  return t?.split('\n\n').find(b => b.split('\n').includes(`branch refs/heads/${branch}`))?.match(/^worktree (.+)$/m)?.[1] ?? null;
}
// into 에 from 을 합치면 충돌하는 파일(작업 트리 · 인덱스 없이 git merge-tree). 못 보면 null
async function conflictsOf(repo: string, into: string, from: string) {
  const r = await git(repo, ['merge-tree', '--write-tree', '--name-only', '--no-messages', into, from]);
  return r.code === 1 ? r.stdout.trim().split('\n').slice(1).filter(Boolean) : r.code === 0 ? [] : null;
}
// 원격을 마지막으로 받은 때 — 레포 FETCH_HEAD 시각
async function fetchedAt(repo: string) {
  const d = await out(repo, ['rev-parse', '--git-common-dir']);
  try { return d ? statSync(join(isAbsolute(d) ? d : join(repo, d), 'FETCH_HEAD')).mtimeMs : undefined; } catch { return undefined; }
}

// prep — 그 환경의 머지 브랜치(merge-stage/<끝>) 상태: ready 원본 끝 · 환경을 다 품었다(충돌을 풀었다), merging 그 워크트리에서 아직 머지 중(Claude 가 푸는 중) — 배포 화면 레포 줄 단추가 본다
export type EnvState = Reach & { name: string; conflicts?: number; files?: string[]; prep?: { branch: string; ready: boolean; merging?: string } };
// remote — 이 맥에 브랜치가 없고 origin 것만, pushed — 이 맥 브랜치가 origin 과 같거나 origin 에 다 있다(origin 에 브랜치가 없으면 false)
// empty — 등록한 뒤 커밋이 하나도 없다(갓 만든 브랜치 — 끝이 운영의 한 지점이라 「들어감」 으로 보이지 않게 환경은 모두 none)
export type ItemState = { tip?: string; remote?: boolean; pushed?: boolean; worktree?: string; dirty?: number; behind?: number; stale?: boolean; empty?: boolean; envs: EnvState[]; error?: string };
// 항목 하나의 코드 상태 — 환경마다 어디까지, 안 들어간 환경은 그대로 합치면 충돌할 파일
// shortcut: 충돌은 브랜치를 그 환경에 바로 합칠 때 기준 — stage 를 거쳐 나가는 운영(stage → master)의 실제 충돌과 다를 수 있다, 운영 칸이 틀리게 보이면 앞 환경 기준으로
export async function stateOf(x: Item, envs: Env[], base = envs.at(-1)!.ref): Promise<ItemState> {
  if (!(await out(x.repo, ['rev-parse', '--git-dir']))) return { envs: [], error: `레포가 없다(${x.repo})` };
  const { local, remote, tip } = await tipOf(x);
  if (!tip) return { envs: [], error: `브랜치 ${x.branch} 가 이 맥에도 origin 에도 없다` };
  const start = x.start ?? await out(x.repo, ['merge-base', base, tip]) ?? tip;
  const empty = !!x.start && (x.start === tip || await out(x.repo, ['rev-list', '--count', `${x.start}..${tip}`]) === '0');
  const [wt, behind, ahead, es] = await Promise.all([
    worktreeOf(x.repo, x.branch),
    local && remote && local !== remote ? out(x.repo, ['rev-list', '--count', `${local}..${remote}`]).then(Number) : 0,
    local && remote && local !== remote ? out(x.repo, ['rev-list', '--count', `${remote}..${local}`]).then(Number) : 0,
    Promise.all(envs.map(async (e): Promise<EnvState> => {
      if (empty) return { ref: e.ref, state: 'none', name: e.name };
      const r = await reachOf(x.repo, start, e.ref, tip);
      if (reached(r) || r.state === 'missing') return { ...r, name: e.name };
      const c = await conflictsOf(x.repo, e.ref, tip);
      return { ...r, name: e.name, ...(c ? { conflicts: c.length, files: c.slice(0, 30) } : {}) };
    })),
  ]);
  const dirty = wt ? (await out(wt, ['status', '--porcelain']))?.split('\n').filter(Boolean).length : undefined;
  return { tip, ...(local ? {} : { remote: true }), pushed: !!remote && !ahead, ...(wt ? { worktree: wt, dirty } : {}), ...(behind ? { behind } : {}),
    ...(x.block ? { stale: !tip.startsWith(x.block.end) } : {}), ...(empty ? { empty: true } : {}), envs: es };
}

// 화면 — 보관 안 한 항목과 그 코드 상태, 레포마다 마지막 받은 때. 보관한 것은 수(done)만 — 쌓이니 목록은 deployDone 으로 따로 연다
export async function deployView(file = DEPLOY_FILE) {
  const s = loadStore(file), active = s.items.filter(x => !x.done), repos = [...new Set(active.map(x => x.repo))];
  const [states, fetched] = await Promise.all([each(active, 4, x => stateOf(x, s.envs)), Promise.all(repos.map(fetchedAt))]);
  const st = new Map(active.map((x, i) => [x.id, states[i]]));
  return { rev: s.rev, envs: s.envs, items: active.map(x => ({ ...x, state: st.get(x.id), ...(prepping.has(x.id) ? { prep: prepping.get(x.id) } : {}) })), done: s.items.length - active.length,
    repos: repos.map((r, i) => ({ path: r, name: basename(r), fetched: fetched[i] })), hooks: { prep: !!deployHook('prep'), cleanup: !!deployHook('cleanup') }, leftover: await leftOf(s) };
}
// 보관했는데 이 맥에 브랜치가 남은 것(정리 안 한 것) — 「Complete」 의 「남은 n개 정리」. 레포마다 브랜치 목록 한 번
async function leftOf(s: Store) {
  const old = s.items.filter(x => x.done), repos = [...new Set(old.map(x => x.repo))];
  const heads = new Map(await each(repos, 4, async r => [r, new Set((await out(r, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']))?.split('\n') ?? [])] as const));
  return old.filter(x => heads.get(x.repo)?.has(x.branch)).map(x => ({ id: x.id, repo: x.repo, branch: x.branch, ...(x.tag ? { tag: x.tag } : {}), ...(x.agenda ? { agenda: x.agenda } : {}), done: x.done! }));
}
// 보관한 항목(화면 「COMPLETE」 창) — 보관한 날 최근부터 limit 개쯤. 「더 보기」 는 before(이 날보다 앞) — 날짜로 넘기니 같은 날(같은 안건 묶음)은 자르지 않는다.
// q 는 안건 · 브랜치 · 레포 · 메모에서 찾기
export function deployDone(q = '', before?: string, limit = 40, file = DEPLOY_FILE) {
  const needle = q.trim().toLowerCase(), until = before && DAY.test(before) ? before : null;
  const xs = loadStore(file).items.filter(x => x.done && (!until || x.done < until) && (!needle || [x.tag ?? '', x.branch, basename(x.repo), ...x.notes].some(t => t.toLowerCase().includes(needle))))
    .sort((a, b) => b.done!.localeCompare(a.done!));
  const cut = xs.length > limit ? xs.filter(x => x.done! >= xs[limit - 1].done!) : xs;
  return { items: cut, more: cut.length < xs.length ? cut.at(-1)!.done! : null };
}
// ── 런 잇기 — 런이 남긴 레포 칸(edith-repos.json — 워크트리를 만들면 생긴다)을 본 레포 · 브랜치로 바꿔 배포 항목에 붙인다(배포 화면이 결과 화면을 품는다, 2026-10-26).
// via(이슈 → 안건 브랜치)가 있으면 안건 항목 밑 「이슈 줄」(그 런의 레포 상태 issue). 목록에 없는 런 일은 extra(런 하나 = 카드 하나), 보관한 항목의 런은 뺀다.
// 단추(reach 가 적힌 런 단추)는 끝난 런만 — 도는 런은 지금 노드(now)만 ──
// acting — 지금 도는 런 단추(누른 때부터 끝 코드가 찰 때까지), last — 마지막으로 끝난 단추(끝 코드 · 까닭)
export type Act = { label: string; at: number; code: number | null; note?: string; repo?: string };
// path — 이 항목에 해당하는 그 런의 워크트리(레포 줄 단추 row 가 그 레포만 돌게)
// 런 입력 글에서 첫 http(s) 주소 — 끝 문장부호 · 괄호는 뺀다. 다른 스킴(javascript: 등)은 잡지 않는다
export const inputLink = (input: string) => input.match(/https?:\/\/[^\s<>"'`)\]]+/)?.[0].replace(/[.,;:!?]+$/, '');
// link — 런 입력의 첫 http(s) 주소(기획 원문 등). 카드가 그 런 꼬리표(티켓)를 이 주소로 잇는다
export type RunLink = { id: number; title: string; tag?: string; link?: string; state: Run['state']; now?: string; created: number; actions: ReachAction[]; issue?: ReachRepo; path?: string; acting?: Act; last?: Act };
// 런이 지금 하는 노드 — 사람 확인이 먼저
const nowOf = (r: Run) => {
  const at = (st: string[]) => r.steps.filter(s => st.includes(r.nodes[s.key]?.state)).map(s => s.title);
  const wait = at(['blocked', 'check']);
  return wait.length ? `${wait[0]} — 사람 확인` : at(['running', 'sending'])[0] ?? (r.state === 'queued' ? '대기 줄' : r.state === 'stopped' ? '멈춤' : undefined);
};
export async function deployBoard(file = DEPLOY_FILE) {
  const v = await deployView(file), key = (repo: string, branch: string) => `${repo}\0${branch}`;
  const active = new Map(v.items.filter(x => !x.done).map(x => [key(x.repo, x.branch), x.id]));
  const archived = new Set(loadStore(file).items.filter(x => x.done).map(x => key(x.repo, x.branch)));
  const links: Record<string, RunLink[]> = {}, extra: { run: RunLink; repos: ReachRepo[] }[] = [];
  const runs = listRuns().map(r => loadRun(r.id)).filter((r): r is Run => !!r);
  await each(runs, 3, async full => {
    const refs = readRefs(join(RUNS, String(full.id), 'work'));
    if (!refs.length) return;
    const at = await Promise.all(refs.map(async x => {
      const repo = await mainRepo(x.path).catch(() => null);
      const branch = (x.via ?? x.branch ?? (repo ? await out(x.path, ['rev-parse', '--abbrev-ref', 'HEAD']) : null) ?? '').replace(/^origin\//, '');
      return repo && branch ? { via: !!x.via, id: active.get(key(repo, branch)), old: archived.has(key(repo, branch)) } : null;
    }));
    // 레포 상태(git 이 무겁다)는 이슈 줄 · 목록에 없는 런 일에만
    const repos = at.some(a => a && (a.via || (!a.id && !a.old))) ? await runRepos(full) : [];
    const tag = runTag(full), url = inputLink(full.input), done = acted(full.id).map(a => ({ label: a.label, at: a.at, code: a.code, ...(a.note ? { note: a.note } : {}), ...(a.repo ? { repo: a.repo } : {}) }));
    const acting = done.find(a => a.code === null), last = done.find(a => a.code !== null);
    const link = (issue?: ReachRepo, path?: string): RunLink => ({ id: full.id, title: runTitle(full), ...(tag ? { tag } : {}), ...(url ? { link: url } : {}), state: full.state, ...(path ? { path } : {}),
      ...(full.state === 'done' ? {} : { now: nowOf(full) }), created: full.created, actions: full.state === 'done' ? runActions(full) : [], ...(issue ? { issue } : {}),
      ...(acting ? { acting } : {}), ...(last ? { last } : {}) });
    const loose: ReachRepo[] = [];
    at.forEach((a, i) => {
      if (!a) return;
      if (a.id) (links[a.id] ??= []).push(link(a.via ? repos[i] : undefined, refs[i].path));
      else if (!a.old && repos[i]) loose.push(repos[i]);
    });
    if (loose.length) extra.push({ run: link(), repos: loose });
  });
  const items = v.items.map(x => ({ ...x, runs: (links[x.id] ?? []).sort((a, b) => b.id - a.id) }));
  // 단추 목록은 항목마다 따로 만든 것(link)이라 그 항목 브랜치로 막아도 다른 항목에 번지지 않는다
  await each(items, 4, x => markWait(x, x.runs.flatMap(r => r.actions)));
  // 아직 안 들어간 환경(stage · 운영)이면 그 머지 브랜치 상태 — 레포 줄의 「<환경> 머지 준비」 · 「<환경> 에 올리기」 가 본다
  await each(items, 4, async x => {
    const tip = x.state?.tip;
    if (!tip) return;
    for (const [i, e] of v.envs.entries()) {
      const es = x.state!.envs[i];
      if (i === 0 || !es || reached(es) || es.state === 'missing') continue;
      const branch = mergeBranch(x, e), wt = await mergeTree(x.repo, branch);
      es.prep = { branch, ready: !!(await prepared(x, e, tip)), ...(wt && await out(wt, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']) ? { merging: wt } : {}) };
    }
  });
  return { ...v, items, extra: extra.sort((a, b) => b.run.id - a.run.id) };
}
// 단추 ready · until(「merge/{tail}」)을 항목 브랜치로 채워 git 으로 본다 — 그 브랜치에 원본 최신 · 단추 칸(reach 가 「origin/dev」 같은 브랜치면)이 다 들어 있나.
// ready 는 다 들어 있을 때만 켜고(dev 로 푸시), until 은 다 들어 있으면 막는다(dev 머지 준비 — 이미 했다). 막으면 wait 에 까닭.
// 키트가 누를 때 하는 확인(dev 로 푸시 — 머지 브랜치에 원본 최신 · origin/dev)과 같은 기준 — 화면은 미리 막기만, 실제 확인은 키트가 한다
// shortcut: 목록에 없는 런 카드(extra)는 보지 않는다(단추는 켜진 채, 키트가 막는다) — 그 카드에서도 헷갈리면 그 레포 · 브랜치로 같이 본다
export async function markWait(x: { repo: string; branch: string; state?: { tip?: string } }, actions: ReachAction[]) {
  const tip = x.state?.tip, has = async (ref: string) => (await git(x.repo, ['rev-parse', '--verify', '-q', `${ref}^{commit}`])).code === 0;
  const inside = async (a: string, b: string) => (await git(x.repo, ['merge-base', '--is-ancestor', a, b])).code === 0;
  // 빠진 것 — 다 들어 있으면 '', 알 수 없으면(원본 끝 없음 · 이상한 ref) null
  const gap = async (t: string, reach: string) => {
    const ref = t.replace(/\{(branch|tail)\}/g, (_, k: string) => k === 'tail' ? x.branch.split('/').pop()! : x.branch);
    if (!tip || !/^\w[\w./-]*$/.test(ref) || ref.includes('..')) return null;
    if (!(await has(ref))) return `${ref} 가 아직 없다`;
    if (!(await inside(tip, ref))) return `${ref} 에 ${x.branch} 최신이 아직 없다`;
    return reach.includes('/') && await has(reach) && !(await inside(reach, ref)) ? `${ref} 에 ${reach} 최신이 아직 없다` : '';
  };
  for (const a of actions.filter(a => a.ready || a.until)) {
    const need = a.ready ? await gap(a.ready, a.reach) : null, done = a.until ? await gap(a.until, a.reach) : null;
    if (need) a.wait = `${need} — 앞 단추 먼저`;
    else if (done === '') a.wait = `이미 했다 — ${a.until!.replace(/\{tail\}/g, x.branch.split('/').pop()!).replace(/\{branch\}/g, x.branch)} 에 다 들어 있다. 다음 단추로`;
  }
}
// 「최신화」 — 그 항목들(없으면 보관 안 한 것 전부)의 레포를 origin 에서 받는다
export async function deployFetch(ids?: unknown, file = DEPLOY_FILE) {
  const pick = Array.isArray(ids) ? new Set(ids) : null;
  const repos = [...new Set(loadStore(file).items.filter(x => !x.done && (!pick || pick.has(x.id))).map(x => x.repo))];
  const errors = (await each(repos, 3, async r => {
    const x = await git(r, ['fetch', '--prune', '--quiet', 'origin'], 90_000);
    return x.code === 0 ? null : `${basename(r)} — ${(x.stderr || x.stdout).trim().split('\n')[0]}`;
  })).filter((e): e is string => !!e);
  return { repos: repos.length, errors };
}

const md = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}`;
// 배포일 · 연기 · 보관 · 메모 — 같은 안건의 여러 레포를 한 번에(ids). 메모는 항목 하나만
export function editItems(b: { rev?: unknown; ids?: unknown; date?: unknown; deferred?: unknown; done?: unknown; notes?: unknown }, file = DEPLOY_FILE) {
  if (!Array.isArray(b.ids) || !b.ids.length || b.ids.length > 20 || !b.ids.every(i => typeof i === 'string')) throw new Error('고칠 항목이 없다');
  if (b.date !== undefined && b.date !== null && !(typeof b.date === 'string' && DAY.test(b.date))) throw new Error('배포일은 YYYY-MM-DD 또는 비움(미정)');
  if (b.notes !== undefined && (b.ids.length !== 1 || typeof b.notes !== 'string')) throw new Error('메모는 항목 하나씩 고친다');
  const ids = b.ids as string[];
  return change(file, b.rev, s => {
    const xs = s.items.filter(x => ids.includes(x.id));
    if (xs.length !== ids.length) throw new Error('없는 항목이 있다 — 화면이 다시 읽은 뒤 다시');
    for (const x of xs) {
      if (b.date !== undefined && (b.date ?? undefined) !== x.date) { if (b.date) x.date = b.date as string; else delete x.date; note(x, b.date ? `배포일 ${md(b.date as string)} 넣음` : '배포일 미정으로'); }
      if (typeof b.deferred === 'boolean' && b.deferred !== !!x.deferred) { if (b.deferred) x.deferred = true; else delete x.deferred; note(x, b.deferred ? '연기' : '연기 풀림'); }
      if (typeof b.done === 'boolean' && b.done !== !!x.done) { if (b.done) x.done = today(); else delete x.done; note(x, b.done ? '보관(배포 끝)' : '보관에서 되돌림'); }
      if (typeof b.notes === 'string') { x.notes = b.notes.split('\n').flatMap(n => text(n, 2000) ?? []).slice(0, 50); note(x, '메모 고침'); }
    }
  });
}
// 할 일 한 줄 체크 — 화면이 본 상태(was)와 같을 때만
export function checkTask(b: { rev?: unknown; id?: unknown; env?: unknown; text?: unknown; was?: unknown }, file = DEPLOY_FILE) {
  return change(file, b.rev, s => {
    const x = s.items.find(i => i.id === b.id), t = x?.tasks.find(t => t.env === b.env && t.text === b.text);
    if (!x || !t) throw new Error('그 할 일이 없다 — 화면이 다시 읽은 뒤 다시');
    if (t.done !== b.was) throw new Error('그사이 체크가 바뀌었다 — 화면이 다시 읽은 뒤 다시');
    t.done = !t.done;
    note(x, `${t.env} 할 일 ${t.done ? '체크' : '체크 풂'} — ${t.text.slice(0, 60)}`);
  });
}
// 사람이 한 일 한 줄 더하기(패널 「직접 한 일 적기」) — 「배포 전 · 배포 후 — <글>」 로, 이미 한 일이라 체크된 채. 다시 뽑아도 남는다(hand)
export function addTask(b: { rev?: unknown; id?: unknown; env?: unknown; when?: unknown; text?: unknown }, file = DEPLOY_FILE) {
  const t = text(b.text, 900);
  if (!t) throw new Error('적을 글이 비었다');
  if (b.when !== '전' && b.when !== '후') throw new Error('배포 전 · 배포 후 중 하나');
  return change(file, b.rev, s => {
    const x = s.items.find(i => i.id === b.id);
    if (!x) throw new Error('없는 항목이다 — 화면이 다시 읽은 뒤 다시');
    if (!s.envs.some(e => e.name === b.env)) throw new Error(`없는 환경: ${String(b.env)}`);
    const line = `배포 ${b.when} — ${t}`;
    if (x.tasks.some(k => k.env === b.env && k.text === line)) throw new Error('이미 있는 줄이다');
    x.tasks.push({ env: b.env as string, text: line, done: true, hand: true });
    note(x, `${b.env} 할 일 적음 — ${line.slice(0, 60)}`);
  });
}

// ── 배포 조치 뽑기(카드 단추) — 항목마다 공방 훅 on: "prep" 을 돌린다(훅이 deploy-prep 같은 것으로 edith deploy range · block 을 부른다 — 레포마다 몇 분).
// 기다리지 않는다. 도는 중 · 마지막 끝(끝 코드 · 까닭)은 화면이 board 의 prep 으로 본다(EDITH 를 다시 켜면 잊는다). 출력은 DATA_DIR/deploy-logs ──
export type Prep = { at: number; code: number | null; note?: string };
const prepping = new Map<string, Prep>();
export const prepOf = (id: string) => prepping.get(id);
export function prepItems(b: { ids?: unknown }, file = DEPLOY_FILE, hook: ReturnType<typeof deployHook> | null = deployHook('prep')) {   // null — 훅 없음(시험)
  if (!Array.isArray(b.ids) || !b.ids.length || b.ids.length > 20) throw new Error('뽑을 항목이 없다');
  const s = loadStore(file), xs = b.ids.map(id => s.items.find(i => i.id === id && !i.done));
  if (xs.some(x => !x)) throw new Error('없거나 보관한 항목이 있다 — 화면이 다시 읽은 뒤 다시');
  if (!hook) throw new Error('배포 조치를 뽑는 훅이 없다 — 공방 엔진 actions.json 에 on: "prep" 명령을 둔다');
  if ((xs as Item[]).some(x => prepping.get(x.id)?.code === null)) throw new Error('이미 뽑는 중이다');
  const dir = join(dirname(file), 'deploy-logs'), at = Date.now();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const x of xs as Item[]) prepping.set(x.id, { at, code: null });
  void each(xs as Item[], 2, async x => {
    const log = join(dir, `${x.id}-prep-${at}.log`);
    const r = await runHook(hook, { EDITH_DEPLOY_REPO: x.repo, EDITH_DEPLOY_BRANCH: x.branch, EDITH_DEPLOY_ID: x.id }, log, 20 * 60_000);
    let why: string | undefined;
    if (r.code) try { why = lastLine(readFileSync(log, 'utf8')); } catch { /* 기록 없음 */ }
    prepping.set(x.id, { at, code: r.code, ...(why ? { note: why } : {}) });
  });
  return { ok: true, text: `${xs.length}개 레포의 배포 조치를 뽑는 중 — 끝나면 카드에 뜬다` };
}

// 항목 더하기 — 레포는 목록에 이미 있는 레포만(브라우저가 보낸 경로로 git 을 돌리지 않게). 시작 커밋은 지금 운영 브랜치와 갈라진 곳
export async function addItem(b: { rev?: unknown; repo?: unknown; branch?: unknown; tag?: unknown; note?: unknown }, file = DEPLOY_FILE) {
  const s = loadStore(file);
  if (typeof b.repo !== 'string' || !s.items.some(x => x.repo === b.repo)) throw new Error('목록에 있는 레포만 고를 수 있다');
  if (typeof b.branch !== 'string' || !REF.test(b.branch)) throw new Error('브랜치 이름이 이상하다');
  if (s.items.some(x => !x.done && x.repo === b.repo && x.branch === b.branch)) throw new Error(`이미 있다 — ${basename(b.repo)} ${b.branch}`);
  const x = parseItem({ repo: b.repo, branch: b.branch, tag: b.tag, notes: typeof b.note === 'string' ? b.note.split('\n') : [] }, s.envs)!;
  const { tip } = await tipOf(x);
  const start = tip ? await out(x.repo, ['merge-base', s.envs.at(-1)!.ref, tip]) : null;
  if (start) x.start = start;
  note(x, '화면에서 더함');
  return { ...change(file, b.rev, t => { t.items.push(x); }), id: x.id };
}

// 가져오기(edith deploy import) — {"items": [항목 꼴, id · log 없이도]} 로 목록을 통째로 바꾼다(옮기는 동안 몇 번이고 다시). 보관 안 한 항목은 시작 커밋을 지금 정한다
export async function importItems(t: string, file = DEPLOY_FILE) {
  let a: { items?: unknown };
  try { a = JSON.parse(t); } catch { throw new Error('JSON 이 아니다'); }
  if (!Array.isArray(a?.items)) throw new Error('{"items": [...]} 꼴이 아니다');
  const s = loadStore(file), raw = a.items as Record<string, unknown>[];
  const items = raw.flatMap(x => parseItem(x, s.envs) ?? []);
  await each(items.filter(x => !x.done && !x.start), 4, async x => {
    const { tip } = await tipOf(x), start = tip ? await out(x.repo, ['merge-base', s.envs.at(-1)!.ref, tip]) : null;
    if (start) x.start = start;
  });
  for (const x of items) if (!x.log.length) note(x, '가져옴');
  change(file, ANY, t => { t.items = items; });
  return { items: items.length, skipped: raw.length - items.length, active: items.filter(x => !x.done).length };
}

// 다음 환경에 올리기 — 화면은 레포 줄마다 하나씩 보낸다(사용자 결정 2026-10-26 오전 — 안건 단위 한 번에서 바꿈). 여럿을 받으면 레포마다 앞 환경에 다 들어갔나 · 충돌 · 커밋 안 한 변경 · origin 에만 있는 커밋을 먼저 다 보고,
// 하나라도 걸리면 아무 레포도 올리지 않는다. 다 되면 레포마다 브랜치를 --no-ff 머지 커밋으로(작업 트리 없이 merge-tree) 만들어 push(강제 아님).
// 충돌이 있어도 「<환경> 머지 준비」 로 머지 브랜치에서 푼 것(prepared — 원본 끝 · 환경을 다 품었다)이 있으면 그 커밋을 올린다.
// 처음 환경(dev — 머지 브랜치로 검증하고 올린다)은 여기서 올리지 않는다. 마지막 환경(운영)도 올린다(사용자 결정 2026-10-26 오후 — 그전엔 사람이 직접) —
// master 에 push 하면 운영 파이프라인이 바로 돌아서 strictCheck 를 더 본다: 걸리면(hard) 막고, 충돌을 푼 파일에서 빠진 줄은 사람이 확인 창에서 보고 ack 해야 올린다.
// 운영의 「배포 전」 할 일이 남았으면 막는다
// shortcut: push 는 레포마다 따로라 앞 레포를 올린 뒤 뒤 레포 push 가 거절되면(그사이 그 환경이 바뀜) 반만 올라간다 — 그때는 결과에 어느 레포까지 올렸는지 적는다
type Lost = { file: string; side: string; line: string };
export type Strict = { commits: string[]; files: number; conflicts: string[]; hard: string[]; lost: Lost[] };
type Plan = { x: Item; name: string; bad?: string; skip?: string; c?: string; strict?: Strict };
const isAnc = async (repo: string, a: string, b: string) => (await git(repo, ['merge-base', '--is-ancestor', a, b])).code === 0;
const lines = (t: string | null) => t?.split('\n').filter(Boolean) ?? [];
// 충돌을 푼 파일에서 빠진 줄 — 갈라진 곳 뒤 원본이 더한 줄 · 대상이 더한 줄 중 푼 판에 없는 것(글자 · 숫자가 없는 줄은 뺀다)
async function lostLines(repo: string, base: string, into: string, tip: string, c: string, file: string): Promise<Lost[]> {
  const have = new Set((await out(repo, ['show', `${c}:${file}`]) ?? '').split('\n').map(l => l.trim()));
  const added = async (to: string) => [...new Set(lines(await out(repo, ['diff', '-U0', base, to, '--', file])).filter(l => l.startsWith('+') && !l.startsWith('+++')).map(l => l.slice(1).trim()).filter(l => /[\p{L}\p{N}]/u.test(l)))];
  const [mine, theirs] = await Promise.all([added(tip), added(into)]);
  return [...mine.filter(l => !have.has(l)).map(line => ({ file, side: '원본', line })), ...theirs.filter(l => !have.has(l)).map(line => ({ file, side: '운영', line }))].slice(0, 40);
}
// 운영 올리기 확인 — 올릴 커밋 c 가 ① 지금 운영(into) · 원본 끝(tip)을 다 품고 ② 운영과 다른 파일이 원본이 바꾼 파일 안에만 있고 ③ 그 파일에 충돌 표시가 없나(hard),
// ④ 충돌을 푼 파일에서 양쪽이 더한 줄이 빠지지 않았나(lost — 사람이 확인). commits 는 이번에 운영으로 나가는 원본 커밋(머지 빼고)
export async function strictCheck(repo: string, into: string, tip: string, c: string, conflicts: string[]): Promise<Strict> {
  const base = await out(repo, ['merge-base', into, tip]), hard: string[] = [];
  const commits = lines(await out(repo, ['log', '--no-merges', '--format=%h %s', `${into}..${tip}`])).slice(0, 40);
  const mine = new Set(base ? lines(await out(repo, ['diff', '--name-only', base, tip])) : []), changed = lines(await out(repo, ['diff', '--name-only', into, c]));
  if (!(await isAnc(repo, into, c)) || !(await isAnc(repo, tip, c))) hard.push('올릴 커밋이 지금 운영 · 원본 끝을 다 품지 않았다 — 머지 준비를 다시');
  const outside = changed.filter(f => !mine.has(f));
  if (outside.length) hard.push(`원본이 바꾸지 않은 파일이 같이 바뀐다(${outside.length}) — ${outside.slice(0, 6).join(', ')}`);
  if (changed.length) {
    const m = await git(repo, ['grep', '-n', '-I', '-E', '^(<<<<<<<|>>>>>>>)( |$)', c, '--', ...changed.slice(0, 500)]);
    if (m.code === 0) hard.push(`충돌 표시가 남았다 — ${lines(m.stdout).slice(0, 5).map(l => l.split(':').slice(1, 3).join(':')).join(', ')}`);
  }
  const lost = base ? (await Promise.all(conflicts.map(f => lostLines(repo, base, into, tip, c, f)))).flat() : [];
  return { commits, files: changed.length, conflicts, hard, lost };
}
// 레포 하나 — 올릴 커밋(c)을 정하거나 막을 까닭(bad) · 건너뛸 까닭(skip). 운영이면 strict 도
async function planOne(x: Item, s: Store, i: number): Promise<Plan> {
  const env = s.envs[i], prev = s.envs[i - 1], to = env.ref.replace(/^origin\//, ''), last = i === s.envs.length - 1, name = named(x.repo, x.branch);
  const st = await stateOf(x, [prev, env], s.envs.at(-1)!.ref);
  if (st.error) return { x, name, bad: `${name} — ${st.error}` };
  if (st.dirty) return { x, name, bad: `${name} — 워크트리에 커밋 안 한 변경 ${st.dirty}개` };
  if (st.behind) return { x, name, bad: `${name} — origin/${x.branch} 에 이 맥에 없는 커밋 ${st.behind}개 — 받은 뒤 다시` };
  if (st.envs[1]?.state === 'missing') return { x, name, skip: `${name} — ${env.ref} 가 없는 레포라 건너뜀` };
  if (reached(st.envs[1])) return { x, name, skip: `${name} — 이미 ${env.name} 에 있다` };
  if (!reached(st.envs[0])) return { x, name, bad: `${name} — 아직 ${prev.name} 에 다 들어가지 않았다` };
  const into = (await commit(x.repo, env.ref))!, conflicts = await conflictsOf(x.repo, into, st.tip!);
  if (conflicts === null) return { x, name, bad: `${name} — ${env.ref} 와 합쳐 보지 못했다` };
  let c: string | null | undefined;
  if (conflicts.length) {
    c = await prepared(x, env, st.tip!);
    if (!c) return { x, name, bad: `${name} — ${env.name} 와 충돌 ${conflicts.length}곳: ${conflicts.slice(0, 5).join(', ')} — 「${env.name} 머지 준비」 로 먼저 푼다` };
  } else {
    const tree = (await out(x.repo, ['merge-tree', '--write-tree', '--no-messages', into, st.tip!]))?.split('\n')[0];
    c = tree && await out(x.repo, ['commit-tree', tree, '-p', into, '-p', st.tip!, '-m', `Merge branch '${x.branch}' into ${to}`]);
    if (!c) return { x, name, bad: `${name} — 머지 커밋을 만들지 못했다` };
  }
  return { x, name, c, ...(last ? { strict: await strictCheck(x.repo, into, st.tip!, c, conflicts) } : {}) };
}
async function plansOf(b: { ids?: unknown; env?: unknown }, file: string) {
  if (!Array.isArray(b.ids) || !b.ids.length || b.ids.length > 20) throw new Error('올릴 항목이 없다');
  const s = loadStore(file), xs = b.ids.map(id => s.items.find(i => i.id === id && !i.done)), i = s.envs.findIndex(e => e.name === b.env);
  if (xs.some(x => !x)) throw new Error('없거나 보관한 항목이 있다 — 화면이 다시 읽은 뒤 다시');
  if (i <= 0) throw new Error(`${String(b.env)} 은 여기서 올리지 않는다(처음 환경은 머지 브랜치로)`);
  const fetched = await each([...new Set((xs as Item[]).map(x => x.repo))], 3, async r => { const f = await git(r, ['fetch', '--quiet', 'origin'], 90_000); return f.code === 0 ? null : `${basename(r)} 받지 못했다 — ${(f.stderr || f.stdout).trim().split('\n')[0]}`; });
  if (fetched.some(Boolean)) throw new Error(fetched.filter(Boolean).join('\n'));
  // 먼저 다 본다 — 머지 커밋은 만들어 두기만(push 전에는 아무 브랜치도 안 바뀐다)
  return { s, i, env: s.envs[i], plans: await each(xs as Item[], 3, x => planOne(x, s, i)) };
}
// 운영 올리기 확인 창 — 레포마다 나갈 커밋 · 막는 까닭 · 빠진 줄 · 남은 배포 전 할 일(올리지는 않는다)
export async function promoteCheck(b: { ids?: unknown; env?: unknown }, file = DEPLOY_FILE) {
  const { env, plans } = await plansOf(b, file);
  return { env: env.name, repos: plans.map(p => ({ id: p.x.id, name: p.name, ...(p.bad ? { bad: p.bad } : {}), ...(p.skip ? { skip: p.skip } : {}), ...(p.strict ? { strict: p.strict } : {}),
    before: p.x.tasks.filter(t => t.env === env.name && !/^배포 후/.test(t.text) && !t.done).map(t => t.text) })) };
}
export async function promoteMany(b: { ids?: unknown; env?: unknown; ack?: unknown }, file = DEPLOY_FILE) {
  const { s, i, env, plans } = await plansOf(b, file), last = i === s.envs.length - 1, to = env.ref.replace(/^origin\//, '');
  const bad = plans.flatMap(p => {
    if (p.bad) return [p.bad];
    if (!last || !p.c) return [];
    const before = p.x.tasks.filter(t => t.env === env.name && !/^배포 후/.test(t.text) && !t.done);
    return [...(p.strict!.hard.map(h => `${p.name} — ${h}`)), ...(before.length ? [`${p.name} — ${env.name} 배포 전 할 일 ${before.length}개가 체크 안 됐다`] : []),
      ...(p.strict!.lost.length && b.ack !== true ? [`${p.name} — 충돌을 푼 파일에서 빠진 줄 ${p.strict!.lost.length}개 — 확인 창에서 보고 확인한 뒤`] : [])];
  }), skip = plans.flatMap(p => p.skip ? [p.skip] : []);
  if (bad.length) throw new Error([`${env.name} 에 아무 레포도 올리지 않았다`, ...bad, ...skip].join('\n'));
  const done: string[] = [];
  for (const p of plans) {
    if (!p.c) continue;
    const r = await git(p.x.repo, ['push', 'origin', `${p.c}:refs/heads/${to}`], 90_000);
    if (r.code !== 0) throw new Error([`${p.name} — push 거절: ${(r.stderr || r.stdout).trim().split('\n').slice(-1)[0]}`, ...(done.length ? [`앞서 올린 것: ${done.join(', ')}`] : [])].join('\n'));
    change(file, ANY, t => { const y = t.items.find(k => k.id === p.x.id); if (y) note(y, `${env.name} 에 올림(${p.c!.slice(0, 9)})${p.strict?.lost.length ? ` — 빠진 줄 ${p.strict.lost.length}개 확인하고` : ''}`); });
    done.push(`${p.name} → ${env.ref} (${p.c.slice(0, 9)})`);
  }
  return { ok: true, text: [...done, ...skip].join('\n') || '올릴 것이 없다' };
}
// 항목 하나 — 화면 예전 꼴({ id, env })
export const promote = (b: { id?: unknown; env?: unknown }, file = DEPLOY_FILE) => promoteMany({ ids: [b.id], env: b.env }, file);

// ── 충돌 푸는 머지 브랜치(사용자 결정 2026-10-26 — dev 의 merge/<끝> 처럼 stage 도 머지 브랜치에서 풀고 올린다, feature 는 깨끗하게) ──
// merge-<환경>/<원본 끝 토막> — 그 환경(origin/stage) 위에 원본을 --no-ff 로 합친 것. 올리면 환경이 앞당겨지기만(fast-forward) 한다
const mergeBranch = (x: Item, env: Env) => `merge-${env.name}/${x.branch.split('/').pop()}`;
// 그 브랜치를 꺼내 둔 워크트리(없으면 null)
const mergeTree = async (repo: string, branch: string) =>
  (await out(repo, ['worktree', 'list', '--porcelain']))?.split('\n\n').find(e => e.includes(`\nbranch refs/heads/${branch}`))?.match(/^worktree (.+)$/m)?.[1] ?? null;
// 머지 브랜치가 원본 끝 · 환경을 다 품었으면 그 커밋 — 충돌을 풀어 머지 커밋까지 마쳤다
async function prepared(x: Item, env: Env, tip: string) {
  const c = await out(x.repo, ['rev-parse', '--verify', '-q', `${mergeBranch(x, env)}^{commit}`]);
  if (!c) return null;
  const inside = async (a: string) => (await git(x.repo, ['merge-base', '--is-ancestor', a, c])).code === 0;
  return await inside(tip) && await inside(env.ref) ? c : null;
}
// 충돌 푸는 Claude — 머지 워크트리에 새 herdr 워크스페이스를 열고 Claude 를 띄워 일을 보낸다. 못 띄우면 pane 과 까닭만(머지는 그 자리에 남는다)
async function openClaude(cwd: string, label: string, text: string): Promise<{ pane: string; error?: string }> {
  const { newWorkspace, start, promptAgent } = await import('./herdr.ts'), pane = await newWorkspace(label, cwd);
  try { await start(pane, 'claude'); await promptAgent(pane, text); return { pane }; }
  catch (e) { return { pane, error: (e as Error).message.split('\n')[0] }; }
}
// 「stage 머지 준비」 — 레포 하나를 그 환경의 머지 브랜치에서 합친다. 자리는 항목 워크트리 옆(<끝>-<환경>-merge), 워크트리가 없으면 DATA_DIR/merges/<레포>.
// 머지 브랜치를 꺼낸 워크트리가 이미 있으면 그 자리에서 환경 최신을 받고 원본을 다시 합친다(앞에서 푼 것은 남는다). 충돌이 남으면 새 Claude pane 이 푼다 — push 는 안 한다(「stage 에 올리기」 가)
export async function prepareMerge(b: { id?: unknown; env?: unknown }, file = DEPLOY_FILE, claude = openClaude) {
  const s = loadStore(file), x = s.items.find(i => i.id === b.id && !i.done), i = s.envs.findIndex(e => e.name === b.env);
  if (!x) throw new Error('없거나 보관한 항목이다 — 화면이 다시 읽은 뒤 다시');
  if (i <= 0 || !/^\w[\w-]*$/.test(s.envs[i].name)) throw new Error(`${String(b.env)} 은 여기서 준비하지 않는다(처음 환경은 머지 브랜치로)`);
  const env = s.envs[i], prev = s.envs[i - 1], to = env.ref.replace(/^origin\//, ''), name = named(x.repo, x.branch), mb = mergeBranch(x, env);
  const f = await git(x.repo, ['fetch', '--quiet', 'origin'], 90_000);
  if (f.code !== 0) throw new Error(`${name} 받지 못했다 — ${(f.stderr || f.stdout).trim().split('\n')[0]}`);
  const st = await stateOf(x, [prev, env], s.envs.at(-1)!.ref);
  if (st.error) throw new Error(`${name} — ${st.error}`);
  if (st.behind) throw new Error(`${name} — origin/${x.branch} 에 이 맥에 없는 커밋 ${st.behind}개 — 받은 뒤 다시`);
  if (!reached(st.envs[0])) throw new Error(`${name} — 아직 ${prev.name} 에 다 들어가지 않았다`);
  if (reached(st.envs[1])) throw new Error(`${name} — 이미 ${env.name} 에 있다`);
  if (await prepared(x, env, st.tip!)) return { ok: true, text: `이미 준비됐다 — ${mb} 에 다 들어 있다. 「${env.name} 에 올리기」` };
  const held = await mergeTree(x.repo, mb), wt = held ?? join(st.worktree ? dirname(st.worktree) : join(DATA_DIR, 'merges', basename(x.repo)), `${x.branch.split('/').pop()}-${env.name}-merge`);
  if (held && await out(held, ['status', '--porcelain'])) throw new Error(`${name} — 머지 워크트리(${held})에 커밋 안 한 변경 · 머지 중인 파일이 있다 — 그 Claude pane 을 보거나 정리한 뒤`);
  // 새로 만든 머지 브랜치는 환경 끝에서 시작하니 원본만 합친다. 있던 것은 환경 최신부터 받는다 — 거기서 충돌하면 원본 합치기는 Claude 가 이어서
  const fresh = !held && !(await out(x.repo, ['rev-parse', '--verify', '-q', `refs/heads/${mb}`]));
  if (!held) {
    mkdirSync(dirname(wt), { recursive: true });
    const a = await git(x.repo, ['worktree', 'add', ...(fresh ? ['-b', mb, wt, env.ref] : [wt, mb])]);
    if (a.code !== 0) throw new Error(`${name} — 머지 워크트리를 못 만들었다: ${(a.stderr || a.stdout).trim().split('\n')[0]}`);
  }
  const steps: [string[], string][] = [...(fresh ? [] : [[['merge', '--no-edit', env.ref], `${env.ref} 받기`] as [string[], string]]),
    [['merge', '--no-ff', '-m', `Merge branch '${x.branch}' into ${to}`, st.tip!], `${x.branch} 합치기`]];
  for (const [k, [args, what]] of steps.entries()) {
    const m = await git(wt, args, 60_000);
    if (m.code === 0) continue;
    const files = (await out(wt, ['diff', '--name-only', '--diff-filter=U']))?.split('\n').filter(Boolean) ?? [];
    if (!files.length) { await git(wt, ['merge', '--abort']); throw new Error(`${name} — ${what} 실패: ${(m.stderr || m.stdout).trim().split('\n')[0]}`); }
    const rest = steps.slice(k + 1).map(([a]) => `git ${a.map(v => v.includes(' ') ? `"${v}"` : v).join(' ')}`);
    const c = await claude(wt, `⇄ ${basename(x.repo)} ${env.name} 충돌`, [
      `[EDITH 배포 · ${env.name} 머지 준비] ${wt} 는 ${mb} 브랜치다 — ${env.ref} 위에 ${x.branch} 를 합쳐 ${env.name} 로 올릴 판을 만드는 중이다(${what}에서 충돌).`,
      `충돌 파일: ${files.join(', ')}`,
      '1. 충돌 파일만 푼다 — 양쪽(그 환경에 이미 있는 것 · 이 브랜치가 바꾼 것) 의도를 다 살린다. 다른 파일은 고치지 않는다. 양쪽 로직을 새로 짜야 하거나 어느 쪽이 맞는지 모르겠으면 멈추고 사람에게 묻는다.',
      `2. 푼 파일을 git add 하고 git commit --no-edit 로 머지를 마친다.${rest.length ? ` 이어서 ${rest.join(' · ')} 도 한다(충돌이 나면 같은 방식으로).` : ''}`,
      `3. 바뀐 파일을 그 레포 방식으로 검사한다(문법 검사 · 린트 · 빌드 — 의존성 폴더가 없으면 ${st.worktree ?? x.repo} 의 것을 링크해 쓴다). 실패하면 고치지 말고 멈춰 알린다.`,
      `4. push 하지 않는다 — 사람이 EDITH 배포 화면 「${env.name} 에 올리기」 로 올린다. 끝나면 파일마다 「파일 · 고른 방식 · 이유」 한 줄씩 답한다.`,
      ...(i === s.envs.length - 1 ? ['5. 운영(이 브랜치가 운영 파이프라인으로 바로 나간다)이라 더 엄격하게 — 양쪽이 더한 줄은 지우지 않는다(같은 자리를 둘 다 고쳤으면 둘 다 살아 있게 합친다), 충돌 파일 밖은 한 글자도 바꾸지 않는다, 검사가 안 되면(의존성 · 도구 없음) 「검사 못 함」 이라고 답한다. 조금이라도 애매하면 멈추고 묻는다. 올리기 확인 창이 빠진 줄 · 바뀐 파일 범위를 다시 본다.'] : []),
    ].join('\n'));
    change(file, ANY, t => { const y = t.items.find(q => q.id === x.id); if (y) note(y, `${env.name} 머지 준비 — 충돌 ${files.length}곳, Claude(${c.pane})`); });
    return { ok: true, pane: c.pane, text: c.error ? `충돌 ${files.length}곳 — Claude 를 띄우지 못했다(${c.error}). pane ${c.pane} 에서 직접 풀거나 다시` : `충돌 ${files.length}곳(${files.join(', ')}) — 새 Claude pane(${c.pane})이 ${wt} 에서 푼다. 끝나면 「${env.name} 에 올리기」 가 켜진다` };
  }
  change(file, ANY, t => { const y = t.items.find(q => q.id === x.id); if (y) note(y, `${env.name} 머지 준비 — 충돌 없이 합침`); });
  return { ok: true, text: `충돌 없이 합쳤다 — ${mb}. 「${env.name} 에 올리기」` };
}

// ── CLI(edith deploy …) — 스킬 · 키트가 쓴다. 레포는 그 안의 아무 경로(워크트리여도) — 본 체크아웃(공통 .git 의 부모)으로 바꿔 찾는다 ──
export async function mainRepo(path: string) {
  const d = isAbsolute(path) ? await out(path, ['rev-parse', '--path-format=absolute', '--git-common-dir']) : null;
  if (!d) throw new Error(`git 레포 경로가 아니다(절대 경로로): ${path}`);
  return dirname(d);
}
const find = (s: Store, repo: string, branch: string) => s.items.find(x => !x.done && x.repo === repo && x.branch === branch);
export const named = (repo: string, branch: string) => `${basename(repo)} ${branch}`;
// 그 레포 · 브랜치 항목을 잠금 안에서 고친다 — 없으면 오류(먼저 add)
async function onItem(path: string, branch: string, f: (x: Item, s: Store) => string, file: string) {
  const repo = await mainRepo(path);
  let said = '';
  change(file, ANY, s => {
    const x = find(s, repo, branch);
    if (!x) throw new Error(`배포 목록에 ${named(repo, branch)} 이 없다 — 먼저 edith deploy add`);
    said = f(x, s);
  });
  return said;
}

// 등록(워크트리를 만드는 스킬) — 이미 있으면 거절. 시작 커밋은 지금 운영 브랜치와 갈라진 곳
// ticket — 자기 티켓, agenda — 안건 키(안건이면 자기 티켓, 안건 QA 이슈면 상위 안건). 같은 agenda 는 화면에서 한 카드
export async function cliAdd(path: string, branch: string, o: { tag?: string; notes?: string[]; ticket?: string; agenda?: string }, file = DEPLOY_FILE) {
  if (!REF.test(branch)) throw new Error(`브랜치 이름이 이상하다: ${branch}`);
  for (const k of [o.ticket, o.agenda]) if (k !== undefined && !KEY.test(k)) throw new Error(`티켓 키 꼴이 아니다(PROJ-123 · ISSUE-45): ${k}`);
  const repo = await mainRepo(path), s0 = loadStore(file);
  const x = parseItem({ repo, branch, tag: o.tag, notes: o.notes ?? [], ticket: o.ticket, agenda: o.agenda }, s0.envs)!;
  const { tip } = await tipOf(x), start = tip ? await out(repo, ['merge-base', s0.envs.at(-1)!.ref, tip]) : null;
  if (start) x.start = start;
  note(x, '등록');
  change(file, ANY, s => {
    if (find(s, repo, branch)) throw new Error(`이미 있다 — ${named(repo, branch)}`);
    s.items.push(x);
  });
  return `배포 목록에 ${named(repo, branch)} 등록${x.tag ? ` [${x.tag}]` : ''}`;
}
// 이름 · 티켓 · 안건 키 바꾸기 — 준 것만(빈 글이면 지운다)
export const cliSet = (path: string, branch: string, o: { tag?: string; ticket?: string; agenda?: string }, file = DEPLOY_FILE) => onItem(path, branch, x => {
  for (const k of ['ticket', 'agenda'] as const) if (o[k] && !KEY.test(o[k]!)) throw new Error(`티켓 키 꼴이 아니다(PROJ-123 · ISSUE-45): ${o[k]}`);
  const did: string[] = [];
  for (const k of ['tag', 'ticket', 'agenda'] as const) {
    if (o[k] === undefined) continue;
    const v = k === 'tag' ? text(o[k], 60) : o[k] || undefined;
    if (v === x[k]) continue;
    if (v) x[k] = v; else delete x[k];
    did.push(`${k} ${v ?? '지움'}`);
  }
  if (did.length) note(x, `바꿈 — ${did.join(' · ')}`);
  return `${named(x.repo, x.branch)} ${did.length ? did.join(' · ') : '그대로'}`;
}, file);
// 메모 한 줄 더하기(안건 QA 이슈 — 안건 항목에 「ISSUE-<번호>: <요약>」) — 같은 줄이 있으면 그대로
export const cliNote = (path: string, branch: string, line: string, file = DEPLOY_FILE) => onItem(path, branch, x => {
  const t = text(line, 2000);
  if (!t) throw new Error('메모가 비었다');
  if (x.notes.includes(t)) return `${named(x.repo, x.branch)} — 이미 있는 메모`;
  x.notes.push(t); note(x, `메모 더함 — ${t.slice(0, 60)}`);
  return `${named(x.repo, x.branch)} 메모 더함`;
}, file);
// 배포 조치 한 줄 더하기(구현 스킬의 배포 체크리스트) — env 를 안 주면 첫 환경(dev — 머지 브랜치로 올린다)을 뺀 모든 환경에. 같은 줄은 그대로
export const cliTask = (path: string, branch: string, line: string, env?: string, file = DEPLOY_FILE) => onItem(path, branch, (x, s) => {
  const t = text(line, 1000), envs = env ? [env] : s.envs.slice(1).map(e => e.name);
  if (!t) throw new Error('할 일이 비었다');
  if (env && !s.envs.some(e => e.name === env)) throw new Error(`없는 환경: ${env} (${s.envs.map(e => e.name).join(' · ')})`);
  const add = envs.filter(e => !x.tasks.some(k => k.env === e && k.text === t));
  for (const e of add) x.tasks.push({ env: e, text: t, done: false });
  if (add.length) note(x, `배포 조치 더함(${add.join(' · ')}) — ${t.slice(0, 60)}`);
  return `${named(x.repo, x.branch)} 배포 조치 ${add.length ? `더함 — ${add.join(' · ')}` : '이미 있음'}`;
}, file);
// 배포 조치를 뽑을 범위(deploy-prep) — 블록이 있으면 그 시작(브랜치 조상이어야), 없으면 운영 브랜치와 갈라진 곳. 운영에 다 들어갔으면 거절(빈 목록으로 덮지 않게).
// dir 은 그 항목의 복사 파일(SQL 등) · 블록 파일을 둘 곳
export async function cliRange(path: string, branch: string, file = DEPLOY_FILE) {
  const repo = await mainRepo(path), s = loadStore(file), x = find(s, repo, branch), prod = s.envs.at(-1)!.ref;
  if (!x) throw new Error(`배포 목록에 ${named(repo, branch)} 이 없다 — 먼저 edith deploy add`);
  const { local, tip } = await tipOf(x);
  if (!tip) throw new Error(`브랜치 ${branch} 가 이 맥에도 origin 에도 없다`);
  const isAnc = async (a: string, b: string) => (await git(repo, ['merge-base', '--is-ancestor', a, b])).code === 0;
  let base = x.block?.base;
  if (base && !(await isAnc(base, tip))) throw new Error(`블록의 범위 시작 ${base.slice(0, 7)} 이 ${branch} 조상이 아니다 — 리베이스됐으면 edith deploy block 으로 새로`);
  if (!base) {
    if (await isAnc(tip, prod)) throw new Error(`${branch} 는 이미 ${prod} 에 다 들어 있다 — 뽑을 범위가 없다`);
    base = await out(repo, ['merge-base', prod, tip]) ?? undefined;
    if (!base) throw new Error(`${prod} 와 공통 조상이 없다`);
  }
  const dir = filesDir(repo, branch, file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return { path: repo, ref: local ? branch : `origin/${branch}`, base, end: tip, dir };
}
// 배포 조치 복사 파일(SQL 등 — deploy-prep 이 cliRange 의 dir 에 쓴다)의 자리
export const filesDir = (repo: string, branch: string, file = DEPLOY_FILE) => join(dirname(file), 'deploy-files', basename(repo), branch.replaceAll('/', '__'));
// 그 항목의 복사 파일 하나(패널 「보기」 — 사람이 DB 에 직접 넣는 SQL). 이름만 받아 그 항목 자리 안의 것만(realpath), 글 파일 1MB 까지
export function deployFile(id: unknown, name: unknown, file = DEPLOY_FILE) {
  const x = loadStore(file).items.find(i => i.id === id), gone = () => new Error('없는 파일이다');
  if (!x || typeof name !== 'string' || !/^[\w-][\w.-]{0,99}$/.test(name)) throw gone();
  let dir: string, p: string;
  try { dir = realpathSync(filesDir(x.repo, x.branch, file)); p = realpathSync(join(dir, name)); } catch { throw gone(); }
  if (!p.startsWith(dir + sep) || !statSync(p).isFile() || statSync(p).size > 1024 * 1024) throw gone();
  const t = readFileSync(p, 'utf8');
  if (t.includes('\0')) throw gone();
  return { name, text: t };
}
// 「변경」 — 이 항목 브랜치가 운영(마지막 환경)에 더할 것. 워크트리가 어느 브랜치를 꺼냈든 상관없이 커밋끼리 본다:
// 브랜치 끝(이 맥 → 없으면 origin)과 운영이 갈라진 곳부터 그 끝까지 + 그 사이 커밋. 커밋 안 한 변경은 들지 않아 수만 알린다. 2MB 넘으면 자른다
export async function deployDiff(id: unknown, file = DEPLOY_FILE) {
  const s = loadStore(file), x = s.items.find(i => i.id === id);
  if (!x) throw new Error('없는 항목이다');
  const base = s.envs.at(-1)!.ref, [{ tip, local }, at, wt] = await Promise.all([tipOf(x), commit(x.repo, base), worktreeOf(x.repo, x.branch)]);
  if (!tip) throw new Error(`브랜치 ${x.branch} 가 이 맥에도 origin 에도 없다`);
  if (!at) throw new Error(`${base} 가 없다 — 「새로 받기」 뒤 다시`);
  const from = await out(x.repo, ['merge-base', at, tip]);
  if (!from) throw new Error(`${x.branch} 와 ${base} 가 갈라진 곳이 없다`);
  const [d, log, dirty] = await Promise.all([git(x.repo, ['diff', '--no-color', '--no-ext-diff', from, tip]), out(x.repo, ['log', '--format=%h %s', `${from}..${tip}`]), wt ? out(wt, ['status', '--porcelain']) : null]);
  if (d.code) throw new Error(`git diff 실패 — ${d.stderr.split('\n')[0]}`);
  const max = 2 * 1024 * 1024;
  return { name: basename(x.repo), branch: local ? x.branch : `origin/${x.branch}`, base, from: from.slice(0, 7), commits: log ? log.split('\n').slice(0, 100) : [],
    dirty: dirty ? dirty.split('\n').filter(Boolean).length : 0, text: d.stdout.length > max ? `${d.stdout.slice(0, max)}\n… (2MB 에서 잘림)\n` : d.stdout };
}
// 배포 조치 바꾸기(deploy-prep) — 블록 파일 {"base", "end", "tasks": {"<env>": ["<할 일>"]}, "notes"?: ["<메모>"]}. 준 환경의 할 일을 통째로 바꾸고, 같은 환경 · 같은 글이면 체크를 살린다
export async function cliBlock(path: string, branch: string, raw: string, file = DEPLOY_FILE) {
  let b: { base?: unknown; end?: unknown; tasks?: unknown; notes?: unknown };
  try { b = JSON.parse(raw); } catch { throw new Error('블록 파일이 JSON 이 아니다'); }
  if (typeof b.base !== 'string' || !SHA.test(b.base) || typeof b.end !== 'string' || !SHA.test(b.end)) throw new Error('블록에 base · end(커밋 해시)가 없다');
  if (!b.tasks || typeof b.tasks !== 'object' || Array.isArray(b.tasks)) throw new Error('블록 tasks 는 {"<환경>": ["<할 일>"]}');
  const tasks = b.tasks as Record<string, unknown>, notes = Array.isArray(b.notes) ? b.notes : [];
  return onItem(path, branch, (x, s) => {
    const bad = Object.keys(tasks).filter(e => !s.envs.some(v => v.name === e) || !Array.isArray(tasks[e]));
    if (bad.length) throw new Error(`없는 환경이거나 목록이 아니다: ${bad.join(', ')}`);
    const was = new Set(x.tasks.filter(t => t.done).map(t => `${t.env}\n${t.text}`));
    const next = Object.entries(tasks).flatMap(([env, xs]) => (xs as unknown[]).flatMap(t => text(t, 1000) ?? []).map(t => ({ env, text: t, done: was.has(`${env}\n${t}`) })));
    x.tasks = [...x.tasks.filter(t => !(t.env in tasks) || (t.hand && !next.some(n => n.env === t.env && n.text === t.text))), ...next].slice(0, 100);
    x.block = { base: b.base as string, end: b.end as string, made: md(today()), ...(notes.length ? { notes: notes.flatMap(n => text(n, 1000) ?? []).slice(0, 30) } : {}) };
    note(x, `배포 조치 다시 뽑음 — ${Object.entries(tasks).map(([e, xs]) => `${e} ${(xs as unknown[]).length}`).join(' · ')}`);
    return `${named(x.repo, x.branch)} 배포 조치 — ${next.length}줄(살린 체크 ${next.filter(t => t.done).length})`;
  }, file);
}
// 할 일 체크(키트 결과 체크) — 그 환경 · 그 글이 하나일 때
export const cliCheck = (path: string, branch: string, env: string, line: string, done: boolean, file = DEPLOY_FILE) => onItem(path, branch, x => {
  const t = x.tasks.find(k => k.env === env && k.text === line);
  if (!t) throw new Error(`${named(x.repo, x.branch)} 에 ${env} 「${line.slice(0, 60)}」 할 일이 없다`);
  if (t.done === done) return '이미 그렇다';
  t.done = done; note(x, `${env} 할 일 ${done ? '체크' : '체크 풂'} — ${line.slice(0, 60)}`);
  return `${named(x.repo, x.branch)} ${env} 「${line.slice(0, 40)}」 ${done ? '체크' : '체크 풂'}`;
}, file);
// 보관(정리 스킬 — 운영에 다 들어가 뒷정리) — 날짜는 머지일(없으면 오늘)
export const cliDone = (path: string, branch: string, date?: string, file = DEPLOY_FILE) => onItem(path, branch, x => {
  if (date !== undefined && !DAY.test(date)) throw new Error('날짜는 YYYY-MM-DD');
  x.done = date ?? today(); note(x, `보관(배포 끝 ${md(x.done)})`);
  return `${named(x.repo, x.branch)} 보관(${x.done})`;
}, file);
// 지우기(키트 버리기 — 안 하기로 한 일). 기록도 같이 사라진다
export async function cliDrop(path: string, branch: string, file = DEPLOY_FILE) {
  const repo = await mainRepo(path);
  let gone = false;
  change(file, ANY, s => { const n = s.items.length; s.items = s.items.filter(x => !(x.done === undefined && x.repo === repo && x.branch === branch)); gone = s.items.length < n; });
  return gone ? `${named(repo, branch)} 지움` : `${named(repo, branch)} 은 배포 목록에 없다 — 그대로`;
}
// 보기(스킬 · 키트가 읽는다) — 레포 · 브랜치를 주면 그 항목 하나(없으면 null), 아니면 보관 안 한 것 전부
export async function cliShow(path?: string, branch?: string, file = DEPLOY_FILE) {
  const s = loadStore(file);
  if (!path) return s.items.filter(x => !x.done);
  const repo = await mainRepo(path);
  return branch ? find(s, repo, branch) ?? null : s.items.filter(x => !x.done && x.repo === repo);
}
