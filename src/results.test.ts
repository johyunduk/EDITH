import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flip, parseResults } from './results.ts';

const FILE = JSON.stringify([
  { tag: '출석 체크', title: 'api 9472', note: '마이그레이션 먼저', items: [{ text: '마이그레이션', done: false, group: 'stage' }, { text: '캐시 비우기', done: true, group: 'prod' }, { text: 3 }] },
  { title: '태그 없음', items: [] },
  { tag: '빠짐', items: [{ text: 'x' }] },
  '깨짐',
]);

test('결과 읽기 — 제목 · 할 일이 있는 것만, 틀린 할 일은 빼고, 깨진 파일은 빈 것', () => {
  assert.deepEqual(parseResults(FILE), [
    { tag: '출석 체크', title: 'api 9472', note: '마이그레이션 먼저', items: [{ text: '마이그레이션', done: false, group: 'stage' }, { text: '캐시 비우기', done: true, group: 'prod' }] },
    { tag: '', title: '태그 없음', items: [] },
  ]);
  assert.deepEqual(parseResults('깨짐'), []);
  assert.deepEqual(parseResults('{}'), []);
});

test('결과 체크 — 화면이 본 상태와 같을 때만 뒤집고, 없거나 바뀌었으면 고치지 않는다', () => {
  const after = flip(FILE, 'api 9472', '마이그레이션', false);
  assert.equal(parseResults(after)[0].items[0].done, true);
  assert.equal(JSON.parse(after)[0].items[2].text, 3);   // 화면이 안 읽는 칸도 그대로 둔다
  assert.throws(() => flip(after, 'api 9472', '마이그레이션', false), /그사이 바뀌었다/);
  assert.throws(() => flip(FILE, 'api 9472', '없는 일', false), /그 할 일이 없다/);
  const twice = JSON.stringify([{ title: 'a', items: [{ text: 'x' }, { text: 'x' }] }]);
  assert.throws(() => flip(twice, 'a', 'x', false), /둘 이상/);
  // 같은 글이 묶음마다 — 묶음으로 가른다(묶음 없는 할 일은 '')
  const both = JSON.stringify([{ title: 'a', items: [{ text: 'x', group: 'stage' }, { text: 'x', group: 'prod' }, { text: 'x' }] }]);
  assert.deepEqual(JSON.parse(flip(both, 'a', 'x', false, 'prod'))[0].items.map((i: { done?: boolean }) => !!i.done), [false, true, false]);
  assert.deepEqual(JSON.parse(flip(both, 'a', 'x', false, ''))[0].items.map((i: { done?: boolean }) => !!i.done), [false, false, true]);
});
