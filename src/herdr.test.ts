import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitOf, pipeName } from './herdr.ts';

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
