import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acrossOf, asHuman, codexUsage, flow, humanKeys, humanSpans, lanes, mergePart, OUTSIDE, overlap, phaseTimes, readPaths, redo, repoPick, sameCode, subagentIn, timings, toolLabel, tokensIn, windows, type Ev, type Inside, type RunSum } from './analysis.ts';
import { codeFp } from './runner.ts';

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
  const ev = (t: number, key: string, state: Ev['state']): Ev => ({ t, key, state, attempt: 1 });
  const evs = [ev(0, 'p', 'running'), ev(1, 'p', 'done'), ev(1, 'b1', 'running'), ev(5, 'b1', 'done'), ev(1, 'f1', 'running'), ev(10, 'f1', 'done'), ev(10, 'j', 'running')];
  assert.deepEqual(lanes(steps, evs, time).map(l => [l.track, l.last, l.waited]), [['be', 5, 5], ['fe', 10, 0]]);
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

test('런 분석 읽기 — 노드 대화 턴 수, Read 도구 · cat 류 Bash 가 연 파일과 결과 글자 수(경로는 끝 세 마디)', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 9, 26, 0, 0, s)).toISOString();
  const user = (s: number, content: unknown) => JSON.stringify({ type: 'user', timestamp: at(s), message: { content } });
  const said = (s: number, id: string, blocks: unknown[]) => JSON.stringify({ type: 'assistant', timestamp: at(s), message: { id, usage: { input_tokens: 1, output_tokens: 1 }, content: blocks } });
  const inside: Record<string, Inside> = {};
  tokensIn([user(0, '[EDITH 런 #4 · 준비 › 「워크트리 준비」]\n결과 파일: /r/4/nodes/t.tree/1/result.json'),
    said(1, 'a1', [{ type: 'tool_use', id: 'u1', name: 'Read', input: { file_path: '/w/bin/skills/prepare/SKILL.md' } }]),
    user(3, [{ type: 'tool_result', tool_use_id: 'u1', content: 'x'.repeat(500) }]),
    said(4, 'a2', [{ type: 'tool_use', id: 'u2', name: 'Bash', input: { command: 'W=/w; cat $W/brief.md; cat $W/source.md' } }]),
    user(5, [{ type: 'tool_result', tool_use_id: 'u2', content: [{ type: 'text', text: 'y'.repeat(300) }] }]),
    said(6, 'a3', [{ type: 'text', text: '끝' }]), said(6, 'a3', [{ type: 'text', text: '끝' }])], 4, {}, inside);
  assert.equal(inside['t.tree'].turns, 3);   // 같은 message.id 는 한 번
  assert.equal(inside['t.tree'].readChars, 800);
  assert.deepEqual(inside['t.tree'].reads, { 'skills/prepare/SKILL.md': 500, '$W/brief.md': 150, '$W/source.md': 150 });
  assert.deepEqual(readPaths('Bash', { command: 'git status' }), []);
  assert.deepEqual(readPaths('Bash', { command: 'node bin/tool.ts mode' }), []);   // 읽기 명령이 아니면 파일 이름이 있어도 뺀다
});

test('런 분석 헛도는 검사 — 다음 시도가 같은 코드 지문으로 시작하면 센다(다시 켜기로 겹친 줄은 한 번)', () => {
  const e = (t: number, key: string, state: Ev['state'], attempt: number, fp?: string): Ev => ({ t, key, state, attempt, ...(fp ? { fp } : {}) });
  const evs = [e(0, 'v', 'running', 1, 'F1'), e(0, 'v', 'running', 1, 'F1'), e(2, 'v', 'wait', 1), e(10, 'v', 'running', 2, 'F1'), e(12, 'v', 'wait', 2), e(20, 'v', 'running', 3, 'F2'), e(25, 'v', 'done', 3),
    e(0, 'b', 'running', 1, 'G'), e(5, 'b', 'wait', 1), e(9, 'b', 'running', 2, 'H'), e(11, 'b', 'done', 2), e(1, 'n', 'running', 1), e(3, 'n', 'running', 2)];
  assert.deepEqual(sameCode(evs), [{ key: 'v', attempts: 3, same: 1, lost: 10, passed: true }]);
});

