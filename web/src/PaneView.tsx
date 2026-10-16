// 고른 pane 화면 — 머리(브랜치·사용량·원격·변경·배치 바꾸기), 본문(대화·셸 기록·터미널), 탭 전체 칸 배치, 입력칸.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, type HerdrView, type HPane, type HSplit } from './api.ts';
import { COPY, Icon, Tag, TERMINAL } from './ui.tsx';
import { openMenu } from './Menu.tsx';
import { copyText, toast } from './copy.ts';
import { PaneDiff } from './Diff.tsx';
import { BgTasks } from './Tasks.tsx';
import { Chat } from './Chat.tsx';
import { ShellLog } from './ShellLog.tsx';
import { QuickKeys, Term } from './Term.tsx';
import { PromptBox } from './Prompt.tsx';
import { DOT, DRAG_PANE, Kind, REMOTE, STATUS, carrying, paneText, useMove, usePaneMenu, useTabMenu } from './herdrUi.tsx';

const GIT_COMPARE = <><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M13 6h3a2 2 0 0 1 2 2v7" /><path d="M11 18H8a2 2 0 0 1-2-2V9" /></>;   // lucide git-compare

// 브랜치 — 이 pane 폴더의 브랜치. 링크 워크트리면 그 워크트리 브랜치와 원본 레포(메인 체크아웃) 브랜치도.
// pane 이 워크트리 밖 폴더에 있으면 그 폴더 브랜치를 따로 보인다. 10초마다 다시 읽는다.
type Br = { root: string; branch: string };
const BRANCH = <><line x1="6" x2="6" y1="3" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></>;   // lucide git-branch
function Branches({ p }: { p: HPane }) {
  const { data: b } = useQuery({
    queryKey: ['branch', p.id], refetchInterval: 10_000,
    queryFn: () => get<{ here: Br | null; worktree: Br | null; repo: (Br & { name: string }) | null }>(`/api/herdr/panes/${p.id}/branch`),
  });
  if (!b) return null;
  // 누르면 브랜치 이름을 클립보드로(분리된 HEAD 면 괄호 뺀 커밋 id)
  const chip = (label: string, br: Br, tone: string) => (
    <button key={label + br.root} onClick={() => void copyText(br.branch.replace(/^\((.*)\)$/, '$1'))} title={`${br.root}\n누르면 브랜치 이름 복사`}
      className={`group flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs transition hover:brightness-95 dark:hover:brightness-125 ${tone}`}>
      <Icon className="size-3">{BRANCH}</Icon>{label && <span className="opacity-70">{label}</span>}<span className="font-mono font-semibold">{br.branch}</span>
      <Icon className="size-3 opacity-40 group-hover:opacity-100">{COPY}</Icon>
    </button>
  );
  return <>
    {b.worktree ? chip('워크트리', b.worktree, 'bg-primary/10 text-primary') : b.here && chip('', b.here, 'bg-muted text-foreground')}
    {b.worktree && b.here && b.here.root !== b.worktree.root && chip('이 pane', b.here, 'bg-muted text-foreground')}
    {b.repo && chip(`원본 ${b.repo.name}`, b.repo, 'bg-muted/70 text-muted-foreground')}
  </>;
}

