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

// 질문 창에 커밋마다 레포·브랜치·제목·파일을 풀어 보인다 — 명령 글을 셸처럼 잘라(따옴표·\·heredoc) cd·git add·commit·push 를 읽는다.
// ponytail: 변수·$(…) 안·별칭·서브셸의 cd 는 풀지 않는다 — 못 풀면 원문만 보이고, 원문은 늘 아래에 남는다
type Cmd = { argv: string[], body?: string }   // body: 이 명령에 붙은 heredoc 본문

export function split(s: string): Cmd[] {
  const out: Cmd[] = [], here: { cmd: Cmd, end: string, tabs: boolean }[] = []
  let cmd: Cmd = { argv: [] }, word: string | null = null, drop = false   // drop: 방금 리다이렉트 — 다음 단어는 파일 이름이라 뺀다
  const endWord = () => { if (word !== null) { if (!drop) cmd.argv.push(word); drop = false } word = null }
  const endCmd = () => { endWord(); if (cmd.argv.length) out.push(cmd); cmd = { argv: [] } }
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i)
    if (c === "'") {
      const j = s.indexOf("'", i + 1)
      if (j < 0) throw new Error('따옴표가 안 닫혔다')
      word = (word ?? '') + s.slice(i + 1, j); i = j
    } else if (c === '"') {
      // "$(cat <<'EOF' … EOF)" 처럼 안에 $( ) 가 있으면 그 안의 " 로는 닫히지 않는다
      let j = i + 1, depth = 0, v = ''
      for (; j < s.length && (s[j] !== '"' || depth); j++) {
        if (s[j] === '\\' && j + 1 < s.length) { const n = s.charAt(++j); v += '$`"\\'.includes(n) ? n : n === '\n' ? '' : '\\' + n; continue }
        if (s[j] === '$' && s[j + 1] === '(') depth++
        else if (s[j] === ')' && depth) depth--
        v += s[j]
      }
      if (j >= s.length) throw new Error('따옴표가 안 닫혔다')
      word = (word ?? '') + v; i = j
    } else if (c === '\\') { if (s[i + 1] !== '\n') word = (word ?? '') + (s[i + 1] ?? ''); i++ }
    else if (c === '#' && word === null) { const j = s.indexOf('\n', i); i = (j < 0 ? s.length : j) - 1 }
    else if (c === '<' && s[i + 1] === '<' && s[i + 2] !== '<') {
      endWord()
      const m = /^<<(-?)\s*(?:'([^']*)'|"([^"]*)"|([^\s;&|<>()]+))/.exec(s.slice(i))
      if (!m) throw new Error('heredoc 끝 표시를 못 읽었다')
      here.push({ cmd, end: m[2] ?? m[3] ?? m[4] ?? '', tabs: !!m[1] }); i += m[0].length - 1
    } else if (c === '<' || c === '>') {
      if (word !== null && /^\d+$/.test(word)) word = null   // 2>&1 의 2
      endWord()
      while (/[<>&|]/.test(s.charAt(i + 1))) i++
      drop = true
    } else if (c === '\n') {
      endCmd()
      // 이 줄에서 연 heredoc 들의 본문 — 끝 표시 줄까지
      for (const h of here.splice(0)) {
        const lines: string[] = []
        let j = i + 1
        while (j < s.length) {
          const k = s.indexOf('\n', j), line = s.slice(j, k < 0 ? s.length : k)
          j = k < 0 ? s.length : k + 1
          if ((h.tabs ? line.replace(/^\t+/, '') : line) === h.end) break
          lines.push(line)
        }
        h.cmd.body = lines.join('\n'); i = j - 1
      }
    } else if (c === ' ' || c === '\t') endWord()
    else if (';&|()'.includes(c)) endCmd()
    else word = (word ?? '') + c
  }
  endCmd()
  return out
}

export type Item = { op: 'commit' | 'push', dirs: string[], title?: string, msgFile?: string, files: string[], notes: string[] }   // dirs: 차례로 -C 할 폴더(cd·-C), msgFile: -F 로 준 메시지 파일
const SKIP = ['{', '!', 'then', 'do', 'else', 'command', 'env', 'exec', 'time', 'nohup']   // 명령 앞에 붙는 말
const OPT = ['-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env']   // 값을 다음 단어로 받는 git 앞 옵션
const VAL = ['--author', '--date', '--trailer', '--fixup', '--squash', '--reuse-message', '--reedit-message', '--cleanup', '--template', '--pathspec-from-file']   // 값을 다음 단어로 받는 commit 옵션

