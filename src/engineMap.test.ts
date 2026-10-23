import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMap, description, excerpt } from './engineMap.ts';
import type { Step } from './runner.ts';
import type { Engine } from './workshop.ts';

// 맨 위: 기획(a 체인: 스킬 s1 → 명령 c1, 고치는 노드 fx) → be · fe 갈래 → 마무리 엔진 late(안에 체인 q: q1 → q2)
const st = (key: string, engine: string, more: Partial<Step> = {}): Step =>
  ({ key, title: key, lane: engine, group: key.slice(0, key.lastIndexOf('.') + 1), engine, kind: 'skill', skill: `/ws/${engine}/skills/${key.split('.').at(-1)}/SKILL.md`, deps: [], ...more });
const STEPS = [
  st('a.s1', 'chain-a'), st('a.c1', 'chain-a', { kind: 'command', command: 'run c1', skill: undefined, deps: ['a.s1'], failTo: 'a.fx' }),
  st('be.b1', 'chain-b', { deps: ['a.c1'], track: 'be' }), st('fe.f1', 'chain-f', { deps: ['a.c1'], track: 'fe' }),
  st('late.q.q1', 'chain-q', { deps: ['be.b1', 'fe.f1'] }), st('late.q.q2', 'chain-q', { deps: ['late.q.q1'] }),
  st('end', 'top', { deps: ['late.q.q2'] }), st('a.fx', 'chain-a', { fixOnly: true }),
];
const TOP: Engine = { name: '맨 위', kind: 'engine', edges: [], nodes: ['a', 'be', 'fe', 'late', 'end'].map(id => ({ id, title: `${id} 제목`, skill: null, x: 0, y: 0 })) };
const inside = (k: string) => k.startsWith('late.') ? ['late-eng', 'chain-q'] : [];
const files: Record<string, string> = { '/ws/chain-a/skills/s1/SKILL.md': '---\nname: s1\ndescription: "s1 이 하는 일"\n---\n\n# 제목\n첫 줄\n', '/ws/kit/x.md': '지시 첫 줄\n둘째 줄' };
const read = (f: string) => files[f] ?? null, inRoot = (f: string) => f.startsWith('/ws/');
const rows = (m: ReturnType<typeof buildMap>) => m.phases.flatMap(p => p.groups.flatMap(g => g.rows));

test('map.json 없으면 — 맨 위 노드마다 한 칸, 스킬 = Claude · 명령 = 자동 검사, 고치는 노드는 숨김', () => {
  const m = buildMap(STEPS, TOP, null, () => [], read, '/ws', inRoot);
  assert.deepEqual(m.phases.map(p => [p.name, p.groups.map(g => g.label)]), [['a 제목', ['']], ['be 제목', ['be']], ['fe 제목', ['fe']], ['late 제목', ['']], ['end 제목', ['']]]);
  const [s1, c1] = rows(m);
  assert.deepEqual([s1.role, s1.desc, s1.excerpt, s1.files], ['claude', 's1 이 하는 일', '# 제목\n첫 줄', [{ path: 'chain-a/skills/s1/SKILL.md', rel: 'chain-a/skills/s1/SKILL.md' }]]);
  assert.deepEqual([c1.role, c1.excerpt, c1.fail], ['check', '$ run c1', 'a.fx']);
  assert.deepEqual([m.hidden, m.phases[0].hidden], [1, ['a.fx']]);
});

test('map.json — 칸 · 갈래 · 역할 · 지시 파일, 나머지 숨김, 접는 폴더는 한 줄', () => {
  const map = {
    summary: '한 줄', rest: 'hidden',
    phases: [{ name: '기획', nodes: ['a'] }, { name: '만들기', lanes: [{ name: 'BE 갈래', nodes: ['be'] }, { name: 'FE 갈래', nodes: ['fe'] }] }, { name: '마무리', nodes: ['late', 'end'] }],
    fold: { 'late-eng': { title: '가정 답 받기', role: 'wait', tag: '가정했을 때' } },
    nodes: { 'chain-a/s1': { role: 'human', tag: '카드', desc: '사람이 고른다', instr: ['kit/x.md', '../밖.md'] }, 'chain-b/b1': { role: 'claude' }, 'chain-f/f1': {}, 'top/end': { role: 'check' } },
  };
  const m = buildMap(STEPS, TOP, map, inside, read, '/ws', inRoot);
  assert.equal(m.summary, '한 줄');
  assert.deepEqual(m.phases.map(p => [p.name, p.groups.map(g => `${g.label}:${g.rows.map(r => r.title).join(',')}`)]),
    [['기획', [':a.s1']], ['만들기', ['BE 갈래:be.b1', 'FE 갈래:fe.f1']], ['마무리', [':가정 답 받기,end']]]);
  const r = rows(m), s1 = r[0], fold = r.find(x => x.id === 'fold:late-eng')!;
  assert.deepEqual([s1.role, s1.tag, s1.desc, s1.files.map(f => f.path), s1.excerpt], ['human', '카드', '사람이 고른다', ['kit/x.md'], '지시 첫 줄\n둘째 줄']);   // 공방 밖 지시 경로는 뺀다
  assert.deepEqual([fold.role, fold.inner, fold.keys.length], ['wait', 2, 2]);
  assert.deepEqual([m.hidden, m.phases[0].hidden, m.phases[2].hidden], [4, ['a.c1', 'a.fx'], ['「가정 답 받기」 안쪽 2']]);
  // 흐름 — 숨긴 명령 c1 을 건너 s1 이 be · fe 의 앞, 접은 줄은 하나로
  const by = (t: string) => r.find(x => x.title === t)!;
  assert.deepEqual([by('be.b1').prev, by('a.s1').next], [['a.s1'], ['be.b1', 'fe.f1']]);
  assert.deepEqual([fold.prev, fold.next, by('end').prev], [['be.b1', 'fe.f1'], ['end'], ['fold:late-eng']]);
});

test('map.json hide — 든 노드만 숨기고, nodes 에 없는 노드도 종류대로 보인다(rest 는 무시)', () => {
  const map = { rest: 'hidden', hide: ['chain-a/c1'], phases: [{ name: '전부', nodes: ['a', 'be', 'fe', 'late', 'end'] }], nodes: { 'chain-b/b1': { role: 'human' } } };
  const r = rows(buildMap(STEPS, TOP, map, () => [], read, '/ws', inRoot));
  assert.deepEqual(r.map(x => `${x.title}:${x.role}`), ['a.s1:claude', 'be.b1:human', 'fe.f1:claude', 'late.q.q1:claude', 'late.q.q2:claude', 'end:claude']);   // c1 · 고치는 노드 fx 는 숨김
});

test('SKILL.md 앞부분 · description', () => {
  assert.equal(excerpt('---\nname: x\n---\n\n# 단계\n\n하나\n둘\n셋', 2), '# 단계\n하나');
  assert.equal(excerpt(`${'가'.repeat(200)}`).length, 160);
  assert.equal(description('---\nname: x\ndescription: 따옴표 없이\n---\n본문'), '따옴표 없이');
  assert.equal(description('본문만'), undefined);
});
