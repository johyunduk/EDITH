// 머리줄 탭 줄 — 열어 둔 화면(pane · 런 · 배포 …)을 탭으로 늘어놓는다. 위 메뉴는 「+」 창 안으로 옮겼다(규칙은 tabs.ts).
// ⌘클릭 · 가운데 클릭 = 새 탭, 끌어서 순서 바꾸기(사이드의 pane 을 끌어 놓으면 새 탭), ⌥T 새 탭 · ⌥W 닫기 · ⌥1~9 옮기기 — ⌘ 조합은 브라우저가 먼저 가져간다.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { HerdrView } from './api.ts';
import { Icon, TERMINAL } from './ui.tsx';
import { DOT, DRAG_PANE, Kind, carrying, paneText } from './herdrUi.tsx';
import { runNo } from './runFlow.ts';
import { clean, close, current, move, navigate, open, restore, route, tabKey, type Tabs } from './tabs.ts';

// 메뉴 아이콘 — lucide layout-grid · workflow · circle-play · rocket · calendar-check · settings · plus · x
const GRID = <><rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" /></>;
const FLOW = <><rect width="8" height="8" x="3" y="3" rx="2" /><path d="M7 11v4a2 2 0 0 0 2 2h4" /><rect width="8" height="8" x="13" y="13" rx="2" /></>;
const PLAY = <><circle cx="12" cy="12" r="10" /><path d="m10 8 6 4-6 4z" /></>;
const ROCKET = <><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" /><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" /><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" /><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" /></>;
const TODAY = <><path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /><path d="m9 16 2 2 4-4" /></>;
const GEAR = <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>;
const PLUS = <path d="M12 5v14M5 12h14" />, X = <path d="M18 6 6 18M6 6l12 12" />;

// 스킬 메뉴는 숨긴다(2026-10-30 — 노드 스킬은 공방에서 본다). 화면 · #/skills 주소는 그대로 — 다시 보이려면 true
const SKILLS_MENU = false;
export const MENU = { herdr: 'herdr', skills: '스킬', workshop: '공방', runs: '런', deploy: '배포', today: '오늘', settings: '설정' };
const ICON = { herdr: TERMINAL, skills: GRID, workshop: FLOW, runs: PLAY, deploy: ROCKET, today: TODAY, settings: GEAR };
const TILES: { view: keyof typeof MENU; sub: string }[] = [
  { view: 'herdr', sub: 'pane 고르기' }, ...(SKILLS_MENU ? [{ view: 'skills' as const, sub: '스킬 · 명령' }] : []), { view: 'workshop', sub: '엔진 · 노드' },
  { view: 'runs', sub: '런 목록' }, { view: 'deploy', sub: '배포 목록' }, { view: 'today', sub: '오늘 할 일' }, { view: 'settings', sub: '테마 · 엔진 설정' },
];
const DRAG_TAB = 'text/x-edith-tab';

// 탭 상태 — 이 브라우저에만 기억한다(저장이 막혀도 이 화면에서는 동작).
// shortcut: 브라우저 탭 여러 개에 EDITH 를 띄우면 마지막에 바꾼 쪽 목록이 남는다, 브라우저 탭 하나로 쓰는 게 자리 잡으면 그대로 둔다
const KEY = 'edith.tabs';
let state = restore(read(), location.hash);
const subs = new Set<() => void>();
function read(): unknown {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 저장 안 됨 — 이 화면에서만 */ }
}
function set(next: Tabs) {
  if (next === state) return;
  state = next; save();
  // 다른 탭으로 옮겼으면 주소도 — 돌아오는 hashchange 는 navigate 가 그대로 둔다
  if (clean(location.hash) !== current(next).hash) location.hash = current(next).hash;
  subs.forEach(f => f());
}
if (clean(location.hash) !== current(state).hash) history.replaceState(null, '', current(state).hash);
save();
addEventListener('hashchange', () => set(navigate(state, location.hash)));

export const openTab = (hash: string) => set(open(state, hash));
const useTabs = () => useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => state);

// ⌘클릭 · Ctrl+클릭 · 가운데 클릭한 화면 안 링크(#/…)는 브라우저 새 탭 대신 EDITH 새 탭으로
function newTabClick(e: MouseEvent) {
  if (e.button === 0 ? !(e.metaKey || e.ctrlKey) : e.button !== 1) return;
  const a = e.target instanceof Element ? e.target.closest('a[href^="#/"]') : null;
  if (!a) return;
  e.preventDefault(); e.stopPropagation();
  openTab(a.getAttribute('href')!);
}
addEventListener('click', newTabClick, true);
addEventListener('auxclick', newTabClick, true);

