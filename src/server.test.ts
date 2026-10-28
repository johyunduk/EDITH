import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refuse } from './server.ts';
import { prune } from './uploads.ts';

const KEY = 'k'.repeat(32);
const req = (method: string, headers: Record<string, string> = {}) => ({ method, headers: { host: '127.0.0.1:4320', ...headers } });
const json = { origin: 'http://127.0.0.1:4320', 'content-type': 'application/json', cookie: `edith-4320=${KEY}` };

test('/api/ 는 그 포트의 열쇠 쿠키가 있어야 — 없거나 틀리거나 다른 포트 쿠키면 401, 화면 파일은 열쇠 없이', () => {
  assert.equal(refuse(req('GET'), '/api/herdr', '4320', KEY)?.[0], 401);
  assert.equal(refuse(req('GET', { cookie: 'edith-4320=틀림' }), '/api/herdr', '4320', KEY)?.[0], 401);
  assert.equal(refuse(req('GET', { cookie: `edith-4321=${KEY}` }), '/api/herdr', '4320', KEY)?.[0], 401);
  assert.equal(refuse(req('GET', { cookie: `x=1; edith-4320=${KEY}` }), '/api/herdr', '4320', KEY), null);
  assert.equal(refuse(req('GET'), '/', '4320', KEY), null);
});

test('쓰기는 이 화면에서 온 JSON POST 만(CSRF) — 다른 출처·Origin 없음·폼 본문·다른 메서드는 403', () => {
  assert.equal(refuse(req('POST', json), '/api/restart', '4320', KEY), null);
  assert.equal(refuse(req('POST', { ...json, origin: 'http://evil.com' }), '/api/restart', '4320', KEY)?.[0], 403);
  assert.equal(refuse(req('POST', { ...json, origin: 'http://127.0.0.1:4321' }), '/api/restart', '4320', KEY)?.[0], 403);
  const { origin: _, ...noOrigin } = json;
  assert.equal(refuse(req('POST', noOrigin), '/api/restart', '4320', KEY)?.[0], 403);
  assert.equal(refuse(req('POST', { ...json, 'content-type': 'application/x-www-form-urlencoded' }), '/api/restart', '4320', KEY)?.[0], 403);
  assert.equal(refuse(req('PUT', json), '/api/restart', '4320', KEY)?.[0], 403);
  assert.equal(refuse(req('POST', { ...json, cookie: '' }), '/api/restart', '4320', KEY)?.[0], 401);
});

test('첨부 정리 — 오래된 파일만 지운다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'edith-up-'));
  writeFileSync(join(dir, 'old'), 'a'); writeFileSync(join(dir, 'new'), 'b');
  const old = (Date.now() - 8 * 86_400_000) / 1000;
  utimesSync(join(dir, 'old'), old, old);
  prune(dir, 7 * 86_400_000);
  assert.deepEqual(readdirSync(dir), ['new']);
});
