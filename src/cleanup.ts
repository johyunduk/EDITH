// 정리 — 운영까지 다 나간 안건의 워크트리 · herdr 워크스페이스 · 로컬 브랜치를 치우고 보관한다(배포 화면 카드 「정리」, 보관했는데 남은 것은 「Complete」 의 「남은 n개 정리」).
// 브랜치마다 「코드가 들어갔나」 를 해시가 아니라 내용으로 본다 — 들어갔어야 할 곳(into)에 그 브랜치를 합쳐 본 트리가 into 트리와 같으면 들어간 것(체리픽 · 스쿼시도).
// 치우는 것: 원본(→ 운영), 그 원본에 합친 이슈 브랜치(런 edith-repos.json 의 via → 원본), 첫 환경 머지 브랜치 merge/<끝>(→ dev — 공방 키트 「dev 머지 준비」 꼴),
// 가운데 환경 머지 브랜치 merge-<환경>/<끝>(→ 그 환경 — 「stage 머지 준비」). 원격 브랜치 · 레포 본 체크아웃 · 런 기록은 남긴다.
// 걸리면(코드가 덜 들어감 · 커밋 안 한 변경 · stash · 일하는 워크스페이스 · 엔진 훅이 막음) 그 항목은 아무것도 지우지 않는다 — 미리보기(cleanPlan)와 정리(cleanRun)가 같은 확인.
// 엔진 몫(작업 문서 · 외부 기록 확인 · 런 안 사본 같은 것)은 공방 훅 on: "cleanup" 이 한다: EDITH_CLEAN_MODE=check 면 확인만 — 표준 출력 {"lines": [{what, ref, parts?, ok, check}]},
// run 이면 치운다(EDITH 쪽 정리 전에 돈다 — 끝 코드 0 이 아니면 그 항목은 멈춘다). 값은 환경 변수로만: EDITH_CLEAN_REPO · _BRANCH · _WORKTREES(줄마다) · _RUNS(쉼표) · EDITH_DEPLOY_ID
import { mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';
import { ANY, change, commit, DEPLOY_FILE, git, loadStore, mainRepo, note, out, stateOf, today, worktreeOf, type Item, type Store } from './deploy.ts';
import { closeWorkspace, spaces } from './herdr.ts';
import { each } from './reach.ts';
import { readRefs } from './repos.ts';
import { deployHook, listRuns, RUNS, runHook, type RunAction } from './runner.ts';
import { lastLine } from './timeline.ts';

export type Line = { what: string; ref: string; parts?: string; ok: boolean; check: string };
export type Space = { id: string; label: string; busy: boolean; home?: string; cwds: string[] };
type Target = { what: string; branch: string; local: boolean; worktree?: string; spaces: { id: string; label: string }[] };
export type CleanPlan = { id: string; repo: string; name: string; branch: string; tag?: string; agenda?: string; done?: string; runs: number[]; lines: Line[]; hook: Line[]; targets: Target[]; ok: boolean };   // hook — 엔진 훅 확인 줄(lines 에도 들어 있다)
type Hook = { dir: string; action: RunAction } | null | undefined;   // null — 훅 없음(시험)

const label = (ref: string) => ref.replace(/^origin\//, '');
const under = (p: string, dir: string) => p === dir || p.startsWith(dir + sep);
// 코드가 into 에 다 들어갔나 — into 에 ref 를 합친 트리가 into 트리 그대로면 true. 충돌이면 모른다(false), into 가 없으면 null
export async function contentIn(repo: string, into: string, ref: string) {
  const t = await out(repo, ['rev-parse', '--verify', '-q', `${into}^{tree}`]);
  if (!t) return null;
  const r = await git(repo, ['merge-tree', '--write-tree', '--no-messages', into, ref]);
  return r.code === 0 && r.stdout.trim().split('\n')[0] === t;
}
// 그 워크트리 워크스페이스 — herdr 워크트리 자리가 그 안이거나 pane 이 모두 그 안. 일부 pane 만 안이면 닫지 않고 걸린다(다른 일도 하는 워크스페이스)
export function spacesOf(all: Space[], wt: string) {
  const mine = all.filter(s => (s.home && under(s.home, wt)) || (s.cwds.length > 0 && s.cwds.every(c => under(c, wt))));
  return { mine, mixed: all.filter(s => !mine.includes(s) && s.cwds.some(c => under(c, wt))) };
}
// 그 항목에 이어진 런과, 그 원본에 합친 이슈 브랜치(런 edith-repos.json 의 via)
async function linked(x: Item) {
  const runs = new Set<number>(), issues = new Set<string>();
  for (const r of listRuns()) for (const ref of readRefs(join(RUNS, String(r.id), 'work'))) {
    if (await mainRepo(ref.path).catch(() => null) !== x.repo) continue;
    if (ref.via && label(ref.via) === x.branch && ref.branch) { issues.add(label(ref.branch)); runs.add(r.id); }
    else if (ref.branch && label(ref.branch) === x.branch) runs.add(r.id);
  }
  return { runs: [...runs], issues: [...issues] };
}
const hookEnv = (p: CleanPlan, mode: 'check' | 'run') => ({ EDITH_CLEAN_MODE: mode, EDITH_CLEAN_REPO: p.repo, EDITH_CLEAN_BRANCH: p.branch, EDITH_DEPLOY_ID: p.id,
  EDITH_CLEAN_WORKTREES: p.targets.flatMap(t => t.worktree ?? []).join('\n'), EDITH_CLEAN_RUNS: p.runs.join(',') });
const logOf = (file: string, id: string, what: string) => { const d = join(dirname(file), 'deploy-logs'); mkdirSync(d, { recursive: true, mode: 0o700 }); return join(d, `${id}-${what}-${Date.now()}.log`); };
const why = (log: string, code: number) => { try { return lastLine(readFileSync(log, 'utf8')) ?? `끝 코드 ${code}`; } catch { return `끝 코드 ${code}`; } };
// 훅 확인 출력 — 틀린 줄은 버린다
export function parseLines(t: string): Line[] {
  let a: { lines?: unknown };
  try { a = JSON.parse(t.trim().split('\n').filter(Boolean).at(-1) ?? ''); } catch { return []; }
  return Array.isArray(a?.lines) ? (a.lines as Record<string, unknown>[]).flatMap(l => typeof l?.what === 'string' && typeof l.ref === 'string' && typeof l.check === 'string' && typeof l.ok === 'boolean'
    ? [{ what: l.what.slice(0, 40), ref: l.ref.slice(0, 200), ...(typeof l.parts === 'string' ? { parts: l.parts.slice(0, 300) } : {}), ok: l.ok, check: l.check.slice(0, 300) }] : []).slice(0, 20) : [];
}

// reuse — 앞 미리보기의 훅 확인 줄(정리 때 느린 확인을 다시 돌리지 않게)
async function planOne(x: Item, s: Store, sp: Space[], hook: Hook, file: string, reuse?: Line[]): Promise<CleanPlan> {
  const envs = s.envs, tail = x.branch.split('/').pop()!, { runs, issues } = await linked(x);
  const own = await commit(x.repo, `refs/heads/${x.branch}`) ? x.branch : `origin/${x.branch}`;
  const cands = [{ what: '원본', branch: x.branch, into: envs.at(-1)!.ref }, ...issues.map(i => ({ what: '이슈', branch: i, into: own })),
    { what: `${envs[0].name} 머지`, branch: `merge/${tail}`, into: envs[0].ref }, ...envs.slice(1, -1).map(e => ({ what: `${e.name} 머지`, branch: `merge-${e.name}/${tail}`, into: e.ref }))];
  const stash = (await out(x.repo, ['stash', 'list', '--format=%gs']))?.split('\n') ?? [];
  const lines: Line[] = [], targets: Target[] = [];
  for (const c of cands) {
    const local = !!(await commit(x.repo, `refs/heads/${c.branch}`)), wt = await worktreeOf(x.repo, c.branch);
    if (!local && !wt) continue;
    const { mine, mixed } = wt ? spacesOf(sp, wt) : { mine: [], mixed: [] };
    const has = local ? await contentIn(x.repo, c.into, c.branch) : true, dirty = wt ? (await out(wt, ['status', '--porcelain']))?.split('\n').filter(Boolean).length ?? 0 : 0;
    const bad = wt === x.repo ? '레포 본 체크아웃에 꺼내져 있다 — 다른 브랜치로 바꾼 뒤'
      : has === null ? `${c.into} 가 없다` : !has ? `${label(c.into)} 에 아직 없는 변경이 있다`
      : dirty ? `커밋 안 한 파일 ${dirty}` : stash.some(l => l.startsWith(`WIP on ${c.branch}:`) || l.startsWith(`On ${c.branch}:`)) ? 'stash 가 남아 있다'
      : mine.find(m => m.busy) ? `워크스페이스 「${mine.find(m => m.busy)!.label}」 에서 일하는 중` : mixed[0] ? `워크스페이스 「${mixed[0].label}」 의 pane 일부가 이 워크트리에 있다 — 옮기거나 닫은 뒤` : '';
    targets.push({ what: c.what, branch: c.branch, local, ...(wt ? { worktree: wt } : {}), spaces: mine.map(m => ({ id: m.id, label: m.label })) });
    lines.push({ what: c.what, ref: c.branch, parts: [wt ? `워크트리 ${basename(wt)}` : '', ...mine.map(m => `워크스페이스 「${m.label}」`), local ? '로컬 브랜치' : ''].filter(Boolean).join(' · '),
      ok: !bad, check: bad || `코드 ${label(c.into)} 에 있음` });
  }
  const p: CleanPlan = { id: x.id, repo: x.repo, name: basename(x.repo), branch: x.branch, ...(x.tag ? { tag: x.tag } : {}), ...(x.agenda ? { agenda: x.agenda } : {}), ...(x.done ? { done: x.done } : {}), runs, lines, hook: [], targets, ok: false };
  if (hook && targets.length) {
    if (reuse) p.hook = reuse;
    else {
      const log = logOf(file, x.id, 'clean-check'), r = await runHook(hook, hookEnv(p, 'check'), log, 5 * 60_000);
      p.hook = r.code ? [{ what: '정리 훅', ref: hook.action.label, ok: false, check: why(log, r.code) }] : parseLines(r.out);
    }
    lines.push(...p.hook);
  }
  if (!targets.length) lines.push({ what: '정리', ref: x.branch, ok: true, check: '치울 워크트리 · 브랜치가 없다 — 보관만' });
  return { ...p, ok: lines.every(l => l.ok) };
}
const idsOf = (b: { ids?: unknown }) => {
  if (!Array.isArray(b.ids) || !b.ids.length || b.ids.length > 20 || !b.ids.every(i => typeof i === 'string')) throw new Error('정리할 항목이 없다');
  return b.ids as string[];
};
// 미리보기 — 항목마다 치울 것과 확인. 보관한 항목도 받는다(남은 것 정리)
export async function cleanPlan(b: { ids?: unknown }, file = DEPLOY_FILE, all: () => Promise<Space[]> = spaces, hook: Hook = deployHook('cleanup'), reuse = new Map<string, Line[]>()) {
  const ids = idsOf(b), s = loadStore(file), xs = ids.map(id => s.items.find(i => i.id === id));
  if (xs.some(x => !x)) throw new Error('없는 항목이 있다 — 화면이 다시 읽은 뒤 다시');
  const sp = await all();
  return each(xs as Item[], 2, x => planOne(x, s, sp, hook, file, reuse.get(x.id)));
}
// 미리보기는 엔진 훅(외부 문서 대조 같은 것)에 몇 분 걸릴 수 있어 요청 하나로 기다리지 않는다 — 시작만 하고(cleanStart) 화면이 2초마다 본다(cleanState).
// EDITH 를 다시 켜면 잊는다(화면은 「다시 확인」). 정리는 10분 안에 끝난 미리보기의 훅 확인 줄을 다시 쓴다 — EDITH 쪽 확인(코드 · 커밋 안 한 변경 · 워크스페이스)은 새로
type Job = { at: number; plans?: CleanPlan[]; error?: string };
const jobs = new Map<string, Job>(), keyOf = (ids: string[]) => [...ids].sort().join(',');
export function cleanStart(b: { ids?: unknown }, file = DEPLOY_FILE, all: () => Promise<Space[]> = spaces, hook: Hook = deployHook('cleanup')) {
  const ids = idsOf(b), k = keyOf(ids), was = jobs.get(k);
  if (was && !was.plans && !was.error) return { key: k };   // 이미 보는 중
  const job: Job = { at: Date.now() };
  jobs.set(k, job);
  cleanPlan(b, file, all, hook).then(p => { job.plans = p; }, (e: Error) => { job.error = e.message; });
  return { key: k };
}
export function cleanState(ids: string): { missing?: true; done?: boolean; since?: number; plans?: CleanPlan[]; error?: string } {
  const j = jobs.get(keyOf(ids.split(',')));
  return !j ? { missing: true as const } : { done: !!(j.plans || j.error), since: j.at, ...(j.plans ? { plans: j.plans } : {}), ...(j.error ? { error: j.error } : {}) };
}
const recentHook = (id: string) => [...jobs.values()].filter(j => j.plans && Date.now() - j.at < 10 * 60_000).sort((a, b) => b.at - a.at)
  .flatMap(j => j.plans!).find(p => p.id === id)?.hook;
// 운영에 들어간 날(보관 날짜) — 운영 칸의 시각, 모르면 오늘
async function prodDay(x: Item, s: Store) {
  const at = (await stateOf(x, s.envs)).envs.at(-1)?.at;
  return at ? new Date(at).toLocaleDateString('sv-SE') : today();
}
// 정리 — 미리보기를 다시 보고 통과한 항목만: 엔진 훅(run) → 워크스페이스 닫기 → 워크트리 제거(강제 아님) → 로컬 브랜치 삭제(내용 확인을 통과했으니 -D) → 보관
export async function cleanRun(b: { ids?: unknown }, file = DEPLOY_FILE, all: () => Promise<Space[]> = spaces, close: (id: string) => Promise<unknown> = closeWorkspace, hook: Hook = deployHook('cleanup')) {
  // shortcut: 10분 안 미리보기가 없으면(그사이 EDITH 를 다시 켰다) 느린 훅 확인을 이 요청 안에서 다시 돈다 — 그래서 화면은 미리보기를 본 뒤에만 정리 단추를 켠다
  const reuse = new Map(idsOf(b).flatMap(id => { const h = recentHook(id); return h ? [[id, h] as const] : []; }));
  const plans = await cleanPlan(b, file, all, hook, reuse), done: string[] = [], stopped: string[] = [];
  for (const p of plans) {
    const name = `${p.name} ${p.branch}`;
    if (!p.ok) { stopped.push(`${name} — ${p.lines.find(l => !l.ok)!.check}`); continue; }
    if (hook && p.targets.length) {
      const log = logOf(file, p.id, 'clean'), r = await runHook(hook, hookEnv(p, 'run'), log, 5 * 60_000);
      if (r.code) { stopped.push(`${name} — 정리 훅이 멈췄다: ${why(log, r.code)}`); continue; }
    }
    const errs: string[] = [], gone = { wt: 0, ws: 0, br: 0 };
    for (const t of p.targets) {
      for (const w of t.spaces) try { await close(w.id); gone.ws++; } catch (e) { errs.push(`워크스페이스 「${w.label}」 — ${(e as Error).message.split('\n')[0]}`); }
      if (!t.worktree) continue;
      const r = await git(p.repo, ['worktree', 'remove', t.worktree]);
      if (r.code) errs.push(`워크트리 ${basename(t.worktree)} — ${(r.stderr || r.stdout).trim().split('\n')[0]}`); else gone.wt++;
    }
    await git(p.repo, ['worktree', 'prune']);
    for (const t of p.targets.filter(t => t.local)) {
      const r = await git(p.repo, ['branch', '-D', t.branch]);
      if (r.code) errs.push(`브랜치 ${t.branch} — ${(r.stderr || r.stdout).trim().split('\n')[0]}`); else gone.br++;
    }
    const did = `워크트리 ${gone.wt} · 워크스페이스 ${gone.ws} · 로컬 브랜치 ${gone.br}`;
    const x = loadStore(file).items.find(i => i.id === p.id), day = !errs.length && x && !x.done ? await prodDay(x, loadStore(file)) : undefined;
    // 다 치웠을 때만 보관한다 — 일부만이면 남은 것을 다시 정리할 수 있게 둔다
    change(file, ANY, s => { const y = s.items.find(i => i.id === p.id); if (!y) return; if (day) y.done = day; note(y, errs.length ? `정리 일부 — ${did} · 남음: ${errs.join(' · ').slice(0, 200)}` : `정리 — ${did}${day ? ` · 보관(${day.slice(5).replace('-', '/')})` : ''}`); });
    (errs.length ? stopped : done).push(`${name} — ${did}${errs.length ? ` · 남음: ${errs.join(' · ')}` : ''}`);
  }
  return { ok: true, done, stopped, text: [...done.map(d => `✓ ${d}`), ...stopped.map(d => `✕ ${d}`)].join('\n') || '정리할 것이 없다' };
}
