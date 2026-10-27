// edith update 의 받기 — 이 체크아웃에서 고친 것이 있어도 받는다.
// 받는 사람이 자기 것으로 고쳐 쓰는 기본판이라 커밋 안 된 고침이 흔하다 — 그때마다 pull 이 멈추지 않게:
// 줄끝(CRLF · LF)만 바뀐 파일은 되돌리고, 진짜 고침은 git 이 잠깐 치워 뒀다가(--autostash) 받은 뒤 다시 얹는다.
// 다시 얹다 같은 줄이 겹치면 Claude 가 겹친 파일만 합치고, 통과는 기계(타입 검사 · 시험 · 화면 빌드)가 정한다.
// 못 합치면 받은 코드 그대로 두고 고친 것은 stash 에 남긴다 — 어느 쪽이든 EDITH 는 새 코드로 뜬다.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const win = process.platform === 'win32';
const git = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });

// git status --porcelain -z 에서 「추적 중 · 작업 트리에서만 바뀐」 파일(` M`) — 스테이징한 것은 사람이 고른 것이라 건드리지 않는다
export function worktreeModified(porcelainZ: string): string[] {
  const out: string[] = [], parts = porcelainZ.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    if (e[0] === 'R' || e[0] === 'C') i++;   // 이름 바꾸기 · 복사는 옛 이름이 다음 칸에 온다
    else if (e[0] === ' ' && e[1] === 'M') out.push(e.slice(3));
  }
  return out;
}

// 줄끝만 다른 파일을 되돌린다 — 내용은 같으니 잃는 것이 없다(편집기 · 도구가 CRLF 를 LF 로 다시 써서 생긴다). 되돌린 파일 이름
export function restoreEolOnly(cwd: string): string[] {
  const st = git(cwd, ['status', '--porcelain', '-z']);
  if (st.status !== 0) return [];
  return worktreeModified(st.stdout).filter(f =>
    git(cwd, ['diff', '--ignore-cr-at-eol', '--quiet', '--', f]).status === 0 && git(cwd, ['checkout', '--', f]).status === 0);
}

// 커밋 안 된 추적 파일 — 업데이트 끝에 「다른 기기는 이것을 못 받는다」 고 알린다
export function uncommitted(cwd: string): string[] {
  return git(cwd, ['status', '--porcelain', '-uno']).stdout.split('\n').filter(Boolean).map(l => l.slice(3));
}

// 검사 — 타입 검사 · 화면 빌드가 되는가, 시험은 어느 것이 실패하나(이 PC 에서 원래 실패하는 시험이 있어 「새로 실패한 것」 으로 본다)
export type Check = { typecheck: boolean; build: boolean; failing: string[] };
export type Checker = (cwd: string) => Check;
export type Resolver = (cwd: string, files: string[], patch: string) => { ok: boolean; note: string };

// TAP 의 맨 위 「not ok N - 이름」 — 시험 파일 하나 = 줄 하나가 아니라 test() 하나 = 줄 하나(들여 쓴 하위 줄은 뺀다)
export function failingOf(tap: string): string[] {
  return [...tap.matchAll(/^not ok \d+ - (.+)$/gm)].map(m => m[1].trim()).sort();
}

export const checkRepo: Checker = cwd => {
  const ok = (cmd: string, a: string[]) => spawnSync(cmd, a, { cwd, stdio: 'ignore', shell: win }).status === 0;   // npm 은 Windows 에서 npm.cmd(인자는 고정 글자뿐)
  const t = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'src/**/*.test.ts'], { cwd, encoding: 'utf8', maxBuffer: 64 << 20 });
  return { typecheck: ok('npm', ['run', 'typecheck']), build: ok('npm', ['run', 'build']), failing: failingOf(t.stdout ?? '') };
};

const MARK = /^(<{7}|>{7})( |$)|^={7}$/m;   // git 겹침 표시
export const hasMarkers = (text: string) => MARK.test(text);

// 겹친 파일만 Claude 가 합친다 — 도구는 파일 읽기 · 고치기만(명령 · MCP · 훅 없음), 세션 기록도 남기지 않는다
export const claudeResolve: Resolver = (cwd, files, patch) => {
  const prompt = [
    'EDITH 업데이트 중 겹침 풀기. 이 폴더(EDITH 체크아웃)는 방금 새 코드를 받았다. 받기 전에 이 폴더에 커밋 안 된 고침이 있었고,',
    '그 고침을 새 코드 위에 다시 얹다가 아래 파일에서 같은 줄이 겹쳤다 — 파일 안에 <<<<<<< Updated upstream / ======= / >>>>>>> Stashed changes 표시가 있다.',
    `겹친 파일: ${files.join(', ')}`,
    '할 일: 겹친 파일만 고친다. 받은 새 코드(Updated upstream 쪽)의 변경을 살리고, 그 위에 이 폴더의 고침(Stashed changes 쪽)이 하려던 일을 다시 얹는다. 표시는 하나도 남기지 않는다. AGENTS.md 의 코드 꼴을 따른다.',
    '하지 말 것: 겹친 파일 밖을 고치기 · 명령 실행. 둘을 함께 둘 수 없으면 새 코드를 살리고 그 고침은 빼고, 답에 그렇게 적는다.',
    '끝나면 한국어 한두 줄로 무엇을 어떻게 합쳤는지만 답한다.',
    '', '참고 — 이 폴더의 고침 전체(받기 전 코드 기준 diff):', '```diff', patch.length > 60_000 ? `${patch.slice(0, 60_000)}\n… (뒤는 잘림)` : patch, '```',
  ].join('\n');
  // ponytail: Windows 에서 npm 으로 깐 claude(.cmd)는 셸 없이 못 띄운다 — 네이티브 설치(claude.exe)만 된다(summary.ts 와 같다)
  const r = spawnSync('claude', ['-p', prompt, '--tools', 'Read,Edit,Write,Glob,Grep', '--permission-mode', 'acceptEdits', '--strict-mcp-config',
    '--no-session-persistence', '--output-format', 'json', '--settings', '{"disableAllHooks":true}'], { cwd, encoding: 'utf8', timeout: 15 * 60_000 });
  if (r.error || r.status !== 0) return { ok: false, note: `Claude 를 띄우지 못했다(${r.error?.message ?? `끝 코드 ${r.status}`})` };
  try {
    const out = JSON.parse(r.stdout) as { result?: string; is_error?: boolean };
    return { ok: !out.is_error, note: (out.result ?? '').trim().slice(0, 600) };
  } catch { return { ok: false, note: 'Claude 답을 읽지 못했다' }; }
};

