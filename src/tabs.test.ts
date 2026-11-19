import { test } from 'node:test';
import assert from 'node:assert/strict';
import { close, move, navigate, open, restore, tabKey, type Tabs } from '../web/src/tabs.ts';

const three = (): Tabs => ({ list: [{ id: 'a', hash: '#/herdr/w1:p1' }, { id: 'b', hash: '#/runs/81' }, { id: 'c', hash: '#/deploy' }], active: 'a', closed: [] });
const hashes = (s: Tabs) => s.list.map(t => t.hash);

test('같은 화면 열쇠 — 런 산출물 창은 그 런, 옛 결과는 배포, ?run= 은 뗀다', () => {
  assert.equal(tabKey('#/runs/12/out/3'), 'runs:12');
  assert.equal(tabKey('#/runs/schedule/eng'), 'runs:schedule/eng');
  assert.equal(tabKey('#/runs?run=eng'), 'runs');
  assert.equal(tabKey('#/results'), 'deploy');
  assert.equal(tabKey('#/settings/engine/x.0'), 'settings:engine/x.0');
  assert.equal(tabKey(''), 'herdr');
});

test('그냥 이동은 보는 탭을 바꾸고, 같은 화면이 다른 탭에 있으면 그 탭으로 간다', () => {
  const s = navigate(three(), '#/herdr/w1:p2');
  assert.equal(s.active, 'a');
  assert.deepEqual(hashes(s), ['#/herdr/w1:p2', '#/runs/81', '#/deploy']);
  const t = navigate(three(), '#/runs/81/out/2');
  assert.equal(t.active, 'b');
  assert.deepEqual(hashes(t), ['#/herdr/w1:p1', '#/runs/81/out/2', '#/deploy']);   // 보던 탭은 그대로
  assert.equal(navigate(t, '#/runs/81/out/2'), t);
});

test('새 탭은 맨 뒤에, 이미 있으면 그 탭으로 · 최근 닫은 탭에서 빠진다', () => {
  const s = open({ ...three(), closed: ['#/herdr/w1:p9'] }, '#/herdr/w1:p9');
  assert.deepEqual(hashes(s).at(-1), '#/herdr/w1:p9');
  assert.equal(s.active, s.list[3].id);
  assert.deepEqual(s.closed, []);
  const t = open(three(), '#/deploy');
  assert.equal(t.active, 'c');
  assert.equal(t.list.length, 3);
});

test('닫기 — 보던 탭이면 오른쪽(끝이면 왼쪽) 탭으로, 마지막 하나는 남긴다, 최근 닫은 탭 맨 앞에', () => {
  const s = close(three(), 'a');
  assert.equal(s.active, 'b');
  assert.deepEqual(s.closed, ['#/herdr/w1:p1']);
  assert.equal(close({ ...three(), active: 'c' }, 'c').active, 'b');
  assert.equal(close(three(), 'b').active, 'a');
  const one: Tabs = { list: [{ id: 'a', hash: '#/today' }], active: 'a', closed: [] };
  assert.equal(close(one, 'a'), one);
});

test('끌어 놓기 — 앞으로 · 뒤로 · 제자리', () => {
  assert.deepEqual(move(three(), 'c', 0).list.map(t => t.id), ['c', 'a', 'b']);
  assert.deepEqual(move(three(), 'a', 3).list.map(t => t.id), ['b', 'c', 'a']);
  assert.deepEqual(move(three(), 'a', 2).list.map(t => t.id), ['b', 'a', 'c']);
  const s = three();
  assert.equal(move(s, 'b', 2), s);
});

test('되살리기 — 망가진 저장은 새로, 주소창 주소가 우선, 주소가 없으면 보던 탭', () => {
  assert.deepEqual(hashes(restore('x', '#/today')), ['#/today']);
  assert.deepEqual(hashes(restore(null, '')), ['#/herdr']);
  assert.equal(restore({ ...three(), active: 'b' }, '').active, 'b');
  assert.equal(restore(three(), '#/deploy').active, 'c');
  const s = restore(three(), '#/workshop/eng');
  assert.equal(hashes(s).at(-1), '#/workshop/eng');
  assert.equal(s.active, s.list[3].id);
});
