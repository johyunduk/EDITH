import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTheme, parseTheme, readTheme } from '../web/src/theme.ts';

test('테마 선택·복원 — 알 수 없는 값과 객체 속성은 EDITH 로 되돌리고, 예전 이름(daylight·neural)은 새 이름으로', () => {
  for (const value of [null, '', 'system', 'constructor', '__proto__']) assert.equal(parseTheme(value), 'edith');
  assert.equal(parseTheme('ultron'), 'ultron');
  assert.equal(parseTheme('edith'), 'edith');
  assert.equal(parseTheme('daylight'), 'edith');
  assert.equal(parseTheme('neural'), 'ultron');
});

test('테마를 즉시 적용하고 저장한다 — 저장소 차단 시에도 전환한다', t => {
  const dataset: Record<string, string> = {}, classes = new Set<string>();
  let saved: string | null = 'ultron';
  const storage = { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } };
  const previous = ['localStorage', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  t.after(() => { for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { dataset, classList: {
    toggle: (name: string, on: boolean) => { if (on) classes.add(name); else classes.delete(name); },
  } } } });
  assert.equal(readTheme(), 'ultron');
  applyTheme('ultron');
  assert.equal(dataset.theme, 'ultron');
  assert.ok(classes.has('dark'));
  applyTheme('edith');
  assert.equal(saved, 'edith');
  assert.ok(!classes.has('dark'));
  t.mock.method(storage, 'getItem', () => { throw new Error('blocked'); });
  t.mock.method(storage, 'setItem', () => { throw new Error('blocked'); });
  assert.equal(readTheme(), 'edith');
  applyTheme('ultron');
  assert.equal(dataset.theme, 'ultron');
  assert.ok(classes.has('dark'));
});
