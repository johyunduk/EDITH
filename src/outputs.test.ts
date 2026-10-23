import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listOutputs, parseOutputs, readOutput } from './outputs.ts';

test('산출물 목록 읽기 — 이름 + 절대 경로나 http(s) 주소만, 틀린 줄은 뺀다', () => {
  assert.deepEqual(parseOutputs(JSON.stringify([
    { label: '계획', path: '/w/plan.md', node: 'fe.plan', note: '구현 계획' }, { label: '노션', url: 'https://notion.so/x' },
    { label: '상대', path: 'plan.md' }, { label: '스크립트', url: 'javascript:alert(1)' }, { path: '/w/a.md' }, { label: '둘 다', path: '/w/b.md', url: 'https://x' },
  ])), [
    { label: '계획', path: '/w/plan.md', node: 'fe.plan', note: '구현 계획' }, { label: '노션', url: 'https://notion.so/x' }, { label: '둘 다', path: '/w/b.md' },
  ]);
  assert.deepEqual(parseOutputs('깨짐'), []);
});

test('산출물 파일 — 런 작업 폴더 안만, 링크로 밖을 가리키면 안 보이고, 글 파일만 읽는다', () => {
  const root = mkdtempSync(join(tmpdir(), 'edith-out-')), cwd = join(root, 'wt'), work = join(root, 'run', 'work'), out = join(root, 'secret.md');
  try {
    mkdirSync(cwd, { recursive: true }); mkdirSync(work, { recursive: true });
    writeFileSync(join(cwd, 'plan.md'), '# 계획'); writeFileSync(out, '비밀'); writeFileSync(join(cwd, 'bin'), 'a\0b');
    symlinkSync(out, join(cwd, 'link.md'));
    writeFileSync(join(work, 'edith-outputs.json'), JSON.stringify([
      { label: '계획', path: join(cwd, 'plan.md') }, { label: '밖', path: out }, { label: '링크', path: join(cwd, 'link.md') }, { label: '바이너리', path: join(cwd, 'bin') }, { label: '없음', path: join(cwd, 'no.md') },
    ]));
    const roots = [cwd, join(root, 'run')], l = listOutputs(work, roots);
    assert.deepEqual(l.map(x => x.error), [undefined, '런 작업 폴더 밖이거나 없다', '런 작업 폴더 밖이거나 없다', undefined, '런 작업 폴더 밖이거나 없다']);
    assert.equal(readOutput(work, roots, 0).text, '# 계획');
    assert.throws(() => readOutput(work, roots, 2), /밖이거나/);
    assert.throws(() => readOutput(work, roots, 3), /글 파일이 아니다/);
    assert.throws(() => readOutput(work, roots, 9), /없는 산출물/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
