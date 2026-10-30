// 배포 화면 안건 순서 — 지금 차례 칸이 마지막 환경(운영) → … → 첫 환경 → 로컬(작업 · 커밋 · 올림 · 합침)인 안건부터.
// 차례 칸이 없으면(런이 도는 중 · 끝까지 감) 맨 뒤. 같은 자리끼리는 목록 순(등록한 순서 — 일을 시작한 순서). React 없이 — src/deployOrder.test.ts 가 확인한다
export type Turn = { act?: boolean; env?: string };

export function turnRank(steps: Turn[], envs: { name: string }[]) {
  const at = steps.filter(s => s.act).map(s => s.env ? envs.length - 1 - envs.findIndex(e => e.name === s.env) : envs.length);
  return Math.min(envs.length + 1, ...at);
}
export const byTurn = <T>(xs: T[], steps: (x: T) => Turn[], envs: { name: string }[]) =>
  xs.map((x, i) => ({ x, i, r: turnRank(steps(x), envs) })).sort((a, b) => a.r - b.r || a.i - b.i).map(o => o.x);
