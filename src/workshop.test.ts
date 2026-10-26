import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyDraft, check, createEngine, discardDraft, listEngines, place, readEngine, removeEngine, saveEngine, syncGuide } from './workshop.ts';

const node = (id: string, skill: unknown = null) => ({ id, title: `노드 ${id}`, skill, x: 0, y: 0 });

test('형식 검사 — 맞으면 아는 칸만, 틀리면 사유', () => {
  const ok = check({ name: ' 디자인 ', nodes: [node('n1'), node('n2', { from: 'engine', id: 'design-draft' })], edges: [{ from: 'n1', to: 'n2', extra: 1 }], extra: 1 });
  assert.deepEqual(ok, { name: '디자인', kind: 'chain', nodes: [node('n1'), node('n2', { from: 'engine', id: 'design-draft' })], edges: [{ from: 'n1', to: 'n2' }] });
  const bad = (e: unknown) => { const r = check(e); assert.ok(Array.isArray(r) && r.length, JSON.stringify(e)); };
  bad({ name: '', nodes: [], edges: [] });
  bad({ name: 'a', nodes: [node('../x')], edges: [] });               // 경로로 쓰이는 id
  bad({ name: 'a', nodes: [node('n1'), node('n1')], edges: [] });      // 겹치는 id
  bad({ name: 'a', nodes: [node('n1', { from: 'engine', id: '../../x' })], edges: [] });
  bad({ name: 'a', nodes: [node('n1', 'design-draft')], edges: [] }); // 출처 없는 스킬
  bad({ name: 'a', nodes: [node('n1')], edges: [{ from: 'n1', to: 'n9' }] });
  bad({ name: 'a', nodes: [node('n1')], edges: [{ from: 'n1', to: 'n1' }] });
  bad({ name: 'a', nodes: [node('n1'), node('n2')], edges: [{ from: 'n1', to: 'n2' }, { from: 'n1', to: 'n2' }] });
});

test('엔진 만들기 · 읽기 · 저장 — 이름 규칙, 링크 탈출, 읽은 뒤 바뀌면 거절', () => {
  const root = mkdtempSync(join(tmpdir(), 'edith-ws-')), out = mkdtempSync(join(tmpdir(), 'edith-out-'));
  try {
    assert.throws(() => createEngine('../x', 'a', 'chain', root));
    assert.throws(() => createEngine('claude', 'a', 'chain', root));   // API 길 이름
    const r = createEngine('design', '디자인 엔진', 'chain', root);
    assert.deepEqual(r.engine, { name: '디자인 엔진', kind: 'chain', nodes: [], edges: [] });
    assert.throws(() => createEngine('design', 'b', 'chain', root));

    // 스킬 — SKILL.md 가 있는 폴더만, 링크로 밖을 가리키면 뺀다
    mkdirSync(join(root, 'design/skills/draft'), { recursive: true });
    writeFileSync(join(root, 'design/skills/draft/SKILL.md'), '---\nname: draft\ndescription: 시안 만들기\n---\n');
    mkdirSync(join(root, 'design/skills/empty'));
    mkdirSync(join(out, 'evil'));
    writeFileSync(join(out, 'evil/SKILL.md'), 'x');
    symlinkSync(join(out, 'evil'), join(root, 'design/skills/evil'));
    assert.deepEqual(readEngine('design', root).skills, [{ id: 'draft', desc: '시안 만들기' }]);

    // 엔진 폴더 자체가 밖을 가리키는 링크면 열지 않는다
    mkdirSync(join(out, 'eng'));
    writeFileSync(join(out, 'eng/engine.json'), '{}');
    symlinkSync(join(out, 'eng'), join(root, 'linked'));
    assert.throws(() => readEngine('linked', root));
    assert.deepEqual(listEngines(root).map(e => e.id), ['design']);

    const e = { name: '디자인 엔진', nodes: [node('n1')], edges: [] };
    const saved = saveEngine('design', e, r.version, root);
    assert.equal(saved.engine?.nodes.length, 1);
    assert.throws(() => saveEngine('design', e, r.version, root), /바뀌었다/);   // 옛 판으로 저장
    assert.throws(() => saveEngine('design', { ...e, nodes: [node('n1'), node('n1')] }, saved.version, root));

    writeFileSync(join(root, 'design/engine.json'), '{ 깨짐');
    assert.equal(readEngine('design', root).engine, null);
    assert.ok(listEngines(root)[0].broken);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }); }
});

