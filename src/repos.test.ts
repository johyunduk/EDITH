import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRepos, repoDiff, repoStatus } from './repos.ts';

test('레포 목록 읽기 — 절대 경로만, 틀린 브랜치 · 기준 이름은 빼고 기준 기본은 origin/master', () => {
  assert.deepEqual(parseRepos(JSON.stringify([{ path: '/a/be', branch: 'feature/x', base: 'origin/dev' }, { path: 'rel' }, { path: '/b', branch: '-x', base: '--all' }])),
    [{ path: '/a/be', branch: 'feature/x', base: 'origin/dev' }, { path: '/b', base: 'origin/master' }]);
  assert.deepEqual(parseRepos('깨짐'), []);
  // 더 볼 기준(also) 3개까지 · 틀린 이름 빼기, 딴 커밋(start)은 16진수만
  assert.deepEqual(parseRepos(JSON.stringify([{ path: '/c', also: ['origin/dev', '--x', 3, 'a', 'b', 'c'], start: 'abc1234' }, { path: '/d', start: 'HEAD~1' }])),
    [{ path: '/c', base: 'origin/master', also: ['origin/dev', 'a', 'b'], start: 'abc1234' }, { path: '/d', base: 'origin/master' }]);
});

test('레포 커밋 상태 — 커밋 안 한 파일 · 기준에 없는 커밋 · 올리지 않음, 작업 폴더 밖은 보지 않는다', async () => {
  const root = mkdtempSync(join(tmpdir(), 'edith-repos-')), cwd = join(root, 'wt'), repo = join(cwd, 'be'), work = join(root, 'work');
  const g = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
  try {
    mkdirSync(repo, { recursive: true }); mkdirSync(work);
    g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
    writeFileSync(join(repo, 'a.txt'), '1'); g('add', '.'); g('commit', '-qm', '첫');
    g('checkout', '-qb', 'feature/memo'); writeFileSync(join(repo, 'b.txt'), '2'); g('add', '.'); g('commit', '-qm', '메모');
    writeFileSync(join(repo, 'c.txt'), '3');
    const first = execFileSync('git', ['-C', repo, 'rev-parse', 'main']).toString().trim(), memo = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD']).toString().trim();
    writeFileSync(join(work, 'edith-repos.json'), JSON.stringify([{ path: repo, branch: 'feature/memo', base: 'main', also: ['nope'], start: first }, { path: root }]));
    const [be, out] = await repoStatus(work, cwd);
    assert.deepEqual([be.head, be.dirty, be.ahead, be.pushed, be.error, be.fresh, be.more], ['feature/memo', 1, 1, null, undefined, undefined, [{ base: 'nope', ahead: null }]]);
    assert.equal(out.error, '런 작업 폴더 밖이라 보지 않는다');
    // 딴 뒤 커밋이 없으면 「커밋 없음」 — 기준에 없는 커밋 0 과 갈린다
    writeFileSync(join(work, 'edith-repos.json'), JSON.stringify([{ path: repo, base: 'main', also: ['main'], start: memo }]));
    const [fresh] = await repoStatus(work, cwd);
    assert.deepEqual([fresh.fresh, fresh.more], [true, [{ base: 'main', ahead: 1 }]]);
    // 변경 보기 — 기준과 갈라진 곳부터(커밋한 b.txt) + 추적 전 새 파일(c.txt)
    writeFileSync(join(work, 'edith-repos.json'), JSON.stringify([{ path: repo, base: 'main' }]));
    const d = await repoDiff(work, cwd, 0);
    assert.equal(d.from, first.slice(0, 7));
    assert.match(d.text, /\+\+\+ b\/b\.txt\n@@ -0,0 \+1 @@\n\+2/);
    assert.match(d.text, /new file mode 100644\n--- \/dev\/null\n\+\+\+ b\/c\.txt\n@@ -0,0 \+1,1 @@\n\+3/);
    await assert.rejects(repoDiff(work, cwd, 5), /없는 레포/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
