import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairs, parseDiff } from '../web/src/diffParse.ts';

const DIFF = `diff --git a/app/A.php b/app/A.php
index 1111111..2222222 100644
--- a/app/A.php
+++ b/app/A.php
@@ -10,4 +10,4 @@ class A
 $a = 1;
-$total = $price * 2;
+$total = $price * 3;
--- 본문의 이 줄은 지운 줄이다
 return $a;
diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+export const x = 1;
+export const y = 2;
\\ No newline at end of file
diff --git a/old name.md b/new name.md
similarity index 100%
rename from old name.md
rename to new name.md
diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
`;

test('diff 읽기 — 상태·이름·줄 번호, 본문의 「---」 줄은 지운 줄', () => {
  const [a, n, r, b] = parseDiff(DIFF);
  assert.deepEqual([a.status, a.name, a.add, a.del], ['M', 'app/A.php', 1, 2]);
  assert.deepEqual(a.hunks[0].lines.map(l => [l.t, l.o, l.n]), [[' ', 10, 10], ['-', 11, undefined], ['+', undefined, 11], ['-', 12, undefined], [' ', 13, 12]]);
  assert.equal(a.hunks[0].head, 'class A');
  assert.deepEqual([n.status, n.name, n.add, n.hunks[0].lines.length], ['A', 'new.ts', 2, 2]);
  assert.deepEqual([r.status, r.old, r.name, r.hunks.length], ['R', 'old name.md', 'new name.md', 0]);
  assert.equal(b.binary, true);
});

test('줄 안 바뀐 곳 — 같은 앞뒤를 뺀 가운데, 거의 다 다르면 표시 없음', () => {
  const [a] = parseDiff(DIFF), [, del, add, other] = a.hunks[0].lines;
  assert.deepEqual([del.text.slice(...del.mark!), add.text.slice(...add.mark!)], ['2', '3']);
  assert.equal(other.mark, undefined);   // 짝이 없는 지운 줄
  const [f] = parseDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-완전히 다른 줄\n+another line entirely\n');
  assert.equal(f.hunks[0].lines[0].mark, undefined);
});

test('나란히 보기 — 같은 줄은 양쪽, 지운 묶음과 더한 묶음은 차례로 짝', () => {
  const [a] = parseDiff(DIFF);
  assert.deepEqual(pairs(a.hunks[0].lines).map(([l, r]) => [l?.t ?? null, r?.t ?? null]), [[' ', ' '], ['-', '+'], ['-', null], [' ', ' ']]);
});
