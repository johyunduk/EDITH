import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeLine, follow, newerSame, older } from './chat.ts';
import { agentSince, noteAgents } from './herdr.ts';

test('이전 대화 — 4MB 보다 긴 줄을 사이에 두고도 순서·바이트 위치를 지켜 거꾸로 모은다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'edith-chat-'));
  try {
    const msg = (i: number) => JSON.stringify({ type: 'assistant', timestamp: '2026-10-13T00:00:00Z', message: { content: [{ type: 'text', text: `m${i}` }] } });
    const lines = [...Array.from({ length: 100 }, (_, i) => msg(i)), JSON.stringify({ type: 'x', pad: '한'.repeat(2_000_000) }), ...Array.from({ length: 100 }, (_, i) => msg(100 + i))];
    const file = join(dir, 's.jsonl'), text = `${lines.join('\n')}\n`;
    writeFileSync(file, text);
    const r = older(file, Buffer.byteLength(text), claudeLine), buf = readFileSync(file);
    assert.deepEqual(r.items.map(i => i.text), Array.from({ length: 200 }, (_, i) => `m${i}`));
    assert.equal(r.more, false);
    for (const it of r.items) assert.ok(buf.subarray(it.at!, it.at! + 200).toString('utf8').includes(`"text":"${it.text}"`));
    const mid = older(file, r.items[150].at!, claudeLine);   // 그 앞만
    assert.equal(mid.items.at(-1)!.text, 'm149');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('새로 뜬 에이전트 — 콘솔이 켜질 때 이미 있던 pane 은 표시하지 않고, 셸에서 바뀌거나 나중에 생긴 pane 만 시각을 남긴다', () => {
  noteAgents([{ id: 'wT:p1', agent: 'claude' }, { id: 'wT:p2', agent: null }]);
  assert.equal(agentSince('wT:p1'), undefined);
  noteAgents([{ id: 'wT:p1', agent: 'claude' }, { id: 'wT:p2', agent: 'claude' }, { id: 'wT:p3', agent: 'codex' }]);
  assert.equal(agentSince('wT:p1'), undefined);
  assert.ok(agentSince('wT:p2'));
  assert.ok(agentSince('wT:p3'));
});

test('/clear·/resume — 붙잡은 파일보다 나중에 쓰인 같은 제목 파일로 옮기고, 다른 제목 파일은 안 본다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'edith-clear-'));
  try {
    const put = (f: string, name: string, sec: number) => {
      const p = join(dir, f);
      writeFileSync(p, `${JSON.stringify({ type: 'custom-title', customTitle: name })}\n`);
      utimesSync(p, sec, sec);
      return p;
    };
    // 예전 세션(먼저 만든 것)을 /resume 해서 지금 쓰는 경우 — 만든 순서와 상관없이 마지막에 쓴 파일
    const resumed = put('a.jsonl', 'Optimus Prime', 300), held = put('b.jsonl', 'Optimus Prime', 200), other = put('c.jsonl', 'pr', 400);
    assert.equal(newerSame(held, [resumed, held, other], 'Optimus Prime'), resumed);
    assert.equal(newerSame(resumed, [resumed, held, other], 'Optimus Prime'), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('백그라운드로 넘긴 대화 — parkedJobId 와 같은 jobId 의 bg 세션 파일을 따라가고, 없으면 원래 것', () => {
  const files = { 1: { sessionId: 'old', parkedJobId: 'j1' }, 2: { sessionId: 'other', jobId: 'j9' }, 3: { sessionId: 'new', jobId: 'j1', bridgeSessionId: 'b' } } as Record<number, object>;
  const read = (pid: number) => files[pid], names = () => ['1.json', '2.json', '3.json', 'x.tmp'];
  assert.deepEqual(follow(files[1], names, read), { sessionId: 'new', jobId: 'j1', bridgeSessionId: 'b', parked: true });
  assert.deepEqual(follow({ sessionId: 'old', parkedJobId: 'gone' }, names, read), { sessionId: 'old', parkedJobId: 'gone' });
  assert.deepEqual(follow({ sessionId: 'plain' }, names, read), { sessionId: 'plain' });
});
