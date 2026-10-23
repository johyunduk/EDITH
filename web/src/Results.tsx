// 결과 — 끝난 런의 코드가 어느 브랜치까지 갔나(서버 src/reach.ts). 행은 런(레포가 여럿이면 레포마다 줄), 열은 엔진이 edith-repos.json 에 정한 브랜치(also → base 차례).
// 칸은 「언제 · 어떻게」 — 커밋 그대로(머지 · fast-forward) · 내용 일치(해시는 달라도 변경이 다 있다) · 일부(k/n — 빠진 파일) · 제목만 같음(확인 필요).
// 다음에 올릴 칸만 점선으로. 원격은 마지막 fetch 기준이고 「새로 받기」 로 받는다. 배포 할 일(edith-results.json)은 누르면 오른쪽 패널. 주소는 #/results.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from './api.ts';
import { Button } from '@/components/ui/button';
import { Empty, Icon } from './ui.tsx';
import { toast } from './copy.ts';

type Reach = { ref: string; state: 'in' | 'content' | 'partial' | 'subject' | 'none' | 'missing'; at?: number; how?: 'merge' | 'ff'; k?: number; n?: number; missing?: string[]; subject?: string };
type Repo = { name: string; path: string; branch?: string; error?: string; dirty?: number; pushed?: boolean | null; fresh?: boolean; envs: Reach[] };
type Run = { id: number; name: string; title: string; tag?: string; ended: number; repos: Repo[]; tasks: { done: number; total: number } | null; fetched?: number };
type Res = { tag: string; title: string; note?: string; items: { text: string; done: boolean; group?: string }[]; run: { id: number } };

const CHECK = <><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>;
const HALF = <><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" /></>;
const HELP = <><circle cx="12" cy="12" r="9" /><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .9-1 1.5v.4" /><path d="M12 17h.01" /></>;
const ARROW = <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>;
const WARN = <><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></>;
const LIST = <><path d="m3 7 2 2 4-4" /><path d="M13 7h8" /><path d="m3 17 2 2 4-4" /><path d="M13 17h8" /></>;
const REFRESH = <><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 4v5h-5" /></>;

