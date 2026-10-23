// 런 — 공방의 엔진 · 체인을 한 번 돌린 것. 왼쪽 「새 런」과 런 목록, 가운데 타임라인(카드 덱 — RunTimeline.tsx, 「캔버스 · 분석」 으로 바꿔 본다), 오른쪽 런 pane(Claude).
// 주소는 #/runs/<번호>. 돌리는 것은 서버의 실행기(src/runner.ts)이고, 화면은 run.json 을 읽어 보여 주며 멈춤 · 이어서 · 건너뛰기만 보낸다.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, useHerdr } from './api.ts';
import { Button } from '@/components/ui/button';
import { AgentPane } from './AgentPane.tsx';
import { Empty, Icon, Md, Tag } from './ui.tsx';
import { DiffView } from './Diff.tsx';
import { Kind, STATUS } from './herdrUi.tsx';
import { FolderInput } from './Side.tsx';
import { toast } from './copy.ts';
import { Attach, upload } from './Attach.tsx';
import { NODE, type NodeState } from './StepFlow.tsx';
import { RunFlow } from './RunFlow.tsx';
import { RunTimeline, type Entry } from './RunTimeline.tsx';
import { claudeChip, dropShared, dur, notionUrl, phases, type ClaudeUsed } from './runFlow.ts';
import { byPhase, highlights, inTok, type StatNode, type Stats } from './runStats.ts';
import type { FlowStep } from './stepFlow.ts';

type Step = FlowStep & { skill?: string; command?: string; max?: number };
type RunState = 'queued' | 'running' | 'check' | 'stopped' | 'done';
type Run = {
  id: number; engine: string; name: string; cwd: string; input: string; created: number; state: RunState; reason?: string; pane?: string; dir: string; branch?: string; unattended?: boolean;
  steps: Step[]; nodes: Record<string, { state: NodeState; attempt: number; fails: number; summary?: string; line?: string; reason?: string; wake?: number }>;
  detail: Record<string, { prompt?: string; output?: string; claude?: ClaudeUsed }>;
  rewinds?: { at: number; to: string; name: string; by: string; reason: string }[];
  timeline?: Entry[];   // 옛 서버는 없다
  panes?: Record<string, { pane?: string }>;   // 갈래의 pane(본 줄은 pane)
  actions: { label: string; command: string; ask?: string; hint?: string; danger?: boolean; when?: 'done' }[];
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
type Item = { id: number; name: string; engine: string; state: RunState; reason?: string; created: number; total: number; done: number };
type Req = { id: string; engine: string; input: string; title?: string; tag?: string; from?: string; room?: string; cwd?: string; branch?: string; unattended?: boolean; at: number };

const RUN_LABEL: Record<RunState, string> = { queued: '대기', running: '도는 중', check: '확인 필요', stopped: '멈춤', done: '끝' };
const RUN_TONE: Record<RunState, string> = {
  queued: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  running: 'bg-sky-500/15 text-sky-700 dark:text-sky-400', check: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  stopped: 'bg-muted text-muted-foreground', done: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
};
const PLAY = <path d="M6 4.5v15l12.5-7.5z" />;
const KIND = { chain: '체인', engine: '엔진' } as const;
// 노션 로고(채운 모양) — simple-icons notion.svg(CC0)
const NOTION = 'M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z';
const CHEVRON_L = <path d="m15 18-6-6 6-6" />, CHEVRON_R = <path d="m9 18 6-6-6-6" />;
// 노드 자리 — 바깥 엔진부터(백엔드 › 계획). 옛 런은 든 엔진 이름만
const place = (s: Step) => s.boxes?.map(b => b.name).join(' › ') ?? s.lane;
const when = (t: number) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function RunsPage({ id, side }: { id?: string; side: boolean }) {
  const list = useQuery({ queryKey: ['runs'], queryFn: () => get<Item[]>('/api/runs'), refetchInterval: 3000 });
  const [fold, setFoldState] = useState(() => { try { return localStorage.getItem('edith.runs.pane') === 'off'; } catch { return false; } });
  const setFold = (v: boolean) => { setFoldState(v); try { localStorage.setItem('edith.runs.pane', v ? 'off' : 'on'); } catch { /* 저장 안 됨 */ } };
  const n = id && /^\d+$/.test(id) ? Number(id) : undefined, [req, setReq] = useState<Req | null>(null);
  const run = useQuery({
    queryKey: ['run', n], queryFn: () => get<Run>(`/api/runs/${n}`), enabled: n !== undefined,
    refetchInterval: q => q.state.data?.state === 'running' ? 1500 : 5000,
  });
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside className={`max-h-80 shrink-0 overflow-y-auto border-b bg-sidebar p-1.5 md:max-h-none md:w-64 md:border-r md:border-b-0 ${side ? '' : 'hidden'}`}>
        <Requests onOpen={setReq} />
        <NewRun req={req} done={() => setReq(null)} />
        {!list.data ? <p className="p-2.5 text-xs text-muted-foreground">불러오는 중…</p>
          : !list.data.length ? <p className="p-2.5 text-xs text-muted-foreground">아직 런이 없다</p>
          : list.data.map(r => (
            <a key={r.id} href={`#/runs/${r.id}`} title={r.reason}
              className={`flex items-center gap-2 rounded-md border-l-2 px-2 py-1.5 ${r.id === n ? 'border-primary bg-accent text-accent-foreground' : 'border-transparent hover:bg-muted/70'}`}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.8125rem] font-medium">#{r.id} {r.name}</span>
                <span className="block truncate text-[0.6875rem] text-muted-foreground tabular-nums">{when(r.created)} · {r.done}/{r.total}</span>
              </span>
              <span className={`shrink-0 rounded-full px-2 py-px text-[0.6875rem] font-semibold ${RUN_TONE[r.state]}`}>{RUN_LABEL[r.state]}</span>
            </a>
          ))}
      </aside>
      <main className="flex min-h-[32rem] min-w-0 flex-1 flex-col overflow-y-auto">
        {n === undefined ? <div className="p-6"><Empty>왼쪽 「새 런」에서 공방의 엔진이나 체인을 골라 돌린다. 지난 런은 목록에서 본다.</Empty></div>
          : run.error && !run.data ? <div className="p-6"><Empty>런을 읽지 못했다 — {String(run.error)}</Empty></div>
          : !run.data ? <div className="p-6"><Empty>불러오는 중…</Empty></div>
          : <RunDetail r={run.data} />}
      </main>
      <RunPane panes={run.data ? [{ track: '', id: run.data.pane }, ...Object.entries(run.data.panes ?? {}).map(([track, v]) => ({ track, id: v.pane }))].filter(x => x.id) as { track: string; id: string }[] : []}
        fold={fold} setFold={setFold} />
    </div>
  );
}

