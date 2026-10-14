// herdr — 왼쪽 워크스페이스·탭·pane 과 에이전트 상태, 오른쪽 고른 pane 의 터미널(실시간, 누르면 입력)·빠른 키·프롬프트. 주소는 #/herdr/<pane id>.
import { memo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { get, post, useHerdr, type HerdrView, type HPane, type HSplit, type HTab, type HWorkspace } from './api.ts';
import { Button } from '@/components/ui/button';
import { Empty, Icon, Md, TERMINAL, Tag } from './ui.tsx';
import { MenuHost, openMenu, type MenuItem } from './Menu.tsx';
import { Ansi } from './ansi.tsx';
import { copyText, toast } from './copy.ts';
import { Attach, upload } from './Attach.tsx';
import { PaneDiff } from './Diff.tsx';
import { BgTasks } from './Tasks.tsx';
import claudeIcon from './icons/claude.svg';
import codexIcon from './icons/codex.svg';

// unknown 은 에이전트가 없거나 herdr 가 상태를 못 가린 것 — 표시하지 않는다.
const STATUS: Record<string, string> = { working: '작업 중', blocked: '승인 대기', done: '끝남', idle: '대기' };
const DOT: Record<string, string> = { working: 'bg-sky-500', blocked: 'bg-amber-500', done: 'bg-emerald-500' };
const ICON: Record<string, string> = { claude: claudeIcon, codex: codexIcon };

const GIT_COMPARE = <><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M13 6h3a2 2 0 0 1 2 2v7" /><path d="M11 18H8a2 2 0 0 1-2-2V9" /></>;   // lucide git-compare

// 에이전트 종류 — Claude·Codex 는 아이콘, 그 밖의 에이전트는 첫 글자, 셸은 터미널 아이콘.
export function Kind({ agent }: { agent: string | null }) {
  if (agent && ICON[agent]) return <img src={ICON[agent]} alt={agent} className="size-3.5 shrink-0" />;
  if (!agent) return <Icon className="size-3.5 text-muted-foreground">{TERMINAL}</Icon>;
  return <span className="w-3.5 shrink-0 text-center font-mono text-[0.625rem] text-muted-foreground">{agent[0].toUpperCase()}</span>;
}

export function HerdrPage({ pane, side = true }: { pane?: string; side?: boolean }) {
  const { data, error } = useHerdr();
  if (error && !data) return <div className="p-4"><Empty>herdr 에 닿지 않는다 — {String(error)}</Empty></div>;
  if (!data) return null;
  const sel = data.panes.find(p => p.id === pane);
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <MenuHost />
      <aside className={`max-h-72 shrink-0 overflow-y-auto border-b bg-sidebar md:max-h-none md:w-80 md:border-r md:border-b-0 ${side ? '' : 'hidden'}`}>
        <nav className="space-y-0.5 p-1.5">
          <NewWorkspace />
          <Tree data={data} sel={sel?.id} />
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto p-4">
        {sel ? <PaneView p={sel} data={data} /> : <Empty>{pane ? `pane ${pane} 이 없다(닫혔을 수 있다)` : '왼쪽에서 pane 을 고른다'}</Empty>}
      </main>
    </div>
  );
}

// 끌어 놓기 — pane 은 DRAG_PANE, 워크스페이스는 DRAG_WS 로 싣는다. 옮긴 뒤 herdr 가 준 새 pane id 로 간다(워크스페이스를 넘으면 바뀐다).
const DRAG_PANE = 'text/x-herdr-pane', DRAG_WS = 'text/x-herdr-ws';
const carrying = (e: React.DragEvent, t: string) => e.dataTransfer.types.includes(t);
function useMove() {
  const qc = useQueryClient();
  return async (url: string, body: unknown) => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { alertLine(await r.text()); return false; }
    const j = await r.json() as { id?: string };
    await qc.invalidateQueries({ queryKey: ['herdr'] });
    if (j.id) location.hash = `#/herdr/${j.id}`;
    return true;
  };
}
// 우클릭 메뉴 — pane(사이드바 줄·칸 머리), 워크스페이스(사이드바). 고르는 것은 버튼·끌어 놓기와 같은 API 를 부른다.
// 셸이 프롬프트에서 쉬는 중인지 — 창 제목이 비었거나, macOS·Linux 는 사용자@호스트:경로, Windows 는 셸 이름·경로(pwsh·powershell·cmd).
// 명령이 돌면 창 제목이 그 명령이 된다.
// ponytail: Windows 셸 창 제목은 확인하지 않았다 — 명령이 돌아도 제목이 그대로면 「실행 중」 이 안 보일 뿐이다.
const atPrompt = (title: string) => !title || /^[^\s@]+@[^:\s]+:/.test(title)
  || /(^|[\\/ ])(pwsh|powershell|cmd)(\.exe)?$/i.test(title.trim()) || /^(Windows )?PowerShell( \d.*)?$/i.test(title.trim());
const shellIdle = (p: HPane) => !p.agent && atPrompt(p.title);
function usePaneMenu() {
  const move = useMove();
  return (p: HPane): MenuItem[] => {
    const call = (what: string, body: unknown = {}) => () => move(`/api/herdr/panes/${p.id}/${what}`, body);
    return [
      { label: '열기', run: () => { location.hash = `#/herdr/${p.id}`; } },
      '-',
      { label: '왼쪽에 새 칸', run: call('split', { direction: 'left' }) },
      { label: '오른쪽에 새 칸', run: call('split', { direction: 'right' }) },
      { label: '위에 새 칸', run: call('split', { direction: 'up' }) },
      { label: '아래에 새 칸', run: call('split', { direction: 'down' }) },
      { label: '새 탭으로 빼기', run: call('move', { workspace: p.workspace }) },
      ...(shellIdle(p) ? ['-', { label: '여기서 Claude 띄우기', run: call('start', { kind: 'claude' }) }, { label: '여기서 Codex 띄우기', run: call('start', { kind: 'codex' }) }] as MenuItem[] : []),
      '-',
      { label: 'Esc 보내기', run: call('keys', { key: 'esc' }) },
      { label: 'Ctrl+C 보내기', run: call('keys', { key: 'ctrl+c' }) },
      { label: '작업 폴더 경로 복사', run: () => navigator.clipboard.writeText(p.cwd) },
      '-',
      { label: '닫기', danger: true, confirm: true, run: async () => { await move(`/api/herdr/panes/${p.id}/close`, {}); if (decodeURIComponent(location.hash).endsWith(p.id)) location.hash = '#/herdr'; } },
    ];
  };
}
function useWorkspaceMenu(data: HerdrView) {
  const move = useMove();
  return (w: HWorkspace): MenuItem[] => {
    const call = (what: string, body: unknown = {}) => () => move(`/api/herdr/workspaces/${w.workspace_id}/${what}`, body);
    const first = [...data.workspaces].sort((a, b) => a.number - b.number)[0];
    const path = w.worktree?.checkout_path ?? data.panes.find(p => p.workspace === w.workspace_id)?.cwd ?? '';
    return [
      { label: '새 탭', run: call('tab') },
      { label: '이름 바꾸기', input: { initial: w.label, submit: v => move(`/api/herdr/workspaces/${w.workspace_id}/rename`, { label: v }) } },
      '-',
      { label: '맨 위로', run: call('move', { before: first.workspace_id }) },
      { label: '맨 아래로', run: call('move', { before: null }) },
      { label: '경로 복사', run: () => navigator.clipboard.writeText(path) },
    ];
  };
}

