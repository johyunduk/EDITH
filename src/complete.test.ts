import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { commands, toCodex } from './complete.ts';

test('명령 목록을 모르는 에이전트(agy)는 Claude 명령을 추천하지 않는다', async () => {
  assert.deepEqual(await commands('agy', tmpdir()), []);
  assert.ok((await commands('claude', tmpdir())).some(e => e.name === '/clear'));
});

test('Claude 방식으로 쓴 글을 Codex 기호로 — /스킬→$스킬, 맨 앞 명령은 Codex 이름, 나머지는 그대로', () => {
  const skills = new Set(['adversarial-review', 'flow', 'caveman']);
  const cases: [string, string][] = [
    ['/adversarial-review 이 diff 봐줘', '$adversarial-review 이 diff 봐줘'],
    ['먼저 /flow 규칙대로 하고 /caveman 으로', '먼저 $flow 규칙대로 하고 $caveman 으로'],
    ['/clear', '/new'], ['/exit', '/quit'], ['/context', '/status'], ['/model', '/model'], ['/compact 요약', '/compact 요약'],
    ['@src/views/Job/Month.vue 읽어', '@src/views/Job/Month.vue 읽어'],
    ['경로 /Users/me/x 와 a/b', '경로 /Users/me/x 와 a/b'], ['/없는스킬 그대로', '/없는스킬 그대로'],
  ];
  for (const [a, b] of cases) assert.equal(toCodex(a, skills), b, a);
});
