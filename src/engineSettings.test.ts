import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTable, readSettings, saveInput, saveSettings, settingsPages } from './engineSettings.ts';

test('엔진 설정 표 — 모르는 칸 · 틀린 줄은 버리고, 비밀 칸 값은 참거짓으로만', () => {
  const t = parseTable(JSON.stringify({
    title: '계정', fields: [{ key: 'name', label: '이름' }, { key: 'pw', label: '비밀번호', type: 'secret' }, { key: 'kind', label: '종류', type: 'select', options: [{ value: 'a' }] }, { key: 'bad key', label: 'x' }],
    groups: [{ id: 'g', label: '묶음' }],
    rows: [{ id: 'r1', group: 'g', values: { name: '하나', pw: 'leak', other: 1 }, edit: ['name', 'nope'], tone: 'ok' }, { id: 'r1', values: {} }, { id: 'bad id!', values: {} }, { id: 'r2', group: 'zz', values: { name: 2 } }],
  }));
  assert.deepEqual(t.fields.map(f => f.key), ['name', 'pw', 'kind']);
  assert.deepEqual(t.fields[2].options, [{ value: 'a', label: 'a' }]);
  assert.deepEqual(t.columns, ['name', 'pw', 'kind']);
  assert.deepEqual(t.rows, [{ id: 'r1', group: 'g', values: { name: '하나', pw: true }, tone: 'ok', edit: ['name'], remove: false }, { id: 'r2', values: { name: '2' }, edit: [], remove: false }]);
  assert.throws(() => parseTable('[]'), /title/);
  assert.throws(() => parseTable('nope'), /JSON/);
});

test('저장 입력 — 모양만 보고 엔진에 넘길 JSON 으로', () => {
  assert.equal(saveInput({ id: 'e.0', op: 'set', row: 'r1', values: { name: '둘', on: false } }), '{"op":"set","id":"r1","values":{"name":"둘","on":false}}');
  assert.equal(saveInput({ op: 'add', add: 0, values: {} }), '{"op":"add","add":0,"values":{}}');
  assert.throws(() => saveInput({ op: 'drop', row: 'r1' }), /op/);
  assert.throws(() => saveInput({ op: 'set' }), /줄/);
  assert.throws(() => saveInput({ op: 'set', row: 'r1', values: { n: 3 } }), /값/);
});

test('엔진 설정 — 폴더마다 on: settings, 읽기 · 저장은 그 명령을 부르고 저장 값은 표준 입력으로만', { skip: process.platform === 'win32' }, async () => {
  const root = join(mkdtempSync(join(tmpdir(), 'edith-settings-')), 'workshop');
  const table = '{"title":"T","fields":[{"key":"pw","label":"P","type":"secret"}],"rows":[{"id":"a","values":{"pw":"leak"},"edit":["pw"]}]}';
  mkdirSync(join(root, 'eng'), { recursive: true });
  writeFileSync(join(root, 'eng', 'actions.json'), JSON.stringify([
    { label: '단추', command: 'true' },
    { label: '계정', on: 'settings', command: `if [ "$EDITH_SETTINGS" = save ]; then cat > in.json; env > env.txt; fi; echo '${table}'` },
    { label: '깨짐', on: 'settings', command: `echo '{"error":"안 된다"}'; exit 3` },
  ]));
  assert.deepEqual(settingsPages(root).map(p => [p.id, p.label]), [['eng.0', '계정'], ['eng.1', '깨짐']]);
  assert.equal((await readSettings('eng.0', root)).rows[0].values.pw, true);
  await saveSettings({ id: 'eng.0', op: 'set', row: 'a', values: { pw: 's3cret' } }, root);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'eng', 'in.json'), 'utf8')), { op: 'set', id: 'a', values: { pw: 's3cret' } });
  assert.ok(!readFileSync(join(root, 'eng', 'env.txt'), 'utf8').includes('s3cret'));
  assert.ok(!readFileSync(join(root, '..', 'settings', 'eng.0.log'), 'utf8').includes('s3cret'));
  await assert.rejects(readSettings('eng.1', root), /안 된다/);
  await assert.rejects(readSettings('eng.9', root), /없는/);
});
