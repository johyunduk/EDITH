// 입력칸 — 프롬프트·명령 보내기, 답을 기다리는 질문의 선택지 버튼, 자동 완성(/ 명령·스킬, @ 파일), 첨부, 중지 키, 쓰다 만 글.
import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, type HPane } from './api.ts';
import { Button } from '@/components/ui/button';
import { Icon } from './ui.tsx';
import { isFree, type Menu } from './screenMenu.ts';
import { toast } from './copy.ts';
import { Attach, upload } from './Attach.tsx';
import { useScreen } from './Chat.tsx';

// 중지 — 셸은 Ctrl+C(php artisan serve·npm run dev 같은 돌고 있는 명령 끝내기), 에이전트는 Esc(하던 일 멈추기).
// 에이전트에 Ctrl+C 를 두 번 보내면 Claude 가 꺼지므로 에이전트에는 Esc 만 보낸다.
const STOP = <><circle cx="12" cy="12" r="10" /><rect x="9" y="9" width="6" height="6" rx="1" /></>;   // lucide circle-stop
function StopKey({ p }: { p: HPane }) {
  const key = p.agent ? 'esc' : 'ctrl+c', label = p.agent ? 'Esc' : 'Ctrl+C';
  const send = () => post(`/api/herdr/panes/${p.id}/keys`, { key }).then(() => toast(`${label} 보냄`), (e: Error) => toast(`보내지 못했다 — ${e.message}`, 4000));
  return (
    <button onClick={() => void send()} title={p.agent ? '하던 일 멈추기 — Esc 를 보낸다' : '돌고 있는 명령 끝내기 — Ctrl+C 를 보낸다'}
      className="flex h-8 items-center gap-1 rounded-full px-2 text-muted-foreground/80 transition hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400">
      <Icon>{STOP}</Icon><span className="font-mono text-[0.6875rem] font-semibold">{label}</span>
    </button>
  );
}