export function parse(command: string): Item[] {
  const out: Item[] = [], added = new Map<string, { files: string[], notes: string[] }>()   // 레포별로 아직 커밋 안 된 git add
  let cd: string[] = []
  for (const { argv, body } of split(command)) {
    const h = argv.findIndex(w => !/^\w+=/.test(w) && !SKIP.includes(w))
    if (h < 0) continue
    const a = argv.slice(h)
    if (a[0] === 'cd' || a[0] === 'pushd') { cd = [...cd, a[1] ?? '~']; continue }
    if (!/(^|[\\/])git(\.exe)?$/.test(a[0] ?? '')) continue
    const dirs = [...cd]
    let k = 1
    for (; k < a.length && a[k]!.startsWith('-'); k++) {
      if (a[k] === '-C') dirs.push(a[++k] ?? '')
      else if (OPT.includes(a[k]!)) k++
    }
    const op = a[k], rest = a.slice(k + 1), key = dirs.join('\0')
    if (op === 'add') {
      const at = added.get(key) ?? { files: [], notes: [] }, dash = rest.indexOf('--')
      const paths = rest.filter((w, j) => (dash >= 0 && j > dash) || !w.startsWith('-'))
      if (paths.length) at.files.push(...paths)
      else at.notes.push(`git add ${rest.join(' ')} — 바뀐 파일 전부`)
      added.set(key, at)
    } else if (op === 'push') out.push({ op, dirs, files: [], notes: [`git push ${rest.join(' ')}`.trim()] })
    else if (op === 'commit') {
      const it: Item = { op, dirs, files: [], notes: [] }, pre = added.get(key)
      if (pre) { it.files.push(...pre.files); it.notes.push(...pre.notes); added.delete(key) }
      commitArgs(rest, body, it)
      out.push(it)
    }
  }
  return out
}