// 탭 메뉴 — 사이드바 탭 줄·제목 옆 탭 이름. 워크스페이스 이름도 여기서 바꾼다.
function useTabMenu() {
  const move = useMove();
  return (w: HWorkspace, t: HTab): MenuItem[] => [
    { label: '워크스페이스 이름 바꾸기', input: { initial: w.label, submit: v => move(`/api/herdr/workspaces/${w.workspace_id}/rename`, { label: v }) } },
    { label: '탭 이름 바꾸기', input: { initial: t.label, submit: v => move(`/api/herdr/tabs/${t.tab_id}/rename`, { label: v }) } },
    '-',
    { label: '새 탭', run: () => move(`/api/herdr/workspaces/${w.workspace_id}/tab`, {}) },
  ];
}

// 옮기기 실패를 잠깐 띄운다(모달 없이 화면 위쪽 한 줄)
function alertLine(msg: string) {
  const el = document.createElement('div');
  el.textContent = `하지 못했다 — ${msg}`;
  el.className = 'fixed top-14 left-1/2 z-50 -translate-x-1/2 rounded-md bg-destructive px-3 py-1.5 text-sm text-white shadow';
  document.body.append(el);
  setTimeout(() => el.remove(), 4000);
}

// 새 워크스페이스 — 이름과 시작 폴더(셸 탭 완성처럼 하위 폴더 추천, Tab 이면 첫 추천). 만들면 그 첫 pane 으로 간다.
function NewWorkspace() {
  const move = useMove();
  const [open, setOpen] = useState(false), [label, setLabel] = useState(''), [cwd, setCwd] = useState('~/'), [focus, setFocus] = useState(false);
  const sug = useQuery({
    queryKey: ['folders', cwd], queryFn: () => get<string[]>(`/api/herdr/folders?q=${encodeURIComponent(cwd)}`),
    enabled: open && focus, placeholderData: keepPreviousData,
  });
  const create = async () => { if (label.trim() && await move('/api/herdr/workspaces', { label, cwd })) { setOpen(false); setLabel(''); } };
  const enter = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void create(); } if (e.key === 'Escape') setOpen(false); };
  if (!open) return <button onClick={() => setOpen(true)} className="mb-1 flex h-8 w-full items-center gap-2 rounded-md border border-dashed px-2.5 text-left text-[0.8125rem] text-muted-foreground hover:border-primary/40 hover:bg-card hover:text-foreground"><span className="text-base leading-none">+</span>새 워크스페이스</button>;
  const input = 'w-full rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring/50';
  return (
    <div className="mb-1 space-y-2 rounded-lg border bg-card p-2.5 shadow-sm">
      <input autoFocus placeholder="이름" value={label} onChange={e => setLabel(e.target.value)} onKeyDown={enter} className={input} />
      <div>
        <input placeholder="시작 폴더 (~/…)" value={cwd} onChange={e => setCwd(e.target.value)} className={`${input} font-mono text-xs`}
          onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)}
          onKeyDown={e => { if (e.key === 'Tab' && sug.data?.[0]) { e.preventDefault(); setCwd(`${sug.data[0]}/`); } else enter(e); }} />
        {/* 추천은 입력칸 아래에 끼워 넣는다(만들기 버튼을 덮지 않게). 친 경로 그대로 하나만 남으면 숨긴다 */}
        {focus && !!sug.data?.length && !(sug.data.length === 1 && sug.data[0] === cwd.replace(/\/$/, '')) && (
          <div className="mt-1 max-h-40 w-full overflow-y-auto rounded-md border bg-popover p-1">
            {sug.data.map(f => (
              <button key={f} onMouseDown={e => { e.preventDefault(); setCwd(`${f}/`); }} className="block w-full truncate rounded px-2 py-0.5 text-left font-mono text-xs hover:bg-muted">{f}</button>
            ))}
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Button size="sm" className="h-7" disabled={!label.trim()} onClick={() => void create()}>만들기</Button>
        <Button size="sm" variant="outline" className="h-7" onClick={() => setOpen(false)}>취소</Button>
      </div>
    </div>
  );
}

// 사이드바 — herdr 와 같은 레포 트리. 레포 워크스페이스 밑에 그 레포의 링크 워크트리를 붙이고, 각 아래에 pane.
// 레포 워크스페이스가 안 열린 워크트리는 맨 위 단에 둔다. 순서는 herdr 번호.
function Tree({ data, sel }: { data: HerdrView; sel?: string }) {
  const wss = [...data.workspaces].sort((a, b) => a.number - b.number);
  const main = new Map(wss.filter(w => w.worktree && !w.worktree.is_linked_worktree).map(w => [w.worktree!.repo_key, w]));
  const childOf = (w: HWorkspace) => w.worktree?.is_linked_worktree ? main.get(w.worktree.repo_key) : undefined;
  return wss.filter(w => !childOf(w)).map(w => (
    <Node key={w.workspace_id} w={w} data={data} sel={sel} depth={0}>
      {wss.filter(c => childOf(c) === w).map(c => <Node key={c.workspace_id} w={c} data={data} sel={sel} depth={1} />)}
    </Node>
  ));
}

