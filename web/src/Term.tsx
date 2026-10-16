// 터미널 — herdr pane 화면 그대로(xterm.js), 누르면 입력. 빠른 키(승인 메뉴 고르기·끊기).
import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { post } from './api.ts';
import { Button } from '@/components/ui/button';
import { copyText } from './copy.ts';

// 칸 폭에 맞춰 터미널 글자 크기를 줄인다(8~13). Menlo 한 칸 폭 ≈ 글자 크기 × 0.61.
function useFit(wrap: React.RefObject<HTMLDivElement | null>, term: React.RefObject<Terminal | null>) {
  const fit = () => {
    const t = term.current, w = wrap.current?.clientWidth;
    if (!t || !w) return;
    const fs = Math.max(8, Math.min(13, Math.floor((w - 16) / (t.cols * 0.61))));
    if (t.options.fontSize !== fs) t.options.fontSize = fs;
  };
  useEffect(() => {
    const ro = new ResizeObserver(fit);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  });
  return fit;
}

// 빠른 키 — 승인 메뉴 고르기·끊기. 입력 모드가 아니어도 바로 간다.
const QUICK = [['1', '1'], ['2', '2'], ['3', '3'], ['up', '↑'], ['down', '↓'], ['enter', 'Enter'], ['esc', 'Esc'], ['ctrl+c', 'Ctrl+C']];
export function QuickKeys({ pane, blocked }: { pane: string; blocked: boolean }) {
  const [err, setErr] = useState('');
  const send = (key: string) => post(`/api/herdr/panes/${pane}/keys`, { key }).then(() => setErr('')).catch(e => setErr(String(e)));
  return (
    <div className={`flex flex-wrap items-center gap-1 rounded-md p-1 ${blocked ? 'bg-amber-500/10 ring-1 ring-amber-500/40' : ''}`}>
      {blocked && <span className="px-1 text-xs text-amber-700 dark:text-amber-400">승인 대기 — 고를 번호나 키</span>}
      {QUICK.map(([k, label]) => <Button key={k} size="sm" variant="outline" className="h-7 px-2 font-mono text-xs" onClick={() => void send(k)}>{label}</Button>)}
      {err && <span className="text-xs text-destructive">{err}</span>}
    </div>
  );
}

