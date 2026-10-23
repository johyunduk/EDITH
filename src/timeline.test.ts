import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Ev } from './analysis.ts';
import type { Run, Step } from './runner.ts';
import { lastLine, timeline, tries } from './timeline.ts';

// 맨 위 체인 P1(명령 a → 명령 b → 스킬 c) · P2(스킬 x · 스킬 d). c 는 1번째 시도가 확인 필요(사람 답 10초 포함), 「이어서」 뒤 2번째에 끝.
const P1 = [{ name: 'P1', kind: 'chain' as const }], P2 = [{ name: 'P2', kind: 'chain' as const }];
const st = (key: string, kind: Step['kind'], boxes: Step['boxes']): Step => ({ key, title: key.toUpperCase(), lane: boxes![0].name, group: `${key}.`, kind, engine: 'e', deps: [], boxes });
const steps = [st('a', 'command', P1), st('b', 'command', P1), st('c', 'skill', P1), st('x', 'skill', P2), st('d', 'skill', P2)];
const ev = (t: number, key: string, state: Ev['state'], attempt: number): Ev => ({ t, key, state, attempt });
const EVENTS = [
  ...steps.map(s => ev(0, s.key, 'wait', 0)),
  ev(10, 'a', 'running', 1), ev(12, 'a', 'done', 1), ev(12, 'b', 'running', 1), ev(13, 'b', 'done', 1),
  ev(13, 'c', 'sending', 1), ev(15, 'c', 'running', 1), ev(20, 'c', 'blocked', 1), ev(30, 'c', 'running', 1), ev(40, 'c', 'check', 1),
  ev(41, 'c', 'check', 1),   // EDITH 를 다시 켜 같은 상태를 또 적음
  ev(50, 'c', 'wait', 1), ev(51, 'c', 'sending', 2), ev(60, 'c', 'done', 2), ev(60, 'x', 'skipped', 0), ev(61, 'd', 'sending', 1),
];
const run = {
  steps, rewinds: [{ at: 55, to: 'c', name: 'C', by: '사람', reason: '다시' }],
  nodes: { a: { state: 'done', attempt: 1 }, b: { state: 'done', attempt: 1 }, c: { state: 'done', attempt: 2 }, x: { state: 'skipped', attempt: 0, reason: '건너뜀' }, d: { state: 'sending', attempt: 1 } },
} as unknown as Run;

test('타임라인 시도 — 상태 기록을 시도마다 묶고 일한 · 사람 시간을 더한다, 다시 켜 또 적은 줄은 뺀다', () => {
  assert.deepEqual(tries(EVENTS).map(x => [x.key, x.attempt, x.start, x.end, x.how, x.work, x.human]), [
    ['a', 1, 10, 12, 'done', 2, 0], ['b', 1, 12, 13, 'done', 1, 0], ['c', 1, 13, 40, 'check', 17, 10],
    ['c', 2, 51, 60, 'done', 9, 0], ['x', 0, 60, 60, 'skipped', 0, 0], ['d', 1, 61, undefined, undefined, 0, 0],
  ]);
});

test('타임라인 — 일어난 차례대로, 이어진 통과는 한 줄, 체인에 처음 든 때 가름줄, 되돌림 줄, 시도마다 결과', () => {
  const got = (k: string, a: number) => k === 'c' ? { summary: a === 1 ? '막힘 — 규칙 파일 없음' : '원문을 옮겼다' } : { out: `${k} 출력` };
  const l = timeline(run, EVENTS, got);
  assert.deepEqual(l.map(e => [e.kind, e.titles.join(' · '), e.tone ?? '']), [
    ['phase', 'P1', ''], ['pass', 'A · B', ''], ['node', 'C', 'warn'], ['node', 'C', 'done'], ['rewind', 'C', ''], ['phase', 'P2', ''], ['skip', 'X', ''], ['node', 'D', 'now'],
  ]);
  assert.equal(l[7].state, 'sending');
  assert.deepEqual([l[3].text, l[2].text, l[2].human], ['원문을 옮겼다', '막힘 — 규칙 파일 없음', 10]);
  assert.deepEqual([l[1].keys, l[1].text], [['a', 'b'], undefined]);   // 여럿이면 출력 줄은 뺀다
  assert.equal(l[6].text, '건너뜀');
});

test('명령 출력 마지막 말 줄', () => {
  assert.equal(lastLine('끝났다\n  다음 노드 x  \n}\n'), '다음 노드 x');
  assert.equal(lastLine('}\n'), undefined);
});
