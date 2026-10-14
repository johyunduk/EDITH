// Remote Control 지킴이 — 원격이 켜져 있던 세션이 끊기면 /remote-control 로 다시 켠다.
// 연결 상태는 ~/.claude/sessions/<pid>.json 의 bridgeSessionId(켜짐: 값, 꺼짐: null)로 본다.
// 연결된 채로 /remote-control 을 보내면 상태 패널이 떠 입력을 막으니, 끊긴 게 확실할 때만 보낸다.

const MINUTE = 60_000
const WINDOW = 30 * MINUTE   // 이 시간 안에
const MAX_TRIES = 3          // 이만큼 다시 켜도 또 끊기면 그만둔다

export type Seen = { sessionId?: string; bridgeSessionId?: string | null; status?: string }
export type State = { wanted: boolean; off: number; tries: number[] }

// 1분마다 한 번. same = 이 대화(sessionId)를 연 세션 파일들 — 다른 터미널이 같은 대화를 열었을 수도 있다.
// 그중 하나라도 원격이 켜져 있으면 건드리지 않는다(다시 켜면 그 터미널의 원격을 뺏는다).
export function tick(s: State, same: Seen[], now: number): { s: State; run: boolean; gaveUp?: boolean } {
  if (same.some(f => f.bridgeSessionId)) return { s: { ...s, wanted: true, off: 0 }, run: false }
  if (!s.wanted || !same.length) return { s: { ...s, off: 0 }, run: false }
  const off = s.off + 1
  // 두 번 연달아 꺼져 있고, 일하는 중이 아닐 때만 — 잠깐의 재연결·명령 대기 중 패널이 뜨는 걸 피한다
  if (off < 2 || !same.every(f => f.status === 'idle')) return { s: { ...s, off }, run: false }
  const tries = s.tries.filter(t => now - t < WINDOW)
  if (tries.length >= MAX_TRIES) return { s: { wanted: false, off: 0, tries }, run: false, gaveUp: true }
  return { s: { ...s, off: 0, tries: [...tries, now] }, run: true }
}

let state: State = { wanted: false, off: 0, tries: [] }
let running = false
let logPath = ''

export function register(on: any) {
  on('session.start', async ($: any, e: any, next: any) => {
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
    const dir = `${home}/.claude/sessions`
    logPath = `${home}/.claude/rc-keepalive.log`
    // ponytail: 로그는 읽고 통째로 다시 써서 여러 세션이 동시에 쓰면 몇 줄 잃을 수 있다 — 끊김 원인 확인용이라 충분
    const log = async (line: string) => {
      const old = await $.fs.read(logPath).catch(() => '')
      await $.fs.write(logPath, [...old.split('\n').filter(Boolean), `${new Date().toISOString()} ${await $.session.id()} ${line}`].slice(-200).join('\n') + '\n')
    }

    $.clock.every(MINUTE, async () => {
      if (running) return
      const id = await $.session.id()
      const same: Seen[] = []
      for (const f of await $.fs.list(dir)) {
        if (!f.name.endsWith('.json')) continue
        const s = JSON.parse(await $.fs.read(`${dir}/${f.name}`).catch(() => '{}')) as Seen
        if (s.sessionId === id) same.push(s)
      }
      const was = state.wanted
      const r = tick(state, same, Date.now())
      state = r.s
      if (!was && state.wanted) $.ui.status(undefined)
      if (r.gaveUp) {
        await log('gave up')
        $.ui.status('원격이 계속 끊긴다 — /rc 로 직접 다시 켜기')
      }
      if (!r.run) return
      running = true
      await log('off — running /remote-control')
      try { await $.command.run({ command: 'remote-control' }) }
      catch (err) { await log(`error ${String(err)}`) }
      finally { running = false }
    })
    return next(e)
  })

  on('session.append', ($: any, e: any, next: any) => {
    const text = JSON.stringify(e.message?.content ?? '')
    // 사람이 /rc 패널에서 끊으면 명령 출력 줄에 「Remote Control disconnected.」 가 남는다 — 그 뒤로는 다시 켜지 않는다
    if (e.door === 'command' && text.includes('Remote Control disconnected')) state = { ...state, wanted: false, off: 0 }
    // 끊김 알림 문구를 아직 모른다 — Remote Control 이 들어간 알림을 로그에 남겨 다음 끊김 때 확인한다
    else if (logPath && e.message?.type === 'system' && /remote control/i.test(text))
      $.fs.read(logPath).catch(() => '')
        .then((old: string) => $.fs.write(logPath, old + `${new Date().toISOString()} notice ${e.door} ${text.slice(0, 300)}\n`))
        .catch(() => {})
    return next(e)
  })
}
