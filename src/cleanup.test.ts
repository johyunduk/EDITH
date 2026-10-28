import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanFix, cleanPlan, cleanRun, cleanStart, cleanState, contentIn, parseLines, runSpacesOf, spacesOf, type Space } from './cleanup.ts';
import { importItems, loadStore } from './deploy.ts';

// 사용자 git 설정(서명 · 훅)에 기대지 않게 — 시험 동안 빈 설정과 이름만
const cfg = mkdtempSync(join(tmpdir(), 'edith-clean-cfg-'));
writeFileSync(join(cfg, 'gitconfig'), '');
Object.assign(process.env, { GIT_CONFIG_GLOBAL: join(cfg, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });

// 시험 레포 — feature 는 master 에 머지됨(워크트리 wt 에 꺼내 둠), merge/feature 는 feature + dev(dev 에 올라감),
// pick 은 master 에 체리픽으로만 들어감(해시가 다르다), early 는 아직 어디에도 없다
function repo() {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'edith-clean-test-'))), o = join(d, 'origin.git'), r = join(d, 'repo'), wt = join(d, 'wt');
  const g = (...a: string[]) => execFileSync('git', ['-C', r, ...a], { encoding: 'utf8' }).trim();
  const put = (f: string, t: string) => writeFileSync(join(r, f), t);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'master', o]);
  execFileSync('git', ['clone', '-q', o, r], { stdio: 'ignore' });
  put('a.txt', 'a\n'); g('add', '.'); g('commit', '-qm', 'base'); g('push', '-q', 'origin', 'master');
  g('branch', 'dev'); g('branch', 'stage');
  g('checkout', '-qb', 'feature'); put('f.txt', 'f\n'); g('add', '.'); g('commit', '-qm', 'feat');
  g('checkout', '-qb', 'pick', 'master'); put('p.txt', 'p\n'); g('add', '.'); g('commit', '-qm', 'pick');
  g('checkout', '-qb', 'early', 'master'); put('e.txt', 'e\n'); g('add', '.'); g('commit', '-qm', 'early');
  g('checkout', '-qb', 'merge/feature', 'dev'); g('merge', '-q', '--no-ff', '-m', 'feature → dev', 'feature');
  g('checkout', '-q', 'dev'); g('merge', '-q', '--ff-only', 'merge/feature');
  g('checkout', '-q', 'master'); g('merge', '-q', '--no-ff', '-m', 'feature → master', 'feature'); g('cherry-pick', 'pick');
  g('push', '-q', 'origin', 'master', 'dev', 'stage');
  g('worktree', 'add', '-q', wt, 'feature');
  return { d, r, wt, file: join(d, 'deploy.json'), done: () => rmSync(d, { recursive: true, force: true }) };
}

test('contentIn — 해시가 아니라 내용으로: 머지 · 체리픽은 들어감, 안 들어간 브랜치 · 없는 곳은 아니다', async () => {
  const r = repo();
  try {
    assert.equal(await contentIn(r.r, 'origin/master', 'feature'), true);
    assert.equal(await contentIn(r.r, 'origin/master', 'pick'), true, '체리픽은 해시가 달라도 들어간 것');
    assert.equal(await contentIn(r.r, 'origin/master', 'early'), false);
    assert.equal(await contentIn(r.r, 'origin/dev', 'merge/feature'), true);
    assert.equal(await contentIn(r.r, 'origin/nope', 'feature'), null);
  } finally { r.done(); }
});

test('spacesOf — 워크트리 자리이거나 pane 이 모두 안이면 그 워크스페이스, 일부만 안이면 섞인 것', () => {
  const all: Space[] = [
    { id: 'a', label: '기능', busy: false, home: '/w/feature', cwds: ['/w/feature'] },
    { id: 'b', label: '셸', busy: false, cwds: ['/w/feature/src', '/w/feature'] },
    { id: 'c', label: '여럿', busy: false, cwds: ['/w/feature', '/home'] },
    { id: 'd', label: '옆', busy: false, cwds: ['/w/feature-2'] },
  ];
  const { mine, mixed } = spacesOf(all, '/w/feature');
  assert.deepEqual(mine.map(s => s.id), ['a', 'b']);
  assert.deepEqual(mixed.map(s => s.id), ['c']);
});

