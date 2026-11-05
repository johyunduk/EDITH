import test from 'node:test';
import assert from 'node:assert/strict';
import { estimate, groups, sameSet, visible, type Form } from '../web/src/outputAct.ts';

const f: Form = {
  pick: { items: [{ id: '1', label: '하나' }, { id: '5', label: '다섯' }, { id: '7', label: '일곱' }], selected: ['5'] },
  rows: [{ group: '데이터', label: '사용자 A', text: 'x', for: ['1', '5'] }, { group: '데이터', label: '사용자 B', key: 'B', for: ['7'] }, { group: '계정', label: '운영', text: '로그인됨' }],
};

test('보일 줄 — 고른 것에 쓰는 줄만, 묶음은 처음 나온 순', () => {
  assert.deepEqual(visible(f, new Set(['5'])).map(r => r.label), ['사용자 A', '운영']);
  assert.deepEqual(visible(f, new Set(['7'])).map(r => r.label), ['사용자 B', '운영']);
  assert.deepEqual(visible({ rows: f.rows }, new Set()).length, 3, '고르기가 없으면 다');
  assert.deepEqual(groups(f.rows).map(([g, rs]) => [g, rs.length]), [['데이터', 2], ['계정', 1]]);
});

test('보일 줄 — when 은 그 칸 값이 같을 때만', () => {
  const w: Form = { rows: [{ label: '어디서', key: 'where', options: [{ value: 'local', label: '로컬' }, { value: 'dev', label: 'dev' }] }, { label: '시드', text: 'x', when: { key: 'where', value: 'local' } }] };
  assert.deepEqual(visible(w, new Set(), { where: 'local' }).map(r => r.label), ['어디서', '시드']);
  assert.deepEqual(visible(w, new Set(), { where: 'dev' }).map(r => r.label), ['어디서']);
});

test('빠른 고르기 켜짐 · 어림', () => {
  assert.ok(sameSet(['5', '1'], new Set(['1', '5'])));
  assert.ok(!sameSet(['5'], new Set(['1', '5'])));
  assert.equal(estimate(3, { sec: 30, usd: 0.04 }), '3개 · 1분 30초쯤 · 0.12달러쯤');
  assert.equal(estimate(1, { sec: 30 }), '1개 · 30초쯤');
  assert.equal(estimate(4, { sec: 30 }), '4개 · 2분쯤');
  assert.equal(estimate(0, { sec: 30, usd: 1 }), '0개');
});
