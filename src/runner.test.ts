import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeArgs, claudeUsed, flatten, parseLimit, parsePicks, nextStep, nextSteps, parseResult, parseRewind, previewSteps, promptFor, recover, resume, rewind, rewindAfter, settle, skip, skipRest, unattend, type Run, type Step } from './runner.ts';
import { createEngine, type Engine } from './workshop.ts';

const node = (id: string, x: Record<string, unknown> = {}) => ({ id, title: id, skill: { from: 'engine' as const, id: 'do' }, x: 0, y: 0, ...x });
const resolve = (engine: string) => `/s/${engine}/SKILL.md`;
// 흐름 flow: [a] → [be(엔진)] → [z],  be: [b1] → [b2 = 명령, 실패하면 fix 로 최대 2번]
const ENGINES: Record<string, Engine> = {
  flow: { name: '흐름', nodes: [node('a'), { ...node('be', { engine: 'be' }), skill: null }, node('z')], edges: [{ from: 'a', to: 'be' }, { from: 'be', to: 'z' }] },
  be: { name: '백엔드', common: { from: 'engine', id: 'rules' }, nodes: [node('b1'), { ...node('b2', { command: 'pytest' }), skill: null }, node('fix')],
    edges: [{ from: 'b1', to: 'b2' }, { from: 'b2', to: 'fix', fail: true, max: 2 }] },
};
const load = (id: string) => ENGINES[id] ?? '공방에 없다';
const run = (steps: Step[]): Run => ({ id: 1, engine: 'flow', name: '흐름', cwd: '/w', input: '', created: 0, state: 'running', steps,
  nodes: Object.fromEntries(steps.map(s => [s.key, { state: 'wait', attempt: 0, fails: 0 }])) });

test('펼치기 — 엔진 노드를 그 엔진의 노드로, 바깥 화살표를 첫 · 끝 노드에, 고치는 노드는 뒤로', () => {
  const steps = flatten('flow', load, resolve) as Step[];
  assert.deepEqual(steps.map(s => s.key), ['a', 'be.b1', 'be.b2', 'z', 'be.fix']);
  const by = Object.fromEntries(steps.map(s => [s.key, s]));
  assert.deepEqual(by['be.b1'].deps, ['a']);
  assert.deepEqual(by.z.deps, ['be.b2']);
  assert.equal(by['be.b2'].kind, 'command');
  assert.equal(by['be.b2'].failTo, 'be.fix');
  assert.ok(by['be.fix'].fixOnly);
  assert.equal(by['be.b1'].common, '/s/be/SKILL.md');   // 안쪽 엔진의 공통 규칙
  assert.equal(by.a.common, undefined);
  assert.equal(by['be.b1'].lane, '백엔드');
  // 없는 엔진 · 빈 노드 · 서로 품는 엔진은 거절
  assert.match(String(flatten('nope', load, resolve)), /체인 nope: 공방에 없다/);
  assert.match(String(flatten('x', id => ({ name: 'X', nodes: [{ ...node('n'), skill: null }], edges: [] }) as Engine, resolve)), /빈 노드/);
  const ring = (id: string) => ({ name: id, nodes: [{ ...node('n', { engine: id === 'p' ? 'q' : 'p' }), skill: null }], edges: [] }) as Engine;
  assert.match(String(flatten('p', ring, resolve)), /p → q → p/);
});

test('결과 건너뜀 — 통과처럼 다음 노드로 넘어가되 상태는 건너뜀, 사람용 한 줄을 남긴다', () => {
  const r = run(flatten('flow', load, resolve) as Step[]), at = (k: string) => r.steps.find(s => s.key === k)!;
  settle(r, at('a'), { result: '건너뜀', line: '할 일 없음 — 넘어감', summary: '조건이 안 맞았다' });
  assert.deepEqual([r.nodes.a.state, r.nodes.a.line, r.nodes.a.reason], ['skipped', '할 일 없음 — 넘어감', undefined]);
  assert.equal((nextStep(r) as Step).key, 'be.b1');
});

