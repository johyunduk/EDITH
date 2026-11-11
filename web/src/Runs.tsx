// 런 #번호 — 공방의 런(또는 시험으로 엔진 · 체인)을 한 번 돌린 것. 왼쪽 「새 런」과 런 목록, 가운데 결과물 판(Board — 「요약 · 타임라인 · 캔버스 · 분석」 으로 바꿔 본다), 오른쪽 런 pane(Claude).
// 주소는 #/runs/<번호>. 돌리는 것은 서버의 실행기(src/runner.ts)이고, 화면은 run.json 을 읽어 보여 주며 멈춤 · 이어서 · 건너뛰기만 보낸다.
// 런 이름은 「티켓 [안건] 짧은 제목」(받은 요청 · 배포 목록 · 엔진 요약에서)을 크게, 「#번호 엔진 이름」 은 그 위에 작게.
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { get, post, useHerdr } from './api.ts';
import { Button } from '@/components/ui/button';
import { AgentPane } from './AgentPane.tsx';
import { Empty, Icon, Md, Tag } from './ui.tsx';
import { DiffView } from './Diff.tsx';
import { Kind, PushTag, STATUS } from './herdrUi.tsx';
import { FolderInput } from './Side.tsx';
import { copyText, toast } from './copy.ts';
import { Attach, upload } from './Attach.tsx';
import { NODE, type NodeState } from './StepFlow.tsx';
import { RunFlow } from './RunFlow.tsx';
import { RunTimeline, type Entry } from './RunTimeline.tsx';
import { claudeChip, columns, dropShared, dur, foldOf, isTest, notionUrl, pastDays, phases, runNo, stageOf, statusOf, type ClaudeUsed, type Col, type Phase, type Status } from './runFlow.ts';
import { byPhase, highlights, inTok, type StatNode, type Stats } from './runStats.ts';
import type { FlowStep } from './stepFlow.ts';
import { groupOutputs, groupSize, type OutputGroup } from './outputGroups.ts';
import { DAYS, nextText, type Sched } from './schedule.ts';
import { ActBand, JobLine, useJob } from './OutputAct.tsx';

type Step = FlowStep & { skill?: string; command?: string; max?: number };
type RunState = 'queued' | 'running' | 'check' | 'stopped' | 'done' | 'dropped';   // dropped = 버림(엔진 「버리기」) — 기록만, 아무것도 못 한다
type Run = {
  id: number; engine: string; name: string; cwd: string; input: string; created: number; state: RunState; reason?: string; pane?: string; dir: string; branch?: string; unattended?: boolean;
  tag?: string; title?: string; agenda?: string;   // 런 이름표 — 티켓 · 짧은 제목(서버 runLabel) · 안건 이름(배포 목록 tag — src/agenda.ts)
  steps: Step[]; nodes: Record<string, { state: NodeState; attempt: number; fails: number; summary?: string; line?: string; reason?: string; wake?: number }>;
  detail: Record<string, { prompt?: string; output?: string; claude?: ClaudeUsed }>;
  rewinds?: { at: number; to: string; name: string; by: string; reason: string }[];
  timeline?: Entry[];   // 옛 서버는 없다
  panes?: Record<string, { pane?: string }>;   // 갈래의 pane(본 줄은 pane)
  actions: { label: string; command: string; ask?: string; hint?: string; danger?: boolean; when?: 'done'; copy?: boolean }[];
  acted: { label: string; at: number; text?: string; code: number | null; note?: string; output: string }[];
  live?: boolean;   // 엔진이 브라우저 화면 포트(edith-live.json)를 남겼다
  summary?: Summary | null;   // 끝난 런 요약(엔진이 남긴 edith-summary.json — 서버 src/runSummary.ts)
};
type Summary = {
  title: string; did: string[]; chips: string[]; outputs: string[];
  next: { label: string; note?: string; action?: string; done?: boolean }[];
  check: { title: string; note?: string; items: string[] }[];
};
type Workdir = { kind: 'ask' } | { kind: 'fixed'; dir: string } | { kind: 'worktree'; repo: string; base?: string };
type Item = { id: number; name: string; engine: string; state: RunState; reason?: string; created: number; total: number; done: number; tag?: string; title?: string; agenda?: string; scheduled?: { at: string } };
type Req = { id: string; engine: string; input: string; title?: string; tag?: string; from?: string; room?: string; cwd?: string; branch?: string; unattended?: boolean; parent?: { tag?: string; title?: string }; at: number };

const RUN_LABEL: Record<RunState, string> = { queued: '대기', running: '도는 중', check: '확인 필요', stopped: '멈춤', done: '끝', dropped: '버림' };
const RUN_TONE: Record<RunState, string> = {
  queued: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  running: 'bg-sky-500/15 text-sky-700 dark:text-sky-400', check: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  stopped: 'bg-muted text-muted-foreground', done: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  dropped: 'bg-muted text-muted-foreground line-through',
};
const ended = (s: RunState) => s === 'done' || s === 'dropped';
const PLAY = <path d="M6 4.5v15l12.5-7.5z" />;
const KIND = { chain: '체인', engine: '엔진' } as const;
// 노션 로고(채운 모양) — simple-icons notion.svg(CC0)
const NOTION = 'M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z';
const CHEVRON_L = <path d="m15 18-6-6 6-6" />, CHEVRON_R = <path d="m9 18 6-6-6-6" />, CLOCK = <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>;
// 스케줄 런 점 — 상태 칩과 같은 색
const DOT: Record<RunState, string> = { queued: 'bg-violet-500', running: 'bg-sky-500', check: 'bg-amber-500', stopped: 'bg-muted-foreground/40', done: 'bg-emerald-500', dropped: 'bg-muted-foreground/40' };
// 노드 자리 — 바깥 엔진부터(백엔드 › 계획). 옛 런은 든 엔진 이름만
const place = (s: Step) => s.boxes?.map(b => b.name).join(' › ') ?? s.lane;
const when = (t: number) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function RunsPage({ id, side }: { id?: string; side: boolean }) {
  const list = useQuery({ queryKey: ['runs'], queryFn: () => get<Item[]>('/api/runs'), refetchInterval: 3000 });
  const [fold, setFoldState] = useState(() => { try { return localStorage.getItem('edith.runs.pane') === 'off'; } catch { return false; } });
  const setFold = (v: boolean) => { setFoldState(v); try { localStorage.setItem('edith.runs.pane', v ? 'off' : 'on'); } catch { /* 저장 안 됨 */ } };
  // 주소 #/runs/<번호>[/out/<산출물 차례>] — 뒤엣것은 배포 카드의 산출물 링크가 그 문서를 바로 열게. #/runs/schedule/<엔진> — 스케줄 하나
  const m = id?.match(/^(\d+)(?:\/out\/(\d{1,2}))?$/), n = m ? Number(m[1]) : undefined, out = m?.[2] ? Number(m[2]) : undefined, sched = id?.match(/^schedule\/(.+)$/)?.[1];
  const [req, setReq] = useState<Req | null>(null);
  const run = useQuery({
    queryKey: ['run', n], queryFn: () => get<Run>(`/api/runs/${n}`), enabled: n !== undefined,
    refetchInterval: q => q.state.data?.state === 'running' || q.state.data?.acted.some(a => a.code === null) ? 1500 : 5000,   // 단추 명령이 도는 동안도 자주
  });
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside className={`max-h-80 shrink-0 overflow-y-auto border-b bg-sidebar p-1.5 md:max-h-none md:w-64 md:border-r md:border-b-0 ${side ? '' : 'hidden'}`}>
        <Requests onOpen={setReq} />
        <NewRun req={req} done={() => setReq(null)} />
        {!list.data ? <p className="p-2.5 text-xs text-muted-foreground">불러오는 중…</p>
          : !list.data.length ? <p className="p-2.5 text-xs text-muted-foreground">아직 런이 없다</p>
          : <RunList items={list.data} current={n} sched={sched} />}
      </aside>
      <main className="flex min-h-[32rem] min-w-0 flex-1 flex-col overflow-y-auto">
        {sched ? <ScheduleDetail id={sched} />
          : n === undefined ? <div className="p-6"><Empty>왼쪽 「새 런」에서 공방의 런을 골라 돌린다. 지난 런은 목록에서 본다.</Empty></div>
          : run.error && !run.data ? <div className="p-6"><Empty>런을 읽지 못했다 — {String(run.error)}</Empty></div>
          : !run.data ? <div className="p-6"><Empty>불러오는 중…</Empty></div>
          : <RunDetail r={run.data} out={out} />}
      </main>
      <RunPane panes={run.data ? [{ track: '', id: run.data.pane }, ...Object.entries(run.data.panes ?? {}).map(([track, v]) => ({ track, id: v.pane }))].filter(x => x.id) as { track: string; id: string }[] : []}
        fold={fold} setFold={setFold} />
    </div>
  );
}