test('코드 지문 — 작업 폴더(git)의 HEAD · 바뀐 파일 · diff 가 같으면 같고, 고치면 바뀐다', () => {
  const d = mkdtempSync(join(tmpdir(), 'edith-fp-')), git = (...a: string[]) => execFileSync('git', ['-C', d, ...a], { stdio: 'ignore' });
  try {
    git('init', '-q'); writeFileSync(join(d, 'a.txt'), '1\n'); git('add', '.'); git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'a');
    const r = { id: -1, cwd: d }, f1 = codeFp(r);
    assert.match(f1 ?? '', /^[0-9a-f]{12}$/);
    writeFileSync(join(d, 'a.txt'), '2\n');
    assert.notEqual(codeFp(r), f1);
    writeFileSync(join(d, 'a.txt'), '1\n');
    assert.equal(codeFp(r), f1);
    assert.equal(codeFp({ id: -1, cwd: join(d, 'nope') }), undefined);   // 레포가 없으면 지문도 없다
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('런 분석 레포 판단 — 엔진 기록의 마지막 repo-pick 줄, 없으면 없음', () => {
  assert.equal(repoPick(-1, [{ kind: 'stage' }]), null);
  assert.deepEqual(repoPick(-1, [{ kind: 'repo-pick', must: ['a'], check: ['b'] }, { kind: 'repo-pick', must: ['c', 1], check: [], human: true }]), { must: ['c'], check: [], human: true, picked: [] });
});

test('런 분석 하위 에이전트 — 부른 노드(Agent 도구 호출 id)를 잇고, 그 기록의 토큰 · 걸린 시간 · 턴을 그 노드에', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 9, 26, 0, 0, s)).toISOString();
  const inside: Record<string, Inside> = {}, into = {}, agents = new Map<string, string>();
  tokensIn([JSON.stringify({ type: 'user', timestamp: at(0), message: { content: '[EDITH 런 #5 · 준비 › 「준비」]\n결과 파일: /r/5/nodes/p/1/result.json' } }),
    JSON.stringify({ type: 'assistant', timestamp: at(1), message: { id: 'm1', usage: { input_tokens: 1, output_tokens: 2 }, content: [{ type: 'tool_use', id: 'toolu_A', name: 'Agent', input: { description: '판정' } }] } })], 5, into, inside, agents);
  assert.equal(agents.get('toolu_A'), 'p');
  const sub = (s: number, id: string, out: number) => JSON.stringify({ type: 'assistant', timestamp: at(s), message: { id, model: 'claude-sonnet-5-5', usage: { input_tokens: 10, output_tokens: out, cache_read_input_tokens: 100 } } });
  subagentIn([JSON.stringify({ type: 'user', timestamp: at(2), message: { content: '판정해 줘' } }), sub(5, 's1', 7), sub(5, 's1', 7), sub(62, 's2', 3)], 'p', into, inside);
  assert.deepEqual(inside.p.agents, { n: 1, ms: 60_000, turns: 2 });
  assert.deepEqual((into as Record<string, { output: number; models: string[] }>).p.output, 2 + 7 + 3);
});

test('런 분석 claude -p 사용량 — 명령 노드가 남긴 usage 줄의 claude 칸은 Codex 와 따로, 노드마다', () => {
  const u = codexUsage([{ kind: 'usage', node: 'r', claude: { in: 32, out: 50, cacheR: 400, cost: 0.0012 } }, { kind: 'usage', node: 'r', claude: { in: 8, out: 1, cacheR: 0, cost: 0.0008 } },
    { kind: 'usage', node: 'c', codex: { in: 5, out: 6, cacheR: 7 } }]);
  assert.deepEqual(u.claude, { r: { in: 40, out: 51, cacheR: 400, cost: 0.002 } });
  assert.deepEqual(u.nodes, { c: { in: 5, out: 6, cacheR: 7 } });
});

test('런 분석 파일별 결과 더하기 — 토큰 · 노드 안쪽을 더하고, 기억해 둔 결과는 고치지 않는다', () => {
  const part = { into: { n: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, models: ['m1'] } },
    inside: { n: { first: 10, last: 20, tools: { Read: 5 }, busy: 5, turns: 2, readChars: 7, reads: { 'a/b.md': 7 }, agents: { n: 1, ms: 9, turns: 3 } } } };
  const keep = structuredClone(part), out = { into: {}, inside: {} };
  mergePart(out, part); mergePart(out, part);
  assert.deepEqual(out.into, { n: { input: 2, output: 4, cacheRead: 6, cacheWrite: 8, models: ['m1'] } });
  assert.deepEqual(out.inside, { n: { first: 10, last: 20, tools: { Read: 10 }, busy: 10, turns: 4, readChars: 14, reads: { 'a/b.md': 14 }, agents: { n: 2, ms: 18, turns: 6 } } });
  assert.deepEqual(part, keep);
});