test('돌리기 — 실패하면 고치고 다시, 한도를 넘으면 사람에게', () => {
  const r = run(flatten('flow', load, resolve) as Step[]), at = (k: string) => r.steps.find(s => s.key === k)!;
  const pass = (k: string) => { assert.equal((nextStep(r) as Step).key, k); settle(r, at(k), { result: '통과' }); };
  pass('a'); pass('be.b1');
  // b2 실패 → fix → b2 다시
  assert.equal((nextStep(r) as Step).key, 'be.b2');
  settle(r, at('be.b2'), { result: '실패', reason: '끝 코드 1' });
  assert.deepEqual(r.fixing, [{ fixer: 'be.fix', for: 'be.b2' }]);
  assert.equal((nextStep(r) as Step).key, 'be.fix');
  r.nodes['be.fix'].state = 'check';
  assert.equal(nextStep(r), null);   // 고치는 노드가 멈추면 실패한 노드를 그냥 다시 돌리지 않는다
  r.nodes['be.fix'].state = 'wait';
  settle(r, at('be.fix'), { result: '통과' });
  assert.equal(r.fixing, undefined);
  assert.equal((nextStep(r) as Step).key, 'be.b2');
  settle(r, at('be.b2'), { result: '실패' });   // 두 번째 실패 — 한도 2 안
  settle(r, at('be.fix'), { result: '통과' });
  settle(r, at('be.b2'), { result: '실패' });   // 세 번째 — 한도 넘음
  assert.equal(r.state, 'check');
  assert.match(r.reason!, /2번 고쳐도 실패/);
  assert.equal(nextStep(r), null);
  // 건너뛰면 다음으로, 끝까지 가면 done
  skip(r, 'be.b2');
  assert.equal(r.state, 'running');
  pass('z');
  assert.equal(nextStep(r), 'done');
});

test('다시 켰을 때 · 이어서 — 보내는 중이던 노드는 다시 보내지 않고, 이어서는 결과가 있으면 받는다', () => {
  const r = run(flatten('flow', load, resolve) as Step[]);
  r.nodes.a = { state: 'sending', attempt: 1, fails: 0 };
  r.nodes['be.b2'] = { state: 'running', attempt: 1, fails: 0 };
  recover(r);
  assert.equal(r.state, 'check');
  assert.equal(r.nodes.a.state, 'check');
  assert.equal(r.nodes['be.b2'].state, 'check');
  resume(r, s => s.key === 'a' ? { result: '통과', summary: '했다' } : null);
  assert.equal(r.nodes.a.state, 'done');
  assert.equal(r.nodes['be.b2'].state, 'wait');   // 명령은 다시 돌린다
  assert.equal(r.state, 'running');
});

test('건너뛰기 끝 코드 — 명령 노드가 든 엔진의 남은 노드만 건너뛰고, 그 뒤는 돈다', () => {
  const r = run(flatten('flow', load, resolve) as Step[]), at = (k: string) => r.steps.find(s => s.key === k)!;
  settle(r, at('a'), { result: '통과' });
  r.nodes['be.b1'].state = 'running';
  skipRest(r, at('be.b1'));
  assert.deepEqual(['a', 'be.b1', 'be.b2', 'be.fix', 'z'].map(k => r.nodes[k].state), ['done', 'done', 'skipped', 'skipped', 'wait']);
  assert.match(r.nodes['be.b1'].summary!, /「백엔드」 의 남은 노드 1개/);
  assert.equal((nextStep(r) as Step).key, 'z');
  // 맨 위에 놓인 명령이면 런의 남은 노드 전부
  const r2 = run(flatten('flow', load, resolve) as Step[]);
  skipRest(r2, r2.steps[0]);
  assert.equal(nextStep(r2), 'done');
});

