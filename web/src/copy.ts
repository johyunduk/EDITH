// 끌어 고르면 바로 복사 — 터미널처럼. 손을 뗄 때 고른 글이 있으면 클립보드로 보내고 잠깐 「복사됨」 을 띄운다.
// 입력칸(input·textarea) 안에서 고른 것은 고치는 중이라 건드리지 않는다. 터미널 칸(xterm)은 자체 선택이라 copyText 를 직접 부른다.
export async function copyText(text: string) {
  if (!text.trim()) return;
  try { await navigator.clipboard.writeText(text); toast(`복사됨 · ${text.length > 40 ? `${text.slice(0, 40)}…` : text}`); } catch { /* 클립보드 권한 없음 */ }
}

export function toast(msg: string, ms = 1400) {
  document.querySelector('[data-copy-toast]')?.remove();
  const el = document.createElement('div');
  el.dataset.copyToast = '';
  el.textContent = msg;
  el.className = 'pointer-events-none fixed bottom-6 left-1/2 z-50 max-w-md -translate-x-1/2 truncate rounded-full bg-foreground/90 px-3.5 py-1.5 text-xs text-background shadow-lg';
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
}

export function copyOnSelect() {
  const up = (e: MouseEvent) => {
    if (e.button !== 0 || (e.target instanceof Element && e.target.closest('input, textarea, .xterm'))) return;
    const sel = getSelection();
    if (sel && !sel.isCollapsed) void copyText(sel.toString());
  };
  addEventListener('mouseup', up);
  return () => removeEventListener('mouseup', up);
}
