// 정리 — 운영까지 다 나간 안건의 워크트리 · herdr 워크스페이스 · 로컬 브랜치를 치우고 보관한다(배포 화면 카드 「정리」, 보관했는데 남은 것은 「Complete」 의 「남은 n개 정리」).
// 브랜치마다 「코드가 들어갔나」 를 해시가 아니라 내용으로 본다 — 들어갔어야 할 곳(into)에 그 브랜치를 합쳐 본 트리가 into 트리와 같으면 들어간 것(체리픽 · 스쿼시도).
// 치우는 것: 원본(→ 운영), 그 원본에 합친 이슈 브랜치(런 edith-repos.json 의 via → 원본), 첫 환경 머지 브랜치 merge/<끝>(→ dev — 공방 키트 「dev 머지 준비」 꼴),
// 그 뒤 환경 머지 브랜치 merge-<환경>/<끝>(→ 그 환경 — 「stage · prod 머지 준비」). 원격 브랜치 · 레포 본 체크아웃 · 런 기록은 남긴다.
// 걸리면(코드가 덜 들어감 · 커밋 안 한 변경 · stash · 일하는 워크스페이스 · 엔진 훅이 막음) 그 항목은 아무것도 지우지 않는다 — 미리보기(cleanPlan)와 정리(cleanRun)가 같은 확인.
// 엔진 몫(작업 문서 · 외부 기록 확인 · 런 안 사본 같은 것)은 공방 훅 on: "cleanup" 이 한다: EDITH_CLEAN_MODE=check 면 확인만 — 표준 출력 {"lines": [{what, ref, parts?, ok, check, skippable?}]}
// (skippable — 사람이 보고 넘길 수 있는 엔진 확인, 화면 「넘기고 정리」. EDITH 자신의 확인 — 코드 · 커밋 안 한 변경 · 워크스페이스 · 런 — 은 넘기지 못한다.
//  fix — 그 확인을 고치는 단추 이름: 누르면 EDITH_CLEAN_MODE=fix 로 그 줄(EDITH_CLEAN_REF · EDITH_CLEAN_DETAIL)을 훅에 넘긴다 — 훅은 일을 맡기고 바로 끝낸다),
// run 이면 치운다(EDITH 쪽 정리 전에 돈다 — 끝 코드 0 이 아니면 그 항목은 멈춘다). 값은 환경 변수로만: EDITH_CLEAN_REPO · _BRANCH · _WORKTREES(줄마다) · _RUNS(쉼표) · EDITH_DEPLOY_ID
import { mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';
import { ANY, change, commit, DEPLOY_FILE, git, loadStore, mainRepo, note, out, stateOf, today, worktreeOf, type Item, type Store } from './deploy.ts';
import { closeWorkspace, spaces } from './herdr.ts';
import { each } from './reach.ts';
import { readRefs } from './repos.ts';
import { deployHook, listRuns, RUNS, runHook, type RunAction } from './runner.ts';
import { lastLine } from './timeline.ts';

export type Line = { what: string; ref: string; parts?: string; ok: boolean; check: string; skippable?: true; fix?: string };
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
// active — 아직 끝나지 않은 런(끝 · 버림이 아니면 — 멈춤도 이어 갈 수 있다). 그 런이 쓰는 워크트리는 치우지 않는다
async function linked(x: Item) {
  const runs = new Set<number>(), issues = new Set<string>(), active = new Set<number>();
  for (const r of listRuns()) for (const ref of readRefs(join(RUNS, String(r.id), 'work'))) {
    if (await mainRepo(ref.path).catch(() => null) !== x.repo) continue;
    const mine = ref.via && label(ref.via) === x.branch && ref.branch ? (issues.add(label(ref.branch)), true) : !!ref.branch && label(ref.branch) === x.branch;
    if (!mine) continue;
    runs.add(r.id);
    if (r.state !== 'done' && r.state !== 'dropped') active.add(r.id);
  }
  return { runs: [...runs], issues: [...issues], active: [...active] };
}
const hookEnv = (p: CleanPlan, mode: 'check' | 'run' | 'fix') => ({ EDITH_CLEAN_MODE: mode, EDITH_CLEAN_REPO: p.repo, EDITH_CLEAN_BRANCH: p.branch, EDITH_DEPLOY_ID: p.id,
  EDITH_CLEAN_WORKTREES: p.targets.flatMap(t => t.worktree ?? []).join('\n'), EDITH_CLEAN_RUNS: p.runs.join(',') });
const logOf = (file: string, id: string, what: string) => { const d = join(dirname(file), 'deploy-logs'); mkdirSync(d, { recursive: true, mode: 0o700 }); return join(d, `${id}-${what}-${Date.now()}.log`); };
const why = (log: string, code: number) => { try { return lastLine(readFileSync(log, 'utf8')) ?? `끝 코드 ${code}`; } catch { return `끝 코드 ${code}`; } };
// 훅 확인 출력 — 틀린 줄은 버린다
export function parseLines(t: string): Line[] {
  let a: { lines?: unknown };
  try { a = JSON.parse(t.trim().split('\n').filter(Boolean).at(-1) ?? ''); } catch { return []; }
  return Array.isArray(a?.lines) ? (a.lines as Record<string, unknown>[]).flatMap(l => typeof l?.what === 'string' && typeof l.ref === 'string' && typeof l.check === 'string' && typeof l.ok === 'boolean'
    ? [{ what: l.what.slice(0, 40), ref: l.ref.slice(0, 200), ...(typeof l.parts === 'string' ? { parts: l.parts.slice(0, 300) } : {}), ok: l.ok, check: l.check.slice(0, 300), ...(l.skippable === true ? { skippable: true as const } : {}),
      ...(typeof l.fix === 'string' && l.fix.trim() ? { fix: l.fix.trim().slice(0, 20) } : {}) }] : []).slice(0, 20) : [];
}

// reuse — 앞 미리보기의 훅 확인 줄(정리 때 느린 확인을 다시 돌리지 않게)
async function planOne(x: Item, s: Store, sp: Space[], hook: Hook, file: string, reuse?: Line[]): Promise<CleanPlan> {
  const envs = s.envs, tail = x.branch.split('/').pop()!, { runs, issues, active } = await linked(x);
  const own = await commit(x.repo, `refs/heads/${x.branch}`) ? x.branch : `origin/${x.branch}`;
  const cands = [{ what: '원본', branch: x.branch, into: envs.at(-1)!.ref }, ...issues.map(i => ({ what: '이슈', branch: i, into: own })),
    { what: `${envs[0].name} 머지`, branch: `merge/${tail}`, into: envs[0].ref }, ...envs.slice(1).map(e => ({ what: `${e.name} 머지`, branch: `merge-${e.name}/${tail}`, into: e.ref }))];
  const stash = (await out(x.repo, ['stash', 'list', '--format=%gs']))?.split('\n') ?? [];
  const lines: Line[] = active.map(n => ({ what: '런', ref: `#${n}`, ok: false, check: `런 #${n} 이 아직 끝나지 않았다 — 끝나거나 버린 뒤` })), targets: Target[] = [];
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
// 걸렸지만 넘기고 정리하는가 — 사람이 그 항목을 넘기기로 했고(skip), 걸린 줄이 모두 엔진이 넘겨도 된다고 한 확인일 때만
export const skipped = (p: CleanPlan, skip: Set<string>) => { const bad = p.lines.filter(l => !l.ok); return bad.length > 0 && skip.has(p.id) && bad.every(l => l.skippable); };
// 미리보기 — 항목마다 치울 것과 확인. 보관한 항목도 받는다(남은 것 정리)
export async function cleanPlan(b: { ids?: unknown }, file = DEPLOY_FILE, all: () => Promise<Space[]> = spaces, hook: Hook = deployHook('cleanup'), reuse = new Map<string, Line[]>()) {
  const ids = idsOf(b), s = loadStore(file), xs = ids.map(id => s.items.find(i => i.id === id));
  if (xs.some(x => !x)) throw new Error('없는 항목이 있다 — 화면이 다시 읽은 뒤 다시');
  const sp = await all();
  return each(xs as Item[], 2, x => planOne(x, s, sp, hook, file, reuse.get(x.id)));
}
// 미리보기는 엔진 훅(외부 문서 대조 같은 것)에 몇 분 걸릴 수 있어 요청 하나로 기다리지 않는다 — 시작만 하고(cleanStart) 화면이 2초마다 본다(cleanState).
// EDITH 를 다시 켜면 잊는다(화면은 「다시 확인」). 정리는 10분 안에 끝난 미리보기의 훅 확인 줄을 다시 쓴다 — EDITH 쪽 확인(코드 · 커밋 안 한 변경 · 워크스페이스)은 새로
// 창을 닫았다 다시 열면 화면은 이 결과를 그대로 보인다(새로 보는 것은 「다시 확인」 — 같은 항목이면 cleanStart 가 새 일을 시작한다). 정리한 항목의 결과는 정리 뒤 잊는다
type Fix = { at: number; ok: boolean; text: string };   // 고치기를 맡긴 기록 — 「<항목 id>\n<줄 ref>」 마다
type Job = { at: number; plans?: CleanPlan[]; error?: string; fixes?: Record<string, Fix> };
const jobs = new Map<string, Job>(), keyOf = (ids: string[]) => [...ids].sort().join(',');
export function cleanStart(b: { ids?: unknown }, file = DEPLOY_FILE, all: () => Promise<Space[]> = spaces, hook: Hook = deployHook('cleanup')) {
  const ids = idsOf(b), k = keyOf(ids), was = jobs.get(k);
  if (was && !was.plans && !was.error) return { key: k };   // 이미 보는 중
  const job: Job = { at: Date.now() };
  jobs.set(k, job);
  cleanPlan(b, file, all, hook).then(p => { job.plans = p; }, (e: Error) => { job.error = e.message; });
  return { key: k };
}
export function cleanState(ids: string): { missing?: true; done?: boolean; since?: number; plans?: CleanPlan[]; error?: string; fixes?: Record<string, Fix> } {
  const j = jobs.get(keyOf(ids.split(',')));
  return !j ? { missing: true as const } : { done: !!(j.plans || j.error), since: j.at, ...(j.plans ? { plans: j.plans } : {}), ...(j.error ? { error: j.error } : {}), ...(j.fixes ? { fixes: j.fixes } : {}) };
}
// 고치기 — 미리보기에서 훅이 단추(fix)를 단 확인 줄을 훅에 다시 넘긴다(EDITH_CLEAN_MODE=fix). 훅은 오래 걸리는 일을 맡기고 바로 끝내야 한다(1분) —
// 표준 출력 마지막 줄이 그 줄 밑에 남는다(창을 다시 열어도). 끝났는지는 사람이 「다시 확인」 으로 본다
export async function cleanFix(b: { id?: unknown; ref?: unknown }, file = DEPLOY_FILE, hook: Hook = deployHook('cleanup')) {
  if (typeof b.id !== 'string' || typeof b.ref !== 'string') throw new Error('고칠 줄이 없다');
  const mine = [...jobs.values()].filter(j => j.plans?.some(p => p.id === b.id)).sort((a, c) => c.at - a.at), p = mine[0]?.plans!.find(x => x.id === b.id);
  const l = p?.hook.find(x => x.ref === b.ref && x.fix && !x.ok);
  if (!hook || !p || !l) throw new Error('고칠 줄을 못 찾았다 — 「다시 확인」 뒤 다시');
  const log = logOf(file, p.id, 'clean-fix'), r = await runHook(hook, { ...hookEnv(p, 'fix'), EDITH_CLEAN_REF: l.ref, EDITH_CLEAN_DETAIL: [l.check, l.parts].filter(Boolean).join('\n') }, log, 60_000);
  const fix: Fix = { at: Date.now(), ok: !r.code, text: (r.code ? `못 맡겼다 — ${why(log, r.code)}` : lastLine(r.out) ?? '맡겼다').slice(0, 300) };
  for (const j of mine) j.fixes = { ...j.fixes, [`${p.id}\n${l.ref}`]: fix };
  return fix;
}
const recentHook = (id: string) => [...jobs.values()].filter(j => j.plans && Date.now() - j.at < 10 * 60_000).sort((a, b) => b.at - a.at)
  .flatMap(j => j.plans!).find(p => p.id === id)?.hook;
// 운영에 들어간 날(보관 날짜) — 운영 칸의 시각, 모르면 오늘
async function prodDay(x: Item, s: Store) {
  const at = (await stateOf(x, s.envs)).envs.at(-1)?.at;
  return at ? new Date(at).toLocaleDateString('sv-SE') : today();
}
// 정리 — 미리보기를 다시 보고 통과한 항목만: 엔진 훅(run) → 워크스페이스 닫기 → 워크트리 제거(강제 아님) → 로컬 브랜치 삭제(내용 확인을 통과했으니 -D) → 보관
export async function cleanRun(b: { ids?: unknown; skip?: unknown }, file = DEPLOY_FILE, all: () => Promise<Space[]> = spaces, close: (id: string) => Promise<unknown> = closeWorkspace, hook: Hook = deployHook('cleanup')) {
  // shortcut: 10분 안 미리보기가 없으면(그사이 EDITH 를 다시 켰다) 느린 훅 확인을 이 요청 안에서 다시 돈다 — 그래서 화면은 미리보기를 본 뒤에만 정리 단추를 켠다
  const reuse = new Map(idsOf(b).flatMap(id => { const h = recentHook(id); return h ? [[id, h] as const] : []; }));
  const plans = await cleanPlan(b, file, all, hook, reuse), done: string[] = [], stopped: string[] = [];
  const skip = new Set(Array.isArray(b.skip) ? b.skip.filter((x): x is string => typeof x === 'string') : []);
  for (const p of plans) {
    const name = `${p.name} ${p.branch}`, over = skipped(p, skip);
    if (!p.ok && !over) { stopped.push(`${name} — ${p.lines.find(l => !l.ok)!.check}`); continue; }
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
    const did = `워크트리 ${gone.wt} · 워크스페이스 ${gone.ws} · 로컬 브랜치 ${gone.br}${over ? ` · 넘긴 확인: ${p.lines.filter(l => !l.ok).map(l => l.check).join(' · ')}`.slice(0, 160) : ''}`;
    const x = loadStore(file).items.find(i => i.id === p.id), day = !errs.length && x && !x.done ? await prodDay(x, loadStore(file)) : undefined;
    // 다 치웠을 때만 보관한다 — 일부만이면 남은 것을 다시 정리할 수 있게 둔다
    change(file, ANY, s => { const y = s.items.find(i => i.id === p.id); if (!y) return; if (day) y.done = day; note(y, errs.length ? `정리 일부 — ${did} · 남음: ${errs.join(' · ').slice(0, 200)}` : `정리 — ${did}${day ? ` · 보관(${day.slice(5).replace('-', '/')})` : ''}`); });
    (errs.length ? stopped : done).push(`${name} — ${did}${errs.length ? ` · 남음: ${errs.join(' · ')}` : ''}`);
  }
  // 정리한 항목의 미리보기는 이제 옛 판이다 — 창을 다시 열면 새로 보게 잊는다
  const ids = idsOf(b);
  for (const k of [...jobs.keys()]) if (k.split(',').some(i => ids.includes(i))) jobs.delete(k);
  return { ok: true, done, stopped, text: [...done.map(d => `✓ ${d}`), ...stopped.map(d => `✕ ${d}`)].join('\n') || '정리할 것이 없다' };
}
