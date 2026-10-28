// 공방 「흐름 지도」 — 엔진을 단계 칸과 줄로 보고, 줄을 누르면 오른쪽에 그 단계가 하는 일 · Claude 가 받는 지시 · 앞뒤 흐름.
// 칸 · 줄은 서버가 짠다(src/engineMap.ts — 맨 위 엔진 폴더의 map.json, 없으면 맨 위 노드마다 한 칸). 「지시 고치기」 는 공방 Claude 입력칸에 그 파일을 넘긴다.
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from './api.ts';
import { Button } from '@/components/ui/button';
import { Empty, Icon } from './ui.tsx';

type Role = 'claude' | 'check' | 'human' | 'wait';
type File = { path: string; rel?: string };
type Row = {
  id: string; title: string; role: Role; tag?: string; desc?: string; keys: string[]; engine: string;
  skill?: File; command?: string; files: File[]; excerpt?: string; fail?: string; prev: string[]; next: string[]; inner?: number;
};
type Phase = { name: string; groups: { label: string; rows: Row[] }[]; hidden: string[] };
type EngineMapData = { summary?: string; phases: Phase[]; hidden: number; mapped: boolean; errors: string[]; draft: boolean };

// 역할 — 아이콘(선) · 색 · 이름 · 오른쪽 상자 제목
export const ROLE: Record<Role, { icon: ReactNode; tone: string; pill: string; label: string; box: string }> = {
  claude: { icon: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />, tone: 'text-violet-600 dark:text-violet-400', pill: 'bg-violet-500/12 text-violet-700 dark:text-violet-300', label: 'Claude 가 한다', box: 'Claude 가 받는 지시' },
  check: { icon: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>, tone: 'text-sky-700 dark:text-sky-400', pill: 'bg-sky-500/12 text-sky-800 dark:text-sky-300', label: '자동 검사 — Claude 없음', box: '자동으로 돌리는 것' },
  human: { icon: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>, tone: 'text-amber-600 dark:text-amber-400', pill: 'bg-amber-500/15 text-amber-800 dark:text-amber-300', label: '사람이 확인', box: '사람에게 묻는 것' },
  wait: { icon: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>, tone: 'text-muted-foreground', pill: 'bg-muted text-muted-foreground', label: '기다림', box: '기다리는 것' },
};
const LEGEND: [Role, string][] = [['claude', 'Claude 가 한다'], ['check', '자동 검사'], ['human', '사람이 확인'], ['wait', '기다림']];

