// 배포 — 안건(tag)마다 꺾쇠 카드, 레포마다 단계 선(커밋 → 올림 → dev → stage → prod), 그 브랜치를 다루는 런이 붙는다(서버 src/deploy.ts deployBoard). 주소는 #/deploy(옛 #/results 도).
// 결과 화면을 품었다(2026-10-26): 런이 워크트리를 만들면 바로 「작업」 칸이 빛나고(지금 노드), 런이 끝나면 그 런 단추(커밋하러 가기 · 푸시 · 안건에 합치기 · dev …)가 그 단계 칸에.
// 안건 QA 이슈 런은 레포 밑 「↳ 이슈」 줄(작업 → 커밋 → 안건에 합침). stage · 운영 올리기는 레포 줄마다 EDITH 단추(충돌이면 「<환경> 머지 준비」 먼저). 운영은 확인 창이 나갈 커밋 · 바뀌는 파일 범위 · 충돌 표시 · 푼 파일에서 빠진 줄 · 배포 전 할 일을 먼저 본다.
// 배포일 · 배포 조치 뽑기(공방 훅 on: prep) · 정리(운영까지 다 나가면 — 워크트리 · 워크스페이스 · 로컬 브랜치, src/cleanup.ts)는 카드 머리, 배포 조치(환경마다 배포 전 · 후) · 메모 · 기록 · 연기 · 보관은 오른쪽 패널.
// 단계 선의 환경 칸 밑에 남은 배포 조치 수, 올릴 때 배포 전 할 일이 남았으면 확인 창에서 한 번 더. 목록에 없는 런 일은 「목록에 없음」 카드로.
// 보관한 것은 쌓이니 화면은 수만 받고, 「COMPLETE」 창을 열 때 최근부터 조금씩(찾기 · 더 보기 — /api/deploy/done).
import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { useInfiniteQuery, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from './api.ts';
import { Button } from '@/components/ui/button';
import { Bracketed, Empty, GRID_BG, Icon, mix } from './ui.tsx';
import { copyText, toast } from './copy.ts';
import { byTurn } from './deployOrder.ts';
import { DiffView } from './Diff.tsx';

type Reach = { ref: string; state: 'in' | 'content' | 'partial' | 'subject' | 'none' | 'missing'; at?: number; how?: 'merge' | 'ff'; k?: number; n?: number; missing?: string[]; subject?: string };
type EnvState = Reach & { name: string; conflicts?: number; files?: string[]; prep?: { branch: string; ready: boolean; merging?: string } };   // prep — 그 환경 머지 브랜치(서버 deployBoard)
type ItemState = { tip?: string; remote?: boolean; pushed?: boolean; worktree?: string; dirty?: number; behind?: number; stale?: boolean; empty?: boolean; envs: EnvState[]; error?: string };   // empty — 등록 뒤 커밋 없음
type Action = { n: number; label: string; reach: string; command: string; hint?: string; ask?: string; danger?: boolean; copy?: boolean; flow?: string; row?: boolean; wait?: string };   // row — 레포 줄마다(그 줄 레포만), wait — 아직 누를 때가 아니면 그 까닭(서버 markWait)
type RepoReach = { name: string; path: string; branch?: string; error?: string; dirty?: number; pushed?: boolean | null; fresh?: boolean; headAt?: number; via?: Reach; envs: Reach[] };
type Act = { label: string; at: number; code: number | null; note?: string; repo?: string };   // 런 단추 기록 — code null 이면 도는 중, repo — 레포 줄 단추로 그 레포만
type RunLink = { id: number; title: string; tag?: string; link?: string; state: string; now?: string; created: number; actions: Action[]; issue?: RepoReach; path?: string; acting?: Act; last?: Act };   // path — 이 항목에 해당하는 그 런 워크트리
// 런 단추가 도는지 · 마지막 결과 — 카드 깊숙한 단계 칸이 읽는다(DeployPage 가 1.5초마다 /api/runs/<번호>/acted 로 채운다)
const ActCtx = createContext<{ busy: (run: number) => Act | null; last: (run: number) => Act | null; now: number }>({ busy: () => null, last: () => null, now: 0 });
type Task = { env: string; text: string; done: boolean; hand?: boolean };   // hand — 사람이 패널에서 적은 줄
type Prep = { at: number; code: number | null; note?: string };   // 배포 조치 뽑기 — code null 이면 도는 중
type Item = { id: string; repo: string; branch: string; tag?: string; ticket?: string; agenda?: string; notes: string[]; date?: string; deferred?: boolean; done?: string; tasks: Task[];
  block?: { base: string; end: string; made: string; notes?: string[] }; log: { t: number; text: string }[]; state?: ItemState; runs?: RunLink[]; prep?: Prep };   // runs · state · prep 는 보관 안 한 것만
type Left = { id: string; repo: string; branch: string; tag?: string; agenda?: string; done: string };   // 보관했는데 이 맥에 브랜치가 남은 것
type Board = { rev: number; envs: { name: string; ref: string }[]; items: Item[]; done: number; repos: { path: string; name: string; fetched?: number }[]; extra: { run: RunLink; repos: RepoReach[] }[];
  hooks: { prep: boolean; cleanup: boolean }; leftover: Left[] };
type Group = { key: string; tag: string; agenda?: string; items: Item[]; date?: string; deferred: boolean; done?: string };
type Pick = { run: RunLink; action: Action; repo?: string };   // repo — 레포 줄 단추면 그 줄 워크트리(그 레포만 돈다)
type Send = (path: string, b: Record<string, unknown>, ok?: string) => Promise<boolean>;
type Filter = 'all' | 'next' | 'work' | 'check' | 'clean';

const p2 = (n: number) => String(n).padStart(2, '0');
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const ymd = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const dayLabel = (s: string) => { const d = new Date(`${s}T00:00`); return `${p2(d.getMonth() + 1)}/${p2(d.getDate())} (${WD[d.getDay()]})`; };
const at = (t?: number) => { if (!t) return ''; const d = new Date(t); return `${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60_000); return m < 60 ? `${Math.max(m, 1)}분 전` : m < 24 * 60 ? `${Math.round(m / 60)}시간 전` : at(t).slice(0, 5); };
const repoName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const label = (ref: string) => ref.replace(/^origin\//, '');
const reached = (r?: Reach) => r?.state === 'in' || r?.state === 'content';
const TICKET = /\b[A-Z][A-Z0-9]+-\d+\b/g;
const tickets = (g: Group) => g.agenda ? [g.agenda] : [...new Set(g.items.flatMap(x => x.notes.join(' ').match(TICKET) ?? []))].slice(0, 4);
// 티켓 → 원문 주소 — 그 꼬리표로 돈 런의 입력 주소(src/deploy.ts inputLink). 꼬리표가 안 맞으면(런이 돈 뒤 티켓 접두가 바뀌는 등) 안건 키이거나 티켓이 하나뿐인
// 카드에서 이슈 줄이 아닌 런들의 주소가 하나일 때만 그것 — 노트에 다른 티켓이 섞인 카드가 엉뚱한 원문으로 가지 않게
const linkOf = (g: Group, t: string) => {
  const runs = g.items.flatMap(x => x.runs ?? []).filter(r => r.link), own = [...new Set(runs.filter(r => !r.issue).map(r => r.link))];
  return runs.find(r => r.tag === t)?.link ?? ((t === g.agenda || tickets(g).length === 1) && own.length === 1 ? own[0] : undefined);
};
const EXTERNAL = <><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>;   // lucide external-link
// 안건 자기 항목(티켓이 안건 키거나 티켓 없음) — 아니면 그 안건에 든 이슈 항목(줄에 제 티켓 · 이름)
const own = (x: Item) => !x.ticket || x.ticket === x.agenda;
// 배포 조치 줄의 때 — 「배포 후 …」 면 후, 나머지(「배포 전 …」 · 앞머리 없는 줄)는 전. 보일 때는 앞머리를 뗀다(「배포 전 DB — …」 → 「DB — …」)
const whenOf = (t: string) => /^배포 후/.test(t) ? '후' : '전';
const plain = (t: string) => t.replace(/^배포 [전후]\s*(?:—\s*)?/, '');
const copyName = (t: string) => t.match(/\(복사: ([\w-][\w.-]*)\)/)?.[1];   // 줄에 적힌 복사 파일(SQL 등 — 「보기」)
const leftIn = (xs: Item[], env: string, w: '전' | '후') => xs.flatMap(x => x.tasks.filter(t => t.env === env && whenOf(t.text) === w && !t.done));
// 숫자로 친 날 — 1030 · 10/30 · 10-30. 두 달 넘게 지난 날이면 내년(연말에 넣는 1월 배포)
function typedDay(s: string, now = new Date()) {
  const m = s.trim().match(/^(\d{1,2})[/.-]?(\d{2})$/);
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12 || Number(m[2]) < 1 || Number(m[2]) > 31) return null;
  const d = new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2]));
  if (now.getTime() - d.getTime() > 60 * 86_400_000) d.setFullYear(d.getFullYear() + 1);
  return ymd(d);
}
// 안건 묶음 — 안건 키(일감 관리의 안건 — QA 이슈는 상위 안건)가 같으면 한 카드, 없으면 이름(태그 · 브랜치)으로. 보관한 것은 보관한 날도 같아야 한 묶음.
// 카드 이름은 안건 자기 항목의 이름, 이슈 항목은 뒤로. 배포일은 묶음의 가장 이른 날
function groupsOf(items: Item[]): Group[] {
  const m = new Map<string, Item[]>();
  for (const x of items) { const k = `${x.done ?? ''}\0${x.agenda ?? x.tag ?? x.branch}`; m.set(k, [...(m.get(k) ?? []), x]); }
  return [...m].map(([key, xs]) => {
    const sorted = [...xs.filter(own), ...xs.filter(x => !own(x))], head = sorted[0];
    return { key, tag: head.tag ?? head.branch, agenda: xs.find(x => x.agenda)?.agenda, items: sorted, date: xs.map(x => x.date).filter(Boolean).sort()[0], deferred: xs.every(x => x.deferred), done: xs[0].done };
  });
}

// ── 단계 — 처음 안 끝난 칸이 「지금 차례」(빛나는 고리). 런이 그 브랜치에서 도는 동안은 맨 앞 「작업」 칸이 하는 중이라 차례를 매기지 않는다 ──
type SState = 'done' | 'partial' | 'check' | 'next' | 'todo' | 'work';
type Step = { key: string; name: string; state: SState; reach?: Reach; note?: string; act?: boolean; conflicts?: number; env?: string; last?: boolean; todo?: string };   // todo — 그 환경 남은 배포 조치
const envState = (e: Reach): SState => reached(e) ? 'done' : e.state === 'partial' ? 'partial' : e.state === 'subject' ? 'check' : 'todo';
function mark(all: Step[]) {
  if (all.some(s => s.state === 'work')) return all;
  const i = all.findIndex(s => s.state !== 'done');
  if (i >= 0) { all[i].act = true; if (all[i].state === 'todo') all[i].state = 'next'; }
  return all;
}
const work = (r: RunLink): Step => ({ key: 'work', name: '작업', state: 'work', note: r.now ?? '도는 중' });
function itemSteps(x: Item, envs: Board['envs']): Step[] {
  const s = x.state;
  if (!s || s.error) return [];
  const es = envs.map((e, i) => ({ e, r: s.envs[i] })).filter(v => v.r && v.r.state !== 'missing'), out = es.some(v => reached(v.r)), run = (x.runs ?? []).find(r => r.state !== 'done' && !r.issue);
  return mark([
    ...(run ? [work(run)] : []),
    { key: 'commit', name: '커밋', state: s.dirty || s.empty ? 'todo' : 'done', ...(s.dirty ? { note: `커밋 안 한 파일 ${s.dirty}` } : s.empty ? { note: '아직 커밋 없음' } : {}) },
    { key: 'push', name: '올림', state: s.pushed || s.remote || out ? 'done' : 'todo', ...(s.pushed || s.remote ? {} : { note: out ? 'origin 에 브랜치 없음' : '아직 안 올림' }) },
    ...es.map(({ e, r }) => {
      // 들어가기 전이면 배포 전, 들어간 뒤면 배포 후 할 일
      const st = envState(r), n = leftIn([x], e.name, st === 'done' ? '후' : '전').length;
      return { key: e.ref, name: e.name, state: st, reach: r, conflicts: r.conflicts, env: e.name, last: e === envs.at(-1), ...(n ? { todo: `배포 ${st === 'done' ? '후' : '전'} ${n} 남음` } : {}) };
    }),
  ]);
}
function issueSteps(r: RunLink): Step[] {
  const x = r.issue!;
  return mark([
    ...(r.state !== 'done' ? [work(r)] : []),
    { key: 'commit', name: '커밋', state: x.dirty || x.fresh ? 'todo' : 'done', ...(x.dirty ? { note: `커밋 안 한 파일 ${x.dirty}` } : x.fresh ? { note: '바꾼 것 없음' } : {}) },
    { key: 'via', name: '안건에 합침', state: x.via ? envState(x.via) : 'todo', ...(x.via ? { reach: x.via } : {}) },
  ]);
}
// 목록에 없는 런 일 — 결과 화면과 같은 단계(커밋 → 올림 · 합침 → 그 런이 정한 브랜치들)
function looseSteps(x: RepoReach, r: RunLink): Step[] {
  const envs = x.envs.filter(e => e.state !== 'missing'), out = envs.some(reached);
  return mark([
    ...(r.state !== 'done' ? [work(r)] : []),
    { key: 'commit', name: '커밋', state: x.dirty || x.fresh ? 'todo' : 'done', ...(x.dirty ? { note: `커밋 안 한 파일 ${x.dirty}` } : x.fresh ? { note: '바꾼 것 없음' } : {}) },
    x.via ? { key: 'via', name: '안건에 합침', state: out ? 'done' : envState(x.via), reach: x.via }
      : { key: 'push', name: '올림', state: x.pushed === true || out ? 'done' : 'todo', ...(x.pushed === true ? {} : { note: x.pushed === null ? '아직 안 올림' : '안 올린 커밋 있음' }) },
    ...envs.map(e => ({ key: e.ref, name: label(e.ref), state: envState(e), reach: e, last: e === x.envs.at(-1) })),
  ]);
}
// 런 단추가 그 칸에 맞나 — reach "base" 는 레포마다 이름이 다른 기본 브랜치(마지막) 칸
const fits = (a: Action, s: Step) => s.act === true && (a.reach === s.key || (a.reach === 'base' && !!s.last));
// 단추의 브랜치 흐름 — actions.json "flow"(줄마다 하나)의 {branch}(원본) · {issue}(이슈 브랜치) · {tail}(원본 끝 토막)을 그 줄 브랜치로 채운다
const withFlow = (a: Action, branch: string, issue?: string): Action =>
  a.flow ? { ...a, flow: a.flow.replace(/\{(branch|issue|tail)\}/g, (_, k: string) => k === 'issue' ? issue ?? branch : k === 'tail' ? branch.split('/').pop() ?? branch : branch) } : a;
// 단추 설명 상자 — 마우스를 올리면(키보드는 Tab) 바로. 브랜치 흐름을 한 줄씩, 그 아래 설명(한도 칩 · 사이드바 상태 목록과 같은 꼴).
// body 에 그린다 — 카드의 흐림(backdrop-blur)이 fixed 기준을 카드로 바꾸고 다음 카드 밑에 깔리게 해서. 화면 아래쪽 단추면 위로 띄운다.
// 막힌 단추(disabled)는 마우스를 받지 않아 둘레 span 이 받는다
function Tip({ flow, wait, hint, children }: { flow?: string[]; wait?: string; hint?: string; children: ReactNode }) {
  const [at, setAt] = useState<CSSProperties | null>(null);
  if (!flow?.length && !wait && !hint) return <>{children}</>;
  const show = (e: SyntheticEvent<HTMLElement>) => {
    // 오른쪽 단추면 상자 오른쪽 끝을 단추에 맞춘다(상자는 28rem 까지)
    const r = e.currentTarget.getBoundingClientRect(), x = r.left + 500 > innerWidth ? { right: Math.max(8, innerWidth - r.right) } : { left: Math.max(8, r.left) };
    setAt(r.bottom > innerHeight - 240 ? { ...x, bottom: innerHeight - r.top + 6 } : { ...x, top: r.bottom + 6 });
  };
  return (
    <span className="inline-flex" onMouseEnter={show} onMouseLeave={() => setAt(null)} onFocus={show} onBlur={() => setAt(null)}>
      {children}
      {at && createPortal(
        <div role="tooltip" style={at} className="pointer-events-none fixed z-50 w-max max-w-[min(28rem,calc(100vw-16px))] rounded-md border bg-popover px-3 py-2 text-left text-xs text-popover-foreground shadow-lg">
          {flow?.map((f, i) => <div key={i} className="font-mono text-[0.6875rem] leading-5 font-semibold break-words text-primary">{f}</div>)}
          {wait && <div className={`font-semibold text-amber-700 dark:text-amber-400 ${flow?.length ? 'mt-1.5' : ''}`}>{wait}</div>}
          {hint && <div className={`leading-relaxed whitespace-pre-line text-muted-foreground ${flow?.length || wait ? 'mt-1.5 border-t pt-1.5' : ''}`}>{hint}</div>}
        </div>, document.body)}
    </span>
  );
}
const flowLines = (a: Action) => a.flow?.split('\n').filter(Boolean);
// 안건 줄 단추를 낼 런 — 그 브랜치 자체 런. 이슈 런만 붙었으면 안건에 합친 가장 최근 이슈 런의 올림 · dev 단추를 빌린다
// (키트가 합친 뒤엔 안건 브랜치를 올린다 — stage 는 「stage 올리기」, 사용자 결정 2026-10-26)
const leads = (x: Item) => {
  const own = (x.runs ?? []).filter(r => !r.issue);
  if (own.length) return own;
  const last = (x.runs ?? []).filter(r => r.issue && r.state === 'done' && reached(r.issue.via)).sort((a, b) => b.created - a.created)[0];
  return last ? [{ ...last, actions: last.actions.filter(a => a.reach === 'push' || a.reach === 'origin/dev') }] : [];
};

export function DeployPage() {
  const qc = useQueryClient(), q = useQuery({ queryKey: ['deploy'], queryFn: () => get<Board>('/api/deploy'), refetchInterval: q => q.state.data?.items.some(x => x.prep?.code === null) ? 3000 : 30_000 });
  const [filter, setFilter] = useState<Filter>('all'), [byDate, setByDate] = useState(false), [find, setFind] = useState('');
  const [panel, setPanel] = useState<string | null>(null), [pick, setPick] = useState<Pick | null>(null), [push, setPush] = useState<{ g: Group; env: string; items: Item[] } | null>(null);
  const [files, setFiles] = useState<{ title: string; list: string[] } | null>(null), [adding, setAdding] = useState(false), [fetching, setFetching] = useState(false), [archive, setArchive] = useState(false), [old, setOld] = useState<Group | null>(null);
  const [clean, setClean] = useState<{ ids: string[]; title: string } | null>(null);
  const v = q.data;
  const all = useMemo(() => v ? groupsOf(v.items) : [], [v]);
  // 런 단추 — 누른 것(pressed)과 서버가 도는 중이라 한 것을 1.5초마다 보고, 끝 코드가 차면 토스트 · 다시 읽기. 명령이 몇십 초 걸려도 눌렸는지 보이게
  const [pressed, setPressed] = useState<{ run: number; label: string; at: number; repo?: string }[]>([]), [now, setNow] = useState(Date.now()), seen = useRef(new Set<string>());
  const runs = useMemo(() => v ? [...v.items.flatMap(x => x.runs ?? []), ...v.extra.map(e => e.run)] : [], [v]);
  const said = (id: number) => runs.find(r => r.id === id && r.acting)?.acting;
  const watching = [...new Set([...pressed.map(p => p.run), ...runs.filter(r => r.acting).map(r => r.id)])];
  const polls = useQueries({ queries: watching.map(id => ({ queryKey: ['acted', id], queryFn: () => get<Act[]>(`/api/runs/${id}/acted`), refetchInterval: 1500 })) });
  const latest = (id: number) => polls[watching.indexOf(id)]?.data?.[0];
  const busy = (id: number): Act | null => {
    const r = latest(id), p = pressed.find(x => x.run === id);
    if (r?.code === null) return r;
    if (p && !(r && r.at >= p.at - 2000)) return { label: p.label, at: p.at, code: null, ...(p.repo ? { repo: p.repo } : {}) };   // 누른 직후 — 기록이 아직 안 생겼다
    return r ? null : said(id) ?? null;
  };
  const lastOf = (id: number) => { const r = latest(id); return r && r.code !== null ? r : runs.find(x => x.id === id)?.last ?? null; };
  const datas = polls.map(x => x.dataUpdatedAt).join();
  useEffect(() => {
    watching.forEach(id => {
      const r = latest(id), want = pressed.find(p => p.run === id)?.at ?? said(id)?.at;
      if (!r || r.code === null || want === undefined || r.at < want - 2000 || seen.current.has(`${id}:${r.at}`)) return;
      seen.current.add(`${id}:${r.at}`);
      toast(r.code === 0 ? `「${r.label}」 끝` : `「${r.label}」 실패 — 끝 코드 ${r.code}${r.note ? ` · ${r.note}` : ''}`, r.code === 0 ? 3000 : 9000);
      setPressed(ps => ps.filter(p => p.run !== id));
      void qc.invalidateQueries({ queryKey: ['deploy'] });
    });
  }, [datas]);   // eslint-disable-line react-hooks/exhaustive-deps
  const anyBusy = watching.some(id => busy(id));
  useEffect(() => { if (!anyBusy) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [anyBusy]);
  const send: Send = async (path, b, ok) => {
    try { await post(`/api/deploy/${path}`, { rev: v?.rev, ...b }); if (ok) toast(ok, 2500); await Promise.all(['deploy', 'deploy-done'].map(k => qc.invalidateQueries({ queryKey: [k] }))); return true; }
    catch (e) { toast(`못 했다 — ${(e as Error).message}`, 7000); await qc.invalidateQueries({ queryKey: ['deploy'] }); return false; }
  };
  const refetch = async () => {
    setFetching(true);
    try { const r = await post<{ repos: number; errors: string[] }>('/api/deploy/fetch', {}); toast(r.errors.length ? `${r.repos}개 레포 중 ${r.errors.length}개를 못 받았다 — ${r.errors[0]}` : `${r.repos}개 레포를 새로 받았다`, r.errors.length ? 6000 : 2500); }
    catch (e) { toast(`받지 못했다 — ${(e as Error).message}`, 5000); }
    await qc.invalidateQueries({ queryKey: ['deploy'] });
    setFetching(false);
  };
  if (!v) return <main className="min-h-0 flex-1 overflow-y-auto p-6" style={GRID_BG}><Empty>{q.error ? `읽지 못했다 — ${String(q.error)}` : '불러오는 중…'}</Empty></main>;

  const live = all.filter(g => !g.deferred), deferred = all.filter(g => g.deferred);
  const stepsOf = (g: Group) => [...g.items.flatMap(x => itemSteps(x, v.envs)), ...g.items.flatMap(x => (x.runs ?? []).filter(r => r.issue).flatMap(issueSteps))];
  const flags = (g: Group) => {
    const ss = stepsOf(g), last = v.envs.at(-1)!;
    return { next: ss.some(s => s.state === 'next'), work: g.items.some(x => (x.runs ?? []).some(r => r.state !== 'done')), check: ss.some(s => s.state === 'partial' || s.state === 'check') || g.items.some(x => (x.runs ?? []).some(r => r.now?.includes('사람 확인'))),
      clean: flagsClean(g, v) };
  };
  const looseFlags = (e: Board['extra'][number]) => { const ss = e.repos.flatMap(x => looseSteps(x, e.run)); return { next: ss.some(s => s.state === 'next'), work: e.run.state !== 'done', check: ss.some(s => s.state === 'partial' || s.state === 'check'), clean: false }; };
  const needle = find.trim().toLowerCase();
  const hit = (xs: string[]) => !needle || xs.some(s => s.toLowerCase().includes(needle));
  const pass = (f: ReturnType<typeof flags>) => filter === 'all' || f[filter];
  const shown = byTurn(live.filter(g => pass(flags(g)) && hit([g.tag, ...tickets(g), ...g.items.flatMap(x => [x.branch, repoName(x.repo), x.tag ?? '', x.ticket ?? '', ...x.notes, ...(x.runs ?? []).flatMap(r => [`#${r.id}`, r.title])])])), stepsOf, v.envs);
  const extra = v.extra.filter(e => pass(looseFlags(e)) && hit([`#${e.run.id}`, e.run.title, e.run.tag ?? '', ...e.repos.flatMap(x => [x.name, x.branch ?? ''])]));
  const count = (f: Filter) => f === 'all' ? live.length + v.extra.length : live.filter(g => flags(g)[f]).length + v.extra.filter(e => looseFlags(e)[f]).length;
  const heads = byDate ? [...new Set(shown.map(g => g.date ?? ''))].sort((a, b) => !a ? 1 : !b ? -1 : a.localeCompare(b)) : [null];
  const fetched = v.repos.map(r => r.fetched).filter((t): t is number => !!t);
  const pill = (f: Filter, name: string) => (
    <button type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
      className={`h-9 rounded-full border px-3.5 text-sm ${filter === f ? 'border-primary bg-primary font-semibold text-primary-foreground' : 'bg-card hover:border-primary/50'}`}>
      {name} <span className="tabular-nums opacity-80">{count(f)}</span>
    </button>
  );
  const open = all.find(g => g.key === panel);
  return (
    <ActCtx.Provider value={{ busy, last: lastOf, now }}>
    <main className="min-h-0 flex-1 overflow-y-auto" style={GRID_BG}>
      <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[0.6875rem] font-semibold tracking-[0.24em] text-primary uppercase">Deploy · 안건 {live.length} · 레포 {live.reduce((n, g) => n + g.items.length, 0)}</div>
            <h1 className="text-2xl font-bold">배포</h1>
            <p className="text-sm text-muted-foreground">안건마다 코드가 어디까지 갔나 — 빛나는 칸이 지금 할 일이다. 런이 워크트리를 만들면 바로 뜬다.</p>
          </div>
          {fetched.length > 0 && <span className="font-mono text-xs text-muted-foreground uppercase">origin · {ago(Math.min(...fetched))}</span>}
          <Button variant="outline" disabled={fetching} onClick={() => void refetch()} className="text-primary">{fetching ? '받는 중…' : '새로 받기'}</Button>
          <Button variant="outline" onClick={() => setAdding(true)}>+ 항목</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="거르기" className="flex flex-wrap gap-2">{pill('all', '전체')}{pill('next', '할 차례')}{pill('work', '작업 중')}{pill('check', '확인 필요')}{pill('clean', '정리 가능')}</div>
          <div role="group" aria-label="보기" className="ml-1 flex overflow-hidden rounded-full border bg-card">
            {([[false, '차례순'], [true, '배포일순']] as const).map(([d, name]) => (
              <button key={name} type="button" aria-pressed={byDate === d} onClick={() => setByDate(d)} className={`h-9 px-3.5 text-sm ${byDate === d ? 'bg-accent font-semibold' : 'text-muted-foreground hover:bg-muted'}`}>{name}</button>
            ))}
          </div>
          <input type="search" value={find} onChange={e => setFind(e.target.value)} placeholder="안건 · 티켓 · 브랜치 · 레포 · #런" aria-label="찾기"
            className="ml-auto h-9 w-full max-w-64 rounded-full border bg-card px-3.5 text-sm outline-none focus:ring-2 focus:ring-ring/40" />
        </div>

        {!shown.length && !extra.length && <Empty>{live.length || v.extra.length ? '맞는 안건이 없다.' : '배포 목록이 비었다 — 워크트리를 만드는 스킬이 등록하거나(edith deploy add), 「+ 항목」.'}</Empty>}
        {heads.map(h => {
          const gs = h === null ? shown : shown.filter(g => (g.date ?? '') === h);
          return (
            <div key={h ?? 'all'} className="space-y-4">
              {h !== null && <div className="flex items-baseline gap-2.5 pt-1"><span className="font-mono text-xs font-bold tracking-[0.2em] text-primary uppercase">{h ? dayLabel(h) : '날짜 미정'}</span><span className="text-xs text-muted-foreground">안건 {gs.length}</span><span className="h-px flex-1 bg-border" /></div>}
              {gs.map(g => <Card key={g.key} g={g} v={v} all={all} send={send} onPanel={() => setPanel(g.key)} onPick={setPick} onPush={(env, x) => setPush({ g, env, items: [x] })} onFiles={setFiles} onClean={() => setClean({ ids: g.items.map(x => x.id), title: g.tag })} />)}
            </div>
          );
        })}
        {extra.map(e => <LooseCard key={e.run.id} e={e} onPick={setPick} onFiles={setFiles} />)}

        {deferred.length > 0 && (
          <Bracketed as="details" className="px-5 py-3">
            <summary className="cursor-pointer py-1 font-semibold"><span className="mr-2 font-mono text-[0.6875rem] tracking-[0.2em] text-amber-700 uppercase dark:text-amber-400">Deferred</span>연기 {deferred.length}</summary>
            <ul className="divide-y pt-2">{deferred.map(g => (
              <li key={g.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="font-semibold">{g.tag}</span><span className="font-mono text-xs text-muted-foreground">{g.items.map(x => `${repoName(x.repo)} · ${x.branch}`).join(', ')}</span>
                <span className="truncate text-xs text-muted-foreground">{g.items[0].notes[0]}</span>
                <Button size="sm" variant="outline" className="ml-auto" onClick={() => void send('edit', { ids: g.items.map(x => x.id), deferred: false }, `「${g.tag}」 연기를 풀었다`)}>연기 풀기</Button>
              </li>))}</ul>
          </Bracketed>
        )}
        {v.done > 0 && (
          <Bracketed className="px-5 py-3">
            <div className="flex flex-wrap items-center gap-2 py-1">
              <button type="button" aria-haspopup="dialog" onClick={() => setArchive(true)} className="flex min-w-0 flex-1 items-center gap-2 text-left font-semibold">
                <span className="font-mono text-[0.6875rem] tracking-[0.2em] text-primary uppercase">Complete</span>끝까지 다 나감 · 보관 {v.done}
              </button>
              {v.leftover.length > 0 && <>
                <span className="rounded-full bg-amber-500/12 px-2 text-xs leading-5 font-semibold text-amber-800 dark:text-amber-300" title={v.leftover.map(x => `${repoName(x.repo)} · ${x.branch}`).join('\n')}>브랜치 남은 것 {v.leftover.length}</span>
                <Button size="sm" variant="outline" className="h-8 text-primary" onClick={() => setClean({ ids: v.leftover.slice(0, 20).map(x => x.id), title: '보관했는데 남은 것' })}>남은 {Math.min(20, v.leftover.length)}개 정리</Button>
              </>}
              <Button size="sm" variant="outline" className="h-8" onClick={() => setArchive(true)}>열기</Button>
            </div>
          </Bracketed>
        )}
      </div>
      {open && <Panel g={open} v={v} all={all} send={send} onClose={() => setPanel(null)} />}
      {archive && <DoneSheet onOpen={setOld} onClose={() => setArchive(false)} />}
      {old && <Panel g={old} v={v} all={all} send={async (p, b, ok) => { const r = await send(p, b, ok); if (r) setOld(null); return r; }} onClose={() => setOld(null)} />}
      {pick && <ActionDialog pick={pick} onClose={() => setPick(null)} onStarted={() => setPressed(ps => [...ps.filter(x => x.run !== pick.run.id), { run: pick.run.id, label: pick.action.label, at: Date.now(), ...(pick.repo ? { repo: pick.repo } : {}) }])} />}
      {push && <PushDialog g={push.g} env={push.env} items={push.items} prep={v.hooks.prep} prod={push.env === v.envs.at(-1)!.name} onClose={() => setPush(null)} />}
      {files && <Sheet title={files.title} onClose={() => setFiles(null)}><ul className="space-y-1 font-mono text-xs">{files.list.map(f => <li key={f}>{f}</li>)}</ul></Sheet>}
      {adding && <AddSheet v={v} onClose={() => setAdding(false)} send={send} />}
      {clean && <CleanSheet ids={clean.ids} title={clean.title} onClose={() => setClean(null)} />}
    </main>
    </ActCtx.Provider>
  );
}

// 안건 카드 — 머리(티켓 · 이름 · 작업 중 · 배포일 · 배포 조치), 걸리는 것 한 줄, 레포마다 단계 선(밑에 이슈 줄), 메모 첫 줄
function Card({ g, v, all, send, onPanel, onPick, onPush, onFiles, onClean }: { g: Group; v: Board; all: Group[]; send: Send; onPanel: () => void; onPick: (p: Pick) => void; onPush: (env: string, x: Item) => void; onFiles: (x: { title: string; list: string[] }) => void; onClean: () => void }) {
  const qc = useQueryClient(), [preparing, setPreparing] = useState<string | null>(null);
  // 머지 준비 — 서버가 머지 브랜치에서 합치고, 충돌이면 새 Claude pane 을 연다(몇십 초). 끝나면 다시 읽기
  const prep = async (x: Item, env: string) => {
    setPreparing(x.id);
    try { toast((await post<{ text: string }>('/api/deploy/prepare', { id: x.id, env })).text, 9000); }
    catch (e) { toast(`준비하지 못했다 — ${(e as Error).message}`, 9000); }
    setPreparing(null);
    await qc.invalidateQueries({ queryKey: ['deploy'] });
  };
  const [diff, setDiff] = useState<string | null>(null);
  const ids = g.items.map(x => x.id), tasks = g.items.flatMap(x => x.tasks), working = g.items.some(x => (x.runs ?? []).some(r => r.state !== 'done'));
  const warn = g.items.flatMap(x => {
    const s = x.state, n = repoName(x.repo);
    return s?.error ? [`${n} — ${s.error}`] : [...(s?.stale ? [`${n} 배포 조치를 뽑은 뒤 커밋이 더 생겼다 — ${v.hooks.prep ? '「다시 뽑기」(런이 도는 중이면 끝난 뒤)' : '/deploy-prep 으로 다시'}`] : []), ...(s?.behind ? [`${n} origin 에만 있는 커밋 ${s.behind}`] : [])];
  });
  // 같은 런 단추는 카드에 한 번 — 그 단계가 지금 차례인 첫 줄에만(런 단추는 런 전체에 돈다). 레포 줄 단추(row — 푸시 · dev)는 줄마다, 누르면 그 줄 레포만
  const one = (r: RunLink, a: Action) => a.row && r.path ? `${r.id}:${a.n}:${r.path}` : `${r.id}:${a.n}`;
  const used = new Set<string>(), place = (runs: RunLink[], s: Step, branch: string, list = true) => runs.flatMap(r => r.actions.filter(a => fits(a, s) && !(list && a.reach === 'origin/stage') && !used.has(one(r, a))).map(a => (used.add(one(r, a)), { run: r, action: withFlow(a, branch, r.issue?.branch), ...(a.row && r.path ? { repo: r.path } : {}) })));
  // 가운데 환경(stage) 단추 — 레포 줄마다(사용자 결정 2026-10-26). 충돌이 있으면 「stage 머지 준비」(머지 브랜치에서 Claude 가 푼다) → 「stage 에 올리기」(푼 머지 커밋을 올린다)
  const promote = (x: Item) => (s: Step) => {
    const i = v.envs.findIndex(e => e.name === s.env), e = x.state?.envs[i];
    if (!s.act || i <= 0 || !e) return null;
    const prod = i === v.envs.length - 1;   // 운영 — 누르면 파이프라인이 바로 돈다(확인 창이 서버 strictCheck 를 보인다)
    const env = s.env!, ref = v.envs[i].ref, clash = e.conflicts ?? 0, p = e.prep, ready = !!p?.ready, glow = { boxShadow: `0 4px 12px ${mix(30)}` };
    return (
      <div className="flex flex-col items-center">
        {clash > 0 && p && (
          <Tip flow={[`${x.branch} → ${p.branch} (${ref} 위에서 합침)`, '충돌 파일은 새 Claude pane 이 푼다 — push 안 함']}
            wait={ready ? `이미 했다 — ${p.branch} 에 다 들어 있다. 다음 단추로` : p.merging ? `Claude 가 푸는 중 — ${p.merging} (herdr 「⇄ ${repoName(x.repo)} ${env} 충돌」)` : undefined}
            hint={`${env} 와 충돌 ${clash}곳: ${(e.files ?? []).join(', ')}`}>
            <Button size="sm" className="mt-1 h-8 font-bold shadow-md" style={ready || p.merging ? undefined : glow} disabled={ready || !!p.merging || preparing === x.id} onClick={() => void prep(x, env)}>
              {preparing === x.id ? '준비하는 중…' : `${env} 머지 준비 ›`}
            </Button>
          </Tip>
        )}
        <Tip flow={[clash ? `${p?.branch ?? '머지 브랜치'} → ${ref} (푼 머지 커밋)` : `${x.branch} → ${ref} (머지 커밋)`]}
          wait={clash && !ready ? `${env} 와 충돌 ${clash}곳 — 앞 단추(${env} 머지 준비) 먼저` : undefined}
          hint={prod ? '누르면 확인 창에서 나갈 커밋 · 바뀌는 파일 범위 · 충돌 표시 · 푼 파일에서 빠진 줄 · 배포 전 할 일을 먼저 본다 — 올리는 즉시 운영 파이프라인이 돈다'
            : '올리기 직전에 origin 을 다시 받고 앞 환경 · 충돌 · 커밋 안 한 변경 · origin 에만 있는 커밋을 본다 — 걸리면 올리지 않는다'}>
          <Button size="sm" variant={prod ? 'destructive' : 'default'} className="mt-1 h-8 font-bold shadow-md" style={clash && !ready || prod ? undefined : glow} disabled={clash > 0 && !ready} onClick={() => onPush(env, x)}>{env} 에 올리기 ›</Button>
        </Tip>
      </div>
    );
  };
  // 운영까지 다 나갔으면 「정리」, 배포 조치를 아직 안 뽑았으면 「배포 조치 뽑기」(공방 훅이 있을 때) — 뽑는 동안 · 실패는 그 자리에
  const finished = flagsClean(g, v), pulling = g.items.filter(x => x.prep?.code === null), failed = pulling.length ? [] : g.items.filter(x => x.prep?.code);
  const blank = !tasks.length && !g.items.some(x => x.block), stale = g.items.some(x => x.state?.stale), glow = { boxShadow: `0 4px 12px ${mix(30)}` };
  // 아직 바뀌는 중 — 커밋이 없는 레포가 있거나 그 안건을 다루는 런이 안 끝났다. 지금 뽑으면 곧 낡으니 뽑기 단추를 숨긴다(패널의 「뽑기」 는 그대로)
  const changing = g.items.some(x => x.state?.empty || (x.runs ?? []).some(r => r.state !== 'done' && r.state !== 'dropped'));
  const pull = () => pullPrep(ids, () => qc.invalidateQueries({ queryKey: ['deploy'] }));
  return (
    <Bracketed label={g.tag}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {tickets(g).map(t => { const href = linkOf(g, t); return href
          ? <a key={t} href={href} target="_blank" rel="noopener noreferrer" title={`원문 열기 — ${href}`} className="inline-flex items-center gap-1 font-mono text-xs text-primary underline-offset-2 hover:underline">{t}<Icon className="size-3">{EXTERNAL}</Icon></a>
          : <span key={t} className="font-mono text-xs text-primary">{t}</span>; })}
        <span className="text-base font-bold">{g.tag}</span>
        {working && <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 px-2 text-xs leading-5 font-semibold text-sky-800 dark:text-sky-300"><span className="size-1.5 rounded-full bg-sky-500" />작업 중</span>}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {failed.length > 0 && <span className="max-w-72 truncate text-xs text-rose-700 dark:text-rose-300" title={failed.map(x => `${repoName(x.repo)} — ${x.prep!.note ?? `끝 코드 ${x.prep!.code}`}`).join('\n')}>뽑기 실패 — {failed[0].prep!.note ?? `끝 코드 ${failed[0].prep!.code}`}</span>}
          {pulling.length > 0 && <Button size="sm" variant="outline" className="h-8 text-primary" disabled><span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-current" />뽑는 중 · 레포 {pulling.length}개</Button>}
          {v.hooks.prep && !pulling.length && blank && !finished && !changing && <><span className="text-xs text-amber-800 dark:text-amber-300">아직 안 뽑음 — 레포 {g.items.length}개</span>
            <Button size="sm" className="h-8 font-bold" style={glow} onClick={() => void pull()}>배포 조치 뽑기</Button></>}
          {v.hooks.prep && !pulling.length && !blank && stale && !changing && <Button size="sm" variant="outline" className="h-8 text-primary" onClick={() => void pull()}>다시 뽑기</Button>}
          <DateField g={g} all={all} onPick={date => void send('edit', { ids, date })} />
          {(!blank || !v.hooks.prep || finished || changing) && <Button size="sm" variant="outline" className="h-8 text-primary" aria-haspopup="dialog" onClick={onPanel}>{tasks.length ? `배포 조치 ${tasks.filter(t => t.done).length}/${tasks.length}` : '배포 조치 없음'}</Button>}
          {finished && <><span className="text-xs text-muted-foreground">운영까지 다 나감</span><Button size="sm" className="h-8 font-bold" style={glow} aria-haspopup="dialog" onClick={onClean}>정리</Button></>}
        </span>
      </div>
      {warn.length > 0 && <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">{warn.join(' · ')}</p>}
      <div className="mt-2">
        {g.items.map(x => (
          <Fragment key={x.id}>
            <Row name={repoName(x.repo)} branch={`${x.branch}${x.state?.remote ? ' (origin)' : ''}`} label={own(x) ? undefined : `${x.ticket}${x.tag ? ` ${x.tag}` : ''}`} runs={(x.runs ?? []).filter(r => !r.issue)} error={x.state?.error} onDiff={() => setDiff(x.id)}>
              <Track steps={itemSteps(x, v.envs)} acts={s => place(leads(x), s, x.branch)} extra={promote(x)} onPick={onPick} name={`${repoName(x.repo)} · ${x.branch}`} onFiles={onFiles} />
            </Row>
            {(x.runs ?? []).filter(r => r.issue).map(r => (
              <Row key={r.id} sub name={`↳ 이슈 ${r.issue!.branch ?? ''}`} branch={`${r.issue!.branch ?? ''} → ${x.branch}`} runs={[r]} error={r.issue!.error}>
                <Track steps={issueSteps(r)} acts={s => place([r], s, x.branch, false)} onPick={onPick} name={`${r.issue!.name} · ${r.issue!.branch}`} onFiles={onFiles} />
              </Row>
            ))}
          </Fragment>
        ))}
      </div>
      <div className="mt-2 flex items-baseline gap-2.5 border-t border-border/70 pt-2">
        <span className="shrink-0 text-xs font-semibold text-muted-foreground">메모</span>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={g.items.flatMap(x => x.notes).join('\n')}>{g.items.flatMap(x => x.notes)[0] ?? '—'}</span>
        <button type="button" className="shrink-0 text-sm font-semibold text-primary hover:underline" onClick={onPanel}>메모 · 기록 ›</button>
      </div>
      {diff && <DiffSheet id={diff} onClose={() => setDiff(null)} />}
    </Bracketed>
  );
}
// 배포 조치 뽑기 — 서버가 공방 훅을 레포마다 돌린다(기다리지 않는다 — 카드가 3초마다 「뽑는 중」 을 다시 본다)
async function pullPrep(ids: string[], again: () => Promise<unknown>) {
  try { toast((await post<{ text: string }>('/api/deploy/prep', { ids })).text, 4000); }
  catch (e) { toast(`뽑지 못했다 — ${(e as Error).message}`, 7000); }
  await again();
}
// 정리 가능 — 레포가 다 운영에 들어갔고 운영 할 일이 끝났고, 그 안건을 다루는 런이 다 끝났을 때(도는 런의 워크트리를 치우지 않게)
const flagsClean = (g: Group, v: Board) => g.items.every(x => !x.state?.empty && reached(x.state?.envs.at(-1)) && !x.tasks.some(t => t.env === v.envs.at(-1)!.name && !t.done))
  && !g.items.some(x => (x.runs ?? []).some(r => r.state !== 'done' && r.state !== 'dropped'));

// 목록에 없는 런 일 — 그 런이 남긴 레포 칸(edith-repos.json)만으로. 등록은 스킬(edith deploy add)이나 「+ 항목」
function LooseCard({ e, onPick, onFiles }: { e: Board['extra'][number]; onPick: (p: Pick) => void; onFiles: (x: { title: string; list: string[] }) => void }) {
  const used = new Set<number>();
  return (
    <Bracketed label={`런 #${e.run.id}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <a href={`#/runs/${e.run.id}`} className="font-mono text-xs text-primary hover:underline">#{e.run.id}</a>
        <span className="text-base font-bold">{e.run.title}</span>
        {e.run.tag && <span className="rounded border px-1.5 font-mono text-[0.6875rem] text-primary">{e.run.tag}</span>}
        <span className="ml-auto rounded border border-dashed px-1.5 text-xs text-muted-foreground" title="배포 목록에 등록되지 않은 런 일 — edith deploy add 로 넣으면 안건 카드로 묶인다">목록에 없음</span>
      </div>
      <div className="mt-2">
        {e.repos.map(x => (
          <Row key={x.path} name={x.name} branch={x.branch ?? ''} runs={[e.run]} error={x.error}>
            <Track steps={looseSteps(x, e.run)} acts={s => e.run.actions.filter(a => fits(a, s) && !used.has(a.n)).map(a => (used.add(a.n), { run: e.run, action: withFlow(a, x.via?.ref ?? x.branch ?? '', x.via ? x.branch : undefined) }))} onPick={onPick} name={`${x.name} · ${x.branch}`} onFiles={onFiles} />
          </Row>
        ))}
      </div>
    </Bracketed>
  );
}

// 레포 한 줄 — 왼쪽 이름 · 브랜치 · 런, 오른쪽 단계 선
// label — 안건에 든 이슈 항목의 제 티켓 · 이름(카드 이름은 안건 것이라)
function Row({ name, branch, label, runs, error, sub, onDiff, children }: { name: string; branch: string; label?: string; runs: RunLink[]; error?: string; sub?: boolean; onDiff?: () => void; children: ReactNode }) {
  return (
    <div className={`flex flex-wrap items-start gap-x-5 gap-y-2.5 py-3 ${sub ? 'ml-5 border-t border-dashed border-border/80' : 'border-t border-border/70'}`}>
      <div className={`${sub ? 'w-51' : 'w-56'} min-w-0 shrink-0`}>
        <div className="truncate text-sm font-semibold" title={name}>{name}</div>
        <div className="truncate font-mono text-[0.6875rem] text-muted-foreground" title={branch}>{branch}</div>
        {label && <div className="truncate text-xs font-semibold text-primary" title={label}>{label}</div>}
        {runs.map(r => <a key={r.id} href={`#/runs/${r.id}`} title={r.title} className="mr-2 text-xs font-semibold text-primary hover:underline">런 #{r.id} ›</a>)}
        {onDiff && <button type="button" onClick={onDiff} title="이 브랜치가 운영에 더할 코드 — 워크트리 체크아웃과 상관없이 커밋으로 본다" className="text-xs font-semibold text-primary hover:underline">변경 ›</button>}
      </div>
      {error ? <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p> : children}
    </div>
  );
}

// 단계 선 — 칸마다 노드 · 이름 · 한 줄, 지금 차례 칸에 단추. 칸 사이 선은 다음 칸 상태 색(끝남 실선 · 하는 중 하늘 · 아니면 점선)
function Track({ steps, acts, extra, onPick, name, onFiles }: { steps: Step[]; acts: (s: Step) => Pick[]; extra?: (s: Step) => ReactNode; onPick: (p: Pick) => void; name: string; onFiles: (x: { title: string; list: string[] }) => void }) {
  const line = (s?: Step) => !s ? '' : s.state === 'done' ? 'border-primary border-solid' : s.state === 'work' ? 'border-sky-500 border-solid' : s.state === 'partial' ? 'border-amber-500 border-solid' : s.state === 'check' ? 'border-blue-500 border-solid' : 'border-border border-dashed';
  if (!steps.length) return <span className="text-sm text-muted-foreground">상태를 읽는 중…</span>;
  return (
    <ol aria-label="단계" className="grid min-w-0 flex-[999_1_32rem]" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((s, i) => (
        <li key={s.key} className="flex flex-col items-center gap-1 px-1 text-center">
          <div className="relative flex h-7 w-full items-center justify-center">
            {i > 0 && <span className={`absolute top-1/2 right-1/2 left-0 border-t-2 ${line(s)}`} />}
            {i < steps.length - 1 && <span className={`absolute top-1/2 right-0 left-1/2 border-t-2 ${line(steps[i + 1])}`} />}
            <Node s={s} />
          </div>
          <span className={`font-mono text-[0.6875rem] tracking-[0.14em] uppercase ${s.state === 'next' ? 'font-bold text-primary' : s.state === 'work' ? 'font-bold text-sky-700 dark:text-sky-300' : s.state === 'partial' ? 'font-bold text-amber-700 dark:text-amber-400' : s.state === 'check' ? 'font-bold text-blue-700 dark:text-blue-400' : s.state === 'todo' ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}>{s.name}</span>
          <Note s={s} name={name} onFiles={onFiles} />
          {s.todo && <span className="rounded-full bg-amber-500/12 px-2 text-[0.6875rem] leading-5 font-semibold text-amber-800 dark:text-amber-300">{s.todo}</span>}
          {acts(s).map(p => <RunButton key={`${p.run.id}:${p.action.n}`} p={p} onPick={onPick} />)}
          {extra?.(s)}
        </li>
      ))}
    </ol>
  );
}

// 런 단추 — 그 런의 단추가 도는 동안 「도는 중 · N초」(같은 런 다른 단추는 막는다 — 서버도 한 런에 하나만), 끝나면 아래에 마지막 결과 한 줄
function RunButton({ p, onPick, small }: { p: Pick; onPick: (p: Pick) => void; small?: boolean }) {
  const ctx = useContext(ActCtx), b = ctx.busy(p.run.id), same = (x: Act | null) => x?.label === p.action.label && (x.repo ?? '') === (p.repo ?? '');
  const mine = same(b) ? b : null, l = ctx.last(p.run.id), done = !b && same(l) ? l : null;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <Tip flow={flowLines(p.action)} wait={p.action.wait} hint={p.action.hint}>
        <Button size="sm" variant={small || p.action.copy ? 'outline' : 'default'} disabled={!!b || !!p.action.wait} className={small ? 'h-8 text-primary' : 'mt-1 h-8 font-bold shadow-md'} style={small || p.action.copy || p.action.wait ? undefined : { boxShadow: `0 4px 12px ${mix(30)}` }} onClick={() => onPick(p)}>
          {mine ? <><span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-current" />{p.action.label} — 도는 중 · {Math.max(0, Math.round((ctx.now - mine.at) / 1000))}초</> : small ? p.action.label : `${p.action.label} ›`}
        </Button>
      </Tip>
      {done && <span className={`text-[0.6875rem] ${done.code === 0 ? 'text-muted-foreground' : 'text-rose-700 dark:text-rose-300'}`} title={done.note}>{done.code === 0 ? `✓ ${at(done.at)} 끝` : `✗ 끝 코드 ${done.code}`}</span>}
    </div>
  );
}

const CHECK = <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4.5 4.5L19 7" /></svg>;
function Node({ s }: { s: Step }) {
  const say = { done: '끝남', partial: '일부', check: '확인 필요', next: '지금 차례', todo: '아직', work: '런이 하는 중' }[s.state];
  const base = 'relative grid place-items-center rounded-full';
  if (s.state === 'done') return <span role="img" aria-label={`${s.name} ${say}`} className={`${base} size-5 bg-primary text-primary-foreground`}>{CHECK}</span>;
  if (s.state === 'work') return <span role="img" aria-label={`${s.name} ${say}`} className={`${base} size-5 animate-pulse border-2 border-sky-500 bg-card motion-reduce:animate-none`} style={{ boxShadow: '0 0 0 4px rgb(14 165 233 / 0.2)' }} />;
  if (s.state === 'partial') return <span role="img" aria-label={`${s.name} ${say}`} className={`${base} size-5 border-2 border-amber-500`} style={{ background: 'linear-gradient(90deg, rgb(245 158 11) 50%, var(--card) 50%)' }} />;
  if (s.state === 'check') return <span role="img" aria-label={`${s.name} ${say}`} className={`${base} size-5 border-2 border-blue-500 bg-card text-[0.6875rem] font-bold text-blue-600`}>?</span>;
  if (s.state === 'next') return <span role="img" aria-label={`${s.name} ${say}`} className={`${base} size-5 border-2 border-primary bg-card`} style={{ boxShadow: `0 0 0 5px ${mix(18)}, 0 0 14px ${mix(45)}` }} />;
  return <span role="img" aria-label={`${s.name} ${say}`} className={`${base} size-3.5 border-2 border-border bg-card`} />;
}
// 칸 아래 한 줄 — 언제 · 어떻게, 일부면 빠진 파일 단추, 확인 필요면 같은 제목, 아직이면 충돌 수
function Note({ s, name, onFiles }: { s: Step; name: string; onFiles: (x: { title: string; list: string[] }) => void }) {
  const e = s.reach, cls = 'text-xs leading-snug';
  if (s.state === 'work') return <span className={`${cls} font-medium`}>{s.note}</span>;
  if (!e) return s.note ? <span className={`${cls} ${s.state === 'next' ? '' : 'text-muted-foreground'}`}>{s.note}</span> : null;
  if (e.state === 'in') return <span className={`${cls} text-muted-foreground`}>{s.key === 'via' ? '합침' : e.how === 'ff' ? 'fast-forward' : '머지'} · {at(e.at)}</span>;
  if (e.state === 'content') return <span className={`${cls} text-muted-foreground`} title="커밋 해시는 없지만 변경이 다 들어 있다(스쿼시 · 체리픽 · 다시 만든 머지)">내용 일치 · {at(e.at)}</span>;
  if (e.state === 'partial') return <span className={`${cls} text-amber-800 dark:text-amber-300`}>{e.n}개 중 {e.k}개 · <button type="button" className="underline-offset-2 hover:underline" onClick={() => onFiles({ title: `빠진 파일 — ${name}`, list: e.missing ?? [] })}>빠진 파일</button></span>;
  if (e.state === 'subject') return <span className={`${cls} text-blue-800 dark:text-blue-300`} title={`같은 제목 커밋 「${e.subject}」 이 있는데 변경이 그대로는 맞지 않는다 — 들어간 뒤 고쳐졌을 수 있다`}>제목만 같음 · {at(e.at)}</span>;
  if (s.conflicts) return <span className={`${cls} text-amber-800 dark:text-amber-300`}>충돌 {s.conflicts}곳</span>;
  if (s.state === 'next') return <span className={cls}>{s.key === 'via' ? '안건에 합칠 차례' : s.last ? '올리면 운영 배포' : '올릴 차례'}</span>;
  return null;
}

// 보관 창 — 보관한 안건을 최근부터 조금씩(서버가 날짜로 끊는다 — 같은 날 묶음은 한 번에). 찾기는 안건 · 브랜치 · 레포 · 메모, 줄을 누르면 그 안건 패널(기록 · 보관에서 되돌리기)
function DoneSheet({ onOpen, onClose }: { onOpen: (g: Group) => void; onClose: () => void }) {
  const [typed, setTyped] = useState(''), [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(typed.trim()), 300); return () => clearTimeout(t); }, [typed]);
  const d = useInfiniteQuery({
    queryKey: ['deploy-done', q], initialPageParam: '',
    queryFn: ({ pageParam }) => get<{ items: Item[]; more: string | null }>(`/api/deploy/done?q=${encodeURIComponent(q)}${pageParam ? `&before=${pageParam}` : ''}`),
    getNextPageParam: last => last.more ?? undefined,
  });
  const gs = groupsOf(d.data?.pages.flatMap(p => p.items) ?? []);
  return (
    <Sheet title="끝까지 다 나감 · 보관" onClose={onClose}>
      <div className="space-y-3">
        <input type="search" autoFocus value={typed} onChange={e => setTyped(e.target.value)} placeholder="안건 · 브랜치 · 레포 · 메모" aria-label="보관 찾기"
          className="h-9 w-full rounded-full border bg-card px-3.5 text-sm outline-none focus:ring-2 focus:ring-ring/40" />
        {!d.data ? <Empty>{d.error ? `읽지 못했다 — ${String(d.error)}` : '불러오는 중…'}</Empty> : !gs.length ? <Empty>{q ? '맞는 것이 없다.' : '보관한 것이 없다.'}</Empty> : (
          <ul className="divide-y">{gs.map(g => (
            <li key={g.key}>
              <button type="button" onClick={() => onOpen(g)} className="-mx-2 flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-md px-2 py-2 text-left hover:bg-muted/60">
                <span className="font-mono text-xs text-primary">{g.done ? dayLabel(g.done) : ''}</span><span className="font-semibold">{g.tag}</span>
                <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{g.items.map(x => `${repoName(x.repo)} · ${x.branch}`).join(', ')}</span>
                <span className="ml-auto text-sm text-primary">기록 ›</span>
              </button>
            </li>))}</ul>
        )}
        {d.hasNextPage && <Button variant="outline" className="w-full" disabled={d.isFetchingNextPage} onClick={() => void d.fetchNextPage()}>{d.isFetchingNextPage ? '불러오는 중…' : '더 보기'}</Button>}
      </div>
    </Sheet>
  );
}

// 오른쪽 패널 — 배포일 · 연기 · 보관, 배포 조치(환경마다 배포 전 · 후 체크 · 다시 뽑기 · 직접 한 일 적기 · 뽑은 범위 메모), 메모, 기록, 런
function Panel({ g, v, all, send, onClose }: { g: Group; v: Board; all: Group[]; send: Send; onClose: () => void }) {
  const ids = g.items.map(x => x.id), [arm, setArm] = useState(false), qc = useQueryClient(), pulling = g.items.some(x => x.prep?.code === null);
  const [view, setView] = useState<{ id: string; name: string } | null>(null);
  const log = g.items.flatMap(x => x.log.map(l => ({ ...l, repo: repoName(x.repo) }))).sort((a, b) => b.t - a.t).slice(0, 30);
  const envs = v.envs.filter(e => g.items.some(x => x.tasks.some(t => t.env === e.name))), runs = [...new Map(g.items.flatMap(x => x.runs ?? []).map(r => [r.id, r])).values()];
  const open = g.done ? false : !flagsClean(g, v);
  return (
    <Sheet side title={g.tag} sub={tickets(g).join(' · ') || g.items.map(x => repoName(x.repo)).join(' · ')} onClose={onClose}>
      <div className="space-y-5">
        {!g.done && <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-muted-foreground">배포일</span><DateField g={g} all={all} onPick={date => void send('edit', { ids, date })} />
            <span className="flex-1" />
            <Button size="sm" variant="outline" onClick={() => void send('edit', { ids, deferred: !g.deferred })}>{g.deferred ? '연기 풀기' : '연기'}</Button>
            <Button size="sm" variant="outline" title="배포가 끝난 안건을 「보관」 으로(워크트리 정리는 하지 않는다)" onClick={() => open ? setArm(a => !a) : void send('edit', { ids, done: true }, `「${g.tag}」 을 보관했다`).then(ok => ok && onClose())}>보관</Button></div>
          {arm && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400 bg-amber-500/10 px-3 py-2 text-sm">
            <span>아직 운영까지 안 갔거나 할 일이 남았다 — 그래도 보관할까?</span><span className="flex-1" />
            <Button size="sm" variant="outline" onClick={() => setArm(false)}>취소</Button><Button size="sm" onClick={() => void send('edit', { ids, done: true }, `「${g.tag}」 을 보관했다`).then(ok => ok && onClose())}>그래도 보관</Button></div>}
        </section>}
        {g.done && <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">{dayLabel(g.done)} 배포 끝(보관)</span><span className="flex-1" /><Button size="sm" variant="outline" onClick={() => void send('edit', { ids, done: false })}>보관에서 되돌리기</Button></div>}

        <section className="space-y-2">
          <div className="flex items-baseline gap-2">
            <h3 className="text-xs font-semibold text-muted-foreground">배포 조치 {g.items.find(x => x.block)?.block?.made ? `· ${g.items.find(x => x.block)!.block!.made} 뽑음` : ''}</h3><span className="flex-1" />
            {v.hooks.prep && !g.done && <button type="button" className="text-xs text-primary hover:underline disabled:opacity-50" disabled={pulling} onClick={() => void pullPrep(ids, () => qc.invalidateQueries({ queryKey: ['deploy'] }))}>{pulling ? '뽑는 중…' : g.items.some(x => x.block) ? '다시 뽑기' : '뽑기'}</button>}
          </div>
          {!envs.length ? <Empty>아직 없다 — {v.hooks.prep ? '「배포 조치 뽑기」 가 코드에서 뽑아 넣는다' : '/deploy-prep 이 코드에서 뽑아 넣는다(edith deploy block)'}. 손으로 한 일은 아래에 적는다.</Empty> : envs.map(e => (
            <div key={e.name} className="space-y-1">
              <p className="font-mono text-[0.6875rem] font-semibold tracking-[0.16em] text-primary uppercase">{e.name}</p>
              {(['전', '후'] as const).map(w => {
                const rows = g.items.flatMap(x => x.tasks.filter(t => t.env === e.name && whenOf(t.text) === w).map(t => ({ x, t })));
                return (
                  <div key={w}>
                    <p className="text-xs font-semibold">배포 {w} <span className="font-normal text-muted-foreground">{rows.filter(r => r.t.done).length}/{rows.length}</span></p>
                    {!rows.length ? <p className="py-1 text-xs text-muted-foreground">없다</p> : rows.map(({ x, t }) => (
                      <label key={`${x.id}${t.text}`} className="-mx-2 flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/60">
                        <input type="checkbox" className="mt-1 accent-[var(--primary)]" checked={t.done} onChange={() => void send('task', { id: x.id, env: t.env, text: t.text, was: t.done })} />
                        {g.items.length > 1 && <span className="w-24 shrink-0 truncate pt-0.5 text-xs text-muted-foreground" title={repoName(x.repo)}>{repoName(x.repo)}</span>}
                        <span className={`min-w-0 flex-1 text-sm break-words ${t.done ? 'text-muted-foreground line-through' : ''}`}>{plain(t.text)}</span>
                        {copyName(t.text) && <button type="button" className="shrink-0 rounded border px-1.5 text-xs leading-5 text-primary hover:border-primary" onClick={e => { e.preventDefault(); setView({ id: x.id, name: copyName(t.text)! }); }}>보기</button>}
                        {t.hand && <span className="shrink-0 rounded bg-muted px-1.5 text-[0.6875rem] leading-5 text-muted-foreground">직접 적음</span>}
                      </label>))}
                  </div>
                );
              })}
            </div>
          ))}
          {g.items.flatMap(x => x.block?.notes ?? []).map((n, i) => <p key={i} className="text-xs text-muted-foreground">· {n}</p>)}
          {!g.done && <HandTask g={g} v={v} send={send} />}
          {view && <FileSheet id={view.id} name={view.name} onClose={() => setView(null)} />}
        </section>

        <section className="space-y-2"><h3 className="text-xs font-semibold text-muted-foreground">메모</h3>{g.items.map(x => <Notes key={x.id} x={x} many={g.items.length > 1} send={send} />)}</section>
        {runs.length > 0 && <section className="space-y-1"><h3 className="text-xs font-semibold text-muted-foreground">런</h3>
          {runs.map(r => <a key={r.id} href={`#/runs/${r.id}`} className="flex gap-2 text-sm hover:underline"><span className="font-mono text-primary">#{r.id}</span><span className="min-w-0 flex-1 truncate">{r.title}</span><span className="text-xs text-muted-foreground">{r.state === 'done' ? '끝' : r.now ?? r.state}</span></a>)}</section>}
        <section className="space-y-1"><h3 className="text-xs font-semibold text-muted-foreground">기록</h3>
          {log.length ? <ul className="space-y-1 text-xs">{log.map((l, i) => <li key={i}><span className="font-mono text-muted-foreground">{at(l.t)}</span> · {g.items.length > 1 ? `${l.repo} ` : ''}{l.text}</li>)}</ul> : <Empty>기록이 없다.</Empty>}</section>
      </div>
    </Sheet>
  );
}

// 배포 조치 복사 파일 — 사람이 DB 에 직접 넣는 SQL 등(deploy-prep 이 만든다). 보기 · 복사만, EDITH 는 돌리지 않는다
function FileSheet({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['deploy-file', id, name], queryFn: () => get<{ name: string; text: string }>(`/api/deploy/file?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`) });
  const [copied, setCopied] = useState(false);
  return (
    <Sheet title={name} sub="DB 에 직접 넣는 글 — EDITH 는 돌리지 않는다" onClose={onClose}>
      <div className="space-y-3">
        {q.data ? <pre className="max-h-[55vh] overflow-auto rounded-lg bg-[var(--code)] px-3 py-2.5 font-mono text-xs whitespace-pre text-[var(--code-foreground)]">{q.data.text}</pre>
          : <Empty>{q.error ? `읽지 못했다 — ${String(q.error)}` : '불러오는 중…'}</Empty>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>닫기</Button>
          <Button disabled={!q.data} onClick={() => void copyText(q.data!.text).then(() => setCopied(true))}>{copied ? '복사됨' : '복사'}</Button>
        </div>
      </div>
    </Sheet>
  );
}

// 직접 한 일 적기 — 백필처럼 사람이 한 일을 체크된 채 한 줄(「배포 전 · 후 — 글」). 다시 뽑아도 남는다(서버 addTask)
function HandTask({ g, v, send }: { g: Group; v: Board; send: Send }) {
  const envs = v.envs.slice(1), [id, setId] = useState(g.items[0].id), [env, setEnv] = useState(envs.at(-1)!.name), [w, setW] = useState<'전' | '후'>('후'), [t, setT] = useState('');
  const field = 'h-8 rounded-md border bg-card px-2 text-sm outline-none focus:ring-2 focus:ring-ring/40';
  return (
    <form className="space-y-2 rounded-lg border border-dashed p-3" onSubmit={async e => { e.preventDefault(); if (await send('task-add', { id, env, when: w, text: t.trim() }, '적었다')) setT(''); }}>
      <p className="text-xs font-semibold">직접 한 일 적기 <span className="font-normal text-muted-foreground">— 체크된 채 들어가고, 다시 뽑아도 남는다</span></p>
      <div className="flex flex-wrap gap-2">
        {g.items.length > 1 && <select aria-label="레포" value={id} onChange={e => setId(e.target.value)} className={field}>{g.items.map(x => <option key={x.id} value={x.id}>{repoName(x.repo)}</option>)}</select>}
        <select aria-label="환경" value={env} onChange={e => setEnv(e.target.value)} className={field}>{envs.map(e => <option key={e.name} value={e.name}>{e.name}</option>)}</select>
        <div role="group" aria-label="언제" className="flex overflow-hidden rounded-md border">
          {(['전', '후'] as const).map(k => <button key={k} type="button" aria-pressed={w === k} onClick={() => setW(k)} className={`h-8 px-2.5 text-xs ${w === k ? 'bg-accent font-semibold' : 'text-muted-foreground hover:bg-muted'}`}>배포 {k}</button>)}
        </div>
        <input value={t} onChange={e => setT(e.target.value)} aria-label="한 일" placeholder="예: 과거 데이터 백필 명령 돌림" className={`${field} min-w-0 flex-1 basis-48`} />
        <Button size="sm" type="submit" variant="outline" className="h-8 text-primary" disabled={!t.trim()}>적기</Button>
      </div>
    </form>
  );
}

// 정리 — 미리보기(서버가 레포마다 코드가 들어갔나 · 커밋 안 한 변경 · 워크스페이스 · 공방 훅으로 확인 — 훅에 따라 몇 분)를 보고, 통과한 레포(와 넘기기로 고른 레포)만 치운다(src/cleanup.ts).
// 걸린 레포를 위에 펼쳐 까닭 · 고치기(훅 fix 단추) · 넘기기를 두고, 통과한 레포는 한 줄로 접는다(시안 A, 2026-10-28)
type Line = { what: string; ref: string; parts?: string; ok: boolean; check: string; skippable?: true; fix?: string };
type CleanPlan = { id: string; name: string; branch: string; lines: Line[]; ok: boolean; targets: { worktree?: string; local: boolean; spaces: unknown[] }[] };
type Fix = { at: number; ok: boolean; text: string };
type CleanState = { missing?: true; done?: boolean; since?: number; plans?: CleanPlan[]; error?: string; fixes?: Record<string, Fix> };
// 걸린 줄이 모두 엔진이 넘겨도 된다고 한 확인이면 「넘기고 정리」 를 고를 수 있다(EDITH 자신의 확인은 못 넘긴다 — 서버가 다시 본다)
const skippable = (p: CleanPlan) => !p.ok && p.lines.some(l => !l.ok) && p.lines.filter(l => !l.ok).every(l => l.skippable);
const hhmm = (t: number) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
// 치울 것 한 줄 — 워크트리 · 워크스페이스 · 로컬 브랜치 수
const sweep = (p: CleanPlan) => [[p.targets.filter(t => t.worktree).length, '워크트리'], [p.targets.reduce((k, t) => k + t.spaces.length, 0), '워크스페이스'], [p.targets.filter(t => t.local).length, '로컬 브랜치']]
  .flatMap(([k, w]) => k ? [`${w} ${k}`] : []).join(' · ') || '치울 것 없음 — 보관만';
const Ico = ({ d, className = '' }: { d: string; className?: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`size-3.5 shrink-0 ${className}`}><path d={d} /></svg>;
const LineList = ({ lines }: { lines: Line[] }) => (
  <div className="text-xs">{lines.map((l, i) => (
    <div key={i} className="grid grid-cols-[4rem_minmax(0,1fr)_minmax(0,9rem)] items-start gap-x-2 border-t border-border/60 py-1.5 first:border-t-0">
      <span className="text-muted-foreground">{l.what}</span>
      <span className="min-w-0"><span className="block font-mono break-all">{l.ref}</span>{l.parts && <span className="block whitespace-pre-line text-muted-foreground">{l.parts}</span>}</span>
      <span className={l.ok ? 'text-emerald-700 dark:text-emerald-400' : 'font-semibold text-rose-700 dark:text-rose-300'}>{l.ok ? '✓' : '✕'} {l.check}</span>
    </div>))}
  </div>
);
// 확인은 서버가 뒤에서 하고(몇 분 걸릴 수 있다) 화면은 2초마다 본다 — 그사이 EDITH 를 다시 켜면 서버가 잊으니(missing) 「다시 확인」.
// 창을 다시 열면 서버가 기억하는 앞 결과(같은 항목)를 그대로 보인다 — 새로 보는 것은 「다시 확인」
function CleanSheet({ ids, title, onClose }: { ids: string[]; title: string; onClose: () => void }) {
  const qc = useQueryClient(), [plans, setPlans] = useState<CleanPlan[] | null>(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false), [res, setRes] = useState<string | null>(null);
  const [since, setSince] = useState(0), [now, setNow] = useState(Date.now()), [skip, setSkip] = useState<Set<string>>(new Set()), round = useRef(0);
  const [fixes, setFixes] = useState<Record<string, Fix>>({}), [fixing, setFixing] = useState('');
  const state = () => get<CleanState>(`/api/deploy/clean-plan?ids=${encodeURIComponent(ids.join(','))}`);
  const shown = (s: CleanState) => { if (s.error) setErr(s.error); else setPlans(s.plans ?? []); setFixes(s.fixes ?? {}); };
  const watch = async (n: number) => {
    for (;;) {
      await new Promise(ok => setTimeout(ok, 2000));
      if (n !== round.current) return;
      let s: CleanState;
      try { s = await state(); } catch { continue; }   // 다시 켜는 중이면 잠깐 닿지 않는다
      if (n !== round.current) return;
      if (s.missing) { setErr('확인이 끊겼다 — 그사이 EDITH 를 다시 켰다. 「다시 확인」'); return; }
      if (s.done) return shown(s);
    }
  };
  const look = async () => {
    const n = ++round.current;
    setPlans(null); setErr(''); setSkip(new Set()); setFixes({}); setSince(Date.now()); setNow(Date.now());
    try { await post('/api/deploy/clean-plan', { ids }); } catch (e) { setErr(`EDITH 에 닿지 않았다 — ${(e as Error).message}`); return; }
    await watch(n);
  };
  // 열 때 — 앞 결과가 있으면 그것(끝났으면 그대로, 보는 중이면 이어서), 없으면 새로
  const open = async () => {
    const n = ++round.current;
    const s = await state().catch(() => null);
    if (n !== round.current) return;
    if (!s || s.missing) return look();
    setSince(s.since ?? Date.now());
    if (s.done) return shown(s);
    await watch(n);
  };
  useEffect(() => { void open(); return () => { round.current++; }; }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (plans || err) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [plans, err]);
  const stuck = plans?.filter(p => !p.ok) ?? [], pass = plans?.filter(p => p.ok) ?? [], over = stuck.filter(p => skippable(p) && skip.has(p.id));
  const go = async () => {
    setBusy(true);
    try {
      const r = await post<{ text: string; done: string[]; stopped: string[] }>('/api/deploy/clean', { ids: [...pass, ...over].map(p => p.id), skip: over.map(p => p.id) });
      setRes(r.text); toast(r.stopped.length ? `정리 ${r.done.length} · 남음 ${r.stopped.length}` : `${r.done.length}개 레포를 정리했다`, 4000);
    } catch (e) { toast(`정리하지 못했다 — ${(e as Error).message}`, 8000); }
    setBusy(false);
    await Promise.all(['deploy', 'deploy-done'].map(k => qc.invalidateQueries({ queryKey: [k] })));
  };
  // 고치기 — 훅이 그 일을 맡기고 바로 돌아온다(끝났는지는 「다시 확인」)
  const fix = async (p: CleanPlan, l: Line) => {
    const k = `${p.id}\n${l.ref}`;
    setFixing(k);
    try { const f = await post<Fix>('/api/deploy/clean-fix', { id: p.id, ref: l.ref }); setFixes(x => ({ ...x, [k]: f })); toast(`${l.fix} — ${f.text}`, 4000); }
    catch (e) { toast(`${l.fix} 못 함 — ${(e as Error).message}`, 8000); }
    setFixing('');
  };
  const chip = (text: string, warn: boolean) => <span className={`rounded-full px-2.5 text-xs leading-6 font-semibold ${warn ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300' : 'bg-emerald-500/12 text-emerald-800 dark:text-emerald-300'}`}>{text}</span>;
  return (
    <Sheet side title={`정리 — ${title}`} sub="통과했거나 넘기기로 고른 레포만 치운다" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">
            {plans ? `${hhmm(since)} 에 확인한 결과 · 레포 ${plans.length}개${now - since > 10 * 60_000 ? ' — 오래됐다(정리할 때 엔진 확인을 한 번 더 본다)' : ''}` : err ? '' : `${hhmm(since)} 에 시작한 확인 — ${Math.max(0, Math.round((now - since) / 1000))}초째 (창을 닫았다 열어도 이 확인을 이어서 본다)`}
          </span>
          {!res && (plans || err) && <Button size="sm" variant="outline" className="h-8 gap-1.5 text-primary" onClick={() => void look()}><Ico d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6" />다시 확인</Button>}
        </div>
        {err && <p className="text-sm text-rose-700 dark:text-rose-300">{err}</p>}
        {!plans && !err && <Empty>코드가 들어갔나 · 커밋 안 한 변경 · 워크스페이스 · 엔진 훅을 본다 — 몇 분 걸릴 수 있다(창을 닫아도 서버는 계속 본다)</Empty>}
        {res && <pre role="status" className="rounded-lg border border-primary/50 bg-primary/5 px-3 py-2 text-xs whitespace-pre-wrap">{res}</pre>}
        {plans && !res && <>
          <div className="flex gap-2">{stuck.length > 0 && chip(`확인 필요 ${stuck.length}`, true)}{pass.length > 0 && chip(`통과 ${pass.length}`, false)}</div>
          {stuck.length > 0 && <section className="space-y-2" aria-label="확인 필요">
            <h3 className="text-sm font-bold">확인 필요</h3>
            {stuck.map(p => {
              const bad = p.lines.filter(l => !l.ok), good = p.lines.filter(l => l.ok), fixable = bad.filter(l => l.fix), can = skippable(p), chosen = can && skip.has(p.id);
              return (
                <div key={p.id} className="space-y-2.5 rounded-lg border border-amber-400/70 bg-card px-3.5 py-3">
                  <div className="flex items-baseline gap-2"><span className="font-semibold">{p.name}</span><span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{p.branch}</span></div>
                  {bad.map((l, i) => {
                    const f = fixes[`${p.id}\n${l.ref}`];
                    return (
                      <div key={i} className="space-y-1">
                        <p className="flex items-center gap-1.5 text-sm font-semibold text-rose-700 dark:text-rose-300"><Ico d="M12 8v5M12 16.5v.5M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18" />{l.check}</p>
                        <p className="text-xs text-muted-foreground">{l.what} · <span className="font-mono">{l.ref}</span></p>
                        {l.parts && <p className="text-xs leading-relaxed whitespace-pre-line">{l.parts}</p>}
                        {f && <p role="status" className={`rounded-md px-2.5 py-1.5 text-xs ${f.ok ? 'bg-primary/10 text-primary' : 'bg-rose-500/10 text-rose-700 dark:text-rose-300'}`}>{l.fix} — {f.text} · {hhmm(f.at)}{f.ok ? ' · 끝나면 「다시 확인」' : ''}</p>}
                      </div>
                    );
                  })}
                  {good.length > 0 && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">통과한 확인 {good.length}줄</summary><div className="mt-1"><LineList lines={good} /></div></details>}
                  {(fixable.length > 0 || can) && <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    {fixable.map(l => { const k = `${p.id}\n${l.ref}`; return (
                      <Button key={l.ref} size="sm" variant="outline" className="h-8 text-primary" disabled={!!fixing} onClick={() => void fix(p, l)}>{fixing === k ? '맡기는 중…' : `${l.fix}${fixable.length > 1 ? ` · ${l.ref}` : ''}`}</Button>); })}
                    {can && <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold">
                      <input type="checkbox" className="size-4 accent-primary" checked={chosen} onChange={e => setSkip(k => { const n = new Set(k); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} />넘기고 정리
                    </label>}
                    <span className="flex-1" />
                    {chosen && <span className="rounded-full bg-muted px-2 text-xs leading-5 font-semibold">넘김</span>}
                  </div>}
                </div>
              );
            })}
          </section>}
          {pass.length > 0 && <section className="space-y-2" aria-label="통과">
            <h3 className="text-sm font-bold">통과</h3>
            <div className="rounded-lg border bg-card">{pass.map(p => (
              <details key={p.id} className="group border-t first:border-t-0">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 [&::-webkit-details-marker]:hidden">
                  <Ico d="M5 12.5l4.5 4.5L19 7.5" className="text-emerald-700 dark:text-emerald-400" />
                  <span className="min-w-0 flex-1"><span className="flex items-baseline gap-2"><span className="text-sm font-semibold">{p.name}</span><span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{p.branch}</span></span>
                    <span className="block text-xs text-muted-foreground">{sweep(p)}</span></span>
                  <Ico d="M6 9l6 6 6-6" className="text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="px-3.5 pb-2.5"><LineList lines={p.lines} /></div>
              </details>))}
            </div>
          </section>}
          <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">치우는 것 · 남기는 것</summary>
            <p className="mt-1.5 leading-relaxed">워크스페이스 닫기 → 워크트리 제거(강제 아님) → 로컬 브랜치 삭제 → 다 치우면 보관. 원격 브랜치(origin/…) · 레포 본 체크아웃 · 이어진 런 기록은 남긴다. 걸린 레포는 아무것도 지우지 않고 까닭을 남긴다.</p>
          </details>
          <div className="sticky bottom-0 -mx-5 -mb-4 flex items-center gap-3 border-t bg-background px-5 py-3">
            <span className="flex-1 text-xs text-muted-foreground">정리 {pass.length + over.length}{over.length ? ` (넘김 ${over.length})` : ''}{stuck.length - over.length ? ` · 남김 ${stuck.length - over.length}` : ''}</span>
            <Button disabled={busy || !pass.length && !over.length} onClick={() => void go()}>{busy ? '정리하는 중…' : `${pass.length + over.length}개 레포 정리`}</Button>
          </div>
        </>}
      </div>
    </Sheet>
  );
}

// 배포일 칸 — 누르면 빨리 고르기(오늘 · 앞으로 평일 다섯 날, 그날 다른 안건 수) · 숫자로(1030 · Enter 저장 · Esc 취소) · 미정으로
function DateField({ g, all, onPick }: { g: Group; all: Group[]; onPick: (date: string | null) => void }) {
  const [open, setOpen] = useState(false), [typed, setTyped] = useState('');
  const days = useMemo(() => { const out: string[] = [], d = new Date(); out.push(ymd(d)); while (out.length < 6) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) out.push(ymd(d)); } return out; }, []);
  const pick = (d: string | null) => { setOpen(false); setTyped(''); if (d !== (g.date ?? null)) onPick(d); };
  return (
    <div className="relative">
      <Button size="sm" variant="outline" aria-expanded={open} className={`h-8 ${g.date ? 'border-primary/50 bg-primary/7 font-bold text-primary' : 'border-dashed text-muted-foreground'}`} onClick={() => setOpen(o => !o)}>{g.date ? `배포 ${dayLabel(g.date)}` : '배포일 정하기'}</Button>
      {open && <div className="absolute right-0 z-20 mt-2 w-80 space-y-2 rounded-xl border bg-popover p-3 text-left text-popover-foreground shadow-xl">
        <div className="text-xs text-muted-foreground">빨리 고르기</div>
        <div className="grid grid-cols-2 gap-1.5">
          {days.map((d, i) => { const n = all.filter(x => x.key !== g.key && !x.done && x.date === d).length; return (
            <Button key={d} size="sm" variant={d === g.date ? 'default' : 'outline'} className="h-auto justify-start py-1.5 text-left text-xs" onClick={() => pick(d)}>
              {i === 0 ? '오늘 ' : ''}{dayLabel(d)}{n ? <span className="ml-1 opacity-70">· {n}건</span> : null}</Button>); })}
          <Button size="sm" variant="outline" className="h-auto justify-start border-dashed py-1.5 text-xs text-muted-foreground" onClick={() => pick(null)}>미정으로 되돌리기</Button>
        </div>
        <label className="block space-y-1 text-xs text-muted-foreground">숫자로 — 1030 처럼 · Enter 저장 · Esc 취소
          <input autoFocus value={typed} onChange={e => setTyped(e.target.value)} aria-label="배포일 숫자로" placeholder="MMDD"
            onKeyDown={e => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter' && !e.nativeEvent.isComposing) { const d = typedDay(typed); if (d) pick(d); else toast('날짜를 못 읽었다 — 1030 · 10/30 꼴', 3000); } }}
            className="mt-1 h-8 w-full rounded-md border bg-card px-2 font-mono text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40" />
        </label>
      </div>}
    </div>
  );
}

// 메모 — 항목(레포)마다 줄 목록. 고치기는 그 자리 글상자(한 줄 = 메모 하나)
function Notes({ x, many, send }: { x: Item; many: boolean; send: Send }) {
  const [edit, setEdit] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-2">{many && <span className="text-xs font-semibold text-muted-foreground">{repoName(x.repo)}</span>}<span className="flex-1" />
        {edit === null && <button type="button" className="text-xs text-primary hover:underline" onClick={() => setEdit(x.notes.join('\n'))}>고치기</button>}</div>
      {edit === null ? (x.notes.length ? <ul className="list-disc space-y-0.5 pl-5 text-sm">{x.notes.map((n, i) => <li key={i} className="break-words">{n}</li>)}</ul> : <Empty>메모 없음</Empty>)
        : <div className="space-y-1.5">
          <textarea value={edit} onChange={e => setEdit(e.target.value)} rows={Math.min(12, Math.max(3, edit.split('\n').length + 1))} aria-label="메모(한 줄에 하나)" className="w-full rounded-md border bg-card px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/40" />
          <div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setEdit(null)}>취소</Button>
            <Button size="sm" onClick={() => void send('edit', { ids: [x.id], notes: edit }).then(ok => ok && setEdit(null))}>저장</Button></div>
        </div>}
    </div>
  );
}

// 다음 환경에 올리기 — 레포 줄 하나(서버는 여럿도 받는다 — 모두 먼저 보고 하나라도 안 되면 아무것도 안 올린다)
// 운영 확인(서버 promoteCheck) — 레포마다 나갈 커밋 · 막는 까닭 · 충돌을 푼 파일에서 빠진 줄 · 남은 배포 전 할 일
type Check = { env: string; repos: { id: string; name: string; bad?: string; skip?: string; before: string[]; strict?: { commits: string[]; files: number; conflicts: string[]; hard: string[]; lost: { file: string; side: string; line: string }[] } }[] };
function PushDialog({ g, env, items, prep, prod, onClose }: { g: Group; env: string; items: Item[]; prep: boolean; prod: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false), qc = useQueryClient(), i = items[0]?.state?.envs.findIndex(e => e.name === env) ?? -1;
  const [chk, setChk] = useState<Check | null>(null), [cerr, setCerr] = useState(''), [ack, setAck] = useState(false);
  useEffect(() => { if (prod) post<Check>('/api/deploy/promote-check', { ids: items.map(x => x.id), env }).then(setChk, (e: Error) => setCerr(e.message)); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const hard = chk ? chk.repos.flatMap(r => [...(r.bad ? [r.bad] : []), ...(r.strict?.hard ?? []).map(h => `${r.name} — ${h}`), ...(r.before.length ? [`${r.name} — ${env} 배포 전 할 일 ${r.before.length}개 체크 안 됨: ${r.before.map(plain).join(' · ')}`] : [])]) : [];
  const lost = chk?.repos.flatMap(r => (r.strict?.lost ?? []).map(l => ({ ...l, repo: r.name }))) ?? [];
  const ready = !prod || (!!chk && !hard.length && (!lost.length || ack));
  const prepped = items.filter(x => x.state?.envs[i]?.conflicts && x.state.envs[i].prep?.ready).map(x => x.state!.envs[i].prep!.branch), before = leftIn(items, env, '전');
  // 배포 조치를 한 번도 안 뽑은 레포 — 할 일이 없는지 모르는 것(뽑으면 할 일이 없어도 「따로 할 일 없음」 한 줄이 생긴다)
  const unpicked = prep ? items.filter(x => !x.block && !x.tasks.length) : [];
  const go = async () => {
    setBusy(true);
    try { const r = await post<{ text: string }>('/api/deploy/promote', { ids: items.map(x => x.id), env, ...(prod && ack ? { ack: true } : {}) }); toast(r.text, 6000); onClose(); }
    catch (e) { toast(`올리지 않았다 — ${(e as Error).message}`, 9000); setBusy(false); }
    await qc.invalidateQueries({ queryKey: ['deploy'] });
  };
  return (
    <Sheet title={`${items.map(x => repoName(x.repo)).join(' · ')} 을 ${env} 에 올릴까요?`} sub={`「${g.tag}」 · ${items.map(x => x.branch).join(', ')}`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        {prepped.length
          ? <p>충돌을 푼 머지 브랜치 <span className="font-mono">{prepped.join(', ')}</span> 를 <span className="font-mono">{env}</span> 로 그대로 올립니다(앞당기기, 강제 push 아님).</p>
          : <p>브랜치를 <span className="font-mono">{env}</span> 에 머지 커밋으로 합쳐 올립니다(작업 트리 없이, 강제 push 아님). 이미 들어갔으면 건너뜁니다.</p>}
        {prod && <div className="space-y-2">
          <p className="rounded-lg border border-rose-400 bg-rose-500/10 px-3 py-2 font-semibold text-rose-800 dark:text-rose-300">운영입니다 — 올리는 즉시 운영 배포 파이프라인이 돕니다. DDL · 환경변수 같은 배포 전 일은 먼저.</p>
          {cerr ? <p className="text-rose-700 dark:text-rose-300">확인하지 못했다 — {cerr}</p> : !chk ? <Empty>확인하는 중… origin 을 받고 레포마다 나갈 커밋 · 바뀌는 파일 범위 · 충돌 표시 · 푼 파일에서 빠진 줄을 본다</Empty> : chk.repos.map(r => (
            <div key={r.id} className="space-y-1 rounded-lg border px-3 py-2">
              <p className="font-semibold">{r.name}{r.skip && <span className="ml-2 font-normal text-muted-foreground">{r.skip}</span>}</p>
              {r.strict && <>
                <p className="text-xs text-muted-foreground">바뀌는 파일 {r.strict.files}개{r.strict.conflicts.length ? ` · 충돌 ${r.strict.conflicts.length}곳(${r.strict.conflicts.join(', ')})을 머지 브랜치에서 푼 커밋` : ' · 충돌 없음'}</p>
                <details><summary className="cursor-pointer text-xs text-primary">운영으로 나갈 커밋 {r.strict.commits.length}개</summary>
                  <ul className="mt-1 space-y-0.5 font-mono text-[0.6875rem]">{r.strict.commits.map(c => <li key={c} className="truncate" title={c}>{c}</li>)}</ul></details>
              </>}
            </div>
          ))}
          {hard.length > 0 && <div className="space-y-1 rounded-lg border border-rose-400 bg-rose-500/10 px-3 py-2.5">
            <p className="font-semibold text-rose-800 dark:text-rose-300">막힘 — 아래를 고친 뒤 다시</p>
            <ul className="list-disc space-y-0.5 pl-5">{hard.map((h, k) => <li key={k} className="break-words">{h}</li>)}</ul>
          </div>}
          {lost.length > 0 && <div className="space-y-1.5 rounded-lg border border-amber-400 bg-amber-500/10 px-3 py-2.5">
            <p className="font-semibold text-amber-800 dark:text-amber-300">충돌을 푼 파일에서 빠진 줄 {lost.length}개 — 일부러 뺀 건지 확인</p>
            <ul className="space-y-0.5 font-mono text-xs">{lost.map((l, k) => <li key={k} className="break-all"><span className="text-muted-foreground">{l.repo} · {l.file} · {l.side} 쪽</span> {l.line}</li>)}</ul>
            <label className="flex items-center gap-2 pt-1 font-semibold"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} className="accent-[var(--primary)]" />빠진 줄을 확인했다 — 이대로 운영에 올린다</label>
          </div>}
        </div>}
        {unpicked.length > 0 && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400 bg-amber-500/10 px-3 py-2.5">
          <p className="min-w-0 flex-1 basis-60"><span className="font-semibold text-amber-800 dark:text-amber-300">배포 조치를 아직 안 뽑았다</span> — DB · 환경변수 같은 할 일이 있는지 모른다.</p>
          <Button size="sm" variant="outline" className="h-8 text-primary" onClick={() => void pullPrep(unpicked.map(x => x.id), () => qc.invalidateQueries({ queryKey: ['deploy'] })).then(onClose)}>배포 조치 뽑기</Button>
        </div>}
        {!prod && before.length > 0 && <div className="space-y-1.5 rounded-lg border border-amber-400 bg-amber-500/10 px-3 py-2.5">
          <p className="font-semibold text-amber-800 dark:text-amber-300">{env} 배포 전 할 일 {before.length}개가 아직 체크 안 됐다</p>
          <ul className="list-disc space-y-0.5 pl-5">{before.map((t, k) => <li key={k} className="break-words">{plain(t.text)}</li>)}</ul>
          <p className="text-xs text-muted-foreground">먼저 하고 패널에서 체크하거나, 이미 했으면 그대로 올린다.</p>
        </div>}
        <p className="text-muted-foreground">올리기 직전에 origin 을 다시 받고 봅니다 — 앞 환경에 다 들어갔나 · 충돌 · 커밋 안 한 변경 · origin 에만 있는 커밋. 걸리면 올리지 않습니다. 팀이 같이 쓰는 브랜치라 되돌리려면 따로 되돌림 커밋이 필요합니다.</p>
        <div className="flex justify-end gap-2 pt-1"><Button variant="outline" onClick={onClose}>취소</Button><Button variant={prod ? 'destructive' : 'default'} disabled={busy || !ready} onClick={() => void go()}>{busy ? '올리는 중…' : prod ? `운영(${env})에 올리기` : `${before.length || unpicked.length ? '그래도 ' : ''}${env} 에 올리기`}</Button></div>
      </div>
    </Sheet>
  );
}

// 런 단추 확인 창 — 무엇을 돌리는지(단추 설명 · 명령) 보여 주고 사람이 누를 때만. 돌리는 것은 런 화면 단추와 같다(POST /api/runs/<번호>/action)
function ActionDialog({ pick, onClose, onStarted }: { pick: Pick; onClose: () => void; onStarted: () => void }) {
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), { run, action: a, repo } = pick;
  if (a.copy) return <CopyDialog pick={pick} onClose={onClose} />;
  const go = async () => {
    setBusy(true);
    try {
      await post(`/api/runs/${run.id}/action`, { n: a.n, ...(repo ? { repo } : {}), ...(a.ask ? { text } : {}) });
      toast(`「${a.label}」 을 돌리는 중 — 끝나면 알린다`, 3000);
      onStarted();
      onClose();
    } catch (e) { toast(`돌리지 못했다 — ${(e as Error).message}`, 6000); setBusy(false); }
  };
  return (
    <Sheet title={`「${a.label}」 을 돌릴까요?`} sub={`런 #${run.id} · ${run.title}`} onClose={onClose}>
      <div className="space-y-4">
        {a.flow && <p className="font-mono text-xs leading-5 font-semibold whitespace-pre-line text-primary">{a.flow}</p>}
        {a.hint && <p className="text-sm whitespace-pre-line">{a.hint}</p>}
        {repo && <p className="text-sm font-semibold">이 줄 레포만 — <span className="font-mono text-xs break-all">{repo}</span></p>}
        <div className="space-y-1.5"><p className="text-xs font-semibold text-muted-foreground">돌릴 명령</p>
          <pre className="overflow-x-auto rounded-lg bg-[var(--code)] px-3 py-2.5 font-mono text-xs text-[var(--code-foreground)]">{a.command}</pre></div>
        {a.ask && <label className="block space-y-1.5 text-sm"><span className="text-xs font-semibold text-muted-foreground">{a.ask}</span><input value={text} onChange={e => setText(e.target.value)} className="h-9 w-full rounded-md border bg-card px-2.5 outline-none focus:ring-2 focus:ring-ring/40" /></label>}
        {a.danger && <p className="text-sm font-medium text-rose-700 dark:text-rose-300">되돌릴 수 없는 단추다.</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button variant={a.danger ? 'destructive' : 'default'} disabled={busy || (!!a.ask && !text.trim())} onClick={() => void go()}>{busy ? '보내는 중…' : a.label}</Button>
        </div>
      </div>
    </Sheet>
  );
}

// 복사 단추 창 — 엔진 명령이 만든 글(사람이 직접 돌릴 명령 — 운영 배포)을 받아 보여 주고 복사만. EDITH 는 그 글을 돌리지 않는다
function CopyDialog({ pick, onClose }: { pick: Pick; onClose: () => void }) {
  const { run, action: a } = pick, [busy, setBusy] = useState(false), [res, setRes] = useState<{ output: string; code: number } | null>(null), [copied, setCopied] = useState(false);
  const make = async () => {
    setBusy(true);
    try { const r = await post<{ output?: string; code?: number }>(`/api/runs/${run.id}/action`, { n: a.n }); setRes({ output: r.output ?? '', code: r.code ?? 1 }); }
    catch (e) { toast(`만들지 못했다 — ${(e as Error).message}`, 6000); }
    setBusy(false);
  };
  return (
    <Sheet title={`「${a.label}」`} sub={`런 #${run.id} · ${run.title}`} onClose={onClose}>
      <div className="space-y-4">
        {a.flow && <p className="font-mono text-xs leading-5 font-semibold whitespace-pre-line text-primary">{a.flow}</p>}
        {a.hint && <p className="text-sm whitespace-pre-line">{a.hint}</p>}
        <p className="text-sm text-muted-foreground">EDITH 는 이 명령을 돌리지 않습니다 — 복사해서 직접 돌립니다.</p>
        {res && <div className="space-y-1.5">
          <p className={`text-xs font-semibold ${res.code === 0 ? 'text-muted-foreground' : 'text-rose-700 dark:text-rose-300'}`}>{res.code === 0 ? '복사할 명령' : `만드는 명령이 끝 코드 ${res.code} — 아래는 그 출력`}</p>
          <pre className="max-h-[45vh] overflow-auto rounded-lg bg-[var(--code)] px-3 py-2.5 font-mono text-xs whitespace-pre text-[var(--code-foreground)]">{res.output || '(출력 없음)'}</pre>
        </div>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>닫기</Button>
          {res?.code === 0 ? <Button onClick={() => void copyText(res.output).then(() => setCopied(true))}>{copied ? '복사됨' : '복사'}</Button>
            : <Button disabled={busy} onClick={() => void make()}>{busy ? '만드는 중…' : res ? '다시 만들기' : '명령 만들기'}</Button>}
        </div>
      </div>
    </Sheet>
  );
}

// 창(브라우저 dialog — Esc · 바깥 누르기로 닫힌다). side 면 오른쪽 패널
function Sheet({ title, sub, onClose, children, side, wide }: { title: string; sub?: string; onClose: () => void; children: ReactNode; side?: boolean; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; d?.showModal(); return () => d?.close(); }, []);
  return (
    <dialog ref={ref} onClose={onClose} onClick={e => { if (e.target === ref.current) onClose(); }} aria-label={title}
      className={side ? 'm-0 ml-auto h-dvh max-h-none w-[min(28rem,100vw)] max-w-none border-l bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/20'
        : `m-auto ${wide ? 'w-[min(72rem,96vw)]' : 'w-[min(34rem,94vw)]'} max-w-none rounded-xl border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/30`}>
      <div className="flex items-start gap-3 border-b px-5 py-4">
        <span className="min-w-0 flex-1">{sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}<span className="block truncate font-semibold">{title}</span></span>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onClose}>닫기</Button>
      </div>
      <div className={side ? 'overflow-auto px-5 py-4' : `${wide ? 'max-h-[80vh]' : 'max-h-[70vh]'} overflow-auto px-5 py-4`}>{children}</div>
    </dialog>
  );
}

// 레포 줄 「변경」 — 이 브랜치가 운영에 더할 코드(서버 deployDiff). herdr 워크트리가 다른 브랜치를 꺼내 둬도 커밋으로 보니 그대로 보인다
type BranchDiff = { name: string; branch: string; base: string; from: string; commits: string[]; dirty: number; text: string };
function DiffSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['deploy-diff', id], queryFn: () => get<BranchDiff>(`/api/deploy/diff?id=${encodeURIComponent(id)}`) }), d = q.data;
  return (
    <Sheet wide title={d ? `변경 — ${d.name} · ${d.branch}` : '변경'} onClose={onClose}
      sub={d ? `${d.base} 와 갈라진 곳(${d.from})부터 브랜치 끝까지 · 커밋 ${d.commits.length}개${d.dirty ? ` · 커밋 안 한 변경 ${d.dirty}개는 빠짐` : ''}` : undefined}>
      {q.isLoading ? <Empty>읽는 중…</Empty> : q.error ? <Empty>{(q.error as Error).message}</Empty> : d && <>
        {d.commits.length > 0 && (
          <details className="mb-3 text-xs"><summary className="cursor-pointer font-semibold text-muted-foreground">커밋 {d.commits.length}</summary>
            <ul className="mt-1.5 space-y-0.5 font-mono">{d.commits.map(c => <li key={c} className="truncate" title={c}>{c}</li>)}</ul></details>
        )}
        <DiffView text={d.text} scope={`deploy-${id}`} empty="운영에 더할 변경이 없다 — 이미 다 들어갔다" />
      </>}
    </Sheet>
  );
}

// 항목 더하기 — 레포는 목록에 있는 것만(서버도 그것만 받는다)
function AddSheet({ v, onClose, send }: { v: Board; onClose: () => void; send: Send }) {
  const repos = [...new Set(v.items.map(x => x.repo))].sort((a, b) => repoName(a).localeCompare(repoName(b)));
  const [repo, setRepo] = useState(repos[0] ?? ''), [branch, setBranch] = useState(''), [t, setT] = useState(''), [n, setN] = useState(''), [busy, setBusy] = useState(false);
  const field = 'h-9 w-full rounded-md border bg-card px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40';
  return (
    <Sheet title="배포 항목 더하기" onClose={onClose}>
      <form className="space-y-3" onSubmit={async e => { e.preventDefault(); setBusy(true); if (await send('add', { repo, branch: branch.trim(), tag: t, note: n }, `${repoName(repo)} ${branch.trim()} 를 더했다`)) onClose(); else setBusy(false); }}>
        <label className="block space-y-1 text-xs font-semibold text-muted-foreground">레포<select value={repo} onChange={e => setRepo(e.target.value)} className={field}>{repos.map(r => <option key={r} value={r}>{repoName(r)}</option>)}</select></label>
        <label className="block space-y-1 text-xs font-semibold text-muted-foreground">브랜치<input required value={branch} onChange={e => setBranch(e.target.value)} placeholder="feature/…" className={`${field} font-mono`} /></label>
        <label className="block space-y-1 text-xs font-semibold text-muted-foreground">안건 이름(같은 이름끼리 묶인다)<input value={t} onChange={e => setT(e.target.value)} className={field} /></label>
        <label className="block space-y-1 text-xs font-semibold text-muted-foreground">메모(한 줄에 하나)<textarea value={n} onChange={e => setN(e.target.value)} rows={3} className={`${field} h-auto py-1.5`} /></label>
        <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="outline" onClick={onClose}>취소</Button><Button type="submit" disabled={busy || !branch.trim()}>{busy ? '더하는 중…' : '더하기'}</Button></div>
      </form>
    </Sheet>
  );
}
