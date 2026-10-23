import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainView, claudeChip, columns, dropShared, merge, notionUrl, phases, short, statusOf } from '../web/src/runFlow.ts';
import type { FlowStep } from '../web/src/stepFlow.ts';

// 맨 위: 엔진 i(체인 a · b) → 체인 p → be 갈래(체인 d → e) · fe 갈래(체인 f) → 체인 j. p 에 고치는 노드 x.
const E = (name: string) => ({ name, kind: 'engine' as const }), C = (name: string) => ({ name, kind: 'chain' as const });
const st = (key: string, boxes: FlowStep['boxes'], more: Partial<FlowStep> = {}): FlowStep =>
  ({ key, title: key, lane: boxes?.at(-1)?.name ?? '', group: key.slice(0, key.lastIndexOf('.') + 1), kind: 'skill', deps: [], boxes, ...more });
const STEPS = [
  st('i.a.1', [E('기획'), C('받기')]), st('i.a.2', [E('기획'), C('받기')]), st('i.b.1', [E('기획'), C('검증')]),
  st('p.1', [C('계획')]), st('p.x', [C('계획')], { fixOnly: true }),
  st('d.1', [C('DB')], { track: 'be' }), st('e.1', [C('BE 구현')], { track: 'be' }), st('f.1', [C('FE')], { track: 'fe' }),
  st('j.1', [C('E2E')]),
];

test('런 흐름 큰 단계 — 맨 위 상자마다, 엔진 안은 체인별 소제목, 고치는 노드는 세지 않는다', () => {
  const ps = phases(STEPS);
  assert.deepEqual(ps.map(p => [p.id, p.name, p.kind, p.track ?? '', p.keys.length]),
    [['i', '기획', 'engine', '', 3], ['p', '계획', 'chain', '', 1], ['d', 'DB', 'chain', 'be', 1], ['e', 'BE 구현', 'chain', 'be', 1], ['f', 'FE', 'chain', 'fe', 1], ['j', 'E2E', 'chain', '', 1]]);
  assert.deepEqual(ps[0].groups.map(g => [g.name, g.keys.length]), [['받기', 2], ['검증', 1]]);
  assert.deepEqual(ps[1].groups, [{ name: '', keys: ['p.1', 'p.x'] }]);
});

test('런 흐름 칸 — 이어진 갈래 단계는 갈래마다 줄 하나로 묶고, 갈래 없는 단계는 상자 하나', () => {
  const cols = columns(phases(STEPS));
  assert.deepEqual(cols.map(c => c.kind === 'box' ? c.phase.id : c.rows.map(r => `${r.track}:${r.phases.map(p => p.id).join('>')}`).join(' | ')),
    ['i', 'p', 'be:d>e | fe:f', 'j']);
});

test('런 흐름 상태 — 하나라도 돌면 live, 다 끝(건너뜀 포함)이면 done, 몇은 끝이면 part', () => {
  assert.equal(statusOf(['done', 'running', 'wait']), 'live');
  assert.equal(statusOf(['done', 'skipped']), 'done');
  assert.equal(statusOf(['done', 'wait']), 'part');
  assert.equal(statusOf(['wait']), 'wait');
  assert.equal(merge(['done', 'wait']), 'part');
  assert.equal(merge(['done', 'live']), 'live');
});

