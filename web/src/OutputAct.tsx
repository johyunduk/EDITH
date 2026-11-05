// 산출물 단추(공방 엔진 actions.json 의 on: "output" — 서버 src/outputActs.ts) — 보기 창 머리줄 단추를 누르면 펼쳐지는 띠(고르기 · 칸 · 시작)와
// 도는 동안의 진행 줄. 창을 하나 더 띄우지 않고 같은 창 안에 펼친다(2026-11-05 정함)
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from './api.ts';
import { Button } from '@/components/ui/button';
import { toast } from './copy.ts';
import { estimate, groups, sameSet, visible, type Form, type OutJob } from './outputAct.ts';

// 띠 — 명령이 낸 Form 을 그대로: 고르기 칩(여러 개) · 빠른 고르기, 묶음마다 줄(칸 또는 보이기만), 아래 어림 · 설명 · 시작
export function ActBand({ id, i, onStarted, onClose }: { id: number; i: number; onStarted: () => void; onClose: () => void }) {
  const q = useQuery({ queryKey: ['output-form', id, i], queryFn: () => get<Form>(`/api/runs/${id}/outputs/${i}/form`), staleTime: 0, gcTime: 0, retry: false });
  if (q.isLoading) return <Strip><span className="text-xs text-muted-foreground">읽는 중…</span></Strip>;
  if (q.error) return <Strip><span className="flex-1 text-xs text-destructive">{(q.error as Error).message}</span><Button size="xs" variant="outline" onClick={onClose}>접기</Button></Strip>;
  return q.data ? <BandForm id={id} i={i} f={q.data} onStarted={onStarted} onClose={onClose} /> : null;
}

const Strip = ({ children }: { children: React.ReactNode }) => <div className="flex items-center gap-3 border-b bg-accent/40 px-4 py-2.5">{children}</div>;

