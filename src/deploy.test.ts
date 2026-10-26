import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkTask, promoteMany, cliAdd, cliBlock, cliCheck, cliDone, cliDrop, cliNote, cliRange, cliSet, cliShow, cliTask, deployDone, deployView, editItems, importItems, loadStore, markWait, parseStore, prepareMerge, promote } from './deploy.ts';
import type { ReachAction } from './reach.ts';

// 사용자 git 설정(서명 · 훅)에 기대지 않게 — 시험 동안 빈 설정과 이름만
const cfg = mkdtempSync(join(tmpdir(), 'edith-deploy-cfg-'));
writeFileSync(join(cfg, 'gitconfig'), '');
Object.assign(process.env, { GIT_CONFIG_GLOBAL: join(cfg, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });

// 시험 레포 — origin(bare)에 master · dev · stage. feature 는 dev 에 들어감, clash 는 dev 에 들어갔지만 stage 와 충돌, early 는 dev 에 아직
function repo() {
  const d = mkdtempSync(join(tmpdir(), 'edith-deploy-test-')), o = join(d, 'origin.git'), r = join(d, 'repo');
  const g = (...a: string[]) => execFileSync('git', ['-C', r, ...a], { encoding: 'utf8' }).trim();
  const put = (f: string, t: string) => writeFileSync(join(r, f), t);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'master', o]);
  execFileSync('git', ['clone', '-q', o, r], { stdio: 'ignore' });
  put('a.txt', 'a\n'); g('add', '.'); g('commit', '-qm', 'base'); g('push', '-q', 'origin', 'master');
  g('branch', 'dev'); g('branch', 'stage');
  g('checkout', '-qb', 'feature'); put('f.txt', 'f\n'); g('add', '.'); g('commit', '-qm', 'feat: 기능');
  g('checkout', '-qb', 'clash', 'master'); put('a.txt', 'clash\n'); g('commit', '-qam', 'fix: 충돌 날 고침');
  g('checkout', '-qb', 'early', 'master'); put('e.txt', 'e\n'); g('add', '.'); g('commit', '-qm', 'feat: 아직 dev 전');
  g('checkout', '-q', 'dev'); g('merge', '-q', '--no-ff', '-m', 'feature → dev', 'feature'); g('merge', '-q', '--no-ff', '-m', 'clash → dev', 'clash');
  g('checkout', '-q', 'stage'); put('a.txt', 'stage only\n'); g('commit', '-qam', 'stage 에서 바로 고침');
  g('push', '-q', 'origin', 'dev', 'stage');
  g('checkout', '-q', 'master');
  const file = join(d, 'deploy.json');
  return { d, r, o, file, done: () => rmSync(d, { recursive: true, force: true }) };
}

test('parseStore — 틀린 항목 · 칸은 빼고, 없는 환경 이름의 할 일은 버린다', () => {
  const s = parseStore(JSON.stringify({ rev: 3, items: [
    { repo: '/r', branch: 'feature/a', tag: '포인트', date: '2026-10-30', tasks: [{ env: 'stage', text: '마이그레이션', done: true }, { env: 'qa', text: '없는 환경' }], block: { base: 'abc1234', end: 'def5678', made: '10/23' } },
    { repo: 'relative', branch: 'x' }, { repo: '/r', branch: '-rf' }, { repo: '/r', branch: 'b', date: '10/30' },
  ] }));
  assert.equal(s.rev, 3);
  assert.deepEqual(s.items.map(x => x.branch), ['feature/a', 'b']);
  assert.deepEqual(s.items[0].tasks, [{ env: 'stage', text: '마이그레이션', done: true }]);
  assert.equal(s.items[1].date, undefined);
  assert.deepEqual(parseStore('{깨짐').items, []);
});

test('고치기 — 판(rev)이 다르면 막고, 배포일 · 할 일 체크는 기록에 남긴다', async () => {
  const r = repo();
  try {
    await importItems(JSON.stringify({ items: [{ repo: r.r, branch: 'feature', tag: '기능', tasks: [{ env: 'prod', text: '운영 확인' }] }] }), r.file);
    const s = loadStore(r.file), id = s.items[0].id;
    assert.ok(s.items[0].start, '가져올 때 시작 커밋을 정한다');
    assert.throws(() => editItems({ rev: s.rev - 1, ids: [id], date: '2026-10-30' }, r.file), /그사이/);
    const { rev } = editItems({ rev: s.rev, ids: [id], date: '2026-10-30' }, r.file);
    assert.throws(() => checkTask({ rev, id, env: 'prod', text: '운영 확인', was: true }, r.file), /그사이 체크/);
    checkTask({ rev, id, env: 'prod', text: '운영 확인', was: false }, r.file);
    const x = loadStore(r.file).items[0];
    assert.equal(x.date, '2026-10-30');
    assert.equal(x.tasks[0].done, true);
    assert.deepEqual(x.log.map(l => l.text.split(' — ')[0]), ['가져옴', '배포일 10/30 넣음', 'prod 할 일 체크']);
  } finally { r.done(); }
});

