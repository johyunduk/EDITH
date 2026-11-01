import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupInOrder, groupOf, shortName, urgentOf } from '../web/src/wsGroups.ts';

test('groupOf — 「·」 앞이 묶음 이름, 앞 · 뒤가 비면 묶지 않는다', () => {
  assert.equal(groupOf('본부·운영'), '본부');
  assert.equal(groupOf('똥피·개발2(임시)'), '똥피');
  assert.equal(groupOf('IP · 세계관'), 'IP');   // 둘레 빈칸은 뗀다
  assert.equal(groupOf('a·b·c'), 'a');           // 첫 「·」 까지
  assert.equal(groupOf('공방'), null);
  assert.equal(groupOf('·운영'), null);
  assert.equal(groupOf('본부·'), null);
  assert.equal(groupOf('본부 · '), null);
});

test('shortName — 묶음 이름을 뗀 글, 묶이지 않으면 그대로', () => {
  assert.equal(shortName('본부·운영'), '운영');
  assert.equal(shortName('IP · 세계관'), '세계관');
  assert.equal(shortName('a·b·c'), 'b·c');
  assert.equal(shortName('공방'), '공방');
  assert.equal(shortName('·운영'), '·운영');
});

test('groupInOrder — 같은 묶음은 처음 나온 자리에 모으고 안의 순서는 그대로, 하나뿐인 묶음은 풀어 둔다', () => {
  const xs = ['도구·EDITH', '공방', '본부·총괄', '똥피·개발', '본부·운영', 'IP·세계관', '똥피·검증', '웨딩'];
  const got = groupInOrder(xs, x => x).map(b => [b.group, b.items]);
  assert.deepEqual(got, [
    [null, ['도구·EDITH']],                 // 「도구」 는 하나뿐 — 묶지 않는다
    [null, ['공방']],
    ['본부', ['본부·총괄', '본부·운영']],    // 사이에 낀 똥피·개발 을 건너 모은다
    ['똥피', ['똥피·개발', '똥피·검증']],
    [null, ['IP·세계관']],
    [null, ['웨딩']],
  ]);
});

test('groupInOrder — 「·」 를 아무도 안 쓰면 지금처럼 한 줄씩', () => {
  assert.deepEqual(groupInOrder(['a', 'b'], x => x), [{ group: null, items: ['a'] }, { group: null, items: ['b'] }]);
  assert.deepEqual(groupInOrder([], (x: string) => x), []);
});

test('urgentOf — 승인 대기 > 작업 중 > 끝남, 없으면 null', () => {
  assert.equal(urgentOf(['done', 'working', 'idle']), 'working');
  assert.equal(urgentOf(['done', 'blocked', 'working']), 'blocked');
  assert.equal(urgentOf(['idle', undefined]), null);
});
