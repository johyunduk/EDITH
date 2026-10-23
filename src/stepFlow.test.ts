import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxesOf, layout, type FlowStep } from '../web/src/stepFlow.ts';

// 맨 위 엔진 → 단계 엔진 p → 체인 c1(a → b, b 가 실패하면 f) · 체인 c2(d)
const P = { name: '단계', kind: 'engine' as const }, C1 = { name: '체인1', kind: 'chain' as const }, C2 = { name: '체인2', kind: 'chain' as const };
const st = (key: string, group: string, boxes: FlowStep['boxes'], deps: string[] = [], more: Partial<FlowStep> = {}): FlowStep =>
  ({ key, title: key, lane: boxes?.at(-1)?.name ?? '맨 위', group, kind: 'skill', deps, boxes, ...more });
const STEPS = [
  st('p.c1.a', 'p.c1.', [P, C1]),
  st('p.c1.b', 'p.c1.', [P, C1], ['p.c1.a'], { failTo: 'p.c1.f' }),
  st('p.c2.d', 'p.c2.', [P, C2], ['p.c1.b']),
  st('p.c1.f', 'p.c1.', [P, C1], [], { fixOnly: true }),
];

test('펼친 캔버스 상자 — 묶음 마디마다 이름 · 종류 · 부모, 옛 런은 맨 안쪽 묶음만', () => {
  const b = boxesOf(STEPS);
  assert.deepEqual([...b.values()].map(x => [x.key, x.name, x.kind, x.parent, x.steps.length]),
    [['p.', '단계', 'engine', null, 3], ['p.c1.', '체인1', 'chain', 'p.', 2], ['p.c2.', '체인2', 'chain', 'p.', 1]]);
  const old = boxesOf(STEPS.map(s => ({ ...s, boxes: undefined })));
  assert.deepEqual([...old.keys()], ['p.c1.', 'p.c2.']);
  assert.equal(old.get('p.c1.')?.name, '체인1');
});

test('펼친 캔버스 자리 — 체인 안은 옆으로, 엔진 안 체인은 아래로, 고치는 노드는 아래 · 접으면 카드로 잇는다', () => {
  const b = boxesOf(STEPS), at = (l: ReturnType<typeof layout>, k: string) => l.nodes.find(n => n.key === k)!;
  const open = layout(STEPS, b, () => false);
  const [a, bb, f, d] = ['p.c1.a', 'p.c1.b', 'p.c1.f', 'p.c2.d'].map(k => at(open, k));
  assert.ok(a.y === bb.y && a.x < bb.x, '체인 안은 옆으로');
  assert.ok(f.x === bb.x && f.y > bb.y, '고치는 노드는 고칠 노드 아래');
  assert.ok(d.y > f.y, '단계 엔진 안의 다음 체인은 아래로');
  assert.deepEqual(open.edges.map(e => [e.a, e.b, !!e.fail]), [['S:p.c1.a', 'S:p.c1.b', false], ['S:p.c1.b', 'S:p.c2.d', false], ['S:p.c1.b', 'S:p.c1.f', true]]);
  const shut = layout(STEPS, b, k => k === 'p.c1.');
  assert.deepEqual(shut.nodes.map(n => n.key), ['p.c2.d']);
  assert.ok(shut.boxes.find(x => x.key === 'p.c1.')?.fold);
  assert.deepEqual(shut.edges.map(e => [e.a, e.b]), [['B:p.c1.', 'S:p.c2.d']]);   // 안쪽 화살표 · 실패 화살표는 카드 안이라 없다
});

test('펼친 캔버스 — 여럿이 같이 쓰는 고치는 노드는 한 번만 놓고, 접으면 같이 숨는다', () => {
  const steps = [{ ...STEPS[0], failTo: 'p.c1.f' }, ...STEPS.slice(1)];   // a · b 둘 다 실패하면 f
  const b = boxesOf(steps), open = layout(steps, b, () => false);
  assert.equal(open.nodes.filter(n => n.key === 'p.c1.f').length, 1);
  assert.deepEqual(open.edges.filter(e => e.fail).map(e => [e.a, e.b]), [['S:p.c1.a', 'S:p.c1.f'], ['S:p.c1.b', 'S:p.c1.f']]);
  assert.deepEqual(layout(steps, b, k => k === 'p.c1.').nodes.map(n => n.key), ['p.c2.d']);
});