test('상태 · 올리기 — dev 에 든 것만 stage 에, 충돌 · dev 전 · 운영은 올리지 않는다', async () => {
  const r = repo();
  try {
    await importItems(JSON.stringify({ items: ['feature', 'clash', 'early'].map(branch => ({ repo: r.r, branch })) }), r.file);
    const v = await deployView(r.file), st = (b: string) => v.items.find(x => x.branch === b)!.state!;
    assert.deepEqual(st('feature').envs.map(e => e.state), ['in', 'none', 'none']);
    assert.equal(st('clash').envs[1].conflicts, 1);
    assert.equal(st('feature').envs[1].conflicts, 0);
    const id = (b: string) => v.items.find(x => x.branch === b)!.id;
    await assert.rejects(promote({ id: id('clash'), env: 'stage' }, r.file), /충돌 1곳: a\.txt/);
    await assert.rejects(promote({ id: id('early'), env: 'stage' }, r.file), /아직 dev/);
    await assert.rejects(promote({ id: id('feature'), env: 'prod' }, r.file), /올리지 않는다/);
    // 안건 단위 — 묶음의 한 레포라도 충돌하면 아무것도 안 올린다(origin 의 stage 그대로)
    const was = execFileSync('git', ['-C', r.o, 'rev-parse', 'stage'], { encoding: 'utf8' }).trim();
    await assert.rejects(promoteMany({ ids: [id('feature'), id('clash')], env: 'stage' }, r.file), /stage 에 아무 레포도 올리지 않았다\n.*clash — stage 와 충돌 1곳/);
    assert.equal(execFileSync('git', ['-C', r.o, 'rev-parse', 'stage'], { encoding: 'utf8' }).trim(), was);
    const ok = await promote({ id: id('feature'), env: 'stage' }, r.file);
    assert.match(ok.text, /feature → origin\/stage/);
    // origin 의 stage 가 feature 를 품은 머지 커밋 — stage 에서 바로 고친 것도 그대로
    const o = (...a: string[]) => execFileSync('git', ['-C', r.o, ...a], { encoding: 'utf8' }).trim();
    assert.equal(o('rev-parse', 'stage^2'), execFileSync('git', ['-C', r.r, 'rev-parse', 'feature'], { encoding: 'utf8' }).trim());
    assert.equal(o('log', '-1', '--format=%s', 'stage'), "Merge branch 'feature' into stage");
    assert.equal(o('show', 'stage:a.txt'), 'stage only');
    assert.match((await promote({ id: id('feature'), env: 'stage' }, r.file)).text, /이미 stage/);
    assert.match(loadStore(r.file).items.find(x => x.branch === 'feature')!.log.at(-1)!.text, /^stage 에 올림/);
  } finally { r.done(); }
});

test('단추 ready · until — 머지 브랜치에 원본 최신 · 단추 칸(origin/dev)이 다 들어 있어야 dev 로 푸시가 켜지고, 그때 dev 머지 준비는 막힌다', async () => {
  const r = repo(), g = (...a: string[]) => execFileSync('git', ['-C', r.r, ...a], { encoding: 'utf8' }).trim();
  try {
    const tip = g('rev-parse', 'early'), x = { repo: r.r, branch: 'early', state: { tip } };
    const act = () => [{ n: 0, label: 'dev 로 푸시', reach: 'origin/dev', command: 'true', ready: 'merge/{tail}' }, { n: 1, label: 'dev 머지 준비', reach: 'origin/dev', command: 'true', until: 'merge/{tail}' },
      { n: 2, label: '푸시', reach: 'push', command: 'true' }] as ReachAction[];
    let a = act(); await markWait(x, a);
    assert.equal(a[0].wait, 'merge/early 가 아직 없다 — 앞 단추 먼저');
    assert.equal(a[1].wait, undefined);
    assert.equal(a[2].wait, undefined);   // ready · until 없는 단추는 그대로
    g('branch', 'merge/early', 'master');
    a = act(); await markWait(x, a);
    assert.equal(a[0].wait, 'merge/early 에 early 최신이 아직 없다 — 앞 단추 먼저');
    g('branch', '-f', 'merge/early', 'early');
    a = act(); await markWait(x, a);
    assert.equal(a[0].wait, 'merge/early 에 origin/dev 최신이 아직 없다 — 앞 단추 먼저');
    assert.equal(a[1].wait, undefined);
    g('checkout', '-q', 'merge/early'); g('merge', '-q', '--no-edit', 'origin/dev'); g('checkout', '-q', 'master');
    a = act(); await markWait(x, a);
    assert.equal(a[0].wait, undefined);
    assert.equal(a[1].wait, '이미 했다 — merge/early 에 다 들어 있다. 다음 단추로');
  } finally { r.done(); }
});