test('이 노드부터 다시 — 그 노드와 뒤에 이어진 노드만 처음으로, 체인 · 엔진 자리로도, 기록이 남는다', () => {
  const r = run(flatten('flow', load, resolve) as Step[]), at = (k: string) => r.steps.find(s => s.key === k)!;
  for (const k of ['a', 'be.b1']) settle(r, at(k), { result: '통과' });
  settle(r, at('be.b2'), { result: '실패' }); settle(r, at('be.fix'), { result: '통과' });
  settle(r, at('be.b2'), { result: '통과' }); settle(r, at('z'), { result: '통과', summary: '끝' });
  r.state = 'done';
  assert.equal(rewind(r, 'be.b2', '사람', '다시 보자'), null);
  assert.deepEqual(r.steps.map(s => [s.key, r.nodes[s.key].state]), [['a', 'done'], ['be.b1', 'done'], ['be.b2', 'wait'], ['z', 'wait'], ['be.fix', 'wait']]);
  assert.deepEqual([r.nodes['be.b2'].fails, r.nodes.z.summary, r.state], [0, undefined, 'running']);
  assert.equal((nextStep(r) as Step).key, 'be.b2');
  // 엔진 자리(be)면 그 안의 첫 노드부터 · 이름은 바깥부터
  assert.equal(rewind(r, 'be', '「판단」', 'E2E 실패'), null);
  assert.equal(r.nodes['be.b1'].state, 'wait');
  assert.deepEqual(r.rewinds?.map(x => [x.to, x.name, x.by, x.reason]), [['be.b2', '백엔드 › 「b2」', '사람', '다시 보자'], ['be', '백엔드', '「판단」', 'E2E 실패']]);
  // 없는 키 · 고치는 노드는 거절, 다른 곳이 확인 필요면 런은 그대로
  assert.match(rewind(r, 'nope', '사람', '')!, /없는 노드/);
  assert.match(rewind(r, 'be.fix', '사람', '')!, /고치는 노드/);
  r.nodes.a.state = 'check'; r.state = 'check';
  assert.equal(rewind(r, 'z', '사람', ''), null);
  assert.equal(r.state, 'check');
  // 명령 노드의 되돌림 파일
  assert.deepEqual(parseRewind('{"to":"n2.n3","reason":" 구현 보완 "}'), { to: 'n2.n3', reason: '구현 보완' });
  assert.equal(typeof parseRewind('{"to":"../x y"}'), 'string');
  assert.equal(typeof parseRewind('깨짐'), 'string');
});

test('통과한 노드의 rewind.json — 있으면 되돌리고, 없으면 그대로, 틀렸으면 확인 필요', () => {
  const at = mkdtempSync(join(tmpdir(), 'edith-rewind-'));
  try {
    const r = run(flatten('flow', load, resolve) as Step[]), s = (k: string) => r.steps.find(x => x.key === k)!;
    for (const k of ['a', 'be.b1', 'be.b2']) settle(r, s(k), { result: '통과', summary: '했다' });
    rewindAfter(r, s('be.b2'), at);
    assert.equal(r.rewinds?.length ?? 0, 0);
    writeFileSync(join(at, 'rewind.json'), '{"to":"be.b1","reason":"리뷰 지적"}');
    rewindAfter(r, s('be.b2'), at);
    assert.deepEqual([r.nodes['be.b1'].state, r.nodes['be.b2'].state, r.rewinds?.[0].by], ['wait', 'wait', '백엔드 › 「b2」']);
    writeFileSync(join(at, 'rewind.json'), '{"to":"없음"}');
    settle(r, s('z'), { result: '통과' });
    rewindAfter(r, s('z'), at);
    assert.deepEqual([r.nodes.z.state, r.state], ['check', 'check']);
  } finally { rmSync(at, { recursive: true, force: true }); }
});

test('스킬 노드 Claude 띄우기 설정 — 모델 · 강도 · MCP 만, 없거나 비면 기본', () => {
  assert.deepEqual(claudeArgs(null), []);
  assert.deepEqual(claudeArgs(' '), []);
  assert.deepEqual(claudeArgs('{"model":"claude-sonnet-5-5","effort":"medium","mcpConfig":"/r/pw.json"}'), ['--model', 'claude-sonnet-5-5', '--effort', 'medium', '--mcp-config', '/r/pw.json']);
  assert.deepEqual(claudeArgs('{"model":"opus"}'), ['--model', 'opus']);
  for (const bad of ['깨짐', '{"model":"x --dangerously-skip-permissions"}', '{"effort":"huge"}', '{"mcpConfig":["rel.json"]}'])
    assert.equal(typeof claudeArgs(bad), 'string', bad);
});

