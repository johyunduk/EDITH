import { test } from 'node:test';
import assert from 'node:assert/strict';
import { split } from './summary.ts';

test('요약용 파일 나누기 — 이름(+++ b/, 이름 바꿈, 삭제)과 바뀐 줄 수, 같은 diff 는 같은 해시', () => {
  const text = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-x\n+y\n'
    + 'diff --git a/old.md b/new.md\nsimilarity index 100%\nrename from old.md\nrename to new.md\n'
    + 'diff --git a/gone.ts b/gone.ts\ndeleted file mode 100644\n--- a/gone.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-z\n';
  const fs = split(text);
  assert.deepEqual(fs.map(f => f.name), ['a.ts', 'new.md', 'gone.ts']);
  assert.equal(split(text)[0].key, fs[0].key);
  assert.ok(fs[0].changed >= 2);
});
