// 결과 — 런이 작업 문서에 남긴 할 일 묶음(edith-results.json)을 모든 런에 걸쳐 태그(안건)로 모아 본다. 주소는 #/results.
// 화면은 할 일 체크만 바꾼다(서버가 새로 읽어 화면이 본 상태와 같을 때만 — src/results.ts). 다 끝난 태그는 접어 둔다.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from './api.ts';
import { Empty } from './ui.tsx';
import { toast } from './copy.ts';

type Res = {
  tag: string; title: string; note?: string; items: { text: string; done: boolean; group?: string }[];
  run: { id: number; name: string; state: string; created: number };
};

export function ResultsPage() {
  const qc = useQueryClient(), q = useQuery({ queryKey: ['results'], queryFn: () => get<Res[]>('/api/results'), refetchInterval: 10_000 });
  const [busy, setBusy] = useState(false);
  const check = async (x: Res, text: string, was: boolean, group?: string) => {
    setBusy(true);
    try { await post('/api/results/check', { run: x.run.id, title: x.title, text, was, group: group ?? '' }); }
    catch (e) { toast(`바꾸지 못했다 — ${(e as Error).message}`, 5000); }
    await qc.invalidateQueries({ queryKey: ['results'] });
    setBusy(false);
  };
  // 태그별로 — 할 일이 남은 태그가 위, 그 안은 최근 런이 위(목록이 이미 최근 런부터)
  const tags = [...new Set(q.data?.map(x => x.tag) ?? [])].map(tag => {
    const list = q.data!.filter(x => x.tag === tag), items = list.flatMap(x => x.items);
    return { tag, list, done: items.filter(i => i.done).length, total: items.length };
  }).sort((a, b) => Number(a.done === a.total) - Number(b.done === b.total));
  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-3 p-4">
        <div>
          <h1 className="text-lg font-bold">결과</h1>
          <p className="text-xs text-muted-foreground">런이 작업 문서의 <span className="font-mono">edith-results.json</span> 에 남긴 할 일을 태그(안건)로 모은다. 체크는 그 파일에 바로 적는다.</p>
        </div>
        {!q.data ? <Empty>{q.error ? `읽지 못했다 — ${String(q.error)}` : '불러오는 중…'}</Empty>
          : !tags.length ? <Empty>아직 결과를 남긴 런이 없다.</Empty>
          : tags.map(t => (
            <details key={t.tag} open={t.done < t.total} className="overflow-hidden rounded-xl border bg-card">
              <summary className="flex cursor-pointer items-center gap-2.5 px-3.5 py-2.5">
                <span className="font-semibold">{t.tag || '태그 없음'}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{t.done}/{t.total}</span>
                <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-emerald-500" style={{ width: `${t.total ? t.done / t.total * 100 : 100}%` }} /></span>
              </summary>
              <div className="divide-y border-t">
                {t.list.map(x => (
                  <div key={`${x.run.id}:${x.title}`} className="space-y-1.5 px-3.5 py-2.5">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-medium">{x.title}</span>
                      <a href={`#/runs/${x.run.id}`} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">런 #{x.run.id} {x.run.name}</a>
                    </div>
                    {x.note && <p className="text-xs whitespace-pre-wrap text-muted-foreground">{x.note}</p>}
                    {[...new Set(x.items.map(i => i.group ?? ''))].map(g => (
                      <div key={g}>
                        {g && <p className="text-[0.6875rem] font-semibold text-muted-foreground">{g}</p>}
                        <ul className="space-y-0.5">
                          {x.items.filter(i => (i.group ?? '') === g).map(i => (
                            <li key={i.text}>
                              <label className="flex cursor-pointer items-start gap-2 text-sm">
                                <input type="checkbox" className="mt-1 accent-[var(--primary)]" checked={i.done} disabled={busy} onChange={() => void check(x, i.text, i.done, i.group)} />
                                <span className={i.done ? 'text-muted-foreground line-through' : ''}>{i.text}</span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </details>
          ))}
      </div>
    </main>
  );
}