// 사용량 — Claude·Codex 의 모델·생각 강도, 컨텍스트 %, 5시간·7일 한도 %(Claude 는 상태줄, Codex 는 세션 기록에서). 50% 넘으면 주황, 80% 넘으면 빨강.
// short 면(칸 머리처럼 좁은 곳) 남은 시간은 마우스를 올렸을 때만, 칸 폭이 좁으면 모델 → 5h·7d → ctx 순으로 숨긴다(칸 머리가 @container).
type Lim = { pct: number; reset: string | null };
function Usage({ p, short }: { p: HPane; short?: boolean }) {
  const { data: u } = useQuery({
    queryKey: ['usage', p.id], enabled: p.agent === 'claude' || p.agent === 'codex', refetchInterval: p.status === 'working' ? 5000 : 15000,
    queryFn: () => get<{ model: string | null; effort: string | null; ctx: number | null; five: Lim | null; week: Lim | null } | null>(`/api/herdr/panes/${p.id}/usage`),
  });
  if (!u) return null;
  // 넓은 곳(pane 머리)은 막대가 있는 카드 — 50% 넘으면 주황, 80% 넘으면 빨강
  if (!short) {
    const bar = (n: number) => n >= 80 ? 'bg-rose-500' : n >= 50 ? 'bg-amber-500' : 'bg-primary';
    const card = (label: string, n: number | null | undefined, reset: string | null | undefined, what: string) => n == null ? null : (
      <span key={label} title={`${what} ${n}%${reset ? ` · 다시 차기까지 ${reset}` : ''}`} className="flex min-w-24 flex-col justify-center gap-1 rounded-lg border bg-card px-2.5 py-1 shadow-xs">
        <span className="flex items-baseline gap-2 whitespace-nowrap"><span className="text-muted-foreground">{label}</span><span className="ml-auto font-semibold text-foreground tabular-nums">{n}%</span></span>
        <span className="block h-1 overflow-hidden rounded-full bg-muted"><span className={`block h-full rounded-full ${bar(n)}`} style={{ width: `${Math.min(100, n)}%` }} /></span>
      </span>
    );
    return (
      <span className="flex shrink-0 flex-wrap items-stretch gap-1.5 text-[0.6875rem] font-normal">
        {u.model && (
          <span title={`모델 ${u.model}${u.effort ? ` · 생각 강도 ${u.effort}` : ''}`} className="flex items-center gap-2 rounded-lg border bg-card px-2.5 py-1 whitespace-nowrap shadow-xs">
            <span className="text-muted-foreground">모델</span><span className="font-semibold text-foreground">{u.model}</span>
            {u.effort && <span className="rounded bg-muted px-1 text-[0.625rem] leading-4 text-muted-foreground">{u.effort}</span>}
          </span>
        )}
        {card('컨텍스트', u.ctx, null, '컨텍스트')}{card('5시간', u.five?.pct, u.five?.reset, '5시간 한도')}{card('7일', u.week?.pct, u.week?.reset, '7일 한도')}
      </span>
    );
  }
  const tone = (n: number) => n >= 80 ? 'text-rose-600 dark:text-rose-400' : n >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400';
  const fit = (cls: string) => short ? `hidden ${cls}` : 'flex';
  const item = (label: string, n: number | null | undefined, reset: string | null | undefined, what: string, cls: string) => n == null ? null : (
    <span key={label} title={`${what} ${n}%${reset ? ` · 다시 차기까지 ${reset}` : ''}`} className={`${fit(cls)} items-center gap-1 whitespace-nowrap`}>
      <span className="text-muted-foreground">{label}</span><span className={`font-semibold tabular-nums ${tone(n)}`}>{n}%</span>
      {!short && reset && <span className="text-muted-foreground/70 tabular-nums">{reset}</span>}
    </span>
  );
  return (
    <span className="flex shrink-0 items-center gap-2 text-[0.6875rem] font-normal">
      {u.model && (
        <span title={`모델 ${u.model}${u.effort ? ` · 생각 강도 ${u.effort}` : ''}`} className={`${fit('@2xl:flex')} items-center gap-1 whitespace-nowrap`}>
          <span className="font-semibold text-foreground/80">{u.model}</span>
          {u.effort && <span className="rounded bg-muted px-1 text-[0.625rem] leading-4 text-muted-foreground">{u.effort}</span>}
        </span>
      )}
      {item(short ? 'ctx' : '컨텍스트', u.ctx, null, '컨텍스트', '@xs:flex')}{item('5h', u.five?.pct, u.five?.reset, '5시간 한도', '@lg:flex')}{item('7d', u.week?.pct, u.week?.reset, '7일 한도', '@lg:flex')}
    </span>
  );
}

// Remote Control — Claude pane 을 claude.ai·Claude 앱에서 이어 쓸 수 있게 켜 뒀는지(서버 chat.ts remoteControl). 켜져 있으면 claude.ai 에서
// 그 세션을 여는 링크, 꺼져 있으면 「원격 켜기」 — /remote-control 을 보낸다. 켜진 세션에 보내면 상태 패널이 떠 입력을 막아서 꺼져 있을 때만 보인다.
function Remote({ p }: { p: HPane }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['remote', p.id], enabled: p.agent === 'claude', refetchInterval: 15000,
    queryFn: () => get<{ url: string | null } | null>(`/api/herdr/panes/${p.id}/remote`),
  });
  if (!data) return null;
  const cls = 'flex h-7 items-center gap-1.5 rounded-md border bg-card px-2 text-xs font-semibold transition hover:bg-muted';
  if (data.url) return (
    <a href={data.url} target="_blank" rel="noopener noreferrer" title="Remote Control 켜짐 — claude.ai 에서 이 세션 열기" className={cls}>
      <span className="size-1.5 rounded-full bg-emerald-500" /><Icon className="size-3.5">{REMOTE}</Icon>원격
    </a>
  );
  const on = () => post(`/api/herdr/panes/${p.id}/prompt`, { text: '/remote-control' })
    .then(() => setTimeout(() => void qc.invalidateQueries({ queryKey: ['remote', p.id] }), 2000), (e: Error) => toast(`켜지 못했다 — ${e.message}`, 4000));
  return (
    <button onClick={() => void on()} disabled={p.status === 'working'} title={p.status === 'working' ? '일이 끝나면 켤 수 있다' : 'Remote Control 켜기 — claude.ai·Claude 앱에서 이 세션을 이어 쓴다'}
      className={`${cls} text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50`}>
      <Icon className="size-3.5">{REMOTE}</Icon>원격 켜기
    </button>
  );
}

