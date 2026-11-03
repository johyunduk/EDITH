import { expect, test } from 'claude-code/testing'
import { gitWrite, mergeLine, parse, pathIn, pushRefs, pushTo } from './register.ts'

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
  expect(parse('cd /r && git -C sub commit -F /tmp/x/msg.txt')[0]).toMatchObject({ dirs: ['/r', 'sub'], title: '(msg.txt 파일의 내용)', msgFile: '/tmp/x/msg.txt' })
  // -F 파일 경로는 cd·-C 를 따라 풀고, 절대 경로·~ 는 거기서 다시 시작
  expect(pathIn('/h', ['/r', 'sub'], 'm.txt')).toBe('/r/sub/m.txt')
  expect(pathIn('/h', ['/r'], '/tmp/m.txt')).toBe('/tmp/m.txt')
  expect(pathIn('/h', ['/r'], '~/m.txt')).toBe('/h/m.txt')
  expect(pathIn('/h', [], 'm.txt')).toBe('m.txt')
  expect(parse('bash -c "git push"')).toEqual([])   // 못 푸는 것 — 원문만
  expect(() => parse('git commit -m "안 닫힘')).toThrow()
})

test('질문 창에 커밋을 풀어 보이고 원문은 아래에 남긴다', async ($: any, on: any) => {
  let asked = ''
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'AskUserQuestion' }, ($: any, e: any) => { asked = e.questions[0].question; return answer('실행')($, e) })
  on('env.get', () => ({ value: '/home/me' }))
  let read = ''
  on('fs.read', ($: any, e: any) => { read = e.path; return { value: '# 주석\n\n파일에 쓴 제목\n\n본문' } })
  on('process.run', ($: any, e: any) => {
    const sub = e.argv.slice(e.argv.lastIndexOf('-C') + 2).join(' ')
    if (sub.includes('MERGE_HEAD')) return { value: { exitCode: 1, stdout: '', stderr: '' } }   // 머지 중 아님
    const out = sub === 'rev-parse --show-toplevel' ? '/r/my-repo' : sub === 'branch --show-current' ? 'main' : 'already.ts'
    return { value: { exitCode: 0, stdout: `${out}\n`, stderr: '' } }
  })
  await $.tool.call({ tool: 'Bash', command: 'git -C /r/my-repo add new.ts && git -C /r/my-repo commit -m "새 기능"', description: '새 기능을 main 에 커밋한다' })
  expect(asked.startsWith('왜: 새 기능을 main 에 커밋한다\n')).toBe(true)
  expect(asked).toContain('git commit 1건 — 실행할까?')
  expect(asked).toContain('my-repo\n  커밋할 브랜치: main\n  제목: 새 기능')
  expect(asked).not.toContain('머지 마무리')
  expect(asked).toContain('제목: 새 기능')
  expect(asked).toContain('파일 2개: new.ts, already.ts')
  expect(asked).toContain('명령 원문(앞 400자):\ngit -C /r/my-repo add')
  // -F 파일이면 그 파일의 첫 글 줄이 제목 — 경로는 -C 폴더 기준
  await $.tool.call({ tool: 'Bash', command: 'git -C /r/my-repo commit -F msg.txt' })
  expect(asked).toContain('왜: (Claude 가 설명을 붙이지 않았다)')
  expect(read).toBe('/r/my-repo/msg.txt')
  expect(asked).toContain('제목: 파일에 쓴 제목')
})

test('워크트리에 gada.ticket 이 있는데 제목에 키가 없으면 묻지 않고 막는다 — 키가 있거나·amend·키 꼴이 아니면 그냥 묻는다', async ($: any, on: any) => {
  let ran = 0, asked = 0, ticket = 'ISSUE-9513'
  on('tool.call', { tool: 'Bash' }, () => { ran++; return { result: 'ok' } })
  on('tool.call', { tool: 'AskUserQuestion' }, ($: any, e: any) => { asked++; return answer('실행')($, e) })
  on('env.get', () => ({ value: '/home/me' }))
  on('process.run', ($: any, e: any) => ({ value: { exitCode: 0, stdout: e.argv.includes('gada.ticket') ? `${ticket}\n` : 'x\n', stderr: '' } }))
  const no = await $.tool.call({ tool: 'Bash', command: 'git -C /r/wt commit -m "fix. [상벌] 옵션 변경"' })
  expect(String(no.text ?? no.deny)).toContain("'<타입>[ISSUE-9513]. [태그] 내용'")
  expect([ran, asked]).toEqual([0, 0])
  for (const c of ['git commit -m "fix[ISSUE-9513]. [상벌] 옵션 변경"', 'git commit -m "fix[PROJ-4542]. 안건 키"', 'git commit --amend -m "고침"', 'git commit -F msg.txt'])
    await $.tool.call({ tool: 'Bash', command: c })
  expect([ran, asked]).toEqual([4, 4])
  ticket = 'already.ts'   // 키 꼴이 아닌 값은 무시
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "아무 제목"' })
  expect([ran, asked]).toEqual([5, 5])
})

