import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byTurn, turnRank } from '../web/src/deployOrder.ts';

const ENVS = [{ name: 'dev' }, { name: 'stage' }, { name: 'prod' }];

test('안건 순서 — 차례 칸이 운영 · stage · dev · 로컬 순, 차례가 없으면 뒤, 같으면 목록 순', () => {
  const cards = {
    로컬: [{ act: true }],
    dev: [{}, { act: true, env: 'dev' }],
    없음: [{}, {}],
    운영: [{ env: 'dev' }, { act: true, env: 'prod' }],
    stage: [{ act: true, env: 'stage' }],
    로컬2: [{ act: true }],
    둘: [{ act: true }, { act: true, env: 'stage' }],   // 레포 둘 — 앞선 쪽(stage)으로
  } as const;
  const names = Object.keys(cards) as (keyof typeof cards)[];
  assert.deepEqual(byTurn(names, n => [...cards[n]], ENVS), ['운영', 'stage', '둘', 'dev', '로컬', '로컬2', '없음']);
  assert.equal(turnRank([], ENVS), 4);
});

test('같은 차례에서는 배포일을 정한 안건이 먼저 — 이른 날부터, 나머지는 목록 순', () => {
  const cards = { 날짜없음: undefined, 늦은날: '2026-11-05', 이른날: '2026-11-02', 날짜없음2: undefined } as const;
  const names = Object.keys(cards) as (keyof typeof cards)[];
  assert.deepEqual(byTurn(names, () => [{ act: true, env: 'stage' }], ENVS, n => cards[n]), ['이른날', '늦은날', '날짜없음', '날짜없음2']);
  // 차례가 앞서면 배포일이 없어도 먼저
  assert.deepEqual(byTurn(['dev날짜', '운영'], n => [{ act: true, env: n === '운영' ? 'prod' : 'dev' }], ENVS, n => n === 'dev날짜' ? '2026-11-01' : undefined), ['운영', 'dev날짜']);
});
