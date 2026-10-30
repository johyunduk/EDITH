// 알림함 — 에이전트가 승인 대기·끝남이 된 순간을 내역으로 쌓는다(이 브라우저에 최근 100개, 저장이 막혀도 동작).
// 헤더 종 버튼에 지금 확인이 필요한 수(승인 대기가 있으면 주황), 누르면 내역, 항목을 누르면 그 pane 으로 간다.
// 화면이 열려 있는 동안 바뀐 것만 잡힌다 — 닫혀 있던 사이에 그렇게 된 pane 은 다음에 열 때 그 시각으로 들어온다.
// 알림마다 그때 시킨 말과 답 첫 줄(asks.ts)을 받아 같이 둔다 — 나중에 그 pane 에 다른 일을 시켜도 지난 알림은 그때 일로 남게.
import { useEffect, useRef, useState } from 'react';
import { get, type HerdrView } from './api.ts';
import { Kind, paneText } from './herdrUi.tsx';
import type { Asks } from './asks.ts';

// ask 는 받은 뒤에만 있다('' 면 기록에 시킨 말이 없었다). 예전 알림·셸은 text(pane 이름)만.
type Alert = { id: string; pane: string; kind: 'blocked' | 'done'; ws: string; text: string; agent: string | null; at: number; read: boolean; ask?: string; answer?: string };
const KEY = 'edith.alerts';
const load = (): Alert[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Alert[]; } catch { return []; } };
const store = (a: Alert[]) => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* 저장 안 됨 */ } };

export function useAlerts(data?: HerdrView) {
  const [list, setList] = useState(load);
  const prev = useRef<Map<string, string | null> | null>(null);
  useEffect(() => {
    if (!data) return;
    const was = prev.current;
    prev.current = new Map(data.panes.map(p => [p.id, p.status]));
    setList(old => {
      const latest = new Map<string, Alert>();
      for (const a of old) if (!latest.has(a.pane)) latest.set(a.pane, a);   // 앞이 최신
      const fresh = data.panes.filter(p => (p.status === 'blocked' || p.status === 'done')
        && (was ? was.get(p.id) !== p.status : latest.get(p.id)?.kind !== p.status))
        .map((p): Alert => {
          const w = data.workspaces.find(x => x.workspace_id === p.workspace);
          return { id: `${p.id}:${Date.now()}`, pane: p.id, kind: p.status as Alert['kind'], ws: w?.label ?? p.workspace, text: paneText(p), agent: p.agent, at: Date.now(), read: false };
        });
      if (!fresh.length) return old;
      const next = [...fresh, ...old].slice(0, 100);
      store(next);
      return next;
    });
  }, [data]);
  const update = (f: (a: Alert[]) => Alert[]) => setList(old => { const next = f(old); store(next); return next; });
  // 새 알림의 시킨 말 — 기록 파일이 상태보다 조금 늦게 써져서(Chat.tsx useRefetchOn) 잠깐 뒤에 받는다. 1분 넘은 알림은 그때 일이 아닐 수 있어 받지 않는다.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    for (const a of list) {
      if (a.ask !== undefined || asked.current.has(a.id) || (a.agent !== 'claude' && a.agent !== 'codex') || Date.now() - a.at > 60_000) continue;
      asked.current.add(a.id);
      setTimeout(() => void get<Asks>(`/api/herdr/panes/${a.pane}/asks`)
        .then(r => update(l => l.map(x => x.id === a.id ? { ...x, ask: r.asks[0]?.text ?? '', answer: r.answer?.text } : x)))
        .catch(() => undefined), 1500);
    }
  }, [list]);   // eslint-disable-line react-hooks/exhaustive-deps -- update 는 setList 만 쓴다
  return { list, update };
}

const ago = (t: number) => {
  const s = (Date.now() - t) / 1000;
  return s < 60 ? '방금' : s < 3600 ? `${Math.floor(s / 60)}분 전` : s < 86400 ? `${Math.floor(s / 3600)}시간 전`
    : new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
};
const BELL = <><path d="M10.268 21a2 2 0 0 0 3.464 0" /><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" /></>;   // lucide bell

export function AlertBell({ data, alerts }: { data?: HerdrView; alerts: ReturnType<typeof useAlerts> }) {
  const [open, setOpen] = useState(false), box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!(e.target instanceof Node && box.current?.contains(e.target))) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('mousedown', close); addEventListener('keydown', esc);
    return () => { removeEventListener('mousedown', close); removeEventListener('keydown', esc); };
  }, [open]);
  const status = new Map(data?.panes.map(p => [p.id, p.status]));
  const latest = new Set<string>(), seen = new Set<string>();
  for (const a of alerts.list) if (!seen.has(a.pane)) { seen.add(a.pane); latest.add(a.id); }
  const pending = (a: Alert) => latest.has(a.id) && status.get(a.pane) === a.kind;   // 그 pane 이 아직 그 상태 — 확인이 필요
  const blocked = data?.panes.filter(p => p.status === 'blocked').length ?? 0, waiting = blocked + (data?.panes.filter(p => p.status === 'done').length ?? 0);
  const go = (a: Alert) => { alerts.update(l => l.map(x => x.id === a.id ? { ...x, read: true } : x)); setOpen(false); location.hash = `#/herdr/${a.pane}`; };
  const unread = alerts.list.filter(a => !a.read).length;
  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(v => !v)} title="알림 — 승인 대기·끝남 내역"
        className={`relative rounded-lg p-1.5 hover:bg-muted ${open ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}>
        <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{BELL}</svg>
        {waiting > 0 && <span className={`absolute top-0 right-0 min-w-3 rounded-full px-0.5 text-center text-[0.5rem] leading-3 font-bold text-white tabular-nums ring-2 ring-card ${blocked ? 'bg-amber-500' : 'bg-emerald-500'}`}>{waiting}</span>}
      </button>
      {open && (
        <div className="absolute top-full right-0 z-40 mt-2 w-[26rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl">
          <div className="flex items-center gap-2 border-b px-3.5 py-2.5">
            <span className="text-sm font-semibold">알림</span>
            <span className="text-xs text-muted-foreground">확인 필요 {waiting}</span>
            <button disabled={!unread} onClick={() => alerts.update(l => l.map(a => ({ ...a, read: true })))} className="ml-auto rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">모두 읽음</button>
            <button disabled={!alerts.list.length} onClick={() => alerts.update(l => l.filter(pending))} title="확인이 필요한 것만 남기고 지운다" className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">지우기</button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto p-1">
            {!alerts.list.length && <p className="px-3 py-8 text-center text-sm text-muted-foreground">알림 없음</p>}
            {alerts.list.map(a => {
              const need = pending(a), b = a.kind === 'blocked';
              return (
                <button key={a.id} onClick={() => go(a)}
                  className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted ${need ? '' : 'opacity-60'}`}>
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${a.read ? 'bg-transparent' : b ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                  <span className="mt-0.5"><Kind agent={a.agent} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className={`truncate text-[0.8125rem] ${a.read ? '' : 'font-semibold'}`}>{a.ws}</span>
                      <span className="ml-auto shrink-0 text-[0.6875rem] text-muted-foreground">{ago(a.at)}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs">
                      <span className={`font-medium ${b ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{b ? '승인 대기' : '끝남'}</span>
                      <span className={`truncate ${a.ask ? 'text-foreground/85' : 'text-muted-foreground'}`}>· {a.ask || a.text}</span>
                      {need && <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 text-[0.625rem] text-muted-foreground">확인 필요</span>}
                    </span>
                    {a.answer && <span className="mt-0.5 block truncate text-xs text-muted-foreground">↳ {a.answer}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
