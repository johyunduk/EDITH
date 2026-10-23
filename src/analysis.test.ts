import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codexUsage, flow, lanes, phaseTimes, redo, timings, toolLabel, tokensIn, type Ev } from './analysis.ts';

test('런 분석 시간 — 도는 중은 일한 시간, 답 기다림 · 확인 필요는 사람 대기, 끝나면 멈춘다', () => {
  const ev = (t: number, key: string, state: Ev['state']): Ev => ({ t, key, state, attempt: 1 });
  const t = timings([ev(0, 'a', 'wait'), ev(10, 'a', 'sending'), ev(12, 'a', 'running'), ev(50, 'a', 'blocked'), ev(80, 'a', 'running'), ev(100, 'a', 'done'),
    ev(100, 'b', 'running'), ev(130, 'b', 'check')], 200);
  assert.deepEqual(t.a, { work: 60, human: 30, stop: 0, first: 10, last: 100 });
  assert.deepEqual(t.b, { work: 30, human: 70, stop: 0, first: 100 });   // 아직 확인 필요 — 지금(end)까지
});

test('런 분석 토큰 — EDITH 가 보낸 글 뒤의 답을 그 노드에, 같은 message.id 는 한 번', () => {
  const user = (text: string) => JSON.stringify({ type: 'user', message: { content: text } });
  const said = (id: string, out: number) => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 2, output_tokens: out, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 } } });
  const into = {};
  tokensIn([said('m0', 999),
    user('[EDITH 런 #3 · 백엔드 › 「구현」]\n결과 파일: /r/3/nodes/n2.n3/1/result.json — 끝나면'), said('m1', 40), said('m1', 40), said('m2', 5),
    user('결과 파일을 아직 쓰지 않았다'), said('m3', 1),
    user('\n\n<pasted_content id="e6cb">\n[EDITH 런 #3 · 백엔드 › 「검증」]\n결과 파일: /r/3/nodes/n2.n4/1/result.json'), said('m5', 9),
    user('[EDITH 런 #9 · x]\n결과 파일: /r/9/nodes/q/1/result.json'), said('m4', 7)], 3, into);
  assert.deepEqual(into, { 'n2.n3': { input: 6, output: 46, cacheRead: 300, cacheWrite: 30, models: ['claude-opus-5-5'] },
    'n2.n4': { input: 2, output: 9, cacheRead: 100, cacheWrite: 10, models: ['claude-opus-5-5'] } });   // 붙여넣기로 감싸인 글도
});

test('런 분석 흐름 — 벽시계로 일 · 사람 · 빈 시간을 나누고(겹친 갈래는 한 번), 사람 · 빈 구간을 긴 것부터', () => {
  const ev = (t: number, key: string, state: Ev['state']): Ev => ({ t: t * 60_000, key, state, attempt: 1 });
  const f = flow([ev(0, 'a', 'running'), ev(0, 'b', 'running'), ev(5, 'a', 'done'), ev(10, 'b', 'blocked'), ev(14, 'b', 'running'), ev(15, 'b', 'done'), ev(17, 'c', 'running'), ev(20, 'c', 'done')], 0, 20 * 60_000);
  assert.deepEqual([f.work, f.human, f.idle].map(x => x / 60_000), [14, 4, 2]);
  assert.deepEqual(f.spans.map(s => [s.kind, s.from / 60_000, s.to / 60_000, s.keys]), [['human', 10, 14, ['b']], ['idle', 15, 17, []]]);
});

test('런 분석 갈래 — 갈래마다 끝 시각, 합치는 노드가 시작할 때까지 먼저 끝난 갈래가 기다린 시간', () => {
  const steps = [{ key: 'p', deps: [] }, { key: 'b1', track: 'be', deps: ['p'] }, { key: 'f1', track: 'fe', deps: ['p'] }, { key: 'j', deps: ['b1', 'f1'] }];
  const time = { p: { work: 1, human: 0, first: 0, last: 1 }, b1: { work: 4, human: 0, first: 1, last: 5 }, f1: { work: 9, human: 0, first: 1, last: 10 }, j: { work: 1, human: 0, first: 10, last: 11 } };
  assert.deepEqual(lanes(steps, [], time).map(l => [l.track, l.last, l.waited]), [['be', 5, 5], ['fe', 10, 0]]);
});

test('런 분석 도구 이름 — 스크립트 이름, 없으면 변수 · cd 를 건너뛴 첫 명령, 질문 창은 사람', () => {
  assert.equal(toolLabel('Bash', { command: 'W=/x/work; cd /y && node "$W/bin/codex-review.ts" --x' }), 'Bash codex-review.ts');
  assert.equal(toolLabel('Bash', { command: 'cd /repo && npm run build' }), 'Bash npm');
  assert.equal(toolLabel('AskUserQuestion', {}), '질문 창(사람)');
  assert.equal(toolLabel('mcp__playwright__browser_click', {}), 'MCP browser_click');
});

test('런 분석 다시 돈 시간 · Codex · 단계 시간 — 두 번째 이후 시도와 고치는 노드, usage 줄 합, 큰 단계 처음~끝', () => {
  const ev = (t: number, key: string, state: Ev['state'], attempt: number): Ev => ({ t: t * 60_000, key, state, attempt });
  const evs = [ev(0, 'a.x', 'running', 1), ev(3, 'a.x', 'wait', 1), ev(3, 'fix', 'running', 1), ev(5, 'fix', 'done', 1), ev(5, 'a.x', 'running', 2), ev(9, 'a.x', 'done', 2), ev(9, 'b', 'running', 1), ev(10, 'b', 'done', 1)];
  const steps = [{ key: 'a.x', title: 'X', boxes: [{ name: '단계 A' }] }, { key: 'fix', title: '고치기', fixOnly: true, boxes: [{ name: '단계 A' }] }, { key: 'b', title: 'B' }];
  assert.deepEqual(Object.values(redo(steps, evs)).map(x => x / 60_000), [4, 2]);
  assert.deepEqual(phaseTimes(steps, evs).map(p => [p.name, p.ms / 60_000]), [['단계 A', 9], ['B', 1]]);
  const u = codexUsage([{ kind: 'usage', node: 'a.x', codex: { in: 10, out: 5 }, weekly: 41 }, { kind: 'stage' }, { kind: 'usage', node: 'a.x', codex: { out: 7, cacheR: 100 }, weekly: 44 }]);
  assert.deepEqual([u.nodes['a.x'], u.weekly], [{ in: 10, out: 12, cacheR: 100 }, [41, 44]]);
});