const label = (ref: string) => ref.replace(/^origin\//, '');
const p2 = (n: number) => String(n).padStart(2, '0');
const at = (t?: number) => { if (!t) return ''; const d = new Date(t); return `${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60_000); return m < 60 ? `${Math.max(m, 1)}분 전` : m < 24 * 60 ? `${Math.round(m / 60)}시간 전` : m < 48 * 60 ? '어제' : at(t).slice(0, 5); };
const reached = (r?: Reach) => r?.state === 'in' || r?.state === 'content';

// 열 — 레포마다의 브랜치 차례를 합친다(앞 차례를 지키며 처음 보는 것은 그다음 아는 것 앞에)
function columns(runs: Run[]) {
  const cols: string[] = [];
  for (const x of runs.flatMap(r => r.repos)) {
    const ls = x.envs.map(e => label(e.ref));
    ls.forEach((l, i) => {
      if (cols.includes(l)) return;
      const after = ls.slice(i + 1).find(n => cols.includes(n));
      cols.splice(after ? cols.indexOf(after) : cols.length, 0, l);
    });
  }
  return cols;
}
// 레포 하나의 판단 — 어디까지(마지막으로 들어간 칸), 다음 칸, 확인할 것, 아직 커밋 전인가(커밋 안 한 파일 · 커밋 없음).
// 안 올린 것만으로는 막지 않는다 — 이슈 브랜치처럼 다른 브랜치(안건)에 합쳐 올라가는 일이 있다(그건 왼쪽 줄에 알린다)
function judge(x: Repo) {
  const last = x.envs.reduce((n, e, i) => reached(e) ? i : n, -1), held = !!x.dirty || !!x.fresh;
  return { last, next: last + 1 < x.envs.length ? last + 1 : -1, check: x.envs.some(e => e.state === 'partial' || e.state === 'subject'), done: !!x.envs.length && last === x.envs.length - 1, held };
}
function flags(r: Run) {
  const js = r.repos.filter(x => !x.error).map(judge), check = js.some(j => j.check), done = !!js.length && js.every(j => j.done);
  return { check, done, clean: done && (!r.tasks || r.tasks.done === r.tasks.total), next: !done && !check && js.some(j => !j.held && j.next >= 0) };
}
// 제목이 주소뿐이면(요청 · 요약에 제목이 없는 런) 짧게 — 「노션 · 4025b1b0…」
const short = (t: string) => { try { const u = new URL(t); return `${u.hostname.replace(/^(www|app)\./, '').split('.')[0]} · ${(u.pathname.split('/').pop() ?? '').slice(-32, -24) || u.pathname}…`; } catch { return t; } };

type Filter = 'all' | 'next' | 'check' | 'clean';
export function ResultsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['reach'], queryFn: () => get<Run[]>('/api/reach'), refetchInterval: 30_000 });
  const [filter, setFilter] = useState<Filter>('all'), [find, setFind] = useState('');
  const [panel, setPanel] = useState<number | null>(null), [files, setFiles] = useState<{ title: string; list: string[] } | null>(null);
  const [fetching, setFetching] = useState(false);
  const runs = useMemo(() => q.data ?? [], [q.data]), cols = useMemo(() => columns(runs), [runs]);
  const count = (f: Filter) => runs.filter(r => f === 'all' || flags(r)[f]).length;
  const needle = find.trim().toLowerCase();
  const shown = runs.filter(r => (filter === 'all' || flags(r)[filter])
    && (!needle || [r.title, r.tag ?? '', `#${r.id}`, ...r.repos.flatMap(x => [x.name, x.branch ?? ''])].some(s => s.toLowerCase().includes(needle))));
  const fetched = runs.map(r => r.fetched).filter((t): t is number => !!t);
  const refetch = async () => {
    setFetching(true);
    try {
      const r = await post<{ repos: number; errors: string[] }>('/api/reach/fetch', {});
      toast(r.errors.length ? `${r.repos}개 레포 중 ${r.errors.length}개를 못 받았다 — ${r.errors[0]}` : `${r.repos}개 레포를 새로 받았다`, r.errors.length ? 6000 : 2500);
    } catch (e) { toast(`받지 못했다 — ${(e as Error).message}`, 5000); }
    await qc.invalidateQueries({ queryKey: ['reach'] });
    setFetching(false);
  };
  const seg = (f: Filter, name: string) => (
    <button type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
      className={`h-7 rounded-md px-3 text-sm ${filter === f ? 'bg-card font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
      {name} <span className="text-muted-foreground tabular-nums">{count(f)}</span>
    </button>
  );
  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold tracking-tight">결과</h1>
            <p className="text-sm text-muted-foreground">끝난 런의 코드가 어느 브랜치까지 나갔나 — 해시가 달라도 내용으로 본다.</p>
          </div>
          {fetched.length > 0 && <span className="text-xs text-muted-foreground">원격 {at(Math.min(...fetched))} 기준</span>}
          <Button variant="outline" size="sm" disabled={fetching} onClick={() => void refetch()}><Icon className="size-3.5">{REFRESH}</Icon>{fetching ? '받는 중…' : '새로 받기'}</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="보기" className="inline-flex gap-0.5 rounded-lg bg-muted p-0.5">
            {seg('all', '전체')}{seg('next', '올릴 차례')}{seg('check', '확인 필요')}{seg('clean', '정리 가능')}
          </div>
          <input type="search" value={find} onChange={e => setFind(e.target.value)} placeholder="런 · 티켓 · 브랜치" aria-label="찾기"
            className="h-8 w-full max-w-72 rounded-md border bg-card px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40" />
        </div>
        {!q.data ? <Empty>{q.error ? `읽지 못했다 — ${String(q.error)}` : '불러오는 중…'}</Empty>
          : !runs.length ? <Empty>아직 레포를 남기고 끝난 런이 없다(엔진이 작업 문서에 edith-repos.json 을 쓰면 여기에 나온다).</Empty>
          : (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full min-w-[60rem] border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/40 text-left text-xs text-muted-foreground">
                    <th scope="col" className="w-[34%] border-b px-4 py-2.5 font-medium">런</th>
                    {cols.map(c => <th key={c} scope="col" className="border-b px-3 py-2.5 font-medium">{c} <span className="font-normal opacity-70 tabular-nums">{runs.filter(r => r.repos.some(x => reached(x.envs.find(e => label(e.ref) === c)))).length}/{runs.length}</span></th>)}
                    <th scope="col" className="w-[9%] border-b px-4 py-2.5 font-medium">배포 할 일</th>
                  </tr>
                </thead>
                <tbody>
                  {!shown.length && <tr><td colSpan={cols.length + 2} className="px-4 py-6 text-center text-muted-foreground">맞는 런이 없다</td></tr>}
                  {shown.map(r => <RunRows key={r.id} r={r} cols={cols} onTasks={() => setPanel(r.id)} onFiles={setFiles} />)}
                </tbody>
              </table>
            </div>
          )}
      </div>
      {panel !== null && <TaskPanel run={runs.find(r => r.id === panel)} onClose={() => setPanel(null)} />}
      {files && <Sheet title={files.title} onClose={() => setFiles(null)}><ul className="space-y-1 font-mono text-xs">{files.list.map(f => <li key={f}>{f}</li>)}</ul></Sheet>}
    </main>
  );
}

function RunRows({ r, cols, onTasks, onFiles }: { r: Run; cols: string[]; onTasks: () => void; onFiles: (x: { title: string; list: string[] }) => void }) {
  const f = flags(r), one = r.repos.length === 1;
  const head = (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <a href={`#/runs/${r.id}`} title={r.title} className="font-semibold hover:underline">{short(r.title)}</a>
        {r.tag && <span className="rounded bg-muted px-1.5 font-mono text-[0.6875rem] text-muted-foreground">{r.tag}</span>}
        {f.clean && <span className="rounded bg-emerald-500/10 px-1.5 text-[0.6875rem] font-medium text-emerald-700 dark:text-emerald-400">정리 가능</span>}
      </div>
      <div className="text-xs text-muted-foreground">런 #{r.id} · {r.name} · {one ? '' : `레포 ${r.repos.length} · `}{ago(r.ended)} 끝</div>
    </div>
  );
  const tasks = (
    <td rowSpan={one ? 1 : r.repos.length + 1} className="border-b px-4 py-3 align-top">
      {r.tasks ? (
        <button type="button" onClick={onTasks} aria-haspopup="dialog"
          className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold tabular-nums ${r.tasks.done === r.tasks.total ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-card hover:bg-muted'}`}>
          <Icon className="size-3.5">{LIST}</Icon>{r.tasks.done}/{r.tasks.total}
        </button>
      ) : <span className="text-xs text-muted-foreground">—</span>}
    </td>
  );
  if (one) return <tr className="align-top">
    <td className="border-b px-4 py-3">{head}<RepoLine x={r.repos[0]} inline /></td>
    <EnvCells x={r.repos[0]} cols={cols} last onFiles={onFiles} />{tasks}
  </tr>;
  return (
    <>
      <tr className="align-top"><td className="px-4 pt-3 pb-1">{head}</td><td colSpan={cols.length} />{tasks}</tr>
      {r.repos.map((x, i) => (
        <tr key={x.path} className="align-top">
          <td className={`py-1 pr-4 pl-7 ${i === r.repos.length - 1 ? 'border-b pb-3' : ''}`}><RepoLine x={x} /></td>
          <EnvCells x={x} cols={cols} last={i === r.repos.length - 1} onFiles={onFiles} />
        </tr>
      ))}
    </>
  );
}

function RepoLine({ x, inline }: { x: Repo; inline?: boolean }) {
  return (
    <div className={inline ? 'mt-1' : ''}>
      <div className="flex flex-wrap items-baseline gap-x-2 text-xs"><span className={inline ? 'text-muted-foreground' : 'text-sm font-medium'}>{x.name}</span>{x.branch && <span className="font-mono text-muted-foreground">{x.branch}</span>}</div>
      {x.error ? <div className="text-xs text-rose-700 dark:text-rose-300">{x.error}</div>
        : (x.dirty || x.pushed !== true || x.fresh) && (
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-amber-800 dark:text-amber-300">
            <Icon className="size-3.5">{WARN}</Icon>{x.dirty ? `커밋 안 한 파일 ${x.dirty}` : x.fresh ? '커밋 없음' : x.pushed === null ? '아직 안 올림' : '안 올린 커밋 있음'}
          </div>
        )}
    </div>
  );
}

function EnvCells({ x, cols, last, onFiles }: { x: Repo; cols: string[]; last: boolean; onFiles: (x: { title: string; list: string[] }) => void }) {
  const j = judge(x);
  return <>{cols.map(c => {
    const i = x.envs.findIndex(e => label(e.ref) === c);
    return <td key={c} className={`px-3 py-2 ${last ? 'border-b' : ''}`}><Cell r={x.envs[i]} next={i >= 0 && i === j.next && !x.fresh} held={j.held && i === 0} name={`${x.name} · ${c}`} onFiles={onFiles} /></td>;
  })}</>;
}

const Two = ({ icon, tone, top, sub, box }: { icon: ReactNode; tone: string; top: ReactNode; sub?: ReactNode; box?: string }) => (
  <div className={`flex items-start gap-2 rounded-lg px-2 py-1.5 ${box ?? ''}`}>
    <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`}>{icon}</Icon>
    <span className="min-w-0"><span className="block font-medium">{top}</span>{sub && <span className="block text-xs text-muted-foreground">{sub}</span>}</span>
  </div>
);
function Cell({ r, next, held, name, onFiles }: { r?: Reach; next: boolean; held: boolean; name: string; onFiles: (x: { title: string; list: string[] }) => void }) {
  if (!r) return <span className="px-2 text-muted-foreground/60" title="이 런은 이 브랜치를 보지 않는다">—</span>;
  if (r.state === 'in') return <Two icon={CHECK} tone="text-emerald-600" top="들어감" sub={`${at(r.at)} · ${r.how === 'ff' ? 'fast-forward' : '머지'}`} />;
  if (r.state === 'content') return <span title="커밋 해시는 없지만 이 런의 변경이 다 들어 있다(스쿼시 · 체리픽 · 다시 만든 머지)"><Two icon={CHECK} tone="text-emerald-600" top="내용 일치" sub={`${at(r.at)} · 해시 다름`} /></span>;
  if (r.state === 'partial') return <Two icon={HALF} tone="text-amber-600" box="bg-amber-500/10" top={<span className="text-amber-800 dark:text-amber-300">{r.n}개 중 {r.k}개</span>}
    sub={<button type="button" className="text-amber-800 underline-offset-2 hover:underline dark:text-amber-300" onClick={() => onFiles({ title: `빠진 파일 — ${name}`, list: r.missing ?? [] })}>빠진 파일 {r.missing?.length ?? 0}개</button>} />;
  if (r.state === 'subject') return <span title={`같은 제목 커밋 「${r.subject}」 이 있는데, 이 런의 변경이 그대로는 맞지 않는다 — 들어간 뒤 고쳐졌을 수 있다`}><Two icon={HELP} tone="text-blue-600" box="bg-blue-500/10" top={<span className="text-blue-800 dark:text-blue-300">확인 필요</span>} sub={`제목만 같음 · ${at(r.at)}`} /></span>;
  if (r.state === 'missing') return <span className="px-2 text-muted-foreground/60" title={`${r.ref} 를 찾지 못했다(fetch 전이거나 없는 브랜치)`}>—</span>;
  if (held) return <div className="rounded-lg border border-dashed px-2 py-1.5 text-xs text-muted-foreground">먼저 커밋</div>;
  if (next) return <div className="flex items-center gap-1.5 rounded-lg border border-dashed border-primary/50 bg-primary/5 px-2 py-1.5 font-medium text-primary"><Icon className="size-4">{ARROW}</Icon>올릴 차례</div>;
  return <span className="px-2 text-muted-foreground/60">—</span>;
}

// 오른쪽 패널(브라우저 dialog — Esc · 바깥 누르기로 닫힌다)
function Sheet({ title, sub, onClose, children, side }: { title: string; sub?: string; onClose: () => void; children: ReactNode; side?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; d?.showModal(); return () => d?.close(); }, []);
  return (
    <dialog ref={ref} onClose={onClose} onClick={e => { if (e.target === ref.current) onClose(); }} aria-label={title}
      className={side ? 'm-0 ml-auto h-dvh max-h-none w-[min(28rem,100vw)] max-w-none border-l bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/20'
        : 'm-auto w-[min(32rem,94vw)] max-w-none rounded-xl border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/30'}>
      <div className="flex items-start gap-3 border-b px-5 py-4">
        <span className="min-w-0 flex-1">{sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}<span className="block truncate font-semibold">{title}</span></span>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onClose}>닫기</Button>
      </div>
      <div className={side ? 'overflow-auto px-5 py-4' : 'max-h-[70vh] overflow-auto px-5 py-4'}>{children}</div>
    </dialog>
  );
}

// 배포 할 일 — 그 런이 edith-results.json 에 남긴 할 일. 체크는 그 파일에 바로(서버가 새로 읽어 화면이 본 상태와 같을 때만 — src/results.ts)
function TaskPanel({ run, onClose }: { run?: Run; onClose: () => void }) {
  const qc = useQueryClient(), q = useQuery({ queryKey: ['results'], queryFn: () => get<Res[]>('/api/results') });
  const [busy, setBusy] = useState(false);
  const mine = (q.data ?? []).filter(x => x.run.id === run?.id), items = mine.flatMap(x => x.items), done = items.filter(i => i.done).length;
  const check = async (x: Res, text: string, was: boolean, group?: string) => {
    setBusy(true);
    try { await post('/api/results/check', { run: x.run.id, title: x.title, text, was, group: group ?? '' }); }
    catch (e) { toast(`바꾸지 못했다 — ${(e as Error).message}`, 5000); }
    await Promise.all([qc.invalidateQueries({ queryKey: ['results'] }), qc.invalidateQueries({ queryKey: ['reach'] })]);
    setBusy(false);
  };
  return (
    <Sheet side title="배포 할 일" sub={run ? `런 #${run.id} · ${run.title}` : undefined} onClose={onClose}>
      {!q.data ? <Empty>불러오는 중…</Empty> : !items.length ? <Empty>이 런이 남긴 할 일이 없다.</Empty> : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="text-sm"><b className="tabular-nums">{done}/{items.length}</b> <span className="text-muted-foreground">끝남</span></div>
            <div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-foreground" style={{ width: `${done / items.length * 100}%` }} /></div>
          </div>
          {mine.map(x => (
            <div key={x.title} className="space-y-2">
              {mine.length > 1 && <p className="text-sm font-medium">{x.title}</p>}
              {x.note && <p className="text-xs whitespace-pre-wrap text-muted-foreground">{x.note}</p>}
              {[...new Set(x.items.map(i => i.group ?? ''))].map(g => (
                <Fragment key={g}>
                  {g && <p className="pt-1 text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase">{g}</p>}
                  <ul className="space-y-0.5">
                    {x.items.filter(i => (i.group ?? '') === g).map(i => (
                      <li key={i.text}>
                        <label className="-mx-2 flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/60">
                          <input type="checkbox" className="mt-1 accent-[var(--foreground)]" checked={i.done} disabled={busy} onChange={() => void check(x, i.text, i.done, i.group)} />
                          <span className={`text-sm ${i.done ? 'text-muted-foreground line-through' : ''}`}>{i.text}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </Fragment>
              ))}
            </div>
          ))}
          {run && <a href={`#/runs/${run.id}`} className="inline-block text-sm font-medium text-primary hover:underline">런 열기</a>}
        </div>
      )}
    </Sheet>
  );
}