export function EngineMap({ id, root, claude, onAsk }: { id: string; root: string; claude: string | null; onAsk: (text: string) => void }) {
  const q = useQuery({ queryKey: ['workshop', id, 'map'], queryFn: () => get<EngineMapData>(`/api/workshop/${id}/map`), refetchInterval: 5000 });
  const [sel, setSel] = useState<string | null>(null), [hidden, setHidden] = useState(false), [view, setView] = useState<string | null>(null);
  const all = (q.data?.phases ?? []).flatMap((p, i) => p.groups.flatMap(g => g.rows.map(r => ({ r, p, i, g }))));
  const cur = all.find(x => x.r.id === sel) ?? all.find(x => x.r.role === 'claude') ?? all[0];
  useEffect(() => { setView(null); }, [cur?.r.id]);
  const full = useQuery({ queryKey: ['workshop-file', view], queryFn: () => get<string>(`/api/workshop-file?path=${encodeURIComponent(view!)}`, 'text'), enabled: !!view });
  if (!q.data) return <div className="p-6"><Empty>{q.error ? `읽지 못했다 — ${String(q.error)}` : '불러오는 중…'}</Empty></div>;
  if (q.data.errors.length) return (
    <div className="space-y-2 p-6">
      <p className="text-sm font-semibold">아직 지도를 그릴 수 없다</p>
      <ul className="list-disc pl-5 text-sm text-muted-foreground">{q.data.errors.map(x => <li key={x}>{x}</li>)}</ul>
    </div>
  );
  const d = q.data, r = cur?.r, title = (k: string) => all.find(x => x.r.id === k)?.r.title ?? k;
  const shared = !!r && r.files.length > 0 && r.files.some(f => f.path !== r.skill?.path);   // map 의 지시 파일 — 다른 단계도 같이 쓸 수 있다
  const last = r?.files.at(-1);
  const edit = () => r && onAsk(`「${r.title}」 단계의 지시를 고쳐 줘 — 파일: ${r.files.map(f => f.rel ? `${root}/${f.rel}` : f.path).join(', ')}\n바꿀 것: `);
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="space-y-2 border-b bg-card px-4 py-2.5">
        {d.summary && <p className="text-sm text-muted-foreground">{d.summary}</p>}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          {LEGEND.map(([k, label]) => <span key={k} className="flex items-center gap-1.5"><Icon className={`size-4 ${ROLE[k].tone}`}>{ROLE[k].icon}</Icon>{label}</span>)}
          {!d.mapped && <span title="맨 위 엔진 폴더에 map.json 을 두면 칸 · 줄 이름 · 역할 · 설명 · 지시 파일을 정할 수 있다">map.json 없음 — 맨 위 노드마다 한 칸</span>}
          {d.draft && <span className="text-violet-700 dark:text-violet-300">초안 기준</span>}
          {d.hidden > 0 && (
            <Button size="sm" variant={hidden ? 'secondary' : 'outline'} className="ml-auto h-7 rounded-full text-xs" aria-pressed={hidden} onClick={() => setHidden(!hidden)}>
              {hidden ? `숨긴 노드 ${d.hidden} 접기` : `숨긴 노드 ${d.hidden} 보기`}
            </Button>
          )}
        </div>
      </div>
      {/* 넓으면 칸들(가로로 밀어 본다) 옆에 고른 줄 패널, 좁으면 아래로 */}
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 overflow-x-auto pb-1">
          <div className="flex items-stretch gap-3">
            {d.phases.map((p, i) => (
              <section key={`${i}:${p.name}`} className="flex min-w-[12.25rem] flex-1 flex-col gap-1.5 rounded-xl border bg-card px-2.5 py-3">
                <div className="flex items-center gap-2 px-1.5 pb-1.5">
                  <span className="flex size-[1.375rem] shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">{i + 1}</span>
                  <h2 className="min-w-0 truncate text-[0.9375rem] font-bold" title={p.name}>{p.name}</h2>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{p.groups.reduce((a, g) => a + g.rows.length, 0)}단계</span>
                </div>
                {p.groups.map(g => (
                  <div key={g.label} className="flex flex-col gap-0.5">
                    {g.label && <span className="px-2 pt-2 pb-1 text-xs font-semibold text-primary">{g.label}</span>}
                    {g.rows.map(x => (
                      <button key={x.id} type="button" onClick={() => setSel(x.id)} aria-pressed={r?.id === x.id} aria-label={`${x.title} — ${ROLE[x.role].label}`}
                        className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${r?.id === x.id ? 'bg-accent font-semibold ring-2 ring-primary/60' : 'hover:bg-muted'}`}>
                        <Icon className={`size-4 ${ROLE[x.role].tone}`}>{ROLE[x.role].icon}</Icon>
                        <span className="min-w-0 flex-1">{x.title}</span>
                        {x.tag && <span className="shrink-0 rounded-md bg-muted px-1.5 py-px text-[0.6875rem] font-normal whitespace-nowrap text-muted-foreground">{x.tag}</span>}
                      </button>
                    ))}
                  </div>
                ))}
                {hidden && p.hidden.length > 0 && <p className="mx-1.5 mt-1.5 border-t border-dashed pt-2.5 text-xs leading-relaxed text-muted-foreground">숨긴 노드 — {p.hidden.join(' · ')}</p>}
              </section>
            ))}
          </div>
        </div>

        {r && cur && (
          <aside className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-5 lg:sticky lg:top-4 lg:w-[21rem] lg:shrink-0">
            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted-foreground">{cur.p.name}{cur.g.label ? ` · ${cur.g.label}` : ''}</span>
              <h2 className="text-xl font-bold">{r.title}</h2>
              <span className={`self-start rounded-full px-2.5 py-0.5 text-xs font-semibold ${ROLE[r.role].pill}`}>{ROLE[r.role].label}</span>
              {r.desc && <p className="text-sm leading-relaxed">{r.desc}</p>}
            </div>

            <div className="flex flex-col gap-2.5 rounded-lg border p-3.5">
              <span className="text-sm font-bold">{ROLE[r.role].box}</span>
              {r.excerpt ? <pre className="code-panel max-h-60 whitespace-pre-wrap">{r.excerpt}</pre> : <p className="text-xs text-muted-foreground">{r.inner ? `안쪽 노드 ${r.inner}개를 한 줄로 접었다 — 「숨긴 노드 보기」 · 캔버스로 본다` : '적힌 지시가 없다'}</p>}
              {r.files.length > 0 && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" className="h-8" disabled={!claude} onClick={edit}
                      title={claude ? '오른쪽 공방 Claude 입력칸에 이 지시 파일을 넘긴다 — 바꿀 것을 이어 쓰고 보낸다' : '오른쪽에서 공방 Claude 를 먼저 띄운다'}>지시 고치기</Button>
                    {last?.rel && <Button size="sm" variant="outline" className="h-8" aria-pressed={view === last.rel} onClick={() => setView(view === last.rel ? null : last.rel!)}>{view === last.rel ? '전체 접기' : '전체 보기'}</Button>}
                  </div>
                  <span className="text-xs text-muted-foreground">고치면 다음 런부터 적용된다(도는 런은 시작할 때의 사본으로 돈다).{shared ? ' 이 지시 파일을 쓰는 다른 단계에도 같이 적용된다.' : ''}</span>
                </>
              )}
              {view && (
                <div className="space-y-1">
                  <p className="font-mono text-[0.6875rem] text-muted-foreground">{view}</p>
                  <pre className="code-panel max-h-[60vh] whitespace-pre-wrap">{full.data ?? (full.error ? `읽지 못했다 — ${String(full.error)}` : '불러오는 중…')}</pre>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2.5">
              <span className="text-sm font-bold">흐름</span>
              <div className="flex flex-wrap items-center gap-2">
                {r.prev.map(k => <button key={k} type="button" onClick={() => setSel(k)} className="rounded-full border bg-card px-3 py-1 text-xs hover:bg-muted">← {title(k)}</button>)}
                <span className="text-xs font-bold text-primary">이 단계</span>
                {r.next.map(k => <button key={k} type="button" onClick={() => setSel(k)} className="rounded-full border bg-card px-3 py-1 text-xs hover:bg-muted">{title(k)} →</button>)}
              </div>
              <span className="text-sm leading-relaxed text-muted-foreground">{r.fail ? `실패하면 → 「${r.fail}」 가 고친 뒤 이 단계를 다시 돌린다` : '실패 화살표 없음 — 실패하면 확인 필요로 멈춘다'}</span>
            </div>

            <details className="border-t pt-3.5">
              <summary className="cursor-pointer text-sm font-semibold text-primary">어떻게 연결돼 있나(고급)</summary>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs leading-relaxed text-muted-foreground">
                <li>노드 — <span className="font-mono">{r.engine}</span> 폴더의 「{r.title}」 · 키 <span className="font-mono">{r.keys[0]}</span>{r.inner ? ` 외 안쪽 ${r.inner - 1}개` : ''}</li>
                {r.command && <li>명령 — <span className="font-mono break-all">{r.command}</span></li>}
                {r.skill && <li>스킬 — <FileLink f={r.skill} view={view} setView={setView} /></li>}
                {shared && r.files.map(f => <li key={f.path}>지시 — <FileLink f={f} view={view} setView={setView} /></li>)}
              </ol>
            </details>
          </aside>
        )}
      </div>
    </div>
  );
}

// 파일 경로 — 공방 폴더 안이면 눌러 위 상자에 전체를 연다
function FileLink({ f, view, setView }: { f: File; view: string | null; setView: (v: string | null) => void }) {
  return f.rel
    ? <button type="button" onClick={() => setView(view === f.rel ? null : f.rel!)} className="font-mono break-all text-primary underline-offset-2 hover:underline">{f.path}</button>
    : <span className="font-mono break-all">{f.path}</span>;
}