// 터미널 — herdr terminal session 의 프레임을 그대로 그린다. 첫 프레임(full)이 화면 전체, 그 뒤는 바뀐 부분.
// 평소엔 보기(observe). 누르면 입력 모드(control)로 다시 붙어 키·휠이 이 pane 으로 간다. pane 하나에 입력은 하나 —
// 다른 화면이 입력 중이면 가져올지 묻는다. 끊기면 EventSource 가 다시 붙고 서버가 full 부터 다시 보낸다.
export function Term({ pane }: { pane: string }) {
  const box = useRef<HTMLDivElement>(null), wrap = useRef<HTMLDivElement>(null), term = useRef<Terminal | null>(null);
  const fit = useFit(wrap, term);
  const [mode, setMode] = useState<'view' | 'control'>('view'), [takeover, setTakeover] = useState(false);
  // state: 연결 상태, note: 입력 모드가 막히거나 뺏긴 사유(다음 동작까지 남긴다), busyBy: 다른 화면이 입력 중
  const [state, setState] = useState('연결 중'), [note, setNote] = useState(''), [busyBy, setBusyBy] = useState(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const t = new Terminal({ disableStdin: true, cursorBlink: false, fontSize: 13, scrollback: 0, fontFamily: 'Menlo, ui-monospace, monospace' });
    t.open(box.current!);
    term.current = t;
    // 터미널 칸에서 끌어 고르면 손을 뗄 때 복사(xterm 은 자체 선택이라 따로)
    const copySel = () => { if (t.hasSelection()) void copyText(t.getSelection().replace(/[ \t]+$/gm, '')); };   // 줄 끝 빈칸은 뺀다
    const el = box.current!;
    el.addEventListener('mouseup', copySel);
    // 키 — 보내는 중에 친 것은 모아 두었다가 한 번에(순서 유지).
    let queue = '', sending = false;
    const flush = async () => {
      if (sending || !queue) return;
      sending = true;
      const text = queue; queue = '';
      await post(`/api/herdr/panes/${pane}/input`, { text }).catch(e => setState(String(e)));
      sending = false;
      void flush();
    };
    const sub = t.onData(d => { if (modeRef.current === 'control') { queue += d; void flush(); } });
    // 휠 — 입력 모드에서만 herdr 쪽 화면을 올리고 내린다. xterm 이 휠을 화살표 키로 바꿔 보내지 않게 여기서 끊는다
    // (지난 줄이 없는 화면에서 xterm 은 휠을 ↑↓ 로 보낸다 — 셸 기록이 넘어간다).
    let lastWheel = 0;
    t.attachCustomWheelEventHandler(e => {
      e.preventDefault();
      if (modeRef.current === 'control' && Date.now() - lastWheel >= 40) {
        lastWheel = Date.now();
        void post(`/api/herdr/panes/${pane}/input`, { scroll: e.deltaY < 0 ? 'up' : 'down' }).catch(() => undefined);
      }
      return false;
    });
    return () => { el.removeEventListener('mouseup', copySel); sub.dispose(); t.dispose(); term.current = null; };
  }, [pane]);

  useEffect(() => {
    const t = term.current!;
    t.options.disableStdin = mode !== 'control';
    const q = mode === 'control' ? `?mode=control${takeover ? '&takeover=1' : ''}` : '';
    const es = new EventSource(`/api/herdr/panes/${encodeURIComponent(pane)}/stream${q}`);
    es.onopen = () => setState(mode === 'control' ? '입력 모드로 붙는 중' : '실시간 · 보기');
    es.onmessage = e => {
      const f = JSON.parse(e.data) as { full: boolean; w: number; h: number; b: string };
      if (f.full && mode === 'control') { setState('입력 중 — 키가 이 pane 으로 간다'); setBusyBy(false); setNote(''); t.focus(); }   // 첫 프레임 = 붙었다
      if (f.full) t.reset();
      if (t.cols !== f.w || t.rows !== f.h) { t.resize(f.w, f.h); fit(); }
      t.write(Uint8Array.from(atob(f.b), c => c.charCodeAt(0)));
    };
    es.addEventListener('closed', e => {
      es.close();
      const why = (e as MessageEvent).data as string;
      if (/already has an attached client/.test(why)) { setBusyBy(true); setNote('다른 화면이 이 pane 에 입력 중'); }
      else if (/taken over/.test(why)) setNote('다른 화면이 입력을 가져갔다 — 보기로 돌아감');
      else if (mode === 'view') setNote('pane 이 닫혔다');
      setMode('view'); setTakeover(false);
    });
    // 입력 모드는 끊기면 다시 붙지 않고 보기로 — 저절로 다시 붙으면(가져오기 포함) 다른 화면과 입력을 뺏고 뺏긴다.
    es.onerror = () => { if (mode === 'control') { es.close(); setMode('view'); setTakeover(false); } else setState('다시 붙는 중'); };
    return () => es.close();
  }, [pane, mode, takeover]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>터미널 · {state}</span>
        {note && <span className="text-amber-700 dark:text-amber-400">{note}</span>}
        {mode === 'control'
          ? <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => setMode('view')}>보기로</Button>
          : <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => { setTakeover(busyBy); setNote(''); setMode('control'); }}>{busyBy ? '입력 가져오기' : '입력'}</Button>}
      </div>
      <div ref={wrap} onClick={() => { if (mode === 'view' && !busyBy) { setNote(''); setMode('control'); } }}
        className={`min-h-0 max-w-full flex-1 overflow-auto rounded-md bg-black p-2 ${mode === 'control' ? 'ring-2 ring-sky-500' : 'cursor-pointer'}`}>
        <div ref={box} className="w-fit" />
      </div>
    </div>
  );
}
