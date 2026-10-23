// 에이전트 pane 칸 — 대화와 입력칸. 공방 · 런 화면의 오른쪽 칸이 같이 쓴다(herdr 화면의 pane 보기와 같은 조각).
import type { HPane } from './api.ts';
import { Chat } from './Chat.tsx';
import { PromptBox } from './Prompt.tsx';

export function AgentPane({ p }: { p: HPane }) {
  return <><div className="flex min-h-0 flex-1 flex-col"><Chat p={p} /></div><PromptBox p={p} /></>;
}
