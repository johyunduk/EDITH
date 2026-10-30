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
