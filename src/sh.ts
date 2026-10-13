import { spawn } from 'node:child_process';

export type ShOpt = {
  input?: string | Buffer;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  ok?: boolean;          // 0 이 아닌 종료 코드를 오류로 보지 않는다
  signal?: AbortSignal;
  timeoutMs?: number;
  inherit?: boolean;     // 출력을 그대로 터미널로 (이미지 빌드처럼 오래 걸리는 것)
};
export type ShResult = { code: number; out: Buffer; stdout: string; stderr: string };

// 비동기 실행 — 긴 명령(build·Playwright) 중에도 엔진이 멈춤·답·다른 실행을 받는다.
export function sh(cmd: string, args: string[], opt: ShOpt = {}): Promise<ShResult> {
  return new Promise((resolve, reject) => {
    const io = opt.inherit ? 'inherit' : 'pipe';
    const p = spawn(cmd, args, { cwd: opt.cwd, env: opt.env, signal: opt.signal, timeout: opt.timeoutMs, stdio: ['pipe', io, io] });
    const out: Buffer[] = [], err: Buffer[] = [];
    p.stdout?.on('data', (d: Buffer) => out.push(d));
    p.stderr?.on('data', (d: Buffer) => err.push(d));
    p.on('error', reject);
    p.on('close', (code, sig) => {
      const buf = Buffer.concat(out);
      const r = { code: code ?? -1, out: buf, stdout: buf.toString('utf8'), stderr: Buffer.concat(err).toString('utf8') };
      if (r.code !== 0 && !opt.ok) reject(new Error(`${cmd} ${args.slice(0, 4).join(' ')} … → ${sig ?? r.code}\n${(r.stderr || r.stdout).slice(-1500)}`));
      else resolve(r);
    });
    p.stdin?.on('error', () => {});   // 받는 쪽이 먼저 끝나도 EPIPE 로 죽지 않게
    p.stdin?.end(opt.input);
  });
}

export const q = (s: string | number) => `'${String(s).replace(/'/g, `'\\''`)}'`;
export const firstLine = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0];
