// 📎 첨부 — 브라우저에서 고른 파일, 입력칸에 붙여넣은 파일(스크린샷 등)을 서버(/api/upload)에 올리고 그 경로를 받는다.
// 에이전트는 그 경로로 파일을 읽는다(Claude 는 이미지도 본다). 스크린샷은 OS 캡처를 클립보드로 찍고 붙여넣는다.
import { useRef, useState } from 'react';
import { post } from './api.ts';
import { toast } from './copy.ts';
import { Icon } from './ui.tsx';

const MAX = 15 * 1024 * 1024;   // 서버와 같은 상한
const CLIP = <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />;   // lucide paperclip

const base64 = (f: File) => new Promise<string>((ok, no) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1] ?? '');
  r.onerror = () => no(r.error);
  r.readAsDataURL(f);
});

export async function upload(files: File[]) {
  const paths: string[] = [];
  for (const f of files) {
    if (f.size > MAX) throw new Error(`${f.name} — 15MB 까지만 올린다`);
    paths.push((await post<{ path: string }>('/api/upload', { name: f.name, data: await base64(f) })).path);
  }
  return paths;
}

// 올리는 동안 버튼이 깜박이고, 실패는 잠깐 띄운다. 붙여넣기는 입력칸이 upload 를 직접 부른다.
export function Attach({ onPaths }: { onPaths: (paths: string[]) => void }) {
  const input = useRef<HTMLInputElement>(null), [busy, setBusy] = useState(false);
  const pick = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try { onPaths(await upload(files)); } catch (e) { toast(`올리지 못했다 — ${e instanceof Error ? e.message : e}`, 6000); }
    setBusy(false);
    if (input.current) input.current.value = '';
  };
  return <>
    <input ref={input} type="file" multiple hidden onChange={e => void pick([...e.target.files ?? []])} />
    <button disabled={busy} onClick={() => input.current?.click()} title="파일 첨부 — 골라서 올리고 경로를 넣는다 · 입력칸에 붙여넣기(스크린샷)도 된다"
      className={`flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground/80 transition hover:bg-muted/60 hover:text-foreground disabled:opacity-50 ${busy ? 'animate-pulse text-primary' : ''}`}>
      <Icon>{CLIP}</Icon>
    </button>
  </>;
}
