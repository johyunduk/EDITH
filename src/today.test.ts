import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiInput, carry, dayOf, humanAsks, parseAi, span, type Work } from './today.ts';

const line = (display: string, t: number, pasted?: string) =>
  JSON.stringify({ display, timestamp: t, project: '/w', ...(pasted ? { pastedContents: { 1: { id: 1, type: 'text', content: pasted } } } : {}) });

test('내가 친 말만 — 런 지시 · 재촉 · 인자 없는 / 명령 · 깨진 줄은 뺀다', () => {
  const t = Date.UTC(2026, 9, 23, 3);
  const asks = humanAsks([
    line('/clear', t),
    line('[Pasted text #1 +12 lines]', t, '[EDITH 런 #2 · 개발 FE 계획 › 「FE 계획」]\n갈래: fe'),
    line('결과 파일(/x/result.json)을 아직 쓰지 않았다.', t),
    line('사용량 한도가 풀렸다. 하던 일을 이어서 하고', t),
    '깨짐',
    line('[Pasted text #1 +3 lines]', t, '에러 로그 붙임'),
    JSON.stringify({ display: '[Pasted text #2 +12 lines]', timestamp: t, project: '/w', pastedContents: { 2: { id: 2, type: 'text', contentHash: 'abc123' } } }),
    line('/tree https://example.com/spec', t),
    line('커밋하고 푸시해줘', t),
  ].join('\n'), hash => hash === 'abc123' ? '[EDITH 런 #3 · 개발 BE › 「BE 구현」]' : '');
  assert.deepEqual(asks.map(a => a.text), ['[Pasted text #1 +3 lines]', '/tree https://example.com/spec', '커밋하고 푸시해줘']);
});

test('볼 범위 — 마지막으로 일한 평일부터, 월요일이면 주말까지 묶는다', () => {
  const at = (d: string) => ({ t: new Date(`${d}T10:00`).getTime(), dir: '/w', text: 'x' });
  assert.equal(dayOf(new Date('2026-10-23T23:59').getTime()), '2026-10-23');
  // 월 10/26 — 금 · 토에 일했으면 금부터(마지막은 토)
  assert.deepEqual(span([at('2026-10-22'), at('2026-10-23'), at('2026-10-24'), at('2026-10-26')], '2026-10-26'), { from: '2026-10-23', last: '2026-10-24' });
  // 화 — 어제(월) 일했으면 월 하루
  assert.deepEqual(span([at('2026-10-23'), at('2026-10-26')], '2026-10-27'), { from: '2026-10-26', last: '2026-10-26' });
  // 월요일이 쉰 날이면 금부터
  assert.deepEqual(span([at('2026-10-23')], '2026-10-27'), { from: '2026-10-23', last: '2026-10-23' });
  // 주말에만 일했으면 마지막 날
  assert.deepEqual(span([at('2026-10-25')], '2026-10-26'), { from: '2026-10-25', last: '2026-10-25' });
  assert.equal(span([at('2026-10-26')], '2026-10-26'), null);
});

test('AI 답 읽기 — 작업 번호를 경로로, 모르는 번호 · 글 아닌 것은 버리고 할 일은 5개까지', () => {
  const works: Work[] = [{ name: 'EDITH', path: '/e', asks: 2, commits: [], line: '' }, { name: 'api', path: '/a', asks: 1, commits: [], line: '' }];
  const got = parseAi({
    did: { w1: ' 오늘 화면 추가 ', w2: 3, w9: '없는 작업', x: '틀린 키' },
    todos: [{ work: 'w2', text: '배포 확인' }, { work: 'w7', text: '작업 모름' }, { text: '' }, 'x', ...Array(6).fill({ work: 'w1', text: '더' })],
  }, works);
  assert.deepEqual(got.did, { '/e': '오늘 화면 추가' });
  assert.deepEqual(got.todos.slice(0, 2), [{ path: '/a', text: '배포 확인' }, { path: '', text: '작업 모름' }]);
  assert.equal(got.todos.length, 5);
  assert.deepEqual(parseAi({}, works), { did: {}, todos: [] });
});

test('AI 에 넘길 글 — 작업마다 w 번호 · 커밋 · 내 말(붙여넣기 내용까지, 300자)', () => {
  const works: Work[] = [{ name: 'EDITH', path: '/e', branch: 'main', asks: 1, commits: [{ id: 'a1', msg: 'Add today' }], line: '' }];
  const input = aiInput(works, new Map([['/e', [{ t: 0, dir: '/e', text: '[Pasted text #1 +3 lines]', pasted: '에러\n로그' }, { t: 1, dir: '/e', text: 'x'.repeat(400) }]]]));
  assert.match(input, /^## w1 · EDITH \(main\)\n커밋: Add today\n말: \[Pasted text #1 \+3 lines\] 에러 로그\n말: x{300}…\n/);
});

test('할 일 이어 받기 — 안 끝낸 직접 · 이어 온 것 · AI 하다 만 일을 처음 생긴 날 그대로, 끝낸 것 · 같은 글은 빼고', () => {
  const prev = {
    date: '2026-10-23',
    items: [{ id: 'x1', text: '배포 확인', since: '2026-10-20' }, { id: 'x2', text: '끝낸 일', since: '2026-10-23' }],
    checks: ['x2', 'ai:문서 고치기', 'pane:p1'],
  };
  const ai = { todos: [{ path: '/e', text: '문서 고치기' }, { path: '/e', text: '워크트리 정리' }, { path: '', text: '배포 확인' }] };
  assert.deepEqual(carry(prev, ai, '2026-10-26'), {
    date: '2026-10-26', checks: [],
    items: [{ id: 'x1', text: '배포 확인', since: '2026-10-20' }, { id: 'ai:워크트리 정리', text: '워크트리 정리', since: '2026-10-23' }],
  });
  assert.deepEqual(carry({ date: '2026-10-23', items: [], checks: [] }, null, '2026-10-26').items, []);
});