test('여러 런 모아 보기 — 지난 런 중앙값(3런 넘을 때), 헛도는 노드 비율, 커밋한 런의 레포 판단 맞힘', () => {
  const pick = (must: string[], check: string[], picked: [string, number][]) => ({ must, check, human: false, picked: picked.map(([repo, commits]) => ({ repo, commits })) });
  const sums: RunSum[] = [
    { id: 1, work: { a: 10, v: 5 }, same: ['v'], pick: pick(['x'], ['y'], [['x', 2]]) },
    { id: 2, work: { a: 30, v: 5 }, same: [], pick: pick(['x'], ['y'], [['x', 1], ['y', 3]]) },
    { id: 3, work: { a: 20 }, same: ['v'], pick: pick(['x'], [], [['x', 1], ['z', 1]]) },
    { id: 4, work: { a: 99 }, same: [], pick: pick(['x'], [], [['x', 0]]) },   // 커밋이 없으면 맞힘에서 뺀다
    { id: 9, work: { a: 500 }, same: [], pick: null },
  ];
  const x = acrossOf(sums, 9);
  assert.deepEqual(x.medians, { a: { ms: 20, n: 4 } });   // 이 런(9)은 빼고, v 는 2런뿐이라 없음
  assert.deepEqual(x.flaky, [{ key: 'v', same: 2, ran: 2 }]);
  assert.deepEqual(x.repo, { runs: 3, must: 1, check: 2, added: 1 });
});

test('런 분석 노드 밖 — 노드 도는 시간 창 밖의 대화는 노드에서 빼 「노드 밖」 으로, 그 대화를 연 사람 글도', () => {
  const at = (m: number) => Date.UTC(2026, 9, 26, 0, m);
  const iso = (m: number) => new Date(at(m)).toISOString();
  const win = windows([{ t: at(0), key: 'n', state: 'running', attempt: 1 }, { t: at(10), key: 'n', state: 'done', attempt: 1 }]);
  const into: Record<string, { output: number }> = {}, inside: Record<string, Inside> = {};
  const said = (m: number, id: string, out: number) => JSON.stringify({ type: 'assistant', timestamp: iso(m), message: { id, usage: { input_tokens: 1, output_tokens: out }, content: [] } });
  tokensIn([JSON.stringify({ type: 'user', timestamp: iso(0), message: { content: '[EDITH 런 #6 · 구현 › 「구현」]\n결과 파일: /r/6/nodes/n/1/result.json' } }), said(5, 'a', 10),
    JSON.stringify({ type: 'user', timestamp: iso(40), message: { content: '그 파일 되돌렸으니 다시 해\n둘째 줄' } }), said(41, 'b', 99)], 6, into as never, inside, undefined, win.within);
  assert.equal(into.n.output, 10);
  assert.equal(into[OUTSIDE].output, 99);
  assert.deepEqual(inside[OUTSIDE].asks, [{ t: at(40), text: '그 파일 되돌렸으니 다시 해' }]);
});