test('main · master 로 가는 push 를 안다 — refspec 의 dst, 없거나 HEAD 면 지금 브랜치, 다른 브랜치는 아니다', async () => {
  expect(pushTo(['origin', 'main'])).toEqual({ branch: 'main', remote: 'origin' })
  expect(pushTo(['-u', 'up', 'HEAD:refs/heads/master'])).toEqual({ branch: 'master', remote: 'up' })
  expect(pushTo([], 'main')).toEqual({ branch: 'main', remote: 'origin' })
  expect(pushTo(['origin', 'HEAD'], 'master')).toEqual({ branch: 'master', remote: 'origin' })
  expect(pushTo(['origin', '+feature/x:main'])).toEqual({ branch: 'main', remote: 'origin' })
  for (const [a, cur] of [[['origin', 'feature/x'], 'main'], [[], 'feature/x'], [['origin', 'main-v2']], [['origin', 'feature/main']]] as [string[], string?][])
    expect(pushTo(a, cur)).toBe(null)
})

test('main 푸시면 머리 「⚠ main 푸시」 · 첫 줄 ⚠ · 실행 단추 「실행 — main 에 푸시」, 다른 브랜치 push 는 그대로', async ($: any, on: any) => {
  let q: any, ran = 0
  on('tool.call', { tool: 'Bash' }, () => { ran++; return { result: 'ok' } })
  on('tool.call', { tool: 'AskUserQuestion' }, ($: any, e: any) => { q = e.questions[0]; return answer(q.options[0].label)($, e) })
  on('env.get', () => ({ value: '/home/me' }))
  on('process.run', ($: any, e: any) => ({ value: { exitCode: 0, stdout: e.argv.includes('--show-current') ? 'feature/x\n' : '/r/app\n', stderr: '' } }))
  await $.tool.call({ tool: 'Bash', command: 'git -C /r/app push origin main', description: 'main 에 올린다' })
  expect(q.header).toBe('⚠ main 푸시')
  expect(q.question.startsWith('⚠ main 에 바로 올라간다 — origin/main\n왜: main 에 올린다\n')).toBe(true)
  expect(q.options.map((o: any) => o.label)).toEqual(['실행 — main 에 푸시', '막기'])
  expect(ran).toBe(1)
  await $.tool.call({ tool: 'Bash', command: 'git -C /r/app push' })   // 지금 브랜치 feature/x
  expect(q.header).toBe('git push')
  expect(q.options.map((o: any) => o.label)).toEqual(['실행', '막기'])
  expect(ran).toBe(2)
})

test('push 가 무엇을 어디로 — refspec 마다 src → dst, 없거나 HEAD 면 지금 브랜치, 지움, --tags 는 풀지 않는다', async () => {
  expect(pushRefs(['origin', 'merge/123-x:dev'])).toEqual({ remote: 'origin', refs: [{ src: 'merge/123-x', dst: 'dev' }] })
  expect(pushRefs([], 'feature/x')).toEqual({ remote: 'origin', refs: [{ src: 'feature/x', dst: 'feature/x' }] })
  expect(pushRefs(['-u', 'up', 'HEAD'], 'f')).toEqual({ remote: 'up', refs: [{ src: 'f', dst: 'f' }] })
  expect(pushRefs(['origin', 'abc1234:refs/heads/stage']).refs).toEqual([{ src: 'abc1234', dst: 'stage' }])
  expect(pushRefs(['origin', ':old']).refs).toEqual([{ src: '', dst: 'old' }])
  expect(pushRefs(['origin', '--delete', 'old']).refs).toEqual([{ src: '', dst: 'old' }])
  expect(pushRefs(['origin', '--tags']).refs).toEqual([])
})

