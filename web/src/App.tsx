// EDITH 화면 — 머리줄 탭 줄(Tabs.tsx)에 열어 둔 화면을 늘어놓고, 메뉴(herdr · 공방 · 런 · 배포 · 오늘 · 설정)는 「+」 창에서 연다. 주소는 tabs.ts 의 route. 오른쪽 위 종은 알림함.
// 다른 기기의 EDITH 를 터널로 보고 있으면(원격) 보라 테두리·「원격 · 기기」 배지·탭 제목 [기기] 로 이 기기 화면과 헷갈리지 않게 한다.
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, post, useHerdr, useLive, useView, type HerdrView, type View } from './api.ts';
import { HerdrPage } from './Herdr.tsx';
import { AlertBell, useAlerts } from './Alerts.tsx';
import { SkillsPage } from './Skills.tsx';
import { SettingsPage } from './Settings.tsx';
import { EngineSettingsPage } from './EngineSettings.tsx';
// 공방은 캔버스 라이브러리(React Flow)를 쓴다 — 공방을 열 때만 불러와 다른 화면의 첫 로딩을 늘리지 않는다
const WorkshopPage = lazy(() => import('./Workshop.tsx').then(m => ({ default: m.WorkshopPage })));
const RunsPage = lazy(() => import('./Runs.tsx').then(m => ({ default: m.RunsPage })));
import { copyOnSelect, toast } from './copy.ts';
import { CleanSheet, DeployPage } from './Deploy.tsx';
import { TodayPage } from './Today.tsx';
import { Icon } from './ui.tsx';
import { APP_NAME, applyTheme, readTheme } from './theme.ts';
import { runNo } from './runFlow.ts';
import { route } from './tabs.ts';
import { MENU, TabBar, openTab } from './Tabs.tsx';

// 육각형 로고(lucide hexagon + 안쪽 꼭짓점 선)
const HEX = <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></>;