export function PaneView({ p, data }: { p: HPane; data: HerdrView }) {
  const ws = data.workspaces.find(w => w.workspace_id === p.workspace), tab = data.tabs.find(t => t.tab_id === p.tab);
  const lay = data.layouts.find(l => l.tab === p.tab), multi = (lay?.panes.length ?? 1) > 1;
  const [mode, setMode] = useState<'tab' | 'one'>('tab'), [diffOn, setDiffOn] = useState(false), tabMenu = useTabMenu();
  // 끝남(초록)인 pane 을 브라우저에서 보고 있으면 herdr 에 포커스를 줘 「봤다」 로 바꾼다 — 터미널 herdr 화면도 그 pane 으로 간다.
  // 브라우저 탭이 안 보이는 동안은 보는 게 아니라 하지 않고, 다시 보이면 그때 한다.
  const qc = useQueryClient();
  useEffect(() => {
    const seen = () => {
      if (p.status === 'done' && document.visibilityState === 'visible')
        void post(`/api/herdr/panes/${p.id}/focus`, {}).then(() => qc.invalidateQueries({ queryKey: ['herdr'] })).catch(() => undefined);
    };
    seen();
    document.addEventListener('visibilitychange', seen);
    return () => document.removeEventListener('visibilitychange', seen);
  }, [p.id, p.status, qc]);
  const pick = (m: typeof mode, label: string) =>
    <button onClick={() => setMode(m)} className={`rounded-md px-2.5 py-1 text-xs ${mode === m ? 'bg-card font-semibold text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>;
  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold tracking-tight" onContextMenu={e => ws && tab && openMenu(e, tabMenu(ws, tab))}>{ws?.label}</h1>
          <Branches p={p} />
          {tab && (ws?.tab_count ?? 1) > 1 && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground" onContextMenu={e => ws && openMenu(e, tabMenu(ws, tab))}>탭 {tab.label}</span>}
          {p.status && STATUS[p.status] && <Tag v={p.status}>{STATUS[p.status]}</Tag>}
          <span className="ml-auto flex items-center gap-1">
            <BgTasks p={p} /><Remote p={p} />
            <button onClick={() => setDiffOn(v => !v)} title="이 pane 폴더(git)의 코드 변경"
              className={`flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-semibold transition ${diffOn ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted'}`}>
              <Icon className="size-3.5">{GIT_COMPARE}</Icon>{diffOn ? '변경 닫기' : '변경'}
            </button>
            <RawToggle p={p} /><PaneActions p={p} />
          </span>
        </div>
        {/* 둘째 줄 하나에 pane 이름·사용량·경로(홈은 ~, 길면 자름 — 복사는 전체 경로)·칸 보기 전환을 모아 본문 자리를 넓힌다 */}
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
          <Kind agent={p.agent} /><span className="shrink-0 text-foreground">{paneText(p)}</span>
          <span className="shrink-0">{p.name && `· ${p.name} `}· {p.id}</span>{/* 종류(claude·codex)는 앞 아이콘이 보여 준다 */}
          <span className="ml-1.5 min-w-0 truncate font-mono text-xs" title={p.cwd}>{p.cwd.replace(/^\/(Users|home)\/[^/]+|^[A-Za-z]:\\Users\\[^\\]+/, '~')}</span>
          <button onClick={() => void copyText(p.cwd)} title="경로 복사" className="shrink-0 rounded p-0.5 text-muted-foreground/70 hover:bg-muted hover:text-foreground"><Icon className="size-3.5">{COPY}</Icon></button>
          <span className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
            {/* 탭 전체 칸 보기면 칸마다 머리에 사용량이 있으니 여기서는 뺀다(중복) — 이 pane 만 볼 때만 여기 */}
            {!(multi && mode === 'tab' && !diffOn) && <Usage p={p} />}
            {multi && !diffOn && <div className="flex shrink-0 gap-0.5 rounded-lg bg-muted p-0.5">{pick('tab', `탭 전체 ${lay!.panes.length}칸`)}{pick('one', '이 pane 만')}</div>}
          </span>
        </div>
      </div>
      <div className="min-h-80 flex-1">{diffOn ? <PaneDiff p={p} /> : multi && mode === 'tab' ? <TabLayout lay={lay!} data={data} sel={p.id} /> : <Body p={p} />}</div>
      <PromptBox key={p.id} p={p} label={multi && mode === 'tab' ? paneText(p) : undefined} />
    </div>
  );
}

// 칸 경계 — 끌면 그 나눔의 비율을 바꾼다(놓을 때 herdr 에 보낸다). 끄는 동안은 선만 움직인다.
function Divider({ sp, tab, box }: { sp: HSplit; tab: string; box: React.RefObject<HTMLDivElement | null> }) {
  const qc = useQueryClient();
  const [drag, setDrag] = useState<number | null>(null);
  const v = sp.dir === 'right', r = drag ?? sp.ratio;
  const at = (e: React.PointerEvent) => {
    const b = box.current!.getBoundingClientRect();
    const f = v ? ((e.clientX - b.left) / b.width - sp.x) / sp.w : ((e.clientY - b.top) / b.height - sp.y) / sp.h;
    return Math.min(0.9, Math.max(0.1, f));
  };
  const style = v
    ? { left: `calc(${(sp.x + r * sp.w) * 100}% - 4px)`, top: `${sp.y * 100}%`, height: `${sp.h * 100}%`, width: 8 }
    : { top: `calc(${(sp.y + r * sp.h) * 100}% - 4px)`, left: `${sp.x * 100}%`, width: `${sp.w * 100}%`, height: 8 };
  return (
    <div style={style} title="끌어서 칸 크기 조절"
      className={`absolute z-10 rounded ${v ? 'cursor-col-resize' : 'cursor-row-resize'} ${drag !== null ? 'bg-sky-500/60' : 'hover:bg-sky-500/30'}`}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setDrag(sp.ratio); }}
      onPointerMove={e => { if (drag !== null) setDrag(at(e)); }}
      onPointerUp={() => {
        if (drag === null) return;
        void post(`/api/herdr/tabs/${tab}/ratio`, { path: sp.path, ratio: drag })
          .then(() => qc.invalidateQueries({ queryKey: ['herdr'] })).finally(() => setDrag(null));
      }} />
  );
}