test('stage 머지 준비 — 충돌이면 머지 브랜치 워크트리에서 Claude 에 맡기고, 푼 뒤 올리기는 그 커밋을 stage 로', async () => {
  const r = repo(), g = (...a: string[]) => execFileSync('git', ['-C', r.r, ...a], { encoding: 'utf8' }).trim();
  try {
    g('worktree', 'add', '-q', join(r.d, 'clash-wt'), 'clash');   // 항목 워크트리 — 머지 워크트리는 그 옆에
    await importItems(JSON.stringify({ items: [{ repo: r.r, branch: 'clash' }] }), r.file);
    const id = loadStore(r.file).items[0].id;
    await assert.rejects(promote({ id, env: 'stage' }, r.file), /충돌 1곳: a\.txt — 「stage 머지 준비」 로 먼저/);
    const asked: string[] = [];
    const got = await prepareMerge({ id, env: 'stage' }, r.file, async (cwd, label, text) => { asked.push(cwd, label, text); return { pane: 'w1:p1' }; });
    const wt = join(r.d, 'clash-stage-merge');
    assert.equal(realpathSync(asked[0]), realpathSync(wt));
    assert.match(asked[2], /충돌 파일: a\.txt/);
    assert.match(got.text, /충돌 1곳\(a\.txt\) — 새 Claude pane\(w1:p1\)/);
    const w = (...a: string[]) => execFileSync('git', ['-C', wt, ...a], { encoding: 'utf8' }).trim();
    assert.equal(w('rev-parse', '--abbrev-ref', 'HEAD'), 'merge-stage/clash');
    assert.ok(w('rev-parse', '-q', '--verify', 'MERGE_HEAD'), '머지 중으로 남겨 둔다');
    await assert.rejects(promote({ id, env: 'stage' }, r.file), /머지 준비/);   // 아직 안 풀었다
    // Claude 가 푼 셈 — 양쪽을 살려 커밋
    writeFileSync(join(wt, 'a.txt'), 'stage only\nclash\n'); w('add', 'a.txt'); w('commit', '-q', '--no-edit');
    assert.match((await prepareMerge({ id, env: 'stage' }, r.file, async () => { throw new Error('다시 부르지 않는다'); })).text, /이미 준비됐다/);
    const ok = await promote({ id, env: 'stage' }, r.file);
    assert.match(ok.text, /clash → origin\/stage/);
    const o = (...a: string[]) => execFileSync('git', ['-C', r.o, ...a], { encoding: 'utf8' }).trim();
    assert.equal(o('rev-parse', 'stage'), w('rev-parse', 'HEAD'));   // 푼 머지 커밋이 그대로(앞당김)
    assert.equal(o('log', '-1', '--format=%s', 'stage'), "Merge branch 'clash' into stage");
    assert.equal(o('show', 'stage:a.txt'), 'stage only\nclash');
  } finally { r.done(); }
});