function commitArgs(rest: string[], body: string | undefined, it: Item) {
  let msg: string | undefined, file: string | undefined
  for (let j = 0; j < rest.length; j++) {
    const w = rest[j]!, long = /^--([^=]+)(?:=([\s\S]*))?$/.exec(w)
    if (w === '--') { it.files.push(...rest.slice(j + 1)); break }
    if (long) {
      const [, name, val] = long
      if (name === 'message') { const v = val ?? rest[++j]; msg ??= v }
      else if (name === 'file') { const v = val ?? rest[++j]; file ??= v }
      else if (name === 'all') it.notes.push('commit --all — 추적 중인 바뀐 파일 전부')
      else if (name === 'amend') it.notes.push('amend — 마지막 커밋을 고친다')
      else if (val === undefined && VAL.includes(w)) j++
    } else if (/^-./.test(w)) {
      // -am "x"·-qF - 처럼 붙은 짧은 옵션 — 값을 받는 글자 뒤는 값
      for (let x = 1; x < w.length; x++) {
        const f = w.charAt(x)
        if (f === 'a') it.notes.push('commit -a — 추적 중인 바뀐 파일 전부')
        else if ('mFCct'.includes(f)) {
          const v = w.slice(x + 1) || rest[++j]
          if (f === 'm') msg ??= v
          if (f === 'F') file ??= v
          break
        }
      }
    } else it.files.push(w)
  }
  if (file !== undefined && file !== '-') { it.title = `(${file.split(/[\\/]/).pop()} 파일의 내용)`; it.msgFile = file }   // 실제 제목은 describe 가 파일에서 읽는다
  else {
    const text = file === '-' ? body : msg
    // -m "$(cat <<'EOF' … EOF)" 면 heredoc 첫 줄
    const t = text?.replace(/^\$\(cat\s+<<-?\s*['"]?\w+['"]?[^\n]*\n/, '')
    it.title = t?.split('\n').find(l => l.trim())?.trim()
  }
}

// 레포마다 git 으로 이름·브랜치·staged 파일 — 사람이 허락하기 전에 도니 읽기만(fsmonitor·잠금 끔, 2초)
const gitIn = ($: any, home: string, dirs: string[]) => {
  const C = dirs.flatMap(d => ['-C', d.replace(/^~(?=[\\/]|$)/, home)])
  return (...a: string[]): Promise<string | undefined> =>
    $.process.run(['git', '-c', 'core.fsmonitor=false', ...C, ...a], { timeoutMs: 2000, env: { GIT_OPTIONAL_LOCKS: '0' } })
      .then((r: any) => r.exitCode ? undefined : r.stdout.trim()).catch(() => undefined)
}
// 경로를 cd·-C 폴더를 차례로 따라 푼다(git 이 그 폴더에서 -F 파일을 읽는다) — 절대 경로가 오면 거기서 다시 시작, ~ 는 집
export const pathIn = (home: string, dirs: string[], f: string) =>
  [...dirs, f].map(d => d.replace(/^~(?=[\\/]|$)/, home)).reduce((p, d) => !p || /^([\\/]|[A-Za-z]:)/.test(d) ? d : `${p}/${d}`, '')

async function look($: any, home: string, dirs: string[]) {
  const git = gitIn($, home, dirs)
  const [top, branch, staged] = await Promise.all([git('rev-parse', '--show-toplevel'), git('branch', '--show-current'), git('diff', '--cached', '--name-only')])
  return { top, branch, staged }
}

// 티켓키 — 워크트리 설정 gada.ticket(PROJ-<id>·ISSUE-<id>, gada-tree 가 건다)이 있는데 커밋 제목에 [PROJ-…]·[ISSUE-…] 가 없으면 그 키를 돌려준다.
// 예전 git 훅(prepare-commit-msg)은 레포마다 링크라 맥을 옮기면 깨져서 여기로 옮겼다. 고쳐 끼우지 않고 막아서 Claude 가 제목을 다시 쓰게 한다.
// ponytail: amend·-F 파일·못 읽은 제목(편집기)은 보지 않는다 — 사람이 터미널에서 하는 커밋도 못 본다
const TICKET = /^(PROJ|ISSUE)-\d+$/, HAS_KEY = /\[(PROJ|ISSUE)-\d+\]/
export async function missingKeys($: any, command: string) {
  const items = parse(command).filter(it => it.op === 'commit' && it.title && !/^\(.+ 파일의 내용\)$/.test(it.title) && !it.notes.some(n => n.startsWith('amend')) && !HAS_KEY.test(it.title))
  if (!items.length) return []
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '~'
  const keys = await Promise.all(items.map(it => gitIn($, home, it.dirs)('config', '--get', 'gada.ticket')))
  return [...new Set(keys.filter((k): k is string => !!k && TICKET.test(k)))]
}

export async function describe($: any, command: string) {
  const items = parse(command)
  if (!items.length) return undefined
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '~'
  // -F 파일이면 그 파일의 첫 글 줄(# 주석 빼고)을 제목으로 — 못 읽으면 「(파일 이름 파일의 내용)」 그대로
  const titled = async (it: Item) => {
    if (it.msgFile === undefined) return
    const text = await $.fs.read(pathIn(home, it.dirs, it.msgFile)).catch(() => '')
    it.title = String(text).split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#')) ?? it.title
  }
  const seen = await Promise.all(items.map(async it => { await titled(it); return { it, ...await look($, home, it.dirs) } }))
  const count = (op: string) => items.filter(it => it.op === op).length
  const lines = [`${['commit', 'push'].filter(count).map(op => `git ${op} ${count(op)}건`).join(' · ')} — 실행할까?`]
  for (const { it, top, branch, staged } of seen) {
    const files = [...new Set([...it.files, ...(it.op === 'commit' && staged ? staged.split('\n') : [])])]
    lines.push('', `${top?.split(/[\\/]/).pop() ?? it.dirs.at(-1) ?? '(지금 폴더)'} (${branch || (branch === '' ? 'HEAD 분리' : '브랜치 모름')})`)
    if (it.op === 'commit') lines.push(`  제목: ${it.title ?? '(못 읽었다)'}`)
    if (files.length) lines.push(`  파일 ${files.length}개: ${files.slice(0, 8).join(', ')}${files.length > 8 ? ` 외 ${files.length - 8}개` : ''}`)
    else if (it.op === 'commit' && staged === '' && !it.notes.length) lines.push('  staged 파일 없음')
    lines.push(...it.notes.map(t => `  ${t}`))
  }
  // 글로 찾은 commit·push 가 푼 것보다 많으면(bash -c, $(…), 메시지 속 글 등) 알린다
  const more = (command.match(new RegExp(GIT.source, 'g'))?.length ?? 0) - items.length
  if (more > 0) lines.push('', `명령 글에 git commit·push 가 ${more}번 더 보인다 — 원문에서 확인`)
  return lines.join('\n')
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
    const keys = await missingKeys($, e.command).catch(() => [])   // 못 풀면 그냥 묻는다
    if (keys.length) return { deny: `커밋 제목에 티켓키가 없다(워크트리 gada.ticket = ${keys.join(', ')}) — 제목을 '<타입>[${keys[0]}]. [태그] 내용' 꼴로 고쳐 다시 커밋한다` }
    const cmd = e.command.length > 400 ? `${e.command.slice(0, 400)}…` : e.command
    const told = await describe($, e.command).catch(() => undefined)
    const a = await $.ui.ask(told ? `${told}\n\n명령 원문(앞 400자):\n${cmd}` : `git ${what} 실행할까?\n\n${cmd}`, { header: `git ${what}`, options: [YES, NO] })
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