export default function App() {
  const [theme, setTheme] = useState(readTheme);
  useLayoutEffect(() => applyTheme(theme), [theme]);
  useLive();
  useEffect(copyOnSelect, []);
  const [r, setR] = useState(route);
  useEffect(() => {
    const f = () => setR(route());
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  const herdr = useHerdr(), view = useView().data, remote = view?.remote ? view.host : null;
  // 배포 보드 틀 — 처음 「배포」 탭을 연 뒤로는 내리지 않고 숨겨 둔다(다시 열 때마다 보드를 처음부터 띄워 「불러오는 중」 몇 초를 기다리지 않게). 숨긴 동안도 보드는 30초마다 읽는다
  const board = view?.board && !remote ? view.board : null, [boardOn, setBoardOn] = useState(false);
  if (board && r.view === 'deploy' && !boardOn) setBoardOn(true);
  // 보드 카드 「정리」 — 보드 틀이 보낸 EDITH 항목으로 EDITH 정리 창(보드는 각자 맥의 워크트리 · 로컬 브랜치를 건드리지 않는다). 확인부터 보고, 치우는 건 창의 단추
  const [clean, setClean] = useState<{ ids: string[]; title: string } | null>(null), boardFrame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (!board) return;
    const f = (e: MessageEvent) => {
      const d = e.data as { type?: unknown; ids?: unknown; title?: unknown } | null;
      if (e.origin === new URL(board).origin && d?.type === 'gada-deploy:clean' && Array.isArray(d.ids) && d.ids.length && d.ids.every(i => typeof i === 'string'))
        setClean({ ids: (d.ids as string[]).slice(0, 20), title: String(d.title ?? '').slice(0, 120) });
    };
    addEventListener('message', f);
    return () => removeEventListener('message', f);
  }, [board]);
  // 탭 제목 — herdr 는 보고 있는 pane 의 「세션 이름 | 워크스페이스 이름」(탭이 좁으면 뒤가 잘리니 세션 이름이 앞), 나머지(pane 을 안 열었을 때도)는 「EDITH | 메뉴」, 런 하나를 열었으면 「EDITH | 런 #12」
  const pane = r.view === 'herdr' ? herdr.data?.panes.find(p => p.id === r.id) : undefined;
  const menu = r.view === 'runs' && /^\d+$/.test(r.id ?? '') ? `${MENU.runs} ${runNo(Number(r.id))}` : MENU[r.view];
  const place = herdr.data?.workspaces.find(w => w.workspace_id === pane?.workspace)?.label;
  const title = [pane?.title, place].filter(Boolean).join(' | ') || `${APP_NAME} | ${menu}`;
  useBlockedAlert(title, herdr.data, remote);
  const alerts = useAlerts(herdr.data);
  // 받은 요청 수 — 런 화면 목록과 같은 쿼리(시작 · 거절로 답하면 목록에서 빠지고 수도 같이 준다)
  const asked = useQuery({ queryKey: ['requests'], queryFn: () => get<unknown[]>('/api/requests'), refetchInterval: 5000 }).data?.length ?? 0;
  const [perm, setPerm] = useState(() => typeof Notification === 'undefined' ? 'denied' : Notification.permission);
  // 사이드 메뉴 접기 — 헤더 버튼이나 ⌘B·Ctrl+B. 이 브라우저에만 기억한다(저장이 막혀도 동작).
  const [side, setSide] = useState(() => { try { return localStorage.getItem('edith.side') !== 'off'; } catch { return true; } });
  const toggleSide = () => setSide(v => { try { localStorage.setItem('edith.side', v ? 'off' : 'on'); } catch { /* 저장 안 됨 */ } return !v; });
  useEffect(() => {
    // 터미널 입력 중의 Ctrl+B 는 터미널 키(커서 왼쪽 등)라 가로채지 않는다
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'b' || e.shiftKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest('.xterm')) return;
      e.preventDefault(); toggleSide();
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
  const err = herdr.error && String(herdr.error);
  return (
    <div className="flex h-screen flex-col">
      <div className="hud-corners" />
      {remote && <div className="pointer-events-none fixed inset-0 z-50 border-4 border-violet-500/80" />}
      {/* relative z-40 — 흐림(backdrop-blur)이 헤더를 따로 쌓아서, 이게 없으면 알림 목록이 아래 칸(z-10·20) 뒤로 들어간다 */}
      <header className={`relative z-40 flex min-h-13 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 backdrop-blur ${remote ? 'bg-violet-500/15' : 'bg-card/80'}`}>
        <button onClick={toggleSide} title={`사이드 메뉴 ${side ? '접기' : '펴기'} (⌘B)`}
          className={`-ml-1 rounded-lg p-1.5 hover:bg-muted ${side ? 'text-muted-foreground' : 'bg-accent text-accent-foreground'}`}>
          <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" /><path d="M7.5 3.5v13" />{side && <path d="M4.6 7.5h1M4.6 10h1M4.6 12.5h1" strokeLinecap="round" />}
          </svg>
        </button>
        <span className="flex items-center gap-2 text-lg font-bold tracking-[0.08em]">
          <Icon className="brand-mark size-6 text-primary">{HEX}<path d="M12 22V12M12 12 3.3 7M12 12l8.7-5" /></Icon>{APP_NAME}
        </span>
        <TabBar data={herdr.data} asked={asked} />
        {err?.includes('401') && <span className="text-sm text-destructive">열쇠 없음 — 터미널에서 edith 를 다시 치면 열쇠 붙은 주소로 열린다</span>}
        <span className="ml-auto flex items-center gap-2 py-1">
          {view && <Fresh view={view} />}
          {perm === 'default' && (
            <button title="승인 대기가 되면 브라우저 알림·소리로 알린다" onClick={() => void Notification.requestPermission().then(setPerm)}
              className="flex h-8 items-center rounded-lg border border-dashed px-2.5 text-xs text-muted-foreground transition hover:border-solid hover:bg-muted hover:text-foreground">알림 켜기</button>
          )}
          <AlertBell data={herdr.data} alerts={alerts} />
          {/* 어느 기기의 EDITH 를 보는지 — 이 기기면 LOCAL, 다른 기기를 터널로 열었으면 REMOTE(보라) */}
          {view && (
            <span title={remote ? `다른 기기(${view.host})의 EDITH 를 SSH 터널로 보고 있다 — 여기서 하는 일은 그 기기에서 돈다` : `이 기기(${view.host})의 EDITH`}
              className={`flex items-center gap-1.5 border-l pl-4 text-[0.6875rem] font-semibold tracking-[0.12em] whitespace-nowrap uppercase ${remote ? 'text-violet-600 dark:text-violet-400' : 'text-muted-foreground'}`}>
              {remote ? <span className="size-2 animate-pulse rounded-full bg-violet-500" /> : <span className="size-2 rounded-full border-2 border-muted-foreground/60" />}
              {remote ? 'Remote' : 'Local'}
            </span>
          )}
        </span>
      </header>
      {board && boardOn && <iframe ref={boardFrame} title="배포 보드" src={board} allow="clipboard-write" className={r.view === 'deploy' ? 'min-h-0 w-full flex-1 border-0' : 'hidden'} />}
      {/* 창을 닫으면 보드에 알린다 — 보드가 EDITH 목록을 새로 받아 정리해 보관한 카드를 바로 뺀다 */}
      {clean && board && <CleanSheet ids={clean.ids} title={clean.title} onClose={() => { setClean(null); boardFrame.current?.contentWindow?.postMessage({ type: 'gada-deploy:refresh' }, new URL(board).origin); }} />}
      {/* 「배포」 — view 를 받기 전엔 비워 둔다(옛 배포 화면이 잠깐 비쳤다가 보드로 바뀌지 않게) */}
      {r.view === 'skills' ? <SkillsPage id={r.id} side={side} /> : r.view === 'workshop' || r.view === 'runs' ? <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">불러오는 중…</p>}>{r.view === 'workshop' ? <WorkshopPage id={r.id} side={side} /> : <RunsPage id={r.id} side={side} />}</Suspense> : r.view === 'settings' ? (r.id ? <EngineSettingsPage key={r.id} id={r.id} /> : <SettingsPage theme={theme} setTheme={setTheme} />) : r.view === 'deploy' ? (view && !board ? <DeployPage /> : null) : r.view === 'today' ? <TodayPage /> : <HerdrPage pane={r.id} side={side} brand={APP_NAME} />}
    </div>
  );
}

// 새 코드 — 서버 코드가 바뀌었으면(받기·고침) 「다시 켜기」: 같은 터미널에서 새 코드로 다시 뜬다(herdr·pane 은 그대로).
// 화면만 새로 빌드됐으면 「새로 고침」. 원격으로 보는 중이면 그 기기 EDITH 를 다시 켠다.
function Fresh({ view }: { view: View }) {
  const first = useRef(view.web), [busy, setBusy] = useState(false);
  const restart = async () => {
    setBusy(true);
    try {
      await post('/api/restart', {});
      // 이전 서버는 곧 끊긴다 — 새 서버가 답하면(stale 아님) 새로 고친다
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 500));
        if ((await get<View>('/api/view').catch(() => null))?.stale === false) return location.reload();
      }
      throw new Error('20초 안에 다시 뜨지 않았다 — EDITH 를 띄운 터미널을 본다');
    } catch (e) { toast(`다시 켜지 못했다 — ${(e as Error).message}`, 7000); setBusy(false); }
  };
  const cls = 'flex h-8 items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2.5 text-xs font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-60';
  const where = view.remote ? `${view.host} 의 EDITH` : '이 EDITH';
  if (view.stale) return view.restart
    ? <button onClick={() => void restart()} disabled={busy} title={`서버 코드가 바뀌었다 — ${where} 를 새 코드로 다시 켠다. herdr 와 pane 은 그대로 돈다`} className={cls}>
        <span className="size-1.5 animate-pulse rounded-full bg-primary" />{busy ? '다시 켜는 중…' : '새 코드 · 다시 켜기'}</button>
    : <span title={`서버 코드가 바뀌었다 — ${where} 를 띄운 터미널에서 Ctrl+C 뒤 edith`} className={cls}>새 코드 · 터미널에서 다시 켜기</span>;
  if (first.current !== undefined && view.web !== first.current)
    return <button onClick={() => location.reload()} title="화면이 새로 빌드됐다 — 새로 고쳐 새 화면으로" className={cls}>새 화면 · 새로 고침</button>;
  return null;
}

