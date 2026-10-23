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
  } finally { r.done(); }
});
