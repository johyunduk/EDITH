import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reachOf } from './reach.ts';

// 시험 레포 — master 에서 딴 feature(a.txt 고침 · b.txt 새로)를 브랜치마다 다르게 들인다
function repo() {
  const d = mkdtempSync(join(tmpdir(), 'edith-reach-test-'));
  const g = (...a: string[]) => execFileSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }).trim();
  const put = (f: string, t: string) => writeFileSync(join(d, f), t);
  g('init', '-q', '-b', 'master');
  put('a.txt', 'a\n'); put('keep.txt', 'k\n'); g('add', '.'); g('commit', '-qm', 'base');
  const start = g('rev-parse', 'HEAD');
  g('checkout', '-qb', 'feature');
  put('a.txt', 'a2\n'); g('commit', '-qam', 'feat: 관리자 메모 칸');
  put('b.txt', 'b\n'); g('add', 'b.txt'); g('commit', '-qm', 'feat: 메모 저장 API');
  // dev — 머지 커밋으로(커밋 그대로)
  g('checkout', '-qb', 'dev', 'master'); g('merge', '-q', '--no-ff', '-m', 'Merge feature into dev', 'feature');
  // stage — 스쿼시(해시 다름, 내용 같음)
  g('checkout', '-qb', 'stage', 'master'); g('merge', '-q', '--squash', 'feature'); g('commit', '-qm', 'squash feature');
  // part — a.txt 만 들어감(5개 중 몇 개만 같은 것)
  g('checkout', '-qb', 'part', 'master'); put('a.txt', 'a2\n'); g('commit', '-qam', 'only a');
  // later — 같은 제목으로 들어간 뒤 두 파일 다 더 고침(제목만 같음)
  g('checkout', '-qb', 'later', 'master'); put('a.txt', 'a3\n'); put('b.txt', 'b3\n'); g('add', '.'); g('commit', '-qm', 'feat: 관리자 메모 칸 (+고침)');
  // none — 아무것도 안 들어감
  g('checkout', '-qb', 'none', 'master'); put('keep.txt', 'k2\n'); g('commit', '-qam', 'other work');
  g('checkout', '-q', 'feature');
  return { d, start, done: () => rmSync(d, { recursive: true, force: true }) };
}

test('reachOf — 커밋 그대로 · 내용 일치 · 일부 · 제목만 · 없음 · 브랜치 없음', async () => {
  const r = repo();
  try {
    const dev = await reachOf(r.d, r.start, 'dev');
    assert.equal(dev.state, 'in'); assert.equal(dev.how, 'merge'); assert.ok(dev.at);
    assert.equal((await reachOf(r.d, r.start, 'stage')).state, 'content');
    const part = await reachOf(r.d, r.start, 'part');
    assert.deepEqual([part.state, part.k, part.n, part.missing], ['partial', 1, 2, ['b.txt']]);
    const later = await reachOf(r.d, r.start, 'later');
    assert.deepEqual([later.state, later.subject], ['subject', 'feat: 관리자 메모 칸']);
    assert.equal((await reachOf(r.d, r.start, 'none')).state, 'none');
    assert.equal((await reachOf(r.d, r.start, 'origin/nope')).state, 'missing');
    // fast-forward — feature 자체(조상이고 머지 없음)
    const ff = await reachOf(r.d, r.start, 'feature');
    assert.deepEqual([ff.state, ff.how], ['in', 'ff']);
    // 같은 커밋을 가리키는 다른 브랜치 — 기억해 둔 결과를 써도 이름은 그 브랜치 것(stage = master 인 레포에서 칸 이름이 겹치던 것)
    execFileSync('git', ['-C', r.d, 'branch', 'dev-copy', 'dev']);
    assert.deepEqual([(await reachOf(r.d, r.start, 'dev-copy')).ref, (await reachOf(r.d, r.start, 'dev')).ref], ['dev-copy', 'dev']);
  } finally { r.done(); }
});