test('머지 마무리 줄 — MERGE_MSG 첫 줄의 X → Y, into 가 없으면 지금 브랜치, 모르는 꼴은 그대로', async () => {
  expect(mergeLine("Merge remote-tracking branch 'origin/dev' into merge/456-x\n\n# Conflicts:\n#\ta.php\n")).toBe('origin/dev → merge/456-x')
  expect(mergeLine("Merge branch 'feature/x'", 'master')).toBe('feature/x → master')
  expect(mergeLine("Merge branches 'a' and 'b'")).toBe("Merge branches 'a' and 'b'")
})

test('질문 창 — 커밋할 브랜치 · 머지 마무리(X → Y) · push(src → 원격/dst)', async ($: any, on: any) => {
  let asked = ''
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'AskUserQuestion' }, ($: any, e: any) => { asked = e.questions[0].question; return answer('실행')($, e) })
  on('env.get', () => ({ value: '/home/me' }))
  on('fs.read', ($: any, e: any) => ({ value: e.path === '/r/wt/.git/MERGE_MSG' ? "Merge remote-tracking branch 'origin/dev' into merge/123-x\n" : '' }))
  on('process.run', ($: any, e: any) => {
    const sub = e.argv.slice(e.argv.lastIndexOf('-C') + 2).join(' ')
    const out = sub === 'rev-parse --show-toplevel' ? '/r/wt' : sub === 'branch --show-current' ? 'merge/123-x' : sub.includes('--git-path') ? '/r/wt/.git/MERGE_MSG' : sub.includes('MERGE_HEAD') ? 'abc' : 'a.php'
    return { value: { exitCode: 0, stdout: `${out}\n`, stderr: '' } }
  })
  await $.tool.call({ tool: 'Bash', command: 'cd /r/wt && git commit --no-edit && git push origin merge/123-x:dev' })
  expect(asked).toContain('wt\n  커밋할 브랜치: merge/123-x\n  머지 마무리: origin/dev → merge/123-x\n')
  expect(asked).toContain('wt\n  push: merge/123-x → origin/dev\n  git push origin merge/123-x:dev')
})

test('같은 명령에서 정한 변수(W=… · export · ${W})는 cd · -C · -F · push 인자에서 푼다, 못 푼 것은 그대로', async () => {
  expect(parse('W=~/r/wt; cd $W && git commit -m x')[0]?.dirs).toEqual(['~/r/wt'])
  expect(parse('export WT=/r/a\ngit -C "$WT" commit -F "${WT}/m.txt"')[0]).toMatchObject({ dirs: ['/r/a'], msgFile: '/r/a/m.txt' })
  expect(parse('B=merge/123-x; git push origin $B:dev')[0]?.args).toEqual(['origin', 'merge/123-x:dev'])
  expect(parse('W=/r/a; M="$W-merge"; cd "$M" && git commit -m x')[0]?.dirs).toEqual(['/r/a-merge'])
  expect(parse('git -C "$NOPE" commit -m "값 $5"')[0]).toMatchObject({ dirs: ['$NOPE'], title: '값 $5' })
  expect(parse('W=/r/x git -C /r/a commit -m x')[0]?.dirs).toEqual(['/r/a'])   // 명령 앞 W=… 는 남기지 않는다
})

test('폴더를 못 읽으면 「브랜치 모름」 대신 까닭 — 못 푼 변수 · 아직 없는 폴더', async ($: any, on: any) => {
  let asked = ''
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'AskUserQuestion' }, ($: any, e: any) => { asked = e.questions[0].question; return answer('실행')($, e) })
  on('env.get', () => ({ value: '/home/me' }))
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'fatal: cannot change' } }))
  await $.tool.call({ tool: 'Bash', command: 'git -C "$WT" commit -m "fix[PROJ-1]. x"' })
  expect(asked).toContain('$WT — 폴더를 못 읽었다: 경로의 변수를 풀지 못했다\n  커밋할 브랜치: 모름')
  await $.tool.call({ tool: 'Bash', command: 'mkdir /r/new && cd /r/new && git init && git commit -m "fix[PROJ-1]. x"' })
  expect(asked).toContain('/r/new — 폴더를 못 읽었다: 아직 없는 폴더(이 명령이 만든다)')
})
