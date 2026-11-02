import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stagesOf, trimCommon } from '../web/src/stageMap.ts';
import type { FlowStep } from '../web/src/stepFlow.ts';

// 맨 위 엔진 → 엔진 「팀 파악」(체인 받기: a → b, b 가 실패하면 f · 엔진에 바로 c) → 체인 「팀 계획」 → 갈래 둘(be: 팀 BE → 팀 BE 검증, fe: 팀 FE) → 체인 「팀 끝」 → 맨 위 노드 n
const E = { name: '팀 파악', kind: 'engine' as const }, R = { name: '팀 받기', kind: 'chain' as const };
const ch = (name: string) => [{ name, kind: 'chain' as const }];
const st = (key: string, group: string, boxes: FlowStep['boxes'], deps: string[] = [], more: Partial<FlowStep> = {}): FlowStep =>
  ({ key, title: key, lane: boxes?.at(-1)?.name ?? '맨 위', group, kind: 'skill', deps, boxes, ...more });
const STEPS = [
  st('in.r.a', 'in.r.', [E, R]),
  st('in.r.b', 'in.r.', [E, R], ['in.r.a'], { failTo: 'in.r.f' }),
  st('in.c', 'in.', [E], ['in.r.b']),
  st('plan.p', 'plan.', ch('팀 계획'), ['in.c']),
  st('be.x', 'be.', ch('팀 BE'), ['plan.p']),
  st('be2.x', 'be2.', ch('팀 BE 검증'), ['be.x']),
  st('fe.x', 'fe.', ch('팀 FE'), ['plan.p']),
  st('end.e', 'end.', ch('팀 끝'), ['be2.x', 'fe.x']),
  st('n', '.', undefined, ['end.e'], { title: '알림 보내기' }),
  st('in.r.f', 'in.r.', [E, R], [], { fixOnly: true }),
];

test('펼쳐 보기 지도 — 맨 위 체인 · 엔진이 역, 같은 첫 낱말은 떼고, 고치는 노드는 수만', () => {
  const { stages } = stagesOf(STEPS);
  assert.deepEqual(stages.map(g => [g.key, g.name, g.kind, g.n, g.fix]), [
    ['in.', '파악', 'engine', 3, 1], ['plan.', '계획', 'chain', 1, 0], ['be.', 'BE', 'chain', 1, 0], ['be2.', 'BE 검증', 'chain', 1, 0],
    ['fe.', 'FE', 'chain', 1, 0], ['end.', '끝', 'chain', 1, 0], ['.n', '알림 보내기', 'node', 1, 0],
  ]);
  // 역 안 줄 — 든 체인마다, 역에 바로 놓인 노드는 역 이름
  assert.deepEqual(stages[0].rows.map(r => [r.name, r.steps.map(s => s.key)]), [['받기', ['in.r.a', 'in.r.b']], ['파악', ['in.c']]]);
});

test('펼쳐 보기 지도 — 칸은 차례, 갈래는 줄을 지키고, 역 하나뿐인 칸은 가운데', () => {
  const { stages, cols, rows } = stagesOf(STEPS);
  const at = Object.fromEntries(stages.map(g => [g.key, [g.col, g.row]]));
  assert.equal(cols, 6); assert.equal(rows, 2);
  assert.deepEqual(at, { 'in.': [0, 0.5], 'plan.': [1, 0.5], 'be.': [2, 0], 'fe.': [2, 1], 'be2.': [3, 0.5], 'end.': [4, 0.5], '.n': [5, 0.5] });
  assert.deepEqual(stages.find(g => g.key === 'end.')!.prev, ['be2.', 'fe.']);
});

test('첫 낱말 떼기 — 모두 같을 때만', () => {
  assert.equal(trimCommon(['팀 a', '팀 b'])('팀 a'), 'a');
  assert.equal(trimCommon(['팀 a', '나 b'])('팀 a'), '팀 a');
  assert.equal(trimCommon(['팀 a'])('팀 a'), '팀 a');
});