// 되돌림 — feature(a.txt 둘째 줄 고침 · b.txt 새로)를 master 에 머지한 뒤 브랜치마다 다르게 되돌린다. 조상은 그대로라 지금까지는 다 「들어감」 이었다
test('reachOf — 조상이어도 뒤에서 되돌렸으면 되돌려짐(전부 · 일부), 되돌림의 되돌림 · 뒤에 고친 것은 들어감', async () => {
  const d = mkdtempSync(join(tmpdir(), 'edith-reach-revert-'));
  const g = (...a: string[]) => execFileSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }).trim();
  const put = (f: string, t: string) => writeFileSync(join(d, f), t);
  try {
    g('init', '-q', '-b', 'master');
    put('a.txt', '1\n2\n3\n4\n5\n6\n7\n8\n'); g('add', '.'); g('commit', '-qm', 'base');
    const start = g('rev-parse', 'HEAD');
    g('checkout', '-qb', 'feature'); put('a.txt', '1\n2-feat\n3\n4\n5\n6\n7\n8\n'); put('b.txt', 'b\n'); g('add', '.'); g('commit', '-qm', 'feat: 메모 칸');
    g('checkout', '-q', 'master'); g('merge', '-q', '--no-ff', '-m', 'feature → master', 'feature');
    const merged = g('rev-parse', 'HEAD');
    // 머지 커밋 되돌림(GitHub 「Revert」 꼴) — 새 파일도 지워진다
    g('checkout', '-qb', 'rv', merged); g('revert', '--no-edit', '-m', '1', merged);
    // 한 파일만 손으로 원래대로
    g('checkout', '-qb', 'rv-part', merged); put('a.txt', '1\n2\n3\n4\n5\n6\n7\n8\n'); g('commit', '-qam', 'a.txt 원래대로');
    // 되돌린 뒤 다른 안건이 같은 파일 딴 곳을 고침 — 되돌린 커밋은 마지막으로 고친 커밋이 아니라 그 되돌림
    g('checkout', '-qb', 'rv-then', 'rv'); put('a.txt', '1\n2\n3\n4\n5\n6\n7\n8-딴 안건\n'); g('commit', '-qam', 'feat: 딴 안건이 a.txt 끝 줄');
    // 되돌린 걸 다시 되돌림
    g('checkout', '-qb', 'rv-rv', 'rv'); g('revert', '--no-edit', 'HEAD');
    // 뒤 안건이 만든 파일(b.txt) · 근처 줄을 고침 — 빼 보면 고침/지움 충돌 · 충돌이라 아직 있음
    g('checkout', '-qb', 'later', merged); put('b.txt', 'b-후속\n'); put('a.txt', '1\n2-feat-후속\n3\n4-후속\n5\n6\n7\n8\n'); g('commit', '-qam', 'fix: 뒤 안건');
    // 뒤 안건이 같은 파일 딴 곳만 — 바꾼 파일이 HEAD 와 달라도 들어감
    g('checkout', '-qb', 'far', merged); put('a.txt', '1\n2-feat\n3\n4\n5\n6\n7\n8-후속\n'); g('commit', '-qam', 'fix: 딴 곳');
    g('checkout', '-q', 'feature');
    const rv = await reachOf(d, start, 'rv');
    assert.deepEqual([rv.state, rv.k, rv.n, rv.missing], ['reverted', 2, 2, ['a.txt', 'b.txt']]);
    assert.match(rv.by!, /^[0-9a-f]{7,} Revert "feature → master"$/); assert.ok(rv.at);
    const then = await reachOf(d, start, 'rv-then');
    assert.deepEqual([then.state, then.k], ['reverted', 2]);
    assert.match(then.by!, /Revert "feature → master"$/, '뒤에 같은 파일을 고친 딴 안건 커밋이 아니라 되돌린 커밋');
    const part = await reachOf(d, start, 'rv-part');
    assert.deepEqual([part.state, part.k, part.n, part.missing], ['reverted', 1, 2, ['a.txt']]);
    assert.match(part.by!, /a\.txt 원래대로$/);
    for (const ref of ['rv-rv', 'later', 'far', 'master']) assert.equal((await reachOf(d, start, ref)).state, 'in', ref);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
