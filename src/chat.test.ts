import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkAlive, claudeLine, follow, isProgram, newerSame, older, rolloutsIn, taskLine, windows } from './chat.ts';
import { agentSince, hasShells, isLimitScreen, liveWindow, noteAgents } from './herdr.ts';

test('이전 대화 — 4MB 보다 긴 줄을 사이에 두고도 순서·바이트 위치를 지켜 거꾸로 모은다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'edith-chat-'));
  try {
    const msg = (i: number) => JSON.stringify({ type: 'assistant', timestamp: '2026-10-13T00:00:00Z', message: { content: [{ type: 'text', text: `m${i}` }] } });
    const lines = [...Array.from({ length: 100 }, (_, i) => msg(i)), JSON.stringify({ type: 'x', pad: '한'.repeat(2_000_000) }), ...Array.from({ length: 100 }, (_, i) => msg(100 + i))];
    const file = join(dir, 's.jsonl'), text = `${lines.join('\n')}\n`;
    writeFileSync(file, text);
    const r = older(file, Buffer.byteLength(text), claudeLine), buf = readFileSync(file);
    assert.deepEqual(r.items.map(i => i.text), Array.from({ length: 200 }, (_, i) => `m${i}`));
    assert.equal(r.more, false);
    for (const it of r.items) assert.ok(buf.subarray(it.at!, it.at! + 200).toString('utf8').includes(`"text":"${it.text}"`));
    const mid = older(file, r.items[150].at!, claudeLine);   // 그 앞만
    assert.equal(mid.items.at(-1)!.text, 'm149');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('새로 뜬 에이전트 — 콘솔이 켜질 때 이미 있던 pane 은 표시하지 않고, 셸에서 바뀌거나 나중에 생긴 pane 만 시각을 남긴다', () => {
  noteAgents([{ id: 'wT:p1', agent: 'claude' }, { id: 'wT:p2', agent: null }]);
  assert.equal(agentSince('wT:p1'), undefined);
  noteAgents([{ id: 'wT:p1', agent: 'claude' }, { id: 'wT:p2', agent: 'claude' }, { id: 'wT:p3', agent: 'codex' }]);
  assert.equal(agentSince('wT:p1'), undefined);
  assert.ok(agentSince('wT:p2'));
  assert.ok(agentSince('wT:p3'));
});

test('/clear·/resume — 붙잡은 파일보다 나중에 쓰인 같은 제목 파일로 옮기고, 다른 제목 파일은 안 본다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'edith-clear-'));
  try {
    const put = (f: string, name: string, sec: number) => {
      const p = join(dir, f);
      writeFileSync(p, `${JSON.stringify({ type: 'custom-title', customTitle: name })}\n`);
      utimesSync(p, sec, sec);
      return p;
    };
    // 예전 세션(먼저 만든 것)을 /resume 해서 지금 쓰는 경우 — 만든 순서와 상관없이 마지막에 쓴 파일
    const resumed = put('a.jsonl', 'Optimus Prime', 300), held = put('b.jsonl', 'Optimus Prime', 200), other = put('c.jsonl', 'pr', 400);
    assert.equal(newerSame(held, [resumed, held, other], 'Optimus Prime'), resumed);
    assert.equal(newerSame(resumed, [resumed, held, other], 'Optimus Prime'), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('백그라운드로 넘긴 대화 — parkedJobId 와 같은 jobId 의 bg 세션 파일을 따라가고, 없으면 원래 것', () => {
  const files = { 1: { sessionId: 'old', parkedJobId: 'j1' }, 2: { sessionId: 'other', jobId: 'j9' }, 3: { sessionId: 'new', jobId: 'j1', bridgeSessionId: 'b' } } as Record<number, object>;
  const read = (pid: number) => files[pid], names = () => ['1.json', '2.json', '3.json', 'x.tmp'];
  assert.deepEqual(follow(files[1], names, read), { sessionId: 'new', jobId: 'j1', bridgeSessionId: 'b', parked: true });
  assert.deepEqual(follow({ sessionId: 'old', parkedJobId: 'gone' }, names, read), { sessionId: 'old', parkedJobId: 'gone' });
  assert.deepEqual(follow({ sessionId: 'plain' }, names, read), { sessionId: 'plain' });
});

test('다른 Claude 세션과 주고받은 말 — 받은 것은 보낸 이와 본문만(안내문 빼고), 보낸 것은 받는 이와 본문으로', () => {
  const items: Parameters<typeof claudeLine>[0] = [], byId = new Map();
  claudeLine(items, byId, JSON.stringify({ type: 'user', isMeta: true, timestamp: '2026-10-15T00:00:00Z', origin: { kind: 'peer', name: 'peer-a', from: 'uds:/tmp/a.sock', body: '안녕' },
    message: { content: 'Another Claude session sent a message:\n<cross-session-message from-name="peer-a">\n안녕\n</cross-session-message>\n\nThis came from another Claude session …' } }));
  claudeLine(items, byId, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'SendMessage', input: { to: 'uds:/tmp/a.sock', message: '받았어' } }] } }));
  claudeLine(items, byId, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'SendMessage', input: { to: 'peer-c', message: '봐 줘' } }] } }));
  assert.deepEqual(items.map(i => [i.kind, i.text, i.from]), [['peer', '안녕', 'peer-a'], ['tool', 'SendMessage → peer-a · 받았어', undefined], ['tool', 'SendMessage → peer-c · 봐 줘', undefined]]);
});

