import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitOf, pipeName, shellBlocks } from './herdr.ts';

test('shellBlocks — 기호가 폴더 뒤에 오는 프롬프트(starship · macOS zsh)도 명령 + 출력으로 자르고, 끝의 빈 프롬프트는 대기', () => {
  const s = shellBlocks(['끝 — edith 로 켠다', 'EDITH(main) > ls', 'src  web', 'EDITH(main) ↑2 > git push', '  ok', 'EDITH(main) >   ']);
  assert.equal(s.mark, '>');
  assert.deepEqual(s.blocks, [
    { cmd: '', where: '', out: ['끝 — edith 로 켠다'] },
    { cmd: 'ls', where: 'EDITH(main)', out: ['src  web'] },
    { cmd: 'git push', where: 'EDITH(main) ↑2', out: ['  ok'] },
    { cmd: '', where: 'EDITH(main)', out: [] },
  ]);
  assert.deepEqual(shellBlocks(['me@mac EDITH % pwd', '/x', 'me@mac EDITH %']).blocks.map(b => b.cmd), ['pwd', '']);
  // 출력에 「$ 명령」 줄이 있어도 끝 줄이 빈 TAIL 프롬프트면 그 꼴로
  const u = shellBlocks(['EDITH(main) > edith update', '$ git pull', '$ npm run build', 'done', 'EDITH(main) >']);
  assert.deepEqual([u.mark, u.blocks.map(b => b.cmd)], ['>', ['edith update', '']]);
  // 첫 낱말 기호(robbyrussell)가 있으면 예전대로 — 출력 속 「a > b」 를 프롬프트로 보지 않는다
  assert.deepEqual(shellBlocks(['➜  EDITH git:(main) echo 1', 'a > b', '➜  EDITH git:(main) ']).blocks.map(b => b.out), [['a > b'], []]);
});

test('limitOf — 상태줄 남은 시간 글에서 다시 차는 시각, 「3d4h」 꼴은 시 단위라 rough', () => {
  const now = Date.UTC(2026, 9, 26, 1, 0);
  assert.deepEqual(limitOf(30, '2h10m', now), { pct: 30, reset: '2h10m', at: now + (2 * 60 + 10) * 60_000 });
  assert.deepEqual(limitOf(12, '3d4h', now), { pct: 12, reset: '3d4h', at: now + (3 * 24 + 4) * 3_600_000, rough: true });
  assert.deepEqual(limitOf(5, null, now), { pct: 5, reset: null, at: null });
});

test('herdr 소켓 — Windows 는 경로 앞에 \\\\.\\pipe\\ 를 붙인 named pipe, 이미 pipe 이름이거나 macOS·Linux 면 그대로', () => {
  assert.equal(pipeName('C:\\Users\\u\\AppData\\Roaming\\herdr\\herdr.sock', true), '\\\\.\\pipe\\C:\\Users\\u\\AppData\\Roaming\\herdr\\herdr.sock');
  assert.equal(pipeName('\\\\.\\pipe\\herdr', true), '\\\\.\\pipe\\herdr');
  assert.equal(pipeName('\\\\?\\pipe\\herdr', true), '\\\\?\\pipe\\herdr');
  assert.equal(pipeName('/Users/u/.config/herdr/herdr.sock', false), '/Users/u/.config/herdr/herdr.sock');
});
