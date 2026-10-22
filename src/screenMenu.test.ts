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
    question: 'Accessing workspace:\n\n/Users/me/EDITH\n\nQuick safety check: Is this a project you trust?\n\nSecurity guide',
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

test('미리 보기가 붙은 질문 — 오른쪽 상자는 커서 선택지의 미리 보기로, 질문 앞 막대(│)·Notes 줄·가로줄 밑 「Chat about this」는 빠진다', () => {
  const m = parseMenu([
    '──────────────────────────────', '←  ☐ 목록 모양  ☐ 작업 위치  ✔ Submit  →', '',
    '│ 사이드 목록을 어떤 모양으로 바꿀까요?', '',
    '  1. 트리 (추천)                  ┌──────────────────────────┐',
    '❯ 2. 한 줄 목록                   │ - 새 체인   + 새 엔진    │',
    '  3. 한 줄 + 쓰는 곳              │                          │',
    '                                  │ ▾ 엔진 8                 │',
    '                                  │    풀스택 개발     초안  │',
    '                                  └──────────────────────────┘', '',
    '                                  Notes: press n to add notes', '',
    '──────────────────────────────', '  Chat about this', '',
    'Enter to select · ↑/↓ to navigate · n to add notes · Tab to switch questions · Esc to cancel',
  ]);
  assert.equal(m?.question, '사이드 목록을 어떤 모양으로 바꿀까요?');
  assert.equal(m?.tabs, '☐ 목록 모양  ☐ 작업 위치  ✔ Submit');
  assert.deepEqual(m?.options, [{ n: 1, label: '트리 (추천)', desc: '' }, { n: 2, label: '한 줄 목록', desc: '' }, { n: 3, label: '한 줄 + 쓰는 곳', desc: '' }]);
  assert.deepEqual(m?.preview, { n: 2, text: '- 새 체인   + 새 엔진\n\n▾ 엔진 8\n   풀스택 개발     초안' });
});

test('미리 보기 없는 질문 — 상자로 읽지 않고, 가로줄 밑 번호 선택지(Chat about this)는 받되 설명은 붙이지 않는다', () => {
  const m = parseMenu([
    '고치는 건 어디서 할까요?', '', '❯ 1. 내가 직접 (추천)', '     이 세션이 고친다', '  2. 넘김', '     메시지로 보낸다', '  3. Type something.',
    '──────────────────────────────', '  4. Chat about this', '', 'Enter to select · Tab/Arrow keys to navigate · Esc to cancel',
  ]);
  assert.deepEqual(m?.options.map(o => [o.n, o.label, o.desc]), [[1, '내가 직접 (추천)', '이 세션이 고친다'], [2, '넘김', '메시지로 보낸다'], [3, 'Type something.', ''], [4, 'Chat about this', '']]);
  assert.equal(m?.preview, undefined);
});

test('긴 질문(커밋 지킴이) — 가로줄 아래 전부가 질문(머리 줄이 잘리지 않는다), 머리표는 tabs, 왼쪽 막대는 떼고 들여쓰기·단락은 둔다', () => {
  const m = parseMenu([
    '  ⎿  $ git commit -F msg.txt', '──────────────────────────────', ' ☐ git commit',
    '│ git commit 1건 — 실행할까?', '│', '│ gtest (main)', '│   제목: Add a and b', '│   파일 2개: a.txt, b.txt', '│',
    '│ 명령 원문(앞 400자):', '│ cd /tmp/gtest && git commit -F msg.txt && git log', '│ --oneline -1',
    '❯ 1. 실행', '  2. 막기', '  3. Type something.', '──────────────────────────────', '  4. Chat about this',
    'Enter to select · ↑/↓ to navigate · Esc to cancel',
  ]);
  assert.equal(m?.tabs, 'git commit');
  assert.equal(m?.question, 'git commit 1건 — 실행할까?\n\ngtest (main)\n  제목: Add a and b\n  파일 2개: a.txt, b.txt\n\n명령 원문(앞 400자):\ncd /tmp/gtest && git commit -F msg.txt && git log\n--oneline -1');
  assert.deepEqual(m?.options.map(o => o.label), ['실행', '막기', 'Type something.', 'Chat about this']);
});

test('wide — 한글·한자·전각·이모지는 두 칸, ASCII·▾·←·· 는 한 칸', async () => {
  const { wide } = await import('../web/src/screenMenu.ts');
  assert.deepEqual(['가', '힣', '漢', 'Ａ', '🙂'].map(wide), [true, true, true, true, true]);
  assert.deepEqual(['a', ' ', '▾', '←', '·', '─'].map(wide), [false, false, false, false, false, false]);
});