function BandForm({ id, i, f, onStarted, onClose }: { id: number; i: number; f: Form; onStarted: () => void; onClose: () => void }) {
  const [picked, setPicked] = useState(() => new Set(f.pick?.selected ?? []));
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(f.rows.flatMap(r => r.key ? [[r.key, r.value ?? '']] : [])));
  const [busy, setBusy] = useState(false);
  const rows = visible(f, picked, vals), n = f.pick ? picked.size : 0;
  const flip = (x: string) => setPicked(s => { const t = new Set(s); if (t.has(x)) t.delete(x); else t.add(x); return t; });
  const start = async () => {
    setBusy(true);
    try {
      // 보이는 칸 값만 — 안 고른 시나리오의 칸은 명령에 넘기지 않는다
      const values = Object.fromEntries(rows.flatMap(r => r.key ? [[r.key, vals[r.key] ?? '']] : []));
      await post(`/api/runs/${id}/outputs/${i}/act`, { ids: f.pick ? (f.pick.items.map(x => x.id).filter(x => picked.has(x))) : [], values });
      onStarted();
    } catch (e) { toast(`시작하지 못했다 — ${(e as Error).message}`, 6000); setBusy(false); }
  };
  return (
    <div className="grid gap-2.5 border-b bg-accent/40 px-4 py-3 text-sm">
      {f.pick && (
        <Line label={f.pick.label ?? '고르기'}>
          <span className="flex flex-wrap items-center gap-1.5">
            {f.pick.quick?.map(qk => (
              <Button key={qk.label} size="xs" variant={qk.ids.length && sameSet(qk.ids, picked) ? 'default' : 'outline'} disabled={!qk.ids.length} onClick={() => setPicked(new Set(qk.ids))}>
                {qk.label} <span className="opacity-75">{qk.ids.length ? qk.ids.join(' · ') : '없음'}</span>
              </Button>))}
            {!!f.pick.quick?.length && <span className="mx-1 h-4 w-px bg-border" />}
            {f.pick.items.map(x => (
              <button key={x.id} type="button" title={x.label} aria-pressed={picked.has(x.id)} onClick={() => flip(x.id)}
                className={`h-6 min-w-7 rounded-md border px-1.5 text-xs font-semibold ${picked.has(x.id) ? 'border-primary/40 bg-primary/15 text-primary' : 'bg-background text-muted-foreground hover:bg-accent'}`}>{x.id}</button>))}
          </span>
        </Line>)}
      {groups(rows).map(([g, rs]) => (
        <Line key={g} label={g}>
          <span className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))]">
            {rs.map(r => (
              <span key={r.key ?? r.label} className="grid content-start gap-1">
                {r.label !== g && <span className="text-xs font-semibold">{r.label}{r.sub && <span className="ml-1.5 font-normal text-muted-foreground">{r.sub}</span>}</span>}
                {r.key && r.options
                  ? <span role="radiogroup" aria-label={r.label} className="inline-flex w-fit rounded-md border bg-background p-0.5">
                      {r.options.map(o => (
                        <button key={o.value} type="button" role="radio" aria-checked={vals[r.key!] === o.value} onClick={() => setVals(v => ({ ...v, [r.key!]: o.value }))}
                          className={`h-6 rounded px-2.5 text-xs font-semibold ${vals[r.key!] === o.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}>{o.label}</button>))}
                    </span>
                  : r.key
                  ? <input id={`act-${r.key}`} aria-label={r.label} value={vals[r.key] ?? ''} placeholder={r.placeholder} onChange={e => setVals(v => ({ ...v, [r.key!]: e.target.value }))}
                      className="h-7 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50" />
                  : r.text && <span className={`flex min-h-7 items-center gap-1.5 rounded-md px-2 text-xs ${r.tone === 'warn' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-muted'}`}>
                      {r.tone && <span className={`size-1.5 shrink-0 rounded-full ${r.tone === 'ok' ? 'bg-emerald-500' : 'bg-amber-500'}`} />}{r.text}
                      {r.src && <span className="ml-auto pl-2 text-[11px] text-muted-foreground">{r.src}</span>}</span>}
                {r.hint && <span className={`text-[11px] leading-snug ${r.tone === 'warn' && r.key ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}>{r.hint}</span>}
              </span>))}
          </span>
        </Line>))}
      <div className="flex items-center gap-2 border-t border-dashed pt-2.5">
        <span className="min-w-0 flex-1 text-xs leading-snug text-muted-foreground">{f.pick && <b className="font-semibold text-foreground">{estimate(n, f.each)}</b>}{f.pick && f.note && ' · '}{f.note}</span>
        <Button size="xs" variant="outline" onClick={onClose}>접기</Button>
        <Button size="sm" className="h-7" disabled={busy || (!!f.pick && !n)} onClick={() => void start()}>{busy ? '시작하는 중…' : f.start ?? '시작'}</Button>
      </div>
    </div>
  );
}
const Line = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[5.5rem_1fr] items-start gap-2"><span className="pt-0.5 text-xs font-semibold text-muted-foreground">{label}</span>{children}</div>
);

// 도는 일 — 도는 동안 2초마다 본다. 끝나면 알리고 산출물 글을 다시 읽는다(명령이 문서를 다시 그렸을 수 있다)
export function useJob(id: number, i: number, on: boolean) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['output-job', id, i], queryFn: () => get<{ job: OutJob | null }>(`/api/runs/${id}/outputs/${i}/job`).then(x => x.job),
    enabled: on, refetchInterval: d => d.state.data?.state === 'running' ? 2000 : false });
  const was = useRef(q.data?.state);
  useEffect(() => {
    const now = q.data?.state;
    if (was.current === 'running' && now && now !== 'running') {
      const j = q.data!;
      toast(now === 'done' ? `「${j.label}」 끝` : now === 'stopped' ? `「${j.label}」 멈춤` : `「${j.label}」 실패 — 끝 코드 ${j.code}${j.last ? ` · ${j.last}` : ''}`, now === 'failed' ? 8000 : 3000);
      void qc.invalidateQueries({ queryKey: ['run-output', id, i] });
    }
    was.current = now;
  }, [q.data, id, i, qc]);
  return { job: q.data, refresh: () => q.refetch() };
}

// 진행 줄 — 띠 자리에. 실패로 끝났으면 까닭 한 줄을 남긴다(다음에 띠를 펼치면 사라진다)
export function JobLine({ id, i, job, onStopped }: { id: number; i: number; job: OutJob; onStopped: () => void }) {
  const [busy, setBusy] = useState(false);
  if (job.state !== 'running') return job.state === 'failed' ? <Strip><span className="flex-1 text-xs text-destructive">「{job.label}」 실패 — 끝 코드 {job.code}{job.last ? ` · ${job.last}` : ''}</span></Strip> : null;
  const stop = async () => { setBusy(true); try { await post(`/api/runs/${id}/outputs/${i}/stop`, {}); onStopped(); } catch (e) { toast(`멈추지 못했다 — ${(e as Error).message}`, 5000); } setBusy(false); };
  return (
    <Strip>
      <span className="inline-flex items-center gap-2 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
        {job.progress ?? `「${job.label}」 도는 중`}
        {job.ratio !== undefined && <span className="h-1.5 w-20 overflow-hidden rounded-full bg-primary/20"><span className="block h-full bg-primary" style={{ width: `${Math.round(job.ratio * 100)}%` }} /></span>}
      </span>
      <span className="flex-1 text-xs text-muted-foreground">끝나면 이 문서를 다시 읽는다</span>
      <Button size="xs" variant="outline" disabled={busy} onClick={() => void stop()}>■ 멈추기</Button>
    </Strip>
  );
}
