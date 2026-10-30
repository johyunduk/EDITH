// 시킨 말 — 대화 항목에서 마지막에 내가 친 말과 그 뒤 답 첫 줄을 고른다. 여러 워크스페이스를 오가다 끝난 pane 에 들어갔을 때 무슨 일이었는지 보려고.
// 서버(/api/herdr/panes/<id>/asks — 사이드바 카드·상태 목록·알림함)와 대화 칸 띠가 같이 쓴다.
export type AskItem = { t: number; kind: string; text: string; from?: string; at?: number };
export type Ask = { t: number; text: string; from?: string; at?: number };
export type Asks = { asks: Ask[]; answer?: { t: number; text: string } };

// 런이 보낸 재촉(runner.ts)과 / 명령 · ! 셸 명령은 시킨 일이 아니다
const NUDGE = /^(결과 파일\(|사용량 한도가 풀렸다)/;
const isAsk = (i: AskItem) => i.kind === 'peer' || (i.kind === 'user' && !/^[/!]/.test(i.text.trim()) && !NUDGE.test(i.text.trim()));
// 「응 해줘」·「1번」 처럼 짧은 말은 그것만으로 무슨 일인지 모른다 — 그 앞의 말을 같이
const SHORT = 20;
const cut = (s: string, n: number) => s.length > n ? `${s.slice(0, n)}…` : s;
// 붙여 넣은 글은 기록에 <pasted_content id="…"> 로 감싸여 남는다
const clean = (s: string) => s.replace(/<\/?pasted_content[^>]*>/g, '').trim();

// 답 첫 줄 — 마크다운 꾸밈(#·**·`·- )을 벗긴 첫 글 줄
export function firstLine(md: string) {
  const l = md.split('\n').map(x => x.replace(/^\s*(#+|[-*>]|\d+\.)\s+/, '').replace(/\*\*|__|`/g, '').trim()).find(Boolean) ?? '';
  return cut(l, 200);
}

// 끝(최근)이 asks 마지막. 짧은 말이면 [그 앞 말, 짧은 말], 아니면 [마지막 말]. answer 는 마지막 말 뒤의 마지막 글(없으면 아직 답 전).
export function lastAsks(items: AskItem[]): Asks {
  const k = items.findLastIndex(isAsk);
  if (k < 0) return { asks: [] };
  const last = items[k], one = (i: AskItem): Ask => ({ t: i.t, text: cut(clean(i.text), 400), ...(i.from ? { from: i.from } : {}), ...(i.at !== undefined ? { at: i.at } : {}) });
  const prev = clean(last.text).length < SHORT ? items.slice(0, k).findLast(isAsk) : undefined;
  const reply = items.slice(k + 1).findLast(i => i.kind === 'text');
  return { asks: prev ? [one(prev), one(last)] : [one(last)], ...(reply ? { answer: { t: reply.t, text: firstLine(reply.text) } } : {}) };
}
