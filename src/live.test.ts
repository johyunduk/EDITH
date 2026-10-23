import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { livePort, pickPage } from './live.ts';

test('화면 포트 — 작업 문서 안 edith-live.json 의 포트만, 틀린 값 · 밖을 가리키는 링크는 없는 것으로', () => {
  const root = mkdtempSync(join(tmpdir(), 'edith-live-')), work = join(root, 'work'), f = join(work, 'edith-live.json');
  try {
    mkdirSync(work);
    assert.equal(livePort(work), null);
    writeFileSync(f, '{"port": 9333}'); assert.equal(livePort(work), 9333);
    writeFileSync(f, '{"port": 80}'); assert.equal(livePort(work), null);
    writeFileSync(f, '{"port": "9333"}'); assert.equal(livePort(work), null);
    rmSync(f); writeFileSync(join(root, 'out.json'), '{"port": 9333}'); symlinkSync(join(root, 'out.json'), f);
    assert.equal(livePort(work), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('화면 페이지 고르기 — DevTools 는 빼고 빈 페이지보다 주소가 있는 것을 먼저', () => {
  const ws = 'ws://127.0.0.1:9/devtools/page/x';
  assert.equal(pickPage([{ type: 'page', url: 'about:blank', webSocketDebuggerUrl: ws }, { type: 'page', url: 'devtools://x', webSocketDebuggerUrl: ws }, { type: 'page', url: 'http://a', webSocketDebuggerUrl: ws }])?.url, 'http://a');
  assert.equal(pickPage([{ type: 'service_worker', url: 'http://a', webSocketDebuggerUrl: ws }]), undefined);
});