// 런 목록 — 「진행 중」(대기 · 도는 중 · 확인 필요 · 멈춤) · 「스케줄」(스케줄이 걸린 엔진) · 「지난 런」(끝 · 버림) 세 탭. 지난 런은 찾기 · 상태 칩 · 만든 날 묶음.
// 고른 탭은 이 브라우저에 기억한다. 보는 런이 지난 런이면(주소로 열었거나 보던 런이 끝났거나) 그 탭으로, 스케줄을 보고 있으면 스케줄 탭으로 넘어가 어디 있는지 보이게
// 진행 중 · 지난 런은 「실제 런 · 시험 런」 중 하나만 보인다(시험 런 = 10001 위 번호, 옛 시험 런 #38 등은 실제 쪽). 보는 런이 다른 쪽이면 그쪽으로 넘어간다
type Tab = 'live' | 'sched' | 'past';
function RunList({ items, current, sched }: { items: Item[]; current?: number; sched?: string }) {
  const [tab, setTabState] = useState<Tab>(() => { try { const t = localStorage.getItem('edith.runs.tab'); return t === 'past' || t === 'sched' ? t : 'live'; } catch { return 'live'; } });
  const setTab = (t: Tab) => { setTabState(t); try { localStorage.setItem('edith.runs.tab', t); } catch { /* 저장 안 됨 */ } };
  const [test, setTestState] = useState(() => { try { return localStorage.getItem('edith.runs.kind') === 'test'; } catch { return false; } });
  const setTest = (v: boolean) => { setTestState(v); try { localStorage.setItem('edith.runs.kind', v ? 'test' : 'real'); } catch { /* 저장 안 됨 */ } };
  const scheds = useQuery({ queryKey: ['schedule'], queryFn: () => get<Sched[]>('/api/schedule'), refetchInterval: 10_000 }).data ?? [];
  useEffect(() => { if (sched) setTab('sched'); }, [sched]);
  useEffect(() => { if (current !== undefined) setTest(isTest(current)); }, [current]);
  const [q, setQ] = useState(''), [only, setOnly] = useState<'all' | 'done' | 'dropped'>('all');
  const kind = items.filter(r => isTest(r.id) === test), live = kind.filter(r => !ended(r.state)), past = kind.filter(r => ended(r.state));
  const liveOf = (t: boolean) => items.filter(r => isTest(r.id) === t && !ended(r.state)).length;
  const cur = items.find(r => r.id === current), curPast = !!cur && ended(cur.state);
  useEffect(() => { if (curPast) setTab('past'); }, [current, curPast]);
  const days = pastDays(past, q, only);
  const tabCls = (on: boolean) => `h-8 rounded-md text-[0.8125rem] transition ${on ? 'bg-card font-semibold text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`;
  const chip = (on: boolean) => `h-7 rounded-full border px-2.5 text-xs ${on ? 'border-primary bg-accent font-semibold text-accent-foreground' : 'bg-card hover:bg-muted/60'}`;
  const pill = (r: Item) => <span className={`shrink-0 rounded-full px-2 py-px text-[0.6875rem] font-semibold ${RUN_TONE[r.state]}`}>{RUN_LABEL[r.state]}</span>;
  const row = (r: Item) => `flex items-start gap-2 rounded-md border-l-2 px-2 py-1.5 ${r.id === current ? 'border-primary bg-accent text-accent-foreground' : 'border-transparent hover:bg-muted/70'}`;
  return (
    <>
      <div role="tablist" aria-label="런 목록" className="my-1.5 grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
        <button type="button" role="tab" aria-selected={tab === 'live'} onClick={() => setTab('live')} className={tabCls(tab === 'live')}>진행 중 {live.length}</button>
        <button type="button" role="tab" aria-selected={tab === 'sched'} onClick={() => setTab('sched')} className={tabCls(tab === 'sched')}>스케줄 {scheds.length}</button>
        <button type="button" role="tab" aria-selected={tab === 'past'} onClick={() => setTab('past')} className={tabCls(tab === 'past')}>지난 런 {past.length}</button>
      </div>
      {tab !== 'sched' && (
        <div role="group" aria-label="런 종류" className="mb-1.5 flex gap-1.5">
          {([[false, '실제 런'], [true, '시험 런']] as const).map(([t, label]) =>
            <button key={label} type="button" aria-pressed={test === t} onClick={() => setTest(t)} className={chip(test === t)}>{label}{liveOf(t) > 0 && ` · 진행 ${liveOf(t)}`}</button>)}
        </div>
      )}
      {tab === 'sched' ? (
        <div role="tabpanel" aria-label="스케줄" className="space-y-1">
          {scheds.map(s => (
            <a key={s.id} href={`#/runs/schedule/${s.id}`} className={`block rounded-md border-l-2 px-2 py-1.5 ${s.id === sched ? 'border-primary bg-accent text-accent-foreground' : 'border-transparent hover:bg-muted/70'}`}>
              <span className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground"><Icon className="size-3">{CLOCK}</Icon>{DAYS[s.schedule.days]} {s.schedule.at}{s.error && <span className="ml-auto text-destructive">못 시작함</span>}</span>
              <span className="block truncate text-[0.8125rem] font-semibold">{s.name}</span>
              <span className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground tabular-nums">다음 {nextText(s.next)}
                {s.runs.length > 0 && <span className="ml-1 flex items-center gap-0.5" aria-label={`최근 ${Math.min(5, s.runs.length)}번`}>· 최근{s.runs.slice(0, 5).reverse().map(r => <span key={r.id} title={`${runNo(r.id)} ${RUN_LABEL[r.state]}`} className={`ml-0.5 size-1.5 rounded-full ${DOT[r.state]}`} />)}</span>}
              </span>
            </a>
          ))}
          <p className="p-2.5 text-[0.6875rem] text-muted-foreground">{scheds.length ? '' : '스케줄이 걸린 엔진이 없다. '}스케줄은 공방에서 건다 — 엔진 머리 「스케줄」 줄</p>
        </div>
      ) : tab === 'live' ? (
        <div role="tabpanel" aria-label="진행 중">
          {!live.length && <p className="p-2.5 text-xs text-muted-foreground">진행 중인 런이 없다 — 위 「새 런」에서 시작한다</p>}
          {live.map(r => (
            <a key={r.id} href={`#/runs/${r.id}`} title={r.reason} className={row(r)}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.6875rem] text-muted-foreground tabular-nums">{runNo(r.id)} {r.name} · {when(r.created)} · {r.done}/{r.total}</span>
                <span className="line-clamp-2 text-[0.8125rem] font-medium">{r.tag && <span className="mr-1 font-mono text-xs text-primary">{r.tag}</span>}{r.agenda && <span className="mr-1 text-muted-foreground">[{r.agenda}]</span>}{r.title ?? r.name}</span>
              </span>
              {pill(r)}
            </a>
          ))}
        </div>
      ) : (
        <div role="tabpanel" aria-label="지난 런" className="space-y-1.5">
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="#번호 · 티켓 · 제목으로 찾기" aria-label="지난 런 찾기"
            className="h-8 w-full rounded-md border bg-card px-2.5 text-[0.8125rem] outline-none focus:ring-2 focus:ring-ring/40" />
          <div role="group" aria-label="상태로 거르기" className="flex flex-wrap gap-1.5">
            {([['all', `전체 ${past.length}`], ['done', `끝 ${past.filter(r => r.state === 'done').length}`], ['dropped', `버림 ${past.filter(r => r.state === 'dropped').length}`]] as const).map(([k, label]) =>
              <button key={k} type="button" aria-pressed={only === k} onClick={() => setOnly(k)} className={chip(only === k)}>{label}</button>)}
          </div>
          {!days.length && <p className="p-2.5 text-xs text-muted-foreground">{past.length ? '맞는 지난 런이 없다' : '아직 끝난 런이 없다'}</p>}
          {days.map(([d, rs]) => (
            <div key={d}>
              <p className="px-1.5 pt-1.5 pb-0.5 text-[0.6875rem] font-semibold text-muted-foreground">{d}</p>
              {rs.map(r => (
                <a key={r.id} href={`#/runs/${r.id}`} title={r.reason} className={row(r)}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.6875rem] text-muted-foreground tabular-nums">{runNo(r.id)} · {new Date(r.created).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                    <span className={`line-clamp-2 text-[0.8125rem] ${r.state === 'dropped' ? 'text-muted-foreground' : ''}`}>{r.tag && <span className="mr-1 font-mono text-xs text-primary">{r.tag}</span>}{r.title ?? r.name}</span>
                  </span>
                  {pill(r)}
                </a>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// 스케줄 하나 — 다음 실행 · 단추(지금 돌리기 · 멈춰 두기) · 그 엔진의 지난 스케줄 런(최근 것부터). 멈춰 두기는 스케줄 끄기다(다시 켜려면 공방)
function ScheduleDetail({ id }: { id: string }) {
  const qc = useQueryClient(), q = useQuery({ queryKey: ['schedule'], queryFn: () => get<Sched[]>('/api/schedule'), refetchInterval: 10_000 });
  const [busy, setBusy] = useState(false), [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); }, [armed]);
  const s = q.data?.find(x => x.id === id);
  if (!q.data) return <div className="p-6"><Empty>불러오는 중…</Empty></div>;
  if (!s) return <div className="p-6"><Empty>이 엔진에 걸린 스케줄이 없다 — <a href={`#/workshop/${id}`} className="text-primary hover:underline">공방</a> 엔진 머리 「스케줄」 줄에서 켠다.</Empty></div>;
  const runNow = async () => {
    setBusy(true);
    try { const r = await post<{ id: number }>('/api/runs', { engine: id, unattended: true }); location.hash = `#/runs/${r.id}`; }
    catch (e) { toast(`시작하지 못했다 — ${(e as Error).message}`, 5000); }
    setBusy(false);
  };
  const pause = async () => {
    if (!armed) return setArmed(true);
    setArmed(false); setBusy(true);
    try { await post(`/api/schedule/${id}`, { schedule: null }); toast('스케줄을 껐다 — 다시 켜려면 공방 엔진 「스케줄」 줄', 4000); void qc.invalidateQueries({ queryKey: ['schedule'] }); void qc.invalidateQueries({ queryKey: ['workshop'] }); }
    catch (e) { toast(`끄지 못했다 — ${(e as Error).message}`, 5000); }
    setBusy(false);
  };
  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 px-2 py-px text-[0.6875rem] font-semibold text-primary"><Icon className="size-3">{CLOCK}</Icon>스케줄</span>
        <span className="text-xs text-muted-foreground">{KIND[s.kind as keyof typeof KIND] ?? '엔진'} <a href={`#/workshop/${id}`} className="hover:underline">{s.name}</a> · {DAYS[s.schedule.days]} {s.schedule.at} · 무인</span>
        <span className="ml-auto flex gap-1.5">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void pause()} title="스케줄을 끈다 — 다시 켜려면 공방 엔진 「스케줄」 줄"
            className={`h-7 text-xs ${armed ? 'border-amber-500 bg-amber-500 text-white hover:bg-amber-500/90' : ''}`}>{armed ? '스케줄 끄기 — 한 번 더' : '멈춰 두기'}</Button>
          <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void runNow()} title="기다리지 않고 지금 무인 런으로 시작한다 — 스케줄 시각은 그대로 둔다">지금 돌리기</Button>
        </span>
      </div>
      <h2 className="text-lg font-bold">{s.name} <span className="ml-1 text-sm font-normal text-muted-foreground">다음 실행 <b className="font-semibold text-foreground">{nextText(s.next)}</b></span></h2>
      {s.error && <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">마지막 스케줄 — {s.error}</p>}
      {!s.runs.length ? <Empty>아직 스케줄이 시작한 런이 없다 — 「지금 돌리기」 는 여기 대신 진행 중 · 지난 런에 보인다</Empty> : (
        <ol className="space-y-2 border-l pl-4">
          {s.runs.map(r => (
            <li key={r.id} className="relative">
              <span className={`absolute -left-[1.3rem] top-3 size-2.5 rounded-full ring-2 ring-background ${DOT[r.state]}`} />
              <a href={`#/runs/${r.id}`} className="block rounded-md border bg-card px-3 py-2 hover:bg-muted/50">
                <span className="flex items-center gap-2 text-[0.8125rem] font-semibold tabular-nums">{runNo(r.id)} · {when(r.created)}<span className={`rounded-full px-2 py-px text-[0.6875rem] font-semibold ${RUN_TONE[r.state]}`}>{RUN_LABEL[r.state]}</span></span>
                {(r.title ?? r.reason) && <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{r.title ?? r.reason}</span>}
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// 받은 요청 — 다른 도구가 requests/ 에 둔 「이 엔진을 이 입력으로」. 「열기」 는 새 런 칸에 채우기만 하고(시작은 사람이), 「거절」 은 사유(비워도 된다)를 받아 답만 쓴다.
// 엔진에 요청 훅(actions.json on: "request")이 있으면 시작 · 거절 때 그 명령이 요청 쪽에 알린다 — 거절 사유도 넘어간다
function Requests({ onOpen }: { onOpen: (r: Req) => void }) {
  const qc = useQueryClient(), q = useQuery({ queryKey: ['requests'], queryFn: () => get<Req[]>('/api/requests'), refetchInterval: 5000 });
  const [no, setNo] = useState<string | null>(null), [why, setWhy] = useState('');
  // 접기 — 쌓이면 목록이 새 런 칸을 밀어내니 머리줄만 남긴다. 이 브라우저에 기억한다
  const [fold, setFoldState] = useState(() => { try { return localStorage.getItem('edith.runs.requests') === 'off'; } catch { return false; } });
  const setFold = (v: boolean) => { setFoldState(v); try { localStorage.setItem('edith.runs.requests', v ? 'off' : 'on'); } catch { /* 저장 안 됨 */ } };
  // 엔진 이름(id 대신) — 새 런 칸과 같은 목록
  const engines = useQuery({ queryKey: ['workshop'], queryFn: () => get<{ engines: { id: string; name: string }[] }>('/api/workshop') });
  if (!q.data?.length) return null;
  const nameOf = (id: string) => engines.data?.engines.find(e => e.id === id)?.name ?? id;
  const reject = (r: Req) => post(`/api/requests/${r.id}/reject`, { reason: why }).then(() => { setNo(null); setWhy(''); return qc.invalidateQueries({ queryKey: ['requests'] }); }, (e: Error) => toast(`하지 못했다 — ${e.message}`, 5000));
  return (
    <div className="mb-2 space-y-1 rounded-lg border border-sky-500/40 bg-sky-500/5 p-1.5">
      <button type="button" onClick={() => setFold(!fold)} aria-expanded={!fold} title={fold ? '받은 요청 펴기' : '받은 요청 접기'}
        className="flex w-full items-center gap-1 rounded px-1 text-left text-[0.6875rem] font-semibold text-sky-700 hover:bg-sky-500/10 dark:text-sky-400">
        <span aria-hidden className="w-2.5">{fold ? '▸' : '▾'}</span>받은 요청 {q.data.length}
      </button>
      {!fold && q.data.map(r => {
        // 제목 — 요청이 준 것, 없으면 입력 첫 줄(주소뿐이면 주소 대신 「노션」 단추로)
        const link = notionUrl(r.input), first = r.input.split('\n')[0].trim(), head = r.title ?? (link && !/\s/.test(first) && notionUrl(first) === link ? '' : first);
        return (
        <div key={r.id} className="space-y-1 rounded-md bg-card px-2.5 py-2 text-xs">
          <p className="flex items-center gap-1.5">
            {r.tag && <span className="min-w-0 truncate rounded bg-muted px-1.5 py-px text-[0.6875rem] font-medium text-muted-foreground" title={r.tag}>{r.tag}</span>}
            <span className="ml-auto shrink-0 text-[0.6875rem] text-muted-foreground tabular-nums" title={r.id}>{when(r.at)}</span>
          </p>
          {/* 상위 안건(요청이 parent 를 줄 때) — 제목 위 한 줄 */}
          {r.parent && (
            <p className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground" title={`안건 ${[r.parent.tag, r.parent.title].filter(Boolean).join(' ')}`}>
              <span className="shrink-0 font-semibold text-sky-700 dark:text-sky-400">안건</span>
              {r.parent.tag && <span className="shrink-0 tabular-nums text-sky-700 dark:text-sky-400">{r.parent.tag}</span>}
              {r.parent.title && <span className="min-w-0 truncate">{r.parent.title}</span>}
            </p>
          )}
          {head && <p className="line-clamp-2 text-[0.8125rem] font-semibold leading-snug" title={r.input}>{head}</p>}
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <span className="min-w-0 truncate">{nameOf(r.engine)}{r.from ? ` · ${r.from}` : ''}{r.room ? ` · ${r.room}` : ''}{r.unattended ? ' · 무인' : ''}</span>
            {link && (
              <a href={link} target="_blank" rel="noreferrer" title={`노션에서 열기 — ${link}`}
                className="ml-auto inline-flex shrink-0 items-center gap-1 rounded border border-[#e2d5bf] bg-[#f5eee2] px-1.5 py-px text-[0.6875rem] font-medium text-[#5b4a33] hover:bg-[#ece2d1] dark:border-[#5a4c3b] dark:bg-[#3b3328] dark:text-[#eadfcb]">
                <svg viewBox="0 0 24 24" fill="currentColor" className="size-3" aria-hidden><path d={NOTION} /></svg>노션
              </a>
            )}
          </p>
          {no === r.id ? (
            <form onSubmit={e => { e.preventDefault(); void reject(r); }} className="mt-1 flex gap-1">
              <input autoFocus value={why} onChange={e => setWhy(e.target.value)} placeholder="거절 사유(요청 쪽에 간다 · 비워도 된다)" aria-label="거절 사유"
                className="min-w-0 flex-1 rounded-md border bg-background px-2 py-0.5 text-xs outline-none focus:ring-2 focus:ring-ring/50" />
              <Button type="submit" size="sm" variant="outline" className="h-6 text-xs text-destructive">거절</Button>
              <Button type="button" size="sm" variant="ghost" className="h-6 text-xs" onClick={() => { setNo(null); setWhy(''); }}>취소</Button>
            </form>
          ) : (
            <div className="mt-1 flex gap-1">
              <Button size="sm" className="h-6 flex-1 text-xs" onClick={() => onOpen(r)}>열기</Button>
              <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => { setNo(r.id); setWhy(''); }}>거절</Button>
            </div>
          )}
        </div>
        );
      })}
    </div>
  );
}

type Pick = { label: string; note?: string; input: string; title?: string; tag?: string };
// 새 런 — 공방의 런을 카드로 고르고(고른 카드에 작업 폴더 · 입력 · 무인), 엔진 · 체인 바로 시험은 아래 접힌 칸. 받은 요청을 열면 그 값으로 채운다.
// 주소 #/runs?run=<런> · ?test=<엔진> 으로 오면(공방 「이 런 시작」 · 「시험으로 돌리기」) 그것을 고른 채로 연다.
function NewRun({ req, done }: { req: Req | null; done: () => void }) {
  const qc = useQueryClient();
  const engines = useQuery({ queryKey: ['workshop'], queryFn: () => get<{ engines: { id: string; name: string; nodes: number; kind: 'chain' | 'engine' | 'run'; broken: boolean; engine?: string }[] }>('/api/workshop') });
  const [open, setOpen] = useState(false), [test, setTest] = useState(false), [engine, setEngine] = useState(''), [input, setInput] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false), [branch, setBranch] = useState(''), [unattended, setUnattended] = useState(false), [testRun, setTestRun] = useState(false);
  // 고른 것의 작업 폴더 설정 — 늘 같은 폴더 · 새 워크트리면 폴더를 묻지 않는다
  type Def = { engine: { workdir?: Workdir; kind?: string; engine?: string; input?: string; unattended?: boolean } | null; picks?: string };
  const eq = useQuery({ queryKey: ['workshop', engine], queryFn: () => get<Def>(`/api/workshop/${engine}`), enabled: !!engine });
  // 런이면 작업 폴더가 없을 때 그 엔진 것(엔진에서 런으로 옮기는 동안)
  const tgt = eq.data?.engine?.kind === 'run' ? eq.data.engine.engine : undefined;
  const tq = useQuery({ queryKey: ['workshop', tgt], queryFn: () => get<Def>(`/api/workshop/${tgt}`), enabled: !!tgt });
  const all = engines.data?.engines ?? [], runs = all.filter(e => e.kind === 'run' && !e.broken).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const isRun = runs.some(r => r.id === engine), nameOf = (id?: string) => all.find(e => e.id === id)?.name ?? id ?? '';
  // 공방에서 온 주소 — 한 번 읽고 주소에서 뗀다
  useEffect(() => {
    const read = () => { const m = location.hash.match(/[?&](run|test)=([a-z0-9-]+)/); if (!m) return; setOpen(true); setEngine(m[2]); setTest(m[1] === 'test'); history.replaceState(null, '', '#/runs'); };
    read(); addEventListener('hashchange', read); return () => removeEventListener('hashchange', read);
  }, []);
  // 받은 요청이 엔진을 가리키고 그 엔진을 돌리는 런이 하나뿐이면 그 런으로
  useEffect(() => {
    if (!req || isRun) return;
    const wrap = runs.filter(r => r.engine === engine);
    if (wrap.length === 1) setEngine(wrap[0].id);
  }, [req, engine, isRun, runs]);
  // 무인 처음 값 — 런 설정대로(요청에서 연 것은 요청 값)
  const unattendedDefault = eq.data?.engine?.unattended;
  useEffect(() => { if (!req) setUnattended(!!unattendedDefault); }, [engine, unattendedDefault, req]);
  // 엔진이 주는 고르기 목록(actions.json on: "picks" — 예: 일감 목록) — 누를 때만 명령이 돈다
  // 고른 것(picked)은 입력을 고치지 않은 채 시작하면 그 제목 · 꼬리표를 런에 남긴다
  const [picks, setPicks] = useState<Pick[] | null>(null), [picking, setPicking] = useState(false), [picked, setPicked] = useState<Pick | null>(null);
  useEffect(() => { setPicks(null); setPicked(null); }, [engine]);
  const loadPicks = async () => {
    setPicking(true); setErr('');
    try { setPicks(await post<Pick[]>(`/api/workshop/${engine}/picks`, {})); } catch (e) { setErr((e as Error).message); }
    setPicking(false);
  };
  const wd: Workdir = eq.data?.engine?.workdir ?? tq.data?.engine?.workdir ?? { kind: 'ask' };
  const home = (p: string) => p.replace(/^\/(Users|home)\/[^/]+/, '~');
  const [cwd, setCwd] = useState(() => { try { return localStorage.getItem('edith.runs.cwd') ?? ''; } catch { return ''; } });
  useEffect(() => {
    if (!req) return;
    setOpen(true); setEngine(req.engine); setInput(req.input); setErr('');
    if (req.branch) setBranch(req.branch);
    setUnattended(!!req.unattended);
    if (req.cwd) setCwd(req.cwd);
  }, [req]);
  // 지금 열린 herdr 워크스페이스의 폴더 — 워크트리면 그 체크아웃, 아니면 첫 pane 의 폴더
  const herdr = useHerdr();
  const open_ = useMemo(() => {
    const d = herdr.data;
    if (!d) return [];
    const seen = new Set<string>();
    return d.workspaces.flatMap(w => {
      const dir = w.worktree?.checkout_path ?? d.panes.find(p => p.workspace === w.workspace_id)?.cwd;
      if (!dir || seen.has(dir) || w.label.startsWith('▶') || w.label.startsWith('런·') || w.label.startsWith('시험·')) return [];   // 런 워크스페이스(옛 「▶」 · 새 「런·」 · 시험 런 「시험·」)
      seen.add(dir);
      return [{ label: w.label, dir }];
    });
  }, [herdr.data]);
  const go = async () => {
    setBusy(true);
    try {
      const pick = !req && picked?.input === input ? { pick: { title: picked.title ?? picked.label, tag: picked.tag } } : {};
      const r = await post<{ id: number }>('/api/runs', { engine, cwd: cwd.trim(), input, branch: branch.trim(), unattended, test: testRun, ...(req ? { request: req.id } : {}), ...pick });
      if (wd.kind === 'ask') try { localStorage.setItem('edith.runs.cwd', cwd.trim()); } catch { /* 저장 안 됨 */ }
      setBranch(''); setUnattended(false); setTestRun(false); setPicked(null);
      await qc.invalidateQueries({ queryKey: ['runs'] });
      setOpen(false); setInput(''); setErr(''); done();
      void qc.invalidateQueries({ queryKey: ['requests'] });
      location.hash = `#/runs/${r.id}`;
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  // 첨부 경로는 입력 끝에(빈칸 든 경로는 따옴표)
  const addPaths = (ps: string[]) => setInput(v => [v.trimEnd(), ...ps.map(x => x.includes(' ') ? `"${x}"` : x)].filter(Boolean).join(' '));
  const field = 'w-full rounded-md border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/50';
  const fields = (
    <>
          {wd.kind === 'fixed' && <p className="text-xs break-all text-muted-foreground">작업 폴더 <span className="font-mono text-foreground">{home(wd.dir)}</span> — 공방 설정</p>}
          {wd.kind === 'worktree' && (
            <div className="space-y-1 text-xs text-muted-foreground">
              <p className="break-all">새 워크트리 — 레포 <span className="font-mono text-foreground">{home(wd.repo)}</span>{wd.base && <> · 기준 <span className="font-mono text-foreground">{wd.base}</span></>} (공방 설정)</p>
              <label className="block">브랜치 이름<input value={branch} onChange={e => setBranch(e.target.value)} placeholder="9472-confirm" className={`mt-0.5 font-mono text-xs ${field}`} /></label>
            </div>
          )}
          {wd.kind === 'ask' && <div className="space-y-1 text-xs text-muted-foreground">
            <span>작업 폴더 — Claude 가 일하고 명령이 도는 곳</span>
            {open_.length > 0 && (
              <select value="" onChange={e => e.target.value && setCwd(e.target.value)} className={`${field} text-xs`} aria-label="열린 워크스페이스 폴더에서 고르기">
                <option value="">열린 워크스페이스에서 고르기…</option>
                {open_.map(o => <option key={o.dir} value={o.dir}>{o.label} — {o.dir.replace(/^\/(Users|home)\/[^/]+/, '~')}</option>)}
              </select>
            )}
            <FolderInput value={cwd} onChange={setCwd} placeholder="~/develop/project/app  (치면 하위 폴더 추천 · Tab)" className={`font-mono text-xs ${field}`} />
          </div>}
          {eq.data?.picks && (picks
            ? <select value="" onChange={e => { const p = picks[Number(e.target.value)]; if (p) { setInput(p.input); setPicked(p); } }} className={`${field} text-xs`} aria-label={eq.data.picks}>
                <option value="">{picks.length ? `${eq.data.picks} — ${picks.length}개` : `${eq.data.picks} — 없다`}</option>
                {picks.map((p, i) => <option key={i} value={i}>{p.label}{p.note ? ` · ${p.note}` : ''}</option>)}
              </select>
            : <Button type="button" size="sm" variant="outline" className="h-7 w-full text-xs" disabled={picking} onClick={() => void loadPicks()}>{picking ? '불러오는 중…' : eq.data.picks}</Button>)}
          <label className="block text-xs text-muted-foreground">입력 — {eq.data?.engine?.input ?? '모든 노드에 같이 간다(예: 기획서 링크)'}
            <textarea value={input} onChange={e => setInput(e.target.value)} rows={3} className={`mt-0.5 resize-y ${field}`}
              onPaste={e => { const f = [...e.clipboardData.files]; if (!f.length) return; e.preventDefault(); upload(f).then(addPaths, (x: Error) => setErr(`올리지 못했다 — ${x.message}`)); }} /></label>
          <div className="flex items-center gap-1.5"><Attach onPaths={addPaths} /><span className="text-[0.6875rem] text-muted-foreground">파일을 올리면 그 경로가 입력 끝에 붙는다(붙여넣기도)</span></div>
          {/* 무인 — 기본 꺼짐. 켜면 확인 필요를 사람에게 넘기지 않고 다시 돌리거나 건너뛴다(엔진도 run.json · $EDITH_UNATTENDED 로 안다) */}
          <label className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={unattended} onChange={e => setUnattended(e.target.checked)} className="mt-0.5" />
            <span><span className="font-medium text-foreground">무인 — 사람 없이 끝까지</span> · 확인 필요가 되면 2번까지 다시 돌리고, 그래도 안 되면 건너뛰고 이어 간다. 권한 승인 화면은 그대로 기다린다</span>
          </label>
          {/* 시험 런 — 번호를 따로 센다(시험 #1 · 워크스페이스 「시험·」). 엔진도 run.json · $EDITH_TEST 로 안다 */}
          <label className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={testRun} onChange={e => setTestRun(e.target.checked)} className="mt-0.5" />
            <span><span className="font-medium text-foreground">시험 런</span> · 번호를 따로 센다(「시험 #1」). 진짜 런 번호는 그대로 이어진다</span>
          </label>
          {err && <p className="text-xs break-words text-destructive">{err}</p>}
          <Button type="submit" size="sm" className="h-7 w-full text-xs" disabled={busy || !engine || (wd.kind === 'ask' && !cwd.trim()) || (wd.kind === 'worktree' && !branch.trim())}>{busy ? '시작하는 중…' : '런 시작'}</Button>
          <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">{wd.kind === 'worktree' ? '레포에서 그 브랜치로 워크트리와 워크스페이스를 만들고' : 'herdr 에 「런·이름 #번호」 워크스페이스를 만들고 작업 폴더에서'} Claude 를 띄워 노드를 하나씩 보낸다. 시작할 때의 사본으로 돈다(공방에서 고쳐도 이 런은 그대로).</p>
    </>
  );
  return (
    <>
      <button onClick={() => setOpen(v => !v)} className="mb-1 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[0.8125rem] font-medium hover:bg-muted/70">
        <Icon className="size-3.5">{PLAY}</Icon>새 런
      </button>
      {open && (
        <form onSubmit={e => { e.preventDefault(); void go(); }} className="mb-2 space-y-1.5 rounded-lg border bg-card p-2">
          {req && <p className="flex items-center gap-1 text-xs text-sky-700 dark:text-sky-400"><span className="min-w-0 flex-1 truncate">요청 {req.from ?? req.id} 에서 — 시작하면 요청에 런 번호로 답한다</span>
            <button type="button" className="shrink-0 underline-offset-2 hover:underline" onClick={done}>떼기</button></p>}
          {runs.map(r => r.id === engine
            ? <div key={r.id} className="space-y-1.5 rounded-lg border-2 border-primary bg-card p-2">
                <button type="button" onClick={() => setEngine('')} className="flex w-full items-baseline gap-1.5 text-left" aria-expanded="true">
                  <span className="text-sm font-semibold">{r.name}</span><span className="ml-auto truncate text-[0.6875rem] text-muted-foreground">엔진 {nameOf(r.engine)}</span>
                </button>
                {fields}
              </div>
            : <button key={r.id} type="button" onClick={() => { setEngine(r.id); setTest(false); }} aria-expanded="false"
                className="flex w-full items-baseline gap-1.5 rounded-lg border bg-card px-2.5 py-2 text-left hover:border-primary/50">
                <span className="text-sm font-semibold">{r.name}</span><span className="ml-auto truncate text-[0.6875rem] text-muted-foreground">엔진 {nameOf(r.engine)}</span>
              </button>)}
          {engines.data && !runs.length && <p className="px-1 text-xs text-muted-foreground">공방에 런이 없다 — 공방 「+ 새 런」 에서 엔진을 골라 만든다</p>}
          {/* 엔진 · 체인 바로 시험 — 런 없이 그 엔진 설정으로(체인 하나만 돌려 볼 때) */}
          <details open={test} onToggle={e => setTest(e.currentTarget.open)} className="rounded-lg border border-dashed bg-card/60 p-2">
            <summary className="cursor-pointer text-xs text-muted-foreground">엔진 · 체인 바로 시험</summary>
            <div className="mt-1.5 space-y-1.5">
              <select value={isRun ? '' : engine} onChange={e => setEngine(e.target.value)} aria-label="시험으로 돌릴 엔진 · 체인" className={field}>
                <option value="">고르기</option>
                {all.filter(e => e.kind !== 'run' && !e.broken).sort((a, b) => Number(b.kind === 'engine') - Number(a.kind === 'engine'))
                  .map(e => <option key={e.id} value={e.id}>{e.name} ({KIND[e.kind as 'chain' | 'engine']} · {e.id})</option>)}
              </select>
              {engine && !isRun && fields}
            </div>
          </details>
</form>
      )}
    </>
  );
}

type View = 'board' | 'summary' | 'timeline' | 'canvas' | 'stats';
const VIEWS: [View, string][] = [['board', '결과물'], ['summary', '요약'], ['timeline', '타임라인'], ['canvas', '캔버스'], ['stats', '분석']];

function RunDetail({ r, out }: { r: Run; out?: number }) {
  const qc = useQueryClient();
  const [sel, setSel] = useState<string | null>(null), [busy, setBusy] = useState(false), [armed, setArmed] = useState(''), [view, setView] = useState<View>('board'), [watch, setWatch] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(''), 3000); return () => clearTimeout(t); }, [armed]);
  useActedToast(r);
  // 런을 바꾸면 「결과물」 부터 — 런 화면에서 가장 자주 여는 것이 흐름도 · ERD · 가이드 재생이라(2026-11-11 정함). 진행 · 요약은 옆 보기로
  const hasSummary = !!r.summary;
  useEffect(() => { setView('board'); }, [r.id]);
  const act = async (what: 'stop' | 'resume' | 'skip' | 'rewind', key?: string) => {
    setBusy(true);
    try { await post(`/api/runs/${r.id}/${what}`, key ? { key } : {}); await qc.invalidateQueries({ queryKey: ['run', r.id] }); await qc.invalidateQueries({ queryKey: ['runs'] }); }
    catch (e) { toast(`하지 못했다 — ${(e as Error).message}`, 5000); }
    setBusy(false);
  };
  // 끝난 런의 워크스페이스가 아직 열려 있으면 「워크스페이스 닫기」 — 배포 「정리」 로 이어지지 않는 런도 치우게(src/cleanup.ts closeRunSpaces)
  const herdr = useHerdr(), mine = [r.pane, ...Object.values(r.panes ?? {}).map(o => o.pane)];
  const spacesOpen = ended(r.state) && !!herdr.data?.panes.some(p => mine.includes(p.id));
  const closeSpaces = async () => {
    setBusy(true);
    try {
      const v = await post<{ closed: string[]; kept: string[]; errs: string[] }>(`/api/runs/${r.id}/spaces`, {});
      toast([v.closed.length ? `닫음 ${v.closed.join(' · ')}` : '닫을 워크스페이스가 없다', ...v.kept.map(k => `남김 ${k}`), ...v.errs.map(e => `못 닫음 ${e}`)].join('\n'), 6000);
    } catch (e) { toast(`하지 못했다 — ${(e as Error).message}`, 5000); }
    setBusy(false);
  };
  const live = r.steps.filter(s => !s.fixOnly), done = live.filter(s => ['done', 'skipped'].includes(r.nodes[s.key].state)).length;
  const s = r.steps.find(x => x.key === sel), [first, ...more] = r.input.split('\n'), notion = notionUrl(r.input);
  const detail = (bare = false) => s ? <NodeDetail r={r} s={s} busy={busy} armed={armed} arm={setArmed} act={act} bare={bare} /> : null;
  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="min-w-0"><div className="text-xs text-muted-foreground tabular-nums">{runNo(r.id)} {r.name}</div>
          <h1 className="text-lg font-bold">{r.tag && <span className="mr-2 font-mono text-base text-primary">{r.tag}</span>}{r.agenda && <span className="mr-2 text-muted-foreground">[{r.agenda}]</span>}{r.title ?? r.name}</h1></div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${RUN_TONE[r.state]}`}>{RUN_LABEL[r.state]}</span>
        {r.unattended && <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground" title="확인 필요를 사람에게 넘기지 않고 다시 돌리거나 건너뛴다">무인</span>}
        <span className="text-sm text-muted-foreground tabular-nums">{done}/{live.length}</span>
        <span className="h-1.5 w-28 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-emerald-500" style={{ width: `${live.length ? done / live.length * 100 : 0}%` }} /></span>
        {!ended(r.state) && <span className="text-xs text-muted-foreground tabular-nums">{dur(Date.now() - r.created)}째</span>}
        <span className="ml-auto flex flex-wrap gap-1.5">
          {notion && (
            <a href={notion} target="_blank" rel="noreferrer" title={`노션에서 열기 — ${notion}`}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[#e2d5bf] bg-[#f5eee2] px-2.5 text-xs font-medium text-[#5b4a33] hover:bg-[#ece2d1] dark:border-[#5a4c3b] dark:bg-[#3b3328] dark:text-[#eadfcb] dark:hover:bg-[#463c2f]">
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5 shrink-0" aria-hidden><path d={NOTION} /></svg>노션
            </a>
          )}
          <span role="group" aria-label="보기" className="flex rounded-md border bg-card p-0.5">
            {VIEWS.filter(([v]) => v !== 'summary' || hasSummary).map(([v, label]) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
                className={`rounded px-2.5 py-1 text-xs ${view === v ? 'bg-primary font-semibold text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{label}</button>
            ))}
          </span>
          {r.live && <Button size="sm" variant={watch ? 'default' : 'outline'} className="h-7 text-xs" aria-pressed={watch} onClick={() => setWatch(!watch)}>브라우저 화면</Button>}
          {spacesOpen && <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => void closeSpaces()}
            title="이 런이 연 herdr 워크스페이스를 닫는다 — 런 기록 · 산출물은 남는다. 런 밖 pane 이 섞였거나 일하는 중이면 남긴다">워크스페이스 닫기</Button>}
          {r.state === 'running' && <Button size="sm" variant="outline" className="h-7 text-xs text-destructive" disabled={busy} onClick={() => void act('stop')}>멈춤</Button>}
          {(r.state === 'check' || r.state === 'stopped') && <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void act('resume')}>이어서</Button>}
          {r.state === 'queued' && <>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => void act('stop')}>줄에서 빼기</Button>
            <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void act('resume')} title="동시 런 한도를 넘어 지금 시작한다">지금 시작</Button>
          </>}
        </span>
      </div>
      {view !== 'board' && <><Phases r={r} />
      <details className="rounded-lg border bg-card px-3 py-2 text-sm">
        <summary className="cursor-pointer"><span className="mr-2 text-xs font-semibold text-muted-foreground">{r.input ? '입력' : '정보'}</span>
          {/^https?:\/\/\S+$/.test(first) ? <a href={first} target="_blank" rel="noreferrer" className="break-all text-primary underline-offset-2 hover:underline">{first.replace(/^https?:\/\//, '')}</a> : first}
          {more.length > 0 && <span className="text-muted-foreground"> 외 {more.length}줄</span>}</summary>
        {more.length > 0 && <p className="mt-1.5 whitespace-pre-wrap">{more.join('\n')}</p>}
        <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>공방 <span className="font-mono text-foreground">{r.engine}/</span></span>
          <span>작업 폴더 <span className="font-mono text-foreground">{r.cwd}</span></span>
          {r.branch && <span>브랜치 <span className="font-mono text-foreground">{r.branch}</span></span>}
          <span>시작 {when(r.created)}</span>
          <span title={r.dir}>런 폴더 <span className="font-mono">{r.dir.replace(/^\/(Users|home)\/[^/]+/, '~')}</span></span>
        </p>
      </details></>}
      {r.state === 'queued' && (
        <p className="rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-sm text-violet-800 dark:text-violet-300">
          줄 서 있다 — 동시에 도는 런이 한도(설정 「런」)에 찼다. 도는 런이 끝나면 먼저 온 것부터 시작한다. 「지금 시작」 은 한도를 넘어 바로 시작한다.
        </p>
      )}
      {r.state === 'dropped' && (
        <p className="rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground">버린 런 — {r.reason ?? '버림'}. 기록만 남아 이어서 · 단추 · 노드 조작을 쓸 수 없다.</p>
      )}
      {(r.state === 'check' || r.state === 'stopped') && r.reason && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">{r.reason}</p>
      )}
      {/* 사용량 한도로 기다리는 노드 — 다시 찰 시각에 같은 대화로 이어 간다 */}
      {r.steps.map(x => r.nodes[x.key]).filter(x => x.wake).map((x, i) => (
        <p key={i} className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">{x.reason}</p>
      ))}
      {/* 무인 런이 건너뛴 노드 — 사람이 나중에 볼 것 */}
      {r.unattended && r.steps.some(x => r.nodes[x.key].state === 'skipped' && r.nodes[x.key].reason?.startsWith('무인')) && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <p className="text-xs font-semibold">무인 런이 건너뛴 노드</p>
          {r.steps.filter(x => r.nodes[x.key].state === 'skipped' && r.nodes[x.key].reason?.startsWith('무인')).map(x => (
            <button key={x.key} type="button" onClick={() => setSel(x.key)} className="block text-left hover:underline">{x.title} — {r.nodes[x.key].reason!.replace(/^무인 — /, '')}</button>
          ))}
        </div>
      )}
      {view !== 'board' && <Waiting r={r} />}
      {out !== undefined && <OutputSheet id={r.id} i={out} onClose={() => { location.hash = `#/runs/${r.id}`; }} />}
      {view !== 'summary' && view !== 'board' && <>
        <RepoOutputs id={r.id} />
        {r.actions.length > 0 && r.state !== 'dropped' && <Actions r={r} />}
      </>}
      {r.live && watch && <Live id={r.id} />}
      {view === 'board' ? <Board key={r.id} r={r} />
        : view === 'summary' && r.summary ? <SummaryView r={r} s={r.summary} toTimeline={() => setView('timeline')} />
        : view === 'stats' ? <Analysis id={r.id} sel={sel} pick={k => setSel(k === sel ? null : k)} detail={() => detail(false)} />
        : view === 'canvas' ? <>
          <RunFlow steps={r.steps} nodes={r.nodes} timeline={r.timeline ?? []} sel={sel} onPick={k => setSel(k === sel ? null : k)} />
          {detail() ?? <p className="text-xs text-muted-foreground">노드를 누르면 결과 요약 · 보낸 글 · 명령 출력을 본다. 고치는 노드(↳)는 불린 뒤에만 보인다.</p>}
        </>
        : <RunTimeline r={r} sel={sel} pick={k => setSel(k === sel ? null : k)} detail={detail} />}
    </div>
  );
}

// 끝난 런 요약(엔진이 남긴 edith-summary.json). 위에서부터 한 일 → 이제 할 일(처음 안 끝난 단계가 「지금」 — 그 단계의 런 단추만 켜진다, 레포 상태가 아래에)
// → 확인할 것(엔진이 사람 대신 정했거나 확인하지 못한 것) → 주요 산출물(요약이 고른 것, 나머지는 「모두」) → 나머지 런 단추 → 타임라인으로
function SummaryView({ r, s, toTimeline }: { r: Run; s: Summary; toTimeline: () => void }) {
  const qc = useQueryClient(), [busy, setBusy] = useState(false), outs = useOutputs(r.id).data ?? [];
  const now = s.next.findIndex(x => !x.done), all = outs.map((o, i): [OutputItem, number] => [o, i]), key = all.filter(([o]) => s.outputs.includes(o.label));
  const running = runningOf(r), lastOf = (label: string) => r.acted.find(a => a.label === label);   // acted 는 최근 것부터
  const press = async (label: string) => {
    const n = r.actions.findIndex(a => a.label === label);
    setBusy(true);
    try { await pressAction(qc, r.id, n, ''); }
    catch (e) { toast(`하지 못했다 — ${(e as Error).message}`, 5000); }
    setBusy(false);
  };
  return (
    <div className="space-y-3">
      <section className="space-y-2 rounded-xl border border-emerald-500/40 bg-emerald-500/5 px-4 py-3.5" aria-label="이 런이 한 일">
        <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400">✓ 끝 — 이 런이 한 일</p>
        {s.title && <h2 className="text-lg font-bold">{s.title}</h2>}
        <ul className="list-disc space-y-0.5 pl-5 text-sm">{s.did.map((x, i) => <li key={i}>{x}</li>)}</ul>
        {s.chips.length > 0 && <p className="flex flex-wrap gap-1.5">{s.chips.map(c => <span key={c} className="rounded-full border bg-card px-2.5 py-0.5 text-xs">{c}</span>)}</p>}
      </section>
      {s.next.length > 0 && (
        <section className="space-y-2.5 rounded-xl border bg-card px-4 py-3.5" aria-label="이제 할 일">
          <h2 className="text-sm font-bold">이제 할 일</h2>
          <ol className="grid gap-2 md:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
            {s.next.map((x, i) => {
              const a = x.action ? r.actions.find(y => y.label === x.action) : undefined, on = i === now;
              return (
                <li key={i} className={`flex flex-col gap-1.5 rounded-lg p-3 ${on ? 'border-2 border-primary bg-primary/5' : 'border'} ${x.done ? 'opacity-70' : ''}`}>
                  <span className="text-xs font-semibold text-muted-foreground">{x.done ? '✓ 끝' : on ? `${i + 1} · 지금` : `${i + 1}`}</span>
                  <strong className="text-sm">{x.label}</strong>
                  {x.note && <span className="text-xs text-muted-foreground">{x.note}</span>}
                  {a && <Button size="sm" variant={on ? 'default' : 'outline'} className="mt-auto h-7 self-start text-xs" disabled={!on || busy || !!a.ask || !!running} aria-busy={running?.label === a.label || undefined}
                    title={a.ask ? '글을 받는 단추 — 아래 「런 단추」 줄에서' : a.hint} onClick={() => void press(a.label)}>{running?.label === a.label ? `${a.label} — 도는 중 · ${secs(running.at)}` : a.label}</Button>}
                  {/* 마지막으로 누른 결과 — 끝났는지 그 자리에서(출력은 아래 「최근 단추」) */}
                  {a && (() => { const l = lastOf(a.label); return l && l.code !== null && <span className={`text-xs ${l.code === 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}`}>{l.code === 0 ? '✓' : '✗'} {when(l.at)} {l.code === 0 ? '끝' : `끝 코드 ${l.code}`}{l.note ? ` · ${l.note}` : ''}</span>; })()}
                </li>
              );
            })}
          </ol>
          <Repos id={r.id} />
        </section>
      )}
      {s.check.length > 0 && (
        <section className="space-y-2.5 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3.5" aria-label="확인할 것">
          <h2 className="text-sm font-bold">확인할 것 <span className="text-xs font-normal text-amber-800 dark:text-amber-300">— 엔진이 사람 대신 정했거나 확인하지 못한 것</span></h2>
          {s.check.map(g => (
            <div key={g.title}>
              <p className="text-sm font-semibold">{g.title}{g.note && <span className="ml-2 text-xs font-normal text-muted-foreground">{g.note}</span>}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">{g.items.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          ))}
        </section>
      )}
      {all.length > 0 && (
        <section className="space-y-2 rounded-xl border bg-card px-4 py-3.5" aria-label="산출물">
          <h2 className="text-sm font-bold">산출물</h2>
          <OutputChips id={r.id} items={key.length ? key : all} />
          {key.length > 0 && key.length < all.length && (
            <details><summary className="cursor-pointer text-xs text-muted-foreground">모두 {all.length}</summary><div className="mt-1.5"><OutputChips id={r.id} items={all} /></div></details>
          )}
        </section>
      )}
      {r.actions.length > 0 && r.state !== 'dropped' && <Actions r={r} />}
      <button type="button" onClick={toTimeline} className="flex w-full items-center gap-2 rounded-xl border bg-card px-4 py-2.5 text-left text-sm hover:border-primary/60">
        <span className="font-semibold">지나온 길</span><span className="text-xs text-muted-foreground">체인마다 걸린 시간 · 고친 것 · 건너뛴 것</span><span className="ml-auto text-xs font-semibold text-primary">타임라인으로 ›</span>
      </button>
    </div>
  );
}

// 큰 단계 — 맨 위 엔진에 놓인 체인 · 엔진(펼친 상자 맨 바깥)마다 한 칸(runFlow.ts phases). 도는 것(파랑) · 확인 필요(주황)만 색 칩에 끝난 수,
// 끝난 단계는 ✓ 글자만 흐리게, 노드 반 이상을 건너뛴 단계는 줄 그어. 이름이 모두 같은 낱말(엔진 이름)로 시작하면 떼고 — 전체 이름 · 수는 마우스를 올리면
function Phases({ r }: { r: Run }) {
  const ps = phases(r.steps).filter(p => p.keys.length);
  if (ps.length < 2) return null;
  const cut = dropShared(ps.map(p => p.name));
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {ps.map(p => {
        const st = p.keys.map(k => r.nodes[k].state), done = st.filter(x => x === 'done').length, skip = st.filter(x => x === 'skipped').length;
        const live = st.some(x => x === 'running' || x === 'sending' || x === 'blocked'), name = cut(p.name);
        // 갈래 이름은 단계 이름에 없을 때만 앞에(「BE 계획」 에 be 는 군더더기)
        const label = <>{p.track && !name.toLowerCase().includes(p.track.toLowerCase()) && <span className="mr-1 font-mono opacity-75">{p.track}</span>}{name}</>;
        const tip = `${p.name} — 노드 ${st.length}개 · 끝 ${done} · 건너뜀 ${skip}`;
        if (live || st.includes('check')) return <span key={p.id} title={tip} className={`rounded-full px-2 py-0.5 font-semibold tabular-nums ${live ? 'bg-sky-500/15 text-sky-800 dark:text-sky-300' : 'bg-amber-500/15 text-amber-800 dark:text-amber-300'}`}>{label} {done + skip}/{st.length}</span>;
        if (done + skip < st.length) return <span key={p.id} title={tip} className="text-muted-foreground/70 tabular-nums">{label}{done + skip ? ` ${done + skip}/${st.length}` : ''}</span>;
        return skip >= done ? <span key={p.id} title={`${tip} — 거의 건너뜀`} className="text-muted-foreground/60 line-through">{label}</span>
          : <span key={p.id} title={tip} className="text-muted-foreground"><span className="mr-0.5 text-emerald-600 dark:text-emerald-400">✓</span>{label}</span>;
      })}
    </p>
  );
}

// 브라우저 화면 — 런이 띄운 브라우저(엔진이 남긴 edith-live.json)의 화면을 서버가 MJPEG 로 넘긴다(src/live.ts). 못 붙으면 「다시 붙기」
function Live({ id }: { id: number }) {
  const [n, setN] = useState(0), [gone, setGone] = useState(false);
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      {gone
        ? <p className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm text-muted-foreground">화면을 받지 못했다 — 브라우저가 아직 없거나 닫혔다.
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setGone(false); setN(n + 1); }}>다시 붙기</Button></p>
        : <img key={n} src={`/api/runs/${id}/live?n=${n}`} alt="런이 띄운 브라우저 화면" className="mx-auto block max-h-[70vh] w-auto" onError={() => setGone(true)} />}
    </section>
  );
}

// 레포 — 엔진이 작업 문서에 남긴 edith-repos.json 의 레포마다 커밋 상태(서버가 git 으로 읽는다 — src/repos.ts). 커밋 · 정리는 엔진의 런 단추로
type Repo = { name: string; path: string; branch?: string; base: string; error?: string; head?: string; dirty?: number; ahead?: number; pushed?: boolean | null; fresh?: boolean; more?: { base: string; ahead: number | null }[] };
const useRepos = (id: number) => useQuery({ queryKey: ['run-repos', id], queryFn: () => get<Repo[]>(`/api/runs/${id}/repos`), refetchInterval: 15_000 });
// bare — 「레포 · 산출물」 줄 안에(테두리 없이)
function Repos({ id, bare }: { id: number; bare?: boolean }) {
  const q = useRepos(id);
  const [diff, setDiff] = useState<number | null>(null);
  const d = useQuery({ queryKey: ['run-repo-diff', id, diff], queryFn: () => get<{ name: string; from: string; text: string }>(`/api/runs/${id}/repos/${diff}/diff`), enabled: diff !== null });
  if (!q.data?.length) return null;
  const chip = 'rounded-full px-2 py-px text-[0.6875rem] font-semibold';
  return (
    <section className={bare ? 'min-w-0' : 'rounded-lg border bg-card px-3 py-2 text-sm'}>
      <p className="mb-1 text-xs font-semibold text-muted-foreground">레포 — 커밋 상태(15초마다 git 에서 읽는다)</p>
      <ul className="space-y-1">
        {q.data.map((x, i) => (
          // 브랜치는 엔진이 정한 것과 다를 때만 글로(같으면 마우스를 올리면)
          <li key={x.path} title={x.head ? `${x.path}\n${x.head}` : x.path} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold">{x.name}</span>
            {x.head && x.branch && x.branch !== x.head && <span className="font-mono text-xs text-amber-700 dark:text-amber-400">{x.head} (엔진은 {x.branch})</span>}
            {x.error ? <span className={`${chip} bg-rose-500/15 text-rose-700 dark:text-rose-300`}>{x.error}</span> : <>
              <span className={`${chip} ${x.dirty ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300' : 'bg-muted text-muted-foreground'}`}>{x.dirty ? `커밋 안 한 파일 ${x.dirty}` : '커밋할 것 없음'}</span>
              {x.fresh ? <span className={`${chip} bg-muted text-muted-foreground`} title="워크트리를 딴 뒤 커밋이 없다">커밋 없음</span> : x.ahead !== undefined && (x.ahead > 0
                ? <span className={`${chip} bg-muted text-muted-foreground`}>{x.base} 에 없는 커밋 {x.ahead}</span>
                : <span className={`${chip} bg-emerald-500/15 text-emerald-700 dark:text-emerald-400`}>{x.base} 에 다 들어 있음</span>)}
              {!x.fresh && x.more?.map(m => {
                const b = m.base.replace(/^origin\//, '');
                return m.ahead === null ? <span key={m.base} className={`${chip} bg-muted text-muted-foreground`} title={`${m.base} 을 찾지 못했다(fetch 전?)`}>{b} ?</span>
                  : m.ahead === 0 ? <span key={m.base} className={`${chip} bg-emerald-500/15 text-emerald-700 dark:text-emerald-400`}>✓ {b} 반영됨</span>
                  : <span key={m.base} className={`${chip} bg-sky-500/10 text-sky-800 dark:text-sky-300`}>{b} 에 없는 커밋 {m.ahead}</span>;
              })}
              <span className={`${chip} ${x.pushed ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>{x.pushed === null ? '아직 안 올림' : x.pushed ? '올림' : '안 올린 커밋 있음'}</span>
              <button type="button" onClick={() => setDiff(i)} className="ml-auto text-xs font-semibold text-primary hover:underline">변경 보기</button>
            </>}
          </li>
        ))}
      </ul>
      {diff !== null && (
        <Sheet title={`변경 — ${q.data[diff]?.name ?? ''}`} sub={d.data ? `${d.data.from} 부터 지금 작업 트리까지(커밋한 것 + 안 한 것 + 새 파일)` : undefined} onClose={() => setDiff(null)}>
          {d.isLoading ? <Empty>읽는 중…</Empty> : d.error ? <Empty>{(d.error as Error).message}</Empty> : d.data && <DiffView text={d.data.text} scope={`run-${id}-repo-${diff}`} />}
        </Sheet>
      )}
    </section>
  );
}

// 보기 창 — 산출물 글 · 레포 변경을 화면 위에(브라우저 dialog — Esc · 바깥 누르기로 닫힌다)
// extra — 닫기 앞 머리줄 단추, band — 머리줄 아래 띠(산출물 단추 OutputAct.tsx)
function Sheet({ title, sub, onClose, children, extra, band }: { title: string; sub?: string; onClose: () => void; children: ReactNode; extra?: ReactNode; band?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; d?.showModal(); return () => d?.close(); }, []);
  return (
    <dialog ref={ref} onClose={onClose} onClick={e => { if (e.target === ref.current) onClose(); }} aria-label={title}
      className="m-auto w-[min(64rem,94vw)] max-w-none rounded-xl border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/40">
      <div className="flex items-center gap-3 border-b px-4 py-2.5">
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{title}</span>{sub && <span className="block truncate font-mono text-xs text-muted-foreground">{sub}</span>}</span>
        {extra}
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onClose}>닫기</Button>
      </div>
      {band}
      <div className="max-h-[80vh] overflow-auto px-4 py-3">{children}</div>
    </dialog>
  );
}

// 산출물 — 엔진이 작업 문서에 남긴 edith-outputs.json(서버 src/outputs.ts). 파일은 누르면 보기 창(.md 는 글로, .html · .svg 는 그림으로), 주소는 새 탭
type OutputItem = { label: string; path?: string; url?: string; node?: string; note?: string; group?: string; fold?: string; board?: boolean; error?: string };
type OutputOne = { label: string; path: string; text: string; act?: { label: string; hint?: string } };
const useOutputs = (id: number) => useQuery({ queryKey: ['run-outputs', id], queryFn: () => get<OutputItem[]>(`/api/runs/${id}/outputs`), refetchInterval: 15_000 });
const useOutput = (id: number, i: number, on = true) => useQuery({ queryKey: ['run-output', id, i], queryFn: () => get<OutputOne>(`/api/runs/${id}/outputs/${i}`), enabled: on });
// 엔진이 적은 묶음(group)마다 — 묶음이 없으면 한 덩이로. items 는 전체 목록 차례를 단 것
function Outputs({ id, items }: { id: number; items: [OutputItem, number][] }) {
  if (!items.length) return null;
  const gs = groupOutputs(items);
  return (
    <section className="min-w-0">
      <p className="mb-1 text-xs font-semibold text-muted-foreground">산출물 {items.length} — 엔진이 남긴 문서 · 주소(누르면 본다, 파일 이름은 마우스를 올리면)</p>
      <div className={gs.length > 1 ? 'grid gap-x-4 gap-y-2.5 sm:grid-cols-2' : ''}>
        {gs.map(g => (
          <div key={g.name} className="min-w-0 space-y-1">
            {g.name && <p className="text-[0.6875rem] font-semibold text-muted-foreground">{g.name} {groupSize(g)}</p>}
            <OutputChips id={id} items={g.items} folds={g.folds} />
          </div>
        ))}
      </div>
    </section>
  );
}
// 레포 · 산출물 — 자주 보지 않아 「입력」 줄처럼 한 줄로 접어 둔다(펼치면 왼쪽 레포 · 오른쪽 산출물). 접혀도 레포 문제 · 커밋 안 한 파일은 색으로
function RepoOutputs({ id }: { id: number }) {
  const repos = useRepos(id).data ?? [], outs = useOutputs(id).data ?? [];
  if (!repos.length && !outs.length) return null;
  const dirty = repos.reduce((n, x) => n + (x.dirty ?? 0), 0), bad = repos.filter(x => x.error).length;
  const count = [repos.length ? `레포 ${repos.length}` : '', outs.length ? `산출물 ${outs.length}` : ''].filter(Boolean).join(' · ');
  return (
    <details className="rounded-lg border bg-card px-3 py-2 text-sm">
      <summary className="cursor-pointer"><span className="mr-2 text-xs font-semibold text-muted-foreground">레포 · 산출물</span>
        {bad > 0 && <span className="font-semibold text-rose-700 dark:text-rose-300">레포 확인 필요 {bad} · </span>}
        {dirty > 0 && <span className="font-semibold text-amber-700 dark:text-amber-400">커밋 안 한 파일 {dirty} · </span>}
        <span className="text-muted-foreground">{count}</span></summary>
      <div className={`mt-2 grid gap-4 ${repos.length && outs.length ? 'md:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]' : ''}`}><Repos id={id} bare /><Outputs id={id} items={outs.map((o, i) => [o, i])} /></div>
    </details>
  );
}
// 결과물 판 — 런 화면 기본 보기. 큰 단계(runFlow phases) 차례로 한 줄씩 — 머리(✓ 끝 · ● 지금 · ○ 남음 · 건너뜀, 걸린 시간), 그 단계가 만든 산출물 중
// 판에 올린 것(board — 흐름도 · ERD · 가이드 · 기획 · 계획)은 미리 보기 카드, 나머지는 줄마다 「그 밖 산출물」 에 접는다. 도는 런 · 끝난 런이 같은 꼴이라
// 같은 것은 늘 같은 자리에 있다(2026-11-11 정함 — 진행 중 · 끝을 같은 꼴로). 갈래가 갈리는 곳은 갈래마다 칸을 나란히(columns — 같은 차례끼리 한 줄), 모두 건너뛴 갈래는 아래 한 줄로.
// 스크롤이 길어 지금 단계와 그 바로 앞만 펼치고(foldOf), 그보다 앞 끝난 단계는 맨 위 「끝난 단계 n개」 덱에, 나머지 줄은 이름 칩으로 접는다(같은 날 — 시안 5차 L)
function Board({ r }: { r: Run }) {
  const q = useOutputs(r.id), [view, setView] = useState<{ i: number; band: boolean } | null>(null), [fold, setFold] = useFold(r.id);
  const outs = q.data ?? [], ps = useMemo(() => phases(r.steps).filter(p => p.keys.length), [r.steps]), cols = useMemo(() => columns(ps), [ps]);
  const at = stageOf(ps, outs.map(o => o.node)), cut = dropShared(ps.map(p => p.name));
  // 답 기다리는 노드와 바로 앞 노드가 만든 것 — 그 카드에 「답하기 전에 볼 것」
  const blocked = r.steps.filter(s => r.nodes[s.key].state === 'blocked'), ask = new Set(outs.flatMap((o, i) => o.node && blocked.some(s => [s.key, ...s.deps].includes(o.node!)) ? [i] : []));
  const stOf = (p: Phase) => phaseSt(r, p), idle = (p: Phase) => idleOf(r, p);
  const { open: open0, deck } = foldOf(cols, p => stOf(p) === 'live', idle);
  const isOpen = (p: Phase) => fold.rows[p.id] ?? open0.has(p.id);
  // 덱에 넣는 것 — 덱 칸 중 돈 단계(건너뜀 · 아직 안 돈 단계는 덱 아래 한 줄로)
  const shut = (p: Phase) => !idle(p) && stOf(p) !== 'wait', deckPs = cols.slice(0, deck).flatMap(c => c.kind === 'box' ? [c.phase] : c.rows.flatMap(x => x.phases)).filter(shut);
  const row = (p: Phase) => <Stage key={p.id} r={r} p={p} name={cut(p.name)} items={(at.get(p.id) ?? []).map(i => [outs[i], i])} ask={ask} open={(i, band) => setView({ i, band })}
    folded={!isOpen(p)} flip={() => setFold({ ...fold, rows: { ...fold.rows, [p.id]: !isOpen(p) } })} />;
  // 칸들을 그린다 — pick 에 드는 단계만
  const lay = (cs: Col[], pick: (p: Phase) => boolean) => cs.map((c, n) => {
    if (c.kind === 'box') return pick(c.phase) ? row(c.phase) : null;
    const rows = c.rows.map(x => ({ ...x, phases: x.phases.filter(pick) })).filter(x => x.phases.length);
    const on = rows.filter(x => !x.phases.every(idle)), off = rows.filter(x => x.phases.every(idle));
    return (
      <Fragment key={n}>
        {/* 넓은 화면은 같은 차례 단계끼리 한 줄 — 높이가 같아 지금 줄끼리 나란히 붙는다(갈래마다 따로 쌓으니 엇갈렸다). 좁은 화면은 갈래마다 차례로 */}
        {on.length > 0 && (
          <div style={{ '--n': on.length } as CSSProperties} className="grid gap-2 lg:grid-cols-[repeat(var(--n),minmax(0,1fr))]">
            {on.flatMap((x, c) => x.phases.map((p, i) => (
              <div key={p.id} style={{ '--c': c + 1, '--r': i + 1 } as CSSProperties} className="grid min-w-0 lg:[grid-column:var(--c)] lg:[grid-row:var(--r)]">{row(p)}</div>
            )))}
          </div>
        )}
        {off.flatMap(x => x.phases).map(row)}
      </Fragment>
    );
  });
  if (!ps.length) return <Empty>노드가 없는 런이다.</Empty>;
  const some = ps.some(p => !isOpen(p)) || (deckPs.length > 0 && !fold.deck);
  return (
    <div className="space-y-2">
      <p className="flex justify-end">
        <button type="button" onClick={() => setFold({ deck: some, rows: Object.fromEntries(ps.map(p => [p.id, some])) })} className="text-xs text-muted-foreground hover:text-foreground">{some ? '모두 펼치기' : '모두 접기'}</button>
      </p>
      {deckPs.length > 0 && (
        <section className="rounded-xl border bg-card px-4 py-2.5" aria-label="끝난 단계">
          <button type="button" aria-expanded={!!fold.deck} onClick={() => setFold({ ...fold, deck: !fold.deck })} className="flex w-full flex-wrap items-baseline gap-x-2 text-left text-sm">
            <span className="w-3 text-xs text-muted-foreground">{fold.deck ? '▾' : '▸'}</span><span className="font-semibold">끝난 단계 {deckPs.length}개</span>
            <span className="text-xs text-muted-foreground">{deckPs.map(p => cut(p.name)).join(' · ')}</span>
          </button>
          {fold.deck && <div className="mt-2 space-y-2">{lay(cols.slice(0, deck), shut)}</div>}
        </section>
      )}
      {lay(cols.slice(0, deck), p => !shut(p))}
      {lay(cols.slice(deck), () => true)}
      {view && <OutputSheet id={r.id} i={view.i} band0={view.band} onClose={() => setView(null)} />}
    </div>
  );
}
// 결과물 판 펼침 — 런마다 이 브라우저에 기억(덱 · 줄마다). 처음 값(foldOf)에서 사람이 바꾼 것만 적는다
type Fold = { deck?: boolean; rows: Record<string, boolean> };
function useFold(id: number): [Fold, (f: Fold) => void] {
  const key = `edith.runs.fold.${id}`;
  const [f, setF] = useState<Fold>(() => { try { return { rows: {}, ...JSON.parse(localStorage.getItem(key) ?? '{}') }; } catch { return { rows: {} }; } });
  return [f, n => { setF(n); try { localStorage.setItem(key, JSON.stringify(n)); } catch { /* 저장 안 됨 */ } }];
}
// 큰 단계 한 줄 — 남은 · 건너뛴 단계는 이름만 흐리게. 지금 단계는 지금 노드마다 한 줄(NowLine), 답 기다림 · 확인 필요면 주황.
// 접힌 줄(folded)은 머리 + 판 카드 이름 칩(누르면 바로 보기 창) · 「+그 밖 n」 — 머리를 누르면 펼치고 접는다
const LIVE: NodeState[] = ['running', 'sending', 'blocked', 'check'];
// 단계 상태 — 고치는 노드(fixOnly — 단계 노드 수엔 안 든다)가 돌아도 지금, 도는 런에서 노드 사이(몇은 끝 · 몇은 대기)도 지금
// (고치는 노드가 도는 구현 단계가 「일부 끝」 으로 보여 덱에 들어갔다)
const phaseSt = (r: Run, p: Phase): Status => {
  if (p.groups.some(g => g.keys.some(k => LIVE.includes(r.nodes[k].state)))) return 'live';
  const st = statusOf(p.keys.map(k => r.nodes[k].state));
  return st === 'part' && r.state === 'running' ? 'live' : st;
};
// 건너뛴 단계 — 노드를 다 건너뛰었거나, 스킬 노드를 다 건너뛰었다(「앱 없으면 건너뜀」 같은 명령 노드만 돈 갈래)
const idleOf = (r: Run, p: Phase) => {
  const sk = r.steps.filter(x => p.keys.includes(x.key) && x.kind === 'skill');
  return p.keys.every(k => r.nodes[k].state === 'skipped') || (sk.length > 0 && sk.every(x => r.nodes[x.key].state === 'skipped'));
};
function Stage({ r, p, name, items, ask, open, folded, flip }: {
  r: Run; p: Phase; name: string; items: [OutputItem, number][]; ask: Set<number>; open: (i: number, band: boolean) => void; folded: boolean; flip: () => void;
}) {
  const all = p.groups.flatMap(g => g.keys), s = phaseSt(r, p), now = r.steps.filter(x => all.includes(x.key) && LIVE.includes(r.nodes[x.key].state));
  // 갈래 이름은 단계 이름에 없을 때만 앞에(「BE 계획」 에 be 는 군더더기) — 단계 줄(Phases)과 같게
  const label = <>{p.track && !name.toLowerCase().includes(p.track.toLowerCase()) && <span className="mr-1.5 font-mono text-xs opacity-75">{p.track}</span>}{name}</>;
  if (idleOf(r, p)) return <p className="px-3 text-sm text-muted-foreground/70">건너뜀 · {label}</p>;
  if (s === 'wait' && !items.length) return <p className="px-3 text-sm text-muted-foreground">○ 남음 · {label}</p>;
  // 걸린 시간 — 이 단계 노드 기록마다 일한 시간을 더한 것(처음 · 끝 사이로 재면 되돌림으로 다음 날 다시 돈 사이까지 든다), 도는 노드는 지금까지.
  // 사람을 기다린 시간(답 기다림 · 사람을 기다리는 명령 노드)은 뺀다
  const es = (r.timeline ?? []).filter(e => e.kind === 'node' && all.includes(e.keys[0]) && !r.steps.find(x => x.key === e.keys[0])?.humanWait);
  const took = es.reduce((a, e) => a + (e.tone === 'now' ? Date.now() - e.t - (e.human ?? 0) : e.work ?? 0), 0), warn = now.some(x => r.nodes[x.key].state === 'blocked' || r.nodes[x.key].state === 'check');
  const cards = items.filter(([o]) => o.board), gs = groupOutputs(items.filter(([o]) => !o.board));
  const rest = gs.flatMap(g => g.items), folds = gs.flatMap(g => g.folds), n = rest.length + folds.reduce((a, f) => a + f.items.length, 0);
  const head = s === 'done' ? <span className="text-emerald-700 dark:text-emerald-400">✓ 끝</span>
    : s === 'live' ? <span className={warn ? 'text-amber-700 dark:text-amber-300' : 'text-sky-700 dark:text-sky-300'}>● 지금</span>
    : <span className="text-muted-foreground">{s === 'part' ? '◐ 여기까지' : '○ 남음'}</span>;
  return (
    <section className={`space-y-2 rounded-xl border bg-card px-4 py-3 ${s === 'live' ? (warn ? 'border-amber-500/70 bg-amber-500/5' : 'border-sky-500/60 bg-sky-500/5') : ''}`} aria-label={p.name}>
      <button type="button" onClick={flip} aria-expanded={!folded} className="flex w-full items-baseline gap-2 text-left text-sm font-semibold">
        <span className="w-3 text-xs font-normal text-muted-foreground">{folded ? '▸' : '▾'}</span>{head}<span>{label}</span>
        {es.length > 0 && <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">{dur(took)}{s === 'live' ? '째' : ''}</span>}
      </button>
      {folded ? cards.length + n > 0 && (
        // 칩 이름은 「 · 」 앞까지(「BE 흐름 1 · 근로자 정보에서 …」 → 「BE 흐름 1」), 전체 이름은 마우스를 올리면
        <p className="flex flex-wrap gap-1.5">
          {cards.map(([o, i]) => <button key={i} type="button" title={o.label} onClick={() => open(i, false)}
            className={`rounded-md border bg-background px-2 py-0.5 text-xs hover:border-primary/60 ${ask.has(i) ? 'border-amber-500' : ''}`}>{o.label.split(' · ')[0]}</button>)}
          {n > 0 && <button type="button" onClick={flip} className="rounded-md border border-dashed border-input px-2 py-0.5 text-xs text-muted-foreground hover:border-primary/60">+그 밖 {n}</button>}
        </p>
      ) : <>
        {now.map(x => <NowLine key={x.key} r={r} s={x} />)}
        {cards.length > 0 && <div className="flex flex-wrap gap-2">{cards.map(([o, i]) => <Card key={i} id={r.id} o={o} i={i} ask={ask.has(i)} open={band => open(i, band)} />)}</div>}
        {n > 0 && <details className="text-sm"><summary className="cursor-pointer text-xs text-muted-foreground">그 밖 산출물 {n}</summary><div className="mt-1.5"><OutputChips id={r.id} items={rest} folds={folds} /></div></details>}
      </>}
    </section>
  );
}
// 지금 노드 한 줄 — 몇 분째와 Claude 마지막 말(오른쪽 런 pane 대화의 마지막 글 — 타임라인 지금 카드와 같은 것), 답 기다림 · 확인 필요는 그 까닭
type ChatItem = { kind: string; text: string };
function NowLine({ r, s }: { r: Run; s: Step }) {
  const n = r.nodes[s.key], pane = s.track ? r.panes?.[s.track]?.pane : r.pane, live = n.state === 'running' && s.kind === 'skill' && !!pane;
  const chat = useQuery({ queryKey: ['chat', pane], queryFn: () => get<{ items: ChatItem[] }>(`/api/herdr/panes/${pane}/chat`), enabled: live, refetchInterval: 3000 });
  const t = (r.timeline ?? []).findLast(e => e.kind === 'node' && e.keys[0] === s.key)?.t;
  const said = n.state === 'blocked' ? '답을 기다린다 — 오른쪽 런 pane 의 질문 창' : n.state === 'check' ? n.reason ?? n.summary ?? '확인이 필요하다 — 「이어서」 · 「건너뛰기」'
    : live ? chat.data?.items.findLast(x => x.kind === 'text')?.text : undefined;
  return (
    <div className="text-sm">
      <p className="flex items-baseline gap-2"><span className="font-semibold">{s.kind === 'command' ? `$ ${s.title}` : s.title}</span>
        {s.track && <span className="rounded-md bg-violet-500/12 px-1.5 font-mono text-[0.6875rem] font-semibold text-violet-700 dark:text-violet-300">{s.track}</span>}
        {t && <span className="ml-auto text-xs text-muted-foreground tabular-nums">{dur(Date.now() - t)}째</span>}</p>
      {said && <p className={`mt-1 line-clamp-2 ${n.state === 'running' ? 'text-foreground/85' : 'text-amber-800 dark:text-amber-300'}`}>{said}</p>}
    </div>
  );
}
// 판의 카드 하나 — 위는 미리 보기(svg 는 그림, html 은 줄인 화면, 글은 앞부분), 아래는 묶음 · 이름 · 설명(엔진이 적은 마지막 재생 결과 같은 것). 주소는 새 탭
// ask — 답 기다리는 노드(또는 바로 앞 노드)가 만든 것: 「답하기 전에 볼 것」
function Card({ id, o, i, ask, open }: { id: number; o: OutputItem; i: number; ask?: boolean; open: (band: boolean) => void }) {
  const one = useOutput(id, i, !!o.path && !o.error), t = one.data, act = t?.act;
  const head = <>{o.group && <span className="block text-xs text-muted-foreground">{o.group}</span>}<span className="block font-semibold">{o.label}</span></>;
  if (o.url) return (
    <a href={o.url} target="_blank" rel="noreferrer" className="flex w-full flex-col justify-end gap-1 rounded-xl border bg-card p-4 text-sm hover:border-primary/60 sm:w-60">
      {head}<span className="truncate text-xs text-primary">{o.url.replace(/^https?:\/\//, '')} ↗</span>
    </a>
  );
  const pic = t && (/\.svg$/i.test(t.path) ? <img src={svgSrc(t.text)} alt="" className="size-full object-contain p-2" />
    // 줄인 화면 — 네 배 크기로 그려 4분의 1 로. 누르기 · 탭 이동은 카드가 받는다
    : /\.html?$/i.test(t.path) ? <iframe sandbox="" srcDoc={frameDoc(t.text)} title="" tabIndex={-1} aria-hidden className="pointer-events-none absolute top-0 left-0 h-[400%] w-[400%] origin-top-left scale-25 border-0" />
    : /\.(md|markdown)$/i.test(t.path) ? <div className="pointer-events-none px-3 py-2 text-xs [&_h1]:text-sm [&_h2]:text-sm"><Md text={t.text.slice(0, 1500)} /></div>
    : <pre className="px-3 py-2 text-xs whitespace-pre-wrap text-muted-foreground">{t.text.slice(0, 600)}</pre>);
  return (
    <div className={`flex w-full flex-col overflow-hidden rounded-xl border bg-card text-sm hover:border-primary/60 sm:w-60 ${ask ? 'border-amber-500 ring-4 ring-amber-500/15' : ''}`}>
      {ask && <span className="bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-800 dark:text-amber-300">답하기 전에 볼 것</span>}
      <button type="button" disabled={!!o.error} onClick={() => open(false)} title={o.path} className="flex flex-1 flex-col text-left disabled:opacity-60">
        <span className="relative block h-32 overflow-hidden border-b bg-white text-foreground">
          {pic ?? <span className="block p-3 text-xs text-muted-foreground">{o.error ?? (one.error ? (one.error as Error).message : '읽는 중…')}</span>}
        </span>
        <span className="block px-3 pt-2 pb-0.5">{head}</span>
        {/* 설명이 파일 이름뿐이면 빼고(이름은 마우스를 올리면) — 마지막 재생 결과 같은 것만 */}
        {o.note && !o.path?.endsWith(o.note) && <span className="block px-3 text-xs text-muted-foreground">{o.note}</span>}
      </button>
      {act && <Button size="sm" className="mx-3 mt-2 h-7 self-start text-xs" title={act.hint} onClick={() => open(true)}>▶ {act.label}</Button>}
      <span className="pb-2.5" />
    </div>
  );
}
// 답 기다리는 노드 — 그 노드와 바로 앞 노드가 남긴 산출물(승인 카드가 가리키는 ERD 같은 것)을 답하기 전에 바로 연다. 답은 오른쪽 런 pane
function Waiting({ r }: { r: Run }) {
  const outs = (useOutputs(r.id).data ?? []).map((o, i): [OutputItem, number] => [o, i]);
  const ws = r.steps.filter(s => r.nodes[s.key].state === 'blocked').map(s => ({ s, items: outs.filter(([o]) => o.node && [s.key, ...s.deps].includes(o.node)) })).filter(w => w.items.length);
  return ws.map(({ s, items }) => (
    <div key={s.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
      <span className="font-semibold text-amber-800 dark:text-amber-300">답 기다림 — {s.title}{s.track ? ` · 갈래 ${s.track}` : ''}</span>
      <span className="text-xs text-muted-foreground">답은 오른쪽 런 pane · 보고 답할 것</span>
      <OutputChips id={r.id} items={items} />
    </div>
  ));
}
// 칩은 이름만 — 설명(파일 이름 같은 것) · 경로는 마우스를 올리면. folds 는 「▸ 이름 수」 로 접어 두고 누르면 그 자리에 편다
function OutputChips({ id, items, folds = [] }: { id: number; items: [OutputItem, number][]; folds?: OutputGroup<OutputItem>['folds'] }) {
  const [view, setView] = useState<number | null>(null), [open, setOpen] = useState<string[]>([]);
  const cls = 'rounded-md border bg-background px-2 py-0.5 text-xs hover:border-primary/60 disabled:opacity-50';
  const chip = ([o, i]: [OutputItem, number]) => {
    const tip = [o.note, o.error ?? o.path ?? o.url].filter(Boolean).join('\n');
    return o.url
      ? <a key={i} href={o.url} target="_blank" rel="noreferrer" title={tip} className={cls}>{o.label} ↗</a>
      : <button key={i} type="button" disabled={!!o.error} title={tip} onClick={() => setView(i)} className={cls}>{o.label}</button>;
  };
  return (
    <>
      <span className="flex flex-wrap gap-1.5">
        {items.map(chip)}
        {folds.map(f => {
          const on = open.includes(f.name);
          return (
            <Fragment key={f.name}>
              <button type="button" aria-expanded={on} onClick={() => setOpen(on ? open.filter(x => x !== f.name) : [...open, f.name])}
                className="rounded-md border border-dashed border-input px-2 py-0.5 text-xs text-muted-foreground hover:border-primary/60">{on ? '▾' : '▸'} {f.name} {f.items.length}</button>
              {on && f.items.map(chip)}
            </Fragment>
          );
        })}
      </span>
      {view !== null && <OutputSheet id={id} i={view} label={[...items, ...folds.flatMap(f => f.items)].find(([, i]) => i === view)?.[0].label} onClose={() => setView(null)} />}
    </>
  );
}
// 산출물 하나 보기 창 — 칩을 누르거나 주소 #/runs/<번호>/out/<차례>(배포 카드 링크)로 연다
// 공방 엔진에 이 산출물 단추(on: "output")가 있으면 머리줄에 그 단추 — 누르면 창 안 띠(ActBand), 도는 동안은 진행 줄(JobLine)
// 엔진이 그린 그림을 iframe 에 — 빈 sandbox 로 띄워 스크립트가 돌지 않고 출처가 없어(쿠키 · /api 못 씀) 이 화면에 손대지 못한다
// base — srcdoc 은 EDITH 주소를 기준으로 삼아 목차 #앵커가 EDITH 로 튀어 「연결을 거부」 로 뜬다. doctype 뒤에 넣어 표준 모드 유지
const frameDoc = (t: string) => t.replace(/^(\s*<!doctype[^>]*>)?/i, '$1<base href="about:srcdoc">');
// svg 는 그림(img)으로 — img 안의 svg 는 스크립트 · 바깥 자원을 안 쓰고, 창 폭에 맞춰 줄어든다(iframe 은 그림 제 크기라 오른쪽이 잘렸다)
const svgSrc = (t: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(t)}`;
// band0 — 띠를 편 채로 연다(판 카드의 산출물 단추)
function OutputSheet({ id, i, label, band0 = false, onClose }: { id: number; i: number; label?: string; band0?: boolean; onClose: () => void }) {
  const one = useOutput(id, i);
  const act = one.data?.act, [band, setBand] = useState(band0), { job, refresh } = useJob(id, i, !!act);
  const running = job?.state === 'running';
  return (
    <Sheet title={label ?? one.data?.label ?? ''} sub={one.data?.path} onClose={onClose}
      extra={act && <Button size="sm" variant={band ? 'secondary' : 'default'} className="h-7 text-xs" title={act.hint} disabled={running} aria-expanded={band} onClick={() => setBand(b => !b)}>▶ {act.label}</Button>}
      band={act && (running || job?.state === 'failed') && !band ? <JobLine id={id} i={i} job={job!} onStopped={() => void refresh()} />
        : act && band && !running ? <ActBand id={id} i={i} onClose={() => setBand(false)} onStarted={() => { setBand(false); void refresh(); }} /> : null}>
      {one.isLoading ? <Empty>읽는 중…</Empty> : one.error ? <Empty>{(one.error as Error).message}</Empty>
        : one.data && (/\.(md|markdown)$/i.test(one.data.path) ? <Md text={one.data.text} />
          : /\.svg$/i.test(one.data.path) ? <img src={svgSrc(one.data.text)} alt={one.data.label} className="max-h-[75vh] w-full rounded-lg border bg-white object-contain" />
          : /\.html?$/i.test(one.data.path) ? <iframe sandbox="" srcDoc={frameDoc(one.data.text)} title={one.data.path} className="h-[70vh] w-full rounded-lg border bg-white" />
          : <pre className="code-panel whitespace-pre-wrap">{one.data.text}</pre>)}
    </Sheet>
  );
}

// 노드 자세히 — 결과 요약 · 사유, 명령 · 출력, 보낸 글, 「이 노드부터 다시」 · 「건너뛰기」(타임라인 줄 아래 · 캔버스 아래)
function NodeDetail({ r, s, busy, armed, arm, act, bare }: {
  r: Run; s: Step; busy: boolean; armed: string; arm: (k: string) => void; act: (what: 'skip' | 'rewind', key: string) => Promise<void>; bare?: boolean;
}) {
  const n = r.nodes[s.key], d = r.detail[s.key];
  const made = (useOutputs(r.id).data ?? []).map((o, i): [OutputItem, number] => [o, i]).filter(([o]) => o.node === s.key);
  return (
    <div className="space-y-2.5 rounded-xl border bg-card p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        {!bare && <span className="text-sm font-semibold">{s.title}</span>}
        <span className="text-xs text-muted-foreground">{bare ? '' : `${place(s)}${s.track ? ` · 갈래 ${s.track}` : ''} · `}{s.kind === 'command' ? '명령' : '스킬'} · {NODE[n.state][0]} · 시도 {n.attempt}{n.fails ? ` · 고침 ${n.fails}` : ''} · 키 <span className="font-mono">{s.key}</span></span>
        <span className="ml-auto flex gap-1.5">
          {/* 이 노드와 화살표로 뒤에 이어진 노드를 처음으로 — 작업 문서는 그대로. 두 번 눌러 한다 */}
          {n.state !== 'wait' && !s.fixOnly && r.state !== 'dropped' && (
            <Button size="sm" variant="outline" disabled={busy || r.state === 'running'} title={r.state === 'running' ? '도는 중에는 못 한다 — 「멈춤」 뒤에' : '이 노드와 뒤에 이어진 노드를 처음으로 돌려 여기서부터 다시 돈다(작업 문서는 그대로)'}
              className={`h-7 text-xs ${armed === s.key ? 'border-amber-500 bg-amber-500 text-white hover:bg-amber-500/90' : ''}`}
              onClick={() => { if (armed !== s.key) return arm(s.key); arm(''); void act('rewind', s.key); }}>{armed === s.key ? '뒤 노드도 처음으로 — 한 번 더' : '이 노드부터 다시'}</Button>
          )}
          {['check', 'stopped', 'wait'].includes(n.state) && !s.fixOnly && r.state !== 'dropped' && (
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => void act('skip', s.key)}>건너뛰기</Button>
          )}
        </span>
      </div>
      {!bare && n.summary && <p className="text-sm whitespace-pre-wrap">{n.summary}</p>}
      {!bare && n.reason && n.reason !== n.summary && <p className="text-sm whitespace-pre-wrap text-amber-700 dark:text-amber-400">{n.reason}</p>}
      {made.length > 0 && <div className="flex flex-wrap items-center gap-1.5"><span className="text-xs text-muted-foreground">이 노드가 만든 것</span><OutputChips id={r.id} items={made} /></div>}
      {s.kind === 'command' && <p className="font-mono text-xs"><span className="text-muted-foreground">$ </span>{s.command}</p>}
      {s.kind === 'command' && d?.output !== undefined && <pre className="code-panel max-h-80 whitespace-pre-wrap">{d.output || '(출력 없음)'}</pre>}
      {s.kind === 'skill' && d?.claude && <p className="text-xs text-muted-foreground">Claude 설정 <span className="font-semibold text-foreground">{claudeChip(d.claude)}</span>{d.claude.mcp ? ` · MCP ${d.claude.mcp}` : ''}{d.claude.why ? ` — ${d.claude.why}` : ''}</p>}
      {s.kind === 'skill' && d?.prompt && <details><summary className="cursor-pointer text-xs font-semibold text-muted-foreground">EDITH 가 보낸 글</summary><pre className="code-panel mt-1.5 max-h-80 whitespace-pre-wrap">{d.prompt}</pre></details>}
      {s.kind === 'skill' && !d?.prompt && <p className="text-xs text-muted-foreground">아직 보내지 않았다 · 스킬 {s.skill}</p>}
    </div>
  );
}

// 흐름 — 벽시계로 일 · 멈춤 · 빈 시간(갈래가 겹쳐 돈 시간은 한 번), 긴 빈 구간과 무엇을 기다렸는지. 사람 대기는 서버가 따로 세지만 여기선 뺀다
const FLOW = { work: ['일', 'bg-sky-500'], stop: ['멈춤', 'bg-muted-foreground/60'], idle: ['빈 시간', 'bg-muted-foreground/25'] } as const;
function Flow({ a }: { a: Stats }) {
  const f = a.flow!, all = f.work + f.stop + f.idle || 1, name = (k: string) => a.nodes.find(x => x.key === k)?.title ?? k;
  const spans = f.spans.filter(s => s.kind !== 'human');
  return (
    <div className="space-y-2">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
        {(['work', 'stop', 'idle'] as const).map(k => f[k] > 0 && <span key={k} title={`${FLOW[k][0]} ${dur(f[k])}`} className={FLOW[k][1]} style={{ width: `${f[k] / all * 100}%` }} />)}
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {(['work', 'stop', 'idle'] as const).map(k => f[k] > 0 && <span key={k} className="flex items-center gap-1.5"><span className={`size-2 rounded-full ${FLOW[k][1]}`} />{FLOW[k][0]} <b className="tabular-nums">{dur(f[k])}</b> <span className="text-muted-foreground tabular-nums">{Math.round(f[k] / all * 100)}%</span></span>)}
      </p>
      {spans.length > 0 && (
        <ul className="space-y-0.5 text-xs">
          {spans.map(s => (
            <li key={s.from} className="flex gap-2"><span className="w-24 shrink-0 text-muted-foreground tabular-nums">{hhmm(s.from)}–{hhmm(s.to)}</span>
              <span className="w-16 shrink-0 font-semibold text-muted-foreground">{FLOW[s.kind as 'stop' | 'idle'][0]}</span>
              <span className="w-20 shrink-0 tabular-nums">{dur(s.to - s.from)}</span>
              <span className="min-w-0 truncate text-muted-foreground">{s.keys.map(name).join(' · ') || '도는 노드 없음'}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

// 갈래 — 갈래마다 시작 · 끝 · 일한 시간과 합침에서 기다린 시간. 가장 늦게 끝난 갈래가 병목(전부 건너뛴 갈래는 빼고)
function Lanes({ a }: { a: Stats }) {
  const ran = a.lanes.filter(l => !l.skipped), late = Math.max(...ran.map(l => l.last ?? 0)), cell = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap';
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="border-b text-muted-foreground"><tr><th className="px-2 py-1.5 text-left">갈래</th><th className={cell}>시작</th><th className={cell}>끝</th><th className={cell}>일한 시간</th><th className={cell}>합침에서 기다림</th></tr></thead>
        <tbody>
          {a.lanes.map(l => (
            <tr key={l.track} className="border-b last:border-0">
              <td className="px-2 py-1.5 font-mono">{l.track}{l.skipped && <span className="ml-1.5 font-sans text-muted-foreground">건너뜀</span>}{!l.skipped && l.last === late && ran.length > 1 && <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 font-sans text-[0.625rem] font-bold text-amber-800 dark:text-amber-300">병목</span>}</td>
              <td className={cell}>{l.first ? hhmm(l.first) : ''}</td><td className={cell}>{l.last ? hhmm(l.last) : ''}</td>
              <td className={cell}>{dur(l.work)}</td>
              <td className={`${cell} ${l.waited ? 'font-semibold text-amber-700 dark:text-amber-400' : ''}`}>{l.waited ? dur(l.waited) : l.waited === 0 ? '—' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 같은 엔진 런 비교 — 최근 6개를 나란히, 큰 단계마다 걸린 시간(그 단계 노드가 돈 벽시계 시간) · 전체(사람 대기 뺌). 이 런은 굵게
function Compare({ a, cut }: { a: Stats; cut: (n: string) => string }) {
  const names = [...new Set(a.compare.flatMap(x => x.phases.map(p => p.name)))], cell = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap';
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="border-b text-muted-foreground"><tr><th className="px-2 py-1.5 text-left">단계</th>{a.compare.map(x => <th key={x.id} className={`${cell} ${x.id === a.id ? 'text-foreground' : ''}`}><a href={`#/runs/${x.id}`} className="hover:underline">{runNo(x.id)}</a></th>)}</tr></thead>
        <tbody>
          {names.map(n => (
            <tr key={n} className="border-b">
              <td className="px-2 py-1.5" title={n}>{cut(n)}</td>
              {a.compare.map(x => { const p = x.phases.find(y => y.name === n); return <td key={x.id} className={`${cell} ${x.id === a.id ? 'font-semibold' : ''}`}>{p ? dur(p.ms) : ''}</td>; })}
            </tr>
          ))}
          <tr><td className="px-2 py-1.5 font-semibold" title="사람 대기를 뺀 런 시간">전체</td>{a.compare.map(x => <td key={x.id} className={`${cell} font-semibold`}>{dur(x.elapsed)}</td>)}</tr>
        </tbody>
      </table>
    </div>
  );
}

// 노드 안쪽 — 오래 걸린 스킬 노드마다 모델(생각 · 글쓰기)과 도구(겹친 것은 한 번) 시간, 오래 걸린 도구. 질문 창은 사람 몫
const insideTop = (a: Stats) => a.nodes.filter(x => x.inside && x.inside.last > x.inside.first).sort((x, y) => (y.inside!.last - y.inside!.first) - (x.inside!.last - x.inside!.first)).slice(0, 8);
function Inside({ a }: { a: Stats }) {
  return (
    <div className="space-y-2">
      {insideTop(a).map(x => {
        const i = x.inside!, span = i.last - i.first, ask = i.tools['질문 창(사람)'] ?? 0, tool = Math.max(0, i.busy - ask), model = Math.max(0, span - i.busy);
        const tools = Object.entries(i.tools).filter(([k, v]) => v >= 6000 && k !== '질문 창(사람)').sort((p, q) => q[1] - p[1]).slice(0, 3);
        const reads = Object.entries(i.reads ?? {}).sort((p, q) => q[1] - p[1]).slice(0, 3);
        return (
          <div key={x.key} className="text-xs">
            <p className="flex items-baseline gap-2"><span className="min-w-0 truncate font-semibold">{x.title}</span><span className="text-muted-foreground">{x.place}</span><span className="ml-auto tabular-nums">{dur(span)}</span></p>
            <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-muted">
              <span className="bg-sky-500" style={{ width: `${model / span * 100}%` }} title={`모델 ${dur(model)}`} />
              <span className="bg-violet-500" style={{ width: `${tool / span * 100}%` }} title={`도구 ${dur(tool)}`} />
              <span className="bg-amber-500" style={{ width: `${ask / span * 100}%` }} title={`질문 창(사람) ${dur(ask)}`} />
            </div>
            <p className="mt-0.5 text-muted-foreground">모델 {dur(model)} · 도구 {dur(tool)}{ask ? ` · 질문 창(사람) ${dur(ask)}` : ''}{tools.length ? ` — ${tools.map(([k, v]) => `${k} ${dur(v)}`).join(' · ')}` : ''}</p>
            {(i.turns || i.readChars) ? <p className="text-muted-foreground">대화 {i.turns ?? 0}번 · 읽은 글 {big(i.readChars ?? 0)}자{reads.length ? ` — ${reads.map(([f, n]) => `${f} ${big(n)}`).join(' · ')}` : ''}</p> : null}
            {i.agents && <p className="text-muted-foreground">하위 에이전트 {i.agents.n}개 · {dur(i.agents.ms)} · 대화 {i.agents.turns}번(토큰은 이 노드에 더함)</p>}
          </div>
        );
      })}
    </div>
  );
}

// 레포 판단 — 엔진이 고른 레포(확실 · 확인)와 런이 실제로 쓴 레포 · 커밋 수. 확실에 없는데 커밋한 레포가 「놓침」
function RepoPick({ p }: { p: NonNullable<Stats['repoPick']> }) {
  const used = new Map(p.picked.map(x => [x.repo, x.commits])), all = [...new Set([...p.must, ...p.check, ...used.keys()])];
  const missed = [...used].filter(([r, n]) => (n ?? 0) > 0 && !p.must.includes(r)).map(([r]) => r), cell = 'px-2 py-1.5 whitespace-nowrap';
  return (
    <div className="space-y-2 text-xs">
      <table className="w-full">
        <thead className="border-b text-muted-foreground"><tr><th className={`${cell} text-left`}>레포</th><th className={`${cell} text-left`}>엔진 판단</th><th className={`${cell} text-left`}>런이 씀</th><th className={`${cell} text-right`}>커밋</th></tr></thead>
        <tbody>
          {all.map(r => (
            <tr key={r} className="border-b last:border-0">
              <td className={`${cell} font-mono`}>{r}</td>
              <td className={cell}>{p.must.includes(r) ? '확실' : p.check.includes(r) ? '확인' : <span className="text-amber-700 dark:text-amber-400">없음</span>}</td>
              <td className={cell}>{used.has(r) ? '씀' : ''}</td>
              <td className={`${cell} text-right tabular-nums`}>{used.get(r) ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-muted-foreground">{p.human ? '엔진이 「사람이 정함」 으로 넘겼다. ' : ''}{missed.length ? `확실 칸이 놓친 레포: ${missed.join(' · ')}` : p.picked.length ? '확실 칸이 커밋한 레포를 다 담았다' : '워크트리를 아직 만들지 않았다'}</p>
    </div>
  );
}

// 여러 런 모아 보기 — 같은 엔진 최근 런들의 레포 판단 맞힘률과 헛도는 검사가 잦은 노드
function Across({ a }: { a: Stats }) {
  const x = a.across!, name = (k: string) => a.nodes.find(n => n.key === k)?.title ?? k;
  return (
    <div className="space-y-2 text-xs">
      <p><span className="font-semibold">레포 판단</span> — {x.repo
        ? `커밋한 런 ${x.repo.runs}개 중 확실 칸이 다 담은 런 ${x.repo.must} · 확인 칸까지 ${x.repo.check} · 사람이 판단에 없던 레포를 더한 런 ${x.repo.added}`
        : '엔진의 레포 판단 기록(repo-pick)과 커밋이 함께 있는 런이 아직 없다'}</p>
      <div>
        <p className="font-semibold">헛도는 검사가 있었던 노드</p>
        {x.flaky.length ? <ul className="mt-0.5 space-y-0.5">{x.flaky.slice(0, 6).map(f => <li key={f.key}>{name(f.key)} <span className="text-muted-foreground">— {f.ran}런 중 {f.same}런에서 코드 그대로 다시 돎</span></li>)}</ul>
          : <p className="text-muted-foreground">없음(실행기가 코드 지문을 적기 시작한 뒤의 런만 센다)</p>}
      </div>
      <p className="text-muted-foreground">노드 보통 시간(지난 런 중앙값)이 있는 노드 {Object.keys(x.medians).length}개 — 「먼저 볼 것」 의 「평소보다 느림」 이 쓴다</p>
    </div>
  );
}

// 자세히 — 접어 둔 칸. 제목 옆에 이 칸이 무엇에 답하는지
function Fold({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <details className="rounded-xl border bg-card">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">{title} <span className="text-xs font-normal text-muted-foreground">— {hint}</span></summary>
      <div className="border-t p-3">{children}</div>
    </details>
  );
}

// 런 분석 — 맨 위 숫자 넷, 「먼저 볼 것」(runStats.ts), 단계별 시간(누르면 그 안 노드, 노드를 누르면 자세히), 나머지는 접어 둔 칸(서버 src/analysis.ts)
const hhmm = (t: number) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
const big = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
// 엔진 기록 칸 — 밀리초 시각처럼 보이는 수(2001~2096년)는 시:분:초로
const cellText = (v: unknown) => typeof v === 'string' ? v : typeof v === 'number' && v > 1e12 && v < 4e12 ? new Date(v).toLocaleTimeString('ko-KR', { hour12: false }) : v === undefined ? '' : JSON.stringify(v);
function Analysis({ id, sel, pick, detail }: { id: number; sel: string | null; pick: (k: string) => void; detail: () => ReactNode }) {
  // 끝난 런(끝남 · 버림)은 분석이 더 바뀌지 않아 다시 묻지 않는다
  const q = useQuery({ queryKey: ['run-stats', id], queryFn: () => get<Stats>(`/api/runs/${id}/analysis`), refetchInterval: x => ['done', 'dropped'].includes(x.state.data?.state ?? '') ? false : 10_000 });
  const [open, setOpen] = useState<Set<string>>(new Set());
  // 「먼저 볼 것」 에서 노드를 고르면 그 노드 줄로 — 단계는 고른 노드가 들어 있으면 펼친다
  useEffect(() => { if (sel) document.getElementById(`stat-${sel}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [sel]);
  if (!q.data) return <Empty>{q.error ? `분석을 읽지 못했다 — ${String(q.error)}` : '분석하는 중…'}</Empty>;
  const a = q.data, rows = a.nodes.filter(x => x.attempts > 0), sum = (f: (x: StatNode) => number) => a.nodes.reduce((t, x) => t + f(x), 0);
  const ps = byPhase(a), cut = dropShared(ps.map(p => p.name)), max = Math.max(1, ...ps.map(p => p.ms), ...a.nodes.map(x => x.time?.work ?? 0));
  const codexOut = Object.values(a.codex.nodes).reduce((s, x) => s + x.out, 0);
  const claudeP = Object.values(a.codex.claude ?? {}).reduce((s, x) => s + x.cost, 0);
  const tiles: [string, string, string][] = [
    // 걸린 시간은 사람 대기를 뺀 것(서버 elapsed) — 사람 대기는 서버가 기록만 하고 화면엔 안 보인다
    ['걸린 시간', dur(a.elapsed), a.flow ? `사람 대기 뺌 · 일 ${dur(a.flow.work)} · 빈 시간 ${dur(a.flow.idle)}` : `노드가 일한 시간 합 ${dur(sum(x => x.time?.work ?? 0))}`],
    ['다시 돈 시간', dur(a.redo.again + a.redo.fixing), `되돌림 ${a.rewinds.length}번 · 고치는 노드 ${dur(a.redo.fixing)}`],
    ['Claude 입력 토큰', big(sum(x => x.tokens ? inTok(x.tokens) : 0)),
      `출력 ${big(sum(x => x.tokens?.output ?? 0))}${claudeP ? ` · 명령 노드 claude -p $${claudeP.toFixed(2)}` : ''}${codexOut ? ` · Codex 출력 ${big(codexOut)}` : ''}${a.codex.weekly ? ` · Codex 주간 ${a.codex.weekly[0]}→${a.codex.weekly[1]}%` : ''}`],
  ];
  const cols = [...new Set(a.records.flatMap(o => Object.keys(o)))].slice(0, 8), cell = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap';
  const toggle = (n: string) => setOpen(o => { const s = new Set(o); if (!s.delete(n)) s.add(n); return s; });
  const tags = (x: StatNode) => [x.state !== 'done' && NODE[x.state as NodeState][0], x.attempts > 1 && `시도 ${x.attempts}`, x.fails > 0 && `고침 ${x.fails}`].filter(Boolean).join(' · ');
  return (
    <div className="space-y-3">
      {!a.timed && <p className="text-xs text-muted-foreground">이 런은 시간 기록(events.jsonl)이 생기기 전에 돌아 시간이 비어 있다.</p>}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
        {tiles.map(([k, v, sub]) => (
          <div key={k} className="rounded-xl border bg-card px-3 py-2">
            <p className="text-xs text-muted-foreground">{k}</p>
            <p className="text-lg font-bold tabular-nums">{v}</p>
            <p className="text-[0.6875rem] leading-snug text-muted-foreground">{sub}</p>
          </div>
        ))}
      </div>

      <section className="rounded-xl border bg-card p-3">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">먼저 볼 것 — 노드 이름을 누르면 아래 단계별 시간에서 그 노드를 연다</p>
        <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
          {highlights(a, cut).map(r => (
            <Fragment key={r.label}>
              <dt className="pt-px text-xs text-muted-foreground">{r.label}</dt>
              <dd className="space-y-0.5">
                {r.items.length ? r.items.map((it, i) => (
                  <p key={i}>{it.key ? <button type="button" onClick={() => pick(it.key!)} className="text-left font-medium underline-offset-2 hover:underline">{it.text}</button> : <span className="font-medium">{it.text}</span>}
                    {it.sub && <span className="text-muted-foreground"> — {it.sub}</span>}</p>
                )) : <p className="text-muted-foreground">{r.none}</p>}
              </dd>
            </Fragment>
          ))}
        </dl>
      </section>

      <section className="overflow-hidden rounded-xl border bg-card">
        <p className="px-3 pt-2.5 pb-1.5 text-xs font-semibold text-muted-foreground">단계별 시간 — 단계는 그 단계 노드가 돈 시간(겹친 갈래는 한 번), 노드는 일한 시간. 단계를 누르면 그 안의 노드, 노드를 누르면 자세히</p>
        <ul>
          {ps.map(p => {
            const ran = p.nodes.filter(x => x.attempts > 0).length, on = open.has(p.name) || p.nodes.some(x => x.key === sel);
            return (
              <li key={p.name} className="border-t">
                <button type="button" aria-expanded={on} onClick={() => toggle(p.name)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/50">
                  <span className={`w-3 shrink-0 text-xs text-muted-foreground transition-transform ${on ? 'rotate-90' : ''}`}>▸</span>
                  <span className={`w-44 shrink-0 truncate font-medium ${ran ? '' : 'text-muted-foreground line-through'}`} title={p.name}>{cut(p.name)}</span>
                  <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-sky-500" style={{ width: `${p.ms / max * 100}%` }} /></span>
                  <span className="w-24 shrink-0 text-right tabular-nums">{p.ms ? dur(p.ms) : ''}</span>
                  <span className="w-28 shrink-0 text-right text-xs text-muted-foreground">{ran ? `노드 ${ran}/${p.nodes.length} 돎` : '모두 건너뜀'}</span>
                </button>
                {on && (
                  <ul className="border-t bg-muted/30 py-1">
                    {p.nodes.map(x => (
                      <li key={x.key} id={`stat-${x.key}`}>
                        <button type="button" aria-pressed={sel === x.key} onClick={() => pick(x.key)}
                          className={`flex w-full items-center gap-3 py-1 pr-3 pl-9 text-left text-xs hover:bg-muted ${sel === x.key ? 'bg-muted font-semibold' : ''}`}>
                          <span className={`w-[10.75rem] shrink-0 truncate ${x.attempts ? '' : 'text-muted-foreground'}`} title={`${x.place} › ${x.title}`}>{x.title}</span>
                          <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-sky-500/60" style={{ width: `${(x.time?.work ?? 0) / max * 100}%` }} /></span>
                          <span className="w-24 shrink-0 text-right tabular-nums">{x.time?.work ? dur(x.time.work) : ''}</span>
                          <span className={`w-28 shrink-0 truncate text-right ${x.fails ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>{tags(x)}</span>
                        </button>
                        {sel === x.key && <div className="px-3 py-2">{detail()}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">자세히</p>
        {a.flow && <Fold title="흐름" hint="런 시간이 일 · 멈춤 · 빈 시간으로 어떻게 나뉘었나, 긴 빈 구간"><Flow a={a} /></Fold>}
        {a.lanes.length > 0 && <Fold title="갈래" hint={`갈래마다 시작 · 끝, 먼저 끝난 갈래가 합치는 노드${a.lanes[0].join ? `(${a.nodes.find(x => x.key === a.lanes[0].join)?.title ?? a.lanes[0].join})` : ''} 앞에서 기다린 시간`}><Lanes a={a} /></Fold>}
        {insideTop(a).length > 0 && <Fold title="노드 안쪽" hint="오래 걸린 노드에서 Claude 가 생각한 시간과 도구가 돈 시간, 대화 수 · 읽은 글"><Inside a={a} /></Fold>}
        {a.repoPick && <Fold title="레포 판단" hint="엔진이 고른 레포(확실 · 확인)와 런이 실제로 쓰고 커밋한 레포"><RepoPick p={a.repoPick} /></Fold>}
        {a.across && a.across.runs > 1 && <Fold title="여러 런 모아 보기" hint={`같은 엔진 최근 ${a.across.runs}런 — 레포 판단 맞힘률, 헛도는 검사가 잦은 노드`}><Across a={a} /></Fold>}
        {a.compare.length > 1 && <Fold title="같은 엔진 런 비교" hint={`최근 ${a.compare.length}개 런의 단계별 걸린 시간`}><Compare a={a} cut={cut} /></Fold>}
        <Fold title="노드 표" hint={`돈 노드 ${rows.length}개의 시도 · 시간 · 토큰 · Claude 설정(안 돈 ${a.nodes.length - rows.length}개는 뺐다)`}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b text-muted-foreground">
                <tr className="whitespace-nowrap"><th className="px-2 py-1.5 text-left">노드</th><th className="px-2 py-1.5 text-left">결과</th><th className={cell}>시도</th><th className={cell}>고침</th><th className={cell}>되돌려 옴</th>
                  <th className={cell}>일한 시간</th><th className={cell}>입력 토큰</th><th className={cell}>출력</th><th className={cell}>Codex 출력</th><th className="px-2 py-1.5 text-left">모델</th><th className="px-2 py-1.5 text-left">Claude 설정 · 이유</th></tr>
              </thead>
              <tbody>
                {rows.map(x => (
                  <tr key={x.key} className="border-b last:border-0">
                    <td className="min-w-48 px-2 py-1.5"><span className="text-muted-foreground">{x.place} › </span>{x.title}<span className="ml-1.5 font-mono text-[0.625rem] text-muted-foreground">{x.key}</span></td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{NODE[x.state as NodeState][0]}</td>
                    <td className={cell}>{x.attempts}</td><td className={cell}>{x.fails || ''}</td><td className={cell}>{x.rewound || ''}</td>
                    <td className={cell}>{x.time ? dur(x.time.work) : ''}</td>
                    <td className={cell} title={x.tokens ? `새 입력 ${x.tokens.input} · 캐시 쓰기 ${x.tokens.cacheWrite} · 캐시 읽기 ${x.tokens.cacheRead}` : undefined}>{x.tokens ? big(inTok(x.tokens)) : ''}</td>
                    <td className={cell}>{x.tokens ? big(x.tokens.output) : ''}</td>
                    <td className={cell}>{a.codex.nodes[x.key] ? big(a.codex.nodes[x.key].out) : ''}</td>
                    <td className="px-2 py-1.5 font-mono text-[0.625rem] whitespace-nowrap text-muted-foreground">{x.tokens?.models.join(' · ')}</td>
                    <td className="min-w-48 px-2 py-1.5 text-[0.6875rem]">{x.claude && <span title={x.claude.why}>{claudeChip(x.claude)}{x.claude.why ? <span className="text-muted-foreground"> — {x.claude.why}</span> : ''}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Fold>
        {cols.length > 0 && (
          <Fold title="엔진 기록" hint={`엔진이 작업 문서 edith-records.jsonl 에 남긴 ${a.records.length}줄`}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground"><tr>{cols.map(c => <th key={c} className="px-2 py-1 text-left">{c}</th>)}</tr></thead>
                <tbody>{a.records.map((o, i) => <tr key={i} className="border-t">{cols.map(c => <td key={c} className="px-2 py-1 align-top">{cellText(o[c])}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </Fold>
        )}
      </div>
    </div>
  );
}

// 단추 명령은 누르면 뒤에서 돈다(서버 runAction) — 도는 중인 기록(code null)이면 그 단추가 「도는 중 · 몇 초」, 끝나는 순간 알림
const runningOf = (r: Run) => r.acted.find(a => a.code === null);
// 단추 보내기 — 서버가 누른 순간 기록을 쓰니 곧바로 한 번 다시 읽는다(복사 단추는 끝날 때까지 답을 붙잡아, 답만 기다리면 「도는 중」 이 늦게 뜬다)
const pressAction = (qc: QueryClient, id: number, n: number, text: string) => {
  const t = setTimeout(() => void qc.invalidateQueries({ queryKey: ['run', id] }), 300);
  return post(`/api/runs/${id}/action`, { n, text }).finally(() => { clearTimeout(t); void qc.invalidateQueries({ queryKey: ['run', id] }); });
};
const secs = (at: number) => `${Math.max(1, Math.round((Date.now() - at) / 1000))}초`;
function useActedToast(r: Run) {
  const seen = useRef(new Map<number, number | null>());
  useEffect(() => {
    for (const a of r.acted) {
      if (seen.current.get(a.at) === null && a.code !== null)
        toast(a.code === 0 ? `「${a.label}」 끝${a.note ? ` · ${a.note}` : ''}` : `「${a.label}」 실패 — 끝 코드 ${a.code}${a.note ? ` · ${a.note}` : ''}`, a.code === 0 ? 3000 : 6000);
      seen.current.set(a.at, a.code);
    }
  }, [r.acted]);
}

// 런 단추 — 맨 위 엔진 폴더의 actions.json. 단추에 마우스를 올리면 설명(hint, 없으면 돌릴 명령)이 보인다. ask 가 있으면 글을 받아 같이 넘긴다.
// 지우는 단추(danger)는 빨강으로 맨 끝에 떼어 둔다 — 다른 단추와 헷갈려 누르지 않게
function Actions({ r }: { r: Run }) {
  const qc = useQueryClient(), [ask, setAsk] = useState<number | null>(null), [text, setText] = useState(''), [busy, setBusy] = useState(false);
  const go = async (n: number) => {
    setBusy(true);
    try { await pressAction(qc, r.id, n, text); setAsk(null); setText(''); }
    catch (e) { toast(`하지 못했다 — ${(e as Error).message}`, 5000); }
    setBusy(false);
  };
  const running = runningOf(r), doing = !!running, last = r.acted[0];
  const how = (a: Run['acted'][number]) => `${a.code === null ? '도는 중' : a.code === 0 ? '끝' : `끝 코드 ${a.code}`}${a.note ? ` · ${a.note}` : ''}`;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-semibold text-muted-foreground" title="엔진이 준 단추 — 마우스를 올리면 무엇을 하는지">런 단추</span>
        {/* 지우는 단추 앞 가름 — order-last 끼리는 DOM 차례라 단추보다 먼저 둔다 */}
        {r.actions.some(a => a.danger) && <span className="order-last mx-1 h-4 w-px bg-border" aria-hidden />}
        {r.actions.map((a, i) => (a.when === 'done' && r.state !== 'done') ? null : (
          <Button key={i} size="sm" variant={ask === i || running?.label === a.label ? 'default' : 'outline'} disabled={busy || doing} title={a.hint ?? `$ ${a.command}`} aria-busy={running?.label === a.label || undefined}
            className={`h-7 text-xs ${a.danger ? `order-last ${ask === i ? '' : 'text-destructive hover:text-destructive'}` : ''}`}
            onClick={() => a.ask ? setAsk(ask === i ? null : i) : void go(i)}>{running?.label === a.label ? `${a.label} — 도는 중 · ${secs(running.at)}` : a.label}</Button>
        ))}
      </div>
      {ask !== null && (
        <form onSubmit={e => { e.preventDefault(); void go(ask); }} className="flex gap-1.5">
          <input autoFocus value={text} onChange={e => setText(e.target.value)} placeholder={r.actions[ask].ask} aria-label={r.actions[ask].ask}
            className="min-w-0 flex-1 rounded-md border bg-card px-2.5 py-1 text-sm outline-none focus:ring-2 focus:ring-ring/50" />
          <Button type="submit" size="sm" className="h-7 text-xs" disabled={busy || !text.trim()}>「{r.actions[ask].label}」 돌리기</Button>
        </form>
      )}
      {last && (
        <details className="rounded-lg border bg-card px-3 py-2 text-sm" open={last.code === null}>
          <summary className="cursor-pointer"><span className="mr-2 text-xs font-semibold text-muted-foreground">최근 단추</span>「{last.label}」 — {how(last)}</summary>
          <div className="mt-1.5 space-y-2">
            {r.acted.map(a => (
              <div key={a.at} className="space-y-1">
                <p className="text-xs text-muted-foreground tabular-nums">{when(a.at)} · 「{a.label}」{a.text ? ` · ${a.text}` : ''} — {how(a)}
                  {/* copy 단추 — 출력이 사람이 직접 돌릴 명령이다 */}
                  {a.code === 0 && a.output && r.actions.some(x => x.copy && x.label === a.label) && <Button size="sm" variant="outline" className="ml-2 h-6 text-xs" onClick={() => void copyText(a.output)}>복사</Button>}</p>
                <pre className="code-panel max-h-60 whitespace-pre-wrap">{a.output || '(출력 없음)'}</pre>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// 오른쪽 런 pane — 이 런의 Claude. 질문 · 승인은 여기 입력칸으로 답한다.
// 갈래가 여럿이면 머리줄의 갈래 단추로 pane 을 바꿔 본다.
function RunPane({ panes, fold, setFold }: { panes: { track: string; id: string }[]; fold: boolean; setFold: (v: boolean) => void }) {
  const [pick, setPick] = useState(''), id = (panes.find(x => x.track === pick) ?? panes[0])?.id ?? null;
  const herdr = useHerdr(), p = herdr.data?.panes.find(x => x.id === id);
  if (fold) return (
    <aside className="flex shrink-0 items-center gap-2 border-t px-2 py-1.5 md:w-11 md:flex-col md:border-t-0 md:border-l md:py-2">
      <button onClick={() => setFold(false)} title="런 pane 펴기" className="rounded-md border bg-card p-1.5 hover:bg-muted"><Icon className="size-4">{CHEVRON_L}</Icon></button>
      <span className="text-xs font-semibold text-muted-foreground md:[writing-mode:vertical-rl]">런 pane</span>
    </aside>
  );
  return (
    <aside className="flex min-h-[28rem] w-full shrink-0 flex-col gap-2 border-t bg-sidebar p-2 md:min-h-0 md:w-[26rem] md:border-t-0 md:border-l">
      <div className="flex items-center gap-2 px-1">
        <Kind agent={p?.agent ?? 'claude'} /><span className="text-sm font-semibold">런 pane</span>
        {p?.push ? <PushTag branch={p.push} /> : p?.status && STATUS[p.status] && <Tag v={p.status}>{STATUS[p.status]}</Tag>}
        {p && <a href={`#/herdr/${p.id}`} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">herdr 에서 보기</a>}
        {panes.length > 1 && (
          <span className="flex gap-1" role="group" aria-label="갈래 pane">
            {panes.map(x => (
              <button key={x.track} onClick={() => setPick(x.track)} aria-pressed={x.id === id}
                className={`rounded-md border px-1.5 py-px font-mono text-[0.6875rem] ${x.id === id ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted'}`}>{x.track || '본 줄'}</button>
            ))}
          </span>
        )}
        <button onClick={() => setFold(true)} title="런 pane 접기" className="ml-auto rounded-md border bg-card p-1 hover:bg-muted"><Icon className="size-4">{CHEVRON_R}</Icon></button>
      </div>
      {p?.agent ? <AgentPane p={p} />
        : <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">{id ? '런 pane 에 Claude 가 아직 없다 — 뜨는 중이거나 꺼졌다.' : '이 런에는 아직 Claude pane 이 없다. 스킬 노드를 처음 보낼 때 띄운다.'}</div>}
    </aside>
  );
}