// 승인 대기 알림 — 어느 pane 이든 새로 승인 대기가 되면 브라우저 알림·짧은 소리, 탭 제목에 수. 목록은 2초마다 갱신된다.
function useBlockedAlert(brand: string, data?: HerdrView, remote?: string | null) {
  const prev = useRef<Set<string> | null>(null);
  useEffect(() => {
    document.title = `${remote ? `[${remote}] ` : ''}${brand}`;
    if (!data) return;
    const now = new Set(data.panes.filter(p => p.status === 'blocked').map(p => p.id));
    document.title = `${now.size ? `(${now.size}) ` : ''}${remote ? `[${remote}] ` : ''}${brand}`;
    const fresh = prev.current ? [...now].filter(id => !prev.current!.has(id)) : [];
    prev.current = now;
    for (const id of fresh) {
      const p = data.panes.find(x => x.id === id)!, ws = data.workspaces.find(w => w.workspace_id === p.workspace);
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const what = p.push ? `⚠ ${p.push} 푸시 승인 대기` : '승인 대기';   // main · master 푸시(커밋 지킴이)는 제목에서 가른다
        const n = new Notification(remote ? `${what} · ${remote}` : what, { body: `${ws?.label ?? ''} · ${p.title}`, tag: id });
        n.onclick = () => { window.focus(); openTab(`#/herdr/${id}`); };   // 그 pane 탭으로(없으면 새 탭)
      }
    }
    if (fresh.length) beep();
  }, [data, remote, brand]);
}

function beep() {
  try {
    const a = new AudioContext(), o = a.createOscillator(), g = a.createGain();
    o.frequency.value = 880; g.gain.value = 0.05;
    o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.15);
    o.onended = () => void a.close();
  } catch { /* 소리를 못 내도 알림은 간다 */ }
}