test('Codex 한도 창 — 길이로 고르고, 7일 창 하나만 오면 5시간은 없다', () => {
  const day = { used_percent: 1, window_minutes: 10080 }, five = { used_percent: 30, window_minutes: 300 };
  assert.deepEqual(windows({ primary: day, secondary: null }), { five: null, week: day });
  assert.deepEqual(windows({ primary: five, secondary: day }), { five, week: day });
  assert.deepEqual(windows({ primary: day, secondary: five }), { five, week: day });
  const old = { used_percent: 5 };   // 길이 없는 옛 기록 — 자리로
  assert.deepEqual(windows({ primary: old, secondary: old }), { five: old, week: old });
});

test('백그라운드 에이전트 — 끝남 알림이 queued_command 첨부로 와도 끝남, claude 가 뜨기 전에 띄운 것도 끝남', async () => {
  const c = { size: 0, rest: '', tasks: new Map(), pending: new Map() };
  const line = (o: object) => taskLine(c, JSON.stringify({ timestamp: '2026-10-12T03:58:37Z', ...o }));
  const start = (id: string, tu: string) => {
    line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: tu, name: 'Agent', input: { description: '그림', run_in_background: true } }] } });
    line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: tu, content: `Async agent launched successfully. agentId: ${id} (internal ID)` }] } });
  };
  start('a1', 'tu1');
  assert.equal(c.tasks.get('a1')?.status, '실행 중');
  line({ type: 'attachment', attachment: { type: 'queued_command', prompt: '<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n</task-notification>' } });
  assert.equal(c.tasks.get('a1')?.status, '끝남');
  start('a2', 'tu2');
  const t = c.tasks.get('a2');
  assert.equal((await checkAlive([t], t.t + 1))[0].status, '끝남');
  assert.equal((await checkAlive([t], t.t - 1))[0].status, '실행 중');
});

test('Codex 프로세스가 연 세션 기록 — lsof -Fn 출력에서 rollout 파일만', () => {
  const out = ['p12014', 'fcwd', 'n/Users/me/proj', 'f23', 'n/Users/me/.codex/sessions/2026/10/15/rollout-2026-10-15T00-13-52-abc.jsonl', 'f24', 'n/Users/me/.codex/log/codex-tui.log', 'f25', 'n/Users/me/.codex/sessions/2026/10/16/rollout-x.jsonl.lock'].join('\n');
  assert.deepEqual(rolloutsIn(out), ['/Users/me/.codex/sessions/2026/10/15/rollout-2026-10-15T00-13-52-abc.jsonl']);
});

test('liveWindow — 입력칸이 없으면(메뉴) 아래쪽 빈 줄만 떼고 화면 전체, 입력칸이 있으면 그 위 18줄', () => {
  const menu = ['대화', '────', ' ☐ 머리', ...Array.from({ length: 30 }, (_, i) => `│ 질문 ${i}`), '❯ 1. 예', '  2. 아니오', 'Enter to select'];
  const screen = [...menu, ...Array(20).fill('')];   // 덜 찬 화면 — 아래가 빈 줄
  const [a, b] = liveWindow(screen, -1);
  assert.equal(screen[b - 1], 'Enter to select');
  assert.ok(screen.slice(a, b).includes('────'));
  assert.deepEqual(liveWindow(['x', ...Array(30).fill('y'), '', '────', '❯ '], 32), [13, 31]);
});

test('사용량 한도 화면 — Claude 가 남기는 한도 글만', () => {
  assert.ok(isLimitScreen(['⏺ 구현 중…', "  ⎿  You've hit your session limit · resets 3pm (Asia/Seoul)"]));
  assert.ok(isLimitScreen(['  ⎿  Claude usage limit reached — send a message after it resets to continue']));
  assert.ok(!isLimitScreen(['⏺ 테스트를 고쳤습니다. 한도 3번 안에서 끝났습니다.', '  rate limit 은 설정에 있습니다']));
});

test('백그라운드 셸 — 입력칸 아래 모드 줄의 「N shell」 만', () => {
  const box = ['⏺ Codex 리뷰를 기다린다', '────', '❯ ', '────', '  ✦ Opus 5.5 [xhigh]  ·  CONTEXT 11%'];
  assert.ok(hasShells([...box, '  ⏵⏵ auto mode on · 1 shell · ⧉ 7 · ← for agents']));
  assert.ok(hasShells([...box, '  2 shells · ? for shortcuts']));
  assert.ok(!hasShells([...box, '  ⏵⏵ auto mode on · ⧉ 7']));
  assert.ok(!hasShells(['⏺ 1 shell 로 돌렸다', ...box]));   // 입력칸 위 글은 안 본다
  assert.ok(!hasShells(['  ⏵⏵ auto mode on · 1 shell']));   // 입력칸이 안 보이면(메뉴 중) 모른다
});

test('pane 프로그램 — Windows 의 전체 경로·.exe·대소문자도 claude 로 본다', () => {
  assert.ok(isProgram('claude', 'claude'));
  assert.ok(isProgram('C:\\Users\\u\\.local\\bin\\claude.exe', 'claude'));
  assert.ok(isProgram('/home/u/.local/bin/claude', 'claude'));
  assert.ok(isProgram('C:/tools/Claude.EXE', 'claude'));
  assert.ok(!isProgram('claude-helper', 'claude'));
  assert.ok(!isProgram('C:\\claude\\node.exe', 'claude'));
});
