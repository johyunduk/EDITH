// 다른 기기의 EDITH — SSH 로 그 기기의 127.0.0.1:<포트>(기본 4320)를 이 기기 포트로 끌어와(ssh -L) 새 탭으로 연다.
// 기기는 ~/.config/edith/machines.json 에 이름 → SSH 대상(~/.ssh/config 의 Host 이름이나 user@host):
//   { "회사": "work-mac" }  또는  { "회사": { "ssh": "work-mac", "port": 4320 } }
// SSH 는 비밀번호 없이(키) 들어가져야 한다(BatchMode). 그 기기의 화면 열쇠를 SSH 로 읽어 열쇠 붙은 주소를 만든다 — 그 기기에 EDITH 가 떠 있어야 한다.
// 이 기기 쪽 포트는 목록 순서대로 4321, 4322 … 로 고정(열쇠 쿠키가 포트마다 따로라 기기마다 같은 포트여야 다시 열쇠를 안 받는다).
// `edith connect` 가 키 등록·machines.json 을 대신 한다(connectMachine).
// ponytail: kill -9 로 끄면 ssh 터널이 남는다. 키 등록은 그 기기가 macOS·Linux 일 때만(Windows 는 authorized_keys 자리가 달라 손으로).
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { connect } from 'node:net';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { CONFIG_DIR, HOME } from './config.ts';
import { q, sh } from './sh.ts';

export type Machine = { name: string; ssh: string; port: number; local: number };

// SSH 대상은 글자·숫자·.-_@ 만, - 로 시작하지 않게(ssh 옵션으로 읽히지 않게). 틀린 항목은 빼되 포트 순서는 그대로.
export const SSH_TARGET = /^[\w.@][\w.@-]*$/;
export function parseMachines(text: string): Machine[] {
  let o: unknown;
  try { o = JSON.parse(text); } catch { return []; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return [];
  return Object.entries(o as Record<string, unknown>).flatMap(([name, v], i) => {
    const ssh = typeof v === 'string' ? v : (v as { ssh?: unknown } | null)?.ssh;
    const port = Number((v as { port?: unknown } | null)?.port ?? 4320);
    return typeof ssh === 'string' && SSH_TARGET.test(ssh) && Number.isInteger(port) && port > 0 && port < 65536 ? [{ name, ssh, port, local: 4321 + i }] : [];
  });
}
const FILE = join(CONFIG_DIR, 'machines.json');
export const machines = () => { try { return parseMachines(readFileSync(FILE, 'utf8')); } catch { return []; } };

// machines.json 에 기기 하나를 넣거나 바꾼 글 — 이미 있으면 자리(=이 기기 쪽 포트)와 port 는 그대로 두고 SSH 대상만 바꾼다
export function withMachine(text: string, name: string, ssh: string) {
  let o: Record<string, unknown> = {};
  try { const v = JSON.parse(text); if (v && typeof v === 'object' && !Array.isArray(v)) o = v; } catch { /* 없거나 깨짐 — 새로 */ }
  const old = o[name];
  o[name] = old && typeof old === 'object' ? { ...old, ssh } : ssh;
  return `${JSON.stringify(o, null, 2)}\n`;
}

// EDITH 가 꺼지면 터널도 끈다 — kill(SIGTERM)·터미널 닫힘(SIGHUP)은 기본으로 exit 를 거치지 않아 첫 터널 때 잡아 둔다
const tunnels = new Map<string, ChildProcess>();
const closeAll = () => { for (const t of tunnels.values()) t.kill(); };
let hooked = false;
const hook = () => {
  if (hooked) return;
  hooked = true;
  process.on('exit', closeAll);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(sig, () => process.exit(0));
};
const alive = (p?: ChildProcess) => !!p && p.exitCode === null && p.signalCode === null;
const listening = (port: number) => new Promise<boolean>(ok => {
  const s = connect(port, '127.0.0.1', () => { s.end(); ok(true); });
  s.on('error', () => ok(false));
});
const SSH = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];

// 그 기기의 화면 열쇠 — macOS·Linux 는 cat, Windows(OpenSSH 기본 셸 cmd)는 type. 홈 폴더에서 시작한다.
async function remoteKey(target: string) {
  for (const cmd of [['cat', '.config/edith/console.key'], ['type', '.config\\edith\\console.key']]) {
    const k = (await sh('ssh', [...SSH, target, ...cmd], { timeoutMs: 20_000, ok: true }).catch(() => null))?.stdout.trim() ?? '';
    if (/^[\w-]{16,}$/.test(k)) return k;
  }
  return null;
}

