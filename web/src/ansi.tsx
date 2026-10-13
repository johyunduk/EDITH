// 터미널 색(ANSI)이 든 글을 어두운 판에 색 그대로 — ansi_up 이 HTML 을 이스케이프한 뒤 색만 span 으로 입힌다.
import { AnsiUp } from 'ansi_up';

const au = new AnsiUp();
au.use_classes = false;

export function Ansi({ text, className = '' }: { text: string; className?: string }) {
  return <pre className={`code-panel break-words whitespace-pre-wrap ${className}`} dangerouslySetInnerHTML={{ __html: au.ansi_to_html(text) }} />;
}
