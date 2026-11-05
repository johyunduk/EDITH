import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardCard, mainPush, parseMenu } from '../web/src/screenMenu.ts';

test('번호 메뉴 — 번호·설명 줄·질문, 커서는 없다', () => {
  const m = parseMenu([
    '──────────', ' 어느 색?', '', ' ❯ 1. 빨강', '     따뜻한 색', '   2. 파랑', '   3. Type something', '', ' Enter to select · ↑/↓ to navigate',
  ]);
  assert.deepEqual(m, {
    question: '어느 색?',
    options: [{ n: 1, label: '빨강', desc: '따뜻한 색' }, { n: 2, label: '파랑', desc: '' }, { n: 3, label: 'Type something', desc: '' }],
  });
});

test('위 대화에 번호 제목(「1. …」·「2. …」)·표가 보여도 맨 아래 질문만 — 질문 글·설명이 빠지지 않는다', () => {
  const m = parseMenu([
    '⏺ 정할 것을 두 표로 나눴습니다.', '', '  1. 정해 주셔야 할 것', '', '  ┌────┬──────┐', '  │ 16 │ 가다 │', '  └────┴──────┘', '',
    '  2. 제가 직접 확인할 것', '', '  ┌───┬──────┐', '  │ A │ 단계 │', '  └───┴──────┘', '',
    '──────────────────────────────', ' ☐ 목표', '', '1/17 — 앱 이름은 어떻게 할까요?', '',
    '❯ 1. 같이 쓰다 대체 (Recommended)', '     검증될 때까지 둡니다.', '  2. 바로 대체', '     전부 옮깁니다.', '  3. Type something.',
    '──────────────────────────────', '  4. Chat about this', '', 'Enter to select · ↑/↓ to navigate · Esc to cancel',
  ]);
  assert.equal(m?.question, '1/17 — 앱 이름은 어떻게 할까요?');
  assert.equal(m?.tabs, '목표');
  assert.deepEqual(m?.options.map(o => [o.n, o.label, o.desc]),
    [[1, '같이 쓰다 대체 (Recommended)', '검증될 때까지 둡니다.'], [2, '바로 대체', '전부 옮깁니다.'], [3, 'Type something.', ''], [4, 'Chat about this', '']]);
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

test('미리 보기 상자가 어긋난 화면(Windows ConPTY 한글 폭) — 테두리가 없거나 조각이 질문 · 선택지 줄에 남아도 질문 · 선택지 글은 깨끗하다', () => {
  const m = parseMenu([
    '──────────────────────────────', '☐ 똥의 정체', '',
    "휴지통 세계에서 위로부터 떨어지는 '똥'은 무엇인가요?          │ 1 # lore 인계 — 2026-11-01", '                                                              │ 2', '',
    '❯ 1. 새로 버려지는 것들        ┌────────────────┐ │ 3 +> **2026-11-02 세계관 재시작 (대표 결정). 아래 「다음 할 일」은 멈췄',
    '  2. 청소 프로그램의 공격      │ 하늘에서 똥이 쏟아진다. │ │ +다.**',
    '  3. 진짜 똥 (아무도 모름) │ 아무도 안 열어 본 문서, 지운 사진, │ │ 4 +> - 확정은 둘만',
    '  4. 맞으면 기억을 잃는 것     │ 다 깨진 채로 떨어지면 꼭 똥처럼 생겼다.',
    '                               └────────────────┘', '',
    'Enter to select · ↑/↓ to navigate · Esc to cancel',
  ]);
  assert.equal(m?.question, "휴지통 세계에서 위로부터 떨어지는 '똥'은 무엇인가요?");
  assert.equal(m?.tabs, '똥의 정체');
  assert.deepEqual(m?.options.map(o => [o.n, o.label, o.desc]),
    [[1, '새로 버려지는 것들', ''], [2, '청소 프로그램의 공격', ''], [3, '진짜 똥 (아무도 모름)', ''], [4, '맞으면 기억을 잃는 것', '']]);
  assert.equal(m?.preview?.n, 1);
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

test('main 푸시 질문(커밋 지킴이) — 머리표 「⚠ main 푸시」 면 브랜치 · 원격 ref, 질문은 ⚠ 첫 줄을 뗀 것. 다른 질문 · 대화 속 같은 글은 아니다', () => {
  const lines = ['⏺ origin 원격의 main 브랜치로 푸시', '──────────────────────────────', ' ☐ ⚠ main 푸시', '',
    '│ ⚠ main 에 바로 올라간다 — origin/main', '│ 왜: origin 원격의 main 브랜치로 푸시', '│', '│ git push 1건 — 실행할까?', '│', '│ demo-app (main)', '│   git push origin main',
    '❯ 1. 실행 — main 에 푸시', '  2. 막기', '  3. Type something.', '──────────────────────────────', '  4. Chat about this', 'Enter to select · ↑/↓ to navigate · Esc to cancel'];
  assert.deepEqual(mainPush(parseMenu(lines)), { branch: 'main', ref: 'origin/main', question: '왜: origin 원격의 main 브랜치로 푸시\n\ngit push 1건 — 실행할까?\n\ndemo-app (main)\n  git push origin main' });
  assert.equal(mainPush(parseMenu(lines.map(l => l.replace(' ☐ ⚠ main 푸시', ' ☐ git push')))), null);
  assert.equal(mainPush(parseMenu(['⏺ 「☐ ⚠ main 푸시」 머리표를 단다', '────────', ' ☐ git commit', '│ git commit 1건 — 실행할까?', '❯ 1. 실행', '  2. 막기'])), null);
  assert.equal(mainPush(null), null);
});

test('커밋 지킴이 질문 카드 — 같은 레포의 커밋 · 푸시는 한 상자, 머지는 커밋 앞, 푸시도 보낼 커밋 제목, 접힌 줄은 앞 줄에, 명령 원문은 따로', () => {
  const q = ['왜: 쿠폰 수정을 커밋하고', '올린다', '', 'git commit 2건 · git push 1건 — 실행할까?', '',
    'shop-web · 워크트리 coupon', '  커밋할 브랜치: merge/coupon', '  머지 마무리: origin/dev → merge/coupon', '  제목: (못 읽었다)', '  파일 3개: a.ts,', 'b.ts, c.ts', '',
    'shop-web · 워크트리 coupon', '  push: merge/coupon → origin/dev', '  제목: (이 명령의 새 커밋)', '  git push origin merge/coupon:dev', '',
    '$X — 폴더를 못 읽었다: 경로의 변수를', '풀지 못했다', '  커밋할 브랜치: 모름', '  제목: x', '  commit -a — 추적 중인 바뀐 파일 전부', '',
    '명령 글에 git commit·push 가 1번 더 보인다 — 원문에서 확인', '', '명령 원문(앞 400자):', 'cd ~/w && git commit', '--no-edit'].join('\n');
  assert.deepEqual(guardCard(q), {
    why: '왜: 쿠폰 수정을 커밋하고 올린다',
    boxes: [
      { repo: 'shop-web', worktree: 'coupon', rows: [
        { op: 'merge', refs: ['origin/dev', 'merge/coupon'], notes: [] },
        { op: 'commit', refs: ['merge/coupon'], title: '(못 읽었다)', files: '파일 3개 · a.ts, b.ts, c.ts', notes: [] },
        { op: 'push', refs: ['merge/coupon', 'origin/dev'], title: '(이 명령의 새 커밋)', notes: ['git push origin merge/coupon:dev'] },
      ] },
      { repo: '$X — 폴더를 못 읽었다: 경로의 변수를 풀지 못했다', worktree: undefined, rows: [{ op: 'commit', refs: ['모름'], title: 'x', notes: ['commit -a — 추적 중인 바뀐 파일 전부'] }] },
    ],
    warn: ['명령 글에 git commit·push 가 1번 더 보인다 — 원문에서 확인'],
    raw: 'cd ~/w && git commit\n--no-edit',
  });
  // 설명을 못 푼 명령(「git push 실행할까?」) · 다른 질문은 글 그대로
  assert.equal(guardCard('왜: 올린다\n\ngit push 실행할까?\n\ngit push'), null);
  assert.equal(guardCard('어느 색?'), null);
});

test('Claude 승인 화면 — 첫 줄은 종류(tabs), 점선 사이는 block(줄 번호), Tip 줄은 빠진다', () => {
  const screen = [
    '⏺ 목록 보기', '────────────', ' Bash command', ' Tip: auto mode handles these prompts for you', ' 임시 폴더 목록 보기', '╌╌╌╌╌╌╌╌╌╌',
    ' │ ls -la /tmp | head -5', ' │ && echo done', '╌╌╌╌╌╌╌╌╌╌', ' Do you want to proceed?', ' ❯ 1. Yes', '   2. No', ' Esc to cancel · Tab to amend',
  ];
  const m = parseMenu(screen);
  assert.equal(m?.tabs, 'Bash command');
  assert.equal(m?.question, '임시 폴더 목록 보기\nDo you want to proceed?');
  assert.deepEqual(m?.block, [6, 8]);
  assert.deepEqual(screen.slice(...m!.block!).map(l => l.trim()), ['│ ls -la /tmp | head -5', '│ && echo done']);
});

test('긴 승인 화면 — 가로줄이 화면 밖으로 밀려나도 점선 두 줄이 보이면 맨 위부터 읽는다', () => {
  const body = Array.from({ length: 45 }, (_, i) => `  ${i + 1} line ${i + 1}`);
  const m = parseMenu([' Create file', ' long.txt', '╌╌╌╌╌╌', ...body, '╌╌╌╌╌╌', ' Do you want to create long.txt?', ' ❯ 1. Yes', '   2. No', ' Esc to cancel']);
  assert.equal(m?.tabs, 'Create file');
  assert.equal(m?.question, 'long.txt\nDo you want to create long.txt?');
  assert.deepEqual(m?.block, [3, 48]);
});

test('Codex 승인 — 가로줄이 없으면 마지막 대화 줄(•) 아래만 질문, 「Press enter…」 는 선택지 설명이 아니다', () => {
  const m = parseMenu([
    '• 파일을 쓰는 명령이라 승인을 요청하겠습니다.', '• Running printf a > out.txt', '', '  Would you like to run the following command?', '  Reason: out.txt 를 만든다', '  $ printf a > out.txt', '',
    '› 1. Yes, proceed (y)', '  2. No, and tell Codex what to do differently (esc)', '', '  Press enter to confirm or esc to cancel',
  ]);
  assert.equal(m?.question, 'Would you like to run the following command?\nReason: out.txt 를 만든다\n$ printf a > out.txt');
  assert.deepEqual(m?.options.map(o => [o.label, o.desc]), [['Yes, proceed (y)', ''], ['No, and tell Codex what to do differently (esc)', '']]);
});

test('wide — 한글·한자·전각·이모지는 두 칸, ASCII·▾·←·· 는 한 칸', async () => {
  const { wide } = await import('../web/src/screenMenu.ts');
  assert.deepEqual(['가', '힣', '漢', 'Ａ', '🙂'].map(wide), [true, true, true, true, true]);
  assert.deepEqual(['a', ' ', '▾', '←', '·', '─'].map(wide), [false, false, false, false, false, false]);
});
