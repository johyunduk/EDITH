// 우클릭 메뉴 — 브라우저 기본 메뉴 대신 화면이 정한 항목을 누른 자리에 띄운다. Shift+우클릭은 기본 메뉴 그대로.
// 위험한 항목(confirm)은 한 번 더 눌러야 하고, 입력 항목(input)은 메뉴 안에서 글을 받아 Enter 로 보낸다.
import { useEffect, useRef, useState } from 'react';

export type MenuItem = '-' | {
  label: string; run?: () => unknown; danger?: boolean; confirm?: boolean;
  input?: { initial: string; submit: (v: string) => unknown };
};
type Open = { x: number; y: number; items: MenuItem[] };

let show: ((m: Open | null) => void) | null = null;
export function openMenu(e: React.MouseEvent, items: MenuItem[]) {
  if (e.shiftKey) return;
  e.preventDefault();
  e.stopPropagation();
  show?.({ x: e.clientX, y: e.clientY, items });
}

export function MenuHost() {
  const [m, setM] = useState<Open | null>(null), [armed, setArmed] = useState(''), [editing, setEditing] = useState('');
  const box = useRef<HTMLDivElement>(null);
  show = v => { setM(v); setArmed(''); setEditing(''); };
  useEffect(() => {
    if (!m) return;
    const close = (e: Event) => { if (!(e.target instanceof Node && box.current?.contains(e.target))) setM(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setM(null); };
    addEventListener('mousedown', close); addEventListener('scroll', close, true); addEventListener('resize', close); addEventListener('keydown', esc);
    return () => { removeEventListener('mousedown', close); removeEventListener('scroll', close, true); removeEventListener('resize', close); removeEventListener('keydown', esc); };
  }, [m]);
  if (!m) return null;
  const done = (f?: () => unknown) => { setM(null); void f?.(); };
  // 화면 밖으로 나가지 않게 — 오른쪽·아래가 모자라면 왼쪽·위로 편다
  const style = { left: Math.min(m.x, innerWidth - 240), top: Math.min(m.y, innerHeight - 30 * m.items.length - 16) };
  return (
    <div ref={box} style={style} className="fixed z-50 min-w-52 rounded-md border bg-popover p-1 text-sm shadow-lg">
      {m.items.map((it, i) => it === '-' ? <div key={i} className="my-1 border-t" /> : it.input && editing === it.label ? (
        <input key={i} autoFocus defaultValue={it.input.initial} className="w-full rounded border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring/50"
          onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { const v = e.currentTarget.value; done(() => it.input!.submit(v)); } }} />
      ) : (
        <button key={i} onClick={() => {
          if (it.input) setEditing(it.label);
          else if (it.confirm && armed !== it.label) setArmed(it.label);
          else done(it.run);
        }} className={`block w-full rounded px-2 py-1 text-left hover:bg-muted ${it.danger ? 'text-destructive' : ''}`}>
          {it.confirm && armed === it.label ? `${it.label} — 한 번 더 누르면 실행` : it.label}
        </button>
      ))}
    </div>
  );
}
