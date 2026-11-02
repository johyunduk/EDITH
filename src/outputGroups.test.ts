import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupOutputs, groupSize } from '../web/src/outputGroups.ts';

test('산출물 묶기 — 처음 보인 차례, 묶음 없는 것은 맨 뒤 기타, fold 는 묶음 안 꾸러미', () => {
  const xs = [{ group: '문서' }, {}, { group: '리뷰' }, { group: '리뷰', fold: '원문' }, { group: '문서' }, { group: '리뷰', fold: '원문' }].map((o, i): [typeof o, number] => [o, i]);
  const gs = groupOutputs(xs);
  assert.deepEqual(gs.map(g => [g.name, g.items.map(x => x[1]), g.folds.map(f => [f.name, f.items.map(x => x[1])])]), [
    ['문서', [0, 4], []], ['리뷰', [2], [['원문', [3, 5]]]], ['기타', [1], []],
  ]);
  assert.equal(groupSize(gs[1]), 3);
  // 묶음을 하나도 안 적었으면 이름 없는 묶음 하나 — 지금처럼
  assert.deepEqual(groupOutputs([[{}, 0], [{}, 1]]).map(g => [g.name, g.items.length]), [['', 2]]);
});
