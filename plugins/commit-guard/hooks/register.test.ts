import { expect, test } from 'claude-code/testing'
import { gitWrite, parse } from './register.ts'

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

test('명령 글에서 커밋마다 레포·제목·파일을 푼다 — cd·-C·heredoc·$(cat <<EOF)·여러 레포', async () => {
  const one = parse("cd /r/a && git add x.ts y.ts && git commit -q -F - <<'EOF'\n제목 하나\n\n본문 \"따옴표\"\nEOF")
  expect(one).toEqual([{ op: 'commit', dirs: ['/r/a'], title: '제목 하나', files: ['x.ts', 'y.ts'], notes: [] }])
  const two = parse('test "$(git -C /r/a branch --show-current)" = main && git -C /r/a add -A -- s.ts t.ts && git -C /r/a commit -m "고침 a" && git -C /r/b add -A && git -C /r/b commit -m \'고침 b\' && git -C /r/b push origin main')
  expect(two.map(i => [i.op, i.dirs.join(), i.title, i.files.join(), i.notes.join()])).toEqual([
    ['commit', '/r/a', '고침 a', 's.ts,t.ts', ''],
    ['commit', '/r/b', '고침 b', '', 'git add -A — 바뀐 파일 전부'],
    ['push', '/r/b', undefined, '', 'git push origin main']])
  expect(parse(`git commit -m "$(cat <<'EOF'\nClaude 식 (괄호) 제목\n\n본문\nEOF\n)"`)[0]?.title).toBe('Claude 식 (괄호) 제목')
  expect(parse('git commit -am "빠른 것" --amend 2>&1')[0]).toEqual({ op: 'commit', dirs: [], title: '빠른 것', files: [], notes: ['commit -a — 추적 중인 바뀐 파일 전부', 'amend — 마지막 커밋을 고친다'] })
  expect(parse('git commit -F msg.txt -- a.ts')[0]?.title).toBe('(msg.txt 파일의 내용)')
  expect(parse('bash -c "git push"')).toEqual([])   // 못 푸는 것 — 원문만
  expect(() => parse('git commit -m "안 닫힘')).toThrow()
})

test('질문 창에 커밋을 풀어 보이고 원문은 아래에 남긴다', async ($: any, on: any) => {
  let asked = ''
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'AskUserQuestion' }, ($: any, e: any) => { asked = e.questions[0].question; return answer('실행')($, e) })
  on('env.get', () => ({ value: '/home/me' }))
  on('process.run', ($: any, e: any) => {
    const sub = e.argv.slice(e.argv.lastIndexOf('-C') + 2).join(' ')
    const out = sub === 'rev-parse --show-toplevel' ? '/r/my-repo' : sub === 'branch --show-current' ? 'main' : 'already.ts'
    return { value: { exitCode: 0, stdout: `${out}\n`, stderr: '' } }
  })
  await $.tool.call({ tool: 'Bash', command: 'git -C /r/my-repo add new.ts && git -C /r/my-repo commit -m "새 기능"' })
  expect(asked).toContain('git commit 1건 — 실행할까?')
  expect(asked).toContain('my-repo (main)')
  expect(asked).toContain('제목: 새 기능')
  expect(asked).toContain('파일 2개: new.ts, already.ts')
  expect(asked).toContain('명령 원문(앞 400자):\ngit -C /r/my-repo add')
})