// 탭에 보일 것 — herdr pane 은 상태 점 · 에이전트 아이콘 · pane 이름, 나머지는 메뉴 아이콘 · 이름(런은 번호까지)
type Look = { icon: ReactNode; text: string; pane?: true; status?: string | null; push?: string; where?: string };
function look(hash: string, data?: HerdrView): Look {
  const r = route(hash);
  if (r.view === 'herdr' && r.id) {
    const p = data?.panes.find(x => x.id === r.id);
    if (!p) return { icon: <Icon className="size-3.5 text-muted-foreground">{TERMINAL}</Icon>, text: data ? '닫힌 pane' : r.id };
    return { icon: <Kind agent={p.agent} />, text: paneText(p), pane: true, status: p.status, push: p.push, where: data?.workspaces.find(w => w.workspace_id === p.workspace)?.label };
  }
  const n = r.view === 'runs' ? r.id?.match(/^\d+/)?.[0] : undefined;
  const text = n ? `${MENU.runs} ${runNo(Number(n))}` : r.view === 'runs' && r.id?.startsWith('schedule/') ? '런 · 스케줄'
    : r.view === 'workshop' && r.id ? `공방 · ${r.id}` : r.view === 'settings' && r.id ? '엔진 설정' : r.view === 'skills' && r.id ? `스킬 · ${r.id}` : MENU[r.view];
  return { icon: <Icon className="size-3.5">{ICON[r.view]}</Icon>, text };
}

const WAIT = 'border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200';
const PUSH = 'border-rose-300 bg-rose-100 text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-200';   // main · master 푸시 승인 대기(커밋 지킴이)
const MARK = 'before:absolute before:inset-y-1 before:-left-[5px] before:w-0.5 before:rounded-full before:bg-primary';
const MARK_END = 'after:absolute after:inset-y-1 after:-right-[5px] after:w-0.5 after:rounded-full after:bg-primary';

export function TabBar({ data, asked }: { data?: HerdrView; asked: number }) {
  const s = useTabs(), [adding, setAdding] = useState(false), [drag, setDrag] = useState<{ id: string; to: number } | null>(null);
  // ⌥T 새 탭 창 · ⌥W 닫기 · ⌥1~9 그 차례 탭(9 는 맨 끝). 터미널 안에서는 ⌥ 가 터미널 키라 그대로 둔다
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || e.isComposing) return;
      if (e.target instanceof Element && e.target.closest('.xterm')) return;
      const n = e.code.match(/^Digit([1-9])$/)?.[1], t = n && (n === '9' ? state.list.at(-1) : state.list[Number(n) - 1]);
      if (e.code === 'KeyT') setAdding(v => !v);
      else if (e.code === 'KeyW') set(close(state, state.active));
      else if (t) set({ ...state, active: t.id });
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
  // 탭은 끌어서 자리를 바꾸고, 사이드 · 칸의 pane 을 끌어 놓으면 새 탭으로 연다
  const over = (e: React.DragEvent) => {
    if (!carrying(e, DRAG_TAB) && !carrying(e, DRAG_PANE)) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    if (drag && e.target === e.currentTarget && drag.to !== s.list.length) setDrag({ ...drag, to: s.list.length });   // 탭 줄 오른쪽 빈 곳 = 맨 뒤
  };
  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    if (drag) { set(move(state, drag.id, drag.to)); setDrag(null); return; }
    const pane = e.dataTransfer.getData(DRAG_PANE);
    if (pane) openTab(`#/herdr/${pane}`);
  };
  return (
    <div onDragOver={over} onDrop={drop} className="flex max-w-full min-w-0 flex-1 items-center gap-1.5 self-stretch">
      <nav aria-label="열어 둔 탭" className="flex min-w-0 items-center gap-1.5 overflow-x-auto px-1 py-2 [scrollbar-width:none]">
        {s.list.map((t, i) => {
          const l = look(t.hash, data), on = t.id === s.active, wait = !on && l.status === 'blocked';
          const tone = on ? 'border-primary/50 bg-accent font-semibold text-accent-foreground shadow-[inset_0_-2px_0_var(--primary)]' : wait ? (l.push ? PUSH : WAIT) : 'bg-card text-foreground hover:bg-muted';
          const mark = drag?.id === t.id ? 'opacity-50' : drag?.to === i ? MARK : drag?.to === i + 1 && i === s.list.length - 1 ? MARK_END : '';
          return (
            <div key={t.id} draggable title={l.where ? `${l.where} · ${l.text}` : l.text}
              onDragStart={e => { e.dataTransfer.setData(DRAG_TAB, t.id); e.dataTransfer.effectAllowed = 'move'; setDrag({ id: t.id, to: i }); }}
              onDragOver={e => {
                if (!drag) return;
                const r = e.currentTarget.getBoundingClientRect(), to = e.clientX < r.left + r.width / 2 ? i : i + 1;
                if (to !== drag.to) setDrag({ ...drag, to });
              }}
              onDragEnd={() => setDrag(null)}
              onAuxClick={e => { if (e.button === 1) set(close(state, t.id)); }}
              className={`relative flex h-8 max-w-60 shrink-0 items-center rounded-lg border text-[0.8125rem] transition-colors ${tone} ${mark}`}>
              <button aria-current={on ? 'page' : undefined} onClick={() => set({ ...state, active: t.id })} className="flex h-full min-w-0 items-center gap-1.5 pr-1 pl-2.5">
                {l.pane && <span className={`size-2 shrink-0 rounded-full ${DOT[l.status ?? ''] ?? 'bg-muted-foreground/30'}`} />}
                {l.icon}<span className="truncate">{l.text}</span>
                {wait && <span className="shrink-0 text-xs font-bold">{l.push ? `${l.push} 푸시 대기` : '승인 대기'}</span>}
              </button>
              {s.list.length > 1 && (
                <button aria-label="탭 닫기" title="탭 닫기 (⌥W) — 화면만 닫힌다. 세션은 그대로 돌고 「+」 의 최근 닫은 탭에서 다시 연다" onClick={() => set(close(state, t.id))}
                  className="mr-1 grid size-5 shrink-0 place-items-center rounded opacity-60 hover:bg-foreground/10 hover:opacity-100"><Icon className="size-3">{X}</Icon></button>
              )}
            </div>
          );
        })}
      </nav>
      <NewTab on={adding} setOn={setAdding} s={s} data={data} asked={asked} />
    </div>
  );
}