const stashes = (cwd: string) => git(cwd, ['stash', 'list', '--format=%H']).stdout.split('\n').filter(Boolean);
const dropStash = (cwd: string, sha: string) => {
  const i = stashes(cwd).indexOf(sha);
  if (i >= 0) git(cwd, ['stash', 'drop', '-q', `stash@{${i}}`]);
};

// 겹침 풀기 — 받은 코드로 먼저 되돌려 EDITH 가 뜨는 상태를 지키고, 그 위에서 기준(원래 실패하는 시험)을 잰 뒤 다시 얹어 Claude 가 합친다.
// 합친 뒤 표시가 없고 타입 검사 · 화면 빌드가 되고 새로 실패한 시험이 없을 때만 남긴다 — 아니면 받은 코드로 되돌리고 stash 를 둔다
function settle(cwd: string, sha: string, files: string[], resolve: Resolver, check: Checker): { kept: boolean; note: string } {
  const patch = git(cwd, ['stash', 'show', '-p', sha]).stdout;
  git(cwd, ['reset', '--hard', '-q', 'HEAD']);
  const base = check(cwd);
  if (!base.typecheck) return { kept: false, note: '받은 코드가 이미 타입 검사에 걸려 합친 것을 가릴 수 없다' };
  git(cwd, ['stash', 'apply', '-q', sha]);   // 같은 자리에서 다시 겹친다(표시가 생긴다) — 겹치지 않은 고침은 그대로 얹힌다
  const r = resolve(cwd, files, patch);
  const left = files.filter(f => { try { return hasMarkers(readFileSync(join(cwd, f), 'utf8')); } catch { return false; } });
  const after = r.ok && !left.length ? check(cwd) : null;
  const fresh = after ? after.failing.filter(t => !base.failing.includes(t)) : [];
  if (after && after.typecheck && after.build && !fresh.length) {
    git(cwd, ['reset', '-q']);   // 겹침 표시가 풀린 파일을 보통 「커밋 안 된 고침」 으로(스테이징 · 겹침 상태를 지운다)
    dropStash(cwd, sha);
    return { kept: true, note: r.note };
  }
  git(cwd, ['reset', '--hard', '-q', 'HEAD']);
  const why = !r.ok ? r.note : left.length ? `겹침 표시가 남았다(${left.join(' · ')})` : !after!.typecheck ? '타입 검사가 깨졌다'
    : !after!.build ? '화면 빌드가 깨졌다' : `새로 실패한 시험: ${fresh.slice(0, 3).join(' · ')}`;
  return { kept: false, note: why };
}

// 받기 — fast-forward 만, 고친 것은 autostash. ok 면 화면 빌드 · 다시 켜기로 간다(note 는 사람에게 보일 한 줄)
export function pull(cwd: string, show = true, resolve: Resolver = claudeResolve, check: Checker = checkRepo): { ok: boolean; why?: string; note?: string } {
  const before = stashes(cwd);
  const r = spawnSync('git', ['pull', '--ff-only', '--autostash'], { cwd, stdio: show ? 'inherit' : 'pipe' });
  if (r.status !== 0) return { ok: false, why: '받지 못했다 — 위 git 메시지를 본다(받을 곳에 닿지 않음 · 이 폴더에 받을 것과 갈라진 커밋이 있음 — git log --oneline @{u}..HEAD). 고친 것은 그대로다' };
  const sha = stashes(cwd).find(s => !before.includes(s));
  if (!sha) return { ok: true };
  const files = git(cwd, ['diff', '--name-only', '--diff-filter=U']).stdout.split('\n').filter(Boolean);
  if (show) console.log(`이 폴더의 고침이 받은 코드와 겹쳤다(${files.join(' · ') || '?'}) — Claude 가 합치고 타입 검사 · 시험 · 화면 빌드로 확인한다`);
  const s = settle(cwd, sha, files, resolve, check);
  return s.kept
    ? { ok: true, note: `겹친 고침을 합쳤다(${files.join(' · ')}) — ${s.note || '검사 통과'}` }
    : { ok: true, note: `겹친 고침은 합치지 못해 받은 코드 그대로 두었다(${s.note}). 이 폴더의 고침은 git stash 에 있다 — git stash show -p 로 보고, 다시 얹으려면 git stash pop` };
}