test('runSpacesOf — 끝난 런 pane 이 든 워크스페이스만, 런 밖 pane 이 있거나 일하는 중이면 남긴다', () => {
  const all: Space[] = [
    { id: 'r', label: '▶ 런 #3', busy: false, cwds: ['/w'], panes: ['r:p1', 'r:p2'] },
    { id: 'x', label: '▶ 런 #3 · 갈래', busy: false, cwds: ['/w', '/home'], panes: ['x:p1', 'x:p2'] },
    { id: 'b', label: '▶ 런 #3 · 다른 갈래', busy: true, cwds: ['/w'], panes: ['b:p1'] },
    { id: 'o', label: '다른 일', busy: false, cwds: ['/w'], panes: ['o:p1'] },
    { id: 'n', label: '옛 꼴', busy: false, cwds: ['/w'] },
  ];
  const { mine, kept } = runSpacesOf(all, ['r:p1', 'r:p2', 'x:p1', 'b:p1']);
  assert.deepEqual(mine.map(s => s.id), ['r']);
  assert.deepEqual(kept.map(s => s.id), ['x', 'b']);
});

test('parseLines — 마지막 줄의 JSON 만, 틀린 줄은 버린다', () => {
  assert.deepEqual(parseLines('진행 글\n{"lines":[{"what":"작업 문서","ref":"x.notes","ok":true,"check":"문서에 다 있음"},{"what":"틀림","ok":"yes"}]}\n'),
    [{ what: '작업 문서', ref: 'x.notes', ok: true, check: '문서에 다 있음' }]);
  assert.deepEqual(parseLines('JSON 아님'), []);
});

test('정리 — 미리보기에서 걸리면 아무것도 안 지우고, 통과하면 워크스페이스 · 워크트리 · 로컬 브랜치를 치우고 보관한다', async () => {
  const r = repo();
  try {
    await importItems(JSON.stringify({ items: [{ repo: r.r, branch: 'feature', tag: '기능' }, { repo: r.r, branch: 'early', tag: '이른' }] }), r.file);
    const [feat, early] = loadStore(r.file).items.map(x => x.id);
    const ws = async (): Promise<Space[]> => [{ id: 'w1', label: '기능', busy: false, home: r.wt, cwds: [r.wt] }];
    // 커밋 안 한 파일이 있으면 멈춘다
    writeFileSync(join(r.wt, 'tmp.txt'), 'x');
    let [p] = await cleanPlan({ ids: [feat] }, r.file, ws, null);
    assert.equal(p.ok, false);
    assert.match(p.lines.find(l => l.what === '원본')!.check, /커밋 안 한 파일 1/);
    rmSync(join(r.wt, 'tmp.txt'));
    // 엔진 훅이 막으면 멈춘다(확인 출력의 ok:false)
    const hook = { dir: r.d, action: { label: '정리', command: `echo '{"lines":[{"what":"작업 문서","ref":"feature.notes","ok":false,"check":"문서에 없음"}]}'` } };
    [p] = await cleanPlan({ ids: [feat] }, r.file, ws, hook);
    assert.deepEqual([p.ok, p.lines.at(-1)!.check], [false, '문서에 없음']);
    // 안 들어간 브랜치는 멈춘다
    const [e] = await cleanPlan({ ids: [early] }, r.file, ws, null);
    assert.match(e.lines[0].check, /master 에 아직 없는 변경/);
    // 통과 — 원본(워크트리 · 워크스페이스 · 브랜치)과 dev 머지 브랜치
    [p] = await cleanPlan({ ids: [feat] }, r.file, ws, null);
    assert.equal(p.ok, true);
    assert.deepEqual(p.lines.map(l => [l.what, l.ref, l.check]), [['원본', 'feature', '코드 master 에 있음'], ['dev 머지', 'merge/feature', '코드 dev 에 있음']]);
    const closed: string[] = [];
    const res = await cleanRun({ ids: [feat, early] }, r.file, ws, async id => { closed.push(id); }, null);
    assert.deepEqual(closed, ['w1']);
    assert.equal(existsSync(r.wt), false, '워크트리를 지웠다');
    const heads = execFileSync('git', ['-C', r.r, 'branch', '--format=%(refname:short)'], { encoding: 'utf8' }).split('\n').filter(Boolean).sort();
    assert.deepEqual(heads, ['dev', 'early', 'master', 'pick', 'stage'], 'feature · merge/feature 만 지웠다(원격은 그대로)');
    assert.equal(res.done.length, 1);
    assert.match(res.stopped[0], /early — master 에 아직 없는 변경/);
    const s = loadStore(r.file).items;
    assert.ok(s.find(x => x.id === feat)!.done, '보관했다');
    assert.equal(s.find(x => x.id === early)!.done, undefined);
    assert.match(s.find(x => x.id === feat)!.log.at(-1)!.text, /^정리 — 워크트리 1 · 워크스페이스 1 · 로컬 브랜치 2/);
  } finally { r.done(); }
});

