// 에이전트 pane 본문 — Claude·Codex 대화(세션 기록), 기록에 아직 없는 지금 화면(진행·질문). useScreen 은 입력칸도 쓴다.
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, type HPane } from './api.ts';
import { Empty, Md } from './ui.tsx';
import { Ansi } from './ansi.tsx';
import { parseMenu } from './screenMenu.ts';
import { Kind } from './herdrUi.tsx';

type Item = { t: number; kind: 'user' | 'peer' | 'text' | 'tool' | 'out'; text: string; from?: string; result?: string; error?: boolean; at?: number };

// 지금 화면 아래쪽(기록에 아직 없는 화면) — 작업 중이면 진행 부분, 입력칸이 안 보이면 질문·메뉴. 대화 칸과 입력칸이 같이 쓴다.
// raw 는 터미널 색 그대로(진행 부분 그리기), lines 는 색을 뺀 글(읽기·찾기).
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
// 상태가 바뀌면(작업 중 → 끝남·승인 대기 등) 바로 다시 읽는다 — 상태는 herdr 이벤트로 곧바로 오는데, 주기 읽기(끝나면 5초)를
// 기다리면 완료 알림 뒤 마지막 답이 늦게 뜬다. 기록 파일이 상태보다 조금 늦게 써질 수 있어 1초 뒤 한 번 더.
function useRefetchOn(status: string | null, refetch: () => unknown) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }   // 처음엔 어차피 읽는다
    void refetch();
    const t = setTimeout(() => void refetch(), 1000);
    return () => clearTimeout(t);
  }, [status]);   // eslint-disable-line react-hooks/exhaustive-deps -- refetch 는 바뀌지 않는다
}

export function useScreen(p: HPane) {
  const agent = p.agent === 'claude' || p.agent === 'codex';
  const q = useQuery({
    queryKey: ['live', p.id], queryFn: () => get<{ lines: string[]; input: boolean }>(`/api/herdr/panes/${p.id}/live`),
    refetchInterval: p.status === 'working' ? 700 : p.status === 'blocked' ? 1000 : 2000, enabled: agent,
  });
  useRefetchOn(p.status, q.refetch);
  const raw = q.data?.lines ?? [], lines = raw.map(l => l.replace(ANSI, '').trimEnd());
  const menu = q.data && !q.data.input ? parseMenu(lines) : null;
  return { raw, lines, input: q.data?.input ?? true, menu };
}

// 대화 — 서버가 끝쪽(최근)만 주고, 맨 위로 올리거나 「이전 대화 더 보기」 를 누르면 그 앞을 이어 받아 위에 붙인다(보던 자리는 그대로).
type ChatPage = { file: string | null; items: Item[]; more: boolean };
export function Chat({ p }: { p: HPane }) {
  const { data, error, refetch } = useQuery({
    queryKey: ['chat', p.id], queryFn: () => get<ChatPage>(`/api/herdr/panes/${p.id}/chat`),
    refetchInterval: p.status === 'working' ? 1500 : 5000,
  });
  useRefetchOn(p.status, refetch);
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
    <div className="ml-auto w-fit max-w-[82%] rounded-2xl rounded-br-md border border-primary/20 bg-accent px-3.5 py-2 text-[0.84375rem] leading-relaxed break-words whitespace-pre-wrap text-foreground shadow-xs">{it.text}</div>
  );
  // 다른 Claude 세션이 SendMessage 로 보낸 말 — 사람 입력(오른쪽)과 헷갈리지 않게 왼쪽에 점선 말풍선과 보낸 세션 이름으로
  if (it.kind === 'peer') return (
    <div className="ml-9 w-fit max-w-[82%] rounded-2xl rounded-tl-md border border-dashed border-primary/40 bg-card px-3.5 py-2 text-[0.84375rem] leading-relaxed break-words whitespace-pre-wrap">
      <div className="mb-0.5 text-[0.6875rem] font-semibold text-primary">{it.from ?? '다른 Claude 세션'} 에게서 받은 메시지</div>{it.text}
    </div>
  );
  if (it.kind === 'text') return <div className="flex gap-3"><Avatar agent={agent} /><div className="min-w-0 flex-1"><div className="w-fit max-w-full rounded-2xl rounded-tl-md bg-muted/70 px-3.5 py-2.5"><Md text={it.text} /></div></div></div>;
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
