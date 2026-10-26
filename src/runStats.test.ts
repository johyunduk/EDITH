import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byPhase, highlights, type StatNode, type Stats } from '../web/src/runStats.ts';

const M = 60_000;
const node = (key: string, phase: string, work: number, more: Partial<StatNode> = {}): StatNode => ({
  key, title: key, place: phase, phase, kind: 'skill', fixOnly: false, state: 'done', attempts: work ? 1 : 0, fails: 0, rewound: 0,
  time: { work, human: 0, stop: 0 }, tokens: null, claude: null, inside: null, ...more,
});
const stats = (nodes: StatNode[], more: Partial<Stats> = {}): Stats => ({
  id: 1, elapsed: 100 * M, timed: true, rewinds: [], records: [], nodes, flow: { work: 90 * M, human: 0, stop: 0, idle: 10 * M, spans: [] },
  phases: [{ name: '기획', ms: 40 * M }, { name: '구현', ms: 50 * M }, { name: '마무리', ms: 30_000 }], lanes: [], redo: { again: 0, fixing: 0 },
  codex: { nodes: {}, weekly: null }, compare: [], ...more,
});

test('먼저 볼 것 — 오래 걸린 단계 · 노드, 없으면 「없음」 줄', () => {
  const a = stats([node('a', '기획', 30 * M, { inside: { first: 0, last: 1, busy: 0, tools: { 'Bash x.ts': 5 * M, '질문 창(사람)': 9 * M, Read: 10_000 } } }),
    node('b', '구현', 45 * M), node('c', '구현', 30_000), node('fix', '구현', 2 * M, { fixOnly: true, attempts: 2, fails: 1 })]);
  const h = Object.fromEntries(highlights(a).map(r => [r.label, r]));
  assert.deepEqual(h['오래 걸린 단계'].items.map(x => x.text), ['구현', '기획']);   // 1분 안 되는 마무리는 뺀다
  assert.equal(h['오래 걸린 단계'].items[0].sub, '50분 0초 · 런의 50%');
  assert.deepEqual(h['오래 걸린 노드'].items.map(x => x.key), ['b', 'a', 'fix']);
  assert.match(h['오래 걸린 노드'].items[1].sub!, /가장 긴 도구 Bash x\.ts 5분 0초$/);   // 질문 창은 도구로 안 센다
  assert.deepEqual([h['사람 대기'].items, h['사람 대기'].none], [[], '없음 — 사람을 기다린 시간 없이 돌았다']);
  assert.deepEqual(h['다시 돈 노드'].items.map(x => [x.key, x.sub]), [['fix', '시도 2 · 고침 1']]);
  assert.equal(h['병목 갈래'], undefined);
});

test('먼저 볼 것 — 사람 대기 구간 · 병목 갈래', () => {
  const a = stats([node('a', '기획', 2 * M), node('b', '구현', 2 * M)], {
    flow: { work: 4 * M, human: 7 * M, stop: 0, idle: 0, spans: [{ from: 0, to: 7 * M, kind: 'human', keys: ['b'] }, { from: 0, to: 3 * M, kind: 'idle', keys: [] }] },
    lanes: [{ track: 'be', first: 0, last: 10, work: 1, human: 0, waited: 5 * M, join: 'j' }, { track: 'fe', first: 0, last: 20, work: 1, human: 0, waited: 0, join: 'j' }],
  });
  const h = Object.fromEntries(highlights(a).map(r => [r.label, r]));
  assert.deepEqual(h['사람 대기'].items, [{ text: 'b', sub: '7분 0초', key: 'b' }]);
  assert.deepEqual(h['병목 갈래'].items, [{ text: 'fe 갈래가 늦게 끝났다', sub: 'be 가 합침 앞에서 5분 0초 기다림' }]);
  assert.equal(highlights(a, n => n.slice(1))[0].items[0].text, '현');   // 단계 이름은 화면이 뗀 이름으로
});

test('단계별 — 런 차례대로 묶고, 안 돈 고치는 노드는 뺀다', () => {
  const a = stats([node('a', '기획', M), node('b', '구현', M), node('x', '구현', 0, { fixOnly: true }), node('c', '정리', 0, { state: 'skipped' })]);
  assert.deepEqual(byPhase(a).map(p => [p.name, p.ms, p.nodes.map(x => x.key)]), [['기획', 40 * M, ['a']], ['구현', 50 * M, ['b']], ['정리', 0, ['c']]]);
});

test('옛 서버 답 — phase · phases 없이 자리 첫 상자와 비교 표로', () => {
  const a = stats([node('a', '기획', M, { phase: undefined, place: '기획 › 받기' })], { phases: undefined, compare: [{ id: 1, state: 'done', created: 0, elapsed: 0, human: 0, phases: [{ name: '기획', ms: 3 * M }] }] });
  assert.deepEqual(byPhase(a).map(p => [p.name, p.ms]), [['기획', 3 * M]]);
});

test('먼저 볼 것 — 헛도는 검사(코드 그대로 다시 돈 노드), 없으면 줄 없음', () => {
  const a = stats([node('v', '구현', 5 * M, { title: 'BE 검증', attempts: 4, fails: 3 })], { sameCode: [{ key: 'v', attempts: 4, same: 1, lost: 12 * M, passed: true }] });
  const h = Object.fromEntries(highlights(a).map(r => [r.label, r]));
  assert.deepEqual(h['헛도는 검사'].items, [{ text: 'BE 검증', key: 'v', sub: '코드 그대로 1번 다시 · 12분 0초 · 코드를 안 고쳤는데 통과 — 거짓 경보 의심' }]);
  assert.equal(Object.fromEntries(highlights(stats([])).map(r => [r.label, r]))['헛도는 검사'], undefined);
});

test('먼저 볼 것 — 평소보다 느림(지난 런 중앙값의 2배 넘게, 1분 넘게 일한 노드), 없으면 줄 없음', () => {
  const medians = { slow: { ms: 2 * M, n: 5 }, fine: { ms: 2 * M, n: 5 }, tiny: { ms: 10_000, n: 5 } };
  const a = stats([node('slow', '구현', 5 * M), node('fine', '구현', 3 * M), node('tiny', '구현', 70_000), node('new', '구현', 9 * M)], { across: { runs: 6, medians, flaky: [], repo: null } });
  const h = Object.fromEntries(highlights(a).map(r => [r.label, r]));
  assert.deepEqual(h['평소보다 느림'].items, [{ text: 'slow', key: 'slow', sub: '5분 0초 — 보통 2분 0초(지난 5런)' }]);   // 보통 30초 안 되는 노드 · 보통이 없는 노드는 뺀다
  assert.equal(Object.fromEntries(highlights(stats([node('slow', '구현', 5 * M)])).map(r => [r.label, r]))['평소보다 느림'], undefined);
});
