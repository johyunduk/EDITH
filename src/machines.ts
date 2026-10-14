// 다른 기기의 EDITH — SSH 로 그 기기의 127.0.0.1:<포트>(기본 4320)를 이 기기 포트로 끌어와(ssh -L) 새 탭으로 연다.
// 기기는 ~/.config/edith/machines.json 에 이름 → SSH 대상(~/.ssh/config 의 Host 이름이나 user@host):
//   { "회사": "work-mac" }  또는  { "회사": { "ssh": "work-mac", "port": 4320 } }
// SSH 는 비밀번호 없이(키) 들어가져야 한다(BatchMode). 그 기기의 화면 열쇠를 SSH 로 읽어 열쇠 붙은 주소를 만든다 — 그 기기에 EDITH 가 떠 있어야 한다.
// 이 기기 쪽 포트는 목록 순서대로 4321, 4322 … 로 고정(열쇠 쿠키가 포트마다 따로라 기기마다 같은 포트여야 다시 열쇠를 안 받는다).
// ponytail: 그 기기가 Windows 면 열쇠 경로·cat 이 달라 못 연다(macOS·Linux 만). kill -9 로 끄면 ssh 터널이 남는다.
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { CONFIG_DIR } from './config.ts';
import { sh } from './sh.ts';

export type Machine = { name: string; ssh: string; port: number; local: number };

// SSH 대상은 글자·숫자·.-_@ 만, - 로 시작하지 않게(ssh 옵션으로 읽히지 않게). 틀린 항목은 빼되 포트 순서는 그대로.
export function parseMachines(text: string): Machine[] {
  let o: unknown;
  try { o = JSON.parse(text); } catch { return []; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return [];
  return Object.entries(o as Record<string, unknown>).flatMap(([name, v], i) => {
    const ssh = typeof v === 'string' ? v : (v as { ssh?: unknown } | null)?.ssh;
    const port = Number((v as { port?: unknown } | null)?.port ?? 4320);
    return typeof ssh === 'string' && /^[\w.@][\w.@-]*$/.test(ssh) && Number.isInteger(port) && port > 0 && port < 65536 ? [{ name, ssh, port, local: 4321 + i }] : [];
  });
}
export const machines = () => { try { return parseMachines(readFileSync(join(CONFIG_DIR, 'machines.json'), 'utf8')); } catch { return []; } };

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

// 터널을 열고(이미 열려 있으면 그대로) 그 기기 EDITH 의 열쇠 붙은 주소를 준다
export async function openMachine(name: string) {
  const m = machines().find(m => m.name === name);
  if (!m) throw new Error('machines.json 에 없는 기기');
  const key = (await sh('ssh', [...SSH, m.ssh, 'cat', '.config/edith/console.key'], { timeoutMs: 20_000, ok: true })).stdout.trim();
  if (!/^[\w-]{16,}$/.test(key)) throw new Error(`${m.ssh} 에 SSH 로 들어가지 못했거나 그 기기에 EDITH 열쇠가 없다(그 기기에서 edith 를 한 번 띄운다)`);
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