// 프롬프트 — 에이전트는 agent prompt(붙여넣기·엔터를 herdr 가 맞춘다), 셸은 명령 실행. 한글 조합 중 엔터는 보내지 않는다.
const SEND = <><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" /><path d="m21.854 2.147-10.94 10.939" /></>;   // lucide send
// 에이전트가 질문·승인으로 답을 기다리면 입력칸 자리에 질문과 선택지 버튼을 띄운다. 번호를 보내면 그 선택지로 답이 들어간다.
// 「직접 입력」 선택지(Type something 등)를 고르면 입력칸에 쓴 글이 그 답이 된다.
// 여러 개 고르기는 누를 때마다 체크를 켜고 끄고, 「다음 →」(→ 키)로 다음 질문·제출 화면으로 넘어간다 — 제출 화면은 번호 메뉴라 「Submit answers」 를 누른다.
// 쓰다 만 글은 pane 마다 따로 이 브라우저에 둔다 — 다른 pane 으로 갔다 와도, 탭을 닫았다 열어도 그 pane 글만 남는다(저장이 막히면 이 탭에서만).
// shortcut: 닫힌 pane 의 글은 지우지 않는다(몇 줄이라 쌓여도 작다) — 문제가 되면 herdr 목록에 없는 pane 의 글을 지운다.
const drafts = new Map<string, string>(), draftKey = (id: string) => `edith.draft.${id}`;
const loadDraft = (id: string) => { try { return localStorage.getItem(draftKey(id)) ?? ''; } catch { return drafts.get(id) ?? ''; } };
function saveDraft(id: string, text: string) {
  if (text) drafts.set(id, text); else drafts.delete(id);
  try { if (text) localStorage.setItem(draftKey(id), text); else localStorage.removeItem(draftKey(id)); } catch { /* 저장 안 됨 — 이 탭의 drafts 로 */ }
}
export function PromptBox({ p, label }: { p: HPane; label?: string }) {
  const agent = !!p.agent, { menu } = useScreen(p), qc = useQueryClient();
  const [text, setText] = useState(() => loadDraft(p.id)), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [typed, setTyped] = useState<number | null>(null);
  const area = useRef<HTMLTextAreaElement>(null), [caret, setCaret] = useState(0);
  const ac = useComplete(p, text, caret);
  useEffect(() => saveDraft(p.id, text), [p.id, text]);
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    try { await f(); setErr(''); } catch (e) { setErr(String(e)); }
    setBusy(false);
    void qc.invalidateQueries({ queryKey: ['live', p.id] });   // 체크·다음 질문이 바로 보이게
  };
  const choose = (n: number, answer?: string) => run(async () => {
    await post(`/api/herdr/panes/${p.id}/choose`, { n, text: answer });
    setTyped(null); setText('');
  });
  // 선택지 누르기 — 번호 메뉴는 번호 키, 커서 메뉴(번호 없음)는 ↑↓ 로 그 줄까지 옮기고 Enter
  const key = (k: string) => post(`/api/herdr/panes/${p.id}/keys`, { key: k });
  const answer = (m: Menu, o: Menu['options'][number]) => {
    if (m.cursor === undefined) return isFree(o.label) && !m.multi ? setTyped(o.n) : void choose(o.n);
    const d = o.n - 1 - m.cursor;
    void run(async () => { for (let i = 0; i < Math.abs(d); i++) await key(d > 0 ? 'down' : 'up'); await key('enter'); });
  };
  const submit = () => {
    if (!text.trim() || busy) return;
    // 답을 기다리는 화면에 글을 프롬프트로 보내면 herdr 가 거절한다 — 보내지 않고 바로 알린다
    if (menu && typed === null) { setErr('답을 기다리는 중 — 위 선택지를 먼저 고른다(취소는 Esc)'); return; }
    if (menu && typed !== null) void choose(typed, text);
    else void run(async () => { await post(`/api/herdr/panes/${p.id}/prompt`, { text }); setText(''); });
  };
  // 첨부 경로를 커서 자리에 넣는다(빈칸 든 경로는 따옴표). 붙여넣은 파일(스크린샷 등)은 올린 뒤 같은 자리에.
  const insertPaths = (paths: string[]) => {
    const ins = `${paths.map(x => x.includes(' ') ? `"${x}"` : x).join(' ')} `, at = caret + ins.length;
    setText(`${text.slice(0, caret)}${ins}${text.slice(caret)}`); setCaret(at);
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(at, at); });
  };
  const paste = (e: React.ClipboardEvent) => {
    const files = [...e.clipboardData.files];
    if (!files.length) return;
    e.preventDefault();
    void run(async () => insertPaths(await upload(files)));
  };
  // 추천을 고르면 지금 낱말을 그것으로 바꾸고 커서를 뒤로
  const pick = (i: number) => {
    const it = ac.items[i];
    if (!it) return;
    const next = `${text.slice(0, ac.start)}${it.insert} ${text.slice(caret)}`, at = ac.start + it.insert.length + 1;
    setText(next); setCaret(at);
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(at, at); });
  };
  return (
    <div className="space-y-1">
      {menu && (
        <div className="space-y-2.5 rounded-2xl border border-amber-500/30 bg-gradient-to-b from-amber-500/10 to-amber-500/5 p-3.5 shadow-sm">
          <div className="flex items-center gap-2 text-[0.75rem] font-semibold text-amber-700 dark:text-amber-400">
            <span className="flex size-5 animate-pulse items-center justify-center rounded-full bg-amber-500 text-[0.75rem] font-bold text-white">!</span>답을 기다린다
          </div>
          {menu.tabs && <div className="text-[0.6875rem] text-muted-foreground">{menu.tabs}</div>}
          {menu.question && <div className="text-[0.84375rem] font-semibold whitespace-pre-wrap">{menu.question}</div>}
          <div className="flex flex-col gap-2">
            {menu.options.map(o => (
              <button key={o.n} disabled={busy} onClick={() => answer(menu, o)}
                className={`flex min-w-0 items-baseline gap-2.5 rounded-lg border bg-card px-3 py-2 text-left text-sm shadow-xs transition hover:border-primary/50 hover:bg-accent ${typed === o.n || o.checked ? 'border-primary ring-2 ring-primary/30' : ''}`}>
                {o.checked === undefined
                  ? <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[0.6875rem] font-bold text-primary tabular-nums">{o.n}</span>
                  : <span className={`flex size-5 shrink-0 items-center justify-center rounded-md border text-[0.75rem] font-bold ${o.checked ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'}`}>{o.checked ? '✓' : ''}</span>}
                <span className="font-medium">{o.label}</span>
                {o.desc && <span className="truncate text-xs text-muted-foreground">{o.desc}</span>}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {typed !== null ? `아래 칸에 답을 쓰고 Enter — ${typed}번으로 들어간다` : menu.multi ? '눌러서 체크 — 다 고르면 「다음」' : '눌러서 고른다'}
            {menu.multi && (
              <Button size="sm" className="ml-auto h-6 px-2.5 text-xs" disabled={busy} onClick={() => void run(() => key('right'))}>다음 →</Button>
            )}
            <Button size="sm" variant="outline" className={`${menu.multi ? '' : 'ml-auto '}h-6 px-2 text-xs`} disabled={busy}
              onClick={() => void run(() => post(`/api/herdr/panes/${p.id}/keys`, { key: 'esc' }))}>취소(Esc)</Button>
          </div>
        </div>
      )}
      {/* 입력창 — 위는 글, 아래 줄은 첨부 버튼 · 키 안내 · 보내기. 탭 전체 보기면 보낼 칸 이름은 안내 줄 대신 빈 칸 글자(placeholder)에 */}
      <div className="relative rounded-2xl border bg-card shadow-sm transition focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10">
        {ac.open && <Suggest ac={ac} onPick={i => pick(i)} />}
        <textarea ref={area} value={text} rows={Math.min(8, text.split('\n').length)}
          onChange={e => { setText(e.target.value); setCaret(e.target.selectionStart); }}
          onSelect={e => setCaret(e.currentTarget.selectionStart)}
          onPaste={paste}
          placeholder={menu && typed !== null ? '답을 쓴다' : `${label ? `${label} 에 보낼 ` : ''}${agent ? '프롬프트를 쓴다' : '명령을 쓴다'}`}
          onKeyDown={e => {
            if (ac.open && !e.nativeEvent.isComposing) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); ac.move(e.key === 'ArrowDown' ? 1 : -1); return; }
              if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); pick(ac.index); return; }
              if (e.key === 'Escape') { e.preventDefault(); ac.dismiss(); return; }
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
          }}
          className="block w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[0.84375rem] leading-relaxed outline-none placeholder:text-muted-foreground/60" />
        <div className="flex items-center gap-1 px-2 pb-2">
          <Attach onPaths={insertPaths} />
          <StopKey p={p} />
          <span className="ml-auto hidden truncate pr-1 text-[0.6875rem] text-muted-foreground/70 sm:block">
            Enter {agent ? '보내기' : '실행'} · Shift+Enter 줄바꿈{agent && ' · / 명령 · @ 파일'}
          </span>
          <Button size="sm" className="ml-auto size-9 shrink-0 rounded-lg p-0 shadow-sm sm:ml-1" onClick={submit} disabled={busy || !text.trim()}
            title={busy ? '보내는 중' : menu && typed !== null ? '답하기' : agent ? '보내기' : '실행'}>
            <Icon className={`size-4 ${busy ? 'animate-pulse' : ''}`}>{SEND}</Icon>
          </Button>
        </div>
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}