test('갈래 — 갈리면 갈래마다 동시에, 이름은 갈라지는 노드 id, 한 갈래가 고치거나 멈춰도 다른 갈래는 돈다, 합류는 다 끝나야', () => {
  // dev: plan → be(엔진) · fe(엔진) → e2e
  const par: Record<string, Engine> = {
    ...ENGINES,
    dev: { name: '개발', nodes: [node('plan'), { ...node('be', { engine: 'be' }), skill: null }, { ...node('fe', { engine: 'fe' }), skill: null }, node('e2e')],
      edges: [{ from: 'plan', to: 'be' }, { from: 'plan', to: 'fe' }, { from: 'be', to: 'e2e' }, { from: 'fe', to: 'e2e' }] },
    fe: { name: '프론트엔드', nodes: [node('f1'), node('f2')], edges: [{ from: 'f1', to: 'f2' }] },
  };
  const steps = flatten('dev', id => par[id] ?? '없음', resolve) as Step[];
  assert.deepEqual(steps.map(s => [s.key, s.track]), [['plan', undefined], ['be.b1', 'be'], ['be.b2', 'be'], ['fe.f1', 'fe'], ['fe.f2', 'fe'], ['e2e', undefined], ['be.fix', 'be']]);
  const r = run(steps), at = (k: string) => r.steps.find(s => s.key === k)!, keys = () => (nextSteps(r) as Step[]).map(s => s.key);
  settle(r, at('plan'), { result: '통과' });
  assert.deepEqual(keys(), ['be.b1', 'fe.f1']);
  r.nodes['be.b1'].state = 'running';
  assert.deepEqual(keys(), ['fe.f1']);   // 도는 갈래는 빼고
  settle(r, at('be.b1'), { result: '통과' }); settle(r, at('be.b2'), { result: '실패' });
  r.nodes['fe.f1'].state = 'check';   // fe 는 사람을 기다리고
  assert.deepEqual(keys(), ['be.fix']);   // be 는 고친다
  settle(r, at('be.fix'), { result: '통과' });
  assert.deepEqual(keys(), ['be.b2']);
  settle(r, at('be.b2'), { result: '통과' });
  assert.deepEqual(keys(), []);   // e2e 는 fe 가 끝나야
  r.nodes['fe.f1'].state = 'wait'; settle(r, at('fe.f1'), { result: '통과' }); settle(r, at('fe.f2'), { result: '통과' });
  assert.deepEqual(keys(), ['e2e']);
  // 처음부터 여럿이면 그것도 갈래 · 이름이 겹치면 -2
  const two = flatten('x', () => ({ name: 'X', nodes: [node('a'), node('b')], edges: [] }) as Engine, resolve) as Step[];
  assert.deepEqual(two.map(s => s.track), ['a', 'b']);
});

