// EDITH 화면 — 위에서 「herdr」·「스킬」 을 고른다. 주소는 #/herdr/<pane id>, #/skills/<id>. 오른쪽 위 종은 알림함.
import { useEffect, useRef, useState } from 'react';
import { useHerdr, useLive, type HerdrView } from './api.ts';
import { HerdrPage } from './Herdr.tsx';
import { AlertBell, useAlerts } from './Alerts.tsx';
import { SkillsPage } from './Skills.tsx';
import { copyOnSelect } from './copy.ts';

const route = () => {
  const h = decodeURIComponent(location.hash), skill = h.match(/^#\/skills(?:\/(.+))?/);
  return skill ? { view: 'skills' as const, id: skill[1] } : { view: 'herdr' as const, id: h.match(/^#\/herdr\/(.+)/)?.[1] };
};

export default function App() {
  useLive();
  useEffect(copyOnSelect, []);
  const [r, setR] = useState(route);
  useEffect(() => {
    const f = () => setR(route());
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  const herdr = useHerdr();
  useBlockedAlert(herdr.data);
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
  const nav = (on: boolean) => `rounded-lg px-3 py-1 text-sm transition ${on ? 'bg-card font-semibold text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`;
  const err = herdr.error && String(herdr.error);
  return (
    <div className="flex h-screen flex-col">
      {/* relative z-40 — 흐림(backdrop-blur)이 헤더를 따로 쌓아서, 이게 없으면 알림 목록이 아래 칸(z-10·20) 뒤로 들어간다 */}
      <header className="relative z-40 flex h-13 shrink-0 items-center gap-3 border-b bg-card/80 px-4 backdrop-blur">
        <button onClick={toggleSide} title={`사이드 메뉴 ${side ? '접기' : '펴기'} (⌘B)`}
          className={`-ml-1 rounded-lg p-1.5 hover:bg-muted ${side ? 'text-muted-foreground' : 'bg-accent text-accent-foreground'}`}>
          <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" /><path d="M7.5 3.5v13" />{side && <path d="M4.6 7.5h1M4.6 10h1M4.6 12.5h1" strokeLinecap="round" />}
          </svg>
        </button>
        <span className="flex items-center gap-2 font-bold tracking-tight">
          <span className="size-6 rounded-lg bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 shadow-sm" />EDITH
        </span>
        <nav className="flex gap-0.5 rounded-xl bg-muted p-0.5">
          <a href="#/herdr" className={nav(r.view === 'herdr')}>herdr</a>
          <a href="#/skills" className={nav(r.view === 'skills')}>스킬</a>
        </nav>
        {perm === 'default' && (
          <button className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted" onClick={() => void Notification.requestPermission().then(setPerm)}>승인 대기 알림 켜기</button>
        )}
        {err?.includes('401') && <span className="text-sm text-destructive">열쇠 없음 — edith serve 가 보여 준 주소(…/?key=)로 한 번 연다</span>}
        <span className="ml-auto flex items-center gap-2"><AlertBell data={herdr.data} alerts={alerts} /></span>
      </header>
      {r.view === 'skills' ? <SkillsPage id={r.id} side={side} /> : <HerdrPage pane={r.id} side={side} />}
    </div>
  );
}

// 승인 대기 알림 — 어느 pane 이든 새로 승인 대기가 되면 브라우저 알림·짧은 소리, 탭 제목에 수. 목록은 2초마다 갱신된다.
function useBlockedAlert(data?: HerdrView) {
  const prev = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!data) return;
    const now = new Set(data.panes.filter(p => p.status === 'blocked').map(p => p.id));
    document.title = now.size ? `(${now.size}) EDITH` : 'EDITH';
    const fresh = prev.current ? [...now].filter(id => !prev.current!.has(id)) : [];
    prev.current = now;
    for (const id of fresh) {
      const p = data.panes.find(x => x.id === id)!, ws = data.workspaces.find(w => w.workspace_id === p.workspace);
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const n = new Notification('승인 대기', { body: `${ws?.label ?? ''} · ${p.title}`, tag: id });
        n.onclick = () => { window.focus(); location.hash = `#/herdr/${id}`; };
      }
    }
    if (fresh.length) beep();
  }, [data]);
}

function beep() {
  try {
    const a = new AudioContext(), o = a.createOscillator(), g = a.createGain();
    o.frequency.value = 880; g.gain.value = 0.05;
    o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.15);
    o.onended = () => void a.close();
  } catch { /* 소리를 못 내도 알림은 간다 */ }
}
