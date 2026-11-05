// 산출물 단추 띠의 계산 — 서버 src/outputActs.ts 의 Form 을 화면에 놓을 때(고른 것에 따라 보일 줄 · 묶음 · 어림)
export type FormRow = { group?: string; label: string; sub?: string; for?: string[]; when?: { key: string; value: string }; key?: string; value?: string; options?: { value: string; label: string }[]; placeholder?: string; text?: string; src?: string; tone?: 'ok' | 'warn'; hint?: string };
export type Form = {
  pick?: { label?: string; items: { id: string; label: string }[]; quick?: { label: string; ids: string[] }[]; selected: string[] };
  rows: FormRow[]; note?: string; each?: { sec?: number; usd?: number }; start?: string;
};
export type OutJob = { label: string; at: number; state: 'running' | 'done' | 'failed' | 'stopped'; progress?: string; ratio?: number; end?: number; code?: number; last?: string };

// for 를 적은 줄은 그 id 를 하나라도 고른 때만(고르기가 없는 띠면 다 보인다), when 을 적은 줄은 그 칸 값이 그것일 때만
export const visible = (f: Form, picked: ReadonlySet<string>, vals: Record<string, string> = {}) =>
  f.rows.filter(r => (!f.pick || !r.for || r.for.some(id => picked.has(id))) && (!r.when || vals[r.when.key] === r.when.value));
// 묶음 이름 차례대로(처음 나온 순) — 이름 없는 줄은 이름 없는 묶음 하나
export function groups(rows: FormRow[]): [string, FormRow[]][] {
  const m = new Map<string, FormRow[]>();
  for (const r of rows) m.set(r.group ?? '', [...m.get(r.group ?? '') ?? [], r]);
  return [...m];
}
// 빠른 고르기가 지금 고른 것과 같으면 켜진 것으로 보인다
export const sameSet = (ids: string[], picked: ReadonlySet<string>) => ids.length === picked.size && ids.every(id => picked.has(id));
// 「3개 · 1분 30초쯤 · 0.12달러쯤」 — 하나에 걸리는 것을 곱한 어림
export function estimate(n: number, each?: Form['each']) {
  const parts = [`${n}개`];
  if (each?.sec !== undefined && n) {
    const s = Math.round(each.sec * n), m = Math.floor(s / 60);
    parts.push(`${s < 60 ? `${s}초` : `${m}분${s % 60 ? ` ${s % 60}초` : ''}`}쯤`);
  }
  if (each?.usd !== undefined && n) parts.push(`${(each.usd * n).toFixed(2)}달러쯤`);
  return parts.join(' · ');
}
