// 여러 화면이 같이 쓰는 작은 조각 — 아이콘 틀, 빈 안내, 마크다운, 상태 알약.
import type { ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Badge } from '@/components/ui/badge';

// lucide 아이콘 선(ISC)
export function Icon({ children, className = 'size-4' }: { children: ReactNode; className?: string }) {
  return <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}
export const TERMINAL = <><path d="m7 11 2-2-2-2" /><path d="M11 13h4" /><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /></>;

export const Empty = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>;
export const Md = ({ text }: { text: string }) => <div className="md overflow-x-auto"><Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}>{text}</Markdown></div>;

const TONE: Record<string, string> = {
  working: 'bg-sky-500/15 text-sky-700 dark:text-sky-400', blocked: 'bg-amber-500/15 text-amber-700 dark:text-amber-400', done: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
};
export const Tag = ({ v, children }: { v?: string; children?: ReactNode }) =>
  <Badge variant="secondary" className={`rounded-full font-semibold ${TONE[v ?? ''] ?? ''}`}>{children ?? v}</Badge>;