// 터널을 열고(이미 열려 있으면 그대로) 그 기기 EDITH 의 열쇠 붙은 주소를 준다
export async function openMachine(name: string) {
  const m = machines().find(m => m.name === name);
  if (!m) throw new Error('machines.json 에 없는 기기');
  const key = await remoteKey(m.ssh);
  if (!key) throw new Error(`${m.ssh} 에 SSH 로 들어가지 못했거나 그 기기에 EDITH 열쇠가 없다(그 기기에서 edith 를 한 번 띄운다)`);
  if (!alive(tunnels.get(name))) {
    if (await listening(m.local)) throw new Error(`${m.local} 포트를 다른 프로그램이 쓴다`);
    hook();
    const p = spawn('ssh', [...SSH, '-N', '-o', 'ExitOnForwardFailure=yes', '-L', `${m.local}:127.0.0.1:${m.port}`, m.ssh], { stdio: 'ignore' });
    tunnels.set(name, p);
    for (let i = 0; i < 50 && alive(p) && !(await listening(m.local)); i++) await sleep(200);
    if (!alive(p)) throw new Error('SSH 터널을 열지 못했다');
  }
  // 터널 너머에 EDITH 가 떠 있는지 — 열쇠 없이 물으면 401 과 x-edith 머리가 온다
  const r = await fetch(`http://127.0.0.1:${m.local}/api/herdr`).catch(() => null);
  if (r?.headers.get('x-edith') !== '1') throw new Error(`${m.name} 에 EDITH 가 떠 있지 않다(그 기기에서 edith --no-open)`);
  return `http://127.0.0.1:${m.local}/?key=${key}`;
}

// edith connect — 이 기기에서 그 기기로 비밀번호 없이(키) 들어가게 하고 machines.json 에 적는다.
// 키가 없으면 ~/.ssh/id_ed25519 를 만든다(암호 없이 — ssh 가 기본으로 쓰는 키). 등록할 때만 그 기기 비밀번호를 한 번 묻는다.
// 처음 보는 기기의 호스트 키는 받아 둔다(accept-new) — Tailscale·VPN 안의 기기라는 전제.
const batchOk = (target: string) => spawnSync('ssh', [...SSH, '-o', 'StrictHostKeyChecking=accept-new', target, 'exit'], { stdio: 'ignore', timeout: 20_000 }).status === 0;
function ensureKey() {
  const dir = join(HOME, '.ssh'), file = join(dir, 'id_ed25519');
  if (!existsSync(`${file}.pub`)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (spawnSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', `edith@${hostname()}`, '-f', file], { stdio: 'inherit' }).status !== 0) throw new Error('ssh-keygen 으로 키를 만들지 못했다');
  }
  return readFileSync(`${file}.pub`, 'utf8').trim();
}
export async function connectMachine(name: string, target: string, log: (m: string) => void) {
  if (!name.trim()) throw new Error('기기 이름이 비었다');
  if (!SSH_TARGET.test(target)) throw new Error('SSH 대상은 user@host 꼴(글자·숫자·.-_@, - 로 시작하지 않게)');
  if (batchOk(target)) log(`${target} — 이미 키로 들어가진다`);
  else {
    const pub = ensureKey();
    log(`${target} 에 이 기기 키를 등록한다 — 그 기기 비밀번호를 한 번 묻는다(그 기기의 원격 로그인이 켜져 있어야 한다)`);
    const add = `umask 077; mkdir -p .ssh && touch .ssh/authorized_keys && (grep -qxF ${q(pub)} .ssh/authorized_keys || echo ${q(pub)} >> .ssh/authorized_keys)`;
    spawnSync('ssh', ['-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=10', target, add], { stdio: 'inherit' });
    if (!batchOk(target)) throw new Error(`${target} 에 키로 들어가지 못했다 — 주소·사용자 이름, 그 기기의 원격 로그인(SSH)을 확인한다`);
    log('키 등록 끝');
  }
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(FILE, withMachine(existsSync(FILE) ? readFileSync(FILE, 'utf8') : '', name, target));
  log(`machines.json 에 「${name}」 → ${target}`);
  log(await remoteKey(target) ? '그 기기 EDITH 열쇠도 읽힌다 — EDITH 사이드 메뉴 아래에서 열면 된다(그 기기에서 edith 가 떠 있어야)'
    : '그 기기에 EDITH 열쇠가 아직 없다 — 그 기기에서 edith 를 한 번 띄운다');
}

// Tailscale 에 붙은 다른 기기 — `tailscale status --json` 의 Peer. macOS 앱판은 CLI 가 PATH 에 없어 앱 안의 것을 쓴다.
export type Peer = { host: string; dns: string; os: string; online: boolean };
export function parsePeers(json: string): Peer[] {
  try {
    const peers = Object.values((JSON.parse(json) as { Peer?: Record<string, { HostName?: string; DNSName?: string; OS?: string; Online?: boolean }> }).Peer ?? {});
    return peers.filter(p => p.DNSName).map(p => ({ host: p.HostName ?? '', dns: p.DNSName!.replace(/\.$/, ''), os: p.OS ?? '', online: !!p.Online }));
  } catch { return []; }
}
export function tailscalePeers() {
  for (const bin of ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale', 'C:\\Program Files\\Tailscale\\tailscale.exe']) {
    const r = spawnSync(bin, ['status', '--json'], { encoding: 'utf8', timeout: 5000 });
    if (r.status === 0) return parsePeers(r.stdout);
  }
  return null;
}