// 배치 바꾸기 — 이 칸 옆에 새 칸(왼·오·위·아래), 닫기(한 번 더 눌러야 닫힌다 — 안에서 돌던 것이 끝난다).
// herdr 배치를 바꾸므로 터미널 herdr 화면도 같이 바뀐다. 새 칸으로 옮겨 간다.
// 칸 나누기 방향 화살표(lucide arrow-*)
const SPLIT: Record<string, ReactNode> = {
  left: <><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></>, right: <><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>,
  up: <><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></>, down: <><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></>,
};
function PaneActions({ p }: { p: HPane }) {
  const qc = useQueryClient();
  const [sure, setSure] = useState(false), [err, setErr] = useState('');
  const act = async (what: string, body: unknown) => {
    try {
      const r = await fetch(`/api/herdr/panes/${p.id}/${what}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json() as { id?: string };
      setErr('');
      // 지금 보던 칸을 닫았으면 같은 탭의 다른 칸으로(없으면 목록으로)
      const next = what === 'close' && decodeURIComponent(location.hash).endsWith(p.id)
        ? qc.getQueryData<HerdrView>(['herdr'])?.panes.find(x => x.tab === p.tab && x.id !== p.id)?.id ?? '' : undefined;
      await qc.invalidateQueries({ queryKey: ['herdr'] });
      if (j.id) location.hash = `#/herdr/${j.id}`;
      else if (next !== undefined) location.hash = next ? `#/herdr/${next}` : '#/herdr';
    } catch (e) { setErr(String(e)); }
  };
  const b = (icon: ReactNode, title: string, on: () => void, cls = '') =>
    <button title={title} aria-label={title} onClick={e => { e.preventDefault(); e.stopPropagation(); on(); }}
      className={`flex h-full min-w-6 items-center justify-center rounded px-1 text-muted-foreground transition hover:bg-muted hover:text-foreground ${cls}`}>{icon}</button>;
  const arrow = (d: string) => <Icon className="size-3.5">{SPLIT[d]}</Icon>;
  return (
    <span className="inline-flex items-center gap-1">
      {err && <span className="mr-1 max-w-48 truncate text-xs text-destructive" title={err}>{err}</span>}
      {/* 그쪽에 새 칸 — 네 방향, 닫기는 선으로 떼어 둔다 */}
      <span className="inline-flex h-7 items-center gap-px rounded-md border bg-card p-0.5 shadow-xs">
        {b(arrow('left'), '왼쪽에 새 칸', () => void act('split', { direction: 'left' }))}
        {b(arrow('right'), '오른쪽에 새 칸', () => void act('split', { direction: 'right' }))}
        {b(arrow('up'), '위에 새 칸', () => void act('split', { direction: 'up' }))}
        {b(arrow('down'), '아래에 새 칸', () => void act('split', { direction: 'down' }))}
        <span className="mx-0.5 h-4 w-px bg-border" />
        {sure
          ? b(<span className="text-[0.6875rem] font-semibold">닫기?</span>, '한 번 더 누르면 닫는다 — 안에서 돌던 것이 끝난다', () => { setSure(false); void act('close', {}); }, 'text-destructive hover:text-destructive')
          : b(<Icon className="size-3.5"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Icon>, '이 칸 닫기', () => { setSure(true); setTimeout(() => setSure(false), 3000); }, 'hover:text-destructive')}
      </span>
    </span>
  );
}

// pane 하나의 본문 — 에이전트는 대화, 셸은 기록. 그 둘로 못 그리는 때만 터미널(원래 화면):
// 셸에서 화면 전체를 쓰는 프로그램(vim·less·top·git log 의 페이지 넘김 등)이 돌 때는 저절로, 그 밖엔 「원래 화면」 버튼으로.
const FULL = new Set(['vim', 'nvim', 'vi', 'view', 'nano', 'emacs', 'less', 'more', 'most', 'man', 'top', 'htop', 'btop', 'atop', 'tig', 'lazygit', 'lazydocker', 'fzf', 'k9s', 'watch', 'tmux', 'screen', 'mc', 'ranger', 'nnn', 'yazi']);
const fullScreen = (title: string) => { const [cmd, sub] = title.trim().split(/\s+/); return FULL.has(cmd) || (cmd === 'git' && ['log', 'diff', 'show', 'blame', 'help'].includes(sub)); };
// 「원래 화면」 으로 바꿔 둔 pane — 칸 머리·제목 줄의 버튼과 본문이 같이 본다.
const rawPanes = new Set<string>(), rawSubs = new Set<() => void>();
function useRaw(id: string): [boolean, () => void] {
  const raw = useSyncExternalStore(f => { rawSubs.add(f); return () => rawSubs.delete(f); }, () => rawPanes.has(id));
  return [raw, () => { if (!rawPanes.delete(id)) rawPanes.add(id); rawSubs.forEach(f => f()); }];
}
const hasView = (p: HPane) => (p.agent === 'claude' || p.agent === 'codex' || !p.agent) && !(!p.agent && fullScreen(p.title));
function RawToggle({ p, small }: { p: HPane; small?: boolean }) {
  const [raw, toggle] = useRaw(p.id);
  if (!hasView(p)) return null;
  return (
    <button onClick={e => { e.preventDefault(); e.stopPropagation(); toggle(); }} title={raw ? '대화·기록으로 돌아가기' : '터미널 화면 그대로 보기'}
      className={`flex items-center gap-1.5 rounded-md border font-semibold shadow-xs transition ${small ? 'h-6 px-1.5 text-[0.6875rem]' : 'h-7 px-2 text-xs'} ${raw ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
      <Icon className="size-3.5">{TERMINAL}</Icon>{raw ? (p.agent ? '대화로' : '기록으로') : '원래 화면'}
    </button>
  );
}
function Body({ p }: { p: HPane }) {
  const [raw] = useRaw(p.id);
  const agent = p.agent === 'claude' || p.agent === 'codex';
  const term = raw || !hasView(p);
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {term ? <><QuickKeys pane={p.id} blocked={p.status === 'blocked'} /><Term pane={p.id} /></> : agent ? <Chat p={p} /> : <ShellLog p={p} />}
    </div>
  );
}

// 탭 전체 — herdr 배치 비율 그대로 칸을 놓고 칸마다 그 pane 의 본문을 띄운다. 칸 어디를 눌러도 그 pane 을 고른다(입력칸이 그쪽으로).
// 칸 위에 pane 을 끌어 놓을 자리 — 가장자리 1/4 이면 그쪽에 붙이고, 가운데면 두 칸 자리를 바꾼다.
const ZONE: Record<string, string> = { left: 'inset-y-0.5 left-0.5 w-1/2', right: 'inset-y-0.5 right-0.5 w-1/2', up: 'inset-x-0.5 top-0.5 h-1/2', down: 'inset-x-0.5 bottom-0.5 h-1/2', swap: 'inset-0.5' };
const ZONE_TEXT: Record<string, string> = { left: '왼쪽에 붙이기', right: '오른쪽에 붙이기', up: '위에 붙이기', down: '아래에 붙이기', swap: '자리 바꾸기' };
function zoneOf(e: React.DragEvent) {
  const r = e.currentTarget.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  const [side, d] = Object.entries({ left: x, right: 1 - x, up: y, down: 1 - y }).sort((a, b) => a[1] - b[1])[0];
  return d < 0.25 ? side : 'swap';
}

function TabLayout({ lay, data, sel }: { lay: HerdrView['layouts'][number]; data: HerdrView; sel: string }) {
  const box = useRef<HTMLDivElement>(null), move = useMove(), menu = usePaneMenu();
  const [drop, setDrop] = useState<{ id: string; zone: string } | null>(null);
  return (
    <div ref={box} className="relative h-full">
      {lay.splits.map(sp => <Divider key={sp.path.join('')} sp={sp} tab={lay.tab} box={box} />)}
      {lay.panes.map(c => {
        const p = data.panes.find(x => x.id === c.id);
        if (!p) return null;
        return (
          // 칸 어디를 눌러도 그 pane 을 고른다(안의 버튼·터미널은 그대로 동작). 고른 칸이 바뀌어도 칸들은 다시 만들지 않아 스크롤·연결이 그대로다.
          <div key={c.id} className="absolute p-0.5" style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }}
            onPointerDownCapture={() => { if (c.id !== sel) location.hash = `#/herdr/${c.id}`; }}
            onDragOverCapture={e => { if (!carrying(e, DRAG_PANE)) return; e.preventDefault(); const z = zoneOf(e); if (drop?.id !== c.id || drop.zone !== z) setDrop({ id: c.id, zone: z }); }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null); }}
            onDropCapture={e => {
              e.preventDefault();
              const from = e.dataTransfer.getData(DRAG_PANE), z = zoneOf(e);
              setDrop(null);
              if (from && from !== c.id) void move(`/api/herdr/panes/${from}/move`, { pane: c.id, side: z });
            }}>
            {drop?.id === c.id && (
              <div className={`pointer-events-none absolute z-30 flex items-center justify-center rounded bg-sky-500/20 text-sm font-medium text-sky-700 ring-2 ring-sky-500 dark:text-sky-300 ${ZONE[drop.zone]}`}>
                {ZONE_TEXT[drop.zone]}
              </div>
            )}
            <div className={`flex h-full flex-col overflow-hidden rounded-xl border bg-card shadow-sm ${c.id === sel ? 'ring-2 ring-primary/50' : ''}`}>
              <a href={`#/herdr/${c.id}`} draggable title="끌어서 옮기기 — 다른 칸 가장자리(붙이기)·가운데(자리 바꾸기), 사이드바 워크스페이스(새 탭으로)"
                onDragStart={e => { e.dataTransfer.setData(DRAG_PANE, c.id); e.dataTransfer.effectAllowed = 'move'; }}
                onContextMenu={e => openMenu(e, menu(p))}
                className={`@container flex shrink-0 cursor-grab items-center gap-1.5 border-b px-2.5 py-1.5 text-xs font-medium ${c.id === sel ? 'bg-accent text-accent-foreground' : 'bg-muted/50 hover:bg-muted'}`}>
                <span className={`size-2 shrink-0 rounded-full ${DOT[p.status ?? ''] ?? 'bg-muted-foreground/30'}`} />
                <Kind agent={p.agent} /><span className="truncate">{paneText(p)}</span>
                {p.status === 'blocked' && <span className="shrink-0 text-amber-600 dark:text-amber-400">승인 대기</span>}
                <span className="ml-1.5"><Usage p={p} short /></span>
                <span className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap" onClick={e => e.preventDefault()}><RawToggle p={p} small /><PaneActions p={p} /></span>
              </a>
              <div className="min-h-0 flex-1 p-1.5"><Body p={p} /></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
