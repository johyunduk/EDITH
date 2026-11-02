// 런 화면 산출물 묶기 — 엔진이 산출물마다 적은 group(묶음) · fold(묶음 안에서 접어 둘 꾸러미)로, 처음 보인 차례대로.
// group 이 하나도 없으면 이름 없는 묶음 하나(묶지 않은 것과 같다), 일부만 없으면 그것들은 맨 뒤 「기타」
export type OutputGroup<T> = { name: string; items: [T, number][]; folds: { name: string; items: [T, number][] }[] };
export function groupOutputs<T extends { group?: string; fold?: string }>(xs: [T, number][]): OutputGroup<T>[] {
  const named = xs.some(([o]) => o.group), gs = new Map<string, OutputGroup<T>>();
  for (const x of xs) {
    const name = named ? x[0].group ?? '기타' : '', fold = x[0].fold;
    const g = gs.get(name) ?? gs.set(name, { name, items: [], folds: [] }).get(name)!;
    if (!fold) { g.items.push(x); continue; }
    const f = g.folds.find(f => f.name === fold) ?? g.folds[g.folds.push({ name: fold, items: [] }) - 1];
    f.items.push(x);
  }
  return [...gs.values()].sort((a, b) => Number(a.name === '기타') - Number(b.name === '기타'));
}
export const groupSize = (g: OutputGroup<unknown>) => g.items.length + g.folds.reduce((n, f) => n + f.items.length, 0);