test('런 분석 사람 대기 빼기 — 단계 시간 · 런 시간 · 헛돎 · 병목 갈래가 답 기다림 · 확인 필요 구간만큼 준다', () => {
  const e = (t: number, key: string, state: Ev['state'], attempt = 1, fp?: string): Ev => ({ t: t * 60_000, key, state, attempt, ...(fp ? { fp } : {}) });
  const min = (x: number) => x / 60_000;
  // 단계 A: a 가 0~2 돌고 2~7 답 기다림(사람 5분) · 7~9 돌고, 9~12 확인 필요(사람 3분) 뒤 이어서 12~13
  const evs = [e(0, 'a', 'running'), e(2, 'a', 'blocked'), e(7, 'a', 'running'), e(9, 'a', 'check'), e(12, 'a', 'running'), e(13, 'a', 'done'), e(13, 'b', 'running'), e(14, 'b', 'done')];
  const steps = [{ key: 'a', title: 'A', boxes: [{ name: '단계 A' }] }, { key: 'b', title: 'B' }];
  assert.deepEqual(phaseTimes(steps, evs).map(p => [p.name, min(p.ms)]), [['단계 A', 13 - 8], ['B', 1]]);
  // 단계 구간 안에 다른 단계의 긴 확인 필요가 끼고, 런 끝에 단계 노드가 건너뜀으로 찍혀도 단계 시간은 그 단계 노드가 돈 때만. 겹친 갈래는 한 번
  const ps = [{ key: 'p1', title: 'P1', boxes: [{ name: '계획' }] }, { key: 'p2', title: 'P2', boxes: [{ name: '계획' }] }, { key: 'p3', title: 'P3', boxes: [{ name: '계획' }] }, { key: 'd', title: 'D', boxes: [{ name: '문서' }] }];
  const pev = [e(0, 'p1', 'running'), e(0, 'p2', 'running'), e(2, 'p1', 'done'), e(3, 'p2', 'done'), e(3, 'd', 'running'), e(4, 'd', 'check'), e(2000, 'd', 'running'), e(2001, 'd', 'done'),
    e(2001, 'p1', 'running', 2), e(2003, 'p1', 'done', 2), e(2010, 'p3', 'skipped')];
  assert.deepEqual(phaseTimes(ps, pev).map(p => [p.name, min(p.ms)]), [['계획', 3 + 2], ['문서', 2]]);
  assert.deepEqual(phaseTimes(ps, [e(0, 'p1', 'running')], 7 * 60_000).map(p => min(p.ms)), [7]);   // 도는 중이면 end 까지
  // 런 시간(runAnalysis elapsed) = 벽시계 14분 - 사람 대기 8분. 아직 기다리는 중이면 지금까지 뺀다
  assert.equal(min(14 * 60_000 - overlap(humanSpans(evs), 0, 14 * 60_000)), 6);
  assert.equal(min(overlap(humanSpans([e(0, 'a', 'running'), e(1, 'a', 'check')]), 0, 10 * 60_000)), 9);
  // 다른 노드가 도는 동안의 답 기다림은 사람 대기 구간이 아니다(런은 그동안 일했다)
  assert.deepEqual(humanSpans([e(0, 'a', 'blocked'), e(0, 'b', 'running'), e(5, 'b', 'done'), e(8, 'a', 'running')]).map(([x, y]) => [min(x), min(y)]), [[5, 8]]);
  // 헛돎: v 가 실패 → 고치는 노드 fix 가 사람 판단을 4분 기다림 → 코드 그대로 다시. lost 10분에서 4분을 뺀다
  const loop = [e(0, 'v', 'running', 1, 'F'), e(2, 'v', 'wait', 1), e(2, 'fix', 'running'), e(3, 'fix', 'blocked'), e(7, 'fix', 'running'), e(10, 'fix', 'done'), e(10, 'v', 'running', 2, 'F'), e(11, 'v', 'done', 2)];
  assert.deepEqual(sameCode(loop, [{ key: 'v', failTo: 'fix' }]).map(x => min(x.lost)), [6]);
  assert.deepEqual(sameCode(loop).map(x => min(x.lost)), [6]);   // 고치는 노드를 몰라도 그동안 도는 노드가 없으면 런 전체 대기라 빠진다
  // 다른 갈래(o)가 도는 동안 고치는 노드가 사람을 기다린 것은 failTo 를 알아야 뺀다
  const busy = [...loop, e(0, 'o', 'running'), e(11, 'o', 'done')];
  assert.deepEqual([sameCode(busy, [{ key: 'v', failTo: 'fix' }]), sameCode(busy)].map(r => r.map(x => min(x.lost))), [[6], [10]]);
  // 시도 사이에 다른 노드(d)가 확인 필요로 오래 멈춰 런 전체가 사람을 기다렸으면 그것도 뺀다
  const rew = [e(0, 'w', 'running', 1, 'G'), e(2, 'w', 'done', 1), e(2, 'd', 'running'), e(3, 'd', 'check'), e(2000, 'd', 'running'), e(2001, 'd', 'done'), e(2001, 'w', 'running', 2, 'G'), e(2002, 'w', 'done', 2)];
  assert.deepEqual(sameCode(rew).map(x => min(x.lost)), [2001 - 1997]);
  // 병목 갈래: be 가 5 에 끝나고 합침은 20 — fe 가 8~16 사람을 기다렸으면 be 가 기다린 것은 15 - 8 = 7분
  const ls = [{ key: 'b1', track: 'be', deps: [] }, { key: 'f1', track: 'fe', deps: [] }, { key: 'j', deps: ['b1', 'f1'] }];
  const lev = [e(0, 'b1', 'running'), e(5, 'b1', 'done'), e(0, 'f1', 'running'), e(8, 'f1', 'blocked'), e(16, 'f1', 'running'), e(20, 'f1', 'done'), e(20, 'j', 'running')];
  assert.deepEqual(lanes(ls, lev, timings(lev, 21 * 60_000)).map(l => [l.track, l.waited === null ? null : min(l.waited)]), [['be', 7], ['fe', 0]]);
});

