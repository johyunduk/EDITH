import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayOf, due, nextAt } from './schedule.ts';

const at = (s: string) => new Date(s);   // 시각대 표기 없는 ISO — 이 기기 시각대
const none = () => false;
const weekday = { at: '08:40', days: 'mon-fri' as const };

test('돌릴지 — 평일 · 시각이 지남 · 오늘 안 잡힘일 때만', () => {
  assert.equal(due(weekday, at('2026-11-04T08:40:00'), none), true);    // 수 08:40 — 그 분부터
  assert.equal(due(weekday, at('2026-11-04T08:39:59'), none), false);   // 아직
  assert.equal(due(weekday, at('2026-11-04T15:00:00'), none), true);    // 서버가 꺼져 있다 켜짐 — 그날 놓친 것은 돈다
  assert.equal(due(weekday, at('2026-11-04T15:00:00'), d => d === '2026-11-04'), false);   // 오늘 이미 잡힘
  assert.equal(due(weekday, at('2026-11-04T15:00:00'), d => d === '2026-11-03'), true);    // 어제 잡힌 것은 상관없음
  assert.equal(due(weekday, at('2026-11-07T09:00:00'), none), false);   // 토
  assert.equal(due({ at: '08:40', days: 'daily' }, at('2026-11-08T09:00:00'), none), true);   // 매일이면 일요일도
});

test('다음 실행 — 오늘 몫이 남았으면 오늘, 아니면 다음 그 요일', () => {
  assert.equal(nextAt(weekday, at('2026-11-04T07:00:00'), none), at('2026-11-04T08:40:00').getTime());
  assert.equal(nextAt(weekday, at('2026-11-04T09:00:00'), d => d === '2026-11-04'), at('2026-11-05T08:40:00').getTime());
  assert.equal(nextAt(weekday, at('2026-11-06T09:00:00'), d => d === '2026-11-06'), at('2026-11-09T08:40:00').getTime());   // 금 → 월
  assert.equal(nextAt(weekday, at('2026-11-07T09:00:00'), none), at('2026-11-09T08:40:00').getTime());   // 토 → 월
  assert.equal(dayOf(at('2026-01-05T23:59:00')), '2026-01-05');
});