test('CLI — 등록(워크트리 경로도 본 레포로) · 메모 · 배포 조치 · 범위 · 블록(체크 살림) · 체크 · 보관 · 지우기', async () => {
  const t = repo(), real = realpathSync(t.r), wt = join(t.d, 'wt');
  try {
    execFileSync('git', ['-C', t.r, 'worktree', 'add', '-q', wt, 'early']);
    assert.match(await cliAdd(wt, 'early', { tag: '아직', notes: ['PROJ-1: 이른 일'] }, t.file), /등록 \[아직\]/);
    await assert.rejects(cliAdd(t.r, 'early', {}, t.file), /이미 있다/);
    await assert.rejects(cliNote(t.r, 'nope', 'x', t.file), /먼저 edith deploy add/);
    await cliNote(wt, 'early', 'ISSUE-2: 안건 QA 이슈', t.file);
    await cliNote(wt, 'early', 'ISSUE-2: 안건 QA 이슈', t.file);   // 같은 줄은 한 번만
    await cliTask(t.r, 'early', '캐시 비우기', undefined, t.file);
    await assert.rejects(cliTask(t.r, 'early', 'x', 'qa', t.file), /없는 환경/);
    let x = loadStore(t.file).items[0];
    assert.equal(x.repo, real);
    assert.deepEqual([x.notes, x.tasks.map(k => k.env)], [['PROJ-1: 이른 일', 'ISSUE-2: 안건 QA 이슈'], ['stage', 'prod']]);
    // 범위 — 블록이 없으면 master 와 갈라진 곳부터 브랜치 끝까지
    const r = await cliRange(wt, 'early', t.file), g = (...a: string[]) => execFileSync('git', ['-C', t.r, ...a], { encoding: 'utf8' }).trim();
    assert.deepEqual([r.path, r.ref, r.base, r.end], [real, 'early', g('merge-base', 'master', 'early'), g('rev-parse', 'early')]);
    // 체크한 줄은 블록을 바꿔도 같은 환경 · 같은 글이면 살아 있다. 블록이 준 환경만 바뀐다
    await cliCheck(t.r, 'early', 'stage', '캐시 비우기', true, t.file);
    writeFileSync(join(t.d, 'b.json'), JSON.stringify({ base: r.base, end: r.end, tasks: { stage: ['캐시 비우기', '마이그레이션'] }, notes: ['SQL 접으며 뺀 것 — 없음'] }));
    assert.match(await cliBlock(t.r, 'early', (await import('node:fs')).readFileSync(join(t.d, 'b.json'), 'utf8'), t.file), /2줄\(살린 체크 1\)/);
    x = loadStore(t.file).items[0];
    assert.deepEqual(x.tasks.map(k => [k.env, k.text, k.done]), [['prod', '캐시 비우기', false], ['stage', '캐시 비우기', true], ['stage', '마이그레이션', false]]);
    assert.deepEqual(x.block?.notes, ['SQL 접으며 뺀 것 — 없음']);
    await assert.rejects(cliBlock(t.r, 'early', '{"base":"x"}', t.file), /base · end/);
    // 보관하면 보기에서 빠지고, 같은 브랜치를 다시 등록할 수 있다. 지우기는 보관 안 한 것만
    await cliDone(t.r, 'early', '2026-10-30', t.file);
    assert.deepEqual(await cliShow(undefined, undefined, t.file), []);
    assert.equal(loadStore(t.file).items[0].done, '2026-10-30');
    await cliAdd(t.r, 'early', {}, t.file);
    assert.match(await cliDrop(t.r, 'early', t.file), /지움/);
    assert.equal(loadStore(t.file).items.length, 1);
    assert.match(await cliDrop(t.r, 'early', t.file), /없다/);
  } finally { t.done(); }
});

test('보관 목록 — 최근 보관부터, 같은 날은 자르지 않고, 찾기 · 더 보기(before)', () => {
  const d = mkdtempSync(join(tmpdir(), 'edith-deploy-done-')), file = join(d, 'deploy.json');
  try {
    const it = (branch: string, done?: string, tag = branch) => ({ id: branch.padEnd(8, '0').slice(0, 8).replace(/[^0-9a-f]/g, 'a'), repo: '/r', branch, tag, notes: [`메모 ${branch}`], tasks: [], log: [], ...(done ? { done } : {}) });
    writeFileSync(file, JSON.stringify({ rev: 1, items: [it('live'), it('a1', '2026-10-01'), it('b1', '2026-10-05'), it('b2', '2026-10-05', '포인트'), it('c1', '2026-10-09')] }));
    assert.deepEqual(deployDone('', undefined, 40, file).items.map(x => x.branch), ['c1', 'b1', 'b2', 'a1']);
    // 둘만 달라 해도 10/05 는 둘 다 — 「더 보기」 는 10/05 앞부터
    const p1 = deployDone('', undefined, 2, file);
    assert.deepEqual([p1.items.map(x => x.branch), p1.more], [['c1', 'b1', 'b2'], '2026-10-05']);
    assert.deepEqual(deployDone('', p1.more!, 2, file), { items: [deployDone('', undefined, 40, file).items[3]], more: null });
    assert.deepEqual(deployDone('포인트', undefined, 40, file).items.map(x => x.branch), ['b2']);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('CLI — 티켓 · 안건 키(같은 안건은 한 카드) 등록 · 바꾸기, 꼴이 틀리면 거절', async () => {
  const t = repo();
  try {
    await cliAdd(t.r, 'early', { tag: '문구', ticket: 'ISSUE-7', agenda: 'PROJ-3' }, t.file);
    let x = loadStore(t.file).items[0];
    assert.deepEqual([x.tag, x.ticket, x.agenda], ['문구', 'ISSUE-7', 'PROJ-3']);
    await assert.rejects(cliAdd(t.r, 'feature', { agenda: '123' }, t.file), /티켓 키 꼴/);
    assert.match(await cliSet(t.r, 'early', { agenda: 'PROJ-1', tag: '' }, t.file), /tag 지움 · agenda PROJ-1/);
    x = loadStore(t.file).items[0];
    assert.deepEqual([x.tag, x.ticket, x.agenda], [undefined, 'ISSUE-7', 'PROJ-1']);
    assert.match(await cliSet(t.r, 'early', {}, t.file), /그대로/);
    await assert.rejects(cliSet(t.r, 'early', { ticket: 'x' }, t.file), /티켓 키 꼴/);
  } finally { t.done(); }
});
