// 오늘 — 아침에 여는 화면. 마지막으로 일한 평일부터 어제까지 한 일(작업마다 한 줄 — 월요일이면 금 · 토 · 일)과 오늘 할 일(출처 꼬리표 · 처음 안 끝난 줄이 빛난다). 주소는 #/today.
// 한 일은 서버 /api/today(src/today.ts — 지난 작업일의 내 말 · 커밋 · 런), 작업마다 한 줄은 /api/today/ai(하루 한 번 claude -p, 그 전엔 커밋 제목 · 마지막 말).
// 할 일은 대기(승인 기다리는 pane, /api/herdr) · 배포(배포 목록에서 안 끝난 배포 조치, /api/deploy) · 요청(받은 요청, /api/requests) — 지금 상태에서 바로,
// 하다 만(지난 기록에서 AI 가 뽑은 것) · 이어 옴(앞 날에 안 끝낸 것) · 직접. 체크 · 직접 추가 · 버리기는 /api/today/todo(하루 기록 파일).
// 사흘 넘게 이어 온 것은 「오래된 것」 으로 접는다. 긴 글은 두 줄까지 보여 주고 넘치면 자른다(마우스를 올리면 전체).
import { useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { get, post, useHerdr } from './api.ts';
import { toast } from './copy.ts';
import { paneText } from './herdrUi.tsx';
import { Bracketed, Empty, GRID_BG, mix } from './ui.tsx';

type Work = { name: string; path: string; branch?: string; asks: number; commits: { id: string; msg: string }[]; line: string };
type Brief = { from: string | null; last: string | null; works: Work[]; runs: { id: number; name: string; state: string }[] };
type Req = { id: string; engine: string; input: string; title?: string; from?: string };
type Deploy = { items: { tag?: string; ticket?: string; agenda?: string; branch: string; done?: string; deferred?: boolean; tasks: { done: boolean }[] }[] };
type Ai = { made: number; did: Record<string, string>; todos: { path: string; text: string }[] };
type TodoState = { date: string; items: { id: string; text: string; since: string }[]; checks: string[] };
type Todo = { id: string; text: string; tag: '대기' | '배포' | '요청' | '하다 만' | '이어 옴' | '직접'; note?: string; act?: { label: string; href: string } };

const OLD = 4;   // 이만큼 일째를 넘으면(사흘 넘게 이어 오면) 「오래된 것」 으로 접는다
const RUN_STATE: Record<string, string> = { done: '끝', check: '확인 필요', running: '도는 중', stopped: '멈춤', queued: '대기 줄' };
const p2 = (n: number) => String(n).padStart(2, '0');
const dayOf = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const day = (d: string) => new Date(`${d}T00:00`);
const en = (d: string) => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day(d).getDay()]} ${d.slice(5).replace('-', '/')}`;
const ko = (d: string) => `${'일월화수목금토'[day(d).getDay()]} ${d.slice(5).replace('-', '/')}`;
const hm = (t: number) => new Date(t).toTimeString().slice(0, 5);

export function TodayPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['today'], queryFn: () => get<Brief>('/api/today'), staleTime: 5 * 60_000 });
  const herdr = useHerdr().data;
  const reqs = useQuery({ queryKey: ['requests'], queryFn: () => get<Req[]>('/api/requests'), refetchInterval: 5000 }).data ?? [];
  const dep = useQuery({ queryKey: ['deploy'], queryFn: () => get<Deploy>('/api/deploy'), staleTime: 60_000 }).data;
  const [draft, setDraft] = useState(''), [remaking, setRemaking] = useState(false);
  const b = q.data, works = b?.works ?? [], runs = b?.runs ?? [], today = dayOf(new Date());
  // 하루 기록 — 체크 · 직접 추가 · 버리기는 서버 파일에, 답으로 온 기록으로 바로 바꾼다
  const st = useQuery({ queryKey: ['today-todo', today], queryFn: () => get<TodoState>('/api/today/todo') }).data;
  const act = async (body: object) => {
    try { qc.setQueryData(['today-todo', today], await post<TodoState>('/api/today/todo', body)); } catch (e) { toast(`저장하지 못했다 — ${(e as Error).message}`, 5000); }
  };
  const done = (id: string) => !!st?.checks.includes(id);
  // AI 한 줄 · 하다 만 일 — 오늘 처음이면 서버가 만들고(몇 초) 아니면 만들어 둔 것
  const ai = useQuery({ queryKey: ['today-ai', today], queryFn: () => post<Ai>('/api/today/ai', {}), staleTime: Infinity, retry: false, enabled: works.length > 0 });
  const remake = async () => {
    setRemaking(true);
    try {
      qc.setQueryData(['today-ai', today], await post<Ai>('/api/today/ai', { force: true }));
      await qc.invalidateQueries({ queryKey: ['today'] });
    } catch (e) { toast(`다시 만들지 못했다 — ${(e as Error).message}`, 6000); }
    setRemaking(false);
  };
  const busy = remaking || ai.isFetching;

  // 할 일 — 대기 · 배포 · 요청은 지금 상태에서 읽는다(원본에서 풀리면 빠진다). items 의 days 는 처음 생긴 날부터 며칠째(오늘 적은 것이 1)
  const items = (st?.items ?? []).map(i => ({ ...i, days: Math.round((day(today).getTime() - day(i.since).getTime()) / 86_400_000) + 1 }));
  const blocked = herdr?.panes.filter(p => p.status === 'blocked') ?? [];
  // 배포 — 안건마다 안 끝낸 배포 조치 수(보관 · 연기한 것은 빼고)
  // 안건 키가 같으면 한 안건(배포 화면 카드와 같게) — 이름은 안건 자기 항목(티켓이 안건 키거나 없음)의 이름
  const byKey = new Map<string, { tag: string; n: number }>();
  for (const x of dep?.items ?? []) {
    if (x.done || x.deferred) continue;
    const k = x.agenda ?? x.tag ?? x.branch, g = byKey.get(k) ?? { tag: x.tag ?? x.branch, n: 0 };
    if ((!x.ticket || x.ticket === x.agenda) && x.tag) g.tag = x.tag;
    g.n += x.tasks.filter(t => !t.done).length;
    byKey.set(k, g);
  }
  const left = [...byKey.values()].filter(g => g.n > 0);
  const todos: Todo[] = [
    ...blocked.map(p => ({ id: `pane:${p.id}`, text: `${herdr?.workspaces.find(w => w.workspace_id === p.workspace)?.label ?? ''} · ${paneText(p)} — 승인을 기다린다`, tag: '대기' as const, act: { label: '열기', href: `#/herdr/${p.id}` } })),
    ...left.map(({ tag, n }) => ({ id: `dep:${tag}`, text: `${tag} — 배포 조치 ${n}개 남음`, tag: '배포' as const, act: { label: '배포', href: '#/deploy' } })),
    ...reqs.map(r => ({ id: `req:${r.id}`, text: `요청 ${r.title || r.input.split('\n')[0] || r.engine} — 런으로 시작하거나 거절`, tag: '요청' as const, ...(r.from ? { note: r.from } : {}), act: { label: '열기', href: '#/runs' } })),
    ...(ai.data?.todos ?? []).filter(t => !items.some(i => i.text === t.text)).map(t => ({ id: `ai:${t.text}`, text: t.text, tag: '하다 만' as const, note: works.find(w => w.path === t.path)?.name })),
    ...items.filter(i => i.days > 1 && i.days <= OLD).map(i => ({ id: i.id, text: i.text, tag: '이어 옴' as const, note: `${i.days}일째` })),
    ...items.filter(i => i.days === 1).map(i => ({ id: i.id, text: i.text, tag: '직접' as const })),
  ];
  const old = items.filter(i => i.days > OLD && !done(i.id)), next = todos.find(t => !done(t.id)), n = todos.filter(t => done(t.id)).length;

  // 한 일 — 작업마다 한 줄(최대 6줄), 그날 노드가 움직인 런은 한 줄로 묶는다
  const shown = runs.length ? 5 : 6, more = Math.max(0, works.length - shown);
  const rows = [
    ...works.slice(0, shown).map(w => ({ key: w.path, name: w.name, where: w.branch ?? w.path, line: ai.data?.did[w.path] ?? w.line, meta: w.commits.length ? `커밋 ${w.commits.length}` : `대화 ${w.asks}` })),
    ...runs.length ? [{ key: 'runs', name: '런', where: runs.map(r => `#${r.id}`).join(' · '), line: runs.map(r => `${r.name}(${RUN_STATE[r.state] ?? r.state})`).join(' · '), meta: `런 ${runs.length}` }] : [],
  ];
  const log = [...works.flatMap(w => w.commits.map(c => ({ id: c.id, repo: w.name, msg: c.msg }))), ...runs.map(r => ({ id: `#${r.id}`, repo: '런', msg: `${r.name} · ${RUN_STATE[r.state] ?? r.state}` }))];
  const commits = works.reduce((s, w) => s + w.commits.length, 0), deploy = left.reduce((s, x) => s + x.n, 0);

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    void act({ op: 'add', text: draft.trim() });
    setDraft('');
  };
  return (
    <main className="min-h-0 flex-1 overflow-y-auto" style={GRID_BG}>
      <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[0.6875rem] font-semibold tracking-[0.24em] text-primary uppercase">Daily brief · {en(today)} · {b?.from && b.last ? `지난 작업 ${en(b.from)}${b.from !== b.last ? ` ~ ${en(b.last)}` : ''}` : '지난 작업 없음'}</div>
            <h1 className="text-2xl font-bold">오늘</h1>
            <p className="text-sm text-muted-foreground">지난 작업일에 한 일과 오늘 할 일 — 빛나는 줄부터 하면 된다.</p>
          </div>
          {busy ? <span className="flex items-center gap-2 font-mono text-xs text-primary uppercase"><span className="size-2 animate-pulse rounded-full bg-primary" />요약 만드는 중</span>
            : ai.error ? <span title={String(ai.error)} className="max-w-80 truncate text-xs text-destructive">요약을 못 만들었다 — {(ai.error as Error).message}</span>
            : ai.data && <span className="font-mono text-xs text-muted-foreground uppercase">만든 시각 {hm(ai.data.made)}</span>}
          <Button variant="outline" className="text-primary" disabled={busy || !works.length} onClick={() => void remake()}>다시 만들기</Button>
        </div>

        <Bracketed label="한눈에" className="">
          <div className="flex flex-wrap">
            <Stat label="Commits" n={commits} sub={`레포 ${works.filter(w => w.commits.length).length}개`} />
            <Stat label="Runs" n={runs.length} sub={`끝 ${runs.filter(r => r.state === 'done').length} · 확인 ${runs.filter(r => r.state === 'check').length}`} />
            <Stat label="Waiting · 지금" n={blocked.length} sub="승인 기다리는 pane" hot={blocked.length > 0} />
            <Stat label="Deploy todo" n={deploy} sub="배포 조치 남음" />
          </div>
        </Bracketed>

        <div className="flex flex-wrap items-start gap-4">
          <Bracketed label="지난 작업일에 한 일" className="min-w-0 flex-[1_1_25rem] px-5 py-4">
            <Head eyebrow="Recap" title="한 일" side={b?.from && b.last ? `${ko(b.from)}${b.from !== b.last ? ` ~ ${ko(b.last)}` : ''} · 작업 ${works.length}` : ''} />
            {!b ? <Empty>{q.error ? `읽지 못했다 — ${String(q.error)}` : '불러오는 중…'}</Empty>
              : !rows.length ? <Empty>지난 작업일 기록이 없다(Claude 에 말을 건 날이 오늘뿐이다).</Empty>
              : <ul>
                {rows.map(d => (
                  <li key={d.key} className="grid grid-cols-[8rem_minmax(0,1fr)_auto] items-start gap-x-3.5 border-t border-border/70 py-2.5">
                    <div className="min-w-0">
                      <div title={d.name} className="line-clamp-2 text-sm font-semibold break-all">{d.name}</div>
                      <div title={d.where} className="truncate font-mono text-[0.6875rem] text-muted-foreground">{d.where}</div>
                    </div>
                    <div title={d.line} className={`line-clamp-2 min-w-0 text-sm ${busy && d.key !== 'runs' ? 'text-muted-foreground' : ''}`}>{d.line}</div>
                    <span className="font-mono text-xs leading-[1.375rem] whitespace-nowrap text-muted-foreground">{d.meta}</span>
                  </li>
                ))}
              </ul>}
            {log.length > 0 && (
              <details className="border-t border-border/70 pt-2">
                <summary className="cursor-pointer py-1 text-[0.8125rem] text-muted-foreground">커밋 {commits} · 런 {runs.length} 자세히{more ? ` · 작업 ${more}개 더` : ''}</summary>
                <ul className="mt-1 space-y-1.5 font-mono text-xs leading-relaxed">
                  {log.map(c => (
                    <li key={`${c.repo}:${c.id}`} className="flex min-w-0 gap-2.5">
                      <span className="shrink-0 text-primary">{c.id}</span>
                      <span title={c.repo} className="w-24 shrink-0 truncate text-muted-foreground">{c.repo}</span>
                      <span title={c.msg} className="line-clamp-2 min-w-0">{c.msg}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Bracketed>

          <Bracketed label="오늘 할 일" className="min-w-0 flex-[1.35_1_32rem] px-5 py-4">
            <Head eyebrow="Today" title="할 일" side={<>
              <span className="font-mono">{n}/{todos.length}</span>
              <span aria-hidden="true" className="h-1 w-18 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-primary" style={{ width: `${todos.length ? n / todos.length * 100 : 0}%` }} /></span>
            </>} />
            {!todos.length && <Empty>지금 할 일이 없다 — 승인 대기 · 받은 요청 · 배포 할 일이 생기면 여기에 뜬다. 아래에 직접 적어도 된다.</Empty>}
            <ul>
              {todos.map(t => {
                const d = done(t.id), now = t === next;
                return (
                  <li key={t.id} className={`-mx-2.5 flex min-h-11.5 items-center gap-2.5 border-t border-border/70 px-2.5 hover:bg-muted/70 ${now ? 'bg-primary/7' : ''}`}>
                    <button type="button" aria-pressed={d} title={t.text} onClick={() => void act({ op: 'check', id: t.id, done: !d })}
                      className="flex min-h-11 min-w-0 flex-1 items-center gap-3 py-1.5 text-left">
                      <span className="grid size-5 shrink-0 place-items-center"><Dot state={d ? 'done' : now ? 'next' : 'todo'} /></span>
                      <span className={`line-clamp-2 min-w-0 text-sm ${d ? 'text-muted-foreground line-through' : now ? 'font-semibold' : ''}`}>{t.text}</span>
                    </button>
                    {t.note && <span className="shrink-0 text-[0.78rem] whitespace-nowrap text-muted-foreground">{t.note}</span>}
                    <span className="shrink-0 rounded border px-1.5 font-mono text-[0.6875rem] leading-5 whitespace-nowrap text-primary">{t.tag}</span>
                    <span className="w-11 shrink-0 text-right">{t.act && <a href={t.act.href} className="text-[0.8125rem] font-semibold whitespace-nowrap text-primary hover:underline">{t.act.label} ›</a>}</span>
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-border/70 pt-2">
              {old.length > 0 && (
                <details>
                  <summary className="cursor-pointer py-1 text-[0.8125rem] text-muted-foreground">오래된 것 {old.length} — 사흘 넘게 이어 옴</summary>
                  <ul className="mb-1">
                    {old.map(o => (
                      <li key={o.id} className="flex min-h-10 items-center gap-3 text-muted-foreground">
                        <span className="grid size-5 shrink-0 place-items-center"><Dot state="todo" /></span>
                        <span title={o.text} className="line-clamp-2 min-w-0 flex-1 text-sm">{o.text}</span>
                        <span className="shrink-0 text-[0.78rem]">{o.days}일째</span>
                        <Button size="sm" variant="outline" className="h-8" onClick={() => void act({ op: 'check', id: o.id, done: true })}>끝냄</Button>
                        <Button size="sm" variant="outline" className="h-8 text-muted-foreground" onClick={() => void act({ op: 'drop', id: o.id })}>버리기</Button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <form onSubmit={add} className="mt-1.5 flex gap-2">
                <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="할 일 직접 추가 — Enter" aria-label="할 일 직접 추가"
                  className="h-10 min-w-0 flex-1 rounded-full border bg-card px-3.5 text-sm outline-none focus:ring-2 focus:ring-ring/40" />
                <Button type="submit" className="h-10 font-bold">추가</Button>
              </form>
            </div>
          </Bracketed>
        </div>
      </div>
    </main>
  );
}

// 패널 머리 — 영문 모노 표 · 제목 · 오른쪽 한 줄
function Head({ eyebrow, title, side }: { eyebrow: string; title: string; side: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline gap-2.5">
      <span className="font-mono text-[0.6875rem] font-semibold tracking-[0.2em] text-primary uppercase">{eyebrow}</span>
      <h2 className="font-bold">{title}</h2>
      <span className="ml-auto flex items-center gap-2 text-[0.8125rem] text-muted-foreground">{side}</span>
    </div>
  );
}

// 한눈에 칸 — hot 은 지금 할 일(테마 색 바탕)
function Stat({ label, n, sub, hot }: { label: string; n: number; sub: string; hot?: boolean }) {
  return (
    <div className={`flex-[1_1_12rem] border-r px-5 py-3.5 last:border-r-0 ${hot ? 'bg-primary/7' : ''}`}>
      <div className={`font-mono text-[0.6875rem] tracking-[0.2em] uppercase ${hot ? 'font-bold text-primary' : 'text-muted-foreground'}`}>{label}</div>
      <div className="flex items-baseline gap-2">
        <span className={`text-[1.75rem] font-bold tabular-nums ${hot ? 'text-primary' : ''}`}>{n}</span>
        <span className="text-[0.8125rem] text-muted-foreground">{sub}</span>
      </div>
    </div>
  );
}

// 할 일 점 — 결과 화면 단계 선의 점과 같은 모양(지금 차례는 빛나는 고리, 끝은 채운 체크)
function Dot({ state }: { state: 'next' | 'done' | 'todo' }) {
  if (state === 'done') return (
    <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4.5 4.5L19 7" /></svg>
    </span>
  );
  if (state === 'next') return <span className="size-5 rounded-full border-2 border-primary bg-card" style={{ boxShadow: `0 0 0 5px ${mix(18)}, 0 0 14px ${mix(45)}` }} />;
  return <span className="size-3.5 rounded-full border-2 border-border bg-card" />;
}
