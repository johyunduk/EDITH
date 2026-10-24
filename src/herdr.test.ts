import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pipeName } from './herdr.ts';

test('herdr 소켓 — Windows 는 경로 앞에 \\\\.\\pipe\\ 를 붙인 named pipe, 이미 pipe 이름이거나 macOS·Linux 면 그대로', () => {
  assert.equal(pipeName('C:\\Users\\u\\AppData\\Roaming\\herdr\\herdr.sock', true), '\\\\.\\pipe\\C:\\Users\\u\\AppData\\Roaming\\herdr\\herdr.sock');
  assert.equal(pipeName('\\\\.\\pipe\\herdr', true), '\\\\.\\pipe\\herdr');
  assert.equal(pipeName('\\\\?\\pipe\\herdr', true), '\\\\?\\pipe\\herdr');
  assert.equal(pipeName('/Users/u/.config/herdr/herdr.sock', false), '/Users/u/.config/herdr/herdr.sock');
});
