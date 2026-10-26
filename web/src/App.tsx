// EDITH 화면 — 위에서 「herdr」·「스킬」·「공방」·「런」·「배포」·「오늘」·「설정」 을 고른다. 주소는 #/today, #/herdr/<pane id>, #/skills/<id>, #/workshop/<폴더>, #/runs/<번호>, #/deploy(옛 #/results — 배포가 결과를 품었다), #/settings. 오른쪽 위 종은 알림함.
// 다른 기기의 EDITH 를 터널로 보고 있으면(원격) 보라 테두리·「원격 · 기기」 배지·탭 제목 [기기] 로 이 기기 화면과 헷갈리지 않게 한다.
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, post, useHerdr, useLive, useView, type HerdrView, type View } from './api.ts';
import { HerdrPage } from './Herdr.tsx';
import { AlertBell, useAlerts } from './Alerts.tsx';
import { SkillsPage } from './Skills.tsx';
import { SettingsPage } from './Settings.tsx';
// 공방은 캔버스 라이브러리(React Flow)를 쓴다 — 공방을 열 때만 불러와 다른 화면의 첫 로딩을 늘리지 않는다
const WorkshopPage = lazy(() => import('./Workshop.tsx').then(m => ({ default: m.WorkshopPage })));
const RunsPage = lazy(() => import('./Runs.tsx').then(m => ({ default: m.RunsPage })));
import { copyOnSelect, toast } from './copy.ts';
import { DeployPage } from './Deploy.tsx';
import { TodayPage } from './Today.tsx';
import { Icon, TERMINAL } from './ui.tsx';
import { APP_NAME, applyTheme, readTheme } from './theme.ts';

// 육각형 로고(lucide hexagon + 안쪽 꼭짓점 선)·스킬 탭 아이콘(lucide layout-grid)·설정 탭 아이콘(lucide settings)
const HEX = <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></>;
const GEAR = <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>;
const GRID = <><rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" /></>;

// 공방 탭 아이콘(lucide workflow)
const FLOW = <><rect width="8" height="8" x="3" y="3" rx="2" /><path d="M7 11v4a2 2 0 0 0 2 2h4" /><rect width="8" height="8" x="13" y="13" rx="2" /></>;
const PLAY = <><circle cx="12" cy="12" r="10" /><path d="m10 8 6 4-6 4z" /></>;   // 런 탭(lucide circle-play)
const TODAY = <><path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /><path d="m9 16 2 2 4-4" /></>;   // 오늘 탭(lucide calendar-check)
const ROCKET = <><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" /><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" /><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" /><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" /></>;   // 배포 탭(lucide rocket)

const MENU = { herdr: 'herdr', skills: '스킬', workshop: '공방', runs: '런', deploy: '배포', today: '오늘', settings: '설정' };
const route = () => {
  const h = decodeURIComponent(location.hash), skill = h.match(/^#\/skills(?:\/(.+))?/), ws = h.match(/^#\/workshop(?:\/(.+))?/), runs = h.match(/^#\/runs(?:\/(.+))?/);
  if (h.startsWith('#/settings')) return { view: 'settings' as const, id: undefined };
  if (h.startsWith('#/deploy') || h.startsWith('#/results')) return { view: 'deploy' as const, id: undefined };
  if (h.startsWith('#/today')) return { view: 'today' as const, id: undefined };
  if (ws) return { view: 'workshop' as const, id: ws[1] };
  if (runs) return { view: 'runs' as const, id: runs[1] };
  return skill ? { view: 'skills' as const, id: skill[1] } : { view: 'herdr' as const, id: h.match(/^#\/herdr\/(.+)/)?.[1] };
};

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
  // 탭 제목 — herdr 는 보고 있는 pane 의 워크스페이스 이름, 나머지(pane 을 안 열었을 때도)는 「EDITH | 메뉴」, 런 하나를 열었으면 「EDITH | 런 #12」
  const pane = r.view === 'herdr' ? herdr.data?.panes.find(p => p.id === r.id) : undefined;
  const menu = r.view === 'runs' && /^\d+$/.test(r.id ?? '') ? `${MENU.runs} #${r.id}` : MENU[r.view];
  const title = herdr.data?.workspaces.find(w => w.workspace_id === pane?.workspace)?.label || `${APP_NAME} | ${menu}`;
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
  const nav = (on: boolean) => `flex h-13 shrink-0 items-center gap-2 border-b-2 px-4 text-sm whitespace-nowrap transition ${on ? 'border-primary bg-accent/60 font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`;
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
        {/* 좁은 화면에선 탭 줄만 옆으로 밀린다(페이지는 가로로 안 밀리게) */}
        <nav className="-my-px flex max-w-full min-w-0 self-stretch overflow-x-auto [scrollbar-width:none]">
          <a href="#/herdr" className={nav(r.view === 'herdr')}><Icon className="size-4">{TERMINAL}</Icon>herdr</a>
          <a href="#/skills" className={nav(r.view === 'skills')}><Icon className="size-4">{GRID}</Icon>스킬</a>
          <a href="#/workshop" className={nav(r.view === 'workshop')}><Icon className="size-4">{FLOW}</Icon>공방</a>
          <a href="#/runs" className={`relative ${nav(r.view === 'runs')}`}><Icon className="size-4">{PLAY}</Icon>런
            {asked > 0 && <span title={`받은 요청 ${asked} — 런 시작 · 거절 전까지 보인다`} className="absolute top-3 right-1.5 min-w-3 rounded-full bg-red-500 px-0.5 text-center text-[0.5rem] leading-3 font-bold text-white tabular-nums ring-2 ring-card">{asked}</span>}</a>
          <a href="#/deploy" className={nav(r.view === 'deploy')}><Icon className="size-4">{ROCKET}</Icon>배포</a>
          <a href="#/today" className={nav(r.view === 'today')}><Icon className="size-4">{TODAY}</Icon>오늘</a>
          <a href="#/settings" className={nav(r.view === 'settings')}><Icon className="size-4">{GEAR}</Icon>설정</a>
        </nav>
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
      {r.view === 'skills' ? <SkillsPage id={r.id} side={side} /> : r.view === 'workshop' || r.view === 'runs' ? <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">불러오는 중…</p>}>{r.view === 'workshop' ? <WorkshopPage id={r.id} side={side} /> : <RunsPage id={r.id} side={side} />}</Suspense> : r.view === 'settings' ? <SettingsPage theme={theme} setTheme={setTheme} /> : r.view === 'deploy' ? <DeployPage /> : r.view === 'today' ? <TodayPage /> : <HerdrPage pane={r.id} side={side} brand={APP_NAME} />}
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
        const n = new Notification(remote ? `승인 대기 · ${remote}` : '승인 대기', { body: `${ws?.label ?? ''} · ${p.title}`, tag: id });
        n.onclick = () => { window.focus(); location.hash = `#/herdr/${id}`; };
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
