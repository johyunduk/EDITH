import { expect, test } from 'claude-code/testing'
import { tick, type State } from './register.ts'

const off = { sessionId: 'a', bridgeSessionId: null, status: 'idle' }
const on = { sessionId: 'a', bridgeSessionId: 'session_x', status: 'idle' }
const fresh: State = { wanted: false, off: 0, tries: [] }

test('켜진 적 없는 세션은 건드리지 않고, 켜졌던 세션이 두 번 연달아 꺼져 있으면 다시 켠다', async () => {
  expect(tick(fresh, [off], 0).run).toBe(false)
  let s = tick(fresh, [on], 0).s
  expect(s.wanted).toBe(true)
  const first = tick(s, [off], 1)
  expect(first.run).toBe(false)
  const second = tick(first.s, [off], 2)
  expect(second.run).toBe(true)
})

test('같은 대화를 연 다른 터미널이 원격을 쥐고 있거나, 일하는 중이면 보내지 않는다', async () => {
  let s: State = { wanted: true, off: 1, tries: [] }
  expect(tick(s, [off, on], 0).run).toBe(false)
  expect(tick(s, [{ ...off, status: 'busy' }], 0).run).toBe(false)
})

test('30분 안에 세 번 다시 켜도 또 끊기면 그만둔다', async () => {
  const s: State = { wanted: true, off: 1, tries: [0, 1, 2] }
  const r = tick(s, [off], 3)
  expect(r.run).toBe(false)
  expect(r.gaveUp).toBe(true)
  expect(r.s.wanted).toBe(false)
  expect(tick(s, [off], 31 * 60_000).run).toBe(true)
})