test('보내는 글 · 결과 파일', () => {
  const r = run(flatten('flow', load, resolve) as Step[]), s = r.steps.find(x => x.key === 'be.b1')!;
  const t = promptFor({ ...r, input: '기획서 https://x' }, s, '/runs/1', '/runs/1/nodes/be.b1/1/result.json');
  assert.match(t, /^\[EDITH 런 #1 · 백엔드 › 「b1」\]/);
  assert.match(t, /공통 규칙: \/s\/be\/SKILL.md/);
  assert.match(t, /작업 문서: \/runs\/1\/work/);
  assert.match(t, /런 입력: 기획서/);
  assert.match(t, /result\.json\.tmp 에 쓰고 mv/);
  assert.match(t, /질문 창으로 묻는다\.$/);
  // 무인 런 — 묻지 말고 가정해 진행하라고(묻는다는 줄은 없다)
  const u = promptFor({ ...r, unattended: true }, s, '/runs/1', '/runs/1/nodes/be.b1/1/result.json');
  assert.match(u, /무인 런이다 — .*질문 창으로 묻지 말고/);
  assert.doesNotMatch(u, /질문 창으로 묻는다/);
  assert.deepEqual(parseResult('{"결과":"통과","요약":"됨"}'), { result: '통과', summary: '됨', reason: undefined });
  assert.deepEqual(parseResult('{"결과":"건너뜀","한줄":" 노션 원본 없음 — 넘어감 ","요약":"노션 원본이 없다"}'), { result: '건너뜀', summary: '노션 원본이 없다', line: '노션 원본 없음 — 넘어감', reason: undefined });
  assert.equal(typeof parseResult('{"결과":"ok"}'), 'string');
  assert.equal(typeof parseResult('깨짐'), 'string');
});

test('펼쳐 보기 — 초안 짜임을 쓰고, 아직 없는 스킬은 막지 않는다', () => {
  const root = mkdtempSync(join(tmpdir(), 'edith-preview-'));
  try {
    createEngine('a', '가', 'chain', root);
    createEngine('top', '위', 'engine', root);
    const n = (id: string, more: object) => ({ id, title: id, skill: null, x: 0, y: 0, ...more });
    writeFileSync(join(root, 'a/draft.json'), JSON.stringify({ nodes: [n('s', { skill: { from: 'engine', id: 'not-yet' } }), n('c', { command: 'true' })], edges: [{ from: 's', to: 'c' }] }));
    writeFileSync(join(root, 'top/draft.json'), JSON.stringify({ nodes: [n('x', { engine: 'a' })], edges: [] }));
    const p = previewSteps('top', root);
    assert.deepEqual([p.errors, p.draft, p.steps.map(s => [s.key, s.lane, s.engine])], [[], true, [['x.s', '가', 'a'], ['x.c', '가', 'a']]]);
    assert.deepEqual(p.steps[0].boxes, [{ name: '가', kind: 'chain' }]);   // 펼친 캔버스 상자 — 맨 위 엔진 밑부터
    assert.match(previewSteps('a', join(root, 'none')).errors.join(), /공방에 없다/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('띄운 Claude 설정 기록 — 모델 · 강도 · MCP 수, 엔진이 적은 이유(why, 160자)만, 깨졌거나 없으면 빈 것', () => {
  assert.deepEqual(claudeUsed('{"model":"opus","effort":"xhigh","mcpConfig":["/a.json","/b.json"],"why":" 판단자 deep — 확신 0.51 ","x":1}'), { model: 'opus', effort: 'xhigh', mcp: 2, why: '판단자 deep — 확신 0.51' });
  assert.deepEqual(claudeUsed(null), {});
  assert.deepEqual(claudeUsed('깨짐'), {});
  assert.equal(claudeUsed(JSON.stringify({ why: 'x'.repeat(300) })).why?.length, 160);
});

test('동시 런 한도 — 1~10 정수만, 없거나 틀리면 2', () => {
  assert.equal(parseLimit('{"max":3}'), 3);
  assert.equal(parseLimit('{"max":0}'), 2);
  assert.equal(parseLimit('{"max":11}'), 2);
  assert.equal(parseLimit('{"max":"3"}'), 2);
  assert.equal(parseLimit(null), 2);
});

test('무인 런 — 확인 필요 노드를 2번까지 다시 돌리고, 그래도 안 되면 까닭을 남기고 건너뛴다', () => {
  const r = run(flatten('flow', load, resolve) as Step[]), at = (k: string) => r.steps.find(s => s.key === k)!;
  settle(r, at('a'), { result: '막힘', reason: '시험지 업로드 실패' });
  unattend(r);
  assert.equal(r.state, 'check');   // 무인이 아니면 사람을 기다린다
  r.unattended = true;
  for (const n of [1, 2]) {
    unattend(r);
    assert.deepEqual([r.nodes.a.state, r.nodes.a.auto, r.state], ['wait', n, 'running']);
    settle(r, at('a'), { result: '막힘', reason: '시험지 업로드 실패' });
  }
  unattend(r);
  assert.equal(r.nodes.a.state, 'skipped');
  assert.match(r.nodes.a.reason!, /^무인 — 2번 다시 돌려도 안 돼 건너뜀 · 막힘 · 시험지 업로드 실패/);
  assert.equal(r.state, 'running');
  assert.equal((nextStep(r) as Step).key, 'be.b1');   // 뒤 노드는 돈다
  // 되돌리면 다시 돌린 횟수도 처음부터
  rewind(r, 'a', '사람', '다시');
  assert.equal(r.nodes.a.auto, undefined);
});

test('새 런 고르기 목록 — 이름 · 입력이 있는 줄만, 배열이 아니면 오류', () => {
  assert.deepEqual(parsePicks(JSON.stringify([{ label: ' TICKET-1 메모 칸 ', note: '안건 · 높음', input: 'https://www.notion.so/x' }, { label: '입력 없음' }, { input: 'https://y' }, 3])),
    [{ label: 'TICKET-1 메모 칸', note: '안건 · 높음', input: 'https://www.notion.so/x' }]);
  assert.throws(() => parsePicks('{"label":"x"}'), /JSON 배열/);
  assert.throws(() => parsePicks('깨짐'), /JSON 배열/);
});
