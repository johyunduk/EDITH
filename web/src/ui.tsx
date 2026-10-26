// 여러 화면이 같이 쓰는 작은 조각 — 아이콘 틀, 빈 안내, 꺾쇠 패널 · 격자 바탕, 마크다운, 상태 알약.
import { useRef, type ComponentProps, type CSSProperties, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Badge } from '@/components/ui/badge';
import { copyText } from './copy.ts';

// lucide 아이콘 선(ISC)
export function Icon({ children, className = 'size-4' }: { children: ReactNode; className?: string }) {
  return <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}
export const TERMINAL = <><path d="m7 11 2-2-2-2" /><path d="M11 13h4" /><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /></>;

export const Empty = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>;

// 테마 색(primary)을 pct% 만 섞은 투명 색 — 빛나는 고리 · 옅은 바탕
export const mix = (pct: number) => `color-mix(in oklab, var(--primary) ${pct}%, transparent)`;
// 격자 바탕 — 테마 색을 옅게, 32px 칸(결과 · 오늘 화면)
export const GRID_BG: CSSProperties = { backgroundImage: `linear-gradient(${mix(6)} 1px, transparent 1px), linear-gradient(90deg, ${mix(6)} 1px, transparent 1px)`, backgroundSize: '32px 32px' };

// 꺾쇠 패널 — 네 모서리에 테마 색 꺾쇠(EDITH 화면 모서리와 같은 모양). className 은 안쪽 여백 · 폭(기본 px-5 py-4)
export function Bracketed({ children, as = 'section', label: aria, className = 'px-5 py-4' }: { children: ReactNode; as?: 'section' | 'details'; label?: string; className?: string }) {
  const Tag = as;
  return (
    <Tag aria-label={aria} className={`relative block border bg-card/90 backdrop-blur-[1px] ${className}`}>
      {['-top-px -left-px border-t-2 border-l-2', '-top-px -right-px border-t-2 border-r-2', '-bottom-px -left-px border-b-2 border-l-2', '-right-px -bottom-px border-r-2 border-b-2'].map(c =>
        <span key={c} aria-hidden="true" className={`pointer-events-none absolute size-3.5 border-primary ${c}`} />)}
      {children}
    </Tag>
  );
}
export const COPY = <><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>;   // lucide copy

// 코드 블록 오른쪽 위 복사 단추 — 끝 줄바꿈은 뺀다(터미널에 붙이자마자 실행되지 않게)
function Pre({ node: _, ...props }: ComponentProps<'pre'> & { node?: unknown }) {
  const ref = useRef<HTMLPreElement>(null);
  return (
    <div className="relative">
      <pre ref={ref} {...props} />
      <button type="button" onClick={() => void copyText(ref.current?.textContent?.replace(/\n+$/, '') ?? '')} title="복사"
        className="absolute top-1.5 right-1.5 rounded p-1 text-code-foreground/60 hover:bg-white/10 hover:text-code-foreground"><Icon className="size-3.5">{COPY}</Icon></button>
    </div>
  );
}
export const Md = ({ text }: { text: string }) => <div className="md overflow-x-auto"><Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]} components={{ pre: Pre }}>{text}</Markdown></div>;

const TONE: Record<string, string> = {
  working: 'bg-sky-500/15 text-sky-700 dark:text-sky-400', blocked: 'bg-amber-500/15 text-amber-700 dark:text-amber-400', done: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
};
export const Tag = ({ v, children }: { v?: string; children?: ReactNode }) =>
  <Badge variant="secondary" className={`rounded-full font-semibold ${TONE[v ?? ''] ?? ''}`}>{children ?? v}</Badge>;