test('미리보기는 뒤에서 — 시작하면 바로 돌아오고 상태로 받는다, 정리는 그 훅 확인을 다시 쓴다(느린 확인은 한 번)', async () => {
  const r = repo();
  try {
    await importItems(JSON.stringify({ items: [{ repo: r.r, branch: 'feature', tag: '기능' }] }), r.file);
    const id = loadStore(r.file).items[0].id, count = join(r.d, 'checks');
    const ws = async (): Promise<Space[]> => [];
    // check 때마다 한 줄 남기고 통과, run 은 그냥 끝
    const hook = { dir: r.d, action: { label: '정리', command: `if [ "$EDITH_CLEAN_MODE" = check ]; then echo x >> "${count}"; echo '{"lines":[{"what":"작업 문서","ref":"a.notes","ok":true,"check":"문서에 다 있음"}]}'; fi` } };
    assert.deepEqual(cleanState(id), { missing: true });
    cleanStart({ ids: [id] }, r.file, ws, hook);
    assert.equal(cleanStart({ ids: [id] }, r.file, ws, hook).key, id, '보는 중이면 같은 일');
    let st = cleanState(id);
    for (let i = 0; i < 100 && !st.done; i++) { await new Promise(ok => setTimeout(ok, 50)); st = cleanState(id); }
    assert.equal(st.plans?.[0].ok, true);
    assert.equal(st.plans?.[0].lines.at(-1)?.check, '문서에 다 있음');
    const res = await cleanRun({ ids: [id] }, r.file, ws, async () => {}, hook);
    assert.equal(res.done.length, 1);
    assert.equal(readFileSync(count, 'utf8').trim().split('\n').length, 1, '정리 때 훅 확인을 다시 돌리지 않았다');
  } finally { r.done(); }
});

