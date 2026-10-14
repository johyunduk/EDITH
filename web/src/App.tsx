// EDITH 화면 — 위에서 「herdr」·「스킬」 을 고른다. 주소는 #/herdr/<pane id>, #/skills/<id>. 오른쪽 위 종은 알림함.
// 다른 기기의 EDITH 를 터널로 보고 있으면(원격) 보라 테두리·「원격 · 기기」 배지·탭 제목 [기기] 로 이 기기 화면과 헷갈리지 않게 한다.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useHerdr, useLive, useView, type HerdrView } from './api.ts';
import { HerdrPage } from './Herdr.tsx';
import { AlertBell, useAlerts } from './Alerts.tsx';
import { SkillsPage } from './Skills.tsx';
import { copyOnSelect } from './copy.ts';
import { DropdownMenu } from 'radix-ui';
import { Icon, TERMINAL } from './ui.tsx';
import { APP_NAME, THEMES, applyTheme, parseTheme, readTheme } from './theme.ts';

// 육각형 로고(lucide hexagon + 안쪽 꼭짓점 선)·스킬 탭 아이콘(lucide layout-grid)
const HEX = <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></>;
const PALETTE = <><circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /><circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" /></>;   // lucide palette
const GRID = <><rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" /></>;

const route = () => {
  const h = decodeURIComponent(location.hash), skill = h.match(/^#\/skills(?:\/(.+))?/);
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
  useBlockedAlert(APP_NAME, herdr.data, remote);
  const alerts = useAlerts(herdr.data);
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
  const nav = (on: boolean) => `flex h-13 items-center gap-2 border-b-2 px-4 text-sm transition ${on ? 'border-primary bg-accent/60 font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`;
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
        <nav className="-my-px flex self-stretch">
          <a href="#/herdr" className={nav(r.view === 'herdr')}><Icon className="size-4">{TERMINAL}</Icon>herdr</a>
          <a href="#/skills" className={nav(r.view === 'skills')}><Icon className="size-4">{GRID}</Icon>스킬</a>
        </nav>
        {err?.includes('401') && <span className="text-sm text-destructive">열쇠 없음 — 터미널에서 edith 를 다시 치면 열쇠 붙은 주소로 열린다</span>}
        <span className="ml-auto flex items-center gap-2 py-1">
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
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button aria-label="테마 선택" title={`화면 테마: ${THEMES[theme].label}`}
                className="flex h-8 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-xs font-medium text-muted-foreground shadow-xs hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                <Icon className="size-3.5">{PALETTE}</Icon>{THEMES[theme].label}<Icon className="size-3 opacity-60"><path d="m6 9 6 6 6-6" /></Icon>
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={8} className="z-50 min-w-48 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-lg">
                <DropdownMenu.Label className="px-3 py-2 text-xs text-muted-foreground">화면 테마</DropdownMenu.Label>
                <DropdownMenu.RadioGroup value={theme} onValueChange={value => setTheme(parseTheme(value))}>
                  {Object.entries(THEMES).map(([id, preset]) => (
                    <DropdownMenu.RadioItem key={id} value={id} className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground">
                      {preset.label}<span className="ml-auto w-4"><DropdownMenu.ItemIndicator>✓</DropdownMenu.ItemIndicator></span>
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </span>
      </header>
      {r.view === 'skills' ? <SkillsPage id={r.id} side={side} /> : <HerdrPage pane={r.id} side={side} brand={APP_NAME} />}
    </div>
  );
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