// 받은 요청 — 다른 도구가 requests/ 에 둔 「이 엔진을 이 입력으로」. 「열기」 는 새 런 칸에 채우기만 하고(시작은 사람이), 「거절」 은 사유(비워도 된다)를 받아 답만 쓴다.
// 엔진에 요청 훅(actions.json on: "request")이 있으면 시작 · 거절 때 그 명령이 요청 쪽에 알린다 — 거절 사유도 넘어간다
function Requests({ onOpen }: { onOpen: (r: Req) => void }) {
  const qc = useQueryClient(), q = useQuery({ queryKey: ['requests'], queryFn: () => get<Req[]>('/api/requests'), refetchInterval: 5000 });
  const [no, setNo] = useState<string | null>(null), [why, setWhy] = useState('');
  // 엔진 이름(id 대신) — 새 런 칸과 같은 목록
  const engines = useQuery({ queryKey: ['workshop'], queryFn: () => get<{ engines: { id: string; name: string }[] }>('/api/workshop') });
  if (!q.data?.length) return null;
  const nameOf = (id: string) => engines.data?.engines.find(e => e.id === id)?.name ?? id;
  const reject = (r: Req) => post(`/api/requests/${r.id}/reject`, { reason: why }).then(() => { setNo(null); setWhy(''); return qc.invalidateQueries({ queryKey: ['requests'] }); }, (e: Error) => toast(`하지 못했다 — ${e.message}`, 5000));
  return (
    <div className="mb-2 space-y-1 rounded-lg border border-sky-500/40 bg-sky-500/5 p-1.5">
      <p className="px-1 text-[0.6875rem] font-semibold text-sky-700 dark:text-sky-400">받은 요청 {q.data.length}</p>
      {q.data.map(r => {
        // 제목 — 요청이 준 것, 없으면 입력 첫 줄(주소뿐이면 주소 대신 「노션」 단추로)
        const link = notionUrl(r.input), first = r.input.split('\n')[0].trim(), head = r.title ?? (link && first === link ? '' : first);
        return (
        <div key={r.id} className="space-y-1 rounded-md bg-card px-2.5 py-2 text-xs">
          <p className="flex items-center gap-1.5">
            {r.tag && <span className="min-w-0 truncate rounded bg-muted px-1.5 py-px text-[0.6875rem] font-medium text-muted-foreground" title={r.tag}>{r.tag}</span>}
            <span className="ml-auto shrink-0 text-[0.6875rem] text-muted-foreground tabular-nums" title={r.id}>{when(r.at)}</span>
          </p>
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

// 새 런 — 엔진 · 체인, 작업 폴더(Claude 가 일할 곳, 이 브라우저에 기억), 입력. 받은 요청을 열면 그 값으로 채운다.
function NewRun({ req, done }: { req: Req | null; done: () => void }) {
  const qc = useQueryClient();
  const engines = useQuery({ queryKey: ['workshop'], queryFn: () => get<{ engines: { id: string; name: string; nodes: number; kind: 'chain' | 'engine'; broken: boolean }[] }>('/api/workshop') });
  const [open, setOpen] = useState(false), [engine, setEngine] = useState(''), [input, setInput] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false), [branch, setBranch] = useState(''), [unattended, setUnattended] = useState(false);
  // 고른 것의 작업 폴더 설정 — 늘 같은 폴더 · 새 워크트리면 폴더를 묻지 않는다
  const eq = useQuery({ queryKey: ['workshop', engine], queryFn: () => get<{ engine: { workdir?: Workdir } | null; picks?: string }>(`/api/workshop/${engine}`), enabled: !!engine });
  // 엔진이 주는 고르기 목록(actions.json on: "picks" — 예: 일감 목록) — 누를 때만 명령이 돈다
  const [picks, setPicks] = useState<{ label: string; note?: string; input: string }[] | null>(null), [picking, setPicking] = useState(false);
  useEffect(() => { setPicks(null); }, [engine]);
  const loadPicks = async () => {
    setPicking(true); setErr('');
    try { setPicks(await post<{ label: string; note?: string; input: string }[]>(`/api/workshop/${engine}/picks`, {})); } catch (e) { setErr((e as Error).message); }
    setPicking(false);
  };
  const wd: Workdir = eq.data?.engine?.workdir ?? { kind: 'ask' };
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
      if (!dir || seen.has(dir) || w.label.startsWith('▶')) return [];
      seen.add(dir);
      return [{ label: w.label, dir }];
    });
  }, [herdr.data]);
  const go = async () => {
    setBusy(true);
    try {
      const r = await post<{ id: number }>('/api/runs', { engine, cwd: cwd.trim(), input, branch: branch.trim(), unattended, ...(req ? { request: req.id } : {}) });
      if (wd.kind === 'ask') try { localStorage.setItem('edith.runs.cwd', cwd.trim()); } catch { /* 저장 안 됨 */ }
      setBranch(''); setUnattended(false);
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
  return (
    <>
      <button onClick={() => setOpen(v => !v)} className="mb-1 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[0.8125rem] font-medium hover:bg-muted/70">
        <Icon className="size-3.5">{PLAY}</Icon>새 런
      </button>
      {open && (
        <form onSubmit={e => { e.preventDefault(); void go(); }} className="mb-2 space-y-1.5 rounded-lg border bg-card p-2">
          {req && <p className="flex items-center gap-1 text-xs text-sky-700 dark:text-sky-400"><span className="min-w-0 flex-1 truncate">요청 {req.from ?? req.id} 에서 — 시작하면 요청에 런 번호로 답한다</span>
            <button type="button" className="shrink-0 underline-offset-2 hover:underline" onClick={done}>떼기</button></p>}
          <label className="block text-xs text-muted-foreground">엔진 · 체인
            <select value={engine} onChange={e => setEngine(e.target.value)} className={`mt-0.5 ${field}`}>
              <option value="">고르기</option>
              {/* 엔진을 위에 — 보통 돌리는 것은 엔진이고, 체인은 하나만 시험할 때 */}
              {engines.data?.engines.filter(e => !e.broken).sort((a, b) => Number(b.kind === 'engine') - Number(a.kind === 'engine'))
                .map(e => <option key={e.id} value={e.id}>{e.name} ({KIND[e.kind]} · {e.id})</option>)}
            </select>
          </label>
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
            ? <select value="" onChange={e => { const p = picks[Number(e.target.value)]; if (p) setInput(p.input); }} className={`${field} text-xs`} aria-label={eq.data.picks}>
                <option value="">{picks.length ? `${eq.data.picks} — ${picks.length}개` : `${eq.data.picks} — 없다`}</option>
                {picks.map((p, i) => <option key={i} value={i}>{p.label}{p.note ? ` · ${p.note}` : ''}</option>)}
              </select>
            : <Button type="button" size="sm" variant="outline" className="h-7 w-full text-xs" disabled={picking} onClick={() => void loadPicks()}>{picking ? '불러오는 중…' : eq.data.picks}</Button>)}
          <label className="block text-xs text-muted-foreground">입력 — 모든 노드에 같이 간다(예: 기획서 링크)
            <textarea value={input} onChange={e => setInput(e.target.value)} rows={3} className={`mt-0.5 resize-y ${field}`}
              onPaste={e => { const f = [...e.clipboardData.files]; if (!f.length) return; e.preventDefault(); upload(f).then(addPaths, (x: Error) => setErr(`올리지 못했다 — ${x.message}`)); }} /></label>
          <div className="flex items-center gap-1.5"><Attach onPaths={addPaths} /><span className="text-[0.6875rem] text-muted-foreground">파일을 올리면 그 경로가 입력 끝에 붙는다(붙여넣기도)</span></div>
          {/* 무인 — 기본 꺼짐. 켜면 확인 필요를 사람에게 넘기지 않고 다시 돌리거나 건너뛴다(엔진도 run.json · $EDITH_UNATTENDED 로 안다) */}
          <label className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={unattended} onChange={e => setUnattended(e.target.checked)} className="mt-0.5" />
            <span><span className="font-medium text-foreground">무인 — 사람 없이 끝까지</span> · 확인 필요가 되면 2번까지 다시 돌리고, 그래도 안 되면 건너뛰고 이어 간다. 권한 승인 화면은 그대로 기다린다</span>
          </label>
          {err && <p className="text-xs break-words text-destructive">{err}</p>}
          <Button type="submit" size="sm" className="h-7 w-full text-xs" disabled={busy || !engine || (wd.kind === 'ask' && !cwd.trim()) || (wd.kind === 'worktree' && !branch.trim())}>{busy ? '시작하는 중…' : '런 시작'}</Button>
          <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">{wd.kind === 'worktree' ? '레포에서 그 브랜치로 워크트리와 워크스페이스를 만들고' : 'herdr 에 「▶ 이름 #번호」 워크스페이스를 만들고 작업 폴더에서'} Claude 를 띄워 노드를 하나씩 보낸다. 시작할 때의 사본으로 돈다(공방에서 고쳐도 이 런은 그대로).</p>
        </form>
      )}
    </>
  );
}

type View = 'summary' | 'timeline' | 'canvas' | 'stats';
const VIEWS: [View, string][] = [['summary', '요약'], ['timeline', '타임라인'], ['canvas', '캔버스'], ['stats', '분석']];

function RunDetail({ r }: { r: Run }) {
  const qc = useQueryClient();
  const [sel, setSel] = useState<string | null>(null), [busy, setBusy] = useState(false), [armed, setArmed] = useState(''), [view, setView] = useState<View>('timeline'), [watch, setWatch] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(''), 3000); return () => clearTimeout(t); }, [armed]);
  // 요약이 있는 끝난 런은 「요약」 부터 — 런을 바꾸거나 런이 막 끝났을 때
  const hasSummary = !!r.summary;
  useEffect(() => { setView(hasSummary ? 'summary' : 'timeline'); }, [r.id, hasSummary]);
  const act = async (what: 'stop' | 'resume' | 'skip' | 'rewind', key?: string) => {
    setBusy(true);
    try { await post(`/api/runs/${r.id}/${what}`, key ? { key } : {}); await qc.invalidateQueries({ queryKey: ['run', r.id] }); await qc.invalidateQueries({ queryKey: ['runs'] }); }
    catch (e) { toast(`하지 못했다 — ${(e as Error).message}`, 5000); }
    setBusy(false);
  };
  const live = r.steps.filter(s => !s.fixOnly), done = live.filter(s => ['done', 'skipped'].includes(r.nodes[s.key].state)).length;
  const s = r.steps.find(x => x.key === sel), [first, ...more] = r.input.split('\n'), notion = notionUrl(r.input);
  const detail = (bare = false) => s ? <NodeDetail r={r} s={s} busy={busy} armed={armed} arm={setArmed} act={act} bare={bare} /> : null;
  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h1 className="text-lg font-bold">#{r.id} {r.name}</h1>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${RUN_TONE[r.state]}`}>{RUN_LABEL[r.state]}</span>
        {r.unattended && <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground" title="확인 필요를 사람에게 넘기지 않고 다시 돌리거나 건너뛴다">무인</span>}
        <span className="text-sm text-muted-foreground tabular-nums">{done}/{live.length}</span>
        <span className="h-1.5 w-28 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-emerald-500" style={{ width: `${live.length ? done / live.length * 100 : 0}%` }} /></span>
        {r.state !== 'done' && <span className="text-xs text-muted-foreground tabular-nums">{dur(Date.now() - r.created)}째</span>}
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
          {r.state === 'running' && <Button size="sm" variant="outline" className="h-7 text-xs text-destructive" disabled={busy} onClick={() => void act('stop')}>멈춤</Button>}
          {(r.state === 'check' || r.state === 'stopped') && <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void act('resume')}>이어서</Button>}
          {r.state === 'queued' && <>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => void act('stop')}>줄에서 빼기</Button>
            <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void act('resume')} title="동시 런 한도를 넘어 지금 시작한다">지금 시작</Button>
          </>}
        </span>
      </div>
      <Phases r={r} />
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
      </details>
      {r.state === 'queued' && (
        <p className="rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-sm text-violet-800 dark:text-violet-300">
          줄 서 있다 — 동시에 도는 런이 한도(설정 「런」)에 찼다. 도는 런이 끝나면 먼저 온 것부터 시작한다. 「지금 시작」 은 한도를 넘어 바로 시작한다.
        </p>
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
      {view !== 'summary' && <>
        {r.actions.length > 0 && <Actions r={r} />}
        <div className="grid gap-3 md:grid-cols-[repeat(auto-fit,minmax(20rem,1fr))]"><Repos id={r.id} /><Outputs id={r.id} /></div>
      </>}
      {r.live && watch && <Live id={r.id} />}
      {view === 'summary' && r.summary ? <SummaryView r={r} s={r.summary} toTimeline={() => setView('timeline')} />
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
  const press = async (label: string) => {
    const n = r.actions.findIndex(a => a.label === label);
    setBusy(true);
    try { await post(`/api/runs/${r.id}/action`, { n, text: '' }); await qc.invalidateQueries({ queryKey: ['run', r.id] }); }
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
                  {a && <Button size="sm" variant={on ? 'default' : 'outline'} className="mt-auto h-7 self-start text-xs" disabled={!on || busy || !!a.ask}
                    title={a.ask ? '글을 받는 단추 — 아래 「런 단추」 줄에서' : a.hint} onClick={() => void press(a.label)}>{a.label}</Button>}
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
      {r.actions.length > 0 && <Actions r={r} />}
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
function Repos({ id }: { id: number }) {
  const q = useQuery({ queryKey: ['run-repos', id], queryFn: () => get<Repo[]>(`/api/runs/${id}/repos`), refetchInterval: 15_000 });
  const [diff, setDiff] = useState<number | null>(null);
  const d = useQuery({ queryKey: ['run-repo-diff', id, diff], queryFn: () => get<{ name: string; from: string; text: string }>(`/api/runs/${id}/repos/${diff}/diff`), enabled: diff !== null });
  if (!q.data?.length) return null;
  const chip = 'rounded-full px-2 py-px text-[0.6875rem] font-semibold';
  return (
    <section className="rounded-lg border bg-card px-3 py-2 text-sm">
      <p className="mb-1 text-xs font-semibold text-muted-foreground">레포 — 커밋 상태(15초마다 git 에서 읽는다)</p>
      <ul className="space-y-1">
        {q.data.map((x, i) => (
          <li key={x.path} title={x.path} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold">{x.name}</span>
            {x.head && <span className={`font-mono text-xs ${x.branch && x.branch !== x.head ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>{x.head}{x.branch && x.branch !== x.head ? ` (엔진은 ${x.branch})` : ''}</span>}
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
function Sheet({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; d?.showModal(); return () => d?.close(); }, []);
  return (
    <dialog ref={ref} onClose={onClose} onClick={e => { if (e.target === ref.current) onClose(); }} aria-label={title}
      className="m-auto w-[min(64rem,94vw)] max-w-none rounded-xl border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/40">
      <div className="flex items-center gap-3 border-b px-4 py-2.5">
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{title}</span>{sub && <span className="block truncate font-mono text-xs text-muted-foreground">{sub}</span>}</span>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onClose}>닫기</Button>
      </div>
      <div className="max-h-[80vh] overflow-auto px-4 py-3">{children}</div>
    </dialog>
  );
}

// 산출물 — 엔진이 작업 문서에 남긴 edith-outputs.json(서버 src/outputs.ts). 파일은 누르면 보기 창(.md 는 글로), 주소는 새 탭
type OutputItem = { label: string; path?: string; url?: string; node?: string; note?: string; error?: string };
const useOutputs = (id: number) => useQuery({ queryKey: ['run-outputs', id], queryFn: () => get<OutputItem[]>(`/api/runs/${id}/outputs`), refetchInterval: 15_000 });
function Outputs({ id }: { id: number }) {
  const q = useOutputs(id);
  if (!q.data?.length) return null;
  return (
    <section className="rounded-lg border bg-card px-3 py-2 text-sm">
      <p className="mb-1 text-xs font-semibold text-muted-foreground">산출물 {q.data.length} — 엔진이 남긴 문서 · 주소(누르면 본다)</p>
      <OutputChips id={id} items={q.data.map((o, i) => [o, i])} />
    </section>
  );
}
function OutputChips({ id, items }: { id: number; items: [OutputItem, number][] }) {
  const [view, setView] = useState<number | null>(null);
  const one = useQuery({ queryKey: ['run-output', id, view], queryFn: () => get<{ label: string; path: string; text: string }>(`/api/runs/${id}/outputs/${view}`), enabled: view !== null });
  const cls = 'rounded-md border bg-background px-2 py-0.5 text-xs hover:border-primary/60 disabled:opacity-50';
  return (
    <>
      <span className="flex flex-wrap gap-1.5">
        {items.map(([o, i]) => o.url
          ? <a key={i} href={o.url} target="_blank" rel="noreferrer" className={cls}>{o.label} ↗{o.note && <span className="text-muted-foreground"> · {o.note}</span>}</a>
          : <button key={i} type="button" disabled={!!o.error} title={o.error ?? o.path} onClick={() => setView(i)} className={cls}>{o.label}{o.note && <span className="text-muted-foreground"> · {o.note}</span>}</button>)}
      </span>
      {view !== null && (
        <Sheet title={items.find(([, i]) => i === view)?.[0].label ?? ''} sub={one.data?.path} onClose={() => setView(null)}>
          {one.isLoading ? <Empty>읽는 중…</Empty> : one.error ? <Empty>{(one.error as Error).message}</Empty>
            : one.data && (/\.(md|markdown)$/i.test(one.data.path) ? <Md text={one.data.text} /> : <pre className="code-panel whitespace-pre-wrap">{one.data.text}</pre>)}
        </Sheet>
      )}
    </>
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
          {n.state !== 'wait' && !s.fixOnly && (
            <Button size="sm" variant="outline" disabled={busy || r.state === 'running'} title={r.state === 'running' ? '도는 중에는 못 한다 — 「멈춤」 뒤에' : '이 노드와 뒤에 이어진 노드를 처음으로 돌려 여기서부터 다시 돈다(작업 문서는 그대로)'}
              className={`h-7 text-xs ${armed === s.key ? 'border-amber-500 bg-amber-500 text-white hover:bg-amber-500/90' : ''}`}
              onClick={() => { if (armed !== s.key) return arm(s.key); arm(''); void act('rewind', s.key); }}>{armed === s.key ? '뒤 노드도 처음으로 — 한 번 더' : '이 노드부터 다시'}</Button>
          )}
          {['check', 'stopped', 'wait'].includes(n.state) && !s.fixOnly && (
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

// 흐름 — 벽시계로 일 · 사람 · 멈춤 · 빈 시간(갈래가 겹쳐 돈 시간은 한 번), 긴 사람 · 빈 구간과 무엇을 기다렸는지
const FLOW = { work: ['일', 'bg-sky-500'], human: ['사람 대기', 'bg-amber-500'], stop: ['멈춤', 'bg-muted-foreground/60'], idle: ['빈 시간', 'bg-muted-foreground/25'] } as const;
function Flow({ a }: { a: Stats }) {
  const f = a.flow!, all = f.work + f.human + f.stop + f.idle || 1, name = (k: string) => a.nodes.find(x => x.key === k)?.title ?? k;
  return (
    <div className="space-y-2">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
        {(['work', 'human', 'stop', 'idle'] as const).map(k => f[k] > 0 && <span key={k} title={`${FLOW[k][0]} ${dur(f[k])}`} className={FLOW[k][1]} style={{ width: `${f[k] / all * 100}%` }} />)}
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {(['work', 'human', 'stop', 'idle'] as const).map(k => f[k] > 0 && <span key={k} className="flex items-center gap-1.5"><span className={`size-2 rounded-full ${FLOW[k][1]}`} />{FLOW[k][0]} <b className="tabular-nums">{dur(f[k])}</b> <span className="text-muted-foreground tabular-nums">{Math.round(f[k] / all * 100)}%</span></span>)}
      </p>
      {f.spans.length > 0 && (
        <ul className="space-y-0.5 text-xs">
          {f.spans.map(s => (
            <li key={s.from} className="flex gap-2"><span className="w-24 shrink-0 text-muted-foreground tabular-nums">{hhmm(s.from)}–{hhmm(s.to)}</span>
              <span className={`w-16 shrink-0 font-semibold ${s.kind === 'human' ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>{FLOW[s.kind][0]}</span>
              <span className="w-20 shrink-0 tabular-nums">{dur(s.to - s.from)}</span>
              <span className="min-w-0 truncate text-muted-foreground">{s.keys.map(name).join(' · ') || '도는 노드 없음'}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

// 갈래 — 갈래마다 시작 · 끝 · 일한 · 사람 시간과 합침에서 기다린 시간. 가장 늦게 끝난 갈래가 병목
function Lanes({ a }: { a: Stats }) {
  const late = Math.max(...a.lanes.map(l => l.last ?? 0)), cell = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap';
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="border-b text-muted-foreground"><tr><th className="px-2 py-1.5 text-left">갈래</th><th className={cell}>시작</th><th className={cell}>끝</th><th className={cell}>일한 시간</th><th className={cell}>사람 대기</th><th className={cell}>합침에서 기다림</th></tr></thead>
        <tbody>
          {a.lanes.map(l => (
            <tr key={l.track} className="border-b last:border-0">
              <td className="px-2 py-1.5 font-mono">{l.track}{l.last === late && a.lanes.length > 1 && <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 font-sans text-[0.625rem] font-bold text-amber-800 dark:text-amber-300">병목</span>}</td>
              <td className={cell}>{l.first ? hhmm(l.first) : ''}</td><td className={cell}>{l.last ? hhmm(l.last) : ''}</td>
              <td className={cell}>{dur(l.work)}</td><td className={cell}>{l.human ? dur(l.human) : ''}</td>
              <td className={`${cell} ${l.waited ? 'font-semibold text-amber-700 dark:text-amber-400' : ''}`}>{l.waited ? dur(l.waited) : l.waited === 0 ? '—' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 같은 엔진 런 비교 — 최근 6개를 나란히, 큰 단계마다 걸린 시간(처음 시작~마지막 끝) · 전체 · 사람 대기. 이 런은 굵게
function Compare({ a, cut }: { a: Stats; cut: (n: string) => string }) {
  const names = [...new Set(a.compare.flatMap(x => x.phases.map(p => p.name)))], cell = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap';
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="border-b text-muted-foreground"><tr><th className="px-2 py-1.5 text-left">단계</th>{a.compare.map(x => <th key={x.id} className={`${cell} ${x.id === a.id ? 'text-foreground' : ''}`}><a href={`#/runs/${x.id}`} className="hover:underline">#{x.id}</a></th>)}</tr></thead>
        <tbody>
          {names.map(n => (
            <tr key={n} className="border-b">
              <td className="px-2 py-1.5" title={n}>{cut(n)}</td>
              {a.compare.map(x => { const p = x.phases.find(y => y.name === n); return <td key={x.id} className={`${cell} ${x.id === a.id ? 'font-semibold' : ''}`}>{p ? dur(p.ms) : ''}</td>; })}
            </tr>
          ))}
          <tr className="border-b"><td className="px-2 py-1.5 font-semibold">전체</td>{a.compare.map(x => <td key={x.id} className={`${cell} font-semibold`}>{dur(x.elapsed)}</td>)}</tr>
          <tr><td className="px-2 py-1.5 text-amber-700 dark:text-amber-400">사람 대기</td>{a.compare.map(x => <td key={x.id} className={`${cell} text-amber-700 dark:text-amber-400`}>{x.human ? dur(x.human) : ''}</td>)}</tr>
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
        return (
          <div key={x.key} className="text-xs">
            <p className="flex items-baseline gap-2"><span className="min-w-0 truncate font-semibold">{x.title}</span><span className="text-muted-foreground">{x.place}</span><span className="ml-auto tabular-nums">{dur(span)}</span></p>
            <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-muted">
              <span className="bg-sky-500" style={{ width: `${model / span * 100}%` }} title={`모델 ${dur(model)}`} />
              <span className="bg-violet-500" style={{ width: `${tool / span * 100}%` }} title={`도구 ${dur(tool)}`} />
              <span className="bg-amber-500" style={{ width: `${ask / span * 100}%` }} title={`질문 창(사람) ${dur(ask)}`} />
            </div>
            <p className="mt-0.5 text-muted-foreground">모델 {dur(model)} · 도구 {dur(tool)}{ask ? ` · 질문 창(사람) ${dur(ask)}` : ''}{tools.length ? ` — ${tools.map(([k, v]) => `${k} ${dur(v)}`).join(' · ')}` : ''}</p>
          </div>
        );
      })}
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
  const q = useQuery({ queryKey: ['run-stats', id], queryFn: () => get<Stats>(`/api/runs/${id}/analysis`), refetchInterval: 10_000 });
  const [open, setOpen] = useState<Set<string>>(new Set());
  // 「먼저 볼 것」 에서 노드를 고르면 그 노드 줄로 — 단계는 고른 노드가 들어 있으면 펼친다
  useEffect(() => { if (sel) document.getElementById(`stat-${sel}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [sel]);
  if (!q.data) return <Empty>{q.error ? `분석을 읽지 못했다 — ${String(q.error)}` : '분석하는 중…'}</Empty>;
  const a = q.data, rows = a.nodes.filter(x => x.attempts > 0), sum = (f: (x: StatNode) => number) => a.nodes.reduce((t, x) => t + f(x), 0);
  const ps = byPhase(a), cut = dropShared(ps.map(p => p.name)), max = Math.max(1, ...ps.map(p => p.ms), ...a.nodes.map(x => x.time?.work ?? 0));
  const human = sum(x => x.time?.human ?? 0), codexOut = Object.values(a.codex.nodes).reduce((s, x) => s + x.out, 0);
  const tiles: [string, string, string][] = [
    ['걸린 시간', dur(a.elapsed), a.flow ? `일 ${dur(a.flow.work)} · 빈 시간 ${dur(a.flow.idle)}` : `노드가 일한 시간 합 ${dur(sum(x => x.time?.work ?? 0))}`],
    ['사람 대기', dur(human), human ? `런의 ${Math.round(human / (a.elapsed || 1) * 100)}%` : '사람을 기다리지 않았다'],
    ['다시 돈 시간', dur(a.redo.again + a.redo.fixing), `되돌림 ${a.rewinds.length}번 · 고치는 노드 ${dur(a.redo.fixing)}`],
    ['Claude 입력 토큰', big(sum(x => x.tokens ? inTok(x.tokens) : 0)),
      `출력 ${big(sum(x => x.tokens?.output ?? 0))}${codexOut ? ` · Codex 출력 ${big(codexOut)}` : ''}${a.codex.weekly ? ` · Codex 주간 ${a.codex.weekly[0]}→${a.codex.weekly[1]}%` : ''}`],
  ];
  const cols = [...new Set(a.records.flatMap(o => Object.keys(o)))].slice(0, 8), cell = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap';
  const toggle = (n: string) => setOpen(o => { const s = new Set(o); if (!s.delete(n)) s.add(n); return s; });
  const tags = (x: StatNode) => [x.state !== 'done' && NODE[x.state as NodeState][0], x.attempts > 1 && `시도 ${x.attempts}`, x.fails > 0 && `고침 ${x.fails}`, x.time?.human && `사람 ${dur(x.time.human)}`].filter(Boolean).join(' · ');
  return (
    <div className="space-y-3">
      {!a.timed && <p className="text-xs text-muted-foreground">이 런은 시간 기록(events.jsonl)이 생기기 전에 돌아 시간이 비어 있다.</p>}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {tiles.map(([k, v, sub]) => (
          <div key={k} className="rounded-xl border bg-card px-3 py-2">
            <p className="text-xs text-muted-foreground">{k}</p>
            <p className={`text-lg font-bold tabular-nums ${k === '사람 대기' && human ? 'text-amber-700 dark:text-amber-400' : ''}`}>{v}</p>
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
        <p className="px-3 pt-2.5 pb-1.5 text-xs font-semibold text-muted-foreground">단계별 시간 — 단계는 처음 시작부터 마지막 끝까지, 노드는 일한 시간. 단계를 누르면 그 안의 노드, 노드를 누르면 자세히</p>
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
                          <span className={`w-28 shrink-0 truncate text-right ${x.fails || x.time?.human ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>{tags(x)}</span>
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
        {a.flow && <Fold title="흐름" hint="런 시간이 일 · 사람 대기 · 빈 시간으로 어떻게 나뉘었나, 긴 대기 구간"><Flow a={a} /></Fold>}
        {a.lanes.length > 0 && <Fold title="갈래" hint={`갈래마다 시작 · 끝, 먼저 끝난 갈래가 합치는 노드${a.lanes[0].join ? `(${a.nodes.find(x => x.key === a.lanes[0].join)?.title ?? a.lanes[0].join})` : ''} 앞에서 기다린 시간`}><Lanes a={a} /></Fold>}
        {insideTop(a).length > 0 && <Fold title="노드 안쪽" hint="오래 걸린 노드에서 Claude 가 생각한 시간과 도구가 돈 시간"><Inside a={a} /></Fold>}
        {a.compare.length > 1 && <Fold title="같은 엔진 런 비교" hint={`최근 ${a.compare.length}개 런의 단계별 걸린 시간`}><Compare a={a} cut={cut} /></Fold>}
        <Fold title="노드 표" hint={`돈 노드 ${rows.length}개의 시도 · 시간 · 토큰 · Claude 설정(안 돈 ${a.nodes.length - rows.length}개는 뺐다)`}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b text-muted-foreground">
                <tr className="whitespace-nowrap"><th className="px-2 py-1.5 text-left">노드</th><th className="px-2 py-1.5 text-left">결과</th><th className={cell}>시도</th><th className={cell}>고침</th><th className={cell}>되돌려 옴</th>
                  <th className={cell}>일한 시간</th><th className={cell}>사람 대기</th><th className={cell}>입력 토큰</th><th className={cell}>출력</th><th className={cell}>Codex 출력</th><th className="px-2 py-1.5 text-left">모델</th><th className="px-2 py-1.5 text-left">Claude 설정 · 이유</th></tr>
              </thead>
              <tbody>
                {rows.map(x => (
                  <tr key={x.key} className="border-b last:border-0">
                    <td className="min-w-48 px-2 py-1.5"><span className="text-muted-foreground">{x.place} › </span>{x.title}<span className="ml-1.5 font-mono text-[0.625rem] text-muted-foreground">{x.key}</span></td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{NODE[x.state as NodeState][0]}</td>
                    <td className={cell}>{x.attempts}</td><td className={cell}>{x.fails || ''}</td><td className={cell}>{x.rewound || ''}</td>
                    <td className={cell}>{x.time ? dur(x.time.work) : ''}</td>
                    <td className={`${cell} ${x.time?.human ? 'text-amber-700 dark:text-amber-400' : ''}`}>{x.time?.human ? dur(x.time.human) : ''}</td>
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

// 런 단추 — 맨 위 엔진 폴더의 actions.json. 단추에 마우스를 올리면 설명(hint, 없으면 돌릴 명령)이 보인다. ask 가 있으면 글을 받아 같이 넘긴다.
// 지우는 단추(danger)는 빨강으로 맨 끝에 떼어 둔다 — 다른 단추와 헷갈려 누르지 않게
function Actions({ r }: { r: Run }) {
  const qc = useQueryClient(), [ask, setAsk] = useState<number | null>(null), [text, setText] = useState(''), [busy, setBusy] = useState(false);
  const go = async (n: number) => {
    setBusy(true);
    try { await post(`/api/runs/${r.id}/action`, { n, text }); setAsk(null); setText(''); await qc.invalidateQueries({ queryKey: ['run', r.id] }); }
    catch (e) { toast(`하지 못했다 — ${(e as Error).message}`, 5000); }
    setBusy(false);
  };
  const doing = r.acted.some(a => a.code === null), last = r.acted[0];
  const how = (a: Run['acted'][number]) => `${a.code === null ? '도는 중' : a.code === 0 ? '끝' : `끝 코드 ${a.code}`}${a.note ? ` · ${a.note}` : ''}`;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-semibold text-muted-foreground" title="엔진이 준 단추 — 마우스를 올리면 무엇을 하는지">런 단추</span>
        {/* 지우는 단추 앞 가름 — order-last 끼리는 DOM 차례라 단추보다 먼저 둔다 */}
        {r.actions.some(a => a.danger) && <span className="order-last mx-1 h-4 w-px bg-border" aria-hidden />}
        {r.actions.map((a, i) => (a.when === 'done' && r.state !== 'done') ? null : (
          <Button key={i} size="sm" variant={ask === i ? 'default' : 'outline'} disabled={busy || doing} title={a.hint ?? `$ ${a.command}`}
            className={`h-7 text-xs ${a.danger ? `order-last ${ask === i ? '' : 'text-destructive hover:text-destructive'}` : ''}`}
            onClick={() => a.ask ? setAsk(ask === i ? null : i) : void go(i)}>{a.label}</Button>
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
                <p className="text-xs text-muted-foreground tabular-nums">{when(a.at)} · 「{a.label}」{a.text ? ` · ${a.text}` : ''} — {how(a)}</p>
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
        {p?.status && STATUS[p.status] && <Tag v={p.status}>{STATUS[p.status]}</Tag>}
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