test('넘기고 정리 — 엔진이 넘겨도 된다고 한 확인(skippable)만, 사람이 그 항목을 골랐을 때만. EDITH 자신의 확인은 못 넘긴다', async () => {
  const r = repo();
  try {
    assert.deepEqual(parseLines('{"lines":[{"what":"작업 문서","ref":"a","ok":false,"check":"문서에 없음","skippable":true},{"what":"b","ref":"b","ok":false,"check":"x","skippable":"yes"}]}').map(l => l.skippable), [true, undefined]);
    await importItems(JSON.stringify({ items: [{ repo: r.r, branch: 'feature', tag: '기능' }] }), r.file);
    const id = loadStore(r.file).items[0].id, ws = async (): Promise<Space[]> => [];
    const hook = { dir: r.d, action: { label: '정리', command: `if [ "$EDITH_CLEAN_MODE" = check ]; then echo '{"lines":[{"what":"작업 문서","ref":"a.notes","ok":false,"check":"문서에 없음 — 2건","skippable":true}]}'; fi` } };
    // 커밋 안 한 파일(EDITH 확인)이 같이 걸리면 넘기기로 해도 멈춘다
    writeFileSync(join(r.wt, 'tmp.txt'), 'x');
    let res = await cleanRun({ ids: [id], skip: [id] }, r.file, ws, async () => {}, hook);
    assert.match(res.stopped[0], /커밋 안 한 파일 1/);
    rmSync(join(r.wt, 'tmp.txt'));
    // 넘기기로 안 하면 멈춘다
    res = await cleanRun({ ids: [id] }, r.file, ws, async () => {}, hook);
    assert.match(res.stopped[0], /문서에 없음 — 2건/);
    assert.equal(existsSync(r.wt), true);
    // 넘기기로 하면 치우고, 기록에 넘긴 확인을 남긴다
    res = await cleanRun({ ids: [id], skip: [id] }, r.file, ws, async () => {}, hook);
    assert.equal(res.done.length, 1);
    assert.equal(existsSync(r.wt), false);
    assert.match(loadStore(r.file).items[0].log.at(-1)!.text, /넘긴 확인: 문서에 없음 — 2건/);
  } finally { r.done(); }
});

test('고치기 — 훅이 단추(fix)를 단 걸린 줄만, 그 줄을 fix 모드로 훅에 넘기고 마지막 줄을 남긴다(창을 다시 열어도)', async () => {
  const r = repo();
  try {
    await importItems(JSON.stringify({ items: [{ repo: r.r, branch: 'feature', tag: '기능' }] }), r.file);
    const id = loadStore(r.file).items[0].id, ws = async (): Promise<Space[]> => [], got = join(r.d, 'fix-env');
    const hook = { dir: r.d, action: { label: '정리', command: `case "$EDITH_CLEAN_MODE" in
      check) echo '{"lines":[{"what":"작업 문서","ref":"a.notes","ok":false,"check":"문서에 없음 — 1건","parts":"- 결과 표","skippable":true,"fix":"문서에 반영"},{"what":"작업 문서","ref":"b.notes","ok":false,"check":"문서에 없음 — 1건"}]}';;
      fix) printf '%s|%s|%s' "$EDITH_CLEAN_REF" "$EDITH_CLEAN_DETAIL" "$EDITH_CLEAN_BRANCH" > "${got}"; echo '도우미에게 맡겼다';;
    esac` } };
    assert.equal(parseLines('{"lines":[{"what":"a","ref":"a","ok":false,"check":"x","fix":"  반영  "}]}')[0].fix, '반영');
    await assert.rejects(cleanFix({ id, ref: 'a.notes' }, r.file, hook), /고칠 줄을 못 찾았다/, '미리보기 전에는 못 고친다');
    cleanStart({ ids: [id] }, r.file, ws, hook);
    let st = cleanState(id);
    for (let i = 0; i < 100 && !st.done; i++) { await new Promise(ok => setTimeout(ok, 50)); st = cleanState(id); }
    await assert.rejects(cleanFix({ id, ref: 'b.notes' }, r.file, hook), /고칠 줄을 못 찾았다/, '단추가 없는 줄');
    const f = await cleanFix({ id, ref: 'a.notes' }, r.file, hook);
    assert.deepEqual([f.ok, f.text], [true, '도우미에게 맡겼다']);
    assert.equal(readFileSync(got, 'utf8'), 'a.notes|문서에 없음 — 1건\n- 결과 표|feature');
    assert.equal(cleanState(id).fixes?.[`${id}\na.notes`]?.text, '도우미에게 맡겼다');
  } finally { r.done(); }
});