// 「+」 창 — 메뉴(이미 열린 메뉴는 그 탭으로)와 최근 닫은 탭
function NewTab({ on, setOn, s, data, asked }: { on: boolean; setOn: (f: (v: boolean) => boolean) => void; s: Tabs; data?: HerdrView; asked: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!on) return;
    const out = (e: MouseEvent) => { if (!(e.target instanceof Node && box.current?.contains(e.target))) setOn(() => false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOn(() => false); };
    addEventListener('mousedown', out); addEventListener('keydown', esc);
    return () => { removeEventListener('mousedown', out); removeEventListener('keydown', esc); };
  }, [on, setOn]);
  const go = (h: string) => { openTab(h); setOn(() => false); };
  const opened = new Set(s.list.map(t => tabKey(t.hash)));
  return (
    <div ref={box} className="relative shrink-0">
      <button aria-label="새 탭" aria-expanded={on} title="새 탭 (⌥T) — 메뉴 · 최근 닫은 탭" onClick={() => setOn(v => !v)}
        className={`relative grid size-8 place-items-center rounded-lg border transition ${on ? 'border-primary/60 bg-accent text-accent-foreground' : 'border-dashed text-muted-foreground hover:border-solid hover:bg-muted hover:text-foreground'}`}>
        <Icon className="size-4">{PLUS}</Icon>
        {asked > 0 && <span title={`받은 요청 ${asked} — 런 시작 · 거절 전까지 보인다`} className="absolute -top-1.5 -right-1.5 min-w-3 rounded-full bg-red-500 px-0.5 text-center text-[0.5rem] leading-3 font-bold text-white tabular-nums ring-2 ring-card">{asked}</span>}
      </button>
      {on && (
        <div role="dialog" aria-label="새 탭" className="absolute top-full left-0 z-40 mt-2 w-[26rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl">
          <div className="flex items-center px-4 pt-3"><span className="text-sm font-semibold">새 탭</span><kbd className="ml-auto rounded border px-1.5 font-sans text-[0.6875rem] text-muted-foreground">⌥T</kbd></div>
          <div className="grid grid-cols-3 gap-2 p-3">
            {TILES.map(m => {
              const h = `#/${m.view}`, req = m.view === 'runs' && asked > 0;
              return (
                <button key={m.view} onClick={() => go(h)} className="flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition hover:border-primary/60 hover:bg-accent/50">
                  <Icon className="size-5 text-primary">{ICON[m.view]}</Icon>
                  <span className="text-sm font-semibold">{MENU[m.view]}</span>
                  <span className={`text-xs ${req ? 'font-bold text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>{req ? `받은 요청 ${asked}` : opened.has(tabKey(h)) ? '이미 열려 있음' : m.sub}</span>
                </button>
              );
            })}
          </div>
          {s.closed.length > 0 && (
            <div className="border-t p-1.5">
              <p className="px-2.5 pt-1 pb-1.5 text-xs font-semibold text-muted-foreground">최근 닫은 탭</p>
              {s.closed.slice(0, 6).map(h => {
                const l = look(h, data);
                return (
                  <button key={h} onClick={() => go(h)} className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm hover:bg-muted">
                    {l.icon}<span className="truncate">{l.text}</span>{l.where && <span className="shrink-0 text-xs text-muted-foreground">{l.where}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
