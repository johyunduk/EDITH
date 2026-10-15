import { expect, test } from 'claude-code/testing'
import { peerNames, sends } from './register.ts'

test('herdr 로 글 치기를 찾는다 — 대상, 슬래시 명령인지. 키 입력·읽기·변수 대상은 아니다', async () => {
  expect(sends('herdr agent prompt w29:p1 "울트론에 옮겨 줘"')).toEqual([{ target: 'w29:p1', slash: false }])
  expect(sends('herdr agent prompt --wait --timeout 120000 reviewer "봐 줘"')).toEqual([{ target: 'reviewer', slash: false }])
  expect(sends("cd x && herdr pane send-text 'w2K:p2' 'hi'; herdr pane run w1:p2 \"npm test\"")).toEqual([{ target: 'w2K:p2', slash: false }, { target: 'w1:p2', slash: false }])
  expect(sends('herdr agent prompt w2K:pA /reload-plugins')).toEqual([{ target: 'w2K:pA', slash: true }])
  expect(sends('herdr agent prompt w2K:pA "/compact 요약만"')).toEqual([{ target: 'w2K:pA', slash: true }])
  expect(sends('herdr agent prompt w2K:p1 "$(cat <<EOF\n/x\nEOF\n)"')).toEqual([{ target: 'w2K:p1', slash: false }])
  for (const c of ['herdr pane send-keys w2K:pA 2', 'herdr agent read w1:p1', 'herdr agent prompt $PANE "hi"', 'herdr agent wait w1:p1 --until idle', 'echo herdrx agent prompt a b'])
    expect(sends(c)).toEqual([])
})

test('ListAgents 글에서 이름 — 가운뎃점이 든 이름도', async () => {
  const text = 'This session is EDITH [cc690a] — the name other sessions use…\n\nPeer sessions (2):\n  TASK-12 결제 · API · 노트 [400f14]  ·  interactive  ·  idle  ·  started 1d ago\n  my-app [61a401]  ·  bg  ·  shell  ·  started 10h ago'
  expect(peerNames(text)).toEqual(['TASK-12 결제 · API · 노트', 'my-app'])
})

test('끄면 막지 않는다', { options: { enabled: false } }, async ($: any, on: any) => {
  let ran = 0
  on('tool.call', { tool: 'Bash' }, () => { ran++; return { result: 'ok' } })
  await $.tool.call({ tool: 'Bash', command: 'herdr agent prompt w1:p1 "hi"' })
  expect(ran).toBe(1)
})
