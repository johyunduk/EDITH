import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSummary, readSummary } from './runSummary.ts';

test('끝난 런 요약 — 틀린 칸은 빼고, 한 일이 없으면 요약 없음', () => {
  assert.deepEqual(parseSummary(JSON.stringify({
    title: '인증 처리 이력', did: ['태그로 바꿨다', 3, ''], chips: ['고치기 1번'],
    next: [{ label: '변경 보고 커밋', action: '커밋하러 가기' }, { note: '이름 없음' }, { label: 'dev 머지', done: true }],
    check: [{ title: '가정 2', items: ['반려 → 빨강'] }, { title: '빈 묶음', items: [] }], outputs: ['구현 계획'],
  })), {
    title: '인증 처리 이력', did: ['태그로 바꿨다'], chips: ['고치기 1번'], outputs: ['구현 계획'],
    next: [{ label: '변경 보고 커밋', action: '커밋하러 가기' }, { label: 'dev 머지', done: true }],
    check: [{ title: '가정 2', items: ['반려 → 빨강'] }],
  });
  assert.equal(parseSummary(JSON.stringify({ title: '한 일 없음', did: [] })), null);
  assert.equal(parseSummary('깨짐'), null);
});

test('요약 파일 — 작업 문서 안만(링크로 밖이면 없는 것으로)', () => {
  const root = mkdtempSync(join(tmpdir(), 'edith-sum-')), work = join(root, 'work'), out = join(root, 'out.json');
  try {
    mkdirSync(work);
    writeFileSync(join(work, 'edith-summary.json'), JSON.stringify({ did: ['했다'] }));
    assert.deepEqual(readSummary(work)?.did, ['했다']);
    writeFileSync(out, JSON.stringify({ did: ['밖'] }));
    rmSync(join(work, 'edith-summary.json')); symlinkSync(out, join(work, 'edith-summary.json'));
    assert.equal(readSummary(work), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