test('타임라인 체인 — 지금 · 끝(끝난 차례) · 남음, 맨 위 노드는 혼자, 고치는 노드는 돌았을 때만', () => {
  const steps = [{ key: 'a.x', group: 'a.' }, { key: 'a.y', group: 'a.' }, { key: 'a.fx', group: 'a.', fixOnly: true }, { key: 'b.x', group: 'b.' },
    { key: 's.x', group: 's.' }, { key: 'p.x', group: 'p.' }, { key: 'p.y', group: 'p.' }, { key: 'c.x', group: 'c.' }, { key: 'end', group: '' }];
  const st: Record<string, [string, number]> = { 'a.x': ['done', 1], 'a.y': ['done', 1], 'a.fx': ['wait', 0], 'b.x': ['running', 1], 's.x': ['skipped', 0],
    'p.x': ['done', 1], 'p.y': ['wait', 0], 'c.x': ['wait', 0], end: ['wait', 0] };
  const node = (k: string) => ({ state: st[k][0], attempt: st[k][1] }), at = (k: string) => ({ 'a.y': 20, 's.x': 10 } as Record<string, number>)[k] ?? 0;
  const v = chainView(steps, node, at, ['b.x'], false);
  assert.deepEqual([v.now, v.done, v.ahead], [['b.', 'p.'], ['s.', 'a.'], ['c.', 'end']]);   // p 는 시작했고 덜 끝나 지금, 끝은 끝난 차례(s 가 먼저)
  assert.deepEqual([v.keys('a.'), v.of('end')], [['a.x', 'a.y'], 'end']);
  st['a.fx'] = ['running', 1];
  assert.deepEqual(chainView(steps, node, at, ['a.fx'], false).now, ['a.', 'b.', 'p.']);   // 고치는 노드가 돌면 그 체인이 다시 지금
  assert.deepEqual(chainView(steps, node, at, [], true).ahead, []);   // 끝난 런은 남은 체인을 보이지 않는다
});

test('사람용 한 줄 — 요약의 첫 문장(「—」 앞)만, 길면 자른다', () => {
  assert.equal(short('기능 카드 2장을 만들었다. 사용자당 1건 덮어쓰기.\n둘째 줄'), '기능 카드 2장을 만들었다');
  assert.equal(short('Codex 리뷰 2왕복 — 지적 6건 모두 반영'), 'Codex 리뷰 2왕복');
  assert.equal(short('가'.repeat(100), 10), `${'가'.repeat(9)}…`);
  assert.equal(short(''), undefined);
});

test('Claude 설정 칩 — 모델 · 강도 · 누가 정했는지(이유 첫 낱말), 설정 없으면 기본', () => {
  assert.equal(claudeChip({ model: 'opus', effort: 'xhigh', why: '판단자 deep — 확신 0.51' }), 'Opus · xhigh · 판단자');
  assert.equal(claudeChip({ model: 'claude-sonnet-5-5', effort: 'medium' }), 'Sonnet · medium');
  assert.equal(claudeChip({}), '기본');
  assert.equal(claudeChip(null), undefined);
});

test('같은 낱말로 시작하는 이름 — 모두 같을 때만 뗀다', () => {
  assert.deepEqual(['우리 기획', '우리 BE 계획'].map(dropShared(['우리 기획', '우리 BE 계획'])), ['기획', 'BE 계획']);
  assert.deepEqual(['우리 기획', '테스트'].map(dropShared(['우리 기획', '테스트'])), ['우리 기획', '테스트']);
  assert.equal(dropShared(['우리', '우리 기획'])('우리 기획'), '우리 기획');   // 떼면 빈 이름이 되는 것이 있으면 그대로
  assert.equal(dropShared(['우리 기획'])('우리 기획'), '우리 기획');   // 하나뿐이면 그대로
});

test('런 입력의 노션 주소 — 첫 것만, 둘레 괄호 · 낫표 · 끝 문장부호 빼고', () => {
  assert.equal(notionUrl('https://www.notion.so/team/0123456789abcdef0123456789abcdef\n브랜치: x'), 'https://www.notion.so/team/0123456789abcdef0123456789abcdef');
  assert.equal(notionUrl('기획은 「https://acme.notion.site/Plan-abc?pvs=4」 참고.'), 'https://acme.notion.site/Plan-abc?pvs=4');
  assert.equal(notionUrl('이슈(https://notion.so/p/123), 그리고 https://notion.so/p/456.'), 'https://notion.so/p/123');
  assert.equal(notionUrl('https://github.com/a/b 와 notion.so 라는 말'), undefined);
});