// 자동 완성 — 커서 앞 낱말이 맨 앞의 /(명령·스킬), Codex 의 $(스킬), 어디서든 @(파일)이면 추천을 띄운다.
// ↑↓ 로 고르고 Tab·Enter 로 넣는다. Esc 로 닫으면 그 낱말이 바뀔 때까지 다시 안 뜬다.
type Ac = { open: boolean; items: { insert: string; label: string; desc?: string }[]; index: number; start: number; move: (d: number) => void; dismiss: () => void };
function useComplete(p: HPane, text: string, caret: number): Ac {
  const before = text.slice(0, caret), tok = before.match(/(?:^|\s)([/@$][^\s]*)$/)?.[1] ?? null;
  const start = caret - (tok?.length ?? 0);
  const kind = !tok ? null : tok[0] === '@' ? 'file' : (tok[0] === '/' && start === 0 && p.agent) || (tok[0] === '$' && p.agent === 'codex') ? 'cmd' : null;
  const cmds = useQuery({ queryKey: ['cmds', p.id], queryFn: () => get<{ name: string; desc: string; skill?: boolean }[]>(`/api/herdr/panes/${p.id}/commands`), enabled: kind === 'cmd', staleTime: 60_000 });
  const q = kind === 'file' ? tok!.slice(1) : '';
  const fs = useQuery({ queryKey: ['files', p.id, q], queryFn: () => get<string[]>(`/api/herdr/panes/${p.id}/files?q=${encodeURIComponent(q)}`), enabled: kind === 'file', placeholderData: keepPreviousData, staleTime: 10_000 });
  const [index, setIndex] = useState(0), [closed, setClosed] = useState<string | null>(null);
  useEffect(() => setIndex(0), [tok]);
  const low = tok?.toLowerCase() ?? '';
  // Codex 스킬은 /이름으로 보이고(보낼 때 서버가 $이름으로 바꾼다), $ 로 치면 스킬만 $이름으로
  const dollar = tok?.[0] === '$';
  const items = kind === 'cmd'
    ? (cmds.data ?? []).filter(c => !dollar || c.skill).map(c => ({ ...c, name: dollar ? `$${c.name.slice(1)}` : c.name }))
      .filter(c => c.name.toLowerCase().includes(low)).sort((a, b) => Number(!a.name.toLowerCase().startsWith(low)) - Number(!b.name.toLowerCase().startsWith(low))).slice(0, 50)
      .map(c => ({ insert: c.name, label: c.name, desc: c.skill && !dollar ? `Codex 스킬 — $${c.name.slice(1)} 로 보낸다 · ${c.desc}` : c.desc }))
    : kind === 'file' ? (fs.data ?? []).map(f => ({ insert: `@${f}`, label: f })) : [];
  return {
    open: !!kind && items.length > 0 && closed !== `${start}:${tok}`, items, index: Math.min(index, items.length - 1), start,
    move: d => setIndex(i => (i + d + items.length) % items.length), dismiss: () => setClosed(`${start}:${tok}`),
  };
}

function Suggest({ ac, onPick }: { ac: Ac; onPick: (i: number) => void }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.children[ac.index]?.scrollIntoView({ block: 'nearest' }); }, [ac.index]);
  return (
    <div ref={list} className="absolute bottom-full left-0 z-20 mb-2 max-h-64 w-full overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg">
      {ac.items.map((it, i) => (
        <button key={it.insert} onMouseDown={e => { e.preventDefault(); onPick(i); }}
          className={`flex w-full items-baseline gap-3 rounded-lg px-2.5 py-1.5 text-left text-sm ${i === ac.index ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60'}`}>
          <span className="shrink-0 font-mono text-xs font-semibold text-primary">{it.label}</span>
          {it.desc && <span className="truncate text-xs text-muted-foreground">{it.desc}</span>}
        </button>
      ))}
    </div>
  );
}