function Node({ w, data, sel, depth, children }: { w: HWorkspace; data: HerdrView; sel?: string; depth: number; children?: ReactNode[] }) {
  const move = useMove(), wsMenu = useWorkspaceMenu(data), tabMenu = useTabMenu();
  const [over, setOver] = useState<'pane' | 'ws' | null>(null);
  const tabs = data.tabs.filter(t => t.workspace_id === w.workspace_id).sort((a, b) => a.number - b.number);
  const panes = data.panes.filter(p => p.workspace === w.workspace_id);
  const kids = children?.length ?? 0;
  const open = w.agent_status === 'working' || w.agent_status === 'blocked' || panes.some(p => p.id === sel)
    || (kids > 0 && data.workspaces.some(c => c.worktree?.is_linked_worktree && c.worktree.repo_key === w.worktree?.repo_key
      && (c.agent_status === 'working' || c.agent_status === 'blocked' || data.panes.some(p => p.workspace === c.workspace_id && p.id === sel))));
  const mine = panes.some(p => p.id === sel);
  return (
    // 펼친 워크스페이스는 카드로 묶고, 접힌 건 같은 높이의 한 줄. 하위(링크 워크트리)는 왼쪽 안내선 아래로 들인다.
    // 하위(링크 워크트리)는 처음부터 펼쳐 둔다. 위 워크스페이스를 펼치면 접어 둔 하위도 다시 다 펼친다(하나씩 누르지 않게).
    <details open={depth > 0 || open} className={depth ? 'ml-4 border-l pl-1' : 'rounded-lg open:my-1.5 open:bg-card open:shadow-sm open:ring-1 open:ring-border'}
      onToggle={e => { if (e.target === e.currentTarget && e.currentTarget.open) e.currentTarget.querySelectorAll('details').forEach(d => { d.open = true; }); }}>
      <summary draggable onDragStart={e => { e.dataTransfer.setData(DRAG_WS, w.workspace_id); e.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={e => { const k = carrying(e, DRAG_PANE) ? 'pane' : carrying(e, DRAG_WS) ? 'ws' : null; if (!k) return; e.preventDefault(); setOver(k); }}
        onDragLeave={() => setOver(null)}
        onContextMenu={e => openMenu(e, wsMenu(w))}
        onDrop={e => {
          e.preventDefault(); setOver(null);
          const pane = e.dataTransfer.getData(DRAG_PANE), ws = e.dataTransfer.getData(DRAG_WS);
          if (pane) void move(`/api/herdr/panes/${pane}/move`, { workspace: w.workspace_id });   // 이 워크스페이스의 새 탭으로
          else if (ws && ws !== w.workspace_id) void move(`/api/herdr/workspaces/${ws}/move`, { before: w.workspace_id });   // 이 워크스페이스 앞으로
        }}
        title="끌어서 순서 바꾸기 · pane 을 여기 놓으면 이 워크스페이스의 새 탭으로"
        className={`flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md px-1.5 text-[0.8125rem] select-none hover:bg-muted/70 [&::-webkit-details-marker]:hidden ${over === 'ws' ? 'shadow-[inset_0_2px_0_var(--primary)]' : ''} ${over === 'pane' ? 'bg-primary/15' : ''}`}>
        <svg viewBox="0 0 16 16" className="size-3 shrink-0 text-muted-foreground/60 transition-transform [[open]>summary>&]:rotate-90" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 4 4 4-4 4" /></svg>
        <span className={`truncate ${mine ? 'font-semibold text-foreground' : 'font-medium text-foreground/90'}`}>{w.label}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-1">
          {w.agent_status && w.agent_status !== 'idle' && STATUS[w.agent_status] && <State v={w.agent_status} />}
          {kids > 0 && <span className="min-w-4 rounded-full bg-muted px-1 text-center text-[0.625rem] leading-4 text-muted-foreground tabular-nums">{kids}</span>}
        </span>
      </summary>
      <div className="pb-1.5">
        {tabs.map(t => (
          <div key={t.tab_id}>
            {tabs.length > 1 && (
              <div onContextMenu={e => openMenu(e, tabMenu(w, t))}
                className={`flex items-center gap-2 pt-1.5 pr-3 pb-0.5 text-[0.65625rem] font-medium text-muted-foreground/70 after:h-px after:flex-1 after:bg-border ${depth ? 'pl-7.5' : 'pl-6.5'}`}>탭 {t.label}</div>
            )}
            {panes.filter(p => p.tab === t.tab_id).map(p => <PaneRow key={p.id} p={p} on={p.id === sel} depth={depth} text={paneText(p)} />)}
          </div>
        ))}
        {children}
      </div>
    </details>
  );
}

// 워크스페이스 줄 상태 — 알약 대신 점 + 글자(줄 높이를 안 늘린다).
const STATE_TONE: Record<string, string> = { working: 'text-sky-600 dark:text-sky-400', blocked: 'text-amber-600 dark:text-amber-400', done: 'text-emerald-600 dark:text-emerald-400' };
function State({ v }: { v: string }) {
  return (
    <span className={`flex items-center gap-1 text-[0.6875rem] font-medium ${STATE_TONE[v] ?? 'text-muted-foreground'}`}>
      <span className={`size-1.5 rounded-full ${DOT[v] ?? 'bg-muted-foreground/40'} ${v === 'working' || v === 'blocked' ? 'animate-pulse' : ''}`} />{STATUS[v]}
    </span>
  );
}

// pane 이름 — 창 제목(종류는 앞 아이콘). 셸은 프롬프트(사용자@호스트:경로)면 「셸」, 명령이 돌면 그 명령.
export function paneText(p: HPane) {
  if (!p.agent) return atPrompt(p.title) ? '셸' : p.title;
  return p.title || p.agent;
}

function PaneRow({ p, on, depth, text }: { p: HPane; on: boolean; depth: number; text: string }) {
  const menu = usePaneMenu();
  return (
    <a href={`#/herdr/${p.id}`} title={`${p.agent ?? '셸'} · ${p.id} · ${p.cwd}`} draggable
      onDragStart={e => { e.dataTransfer.setData(DRAG_PANE, p.id); e.dataTransfer.effectAllowed = 'move'; }}
      onContextMenu={e => openMenu(e, menu(p))}
      className={`mx-1 flex h-7 items-center gap-2 rounded-md border-l-2 pr-2 text-xs ${depth ? 'ml-5 pl-2' : 'ml-4 pl-2'} ${on ? 'border-primary bg-accent font-medium text-accent-foreground' : 'border-transparent hover:bg-muted/70'}`}>
      <span className={`size-2 shrink-0 rounded-full ${DOT[p.status ?? ''] ?? 'bg-muted-foreground/25'} ${p.status === 'working' || p.status === 'blocked' ? 'animate-pulse' : ''}`} />
      <Kind agent={p.agent} />
      <span className={`truncate ${p.agent || on ? '' : 'text-muted-foreground'}`}>{text}</span>
      {p.status === 'blocked' && <span className="ml-auto shrink-0 rounded-full bg-amber-500/15 px-1.5 text-[0.625rem] font-semibold text-amber-700 dark:text-amber-400">승인 대기</span>}
    </a>
  );
}

// 브랜치 — 이 pane 폴더의 브랜치. 링크 워크트리면 그 워크트리 브랜치와 원본 레포(메인 체크아웃) 브랜치도.
// pane 이 워크트리 밖 폴더에 있으면 그 폴더 브랜치를 따로 보인다. 10초마다 다시 읽는다.
type Br = { root: string; branch: string };
const COPY = <><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>;   // lucide copy
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

function PaneView({ p, data }: { p: HPane; data: HerdrView }) {
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
            <BgTasks p={p} />
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
          {/* 탭 전체 칸 보기면 칸마다 머리에 사용량이 있으니 여기서는 뺀다(중복) — 이 pane 만 볼 때만 여기 */}
          {!(multi && mode === 'tab' && !diffOn) && <span className="ml-1.5"><Usage p={p} /></span>}
          <span className="ml-1.5 min-w-0 truncate font-mono text-xs" title={p.cwd}>{p.cwd.replace(/^\/(Users|home)\/[^/]+|^[A-Za-z]:\\Users\\[^\\]+/, '~')}</span>
          <button onClick={() => void copyText(p.cwd)} title="경로 복사" className="shrink-0 rounded p-0.5 text-muted-foreground/70 hover:bg-muted hover:text-foreground"><Icon className="size-3.5">{COPY}</Icon></button>
          {multi && !diffOn && <div className="ml-auto flex shrink-0 gap-0.5 rounded-lg bg-muted p-0.5">{pick('tab', `탭 전체 ${lay!.panes.length}칸`)}{pick('one', '이 pane 만')}</div>}
        </div>
      </div>
      <div className="min-h-80 flex-1">{diffOn ? <PaneDiff p={p} /> : multi && mode === 'tab' ? <TabLayout lay={lay!} data={data} sel={p.id} /> : <Body p={p} />}</div>
      <PromptBox p={p} label={multi && mode === 'tab' ? paneText(p) : undefined} />
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
  const b = (label: string, title: string, on: () => void, cls = '') =>
    <button title={title} onClick={e => { e.preventDefault(); e.stopPropagation(); on(); }}
      className={`rounded px-1 font-mono text-xs text-muted-foreground hover:bg-muted hover:text-foreground ${cls}`}>{label}</button>;
  return (
    <span className="inline-flex items-center gap-0.5">
      {err && <span className="mr-1 max-w-48 truncate text-xs text-destructive" title={err}>{err}</span>}
      {b('←', '왼쪽에 새 칸', () => void act('split', { direction: 'left' }))}
      {b('→', '오른쪽에 새 칸', () => void act('split', { direction: 'right' }))}
      {b('↑', '위에 새 칸', () => void act('split', { direction: 'up' }))}
      {b('↓', '아래에 새 칸', () => void act('split', { direction: 'down' }))}
      {sure
        ? b('닫기?', '한 번 더 누르면 닫는다 — 안에서 돌던 것이 끝난다', () => { setSure(false); void act('close', {}); }, 'text-destructive')
        : b('×', '이 칸 닫기', () => { setSure(true); setTimeout(() => setSure(false), 3000); })}
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
function RawToggle({ p }: { p: HPane }) {
  const [raw, toggle] = useRaw(p.id);
  if (!hasView(p)) return null;
  return (
    <button onClick={e => { e.preventDefault(); e.stopPropagation(); toggle(); }} title="터미널 화면 그대로 보기"
      className={`rounded-md px-1.5 py-0.5 text-[0.6875rem] font-medium ${raw ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
      {raw ? (p.agent ? '대화로' : '기록으로') : '원래 화면'}
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
                <span className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap" onClick={e => e.preventDefault()}><RawToggle p={p} /><PaneActions p={p} /></span>
              </a>
              <div className="min-h-0 flex-1 p-1.5"><Body p={p} /></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

type SBlock = { cmd: string; where: string; out: string[] };

function ShellLog({ p }: { p: HPane }) {
  const running = !atPrompt(p.title);
  const [busy, setBusy] = useState(''), [err, setErr] = useState('');
  const launch = async (kind: string) => {
    setBusy(kind); setErr('');
    await post(`/api/herdr/panes/${p.id}/start`, { kind }).catch(e => setErr(String(e)));
    setBusy('');
  };
  const { data, error } = useQuery({
    queryKey: ['history', p.id], queryFn: () => get<{ mark: string | null; blocks: SBlock[] }>(`/api/herdr/panes/${p.id}/history`),
    refetchInterval: running ? 1000 : 4000,
  });
  const box = useRef<HTMLDivElement>(null), stick = useRef(true);
  useEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [data]);
  if (error && !data) return <Empty>{String(error)}</Empty>;   // 한 번 실패해도(서버 재시작 등) 받아 둔 내용은 그대로
  const blocks = data?.blocks ?? [], last = blocks.at(-1);
  const idle = !!last && !last.cmd && !last.out.length;   // 마지막이 빈 프롬프트 = 기다리는 중
  return (
    <div ref={box} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
      className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-xl border bg-card p-3">
      {!data ? <Empty>불러오는 중…</Empty> : !data.mark && (blocks.length ? <Empty>프롬프트를 못 알아봤다 — 「원래 화면」 으로 본다</Empty> : <Empty>아직 출력이 없다</Empty>)}
      {(idle ? blocks.slice(0, -1) : blocks).map((b, i, all) => (
        <div key={i} className="overflow-hidden rounded-lg border shadow-xs">
          <div className="flex items-center gap-2 border-b bg-muted/60 px-3 py-1.5 font-mono text-xs">
            <span className="font-bold text-primary">❯</span>
            {b.where && <span className="rounded bg-accent px-1.5 py-0.5 text-[0.6875rem] text-accent-foreground">{b.where}</span>}
            <span className="truncate font-semibold">{b.cmd || '(출력)'}</span>
            {running && i === all.length - 1 && <span className="ml-auto flex shrink-0 items-center gap-1.5 text-primary"><span className="size-1.5 animate-pulse rounded-full bg-primary" />실행 중</span>}
          </div>
          {b.out.length > 0 && <Out lines={b.out} />}
        </div>
      ))}
      {(idle || (data && !blocks.length)) && !running && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-mono font-bold text-primary">❯</span> 대기 중{last?.where && ` · ${last.where}`} — 아래 칸에 명령, 또는
          {(['claude', 'codex'] as const).map(k => (
            <Button key={k} size="sm" variant="outline" className="h-6 gap-1 rounded-full px-2.5 text-xs" disabled={!!busy} onClick={() => void launch(k)}>
              <Kind agent={k} />{busy === k ? '띄우는 중' : k === 'claude' ? 'Claude' : 'Codex'}
            </Button>
          ))}
          {err && <span className="text-destructive">{err}</span>}
        </div>
      )}
    </div>
  );
}

// 긴 출력은 끝 40줄만, 누르면 전부. 터미널 색 그대로 어두운 판에.
function Out({ lines }: { lines: string[] }) {
  const [all, setAll] = useState(false);
  const hidden = all ? 0 : Math.max(0, lines.length - 40);
  return (
    <div className="bg-code">
      {hidden > 0 && <button onClick={() => setAll(true)} className="w-full border-b border-white/10 py-1 text-xs text-code-foreground/60 hover:text-code-foreground">앞 {hidden}줄 더 보기</button>}
      <Ansi text={lines.slice(hidden).join('\n')} className="rounded-none" />
    </div>
  );
}

type Item = { t: number; kind: 'user' | 'text' | 'tool' | 'out'; text: string; result?: string; error?: boolean; at?: number };

// 지금 화면 아래쪽(기록에 아직 없는 화면) — 작업 중이면 진행 부분, 입력칸이 안 보이면 질문·메뉴. 대화 칸과 입력칸이 같이 쓴다.
// raw 는 터미널 색 그대로(진행 부분 그리기), lines 는 색을 뺀 글(읽기·찾기).
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
function useScreen(p: HPane) {
  const agent = p.agent === 'claude' || p.agent === 'codex';
  const q = useQuery({
    queryKey: ['live', p.id], queryFn: () => get<{ lines: string[]; input: boolean }>(`/api/herdr/panes/${p.id}/live`),
    refetchInterval: p.status === 'working' ? 700 : p.status === 'blocked' ? 1000 : 2000, enabled: agent,
  });
  const raw = q.data?.lines ?? [], lines = raw.map(l => l.replace(ANSI, '').trimEnd());
  const menu = q.data && !q.data.input ? parseMenu(lines) : null;
  return { raw, lines, input: q.data?.input ?? true, menu };
}

// 중지 — 셸은 Ctrl+C(php artisan serve·npm run dev 같은 돌고 있는 명령 끝내기), 에이전트는 Esc(하던 일 멈추기).
// 에이전트에 Ctrl+C 를 두 번 보내면 Claude 가 꺼지므로 에이전트에는 Esc 만 보낸다.
const STOP = <><circle cx="12" cy="12" r="10" /><rect x="9" y="9" width="6" height="6" rx="1" /></>;   // lucide circle-stop
function StopKey({ p }: { p: HPane }) {
  const key = p.agent ? 'esc' : 'ctrl+c', label = p.agent ? 'Esc' : 'Ctrl+C';
  const send = () => post(`/api/herdr/panes/${p.id}/keys`, { key }).then(() => toast(`${label} 보냄`), (e: Error) => toast(`보내지 못했다 — ${e.message}`, 4000));
  return (
    <button onClick={() => void send()} title={p.agent ? '하던 일 멈추기 — Esc 를 보낸다' : '돌고 있는 명령 끝내기 — Ctrl+C 를 보낸다'}
      className="flex h-8 items-center gap-1 rounded-full px-2 text-muted-foreground/80 transition hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400">
      <Icon>{STOP}</Icon><span className="font-mono text-[0.6875rem] font-semibold">{label}</span>
    </button>
  );
}

// 직접 써서 답하는 선택지(「Type something」 등) — 고르면 글을 받아야 한다
const isFree = (l: string) => /type something|직접|other/i.test(l);

// 질문·승인 화면 읽기 — 번호 선택지(「❯ 1. 빨강」)와 그 아래 들여 쓴 설명 줄, 선택지 앞의 질문 줄. 선택지가 둘 미만이면 질문이 아니다.
type Menu = { question: string; options: { n: number; label: string; desc: string }[] };
const OPT = /^\s*(?:[❯›>]\s*)?(\d{1,2})\.\s+(.+)$/;
const RULE = /^\s*[─━▔-]{3,}/;
const HINT = /Enter to (select|confirm)|Esc to cancel|↑\/↓|to navigate/;
function parseMenu(lines: string[]): Menu | null {
  const first = lines.findIndex(l => OPT.test(l));
  if (first < 0) return null;
  const options: Menu['options'] = [];
  for (const l of lines.slice(first)) {
    const m = l.match(OPT);
    if (m) options.push({ n: Number(m[1]), label: m[2].trim(), desc: '' });
    else if (l.trim() && !RULE.test(l) && !HINT.test(l) && options.length) options.at(-1)!.desc += `${options.at(-1)!.desc ? ' ' : ''}${l.trim()}`;
  }
  if (options.length < 2) return null;
  const before = lines.slice(0, first), cut = before.findLastIndex(l => RULE.test(l));
  const question = before.slice(cut + 1).filter(l => l.trim()).slice(-6).map(l => l.trim().replace(/^[☐☒✔]\s*/, '')).join('\n');   // 질문 머리표(☐ 색)의 상자는 뺀다
  return { question, options };
}

// 대화 — 서버가 끝쪽(최근)만 주고, 맨 위로 올리거나 「이전 대화 더 보기」 를 누르면 그 앞을 이어 받아 위에 붙인다(보던 자리는 그대로).
type ChatPage = { file: string | null; items: Item[]; more: boolean };
function Chat({ p }: { p: HPane }) {
  const { data, error } = useQuery({
    queryKey: ['chat', p.id], queryFn: () => get<ChatPage>(`/api/herdr/panes/${p.id}/chat`),
    refetchInterval: p.status === 'working' ? 1500 : 5000,
  });
  const screen = useScreen(p);
  const box = useRef<HTMLDivElement>(null), stick = useRef(true), keep = useRef<number | null>(null);
  const [older, setOlder] = useState<Item[]>([]), [olderMore, setOlderMore] = useState<boolean | null>(null), [loading, setLoading] = useState(false);
  const [away, setAway] = useState(false);   // 아래에서 멀리 올라가 있으면 「맨 아래로」 버튼
  const toBottom = () => { const el = box.current; if (!el) return; stick.current = true; el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); };
  useEffect(() => { setOlder([]); setOlderMore(null); }, [p.id, data?.file]);
  const more = older.length ? !!olderMore : !!data?.more;
  const loadOlder = () => {
    const first = older[0] ?? data?.items[0];
    if (loading || !more || first?.at === undefined) return;
    setLoading(true);
    get<ChatPage>(`/api/herdr/panes/${p.id}/chat?before=${first.at}`)
      .then(r => { const el = box.current; keep.current = el ? el.scrollHeight - el.scrollTop : null; setOlder(o => [...r.items, ...o]); setOlderMore(r.more); })
      .catch(() => undefined).finally(() => setLoading(false));
  };
  // 위에 붙인 만큼 내려 보던 자리를 지킨다
  useLayoutEffect(() => { const el = box.current; if (el && keep.current !== null) { el.scrollTop = el.scrollHeight - keep.current; keep.current = null; } }, [older.length]);
  useEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [data, p.status, screen.lines.length, !!screen.menu]);
  if (error && !data) return <Empty>{String(error)}</Empty>;   // 한 번 실패해도(서버 재시작 등) 받아 둔 내용은 그대로
  return (
    <div ref={box} onScroll={e => { const el = e.currentTarget, gap = el.scrollHeight - el.scrollTop - el.clientHeight; stick.current = gap < 80; setAway(gap > 400); if (el.scrollTop < 60) loadOlder(); }}
      className="min-h-0 flex-1 space-y-4 overflow-y-auto rounded-xl border bg-card px-4 py-4">
      {!data ? <Empty>불러오는 중…</Empty> : !data.items.length && <Empty>아직 대화가 없다(새 세션이거나 기록을 못 찾음 — 「원래 화면」 으로 본다)</Empty>}
      {more && (
        <button onClick={loadOlder} disabled={loading} className="mx-auto block rounded-full border bg-muted/50 px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60">
          {loading ? '불러오는 중…' : '이전 대화 더 보기'}
        </button>
      )}
      {!more && older.length > 0 && <p className="text-center text-xs text-muted-foreground/70">대화 처음</p>}
      {older.map((it, i) => <ChatItem key={`o${older.length - i}`} it={it} agent={p.agent} />)}
      {data?.items.map((it, i) => <ChatItem key={i} it={it} agent={p.agent} />)}
      {screen.menu ? (
        <div className="ml-9 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-sm">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400"><span className="size-1.5 animate-pulse rounded-full bg-amber-500" />답을 기다린다 — 아래 입력칸에서 고른다</div>
          {screen.menu.question && <div className="mt-1 whitespace-pre-wrap">{screen.menu.question}</div>}
        </div>
      ) : (p.status === 'working' || !screen.input) && screen.raw.length > 0 && <LiveText raw={screen.raw} lines={screen.lines} working={p.status === 'working'} />}
      {away && (
        <div className="pointer-events-none sticky bottom-0 flex justify-center">
          <button onClick={toBottom} className="pointer-events-auto flex items-center gap-1.5 rounded-full border bg-card/95 px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur hover:bg-muted">
            <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></svg>
            맨 아래로{p.status === 'working' && <span className="size-1.5 animate-pulse rounded-full bg-sky-500" />}
          </button>
        </div>
      )}
    </div>
  );
}

// 기록에 아직 없는 부분 — 스피너 줄(「✻ Tempering… (3s · ↓ 146 tokens)」)은 상태 알약으로, 그 위는 진행 중인 화면(터미널 색 그대로),
// 그 아래(첨부 아이콘·사용량 안내 등)는 뺀다.
const SPIN = /^\s*[^\p{L}\p{N}\s]\s+\p{L}[^(]*\(\d+(\.\d+)?[smh]/u;
function LiveText({ raw, lines, working }: { raw: string[]; lines: string[]; working: boolean }) {
  const at = lines.findLastIndex(l => SPIN.test(l));
  const body = (at >= 0 ? raw.slice(0, at) : raw).join('\n').replace(/^(\s*\n)+|(\n\s*)+$/g, '');
  const status = at >= 0 ? lines[at].trim().replace(/^\S+\s+/, '') : '';
  return (
    <div className="ml-9 space-y-2">
      {body && <Ansi text={body} />}
      {(status || working) && (
        <div className="inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
          <span className="size-1.5 animate-pulse rounded-full bg-primary" />{status || '작업 중'}
        </div>
      )}
    </div>
  );
}

// 도구 종류마다 색 — 셸 실행(주황)·읽기(하늘)·고치기(보라)·찾기(청록)·웹·MCP(분홍)·하위 에이전트(인디고)·질문(주황).
const TOOL: [RegExp, string][] = [
  [/^(Bash|exec|shell|BashOutput|KillShell)$/, 'text-amber-600 dark:text-amber-400'], [/^(Read|View)$/, 'text-sky-600 dark:text-sky-400'],
  [/^(Edit|MultiEdit|Write|NotebookEdit|apply_patch)$/, 'text-violet-600 dark:text-violet-400'], [/^(Grep|Glob|LS|ToolSearch)$/, 'text-teal-600 dark:text-teal-400'],
  [/^(WebFetch|WebSearch|mcp__.*)$/, 'text-pink-600 dark:text-pink-400'], [/^(Agent|Task|Skill|TaskCreate|TaskUpdate)$/, 'text-indigo-600 dark:text-indigo-400'],
  [/^질문$/, 'text-orange-600 dark:text-orange-400'],
];
const Avatar = ({ agent }: { agent: string | null }) =>
  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent ring-1 ring-border"><Kind agent={agent} /></span>;

// 새로 붙은 항목만 그린다 — 다시 받은 목록에서 바뀌지 않은 항목은 TanStack Query 가 같은 객체로 남겨 둔다.
const ChatItem = memo(function ChatItem({ it, agent }: { it: Item; agent: string | null }) {
  if (it.kind === 'user') return (
    <div className="ml-auto w-fit max-w-[82%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[0.84375rem] leading-relaxed break-words whitespace-pre-wrap text-primary-foreground shadow-sm">{it.text}</div>
  );
  if (it.kind === 'text') return <div className="flex gap-3"><Avatar agent={agent} /><div className="min-w-0 flex-1"><Md text={it.text} /></div></div>;
  if (it.kind === 'out') return <div className="ml-9"><Ansi text={it.text} /></div>;
  const [name, ...rest] = it.text.split(' '), tone = TOOL.find(([re]) => re.test(name))?.[1] ?? 'text-muted-foreground';
  return (
    <details className="group ml-9">
      <summary className={`flex max-w-full cursor-pointer list-none items-center gap-2 rounded-lg border px-2.5 py-1 font-mono text-[0.71875rem] hover:bg-muted/60 ${it.error ? 'border-destructive/40 bg-destructive/5' : 'bg-muted/40'}`}>
        <span className="text-muted-foreground transition-transform group-open:rotate-90">›</span>
        <span className={`shrink-0 font-semibold ${it.error ? 'text-destructive' : tone}`}>{name}</span>
        <span className="truncate text-muted-foreground">{rest.join(' ')}</span>
      </summary>
      {it.result && <pre className="code-panel mt-1.5 max-h-72 overflow-auto break-all whitespace-pre-wrap">{it.result}</pre>}
    </details>
  );
});

// 칸 폭에 맞춰 터미널 글자 크기를 줄인다(8~13). Menlo 한 칸 폭 ≈ 글자 크기 × 0.61.
function useFit(wrap: React.RefObject<HTMLDivElement | null>, term: React.RefObject<Terminal | null>) {
  const fit = () => {
    const t = term.current, w = wrap.current?.clientWidth;
    if (!t || !w) return;
    const fs = Math.max(8, Math.min(13, Math.floor((w - 16) / (t.cols * 0.61))));
    if (t.options.fontSize !== fs) t.options.fontSize = fs;
  };
  useEffect(() => {
    const ro = new ResizeObserver(fit);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  });
  return fit;
}

// 빠른 키 — 승인 메뉴 고르기·끊기. 입력 모드가 아니어도 바로 간다.
const QUICK = [['1', '1'], ['2', '2'], ['3', '3'], ['up', '↑'], ['down', '↓'], ['enter', 'Enter'], ['esc', 'Esc'], ['ctrl+c', 'Ctrl+C']];
function QuickKeys({ pane, blocked }: { pane: string; blocked: boolean }) {
  const [err, setErr] = useState('');
  const send = (key: string) => post(`/api/herdr/panes/${pane}/keys`, { key }).then(() => setErr('')).catch(e => setErr(String(e)));
  return (
    <div className={`flex flex-wrap items-center gap-1 rounded-md p-1 ${blocked ? 'bg-amber-500/10 ring-1 ring-amber-500/40' : ''}`}>
      {blocked && <span className="px-1 text-xs text-amber-700 dark:text-amber-400">승인 대기 — 고를 번호나 키</span>}
      {QUICK.map(([k, label]) => <Button key={k} size="sm" variant="outline" className="h-7 px-2 font-mono text-xs" onClick={() => void send(k)}>{label}</Button>)}
      {err && <span className="text-xs text-destructive">{err}</span>}
    </div>
  );
}

// 프롬프트 — 에이전트는 agent prompt(붙여넣기·엔터를 herdr 가 맞춘다), 셸은 명령 실행. 한글 조합 중 엔터는 보내지 않는다.
// 에이전트가 질문·승인으로 답을 기다리면 입력칸 자리에 질문과 선택지 버튼을 띄운다. 번호를 보내면 그 선택지로 답이 들어간다.
// 「직접 입력」 선택지(Type something 등)를 고르면 입력칸에 쓴 글이 그 답이 된다.
function PromptBox({ p, label }: { p: HPane; label?: string }) {
  const agent = !!p.agent, { menu } = useScreen(p);
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [typed, setTyped] = useState<number | null>(null);
  const area = useRef<HTMLTextAreaElement>(null), [caret, setCaret] = useState(0);
  const ac = useComplete(p, text, caret);
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    try { await f(); setErr(''); } catch (e) { setErr(String(e)); }
    setBusy(false);
  };
  const choose = (n: number, answer?: string) => run(async () => {
    await post(`/api/herdr/panes/${p.id}/choose`, { n, text: answer });
    setTyped(null); setText('');
  });
  const submit = () => {
    if (!text.trim() || busy) return;
    if (menu && typed !== null) void choose(typed, text);
    else void run(async () => { await post(`/api/herdr/panes/${p.id}/prompt`, { text }); setText(''); });
  };
  // 첨부 경로를 커서 자리에 넣는다(빈칸 든 경로는 따옴표). 붙여넣은 파일(스크린샷 등)은 올린 뒤 같은 자리에.
  const insertPaths = (paths: string[]) => {
    const ins = `${paths.map(x => x.includes(' ') ? `"${x}"` : x).join(' ')} `, at = caret + ins.length;
    setText(`${text.slice(0, caret)}${ins}${text.slice(caret)}`); setCaret(at);
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(at, at); });
  };
  const paste = (e: React.ClipboardEvent) => {
    const files = [...e.clipboardData.files];
    if (!files.length) return;
    e.preventDefault();
    void run(async () => insertPaths(await upload(files)));
  };
  // 추천을 고르면 지금 낱말을 그것으로 바꾸고 커서를 뒤로
  const pick = (i: number) => {
    const it = ac.items[i];
    if (!it) return;
    const next = `${text.slice(0, ac.start)}${it.insert} ${text.slice(caret)}`, at = ac.start + it.insert.length + 1;
    setText(next); setCaret(at);
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(at, at); });
  };
  return (
    <div className="space-y-1">
      {menu && (
        <div className="space-y-2.5 rounded-2xl border border-amber-500/30 bg-gradient-to-b from-amber-500/10 to-amber-500/5 p-3.5 shadow-sm">
          <div className="flex items-center gap-1.5 text-[0.6875rem] font-semibold tracking-wide text-amber-700 uppercase dark:text-amber-400"><span className="size-1.5 animate-pulse rounded-full bg-amber-500" />답을 기다린다</div>
          {menu.question && <div className="text-[0.84375rem] font-semibold whitespace-pre-wrap">{menu.question}</div>}
          <div className="grid gap-1.5">
            {menu.options.map(o => (
              <button key={o.n} disabled={busy} onClick={() => isFree(o.label) ? setTyped(o.n) : void choose(o.n)}
                className={`flex items-baseline gap-2.5 rounded-xl border bg-card px-3 py-2 text-left text-sm transition hover:border-primary/40 hover:bg-accent ${typed === o.n ? 'border-primary ring-2 ring-primary/30' : ''}`}>
                <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[0.6875rem] font-bold text-primary tabular-nums">{o.n}</span>
                <span className="font-medium">{o.label}</span>
                {o.desc && <span className="truncate text-xs text-muted-foreground">{o.desc}</span>}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {typed !== null ? `아래 칸에 답을 쓰고 Enter — ${typed}번으로 들어간다` : '눌러서 고른다'}
            <Button size="sm" variant="outline" className="ml-auto h-6 px-2 text-xs" disabled={busy}
              onClick={() => void run(() => post(`/api/herdr/panes/${p.id}/keys`, { key: 'esc' }))}>취소(Esc)</Button>
          </div>
        </div>
      )}
      {/* 입력창 — 위는 글, 아래 줄은 첨부 버튼 · 키 안내 · 보내기. 탭 전체 보기면 보낼 칸 이름은 안내 줄 대신 빈 칸 글자(placeholder)에 */}
      <div className="relative rounded-2xl border bg-card shadow-sm transition focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10">
        {ac.open && <Suggest ac={ac} onPick={i => pick(i)} />}
        <textarea ref={area} value={text} rows={Math.min(8, text.split('\n').length)}
          onChange={e => { setText(e.target.value); setCaret(e.target.selectionStart); }}
          onSelect={e => setCaret(e.currentTarget.selectionStart)}
          onPaste={paste}
          placeholder={menu && typed !== null ? '답을 쓴다' : `${label ? `${label} 에 보낼 ` : ''}${agent ? '프롬프트를 쓴다' : '명령을 쓴다'}`}
          onKeyDown={e => {
            if (ac.open && !e.nativeEvent.isComposing) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); ac.move(e.key === 'ArrowDown' ? 1 : -1); return; }
              if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); pick(ac.index); return; }
              if (e.key === 'Escape') { e.preventDefault(); ac.dismiss(); return; }
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
          }}
          className="block w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[0.84375rem] leading-relaxed outline-none placeholder:text-muted-foreground/60" />
        <div className="flex items-center gap-1 px-2 pb-2">
          <Attach onPaths={insertPaths} />
          <StopKey p={p} />
          <span className="ml-auto hidden truncate pr-1 text-[0.6875rem] text-muted-foreground/70 sm:block">
            Enter {agent ? '보내기' : '실행'} · Shift+Enter 줄바꿈{agent && ' · / 명령 · @ 파일'}
          </span>
          <Button size="sm" className="ml-auto h-8 shrink-0 rounded-lg px-3.5 sm:ml-1" onClick={submit} disabled={busy || !text.trim()}>{busy ? '보내는 중' : menu && typed !== null ? '답하기' : agent ? '보내기' : '실행'}</Button>
        </div>
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}

// 자동 완성 — 커서 앞 낱말이 맨 앞의 /(명령·스킬), Codex 의 $(스킬), 어디서든 @(파일)이면 추천을 띄운다.
// ↑↓ 로 고르고 Tab·Enter 로 넣는다. Esc 로 닫으면 그 낱말이 바뀔 때까지 다시 안 뜬다.
type Ac = { open: boolean; items: { insert: string; label: string; desc?: string }[]; index: number; start: number; move: (d: number) => void; dismiss: () => void };
function useComplete(p: HPane, text: string, caret: number): Ac {
  const before = text.slice(0, caret), tok = before.match(/(?:^|\s)([/@$][^\s]*)$/)?.[1] ?? null;
  const start = caret - (tok?.length ?? 0);
  const kind = !tok ? null : tok[0] === '@' ? 'file' : (tok[0] === '/' && start === 0 && p.agent) || (tok[0] === '$' && p.agent === 'codex') ? 'cmd' : null;
  const cmds = useQuery({ queryKey: ['cmds', p.id], queryFn: () => get<{ name: string; desc: string; skill?: boolean }[]>(`/api/herdr/panes/${p.id}/commands`), enabled: kind === 'cmd', staleTime: 60_000 });
  const q = kind === 'file' ? tok!.slice(1) : '';
  const fs = useQuery({ queryKey: ['files', p.id, q], queryFn: () => get<string[]>(`/api/herdr/panes/${p.id}/files?q=${encodeURIComponent(q)}`), enabled: kind === 'file', placeholderData: keepPreviousData, staleTime: 10_000 });
  const [index, setIndex] = useState(0), [closed, setClosed] = useState<string | null>(null);
  useEffect(() => setIndex(0), [tok]);
  const low = tok?.toLowerCase() ?? '';
  // Codex 스킬은 /이름으로 보이고(보낼 때 서버가 $이름으로 바꾼다), $ 로 치면 스킬만 $이름으로
  const dollar = tok?.[0] === '$';
  const items = kind === 'cmd'
    ? (cmds.data ?? []).filter(c => !dollar || c.skill).map(c => ({ ...c, name: dollar ? `$${c.name.slice(1)}` : c.name }))
      .filter(c => c.name.toLowerCase().includes(low)).sort((a, b) => Number(!a.name.toLowerCase().startsWith(low)) - Number(!b.name.toLowerCase().startsWith(low))).slice(0, 50)
      .map(c => ({ insert: c.name, label: c.name, desc: c.skill && !dollar ? `Codex 스킬 — $${c.name.slice(1)} 로 보낸다 · ${c.desc}` : c.desc }))
    : kind === 'file' ? (fs.data ?? []).map(f => ({ insert: `@${f}`, label: f })) : [];
  return {
    open: !!kind && items.length > 0 && closed !== `${start}:${tok}`, items, index: Math.min(index, items.length - 1), start,
    move: d => setIndex(i => (i + d + items.length) % items.length), dismiss: () => setClosed(`${start}:${tok}`),
  };
}

function Suggest({ ac, onPick }: { ac: Ac; onPick: (i: number) => void }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.children[ac.index]?.scrollIntoView({ block: 'nearest' }); }, [ac.index]);
  return (
    <div ref={list} className="absolute bottom-full left-0 z-20 mb-2 max-h-64 w-full overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg">
      {ac.items.map((it, i) => (
        <button key={it.insert} onMouseDown={e => { e.preventDefault(); onPick(i); }}
          className={`flex w-full items-baseline gap-3 rounded-lg px-2.5 py-1.5 text-left text-sm ${i === ac.index ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60'}`}>
          <span className="shrink-0 font-mono text-xs font-semibold text-primary">{it.label}</span>
          {it.desc && <span className="truncate text-xs text-muted-foreground">{it.desc}</span>}
        </button>
      ))}
    </div>
  );
}

// 터미널 — herdr terminal session 의 프레임을 그대로 그린다. 첫 프레임(full)이 화면 전체, 그 뒤는 바뀐 부분.
// 평소엔 보기(observe). 누르면 입력 모드(control)로 다시 붙어 키·휠이 이 pane 으로 간다. pane 하나에 입력은 하나 —
// 다른 화면이 입력 중이면 가져올지 묻는다. 끊기면 EventSource 가 다시 붙고 서버가 full 부터 다시 보낸다.
function Term({ pane }: { pane: string }) {
  const box = useRef<HTMLDivElement>(null), wrap = useRef<HTMLDivElement>(null), term = useRef<Terminal | null>(null);
  const fit = useFit(wrap, term);
  const [mode, setMode] = useState<'view' | 'control'>('view'), [takeover, setTakeover] = useState(false);
  // state: 연결 상태, note: 입력 모드가 막히거나 뺏긴 사유(다음 동작까지 남긴다), busyBy: 다른 화면이 입력 중
  const [state, setState] = useState('연결 중'), [note, setNote] = useState(''), [busyBy, setBusyBy] = useState(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const t = new Terminal({ disableStdin: true, cursorBlink: false, fontSize: 13, scrollback: 0, fontFamily: 'Menlo, ui-monospace, monospace' });
    t.open(box.current!);
    term.current = t;
    // 터미널 칸에서 끌어 고르면 손을 뗄 때 복사(xterm 은 자체 선택이라 따로)
    const copySel = () => { if (t.hasSelection()) void copyText(t.getSelection().replace(/[ \t]+$/gm, '')); };   // 줄 끝 빈칸은 뺀다
    const el = box.current!;
    el.addEventListener('mouseup', copySel);
    // 키 — 보내는 중에 친 것은 모아 두었다가 한 번에(순서 유지).
    let queue = '', sending = false;
    const flush = async () => {
      if (sending || !queue) return;
      sending = true;
      const text = queue; queue = '';
      await post(`/api/herdr/panes/${pane}/input`, { text }).catch(e => setState(String(e)));
      sending = false;
      void flush();
    };
    const sub = t.onData(d => { if (modeRef.current === 'control') { queue += d; void flush(); } });
    // 휠 — 입력 모드에서만 herdr 쪽 화면을 올리고 내린다. xterm 이 휠을 화살표 키로 바꿔 보내지 않게 여기서 끊는다
    // (지난 줄이 없는 화면에서 xterm 은 휠을 ↑↓ 로 보낸다 — 셸 기록이 넘어간다).
    let lastWheel = 0;
    t.attachCustomWheelEventHandler(e => {
      e.preventDefault();
      if (modeRef.current === 'control' && Date.now() - lastWheel >= 40) {
        lastWheel = Date.now();
        void post(`/api/herdr/panes/${pane}/input`, { scroll: e.deltaY < 0 ? 'up' : 'down' }).catch(() => undefined);
      }
      return false;
    });
    return () => { el.removeEventListener('mouseup', copySel); sub.dispose(); t.dispose(); term.current = null; };
  }, [pane]);

  useEffect(() => {
    const t = term.current!;
    t.options.disableStdin = mode !== 'control';
    const q = mode === 'control' ? `?mode=control${takeover ? '&takeover=1' : ''}` : '';
    const es = new EventSource(`/api/herdr/panes/${encodeURIComponent(pane)}/stream${q}`);
    es.onopen = () => setState(mode === 'control' ? '입력 모드로 붙는 중' : '실시간 · 보기');
    es.onmessage = e => {
      const f = JSON.parse(e.data) as { full: boolean; w: number; h: number; b: string };
      if (f.full && mode === 'control') { setState('입력 중 — 키가 이 pane 으로 간다'); setBusyBy(false); setNote(''); t.focus(); }   // 첫 프레임 = 붙었다
      if (f.full) t.reset();
      if (t.cols !== f.w || t.rows !== f.h) { t.resize(f.w, f.h); fit(); }
      t.write(Uint8Array.from(atob(f.b), c => c.charCodeAt(0)));
    };
    es.addEventListener('closed', e => {
      es.close();
      const why = (e as MessageEvent).data as string;
      if (/already has an attached client/.test(why)) { setBusyBy(true); setNote('다른 화면이 이 pane 에 입력 중'); }
      else if (/taken over/.test(why)) setNote('다른 화면이 입력을 가져갔다 — 보기로 돌아감');
      else if (mode === 'view') setNote('pane 이 닫혔다');
      setMode('view'); setTakeover(false);
    });
    // 입력 모드는 끊기면 다시 붙지 않고 보기로 — 저절로 다시 붙으면(가져오기 포함) 다른 화면과 입력을 뺏고 뺏긴다.
    es.onerror = () => { if (mode === 'control') { es.close(); setMode('view'); setTakeover(false); } else setState('다시 붙는 중'); };
    return () => es.close();
  }, [pane, mode, takeover]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>터미널 · {state}</span>
        {note && <span className="text-amber-700 dark:text-amber-400">{note}</span>}
        {mode === 'control'
          ? <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => setMode('view')}>보기로</Button>
          : <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => { setTakeover(busyBy); setNote(''); setMode('control'); }}>{busyBy ? '입력 가져오기' : '입력'}</Button>}
      </div>
      <div ref={wrap} onClick={() => { if (mode === 'view' && !busyBy) { setNote(''); setMode('control'); } }}
        className={`min-h-0 max-w-full flex-1 overflow-auto rounded-md bg-black p-2 ${mode === 'control' ? 'ring-2 ring-sky-500' : 'cursor-pointer'}`}>
        <div ref={box} className="w-fit" />
      </div>
    </div>
  );
}
