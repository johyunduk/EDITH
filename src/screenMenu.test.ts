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
