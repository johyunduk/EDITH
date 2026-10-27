import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Check, failingOf, hasMarkers, pull, restoreEolOnly, uncommitted, worktreeModified } from './update.ts';

const git = (cwd: string, ...a: string[]) => {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
// 줄끝 변환 없이(이 PC 의 core.autocrlf 와 무관하게) — 시험이 CRLF · LF 를 그대로 다룬다
const repo = (dir: string) => {
  git(dir, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 't'], ['core.autocrlf', 'false']]) git(dir, 'config', k, v);
};
const commit = (dir: string, files: Record<string, string>, msg: string) => {
  for (const [f, s] of Object.entries(files)) writeFileSync(join(dir, f), s);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', msg);
};
// 받을 곳(up) · 다른 기기(seed) · 이 폴더(me) — seed 가 올린 것을 me 가 받는다
function world() {
  const root = mkdtempSync(join(tmpdir(), 'edith-up-')), up = join(root, 'up'), seed = join(root, 'seed'), me = join(root, 'me');
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main', up]);
  spawnSync('git', ['clone', '-q', '-c', 'core.autocrlf=false', up, seed]);
  repo(seed);
  commit(seed, { 'a.txt': '1\n2\n3\n', 'b.txt': 'b\n' }, 'base');
  git(seed, 'push', '-q', 'origin', 'HEAD:main');
  spawnSync('git', ['clone', '-q', '-c', 'core.autocrlf=false', up, me]);
  repo(me);
  const push = (files: Record<string, string>) => { commit(seed, files, 'up'); git(seed, 'push', '-q', 'origin', 'HEAD:main'); };
  return { root, seed, me, push, done: () => rmSync(root, { recursive: true, force: true }) };
}
const clean: Check = { typecheck: true, build: true, failing: ['원래 실패'] };
const never = () => { throw new Error('겹치지 않았는데 Claude 를 불렀다'); };

test('작업 트리에서만 바뀐 추적 파일 — 스테이징 · 새 파일 · 이름 바꾸기는 빼고, 공백 든 이름도', () => {
  assert.deepEqual(worktreeModified(' M a.ts\0M  b.ts\0?? c.ts\0R  new.ts\0old.ts\0 M d e.ts\0MM f.ts\0'), ['a.ts', 'd e.ts']);
  assert.deepEqual(worktreeModified(''), []);
});

test('시험 결과(TAP) — 맨 위 실패만, 하위 줄은 빼고 · 겹침 표시 찾기', () => {
  assert.deepEqual(failingOf('ok 1 - 가\nnot ok 2 - 나\n    not ok 1 - 하위\nnot ok 3 - 다 # 이유\n'), ['나', '다 # 이유']);
  assert.ok(hasMarkers('a\n<<<<<<< Updated upstream\nx\n=======\ny\n>>>>>>> Stashed changes\n'));
  assert.ok(!hasMarkers('a\n// ======= 구분선 아님 =======\n<<<<<<<< 여덟 개\n'));
});

