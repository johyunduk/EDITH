// 끝난 런 요약 — 엔진이 작업 문서에 남긴 edith-summary.json 을 런 화면 「요약」 보기로(EDITH 는 보여 주기만 한다):
// {"title", "did": ["<한 일>"], "chips"?: ["<숫자 · 꼬리표>"], "next"?: [{"label", "note"?, "action"?: "<런 단추 이름>", "done"?: true}],
//  "check"?: [{"title", "note"?, "items": ["<줄>"]}], "outputs"?: ["<산출물 이름 — edith-outputs.json 의 label>"]}
// 위에서부터 한 일 → 이제 할 일(next — 처음 안 끝난 것이 「지금」, action 이 있으면 그 런 단추를 거기 둔다) → 확인할 것(check) → 주요 산출물.
// 틀린 칸은 빼고, 한 일이 없으면 요약이 없는 것으로 본다(그 런은 타임라인부터 연다)
import { readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';

export const SUMMARY_FILE = 'edith-summary.json';
export type RunSummary = {
  title: string; did: string[]; chips: string[]; outputs: string[];
  next: { label: string; note?: string; action?: string; done?: boolean }[];
  check: { title: string; note?: string; items: string[] }[];
};

const str = (v: unknown, n: number) => typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined;
const strs = (v: unknown, n: number, max: number) => Array.isArray(v) ? v.flatMap(x => str(x, n) ?? []).slice(0, max) : [];
const objs = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []).slice(0, max);

export function parseSummary(t: string): RunSummary | null {
  let o: Record<string, unknown>;
  try { o = JSON.parse(t); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  const did = strs(o.did, 300, 6);
  if (!did.length) return null;
  return {
    title: str(o.title, 200) ?? '', did, chips: strs(o.chips, 40, 8), outputs: strs(o.outputs, 80, 8),
    next: objs(o.next, 6).flatMap(x => {
      const label = str(x.label, 40), note = str(x.note, 120), action = str(x.action, 80);
      return label ? [{ label, ...(note ? { note } : {}), ...(action ? { action } : {}), ...(x.done === true ? { done: true } : {}) }] : [];
    }),
    check: objs(o.check, 6).flatMap(x => {
      const title = str(x.title, 80), note = str(x.note, 160), items = strs(x.items, 300, 12);
      return title && items.length ? [{ title, ...(note ? { note } : {}), items }] : [];
    }),
  };
}

// 작업 문서 안의 파일만(링크로 밖을 가리키면 없는 것으로)
export function readSummary(work: string): RunSummary | null {
  try {
    const f = realpathSync(join(work, SUMMARY_FILE)), w = realpathSync(work);
    return f.startsWith(w + sep) ? parseSummary(readFileSync(f, 'utf8')) : null;
  } catch { return null; }
}
