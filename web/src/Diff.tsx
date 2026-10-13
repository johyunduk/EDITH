// 코드 변경 보기 — git diff 글을 파일 목록 + 파일 카드(한 줄·나란히, 문법 색, 줄 안 바뀐 곳 강조)로 그린다. 패키지 없이(highlight.js 만).
// ponytail: 문법 색은 줄 단위라 여러 줄 주석·문자열은 덩어리 경계에서 색이 틀릴 수 있다. 줄 안 강조는 같은 앞뒤를 뺀 가운데 한 토막이라
//           한 줄에서 두 군데가 떨어져 바뀌면 그 사이까지 칠한다. 부족해지면 이 파일 안을 @git-diff-view/react 로 바꾼다(밖에서 쓰는 건 DiffView·PaneDiff).
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import hljs from 'highlight.js/lib/common';
import { get, post, type HPane } from './api.ts';
import { Icon } from './ui.tsx';
import { pairs, parseDiff, type DFile, type Line } from './diffParse.ts';

// 문법 색 — 확장자로 highlight.js 언어를 고른다(모르는 건 글자 그대로)
const LANG: Record<string, string> = { vue: 'xml', html: 'xml', svg: 'xml', tsx: 'typescript', mts: 'typescript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', yml: 'yaml', md: 'markdown', sh: 'bash', zsh: 'bash' };
const langOf = (name: string) => { const ext = name.split('.').pop()!.toLowerCase(), l = LANG[ext] ?? ext; return name.includes('.') && hljs.getLanguage(l) ? l : null; };
const esc = (s: string) => s.replace(/[&<>]/g, c => c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;');
const hl = (s: string, lang: string | null) => !s ? '' : lang ? hljs.highlight(s, { language: lang, ignoreIllegals: true }).value : esc(s);
function code(l: Line, lang: string | null) {
  if (!l.mark) return hl(l.text, lang) || ' ';
  const [a, b] = l.mark, tone = l.t === '+' ? 'bg-[#abf2bc] dark:bg-[#2ea043]/40' : 'bg-[#ffcecb] dark:bg-[#f85149]/40';
  return `${hl(l.text.slice(0, a), lang)}<mark class="rounded-sm ${tone} text-inherit">${hl(l.text.slice(a, b), lang)}</mark>${hl(l.text.slice(b), lang)}`;
}

// 색은 GitHub diff 와 같은 계열 — 밝은 화면은 밝은 판에 옅은 초록·빨강, 어두운 화면은 어두운 판에 낮춘 초록·빨강
const ROW: Record<string, string> = { '+': 'bg-[#e6ffec] dark:bg-[#2ea043]/15', '-': 'bg-[#ffebe9] dark:bg-[#f85149]/15', ' ': '' };
const NUM: Record<string, string> = {
  '+': 'bg-[#ccffd8] text-foreground/45 dark:bg-[#3fb950]/25 dark:text-code-foreground/45', '-': 'bg-[#ffd7d5] text-foreground/45 dark:bg-[#f85149]/25 dark:text-code-foreground/45',
  ' ': 'text-muted-foreground/60 dark:text-code-foreground/35',
};
const STATUS: Record<DFile['status'], [string, string]> = {
  A: ['추가', 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'], D: ['삭제', 'bg-rose-500/15 text-rose-700 dark:text-rose-300'],
  R: ['이름', 'bg-violet-500/15 text-violet-700 dark:text-violet-300'], M: ['수정', 'bg-sky-500/15 text-sky-700 dark:text-sky-300'],
};
const num = 'w-11 select-none px-2 text-right align-top tabular-nums';
const cell = 'px-2 align-top whitespace-pre-wrap [overflow-wrap:anywhere]';

const FileBody = memo(function FileBody({ f, split }: { f: DFile; split: boolean }) {
  const lang = langOf(f.name);
  if (f.binary) return <p className="px-3 py-2 text-xs text-muted-foreground">바이너리 파일</p>;
  if (!f.hunks.length) return <p className="px-3 py-2 text-xs text-muted-foreground">내용 변경 없음(이름·권한만)</p>;
  const side = (l: Line | null, which: 'o' | 'n') => l
    ? <><td className={`${num} ${NUM[l.t]}`}>{l[which]}</td><td className={`${cell} ${ROW[l.t]}`} dangerouslySetInnerHTML={{ __html: code(l, lang) }} /></>
    : <><td className={`${num} bg-muted/50 dark:bg-white/[0.03]`} /><td className="bg-muted/50 dark:bg-white/[0.03]" /></>;
  return (
    <table className="w-full table-fixed border-collapse font-mono text-[0.75rem] leading-5">
      <colgroup>{split ? <><col className="w-11" /><col /><col className="w-11" /><col /></> : <><col className="w-11" /><col className="w-11" /><col className="w-5" /><col /></>}</colgroup>
      <tbody>
        {f.hunks.map((h, i) => [
          <tr key={`h${i}`}><td colSpan={4} className="bg-[#ddf4ff] px-3 py-0.5 text-[0.6875rem] text-[#57606a] dark:bg-[#388bfd]/10 dark:text-code-foreground/55">⋯ {h.o}행 부근{h.head && ` · ${h.head}`}</td></tr>,
          ...(split
            ? pairs(h.lines).map(([a, b], j) => <tr key={`${i}-${j}`}>{side(a, 'o')}{side(b, 'n')}</tr>)
            : h.lines.map((l, j) => (
              <tr key={`${i}-${j}`} className={ROW[l.t]}>
                <td className={`${num} ${NUM[l.t]}`}>{l.o}</td><td className={`${num} ${NUM[l.t]}`}>{l.n}</td>
                <td className={`select-none text-center ${l.t === '+' ? 'text-[#1a7f37] dark:text-[#3fb950]' : 'text-[#cf222e] dark:text-[#f85149]'}`}>{l.t === ' ' ? '' : l.t}</td>
                <td className={cell} dangerouslySetInnerHTML={{ __html: code(l, lang) }} />
              </tr>
            ))),
        ])}
      </tbody>
    </table>
  );
});

// 처음에 접어 두는 파일 — lock·압축본·빌드 산출물, 바뀐 줄이 아주 많은 것
const BIG = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Cargo\.lock)$|\.min\.(js|css)$|(^|\/)(dist|build)\//;
const big = (f: DFile) => BIG.test(f.name) || f.add + f.del > 1500;

// 「봤음」 — 파일 diff 가 그대로인 동안만. 이 브라우저에만 기억한다(저장이 막혀도 동작).
function useViewed(scope: string) {
  const read = () => { try { return JSON.parse(localStorage.getItem('edith.viewed') ?? '{}') as Record<string, Record<string, string>>; } catch { return {}; } };
  const [all, setAll] = useState(read);
  const mine = all[scope] ?? {};
  const set = (f: DFile, on: boolean) => {
    const next = { ...read(), [scope]: { ...mine, [f.name]: on ? f.key : '' } };
    try { localStorage.setItem('edith.viewed', JSON.stringify(next)); } catch { /* 저장 안 됨 */ }
    setAll(next);
  };
  return [(f: DFile) => mine[f.name] === f.key, set] as const;
}

const pref = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };

