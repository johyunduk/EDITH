import { expect, test } from 'claude-code/testing'
import { gitWrite } from './register.ts'

test('git commit·push 를 찾는다 — 옵션·경로·이어 붙인 명령·셸 안 따옴표까지, 다른 git 명령과 이름만 비슷한 것은 아니다', async () => {
  for (const c of ['git commit -m x', 'git push', 'cd a && git add -A && git commit -q -F - <<EOF', 'git -C "my dir" push origin main',
    "git -c user.email=a@b commit -m 'x'", 'git --no-pager push', '/usr/bin/git push', 'GIT_DIR=x git push', 'bash -c "git push"', 'echo $(git commit)',
    'git --git-dir /x/.git commit', 'git.exe push', 'git push --force-with-lease'])
    expect(gitWrite(c)).not.toBe(null)
  expect(gitWrite('git commit -m x')).toBe('commit')
  expect(gitWrite('git -C a push')).toBe('push')
  for (const c of ['git status', 'git log --grep commit', 'git help push', 'git diff HEAD~1', 'my-git push', 'legit push', 'ls .git push', 'npm run commitlint', 'gitpush'])
    expect(gitWrite(c)).toBe(null)
})

// 실제 묻기 흐름 — 도구는 아래 훅이 대신하고, 질문은 정한 답으로 받는다
const answer = (pick: string) => ($: any, e: any) => ({ result: { questions: e.questions, answers: { [e.questions[0].question]: pick } } })

test('허락하면 실행하고, 막으면 실행하지 않는다', async ($: any, on: any) => {
  let ran = 0, pick = '실행'
  on('tool.call', { tool: 'Bash' }, () => { ran++; return { result: 'ok' } })
  on('tool.call', { tool: 'AskUserQuestion' }, ($: any, e: any) => answer(pick)($, e))
  const ok = await $.tool.call({ tool: 'Bash', command: 'git push' })
  expect(ok.isError ?? false).toBe(false)
  expect(ran).toBe(1)
  pick = '막기'
  const no = await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
  expect(String(no.text ?? no.deny)).toContain('막았다')
  expect(ran).toBe(1)
  await $.tool.call({ tool: 'Bash', command: 'git status' })   // 묻지 않고 그냥
  expect(ran).toBe(2)
})

test('물을 수 없으면(창 닫음) 막는다', async ($: any, on: any) => {
  let ran = 0
  on('tool.call', { tool: 'Bash' }, () => { ran++; return { result: 'ok' } })
  on('tool.call', { tool: 'AskUserQuestion' }, () => { throw new Error('dismissed') })
  await $.tool.call({ tool: 'Bash', command: 'git push' }).catch(() => null)
  expect(ran).toBe(0)
})

test('끄면(enabled false) 묻지 않고 그냥 실행한다', { options: { enabled: false } }, async ($: any, on: any) => {
  let ran = 0, asked = 0
  on('tool.call', { tool: 'Bash' }, () => { ran++; return { result: 'ok' } })
  on('tool.call', { tool: 'AskUserQuestion' }, () => { asked++; throw new Error('묻지 않아야 한다') })
  await $.tool.call({ tool: 'Bash', command: 'git push' })
  expect(asked).toBe(0)
  expect(ran).toBe(1)
})
