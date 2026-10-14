import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { apply, linkOk, pack, preview, unitOf, unitsAt, unpack } from './skillsMove.ts';

test('경로 — ROOTS 안의 덩이만, 「..」·절대 경로·숨은 덩이·밖은 null', () => {
  assert.equal(unitOf('.claude/skills/a/SKILL.md'), '.claude/skills/a');
  assert.equal(unitOf('.codex/prompts/p.md'), '.codex/prompts/p.md');
  for (const bad of ['.claude/skills', '/etc/passwd', '.claude/skills/../../.ssh/x', '.ssh/authorized_keys', '.codex/skills/.system/x', 'C:\\x', '.claude/skills//a'])
    assert.equal(unitOf(bad), null, bad);
  assert.ok(linkOk({ path: '.claude/skills/h', target: '../../.agents/skills/h' }));
  assert.ok(!linkOk({ path: '.claude/skills/h', target: '../../../.ssh' }));
  assert.ok(!linkOk({ path: '.claude/skills/h', target: '/etc' }));
  assert.ok(!linkOk({ path: '.claude/skills/h/x', target: '../h2' }));
});

test('내보내기 → 가져오기 — 스킬 폴더·명령·공유 링크, 있는 덩이는 고른 것만 덮어쓴다', () => {
  const from = mkdtempSync(join(tmpdir(), 'edith-from-')), to = mkdtempSync(join(tmpdir(), 'edith-to-'));
  try {
    mkdirSync(join(from, '.agents/skills/h'), { recursive: true });
    writeFileSync(join(from, '.agents/skills/h/SKILL.md'), '공유');
    mkdirSync(join(from, '.claude/skills/a/bin'), { recursive: true });
    writeFileSync(join(from, '.claude/skills/a/SKILL.md'), '새 것');
    writeFileSync(join(from, '.claude/skills/a/bin/run'), '#!/bin/sh', { mode: 0o755 });
    writeFileSync(join(from, '.claude/skills/a/.DS_Store'), 'x');
    symlinkSync('../../.agents/skills/h', join(from, '.claude/skills/h'));
    mkdirSync(join(from, '.claude/commands'), { recursive: true });
    writeFileSync(join(from, '.claude/commands/c.md'), '명령');

    const units = unitsAt(from, [join(from, '.agents/skills/h'), join(from, '.claude/skills/a'), join(from, '.claude/commands/c.md')].map(p => realpathSync(p)));   // 스킬 지도는 realpath 를 준다
    assert.deepEqual(units.sort(), ['.agents/skills/h', '.claude/commands/c.md', '.claude/skills/a', '.claude/skills/h']);
    const b = unpack(pack(from, units, [{ id: 'x@m', add: 'o/r' }]));
    assert.ok(!b.files.some(f => f.path.endsWith('.DS_Store')));

    mkdirSync(join(to, '.claude/skills/a'), { recursive: true });
    writeFileSync(join(to, '.claude/skills/a/SKILL.md'), '헌 것');
    assert.deepEqual(preview(to, b).units.map(u => [u.unit, u.exists]),
      [['.agents/skills/h', false], ['.claude/commands/c.md', false], ['.claude/skills/a', true], ['.claude/skills/h', false]]);
    assert.deepEqual(apply(to, b, []).skipped, ['.claude/skills/a']);
    assert.equal(readFileSync(join(to, '.claude/skills/a/SKILL.md'), 'utf8'), '헌 것');
    assert.equal(readlinkSync(join(to, '.claude/skills/h')), '../../.agents/skills/h');
    assert.equal(readFileSync(join(to, '.claude/skills/h/SKILL.md'), 'utf8'), '공유');
    assert.deepEqual(apply(to, b, ['.claude/skills/a']).replaced, ['.claude/skills/a']);
    assert.equal(readFileSync(join(to, '.claude/skills/a/SKILL.md'), 'utf8'), '새 것');
    assert.ok(lstatSync(join(to, '.claude/skills/a/bin/run')).mode & 0o100);
  } finally { rmSync(from, { recursive: true, force: true }); rmSync(to, { recursive: true, force: true }); }
});

test('나쁜 묶음은 통째로 거절 — 밖으로 나가는 경로·링크, 링크 너머로 쓰기', () => {
  const bad = (o: object) => assert.throws(() => unpack(gzipSync(JSON.stringify({ edith: 1, at: '', files: [], links: [], plugins: [], ...o }))));
  bad({ files: [{ path: '.claude/skills/../../.ssh/authorized_keys', data: '' }] });
  bad({ links: [{ path: '.claude/skills/x', target: '../../../.ssh' }] });
  bad({ links: [{ path: '.claude/skills/x', target: '../../.agents/skills/y' }], files: [{ path: '.claude/skills/x/SKILL.md', data: '' }] });
  assert.throws(() => unpack(Buffer.from('그냥 글')));
});

test('공개 스킬·플러그인은 설치 명령으로 — 고른 스킬이 부르는 플러그인만 need 와 함께, 이상한 이름·주소는 걸러 낸다', async () => {
  const { plan } = await import('./skillsMove.ts');
  const home = mkdtempSync(join(tmpdir(), 'edith-plan-'));
  try {
    mkdirSync(join(home, '.claude/plugins'), { recursive: true });
    writeFileSync(join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'diagram@dm': true, 'other@om': true } }));
    writeFileSync(join(home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ dm: { source: { source: 'github', repo: 'o/diagram' } }, om: { source: { source: 'directory', path: '/x' } } }));
    const pub = { id: 'shared:find', name: 'find', path: join(home, '.agents/skills/find'), source: 'shared', uses: [], origin: 'v/skills' };
    const mine = { id: 'claude:mine', name: 'mine', path: join(home, '.claude/skills/mine'), source: 'user', uses: [{ id: 'claude:diagram:d', how: '/' }] };
    const plug = { id: 'claude:diagram:d', name: 'diagram:d', path: '/p', source: 'plugin:diagram', uses: [] };
    const p = plan(home, [pub, mine], [pub, mine, plug], false);
    assert.deepEqual(p.sources, [{ name: 'find', source: 'v/skills' }]);
    assert.deepEqual(p.plugins, [{ id: 'diagram@dm', add: 'o/diagram', need: ['mine'] }]);
    assert.deepEqual(plan(home, [mine], [mine, plug], true).plugins.map(x => [x.id, x.add]), [['diagram@dm', 'o/diagram'], ['other@om', null]]);
  } finally { rmSync(home, { recursive: true, force: true }); }

  const b = unpack(gzipSync(JSON.stringify({ edith: 1, at: '', files: [], links: [],
    sources: [{ name: 'ok', source: 'a/b' }, { name: '-x', source: 'a/b' }, { name: 'y', source: '--evil' }],
    plugins: [{ id: 'p@m', add: 'o/r', need: ['s'] }, { id: 'q@m', add: '--upload-pack=x' }, { id: '-z@m', add: null }] })));
  assert.deepEqual(b.sources, [{ name: 'ok', source: 'a/b' }]);
  assert.deepEqual(b.plugins, [{ id: 'p@m', add: 'o/r', need: ['s'] }, { id: 'q@m', add: null, need: [] }]);
});