const SPARK = <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />;   // lucide sparkles

// AI 요약 — summarize(true) 는 서버가 기억해 둔 요약만(돈 안 듦, diff 가 바뀔 때마다), summarize(false) 는 없는 것을 Claude(haiku)에 묻는다(버튼).
// 요약은 파일 diff 에 묶여서 그 파일이 또 바뀌면 다시 「AI 요약」 대상이 된다.
type Summarize = (cached: boolean) => Promise<Record<string, string>>;
function useSummaries(files: DFile[], text: string, summarize?: Summarize) {
  const [sums, setSums] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const take = (r: Record<string, string>) => setSums(s => ({ ...s, ...Object.fromEntries(files.filter(f => r[f.name]).map(f => [f.key, r[f.name]])) }));
  useEffect(() => { if (summarize && files.length) summarize(true).then(take, () => undefined); }, [text]);   // eslint-disable-line react-hooks/exhaustive-deps
  const ask = () => { setBusy(true); setErr(''); summarize!(false).then(take, (e: Error) => setErr(e.message)).finally(() => setBusy(false)); };
  return { sums, busy, err, ask, missing: files.filter(f => !sums[f.key]).length };
}

export function DiffView({ text, scope, empty = '변경 없음', summarize }: { text: string; scope: string; empty?: string; summarize?: Summarize }) {
  const files = useMemo(() => parseDiff(text), [text]);
  const [split, setSplit] = useState(() => pref('edith.diff.split', '0') === '1');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [viewed, setViewed] = useViewed(scope);
  const ai = useSummaries(files, text, summarize);
  const box = useRef<HTMLDivElement>(null);
  const isOpen = (f: DFile) => open[f.name] ?? (!viewed(f) && !big(f));
  const add = files.reduce((s, f) => s + f.add, 0), del = files.reduce((s, f) => s + f.del, 0);
  const groups = useMemo(() => {
    const m = new Map<string, number[]>();
    files.forEach((f, i) => { const d = f.name.includes('/') ? f.name.slice(0, f.name.lastIndexOf('/') + 1) : ''; m.set(d, [...(m.get(d) ?? []), i]); });
    return [...m];
  }, [files]);
  if (!files.length) return <p className="py-10 text-center text-sm text-muted-foreground">{empty}</p>;
  const jump = (i: number) => { setOpen(o => ({ ...o, [files[i].name]: true })); requestAnimationFrame(() => box.current?.querySelector(`#df-${i}`)?.scrollIntoView({ block: 'start' })); };
  const toggleSplit = () => setSplit(v => { try { localStorage.setItem('edith.diff.split', v ? '0' : '1'); } catch { /* 저장 안 됨 */ } return !v; });
  const seen = files.filter(viewed).length;
  return (
    <div className="flex h-full min-h-0 gap-3">
      <nav className="hidden w-64 shrink-0 flex-col overflow-y-auto rounded-lg border bg-card p-1.5 text-xs md:flex">
        <div className="px-1.5 pt-0.5 pb-1.5 text-muted-foreground">
          파일 {files.length} · <span className="text-emerald-600 dark:text-emerald-400">+{add}</span> <span className="text-rose-600 dark:text-rose-400">−{del}</span>
          {seen > 0 && <span> · 봤음 {seen}/{files.length}</span>}
        </div>
        {groups.map(([dir, idx]) => (
          <div key={dir} className="pb-1">
            {dir && <div className="truncate px-1.5 pt-1 pb-0.5 font-mono text-[0.65625rem] text-muted-foreground/70" title={dir}>{dir}</div>}
            {idx.map(i => {
              const f = files[i];
              return (
                <button key={f.name} onClick={() => jump(i)} title={ai.sums[f.key] ? `${f.name}\n${ai.sums[f.key]}` : f.name}
                  className={`flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-muted ${viewed(f) ? 'opacity-50' : ''}`}>
                  <span className={`size-1.5 shrink-0 rounded-full ${f.status === 'A' ? 'bg-emerald-500' : f.status === 'D' ? 'bg-rose-500' : f.status === 'R' ? 'bg-violet-500' : 'bg-sky-500'}`} />
                  <span className="truncate font-mono">{f.name.slice(dir.length)}</span>
                  <span className="ml-auto shrink-0 tabular-nums"><span className="text-emerald-600 dark:text-emerald-400">+{f.add}</span> <span className="text-rose-600 dark:text-rose-400">−{f.del}</span></span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div ref={box} className="min-w-0 flex-1 space-y-3 overflow-y-auto">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="md:hidden">파일 {files.length} · +{add} −{del}</span>
          {summarize && (ai.missing > 0 || ai.busy) && (
            <button onClick={ai.ask} disabled={ai.busy} title="파일마다 무엇을 왜 바꿨는지 Claude(haiku)에 한두 줄로 묻는다"
              className="flex items-center gap-1.5 rounded-md bg-violet-500/10 px-2.5 py-1 font-semibold text-violet-700 hover:bg-violet-500/20 disabled:opacity-70 dark:text-violet-300">
              <Icon className={`size-3.5 ${ai.busy ? 'animate-pulse' : ''}`}>{SPARK}</Icon>{ai.busy ? '요약 중…' : `AI 요약 · 파일 ${ai.missing}`}
            </button>
          )}
          {ai.err && <span className="truncate text-destructive">{ai.err}</span>}
          <div className="ml-auto flex gap-0.5 rounded-lg bg-muted p-0.5">
            {[['한 줄', false], ['나란히', true]].map(([label, v]) => (
              <button key={String(label)} onClick={() => split !== v && toggleSplit()}
                className={`rounded-md px-2.5 py-1 ${split === v ? 'bg-card font-semibold text-foreground shadow-sm' : 'hover:text-foreground'}`}>{label}</button>
            ))}
          </div>
          <button onClick={() => setOpen(Object.fromEntries(files.map(f => [f.name, !files.every(isOpen)])))} className="rounded-md px-2 py-1 hover:bg-muted hover:text-foreground">
            {files.every(isOpen) ? '모두 접기' : '모두 펼치기'}
          </button>
        </div>
        {files.map((f, i) => {
          const on = isOpen(f), [label, tone] = STATUS[f.status], slash = f.name.lastIndexOf('/');
          return (
            <section key={f.name} id={`df-${i}`} className="rounded-lg border bg-card">
              <header className={`sticky top-0 z-10 flex items-center gap-2 bg-card/95 px-3 py-2 backdrop-blur ${on || ai.sums[f.key] ? 'rounded-t-lg border-b' : 'rounded-lg'}`}>
                <button onClick={() => setOpen(o => ({ ...o, [f.name]: !on }))} className="flex min-w-0 items-center gap-2 text-left">
                  <svg viewBox="0 0 16 16" className={`size-3 shrink-0 text-muted-foreground transition-transform ${on ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 4 4 4-4 4" /></svg>
                  <span className={`shrink-0 rounded px-1.5 text-[0.65625rem] leading-4 font-semibold ${tone}`}>{label}</span>
                  <span className="truncate font-mono text-[0.78125rem]"><span className="text-muted-foreground">{f.name.slice(0, slash + 1)}</span><span className="font-semibold">{f.name.slice(slash + 1)}</span></span>
                  {f.status === 'R' && <span className="truncate font-mono text-[0.6875rem] text-muted-foreground">← {f.old}</span>}
                </button>
                <span className="shrink-0 font-mono text-xs tabular-nums"><span className="text-emerald-600 dark:text-emerald-400">+{f.add}</span> <span className="text-rose-600 dark:text-rose-400">−{f.del}</span></span>
                <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
                  <input type="checkbox" checked={viewed(f)} className="accent-primary"
                    onChange={e => { setViewed(f, e.target.checked); setOpen(o => ({ ...o, [f.name]: !e.target.checked })); }} />봤음
                </label>
              </header>
              {ai.sums[f.key] && (
                <p className={`flex gap-1.5 px-3 py-2 text-[0.78125rem] leading-relaxed text-foreground/80 ${on ? 'border-b' : ''}`}>
                  <Icon className="mt-0.5 size-3.5 text-violet-500">{SPARK}</Icon>{ai.sums[f.key]}
                </p>
              )}
              {on && <div className="diff-code overflow-hidden rounded-b-lg bg-card text-foreground dark:bg-code dark:text-code-foreground"><FileBody f={f} split={split} /></div>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

// pane 의 「변경」 — 그 pane 폴더 워크트리를 세 기준으로. 작업 중이면 5초마다 다시 읽는다.
type Commit = { sha: string; short: string; subject: string; when: string };
type Resp = { root: string; mode: string; bases: string[]; base: string | null; commits: Commit[]; commit: string | null; cut: boolean; text: string };
const MODES = [['work', '커밋 안 한 것'], ['branch', '브랜치 전체'], ['commit', '커밋별']] as const;

export function PaneDiff({ p }: { p: HPane }) {
  const [mode, setMode] = useState<string>('work'), [base, setBase] = useState(''), [commit, setCommit] = useState('');
  const q = useQuery({
    queryKey: ['diff', p.id, mode, base, commit], placeholderData: keepPreviousData, retry: false,
    queryFn: () => get<Resp>(`/api/herdr/panes/${p.id}/diff?${new URLSearchParams({ mode, base, commit })}`),
    refetchInterval: p.status === 'working' ? 5000 : false,
  });
  const d = q.data, sel = 'h-7 rounded-md border bg-card px-2 text-xs outline-none focus:ring-2 focus:ring-ring/50';
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
          {MODES.map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)}
              className={`rounded-md px-2.5 py-1 text-xs ${mode === m ? 'bg-card font-semibold text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>
          ))}
        </div>
        {mode !== 'work' && !!d?.bases.length && (
          <select value={d.base ?? ''} onChange={e => { setBase(e.target.value); setCommit(''); }} className={sel} title="기준 브랜치 — 여기서 갈라진 뒤의 변경">
            {d.bases.map(b => <option key={b} value={b}>{b} 기준</option>)}
          </select>
        )}
        {mode === 'commit' && !!d?.commits.length && (
          <select value={d.commit ?? ''} onChange={e => setCommit(e.target.value)} className={`${sel} max-w-96 font-mono`}>
            {d.commits.map(c => <option key={c.sha} value={c.sha}>{c.short} {c.subject} · {c.when}</option>)}
          </select>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{q.isFetching ? '읽는 중…' : p.status === 'working' ? '작업 중 — 5초마다 갱신' : ''}</span>
        <button onClick={() => void q.refetch()} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">다시 읽기</button>
      </div>
      {d?.cut && <p className="text-xs text-amber-600">diff 가 너무 커서 앞부분만 보인다</p>}
      {q.error && !d ? <p className="py-10 text-center text-sm text-destructive">{String(q.error).replace(/^Error: \d+ /, '')}</p>
        : !d ? <p className="py-10 text-center text-sm text-muted-foreground">읽는 중…</p>
        : <div className="min-h-0 flex-1"><DiffView text={d.text} scope={d.root} key={`${mode}:${d.base}:${d.commit}`}
            summarize={cached => post(`/api/herdr/panes/${p.id}/summary`, { mode, base: d.base ?? '', commit: d.commit ?? '', cached })}
            empty={mode === 'work' ? '커밋 안 한 변경 없음 — 「브랜치 전체」 나 「커밋별」 로 본다' : mode === 'commit' && !d.commits.length ? '이 브랜치에 커밋이 없다' : '변경 없음'} /></div>}
    </div>
  );
}
