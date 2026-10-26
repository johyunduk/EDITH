import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerRequest, listRequests, readRequest, requestStatus } from './requests.ts';

test('요청 받기 — 답 없는 것만 목록에, 답은 한 번, 틀린 파일 · id 는 없는 것으로', () => {
  const root = mkdtempSync(join(tmpdir(), 'edith-req-'));
  try {
    writeFileSync(join(root, 'a1.json'), JSON.stringify({ engine: 'dev', input: '기획서 링크', from: '대화방 봇', room: '개발방', extra: 1, unattended: true }));
    writeFileSync(join(root, 'b2.json'), JSON.stringify({ engine: 'dev', unattended: 'yes' }));
    writeFileSync(join(root, 'bad.json'), '깨짐');
    writeFileSync(join(root, 'noeng.json'), '{"input":"x"}');
    assert.deepEqual(listRequests(root).map(r => [r.id, r.engine, r.input, r.from, r.room]).sort(), [['a1', 'dev', '기획서 링크', '대화방 봇', '개발방'], ['b2', 'dev', '', undefined, undefined]]);
    assert.equal(readRequest('../a1', root), null);
    // 무인은 true 일 때만
    assert.deepEqual([readRequest('a1', root)?.unattended, readRequest('b2', root)?.unattended], [true, undefined]);
    answerRequest('b2', { state: 'rejected' }, root);
    assert.throws(() => answerRequest('b2', { state: 'started', run: 1 }, root), /이미 답한/);
    assert.throws(() => answerRequest('none', { state: 'rejected' }, root), /없는 요청/);
    assert.deepEqual(listRequests(root).map(r => r.id), ['a1']);
    assert.deepEqual(requestStatus('b2', root), { id: 'b2', state: 'rejected', engine: 'dev', run: null });
    assert.equal(requestStatus('a1', root)?.state, 'pending');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('요청 meta — 객체 4KB 까지만 런으로 넘기고, 거절 사유는 답 · 진행에 남는다', () => {
  const root = mkdtempSync(join(tmpdir(), 'edith-req-'));
  try {
    writeFileSync(join(root, 'm1.json'), JSON.stringify({ engine: 'dev', title: '메모 칸 추가', tag: 'TICKET-1', meta: { room: 's1', message: 'm9', author: '마크' } }));
    assert.deepEqual([readRequest('m1', root)?.title, readRequest('m1', root)?.tag], ['메모 칸 추가', 'TICKET-1']);
    // 상위(예: 이슈의 안건) — 글이 하나라도 있는 객체만
    writeFileSync(join(root, 'p1.json'), JSON.stringify({ engine: 'dev', parent: { tag: 'PROJ-1', title: '포인트 지급', extra: 1 } }));
    writeFileSync(join(root, 'p2.json'), JSON.stringify({ engine: 'dev', parent: '글' }));
    writeFileSync(join(root, 'p3.json'), JSON.stringify({ engine: 'dev', parent: { tag: ' ' } }));
    assert.deepEqual(['p1', 'p2', 'p3'].map(id => readRequest(id, root)?.parent), [{ tag: 'PROJ-1', title: '포인트 지급' }, undefined, undefined]);
    writeFileSync(join(root, 'm2.json'), JSON.stringify({ engine: 'dev', meta: ['배열'] }));
    writeFileSync(join(root, 'm3.json'), JSON.stringify({ engine: 'dev', meta: { big: 'x'.repeat(5000) } }));
    assert.deepEqual(['m1', 'm2', 'm3'].map(id => readRequest(id, root)?.meta), [{ room: 's1', message: 'm9', author: '마크' }, undefined, undefined]);
    answerRequest('m1', { state: 'rejected', reason: '이번 주는 안 한다' }, root);
    assert.equal(requestStatus('m1', root)?.reason, '이번 주는 안 한다');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