test('줄끝만 바뀐 파일은 되돌리고 진짜 고침은 둔다', () => {
  const d = mkdtempSync(join(tmpdir(), 'edith-up-'));
  try {
    repo(d);
    commit(d, { 'a.txt': 'x\ny\n', 'b.txt': 'x\ny\n' }, 'base');
    writeFileSync(join(d, 'a.txt'), 'x\r\ny\r\n');   // 편집기가 줄끝만 바꿨다
    writeFileSync(join(d, 'b.txt'), 'x\r\nz\r\n');   // 줄끝 + 진짜 고침
    assert.deepEqual(restoreEolOnly(d), ['a.txt']);
    assert.equal(readFileSync(join(d, 'a.txt'), 'utf8'), 'x\ny\n');
    assert.deepEqual(uncommitted(d), ['b.txt']);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('받기 — 고친 것이 겹치지 않으면 받고 그대로 다시 얹는다(Claude 를 부르지 않는다)', () => {
  const w = world();
  try {
    w.push({ 'b.txt': 'b2\n' });
    writeFileSync(join(w.me, 'a.txt'), '1\nmine\n3\n');
    assert.deepEqual(pull(w.me, false, never, never), { ok: true });
    assert.equal(readFileSync(join(w.me, 'b.txt'), 'utf8'), 'b2\n');
    assert.equal(readFileSync(join(w.me, 'a.txt'), 'utf8'), '1\nmine\n3\n');
    assert.equal(git(w.me, 'stash', 'list'), '');
  } finally { w.done(); }
});

test('같은 줄이 겹치면 — Claude 가 합치고 검사가 통과하면 합친 것을 남기고 stash 를 지운다', () => {
  const w = world();
  try {
    w.push({ 'a.txt': '1\ntheirs\n3\n', 'b.txt': 'b2\n' });
    writeFileSync(join(w.me, 'a.txt'), '1\nmine\n3\n');
    let saw = '';
    const resolve = (cwd: string, files: string[], patch: string) => {
      saw = `${files.join()}|${hasMarkers(readFileSync(join(cwd, 'a.txt'), 'utf8'))}|${patch.includes('+mine')}`;
      writeFileSync(join(cwd, 'a.txt'), '1\ntheirs mine\n3\n');
      return { ok: true, note: '둘 다 살렸다' };
    };
    const r = pull(w.me, false, resolve, () => clean);
    assert.equal(saw, 'a.txt|true|true', '겹친 파일 · 표시 · 고침 diff 를 받는다');
    assert.equal(r.ok, true);
    assert.match(r.note ?? '', /합쳤다\(a\.txt\) — 둘 다 살렸다/);
    assert.equal(readFileSync(join(w.me, 'a.txt'), 'utf8'), '1\ntheirs mine\n3\n');
    assert.equal(readFileSync(join(w.me, 'b.txt'), 'utf8'), 'b2\n');
    assert.equal(git(w.me, 'rev-parse', 'HEAD'), git(w.seed, 'rev-parse', 'HEAD'));
    assert.equal(git(w.me, 'stash', 'list'), '');
    assert.equal(git(w.me, 'diff', '--name-only', '--diff-filter=U'), '', '겹침 상태가 남지 않는다');
    assert.deepEqual(uncommitted(w.me), ['a.txt'], '합친 것은 보통 「커밋 안 된 고침」 으로');
  } finally { w.done(); }
});

test('못 합치면(표시가 남음 · 새로 실패한 시험) — 받은 코드 그대로, 고친 것은 stash 에', () => {
  for (const [name, resolve, check] of [
    ['표시가 남음', () => ({ ok: true, note: '' }), () => clean],
    ['새로 실패한 시험', (cwd: string) => { writeFileSync(join(cwd, 'a.txt'), '1\nx\n3\n'); return { ok: true, note: '' }; },
      (() => { let n = 0; return () => (n++ ? { ...clean, failing: ['원래 실패', '새 실패'] } : clean); })()],
    ['Claude 를 못 띄움', () => ({ ok: false, note: 'Claude 를 띄우지 못했다' }), () => clean],
  ] as const) {
    const w = world();
    try {
      w.push({ 'a.txt': '1\ntheirs\n3\n' });
      writeFileSync(join(w.me, 'a.txt'), '1\nmine\n3\n');
      const r = pull(w.me, false, resolve, check);
      assert.equal(r.ok, true, `${name}: 받은 코드로 계속 간다`);
      assert.match(r.note ?? '', /합치지 못해 받은 코드 그대로/, name);
      assert.equal(readFileSync(join(w.me, 'a.txt'), 'utf8'), '1\ntheirs\n3\n', name);
      assert.deepEqual(uncommitted(w.me), [], `${name}: 작업 트리는 받은 코드 그대로`);
      assert.match(git(w.me, 'stash', 'show', '-p'), /\+mine/, `${name}: 고친 것은 stash 에`);
    } finally { w.done(); }
  }
});
