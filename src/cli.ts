#!/usr/bin/env node
// EDITH — herdr 의 Claude Code·Codex pane 을 브라우저에서 보고 다루는 화면 서버.
// `edith` 하나로: 도구 확인 → herdr 서버가 꺼져 있으면 화면 없이 띄우기 → 화면 서버 → 브라우저. 이미 떠 있으면 브라우저만 연다.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { REPO } from './config.ts';

const USAGE = `사용: edith [serve] [--port N] [--no-open]   herdr 확인·시작 → 화면 서버(127.0.0.1, 기본 4320) → 브라우저
      edith setup                              설치 스크립트 다시 — 빠진 도구 설치, herdr 통합·스킬, 화면 빌드`;

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
  const i = args.indexOf('--port'), port = i >= 0 ? Number(args[i + 1]) : 4320, open = !args.includes('--no-open');
  if (!Number.isInteger(port) || port <= 0 || port > 65535) fail('--port 는 1~65535');
  if (!existsSync(join(REPO, 'web', 'dist', 'index.html'))) fail(`화면이 아직 빌드되지 않았다 — edith setup(클론한 직후면 ${join(REPO, win ? 'install.ps1' : 'install.sh')})`);
  if (!onPath('herdr')) fail('herdr 가 없다 — edith setup 으로 설치한다');
  for (const a of ['claude', 'codex']) if (!onPath(a)) console.log(`${a} 가 없다 — 쓰려면 edith setup`);
  await ensureHerdr();
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

const argv = process.argv.slice(2);
switch (argv[0] ?? 'serve') {
  case 'setup': setup(); break;
  case 'serve': await serve(argv.slice(1)); break;
  case '-h': case '--help': case 'help': console.log(USAGE); break;
  default: if (argv[0].startsWith('--')) await serve(argv); else { console.log(USAGE); process.exit(2); }
}
