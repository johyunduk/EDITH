import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agendaOf, mainOf } from './agenda.ts';
import type { Item } from './deploy.ts';

test('agendaOf — 워크트리 .git 파일로 본 레포를 찾고, 이슈 런은 via(안건 브랜치) 항목의 tag', () => {
  const d = mkdtempSync(join(tmpdir(), 'edith-agenda-'));
  try {
    const repo = join(d, 'api'), wt = join(d, 'wt', '5'), work = join(d, 'work');
    mkdirSync(join(repo, '.git'), { recursive: true }); mkdirSync(wt, { recursive: true }); mkdirSync(work);
    writeFileSync(join(wt, '.git'), `gitdir: ${repo}/.git/worktrees/5\n`);
    assert.equal(mainOf(wt), repo);
    assert.equal(mainOf(repo), repo);
    assert.equal(mainOf(join(d, 'none')), null);
    const item = (branch: string, tag?: string): Item => ({ id: 'a1b2c3d4', repo, branch, notes: [], tasks: [], log: [], ...(tag ? { tag } : {}) });
    writeFileSync(join(work, 'edith-repos.json'), JSON.stringify([{ path: wt, branch: 'issue/5', via: 'feature/points' }]));
    assert.equal(agendaOf(work, [item('issue/5', '이슈'), item('feature/points', '포인트')]), '포인트');
    writeFileSync(join(work, 'edith-repos.json'), JSON.stringify([{ path: wt, branch: 'feature/filter' }]));
    assert.equal(agendaOf(work, [item('feature/filter', '필터')]), '필터');
    assert.equal(agendaOf(work, [item('feature/other', '다른 안건')]), undefined);
    // 안건 QA 이슈 — 배포 카드처럼 상위 안건 자기 항목의 tag
    writeFileSync(join(work, 'edith-repos.json'), JSON.stringify([{ path: wt, branch: 'issue/7' }]));
    const qa = { ...item('issue/7', '문구'), ticket: 'ISSUE-7', agenda: 'PROJ-3' };
    const head = { ...item('feature/points', '포인트'), ticket: 'PROJ-3', agenda: 'PROJ-3' };
    assert.equal(agendaOf(work, [qa, head]), '포인트');
    assert.equal(agendaOf(work, [qa]), '문구');
  } finally { rmSync(d, { recursive: true, force: true }); }
});