test('노드 종류 · 실패 화살표 · 공통 규칙 · 고리', () => {
  const ok = check({ name: 'a', common: { from: 'installed', id: 'claude:rules' }, nodes: [node('n1'), { ...node('n2'), command: ' pytest -q ' }, node('n3'), { ...node('n4'), engine: 'backend' }],
    edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3', fail: true, max: 2 }, { from: 'n2', to: 'n4' }] });
  assert.ok(!Array.isArray(ok));
  assert.equal(ok.nodes[1].command, 'pytest -q');
  assert.deepEqual(ok.edges[1], { from: 'n2', to: 'n3', fail: true, max: 2 });
  assert.deepEqual(ok.common, { from: 'installed', id: 'claude:rules' });
  const bad = (e: unknown, why: RegExp) => { const r = check(e); assert.ok(Array.isArray(r) && r.some(x => why.test(x)), `${JSON.stringify(r)}`); };
  bad({ name: 'a', nodes: [{ ...node('n1'), command: 'x', engine: 'b' }], edges: [] }, /하나만/);
  bad({ name: 'a', nodes: [node('n1'), node('n2')], edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n1' }] }, /고리/);   // 되돌아가기는 실패 화살표로
  bad({ name: 'a', nodes: [node('n1'), node('n2'), node('n3')], edges: [{ from: 'n1', to: 'n3' }, { from: 'n2', to: 'n3', fail: true }] }, /보통 화살표가 들어오지/);
  bad({ name: 'a', nodes: [node('n1'), node('n2'), node('n3')], edges: [{ from: 'n1', to: 'n2', fail: true }, { from: 'n2', to: 'n3' }] }, /나가지 않는다/);
  bad({ name: 'a', nodes: [{ ...node('n1'), engine: 'x' }, node('n2')], edges: [{ from: 'n1', to: 'n2', fail: true }] }, /엔진 노드/);
  // 종류 — 체인은 스킬 · 명령 노드만. 종류가 없는 옛 파일은 노드로 정한다
  bad({ name: 'a', kind: 'chain', nodes: [{ ...node('n1'), engine: 'x' }], edges: [] }, /체인에는/);
  bad({ name: 'a', kind: 'flow', nodes: [], edges: [] }, /kind/);
  assert.equal((check({ name: 'a', nodes: [{ ...node('n1'), engine: 'x' }], edges: [] }) as { kind: string }).kind, 'engine');
  assert.equal((check({ name: 'a', kind: 'engine', nodes: [node('n1')], edges: [] }) as { kind: string }).kind, 'engine');   // 노드만 든 엔진도 엔진

  // 엔진 고리 — a 안에 b, b 안에 a 를 넣으려 하면 저장하지 않는다
  const root = mkdtempSync(join(tmpdir(), 'edith-loop-'));
  try {
    const a = createEngine('a', 'A', 'engine', root), b = createEngine('b', 'B', 'engine', root);
    saveEngine('a', { name: 'A', kind: 'engine', nodes: [{ ...node('n1'), engine: 'b' }], edges: [] }, a.version, root);   // 엔진 안에 엔진
    assert.throws(() => saveEngine('b', { name: 'B', kind: 'engine', nodes: [{ ...node('n1'), engine: 'a' }], edges: [] }, b.version, root), /b → a → b/);
    assert.throws(() => saveEngine('b', { name: 'B', kind: 'engine', nodes: [{ ...node('n1'), engine: 'b' }], edges: [] }, b.version, root), /고리/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('작업 폴더 설정 · 초안(draft.json) — 자리 채우기, 적용 · 버리기, 링크는 읽지 않음', () => {
  const wd = (w: unknown) => check({ name: 'a', nodes: [], edges: [], workdir: w });
  assert.deepEqual((wd({ kind: 'worktree', repo: ' ~/r ', base: 'origin/main' }) as { workdir: unknown }).workdir, { kind: 'worktree', repo: '~/r', base: 'origin/main' });
  assert.equal((wd({ kind: 'ask' }) as { workdir?: unknown }).workdir, undefined);
  assert.deepEqual((wd({ kind: 'fixed', dir: '' }) as { workdir: unknown }).workdir, { kind: 'fixed', dir: '' });   // 쓰는 중
  assert.ok(Array.isArray(wd({ kind: 'worktree', repo: '/r', base: '--evil' })));
  assert.ok(Array.isArray(wd({ kind: 'nope' })));

  // 자리 — 있던 노드는 그 자리, 새 노드는 화살표 깊이로, 고치는 노드는 고칠 노드 줄에
  const cur = { name: 'A', kind: 'engine' as const, nodes: [{ id: 'n1', title: 'n1', skill: null, x: 7, y: 9 }], edges: [] };
  const p = place({ nodes: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }, { id: 'fix' }], edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n3', to: 'fix', fail: true }] }, cur) as { name: string; nodes: { id: string; x: number; y: number }[] };
  assert.equal(p.name, 'A');
  assert.equal((p as { kind?: string }).kind, 'engine');   // 초안에 종류가 없으면 지금 종류
  assert.deepEqual(p.nodes.map(n => [n.id, n.x, n.y]), [['n1', 7, 9], ['n2', 260, 0], ['n3', 520, 0], ['fix', 520, 120]]);

  const root = mkdtempSync(join(tmpdir(), 'edith-draft-')), out = mkdtempSync(join(tmpdir(), 'edith-out-'));
  try {
    const r = createEngine('e', 'E', 'chain', root);
    assert.equal(r.draft, null);
    writeFileSync(join(root, 'e/draft.json'), JSON.stringify({ nodes: [{ id: 'n1', title: '구현', skill: { from: 'engine', id: 'build' } }, { id: 'n2', title: '테스트', command: 'pytest' }], edges: [{ from: 'n1', to: 'n2' }] }));
    const d = readEngine('e', root).draft;
    assert.equal(d?.engine?.nodes.length, 2);
    assert.throws(() => applyDraft('e', 'old-version', root), /바뀌었다/);
    const a = applyDraft('e', r.version, root);
    assert.equal(a.engine?.nodes[1].command, 'pytest');
    assert.equal(a.draft, null);   // 적용하면 초안 파일은 지운다
    writeFileSync(join(root, 'e/draft.json'), '{ 깨짐');
    assert.ok(readEngine('e', root).draft?.errors.length);
    assert.equal(discardDraft('e', root).draft, null);
    writeFileSync(join(out, 'secret.json'), '{}');
    symlinkSync(join(out, 'secret.json'), join(root, 'e/draft.json'));
    assert.equal(readEngine('e', root).draft, null);   // 링크는 읽지 않는다
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }); }
});

test('런(kind run) — 돌릴 엔진 하나 · 노드 없음, 만들 때 엔진을 확인하고, 런이 돌리는 엔진은 지우지 않는다', () => {
  const root = mkdtempSync(join(tmpdir(), 'edith-run-')), trash = join(root, '..', `${root.split('/').pop()}-trash`);
  try {
    assert.deepEqual(check({ name: '개발', kind: 'run', engine: 'dev', nodes: [], edges: [], input: ' 기획서 주소 ', unattended: true, workdir: { kind: 'fixed', dir: '~/w' } }),
      { name: '개발', kind: 'run', engine: 'dev', nodes: [], edges: [], workdir: { kind: 'fixed', dir: '~/w' }, input: '기획서 주소', unattended: true });
    assert.ok((check({ name: 'r', kind: 'run', nodes: [] }) as string[]).some(e => e.includes('engine')));
    assert.ok((check({ name: 'r', kind: 'run', engine: 'e', nodes: [node('a')] }) as string[]).some(e => e.includes('노드를 넣지 않는다')));
    createEngine('flow', '흐름', 'engine', root);
    assert.throws(() => createEngine('r0', '런', 'run', root, 'none'), /돌릴 엔진/);
    const r = createEngine('run-dev', '개발', 'run', root, 'flow');
    assert.deepEqual([r.engine?.kind, r.engine?.engine], ['run', 'flow']);
    assert.throws(() => createEngine('r1', '런의 런', 'run', root, 'run-dev'), /런 말고/);
    assert.deepEqual(listEngines(root).map(e => [e.id, e.kind, e.engine, e.uses]), [['flow', 'engine', undefined, []], ['run-dev', 'run', 'flow', []]]);
    assert.throws(() => removeEngine('flow', root, trash), /런 「개발」/);
    removeEngine('run-dev', root, trash);
    removeEngine('flow', root, trash);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(trash, { recursive: true, force: true }); }
});

test('엔진 지우기 — 쓰는 엔진이 있으면 거절, 지우면 휴지통으로', () => {
  const root = mkdtempSync(join(tmpdir(), 'edith-rm-')), trash = join(root, '..', `${root.split('/').pop()}-trash`);
  try {
    createEngine('inner', '안쪽', 'chain', root);
    const flow = createEngine('flow', '흐름', 'engine', root);
    assert.equal(flow.engine?.kind, 'engine');
    saveEngine('flow', { name: '흐름', kind: 'engine', nodes: [{ id: 'n1', title: 'n1', skill: null, engine: 'inner', x: 0, y: 0 }], edges: [] }, flow.version, root);
    assert.deepEqual(listEngines(root).map(e => [e.id, e.kind]), [['flow', 'engine'], ['inner', 'chain']]);
    assert.throws(() => removeEngine('inner', root, trash), /「흐름」/);
    const to = removeEngine('flow', root, trash);
    assert.ok(to.startsWith(trash) && readFileSync(join(to, 'engine.json'), 'utf8').includes('흐름'));
    assert.deepEqual(listEngines(root).map(e => e.id), ['inner']);
    removeEngine('inner', root, trash);   // 이제 쓰는 엔진이 없다
    assert.throws(() => removeEngine('inner', root, trash), /공방에 없다/);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(trash, { recursive: true, force: true }); }
});

test('목록 — uses 는 체인 · 엔진 노드(노드 순서, 반복 그대로), 초안이 있으면 초안의 이름 · 짜임', () => {
  const root = mkdtempSync(join(tmpdir(), 'edith-uses-'));
  try {
    createEngine('a', '가', 'chain', root);
    createEngine('b', '나', 'engine', root);
    const top = createEngine('top', '위', 'engine', root);
    const n = (id: string, engine?: string) => ({ id, title: id, skill: null, ...(engine ? { engine } : { command: 'true' }), x: 0, y: 0 });
    saveEngine('top', { name: '위', kind: 'engine', nodes: [n('n1', 'b'), n('n2'), n('n3', 'a'), n('n4', 'a')], edges: [] }, top.version, root);
    writeFileSync(join(root, 'a/draft.json'), JSON.stringify({ nodes: [] }));
    writeFileSync(join(root, 'b/draft.json'), JSON.stringify({ name: '나 새 이름', nodes: [n('m1', 'a')], edges: [] }));
    const got = Object.fromEntries(listEngines(root).map(e => [e.id, [e.name, e.uses, e.draft, e.nodes]]));
    assert.deepEqual(got, { a: ['가', [], true, 0], b: ['나 새 이름', ['a'], true, 0], top: ['위', ['b', 'a', 'a'], false, 4] });   // 노드 수는 적용된 것
    writeFileSync(join(root, 'top/draft.json'), '{ 깨짐');
    assert.deepEqual(listEngines(root).find(e => e.id === 'top')?.uses, ['b', 'a', 'a']);   // 깨진 초안이면 적용된 짜임
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('공방 Claude 안내 — EDITH 가 맡는다: 다르면 새로 쓰고, 공방 폴더가 없으면 만들지 않는다', () => {
  const root = mkdtempSync(join(tmpdir(), 'edith-guide-'));
  try {
    syncGuide(join(root, 'none'));
    assert.ok(!existsSync(join(root, 'none')));
    writeFileSync(join(root, 'CLAUDE.md'), '옛 안내');
    syncGuide(root);
    const g = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
    assert.match(g, /workshop\/engine-skill\.md/);   // 엔진 만들기 스킬을 레포 경로로 가리킨다
  } finally { rmSync(root, { recursive: true, force: true }); }
});
