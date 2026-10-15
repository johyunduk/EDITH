// 커밋 지킴이 — 셸 명령에 git commit·push 가 들어 있으면 실행 전에 사람에게 묻는다.
// 권한 확인(tool.check)의 ask 는 auto 모드면 분류기가 대신 답하므로, 그보다 앞(tool.call)에서 $.ui.ask 로 직접 묻는다.
// 물을 사람이 없거나(-p) 창을 닫거나 훅이 깨지면 막는다 — 실패하면 열리는 게 아니라 닫힌다.

// git 뒤 옵션(-C 경로, -c 키=값, --no-pager …)을 건너 commit·push 가 오면. 앞은 단어 경계라 cd x && git push, /usr/bin/git push,
// bash -c "git push", $(git commit) 도 잡는다.
// ponytail: 글자로 찾는다 — echo "git push" 처럼 실행하지 않는 글에도 묻고, git 별칭(git ci)·스크립트 안의 커밋은 못 본다
const GIT = /(?:^|[^\w.-])git(?:\.exe)?\s+(?:(?:-[Cc]|--(?:git-dir|work-tree|namespace|exec-path|super-prefix|config-env))\s+(?:"[^"]*"|'[^']*'|\S+)\s+|-\S+\s+)*(commit|push)\b/

export function gitWrite(command: string): 'commit' | 'push' | null {
  return (command.match(GIT)?.[1] as 'commit' | 'push' | undefined) ?? null
}

const YES = '실행', NO = '막기'
const approved = new Set<string>()   // 사람이 허락한 호출(tool_use_id) — 그 호출의 권한 확인은 다시 묻지 않는다

// 켜짐(기본)·꺼짐 — 옵션 enabled(EDITH 설정 화면·/config·claude plugin configure). 호출 때마다 /config 에서 읽어 떠 있는 세션에도 바로 듣는다.
const KEY = 'commit-guard.enabled'
let loaded: boolean | undefined   // 불러올 때의 옵션 — /config 에 줄이 없을 때(테스트 등)
async function enabled($: any) {
  const row = (await $.config.list().catch(() => [])).find((r: any) => r.key === KEY)
  return (row ? row.value : loaded) !== false
}

export function register(on: any, options: { enabled?: boolean } = {}) {
  loaded = options.enabled
  // Bash·PowerShell·Monitor 처럼 command 를 받는 도구 모두
  on('tool.call', async ($: any, e: any, next: any) => {
    const what = typeof e.command === 'string' ? gitWrite(e.command) : null
    if (!what || !await enabled($)) return next(e)
    // 엔진 자체 fork(기억·요약 등 — 목록에 없는 loop)의 도구 호출은 어차피 막히는 것이라 묻지 않고 막는다(엉뚱한 때 질문 창이 뜨지 않게).
    // ponytail: 워크플로 agent 도 목록에 없어 여기서 막힌다 — 커밋은 메인 대화나 subagent 에서
    if (e.agentId && !(await $.agent.list()).some((a: any) => a.id === e.agentId)) return { deny: `git ${what} 는 메인 대화에서만 — 이 loop 에서는 사용자에게 물을 수 없어 막았다` }
    const cmd = e.command.length > 400 ? `${e.command.slice(0, 400)}…` : e.command
    const a = await $.ui.ask(`git ${what} 실행할까?\n\n${cmd}`, { header: `git ${what}`, options: [YES, NO] })
    if (a !== YES) return { deny: `사용자가 git ${what} 실행을 막았다 — 다시 시도하지 말고 사용자에게 어떻게 할지 묻는다` }
    if (e.tool_use_id) approved.add(e.tool_use_id)
    try { return await next(e) } finally { if (e.tool_use_id) approved.delete(e.tool_use_id) }
  }).catch(($: any, e: any, next: any) => next.called ? next(e) : { deny: '커밋 지킴이가 사용자에게 묻지 못했다(물을 사람이 없거나 창이 닫힘) — 실행하지 않았다' })

  // 방금 허락한 호출은 권한 확인의 ask(대화상자·auto 분류기)를 허락으로 — 두 번 묻지 않게. 규칙의 deny 는 그대로 둔다.
  on('tool.check', async ($: any, e: any, next: any) => {
    const v = await next(e)
    return v?.decision === 'ask' && e.tool_use_id && approved.has(e.tool_use_id) ? { ...v, decision: 'allow', reason: '커밋 지킴이에서 사용자가 허락' } : v
  })
}
