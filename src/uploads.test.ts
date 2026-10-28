import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refsIn, removeUploads, runRefPaths, transcriptDir, uploadRefs } from './uploads.ts';

test('첨부 경로 찾기 — 절대 경로 · ~ 꼴 · JSON 안(\\/) · 줄바꿈 이스케이프 앞까지, 다른 폴더는 안 본다', () => {
  const home = '/Users/a', dir = '/Users/a/.local/share/edith/uploads';
  const t = [
    '붙임: /Users/a/.local/share/edith/uploads/mvrs73c9-dbea2f-screenshot.png 봐 줘',
    '{"text":"~/.local/share/edith/uploads/mvx-1a2b3c-스크린샷_2026.png\\n다음"}',
    '{"p":"\\/Users\\/a\\/.local\\/share\\/edith\\/uploads\\/q1-ffffff-file.pdf"}',
    '(/Users/a/.local/share/edith/uploads/z9-000000-x.png)',
    '/Users/b/.local/share/edith/uploads/other.png /Users/a/.local/share/edith/uploads2/no.png',
  ].join('\n');
  assert.deepEqual([...uploadRefs(t, dir, home)].sort(), ['mvrs73c9-dbea2f-screenshot.png', 'mvx-1a2b3c-스크린샷_2026.png', 'q1-ffffff-file.pdf', 'z9-000000-x.png']);
});

test('첨부 지우기 — 런 기록 · 대화 기록에서 찾은 것만, 그 폴더 바로 아래 파일만', () => {
  const root = mkdtempSync(join(tmpdir(), 'edith-upl-')), up = join(root, 'uploads'), run = join(root, 'runs', '7');
  mkdirSync(up); mkdirSync(join(run, 'nodes', 'a', '1'), { recursive: true }); mkdirSync(join(run, 'work', 'inputs'), { recursive: true });
  for (const f of ['a.png', 'b.png', 'c.png', 'keep.png']) writeFileSync(join(up, f), 'x');
  writeFileSync(join(run, 'run.json'), JSON.stringify({ input: `노션\n${up}/a.png` }));
  writeFileSync(join(run, 'nodes', 'a', '1', 'answer.txt'), `답 ${up}/b.png`);
  writeFileSync(join(run, 'nodes', 'a', '1', 'clip.mp4'), `${up}/keep.png`);   // 글 파일만 본다
  const refs = refsIn(runRefPaths(run), up);
  assert.deepEqual([...refs].sort(), ['a.png', 'b.png']);
  symlinkSync('/etc/hosts', join(up, 'link'));
  assert.equal(removeUploads([...refs, '../x', '.hidden', 'link', 'none.png'], up), 2, '링크 · 경로 조각 · 없는 이름은 지나간다');
  assert.deepEqual(readdirSync(up).sort(), ['c.png', 'keep.png', 'link']);
  assert.equal(transcriptDir('/Users/a/code/.worktrees/repo/feat-1', '/Users/a'), '/Users/a/.claude/projects/-Users-a-code--worktrees-repo-feat-1');
});
