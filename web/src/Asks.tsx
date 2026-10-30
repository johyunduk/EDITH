// 시킨 말 보기 — 대화 칸 위 띠(머리줄 「시킨 말」 단추로 열고 닫는다), 사이드바에 마우스를 올리면 뜨는 카드, 상태 목록의 한 줄.
// 고르는 규칙은 asks.ts. 띠는 이미 받은 대화에서 바로 고르고, 나머지는 /api/herdr/panes/<id>/asks 로 받는다(pane 에 들어가기 전이라).
import { useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, type HPane } from './api.ts';
import { Icon } from './ui.tsx';
import { DOT, Kind, STATUS, paneText } from './herdrUi.tsx';
import { lastAsks, type Ask, type AskItem, type Asks } from './asks.ts';

export const PIN = <><path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" /></>;   // lucide pin
const hm = (t: number) => t ? new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
const who = (a: Ask) => a.from ? `${a.from} 세션이 보낸 말` : '내가 시킨 말';
export const isAgent = (p: HPane) => p.agent === 'claude' || p.agent === 'codex';

// 상태가 바뀌면(작업 중 → 끝남 등) 키가 달라져 다시 받는다
export const useAsks = (p: HPane) => useQuery({
  queryKey: ['asks', p.id, p.status], queryFn: () => get<Asks>(`/api/herdr/panes/${p.id}/asks`),
  enabled: isAgent(p), staleTime: 10_000,
});

// 띠 펼침 — pane 마다, 이 화면에서만 기억한다(「원래 화면」 단추와 같은 방식). 처음엔 접힘.
const openPanes = new Set<string>(), subs = new Set<() => void>();
export function useAsksOpen(id: string): [boolean, () => void] {
  const on = useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f); }, () => openPanes.has(id));
  return [on, () => { if (!openPanes.delete(id)) openPanes.add(id); subs.forEach(f => f()); }];
}

// 대화 칸 위 띠. 「그 자리로」 는 그 말풍선으로 스크롤한다(불러온 대화 안에 있을 때).
export function AskBand({ items, jump, close }: { items: AskItem[]; jump: (at: number) => void; close: () => void }) {
  const [main, more] = lastAsks(items).asks;
  return (
    <div className="sticky top-0 z-10 -mt-1 flex items-start gap-2.5 rounded-xl border border-primary/25 bg-accent/95 px-3 py-2.5 shadow-md backdrop-blur">
      <Icon className="mt-0.5 size-4 shrink-0 text-accent-foreground">{PIN}</Icon>
      {main ? (
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-2 text-[0.6875rem] font-semibold text-accent-foreground">{who(main)}<span className="font-normal text-muted-foreground">{hm(main.t)}</span></div>
          <p className="line-clamp-3 text-[0.84375rem] leading-relaxed break-words whitespace-pre-wrap">{main.text}</p>
          {more && <p className="truncate text-xs text-muted-foreground">↳ {hm(more.t)} · {more.text}</p>}
        </div>
      ) : <p className="min-w-0 flex-1 text-sm text-muted-foreground">불러온 대화 안에 내가 친 말이 없다 — 위로 올려 「이전 대화 더 보기」</p>}
      {main?.at !== undefined && (
        <button onClick={() => jump(main.at!)} className="flex h-7 shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-card px-2.5 text-xs font-semibold text-accent-foreground hover:bg-muted">
          그 자리로<Icon className="size-3.5"><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></Icon>
        </button>
      )}
      <button onClick={close} title="띠 닫기" aria-label="띠 닫기" className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
        <Icon className="size-3.5"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Icon>
      </button>
    </div>
  );
}

// 마우스를 올리고 잠깐 머물면 카드 — 목록을 훑어 내려갈 때마다 깜빡이지 않게. 사이드바가 overflow-hidden 이라 fixed 로 띄운다(Legend 와 같게).
// 카드는 마우스를 받지 않는다 — 줄을 누르면 그대로 그 pane 으로 간다.
export function useHoverCard() {
  const [at, setAt] = useState<CSSProperties | null>(null), timer = useRef(0);
  const enter = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setAt({ left: Math.min(r.right + 8, innerWidth - 368), top: Math.max(8, Math.min(r.top - 4, innerHeight - 340)) }), 350);
  };
  const leave = () => { clearTimeout(timer.current); setAt(null); };
  return { at, enter, leave };
}

export function AskCard({ panes, style }: { panes: HPane[]; style: CSSProperties }) {
  return (
    <div style={style} className="pointer-events-none fixed z-50 max-h-[80vh] w-[22rem] space-y-3 divide-y overflow-hidden rounded-xl border bg-popover p-3 text-popover-foreground shadow-xl [&>*+*]:pt-3">
      {panes.map(p => <AskBody key={p.id} p={p} />)}
    </div>
  );
}

function AskBody({ p }: { p: HPane }) {
  const { data, isPending, isError } = useAsks(p);
  const [main, more] = data?.asks ?? [];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[0.8125rem]">
        <Kind agent={p.agent} /><span className="truncate font-semibold">{paneText(p)}</span>
        {p.status && STATUS[p.status] && (
          <span className="ml-auto flex shrink-0 items-center gap-1 text-[0.6875rem] text-muted-foreground">
            <span className={`size-1.5 rounded-full ${DOT[p.status] ?? 'bg-muted-foreground/40'}`} />{STATUS[p.status]}
          </span>
        )}
      </div>
      {isPending ? <p className="text-xs text-muted-foreground">불러오는 중…</p>
        : isError ? <p className="text-xs text-destructive">대화 기록을 못 읽음</p>
        : !main ? <p className="text-xs text-muted-foreground">최근 대화에 내가 친 말이 없다</p>
        : <>
          <div>
            <div className="mb-1 text-[0.6875rem] font-semibold text-muted-foreground">{who(main)} · {hm(main.t)}</div>
            <p className="line-clamp-4 rounded-lg border border-primary/20 bg-accent px-2.5 py-1.5 text-[0.8125rem] leading-relaxed break-words whitespace-pre-wrap">{main.text}</p>
            {more && <p className="mt-1 truncate text-xs text-muted-foreground">↳ {hm(more.t)} · {more.text}</p>}
          </div>
          <div>
            <div className="mb-1 text-[0.6875rem] font-semibold text-muted-foreground">{data.answer ? `답 첫 줄 · ${hm(data.answer.t)}` : '답'}</div>
            <p className="line-clamp-3 rounded-lg bg-muted/70 px-2.5 py-1.5 text-[0.8125rem] leading-relaxed break-words">
              {data.answer?.text ?? (p.status === 'working' ? '작업 중 — 아직 답이 없다' : '아직 답이 없다')}
            </p>
          </div>
        </>}
    </div>
  );
}

// 상태 목록 한 줄 밑 — 시킨 말만 짧게
export function AskLine({ p, className = '' }: { p: HPane; className?: string }) {
  const a = useAsks(p).data?.asks[0];
  return a ? <span className={`block truncate text-[0.6875rem] text-muted-foreground ${className}`}>↳ {a.text}</span> : null;
}
