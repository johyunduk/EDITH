// Claude 끼리는 SendMessage — 다른 Claude 세션에 herdr 로 글을 치는 대신 Claude Code 의 세션 간 메시지로 보내게 한다.
// herdr 로 친 글은 받는 쪽에서 사용자 지시가 되고, 받는 쪽이 승인 창을 띄우고 있으면 글자가 키로 먹힌다. SendMessage 는
// 「다른 에이전트가 보낸 것」 으로 표시되고, 바쁜 세션에는 다음 도구 사이에 들어간다.
// 그래서 Claude 가 herdr 로 그냥 글(슬래시 명령 아님)을 보내려는데 받는 pane 이 ListAgents 에 하나뿐인 Claude 세션이면 막고 그 이름을 알려 준다.
// Codex·셸 pane, 목록에 없거나 이름이 겹치는 세션, 키 입력·띄우기·화면 읽기는 그대로 — 판단은 규칙만(모델 호출 없음).
// 길잡이 훅이라 깨지면 열린다(그대로 herdr 로 간다).

// herdr 로 글을 치는 명령 — agent prompt·pane send-text·pane run. 옵션(--wait 등)은 건너뛰고 대상과 그 뒤 첫 글자로 슬래시 명령인지 본다.
// ponytail: 글자로 찾는다 — 변수에 담은 대상($PANE)·스크립트 안의 herdr 는 못 본다(그때는 그대로 간다)
const SEND = /(?:^|[^\w.-])herdr\s+(?:agent\s+prompt|pane\s+(?:send-text|run))((?:\s+--?[\w-]+(?:=\S+|\s+\d+)?)*)\s+("[^"]+"|'[^']+'|[^\s;&|"'$-][^\s;&|]*)\s*(\S?)(\S?)/g

export type Send = { target: string; slash: boolean }
export function sends(command: string): Send[] {
  return [...command.matchAll(SEND)].map(m => ({
    target: m[2].replace(/^["']|["']$/g, ''),
    slash: m[3] === '/' || (/["']/.test(m[3]) && m[4] === '/'),
  }))
}

// ListAgents 글에서 세션 이름 — 「  이름 [ref]  ·  interactive  ·  idle …」 줄
export function peerNames(text: string): string[] {
  return [...text.matchAll(/^\s+(.+?) \[[0-9a-f]{4,}\]\s+·/gm)].map(m => m[1])
}

const RULE = `

Claude 세션끼리 주고받는 말(일 넘기기·질문·답)은 herdr agent prompt·pane send-text·pane run 대신 SendMessage(to: ListAgents 의 이름 — 둘 다 ToolSearch 로 불러 쓴다)로 보낸다. 다른 에이전트가 보낸 메시지로 표시되고, 받는 쪽이 바빠도 승인 창에 끼어들지 않는다. herdr 는 Codex·셸 pane, ListAgents 에 없는 세션, 슬래시 명령·키 입력·띄우기·화면 읽기에 쓴다.`

// 켜짐(기본)·꺼짐 — 옵션 enabled(EDITH 설정 화면·/config). 호출 때마다 /config 에서 읽어 떠 있는 세션에도 바로 듣는다.
const KEY = 'peer-message.enabled'
let loaded: boolean | undefined
async function enabled($: any) {
  const row = (await $.config.list().catch(() => [])).find((r: any) => r.key === KEY)
  return (row ? row.value : loaded) !== false
}

export function register(on: any, options: { enabled?: boolean } = {}) {
  loaded = options.enabled

  // Bash 설명에 고르는 법을 붙여 처음부터 맞게 고르게 한다(막히는 일을 줄인다)
  on('tool.describe', { tool: 'Bash' }, async ($: any, e: any, next: any) => {
    const r = await next(e)
    return await enabled($) ? { ...r, description: r.description + RULE } : r
  })

  on('tool.call', async ($: any, e: any, next: any) => {
    const list = typeof e.command === 'string' ? sends(e.command).filter(s => !s.slash) : []
    if (!list.length || !await enabled($)) return next(e)
    let peers: string[] | undefined
    for (const s of list) {
      const r = await $.process.run(['herdr', 'agent', 'get', s.target], { timeoutMs: 5000 }).catch(() => null)
      const a = r?.exitCode === 0 ? JSON.parse(r.stdout).result?.agent : null
      const name: string | undefined = a?.terminal_title_stripped
      if (a?.agent !== 'claude' || !name) continue
      peers ??= peerNames((await $.tool.call({ tool: 'ListAgents' }).catch(() => null))?.text ?? '')
      if (peers.filter(n => n === name).length !== 1) continue   // 목록에 없거나(SendMessage 로 못 닿음) 이름이 겹치면 herdr 그대로
      return { deny: `${a.pane_id} 는 Claude 세션 「${name}」 — Claude 끼리는 herdr 대신 SendMessage({ to: ${JSON.stringify(name)}, message }) 로 보낸다(ToolSearch 로 불러 쓴다). 다른 에이전트 메시지로 표시되고, 상대가 바빠도 승인 창에 끼어들지 않는다. 슬래시 명령·키 입력이 필요하면 herdr 그대로.` }
    }
    return next(e)
  })
}
