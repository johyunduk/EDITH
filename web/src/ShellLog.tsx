// 셸 pane 본문 — 명령별 기록(명령 줄 + 출력). 프롬프트에서 쉬면 Claude·Codex 띄우기 버튼.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, post, type HPane } from './api.ts';
import { Button } from '@/components/ui/button';
import { Empty } from './ui.tsx';
import { Ansi } from './ansi.tsx';
import { Kind, atPrompt } from './herdrUi.tsx';

type SBlock = { cmd: string; where: string; out: string[] };

export function ShellLog({ p }: { p: HPane }) {
  const running = !atPrompt(p.title);
  const [busy, setBusy] = useState(''), [err, setErr] = useState('');
  const launch = async (kind: string) => {
    setBusy(kind); setErr('');
    await post(`/api/herdr/panes/${p.id}/start`, { kind }).catch(e => setErr(String(e)));
    setBusy('');
  };
  const { data, error } = useQuery({
    queryKey: ['history', p.id], queryFn: () => get<{ mark: string | null; blocks: SBlock[] }>(`/api/herdr/panes/${p.id}/history`),
    refetchInterval: running ? 1000 : 4000,
  });
  const box = useRef<HTMLDivElement>(null), stick = useRef(true);
  useEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [data]);
  if (error && !data) return <Empty>{String(error)}</Empty>;   // 한 번 실패해도(서버 재시작 등) 받아 둔 내용은 그대로
  const blocks = data?.blocks ?? [], last = blocks.at(-1);
  const idle = !!last && !last.cmd && !last.out.length;   // 마지막이 빈 프롬프트 = 기다리는 중
  return (
    <div ref={box} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
      className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-xl border bg-card p-3">
      {!data ? <Empty>불러오는 중…</Empty> : !data.mark && (blocks.length ? <Empty>프롬프트를 못 알아봤다 — 「원래 화면」 으로 본다</Empty> : <Empty>아직 출력이 없다</Empty>)}
      {(idle ? blocks.slice(0, -1) : blocks).map((b, i, all) => (
        <div key={i} className="overflow-hidden rounded-lg border shadow-xs">
          <div className="flex items-center gap-2 border-b bg-muted/60 px-3 py-1.5 font-mono text-xs">
            <span className="font-bold text-primary">❯</span>
            {b.where && <span className="rounded bg-accent px-1.5 py-0.5 text-[0.6875rem] text-accent-foreground">{b.where}</span>}
            <span className="truncate font-semibold">{b.cmd || '(출력)'}</span>
            {running && i === all.length - 1 && <span className="ml-auto flex shrink-0 items-center gap-1.5 text-primary"><span className="size-1.5 animate-pulse rounded-full bg-primary" />실행 중</span>}
          </div>
          {b.out.length > 0 && <Out lines={b.out} />}
        </div>
      ))}
      {(idle || (data && !blocks.length)) && !running && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-mono font-bold text-primary">❯</span> 대기 중{last?.where && ` · ${last.where}`} — 아래 칸에 명령, 또는
          {(['claude', 'codex'] as const).map(k => (
            <Button key={k} size="sm" variant="outline" className="h-6 gap-1 rounded-full px-2.5 text-xs" disabled={!!busy} onClick={() => void launch(k)}>
              <Kind agent={k} />{busy === k ? '띄우는 중' : k === 'claude' ? 'Claude' : 'Codex'}
            </Button>
          ))}
          {err && <span className="text-destructive">{err}</span>}
        </div>
      )}
    </div>
  );
}

// 긴 출력은 끝 40줄만, 누르면 전부. 터미널 색 그대로 어두운 판에.
function Out({ lines }: { lines: string[] }) {
  const [all, setAll] = useState(false);
  const hidden = all ? 0 : Math.max(0, lines.length - 40);
  return (
    <div className="bg-code">
      {hidden > 0 && <button onClick={() => setAll(true)} className="w-full border-b border-white/10 py-1 text-xs text-code-foreground/60 hover:text-code-foreground">앞 {hidden}줄 더 보기</button>}
      <Ansi text={lines.slice(hidden).join('\n')} className="rounded-none" />
    </div>
  );
}
