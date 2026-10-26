#!/usr/bin/env node
// EDITH — herdr 의 Claude Code·Codex pane 을 브라우저에서 보고 다루는 화면 서버.
// `edith` 하나로: 도구 확인 → herdr 서버가 꺼져 있으면 화면 없이 띄우기 → 화면 서버 → 브라우저. 이미 떠 있으면 브라우저만 연다.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { userInfo } from 'node:os';
import { delimiter, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { REPO } from './config.ts';

const USAGE = `사용: edith [serve] [--port N] [--no-open]   herdr 확인·시작 → 화면 서버(127.0.0.1, 기본 4320) → 브라우저
      edith --no-herdr                         herdr 를 확인·시작하지 않고 화면만 — 다른 기기의 EDITH 를 열 때(이 기기 herdr 없이)
      edith update [--port N]                  받기(git pull)·화면 빌드 → 떠 있는 EDITH 를 새 코드로 다시 켜기
      edith setup                              설치 스크립트 다시 — 빠진 도구 설치, herdr 통합·스킬, 화면 빌드
      edith connect [이름 user@host]           다른 기기 잇기 — SSH 키 등록·machines.json(인자 없으면 Tailscale 기기에서 고른다)
      edith request <id>                       요청(~/.local/share/edith/requests/<id>.json)의 진행 — 읽기만, JSON 으로
      edith deploy import <파일.json>          배포 목록을 {"items": [...]} 로 통째로 바꾼다(~/.local/share/edith/deploy.json — 형식은 src/deploy.ts 머리)
      edith deploy add <레포 경로> <브랜치> [--tag 이름] [--ticket 티켓] [--agenda 안건 키] [--note 줄]…   배포 목록에 등록(레포는 워크트리 경로여도 된다, 같은 안건 키는 한 카드)
      edith deploy set <레포 경로> <브랜치> [--tag] [--ticket] [--agenda]   이름 · 티켓 · 안건 키 바꾸기
      edith deploy note|task <레포 경로> <브랜치> <글> [--env 환경]      메모 한 줄 · 배포 조치 한 줄 더하기(env 없으면 첫 환경 뺀 전부)
      edith deploy range|block <레포 경로> <브랜치> [블록.json]          배포 조치를 뽑을 범위(JSON) · 뽑은 배포 조치로 바꾸기
      edith deploy check <레포 경로> <브랜치> <환경> <할 일> [--undo]     할 일 체크
      edith deploy done|drop <레포 경로> <브랜치> [--date YYYY-MM-DD]    보관(배포 끝) · 지우기(안 하기로 함)
      edith deploy show [<레포 경로> [<브랜치>]]                         보관 안 한 항목(JSON)`;

const win = process.platform === 'win32';
const fail = (m: string): never => { console.error(m); process.exit(1); };

// PATH 에 있는지 — Windows 는 .exe·.cmd 처럼 확장자(PATHEXT)를 붙여 본다(npm 으로 깐 codex 는 .cmd)
const onPath = (cmd: string) => (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  .some(d => (win ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : ['']).some(x => existsSync(join(d, cmd + x))));

// herdr 서버 — 꺼져 있으면 화면 없이(`herdr server`) 띄운다. EDITH 를 꺼도 herdr 와 그 안의 pane 은 계속 돈다.
// 터미널 herdr 는 원할 때 `herdr` 로 같은 서버에 붙는다.
const herdrUp = () => /^status:\s*running/m.test(spawnSync('herdr', ['status', 'server'], { encoding: 'utf8', timeout: 5000 }).stdout ?? '');
async function ensureHerdr() {
  if (herdrUp()) return;
  console.log('herdr 서버가 꺼져 있어 띄운다(화면 없이 — 터미널에서는 herdr 로 붙는다)');
  spawn('herdr', ['server'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 200)); if (herdrUp()) return; }
  fail('herdr 서버가 10초 안에 뜨지 않았다 — 터미널에서 herdr 를 직접 띄워 본다');
}

// 브라우저 — 못 열어도 주소는 찍혀 있다. Windows 는 explorer 가 주소를 기본 브라우저로 넘긴다.
function openBrowser(url: string) {
  const cmd = win ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(cmd, [url], { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => undefined).unref();
}

// 그 포트에 떠 있는 게 EDITH 인지 — 응답마다 x-edith 머리를 단다(server.ts)
const isEdith = (port: number) => fetch(`http://127.0.0.1:${port}/`).then(r => r.headers.get('x-edith') === '1', () => false);

async function serve(args: string[]) {
  const i = args.indexOf('--port'), port = i >= 0 ? Number(args[i + 1]) : 4320, open = !args.includes('--no-open'), herdr = !args.includes('--no-herdr');
  if (!Number.isInteger(port) || port <= 0 || port > 65535) fail('--port 는 1~65535');
  if (!existsSync(join(REPO, 'web', 'dist', 'index.html'))) fail(`화면이 아직 빌드되지 않았다 — edith setup(클론한 직후면 ${join(REPO, win ? 'install.ps1' : 'install.sh')})`);
  // --no-herdr: 이 기기 herdr 는 건드리지 않는다 — 화면은 「다른 기기」 로 다른 기기의 EDITH 를 여는 데 쓴다(herdr 가 뜨면 그대로 보인다)
  if (herdr) {
    if (!onPath('herdr')) fail('herdr 가 없다 — edith setup 으로 설치한다(다른 기기만 열려면 edith --no-herdr)');
    for (const a of ['claude', 'codex']) if (!onPath(a)) console.log(`${a} 가 없다 — 쓰려면 edith setup`);
    await ensureHerdr();
  }
  const server = await import('./server.ts');
  const url = await server.serve(port).catch(async (e: NodeJS.ErrnoException) => {
    if (e.code !== 'EADDRINUSE') throw e;
    if (!(await isEdith(port))) fail(`${port} 포트를 다른 프로그램이 쓴다 — edith --port <다른 번호>`);
    const url = `http://127.0.0.1:${port}/?key=${server.consoleKey()}`;
    console.log(`EDITH 가 이미 떠 있다 — ${open ? '브라우저만 연다' : url}`);
    if (open) openBrowser(url);
    process.exit(0);
  });
  console.log(`EDITH: ${url}\n  ${open ? '브라우저를 열었다 — 안 열리면 이 주소로. ' : ''}한 번 열면 열쇠가 브라우저에 30일 남는다. 끄기: Ctrl+C(herdr 는 계속 돈다)`);
  if (open) openBrowser(url);
}

// 설치 스크립트 다시 — EDITH 가 든 체크아웃의 것을 돌린다(그 폴더에서 빌드·npm link 까지)
function setup() {
  const [cmd, args] = win
    ? ['powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(REPO, 'install.ps1')]]
    : ['bash', [join(REPO, 'install.sh')]];
  process.exit(spawnSync(cmd, args, { stdio: 'inherit' }).status ?? 1);
}

// 업데이트 — 받기(git pull) → 화면 빌드 → 떠 있는 EDITH 를 새 코드로 다시 켠다(/api/restart).
// 설치 단계(도구·herdr 통합·플러그인)가 바뀌었으면 edith setup. npm 은 Windows 에서 npm.cmd 라 셸로 띄운다(인자는 고정 글자뿐).
async function update(args: string[]) {
  const i = args.indexOf('--port'), port = i >= 0 ? Number(args[i + 1]) : 4320;
  const run = (cmd: string, a: string[], why: string) => {
    console.log(`$ ${cmd} ${a.join(' ')}`);
    if (spawnSync(cmd, a, { cwd: REPO, stdio: 'inherit', shell: win }).status !== 0) fail(why);
  };
  if (existsSync(join(REPO, '.git'))) run('git', ['pull', '--ff-only'], '받지 못했다 — 이 폴더에서 고친 것이 있으면 커밋한 뒤 git pull 로 합친다');
  run('npm', ['run', 'build'], '화면 빌드가 실패했다');
  if (!(await isEdith(port))) return console.log('끝 — edith 로 켠다');
  const { consoleKey } = await import('./server.ts'), origin = `http://127.0.0.1:${port}`;
  const r = await fetch(`${origin}/api/restart`, { method: 'POST', headers: { origin, 'content-type': 'application/json', cookie: `edith-${port}=${consoleKey()}` }, body: '{}' }).catch(() => null);
  console.log(r?.ok ? `끝 — ${port} 의 EDITH 를 새 코드로 다시 켰다(그 터미널에서 그대로 돈다)`
    : `끝 — 떠 있는 EDITH 를 다시 켜지 못했다(${r ? await r.text() : '닿지 않음'}) — 그 터미널에서 Ctrl+C 뒤 edith`);
}

// 다른 기기 잇기 — 인자가 없으면 Tailscale 에 붙은 기기를 보여 주고 번호·그 기기 사용자 이름을 묻는다
async function connect(args: string[]) {
  const { connectMachine, tailscalePeers } = await import('./machines.ts');
  let [name, target] = args;
  if (!target) {
    const peers = tailscalePeers() ?? [];
    if (!peers.length) fail(`Tailscale 에 붙은 다른 기기가 없다(또는 Tailscale 이 없다) — edith connect <이름> <user@host>`);
    peers.forEach((p, i) => console.log(`  ${i + 1}. ${p.host}  ${p.dns}  ${p.os}${p.online ? '' : '  (꺼짐)'}`));
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const peer = peers[Number(await rl.question('어느 기기? 번호: ')) - 1] ?? fail('번호가 맞지 않다');
    const user = (await rl.question(`그 기기의 사용자 이름 [${userInfo().username}]: `)).trim() || userInfo().username;
    name = (await rl.question(`EDITH 에 보일 이름 [${peer.host}]: `)).trim() || peer.host;
    rl.close();
    target = `${user}@${peer.dns}`;
  }
  await connectMachine(name, target, m => console.log(m)).catch((e: Error) => fail(e.message));
}

const argv = process.argv.slice(2);
switch (argv[0] ?? 'serve') {
  case 'setup': setup(); break;
  case 'update': await update(argv.slice(1)); break;
  case 'connect': await connect(argv.slice(1)); break;
  case 'request': {
    const { requestStatus } = await import('./requests.ts'), st = argv[1] ? requestStatus(argv[1]) : null;
    if (!st) fail(`없는 요청: ${argv[1] ?? '(id 없음)'}`);
    console.log(JSON.stringify(st, null, 2));
    break;
  }
  case 'deploy': {
    const D = await import('./deploy.ts'), { readFileSync } = await import('node:fs'), { resolve } = await import('node:path');
    // 「--이름 값」 옵션(--note 는 여러 번)과 나머지 인자. --undo 는 값 없이
    const [sub, ...rest] = argv.slice(1), pos: string[] = [], opt: Record<string, string[]> = {};
    for (let i = 0; i < rest.length; i++) {
      const k = rest[i].startsWith('--') ? rest[i].slice(2) : null;
      if (!k) pos.push(rest[i]); else (opt[k] ??= []).push(k === 'undo' ? '1' : rest[++i] ?? '');
    }
    const [path, branch] = [pos[0] ? resolve(pos[0]) : '', pos[1] ?? ''], need = (n: number, how: string) => { if (pos.length < n) fail(`사용: edith deploy ${sub} ${how}`); };
    const say = (p: Promise<unknown>) => p.then(r => console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 2)), (e: Error) => fail(e.message));
    switch (sub) {
      case 'import': {
        need(1, '<파일.json>');
        const r = await D.importItems(readFileSync(pos[0], 'utf8')).catch((e: Error) => fail(e.message));
        console.log(`배포 목록 ${r.items}개(보관 안 한 것 ${r.active})를 ${D.DEPLOY_FILE} 에 넣었다${r.skipped ? ` — 레포 · 브랜치가 틀린 ${r.skipped}개는 뺐다` : ''}`);
        break;
      }
      case 'add': need(2, '<레포 경로> <브랜치> [--tag <이름>] [--ticket <티켓>] [--agenda <안건 키>] [--note <메모 줄>]…'); await say(D.cliAdd(path, branch, { tag: opt.tag?.[0], notes: opt.note, ticket: opt.ticket?.[0], agenda: opt.agenda?.[0] })); break;
      case 'set': need(2, '<레포 경로> <브랜치> [--tag <이름>] [--ticket <티켓>] [--agenda <안건 키>](빈 글이면 지움)'); await say(D.cliSet(path, branch, { tag: opt.tag?.[0], ticket: opt.ticket?.[0], agenda: opt.agenda?.[0] })); break;
      case 'note': need(3, '<레포 경로> <브랜치> <메모 줄>'); await say(D.cliNote(path, branch, pos[2])); break;
      case 'task': need(3, '<레포 경로> <브랜치> <할 일> [--env <환경>]'); await say(D.cliTask(path, branch, pos[2], opt.env?.[0])); break;
      case 'range': need(2, '<레포 경로> <브랜치>'); await say(D.cliRange(path, branch)); break;
      case 'block': need(3, '<레포 경로> <브랜치> <블록.json>'); await say(D.cliBlock(path, branch, readFileSync(pos[2], 'utf8'))); break;
      case 'check': need(4, '<레포 경로> <브랜치> <환경> <할 일> [--undo]'); await say(D.cliCheck(path, branch, pos[2], pos[3], !opt.undo)); break;
      case 'done': need(2, '<레포 경로> <브랜치> [--date YYYY-MM-DD]'); await say(D.cliDone(path, branch, opt.date?.[0])); break;
      case 'drop': need(2, '<레포 경로> <브랜치>'); await say(D.cliDrop(path, branch)); break;
      case 'show': await say(D.cliShow(path || undefined, branch || undefined)); break;
      default: fail('사용: edith deploy import|add|set|note|task|range|block|check|done|drop|show — edith help');
    }
    break;
  }
  case 'serve': await serve(argv.slice(1)); break;
  case '-h': case '--help': case 'help': console.log(USAGE); break;
  default: if (argv[0].startsWith('--')) await serve(argv); else { console.log(USAGE); process.exit(2); }
}
