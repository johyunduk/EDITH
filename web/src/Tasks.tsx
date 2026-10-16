// 백그라운드 작업 — Claude pane 이 run_in_background 로 띄운 셸·에이전트 중 지금 살아 있는 것만(서버 chat.ts backgroundTasks).
// 살아 있는 게 있을 때만 pane 머리에 버튼이 생기고, 누르면 목록, 작업을 누르면 그 출력 끝(터미널 색 그대로, 2초마다 다시 읽음).
// 끝난 것은 세션 기록에 남아 있어도 보이지 않는다. 「끄기」는 바로 죽이지 않고 그 Claude 에게 묻는다(AskStop).
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, post, type HPane } from './api.ts';
import { Ansi } from './ansi.tsx';
import { Icon } from './ui.tsx';

type Task = { id: string; kind: '셸' | '에이전트'; label: string; command: string; path: string; status: string; t: number; outAt: number; outSize: number };
const TERMINAL = <><path d="m7 11 2-2-2-2" /><path d="M11 13h4" /><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /></>;
const ago = (t: number) => { const s = (Date.now() - t) / 1000; return s < 60 ? '방금' : s < 3600 ? `${Math.floor(s / 60)}분 전` : s < 86400 ? `${Math.floor(s / 3600)}시간 전` : `${Math.floor(s / 86400)}일 전`; };
const TONE: Record<string, string> = { '실행 중': 'bg-sky-500/15 text-sky-700 dark:text-sky-300', '끝남': 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', '실패': 'bg-rose-500/15 text-rose-700 dark:text-rose-300', '멈춤': 'bg-muted text-muted-foreground' };
const tone = (st: string) => TONE[st.split('(')[0]] ?? TONE['멈춤'];   // 「멈춤(코드 144)」 같은 것도 앞말로

export function BgTasks({ p }: { p: HPane }) {
  const [open, setOpen] = useState(false), [pick, setPick] = useState<string | null>(null), box = useRef<HTMLDivElement>(null);
  const { data = [] } = useQuery({
    queryKey: ['tasks', p.id], enabled: p.agent === 'claude', refetchInterval: open || p.status === 'working' ? 4000 : 15000,
    queryFn: () => get<Task[]>(`/api/herdr/panes/${p.id}/tasks`),
  });
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!(e.target instanceof Node && box.current?.contains(e.target))) setOpen(false); };
    addEventListener('mousedown', close);
    return () => removeEventListener('mousedown', close);
  }, [open]);
  const alive = data.filter(t => t.status === '실행 중');   // 서버가 끝남 알림·출력 끝 표시·lsof(파일을 연 프로세스)로 가린 산 것
  if (!alive.length) return null;
  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(v => !v)} title="이 Claude 가 백그라운드로 띄운 셸·에이전트"
        className={`flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-semibold transition hover:bg-muted ${open ? 'bg-muted' : 'bg-card'}`}>
        <Icon className="size-3.5">{TERMINAL}</Icon>백그라운드
        <span className="flex items-center gap-1 rounded-full bg-sky-500 px-1.5 text-[0.65625rem] leading-4 text-white tabular-nums"><span className="size-1.5 animate-pulse rounded-full bg-white" />{alive.length}</span>
      </button>
      {open && (
        <div className="absolute top-full right-0 z-30 mt-1 max-h-[70vh] w-[40rem] max-w-[90vw] overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl">
          <div className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">이 세션이 백그라운드로 띄워 지금 돌고 있는 것 · 누르면 출력 끝</div>
          {alive.map(t => (
            <div key={t.id} className="rounded-lg">
              <div className="flex items-start gap-1">
              <button onClick={() => setPick(x => x === t.id ? null : t.id)} className={`flex min-w-0 flex-1 items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted ${pick === t.id ? 'bg-muted' : ''}`}>
                <span className="mt-0.5 shrink-0 rounded bg-muted px-1 text-[0.625rem] leading-4 text-muted-foreground">{t.kind}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.8125rem] font-medium">{t.label}</span>
                  {t.command && <span className="block truncate font-mono text-[0.6875rem] text-muted-foreground">{t.command}</span>}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className={`flex items-center gap-1 rounded-full px-1.5 text-[0.65625rem] leading-4 font-semibold ${tone(t.status)}`}>
                    {t.status === '실행 중' && <span className="size-1.5 animate-pulse rounded-full bg-sky-500" />}{t.status}
                  </span>
                  <span className="text-[0.625rem] text-muted-foreground/70">{t.outAt ? `출력 ${ago(t.outAt)}` : '출력 없음'}</span>
                </span>
              </button>
              <AskStop p={p} t={t} />
              </div>
              {pick === t.id && <TaskOut p={p} t={t} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 끄기 — 그 Claude 에게 프롬프트로 묻는다. 아직 필요하면 이유를 말하고, 아니면 TaskStop 으로 끈다. 일하는 중이면 다음 차례에 읽는다.
function AskStop({ p, t }: { p: HPane; t: Task }) {
  const [st, setSt] = useState<'' | '묻는 중' | '물어봄'>(''), [err, setErr] = useState('');
  const ask = () => {
    setSt('묻는 중'); setErr('');
    const label = t.label.replace(/\s+/g, ' ').slice(0, 80);
    post(`/api/herdr/panes/${p.id}/prompt`, { text: `EDITH 에서 백그라운드 ${t.kind} 작업을 끄자는 요청이 왔다: ${t.id} «${label}». 지금 하는 일에 아직 필요하면 끄지 말고 이유를 한 줄로 알려 줘. 필요 없으면 TaskStop 으로 끄고 끈 것을 한 줄로 알려 줘.` })
      .then(() => setSt('물어봄'), e => { setSt(''); setErr(String(e)); });
  };
  return (
    <button onClick={ask} disabled={!!st} title={err || '이 Claude 에게 꺼도 되는지 묻고, 괜찮으면 끄게 한다'}
      className={`mt-1 shrink-0 rounded-md border bg-card px-2 py-1 text-[0.6875rem] font-semibold transition enabled:hover:border-rose-500/50 enabled:hover:text-rose-600 disabled:opacity-60 ${err ? 'border-rose-500/50 text-rose-600' : ''}`}>
      {st || (err ? '다시 끄기' : '끄기')}
    </button>
  );
}

function TaskOut({ p, t }: { p: HPane; t: Task }) {
  const live = t.status === '실행 중', pre = useRef<HTMLDivElement>(null);
  const { data, error } = useQuery({
    queryKey: ['task-out', p.id, t.id], refetchInterval: live ? 2000 : false,
    queryFn: () => get<string>(`/api/herdr/panes/${p.id}/tasks?task=${encodeURIComponent(t.id)}`, 'text'),
  });
  useEffect(() => { const el = pre.current; if (el) el.scrollTop = el.scrollHeight; }, [data]);
  return (
    <div ref={pre} className="code-panel mx-2 mt-1 mb-2 max-h-80 overflow-y-auto whitespace-pre-wrap">
      {error && data === undefined ? String(error) : data === undefined ? '불러오는 중…' : data ? <Ansi text={data} /> : `출력이 없다${t.outSize === 0 && !t.outAt ? '(파일이 지워졌거나 아직 안 씀)' : ''}`}
    </div>
  );
}