test('런 분석 사람 대기 명령 노드 · 건너뛴 갈래 — humanWait 노드가 도는 때는 답 기다림처럼, 전부 건너뛴 갈래는 병목에서 뺀다', () => {
  const e = (t: number, key: string, state: Ev['state'], attempt = 1): Ev => ({ t: t * 60_000, key, state, attempt });
  const min = (x: number) => x / 60_000;
  // 답 맞추기 단계: 카드 2분 → 사람 답 기다림(명령, 도는 중) 120분 → 반영 3분
  const steps = [{ key: 'late.cards', title: '카드', kind: 'skill', boxes: [{ name: '답 맞추기' }] }, { key: 'late.planner', title: '답 기다림', kind: 'command', humanWait: true as const, boxes: [{ name: '답 맞추기' }] },
    { key: 'late.apply', title: '반영', kind: 'skill', boxes: [{ name: '답 맞추기' }] }];
  const raw = [e(0, 'late.cards', 'running'), e(2, 'late.cards', 'done'), e(2, 'late.planner', 'running'), e(122, 'late.planner', 'done'), e(122, 'late.apply', 'running'), e(125, 'late.apply', 'done')];
  const keys = humanKeys(steps), evs = asHuman(raw, keys);
  assert.deepEqual([...keys], ['late.planner']);
  assert.deepEqual(phaseTimes(steps, evs).map(p => min(p.ms)), [5]);
  assert.equal(min(125 * 60_000 - overlap(humanSpans(evs), 0, 125 * 60_000)), 5);   // 런 시간도
  assert.deepEqual(timings(evs, 125 * 60_000)['late.planner'], { work: 0, human: 120 * 60_000, stop: 0, first: 2 * 60_000, last: 122 * 60_000 });
  assert.equal(asHuman(raw, new Set()), raw);   // 표시가 없으면 그대로
  // app 갈래는 전부 건너뜀 — 기다림 없음(skipped), be 는 fe 를 기다림
  const ls = [{ key: 'b', track: 'be', deps: [] }, { key: 'f', track: 'fe', deps: [] }, { key: 'a', track: 'app', deps: [] }, { key: 'j', deps: ['b', 'f', 'a'] }];
  const lev = [e(0, 'b', 'running'), e(5, 'b', 'done'), e(0, 'f', 'running'), e(10, 'f', 'done'), e(0, 'a', 'skipped'), e(10, 'j', 'running')];
  assert.deepEqual(lanes(ls, lev, timings(lev, 11 * 60_000)).map(l => [l.track, l.waited === null ? null : min(l.waited), !!l.skipped]), [['be', 5, false], ['fe', 0, false], ['app', null, true]]);
  // 갈래 머리의 명령이 끝 코드 77 로 나머지를 건너뛰게 했어도(그 노드는 「끝」) 전부 건너뛴 갈래 — 아직 안 돈 갈래는 아니다
  const gs = [...ls, { key: 'g', track: 'app2', deps: [] }, { key: 'g2', track: 'app2', deps: ['g'] }, { key: 'w', track: 'idle', deps: [] }];
  const gev = [...lev, e(0, 'g', 'running'), e(0.1, 'g', 'done'), e(0.1, 'g2', 'skipped')];
  const nodes = { g: { state: 'done' as const, summary: '끝 코드 77 — 「앱」 의 남은 노드 1개를 건너뜀' }, g2: { state: 'skipped' as const }, w: { state: 'wait' as const } };
  assert.deepEqual(lanes(gs, gev, timings(gev, 11 * 60_000), nodes).filter(l => l.skipped).map(l => l.track), ['app', 'app2']);
});
