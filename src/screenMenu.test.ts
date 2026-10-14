import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMenu } from '../web/src/screenMenu.ts';

test('번호 메뉴 — 번호·설명 줄·질문, 커서는 없다', () => {
  const m = parseMenu([
    '──────────', ' 어느 색?', '', ' ❯ 1. 빨강', '     따뜻한 색', '   2. 파랑', '   3. Type something', '', ' Enter to select · ↑/↓ to navigate',
  ]);
  assert.deepEqual(m, {
    question: '어느 색?',
    options: [{ n: 1, label: '빨강', desc: '따뜻한 색' }, { n: 2, label: '파랑', desc: '' }, { n: 3, label: 'Type something', desc: '' }],
  });
});

test('커서 메뉴 — 번호 없는 ❯ 메뉴(폴더 신뢰)는 지금 커서 자리와 함께, 안내 줄이 없으면 메뉴가 아니다', () => {
  const screen = [
    '────────────', ' Accessing workspace:', '', ' /Users/me/EDITH', '', ' Quick safety check: Is this a project you trust?', '', ' Security guide', '',
    ' ❯ No, exit', '   Yes, I trust this folder', '', ' Enter to confirm · Esc to cancel',
  ];
  assert.deepEqual(parseMenu(screen), {
    question: 'Accessing workspace:\n/Users/me/EDITH\nQuick safety check: Is this a project you trust?\nSecurity guide',
    options: [{ n: 1, label: 'No, exit', desc: '' }, { n: 2, label: 'Yes, I trust this folder', desc: '' }], cursor: 0,
  });
  assert.equal(parseMenu(screen.slice(0, -1)), null);
});

test('커서 메뉴 — 커서가 가운데여도 위아래 선택지를 모으고, 더 들여 쓴 줄은 설명', () => {
  const m = parseMenu([' 모델', '   Opus', '     가장 똑똑함', ' ❯ Sonnet', '   Haiku', '', ' Enter to confirm']);
  assert.deepEqual(m?.options.map(o => [o.label, o.desc]), [['Opus', '가장 똑똑함'], ['Sonnet', ''], ['Haiku', '']]);
  assert.equal(m?.cursor, 1);
  assert.equal(m?.question, '모델');
});

test('Codex 폴더 신뢰 — 번호 메뉴로 읽히고, 1 을 눌러도 커서가 남아 있으면 확정 전(엔터가 더 필요), 여러 개 고르기는 아니다', async () => {
  const { stillPicked } = await import('../web/src/screenMenu.ts');
  const screen = ['  Folder access', '  /workspace/project', '', '  Trust this folder? Codex can read, edit, and run files here,', '',
    '› 1. Trust and continue', '  2. Quit', '', '  enter continue and create sandbox · esc quit'];
  const m = parseMenu(screen);
  assert.deepEqual(m?.options.map(o => [o.n, o.label]), [[1, 'Trust and continue'], [2, 'Quit']]);
  assert.ok(stillPicked(screen, 1));
  assert.ok(!stillPicked(screen, 2));
  assert.ok(!stillPicked(['› Ask Codex to do anything'], 1));
  assert.ok(!stillPicked(['❯ 1. [ ] 빨강', '  2. [ ] 파랑'], 1));
});

test('여러 개 고르기(Claude 질문) — 체크 상자는 checked 로, 「Next」 줄은 설명이 아니고, 맨 위 질문 줄은 tabs, 체크한 줄은 확정 전으로 보지 않는다', async () => {
  const { stillPicked } = await import('../web/src/screenMenu.ts');
  const screen = ['─────────', '←  ☒ 좋아하는 과일  ☐ 크기  ✔ Submit  →', '좋아하는 과일을 모두 골라 주세요.', '❯ 1. [✔] 사과', '         사과', '  2. [ ] 바나나',
    '  3. [✔] 포도', '  4. [ ] Type something', '     Next', '─────────', '  5. Chat about this', 'Enter to select · Tab/Arrow keys to navigate · Esc to cancel'];
  const m = parseMenu(screen);
  assert.equal(m?.multi, true);
  assert.equal(m?.tabs, '☒ 좋아하는 과일  ☐ 크기  ✔ Submit');
  assert.equal(m?.question, '좋아하는 과일을 모두 골라 주세요.');
  assert.deepEqual(m?.options.map(o => [o.n, o.label, o.checked ?? null, o.desc]),
    [[1, '사과', true, '사과'], [2, '바나나', false, ''], [3, '포도', true, ''], [4, 'Type something', false, ''], [5, 'Chat about this', null, '']]);
  assert.ok(!stillPicked(screen, 1));
});
