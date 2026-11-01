// 워크스페이스 묶음 — 이름에 「·」 가 있으면 그 앞을 묶음 이름으로 본다(「본부·운영」 → 묶음 「본부」, 줄에는 「운영」).
// herdr 에는 묶음이 없어 이름 규칙으로만 묶는다 — 「·」 없는 이름은 지금처럼 한 줄씩. 사이드바(Side.tsx Tree)가 쓴다.
// React 없이 — src/wsGroups.test.ts 가 확인한다.

export const SEP = '·';

/** 묶음 이름 — 「·」 앞(첫 「·」 까지). 「·」 가 없거나 앞 · 뒤가 비면 null(「·운영」 · 「본부·」 는 묶지 않는다) */
export function groupOf(label: string): string | null {
  const i = label.indexOf(SEP);
  if (i < 0) return null;
  const head = label.slice(0, i).trim(), rest = label.slice(i + SEP.length).trim();
  return head && rest ? head : null;
}

/** 묶음 안에서 보일 이름 — 묶음 이름을 뗀 뒤 글(묶이지 않는 이름은 그대로) */
export function shortName(label: string): string {
  return groupOf(label) ? label.slice(label.indexOf(SEP) + SEP.length).trim() : label;
}

export type Block<T> = { group: string | null; items: T[] };

/**
 * 차례대로 놓인 것을 묶음으로 — 같은 묶음은 처음 나온 자리에 모으고, 안의 순서는 그대로 둔다.
 * 묶음 이름이 같아도 하나뿐이면 묶지 않는다(제목 줄 하나에 한 줄은 자리만 먹는다) — 그 줄은 원래 이름 그대로 보인다.
 */
export function groupInOrder<T>(xs: readonly T[], labelOf: (x: T) => string): Block<T>[] {
  const count = new Map<string, number>();
  for (const x of xs) {
    const g = groupOf(labelOf(x));
    if (g) count.set(g, (count.get(g) ?? 0) + 1);
  }
  const out: Block<T>[] = [], at = new Map<string, Block<T>>();
  for (const x of xs) {
    const g = groupOf(labelOf(x));
    if (!g || (count.get(g) ?? 0) < 2) {
      out.push({ group: null, items: [x] });
      continue;
    }
    let b = at.get(g);
    if (!b) {
      b = { group: g, items: [] };
      at.set(g, b);
      out.push(b);
    }
    b.items.push(x);
  }
  return out;
}

/** 묶음 줄에 보일 상태 — 안에서 가장 급한 것(승인 대기 > 작업 중 > 끝남). 없으면 null */
export function urgentOf(states: readonly (string | undefined)[]): string | null {
  for (const s of ['blocked', 'working', 'done']) if (states.includes(s)) return s;
  return null;
}
