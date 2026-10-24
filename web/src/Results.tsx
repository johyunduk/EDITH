// 결과 — 끝난 런의 코드가 커밋에서 마지막 브랜치까지 어디 있나(서버 src/reach.ts). 런마다 꺾쇠 패널, 레포마다 단계 선:
// 커밋 → 올림(via 가 있으면 그 브랜치에 합침 — 예: 이슈 → 안건) → 엔진이 edith-repos.json 에 정한 브랜치(also → base 차례).
// 노드는 끝남(커밋 그대로 · 내용 일치) · 일부(k/n — 빠진 파일) · 확인 필요(제목만 같음) · 지금 차례(빛나는 고리) · 아직.
// 처음 안 끝난 칸(아직 · 일부 · 확인 필요)에는 엔진 런 단추 중 그 단계(reach)가 적힌 것을 놓고, 누르면 확인 창을 거쳐 돌린다(런 화면 단추와 같은 명령 · 같은 기록).
// copy 단추는 돌리지 않고 엔진이 만든 명령 글을 받아 복사하게만 한다(사람이 직접 돌릴 일 — 예: 운영 배포).
// 다 나간 런은 아래 「COMPLETE」 로 접는다. 원격은 마지막 fetch 기준이고 「새로 받기」 로 받는다. 배포 할 일(edith-results.json)은 오른쪽 패널. 주소는 #/results.
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from './api.ts';
import { Button } from '@/components/ui/button';
import { Empty } from './ui.tsx';
import { copyText, toast } from './copy.ts';

type Reach = { ref: string; state: 'in' | 'content' | 'partial' | 'subject' | 'none' | 'missing'; at?: number; how?: 'merge' | 'ff'; k?: number; n?: number; missing?: string[]; subject?: string };
type Repo = { name: string; path: string; branch?: string; error?: string; dirty?: number; pushed?: boolean | null; fresh?: boolean; headAt?: number; via?: Reach; envs: Reach[] };
type Action = { n: number; label: string; reach: string; command: string; hint?: string; ask?: string; danger?: boolean; copy?: boolean };
type Run = { id: number; name: string; title: string; tag?: string; ended: number; repos: Repo[]; tasks: { done: number; total: number } | null; fetched?: number; actions: Action[] };
type Res = { tag: string; title: string; note?: string; items: { text: string; done: boolean; group?: string }[]; run: { id: number } };

