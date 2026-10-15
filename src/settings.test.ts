import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enabledIn, isToggle } from './settings.ts';

test('플러그인 켜짐 — 기본(켜짐)·true 는 켜짐, "false" 만 꺼짐. 모르는 키는 받지 않는다', () => {
  assert.equal(enabledIn('{"inputs":{"enabled":"true"}}'), true);
  assert.equal(enabledIn('{"inputs":{}}'), true);
  assert.equal(enabledIn('{"inputs":{"enabled":"false"}}'), false);
  assert.ok(isToggle('commitGuard') && isToggle('peerMessage'));
  assert.ok(!isToggle('toString') && !isToggle('x'));
});