const label = (ref: string) => ref.replace(/^origin\//, '');
const p2 = (n: number) => String(n).padStart(2, '0');
const at = (t?: number) => { if (!t) return ''; const d = new Date(t); return `${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60_000); return m < 60 ? `${Math.max(m, 1)}분 전` : m < 24 * 60 ? `${Math.round(m / 60)}시간 전` : m < 48 * 60 ? '어제' : at(t).slice(0, 5); };
const reached = (r?: Reach) => r?.state === 'in' || r?.state === 'content';
// 제목이 주소뿐이면(요청 · 요약에 제목이 없는 런) 짧게 — 「notion · 4025b1b0…」
const short = (t: string) => { try { const u = new URL(t); return `${u.hostname.replace(/^(www|app)\./, '').split('.')[0]} · ${(u.pathname.split('/').pop() ?? '').slice(-32, -24) || u.pathname}…`; } catch { return t; } };
const mix = (pct: number) => `color-mix(in oklab, var(--primary) ${pct}%, transparent)`;

// ── 단계 — 레포 하나의 커밋 → 올림(또는 합침) → 브랜치들. 처음 안 끝난 칸이 「아직」 이면 그게 지금 차례 ──
type State = 'done' | 'partial' | 'check' | 'next' | 'todo';
type Step = { key: string; name: string; state: State; reach?: Reach; note?: string; base?: boolean; act?: boolean };   // base — 레포의 기본 브랜치 칸, act — 단추를 놓는 칸(처음 안 끝난 칸)
// reach "base" 는 레포마다 이름이 다른 기본 브랜치 칸(origin/master · origin/main)
const fits = (a: Action, s: Step) => a.reach === s.key || (a.reach === 'base' && !!s.base);
const envState = (e: Reach): State => reached(e) ? 'done' : e.state === 'partial' ? 'partial' : e.state === 'subject' ? 'check' : 'todo';
function steps(x: Repo): Step[] {
  const envs = x.envs.filter(e => e.state !== 'missing'), out = envs.some(reached);   // 없는 브랜치(그 레포에 stage 가 없는 등)는 칸을 만들지 않는다
  const all: Step[] = [
    { key: 'commit', name: 'commit', state: x.dirty || x.fresh ? 'todo' : 'done', note: x.dirty ? `커밋 안 한 파일 ${x.dirty}` : x.fresh ? '바꾼 것 없음' : at(x.headAt) },
    x.via ? { key: 'via', name: 'merge', state: out ? 'done' : envState(x.via), reach: x.via, note: `${x.via.ref} 에 합침` }
      : { key: 'push', name: 'push', state: x.pushed === true || out ? 'done' : 'todo', note: x.pushed === true ? 'origin 과 같음' : out ? '다른 브랜치로 나감' : x.pushed === null ? '아직 안 올림' : '안 올린 커밋 있음' },
    ...envs.map(e => ({ key: e.ref, name: label(e.ref), state: envState(e), reach: e, base: e === x.envs.at(-1) })),
  ];
  // 일부 · 확인 필요 칸에도 단추를 놓는다 — 이슈를 합쳐 다시 올릴 때 그 칸이 「일부」 로 다시 열린다
  const i = all.findIndex(s => s.state !== 'done');
  if (i >= 0 && !(i === 0 && x.fresh && !x.dirty)) { all[i].act = true; if (all[i].state === 'todo') all[i].state = 'next'; }
  return all;
}
const done = (r: Run) => r.repos.length > 0 && r.repos.every(x => !x.error && steps(x).every(s => s.state === 'done'));
const flags = (r: Run) => {
  const ss = r.repos.filter(x => !x.error).flatMap(steps);
  return { next: ss.some(s => s.state === 'next'), check: ss.some(s => s.state === 'partial' || s.state === 'check'), clean: done(r) && (!r.tasks || r.tasks.done === r.tasks.total) };
};

type Filter = 'all' | 'next' | 'check' | 'clean';
type Pick = { run: Run; action: Action };
export function ResultsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['reach'], queryFn: () => get<Run[]>('/api/reach'), refetchInterval: 30_000 });
  const [filter, setFilter] = useState<Filter>('all'), [find, setFind] = useState('');
  const [panel, setPanel] = useState<number | null>(null), [files, setFiles] = useState<{ title: string; list: string[] } | null>(null), [pick, setPick] = useState<Pick | null>(null);
  const [fetching, setFetching] = useState(false);
  const runs = useMemo(() => q.data ?? [], [q.data]);
  const live = runs.filter(r => !done(r)), complete = runs.filter(done);
  const count = (f: Filter) => f === 'all' ? live.length : runs.filter(r => flags(r)[f]).length;
  const needle = find.trim().toLowerCase();
  const pool = filter === 'all' ? live : runs.filter(r => flags(r)[filter]);
  const shown = pool.filter(r => !needle || [r.title, r.tag ?? '', `#${r.id}`, ...r.repos.flatMap(x => [x.name, x.branch ?? ''])].some(s => s.toLowerCase().includes(needle)));
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
  const pill = (f: Filter, name: string) => (
    <button type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
      className={`h-9 rounded-full border px-3.5 text-sm ${filter === f ? 'border-primary bg-primary font-semibold text-primary-foreground' : 'bg-card hover:border-primary/50'}`}>
      {name} <span className="tabular-nums opacity-80">{count(f)}</span>
    </button>
  );
  // 격자 바탕 — 테마 색(primary)을 옅게, 32px 칸
  const grid: CSSProperties = { backgroundImage: `linear-gradient(${mix(6)} 1px, transparent 1px), linear-gradient(90deg, ${mix(6)} 1px, transparent 1px)`, backgroundSize: '32px 32px' };
  return (
    <main className="min-h-0 flex-1 overflow-y-auto" style={grid}>
      <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[0.6875rem] font-semibold tracking-[0.24em] text-primary uppercase">Run reach · {runs.length} runs</div>
            <h1 className="text-2xl font-bold">결과</h1>
            <p className="text-sm text-muted-foreground">끝난 런의 코드가 커밋에서 마지막 브랜치까지 어디 있나 — 빛나는 칸이 지금 할 일이다.</p>
          </div>
          {fetched.length > 0 && <span className="font-mono text-xs text-muted-foreground uppercase">origin · {ago(Math.min(...fetched))}</span>}
          <Button variant="outline" disabled={fetching} onClick={() => void refetch()} className="text-primary">{fetching ? '받는 중…' : '새로 받기'}</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="거르기" className="flex flex-wrap gap-2">{pill('all', '전체')}{pill('next', '할 차례')}{pill('check', '확인 필요')}{pill('clean', '정리 가능')}</div>
          <input type="search" value={find} onChange={e => setFind(e.target.value)} placeholder="런 · 티켓 · 브랜치" aria-label="찾기"
            className="ml-auto h-9 w-full max-w-64 rounded-full border bg-card px-3.5 text-sm outline-none focus:ring-2 focus:ring-ring/40" />
        </div>
        {!q.data ? <Empty>{q.error ? `읽지 못했다 — ${String(q.error)}` : '불러오는 중…'}</Empty>
          : !runs.length ? <Empty>아직 레포를 남기고 끝난 런이 없다(엔진이 작업 문서에 edith-repos.json 을 쓰면 여기에 나온다).</Empty>
          : <>
            {!shown.length && <Empty>맞는 런이 없다.</Empty>}
            {shown.map(r => <RunPanel key={r.id} r={r} onTasks={() => setPanel(r.id)} onFiles={setFiles} onAct={a => setPick({ run: r, action: a })} />)}
            {filter === 'all' && complete.length > 0 && (
              <Bracketed as="details">
                <summary className="cursor-pointer py-1 font-semibold"><span className="mr-2 font-mono text-[0.6875rem] tracking-[0.2em] text-primary uppercase">Complete</span>끝까지 다 나감 · {complete.length}</summary>
                <ul className="divide-y pt-2">
                  {complete.map(r => {
                    const clean = r.actions.find(a => a.reach === 'clean'), last = r.repos.flatMap(x => x.envs.filter(reached)).map(e => e.at ?? 0).sort((a, b) => b - a)[0];
                    return (
                      <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                        <span className="font-mono text-xs text-primary">#{r.id}</span>
                        <a href={`#/runs/${r.id}`} title={r.title} className="font-semibold hover:underline">{short(r.title)}</a>
                        <span className="text-xs text-muted-foreground">{last ? `마지막 ${at(last)}` : ''}{r.tasks ? ` · 할 일 ${r.tasks.done}/${r.tasks.total}` : ''}</span>
                        {clean && <Button size="sm" variant="outline" className="ml-auto text-primary" onClick={() => setPick({ run: r, action: clean })}>{clean.label}</Button>}
                      </li>
                    );
                  })}
                </ul>
              </Bracketed>
            )}
          </>}
      </div>
      {panel !== null && <TaskPanel run={runs.find(r => r.id === panel)} onClose={() => setPanel(null)} />}
      {files && <Sheet title={files.title} onClose={() => setFiles(null)}><ul className="space-y-1 font-mono text-xs">{files.list.map(f => <li key={f}>{f}</li>)}</ul></Sheet>}
      {pick && <ActionDialog pick={pick} onClose={() => setPick(null)} />}
    </main>
  );
}

// 꺾쇠 패널 — 네 모서리에 테마 색 꺾쇠(EDITH 화면 모서리와 같은 모양)
function Bracketed({ children, as = 'section', label: aria }: { children: ReactNode; as?: 'section' | 'details'; label?: string }) {
  const Tag = as;
  return (
    <Tag aria-label={aria} className="relative block border bg-card/90 px-5 py-4 backdrop-blur-[1px]">
      {['-top-px -left-px border-t-2 border-l-2', '-top-px -right-px border-t-2 border-r-2', '-bottom-px -left-px border-b-2 border-l-2', '-right-px -bottom-px border-r-2 border-b-2'].map(c =>
        <span key={c} aria-hidden="true" className={`pointer-events-none absolute size-3.5 border-primary ${c}`} />)}
      {children}
    </Tag>
  );
}

function RunPanel({ r, onTasks, onFiles, onAct }: { r: Run; onTasks: () => void; onFiles: (x: { title: string; list: string[] }) => void; onAct: (a: Action) => void }) {
  // 런 단추는 런 전체에 한 번 돈다(커밋하러 가기는 레포를 다 커밋) — 같은 단추는 그 단계가 지금 차례인 첫 레포에만 놓는다
  const used = new Set<number>(), allowed = r.repos.map(x => new Set(x.error ? [] : steps(x).flatMap(s =>
    s.act ? r.actions.filter(a => fits(a, s) && !used.has(a.n)).map(a => (used.add(a.n), a.n)) : [])));
  return (
    <Bracketed label={`런 #${r.id}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-xs text-primary">#{r.id}</span>
        <a href={`#/runs/${r.id}`} title={r.title} className="text-base font-bold hover:underline">{short(r.title)}</a>
        {r.tag && <span className="rounded border px-1.5 font-mono text-[0.6875rem] text-primary">{r.tag}</span>}
        <span className="ml-auto text-xs text-muted-foreground">{r.name} · {ago(r.ended)} 끝{r.tasks ? '' : ' · 배포 할 일 없음'}</span>
        {r.tasks && <Button size="sm" variant="outline" className="h-8 text-primary" aria-haspopup="dialog" onClick={onTasks}>배포 할 일 {r.tasks.done}/{r.tasks.total}</Button>}
      </div>
      <div className="mt-3 space-y-4">
        {r.repos.map((x, i) => (
          <Fragment key={x.path}>
            {i > 0 && <div className="h-px bg-border/70" />}
            <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
              <div className="w-56 min-w-0 shrink-0">
                <div className="truncate text-sm font-semibold">{x.name}</div>
                <div className="truncate font-mono text-[0.6875rem] text-muted-foreground">{x.branch}{x.via ? ` → ${x.via.ref}` : ''}</div>
              </div>
              {x.error ? <p className="text-sm text-rose-700 dark:text-rose-300">{x.error}</p> : <Track x={x} run={r} allowed={allowed[i]} onFiles={onFiles} onAct={onAct} />}
            </div>
          </Fragment>
        ))}
      </div>
    </Bracketed>
  );
}

// 단계 선 — 칸마다 노드 · 이름 · 한 줄, 지금 차례 칸에 단추. 칸 사이 선은 다음 칸 상태 색(끝남 실선 · 아니면 점선)
function Track({ x, run, allowed, onFiles, onAct }: { x: Repo; run: Run; allowed: Set<number>; onFiles: (x: { title: string; list: string[] }) => void; onAct: (a: Action) => void }) {
  const ss = steps(x), line = (s?: Step) => !s ? '' : s.state === 'done' ? 'border-primary border-solid' : s.state === 'partial' ? 'border-amber-500 border-solid' : s.state === 'check' ? 'border-blue-500 border-solid' : 'border-border border-dashed';
  return (
    <ol aria-label="단계" className="grid min-w-0 flex-[999_1_36rem]" style={{ gridTemplateColumns: `repeat(${ss.length}, minmax(0, 1fr))` }}>
      {ss.map((s, i) => {
        const acts = s.act ? run.actions.filter(a => fits(a, s) && allowed.has(a.n)) : [];
        return (
          <li key={s.key} className="flex flex-col items-center gap-1 px-1 text-center">
            <div className="relative flex h-7 w-full items-center justify-center">
              {i > 0 && <span className={`absolute top-1/2 right-1/2 left-0 border-t-2 ${line(s)}`} />}
              {i < ss.length - 1 && <span className={`absolute top-1/2 right-0 left-1/2 border-t-2 ${line(ss[i + 1])}`} />}
              <Node s={s} />
            </div>
            <span className={`font-mono text-[0.6875rem] tracking-[0.16em] uppercase ${s.state === 'next' ? 'font-bold text-primary' : s.state === 'partial' ? 'font-bold text-amber-700 dark:text-amber-400' : s.state === 'check' ? 'font-bold text-blue-700 dark:text-blue-400' : s.state === 'todo' ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}>{s.name}</span>
            <Note s={s} name={`${x.name} · ${s.name}`} onFiles={onFiles} />
            {acts.map(a => <Button key={a.n} size="sm" variant={a.copy ? 'outline' : 'default'} className="mt-1 h-8 font-bold shadow-md" style={a.copy ? undefined : { boxShadow: `0 4px 12px ${mix(30)}` }} title={a.hint} onClick={() => onAct(a)}>{a.label} ›</Button>)}
          </li>
        );
      })}
    </ol>
  );
}

const CHECK = <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4.5 4.5L19 7" /></svg>;
function Node({ s }: { s: Step }) {
  const say = { done: '끝남', partial: '일부', check: '확인 필요', next: '지금 차례', todo: '아직' }[s.state];
  const base = 'relative grid place-items-center rounded-full';
  if (s.state === 'done') return <span role="img" aria-label={`${s.name} ${say}`} className={`${base} size-5 bg-primary text-primary-foreground`}>{CHECK}</span>;
  if (s.state === 'partial') return <span role="img" aria-label={`${s.name} ${say}`} className={`${base} size-5 border-2 border-amber-500`} style={{ background: 'linear-gradient(90deg, rgb(245 158 11) 50%, var(--card) 50%)' }} />;
  if (s.state === 'check') return <span role="img" aria-label={`${s.name} ${say}`} className={`${base} size-5 border-2 border-blue-500 bg-card text-[0.6875rem] font-bold text-blue-600`}>?</span>;
  if (s.state === 'next') return <span role="img" aria-label={`${s.name} ${say}`} className={`${base} size-5 border-2 border-primary bg-card`} style={{ boxShadow: `0 0 0 5px ${mix(18)}, 0 0 14px ${mix(45)}` }} />;
  return <span role="img" aria-label={`${s.name} ${say}`} className={`${base} size-3.5 border-2 border-border bg-card`} />;
}
// 칸 아래 한 줄 — 언제 · 어떻게(브랜치 칸), 일부면 빠진 파일 단추, 확인 필요면 같은 제목
function Note({ s, name, onFiles }: { s: Step; name: string; onFiles: (x: { title: string; list: string[] }) => void }) {
  const e = s.reach, cls = 'text-xs leading-snug';
  if (s.key === 'commit' || s.key === 'push') return s.note ? <span className={`${cls} ${s.state === 'next' ? '' : 'text-muted-foreground'}`}>{s.note}</span> : null;
  if (!e) return null;
  if (e.state === 'in') return <span className={cls}>{s.key === 'via' ? '합침' : r(e.how)} · {at(e.at)}</span>;
  if (e.state === 'content') return <span className={cls} title="커밋 해시는 없지만 이 런의 변경이 다 들어 있다(스쿼시 · 체리픽 · 다시 만든 머지)">내용 일치 · {at(e.at)}</span>;
  if (e.state === 'partial') return <span className={`${cls} text-amber-800 dark:text-amber-300`}>{e.n}개 중 {e.k}개 · <button type="button" className="underline-offset-2 hover:underline" onClick={() => onFiles({ title: `빠진 파일 — ${name}`, list: e.missing ?? [] })}>빠진 파일</button></span>;
  if (e.state === 'subject') return <span className={`${cls} text-blue-800 dark:text-blue-300`} title={`같은 제목 커밋 「${e.subject}」 이 있는데, 이 런의 변경이 그대로는 맞지 않는다 — 들어간 뒤 고쳐졌을 수 있다`}>제목만 같음 · {at(e.at)}</span>;
  if (s.state === 'next') return <span className={cls}>{s.key === 'via' ? s.note : '올릴 차례'}</span>;
  return null;
}
const r = (how?: 'merge' | 'ff') => how === 'ff' ? 'fast-forward' : '머지';

// 단추 확인 창 — 무엇을 돌리는지(단추 설명 · 명령) 보여 주고 사람이 누를 때만. 돌리는 것은 런 화면 단추와 같다(POST /api/runs/<번호>/action)
function ActionDialog({ pick, onClose }: { pick: Pick; onClose: () => void }) {
  const qc = useQueryClient(), [text, setText] = useState(''), [busy, setBusy] = useState(false), { run, action: a } = pick;
  if (a.copy) return <CopyDialog pick={pick} onClose={onClose} />;
  const go = async () => {
    setBusy(true);
    try {
      await post(`/api/runs/${run.id}/action`, { n: a.n, ...(a.ask ? { text } : {}) });
      toast(`「${a.label}」 을 돌렸다 — 결과는 런 화면 단추 기록에서`, 4000);
      onClose();
      for (const ms of [3000, 15_000]) setTimeout(() => void qc.invalidateQueries({ queryKey: ['reach'] }), ms);
    } catch (e) { toast(`돌리지 못했다 — ${(e as Error).message}`, 6000); setBusy(false); }
  };
  return (
    <Sheet title={`「${a.label}」 을 돌릴까요?`} sub={`런 #${run.id} · ${short(run.title)}`} onClose={onClose}>
      <div className="space-y-4">
        {a.hint && <p className="text-sm">{a.hint}</p>}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground">돌릴 명령</p>
          <pre className="overflow-x-auto rounded-lg bg-[var(--code)] px-3 py-2.5 font-mono text-xs text-[var(--code-foreground)]">{a.command}</pre>
        </div>
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

// 복사 단추 창 — 엔진 명령이 만든 글(사람이 직접 돌릴 명령)을 받아 보여 주고 복사만. EDITH 는 그 글을 돌리지 않는다
function CopyDialog({ pick, onClose }: { pick: Pick; onClose: () => void }) {
  const { run, action: a } = pick, [busy, setBusy] = useState(false), [res, setRes] = useState<{ output: string; code: number } | null>(null), [copied, setCopied] = useState(false);
  const make = async () => {
    setBusy(true);
    try { const r = await post<{ output?: string; code?: number }>(`/api/runs/${run.id}/action`, { n: a.n }); setRes({ output: r.output ?? '', code: r.code ?? 1 }); }
    catch (e) { toast(`만들지 못했다 — ${(e as Error).message}`, 6000); }
    setBusy(false);
  };
  const copy = async () => { await copyText(res!.output); setCopied(true); };
  return (
    <Sheet title={`「${a.label}」`} sub={`런 #${run.id} · ${short(run.title)}`} onClose={onClose}>
      <div className="space-y-4">
        {a.hint && <p className="text-sm">{a.hint}</p>}
        <p className="text-sm text-muted-foreground">EDITH 는 이 명령을 돌리지 않습니다 — 복사해서 직접 돌립니다.</p>
        {res && <div className="space-y-1.5">
          <p className={`text-xs font-semibold ${res.code === 0 ? 'text-muted-foreground' : 'text-rose-700 dark:text-rose-300'}`}>{res.code === 0 ? '복사할 명령' : `만드는 명령이 끝 코드 ${res.code} — 아래는 그 출력`}</p>
          <pre className="max-h-[45vh] overflow-auto rounded-lg bg-[var(--code)] px-3 py-2.5 font-mono text-xs whitespace-pre text-[var(--code-foreground)]">{res.output || '(출력 없음)'}</pre>
        </div>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>닫기</Button>
          {res?.code === 0 ? <Button onClick={() => void copy()}>{copied ? '복사됨' : '복사'}</Button>
            : <Button disabled={busy} onClick={() => void make()}>{busy ? '만드는 중…' : res ? '다시 만들기' : '명령 만들기'}</Button>}
        </div>
      </div>
    </Sheet>
  );
}

// 창(브라우저 dialog — Esc · 바깥 누르기로 닫힌다). side 면 오른쪽 패널
function Sheet({ title, sub, onClose, children, side }: { title: string; sub?: string; onClose: () => void; children: ReactNode; side?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; d?.showModal(); return () => d?.close(); }, []);
  return (
    <dialog ref={ref} onClose={onClose} onClick={e => { if (e.target === ref.current) onClose(); }} aria-label={title}
      className={side ? 'm-0 ml-auto h-dvh max-h-none w-[min(28rem,100vw)] max-w-none border-l bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/20'
        : 'm-auto w-[min(34rem,94vw)] max-w-none rounded-xl border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/30'}>
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
  const mine = (q.data ?? []).filter(x => x.run.id === run?.id), items = mine.flatMap(x => x.items), n = items.filter(i => i.done).length;
  const check = async (x: Res, text: string, was: boolean, group?: string) => {
    setBusy(true);
    try { await post('/api/results/check', { run: x.run.id, title: x.title, text, was, group: group ?? '' }); }
    catch (e) { toast(`바꾸지 못했다 — ${(e as Error).message}`, 5000); }
    await Promise.all([qc.invalidateQueries({ queryKey: ['results'] }), qc.invalidateQueries({ queryKey: ['reach'] })]);
    setBusy(false);
  };
  return (
    <Sheet side title="배포 할 일" sub={run ? `런 #${run.id} · ${short(run.title)}` : undefined} onClose={onClose}>
      {!q.data ? <Empty>불러오는 중…</Empty> : !items.length ? <Empty>이 런이 남긴 할 일이 없다.</Empty> : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="text-sm"><b className="tabular-nums">{n}/{items.length}</b> <span className="text-muted-foreground">끝남</span></div>
            <div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${n / items.length * 100}%` }} /></div>
          </div>
          {mine.map(x => (
            <div key={x.title} className="space-y-2">
              {mine.length > 1 && <p className="text-sm font-medium">{x.title}</p>}
              {x.note && <p className="text-xs whitespace-pre-wrap text-muted-foreground">{x.note}</p>}
              {[...new Set(x.items.map(i => i.group ?? ''))].map(g => (
                <Fragment key={g}>
                  {g && <p className="pt-1 font-mono text-[0.6875rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase">{g}</p>}
                  <ul className="space-y-0.5">
                    {x.items.filter(i => (i.group ?? '') === g).map(i => (
                      <li key={i.text}>
                        <label className="-mx-2 flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/60">
                          <input type="checkbox" className="mt-1 accent-[var(--primary)]" checked={i.done} disabled={busy} onChange={() => void check(x, i.text, i.done, i.group)} />
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
