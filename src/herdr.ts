// herdr — 워크스페이스·탭·pane·에이전트 상태, pane 터미널 흐름(보기·입력), 프롬프트·키 보내기. 화면 서버가 쓴다.
// 자주 부르는 읽기는 herdr CLI 로 한다 — Node 가 소켓에 바로 붙으면 herdr 서버가 요청마다 100ms 를 기다린다(0.8.0·0.9.4 실측)
// (요청이 접속 순간에 와 있지 않으면). 프롬프트·키처럼 가끔 쓰는 쓰기는 소켓으로 — 글이 CLI 옵션으로 읽힐 걱정이 없다.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { sh } from './sh.ts';
import { toCodex } from './complete.ts';
import { parseMenu, stillPicked } from '../web/src/screenMenu.ts';

// herdr 소켓 — macOS·Linux 는 도메인 소켓, Windows 는 named pipe. herdr pane 안에서 띄우면 HERDR_SOCKET_PATH 가 있고,
// 없으면 `herdr status server` 가 알려 주는 경로(socket: …). 둘 다 못 얻으면 Unix 기본 경로 — 그때는 기억하지 않고 다음에 다시 묻는다.
let socketPath = process.env.HERDR_SOCKET_PATH;
function socket() {
  if (socketPath) return pipeName(socketPath);
  const out = spawnSync('herdr', ['status', 'server'], { encoding: 'utf8', timeout: 5000 }).stdout ?? '';
  return pipeName((socketPath = out.match(/^socket:\s*(.+)$/m)?.[1].trim()) ?? join(homedir(), '.config', 'herdr', 'herdr.sock'));
}
// Windows herdr 는 그 경로 앞에 \\.\pipe\ 를 붙인 이름으로 듣는다 — 경로의 파일은 표시일 뿐이라 그대로 열면 ENOTSOCK(herdr 0.9.5 src/ipc.rs)
export const pipeName = (p: string, win = process.platform === 'win32') => win && !/^\\\\[.?]\\pipe\\/i.test(p) ? `\\\\.\\pipe\\${p}` : p;

// 소켓 요청 하나 — 연결 하나에 요청 하나(herdr 가 답하고 닫는다).
function api(method: string, params: Record<string, unknown>) {
  return new Promise<unknown>((ok, no) => {
    const s = connect(socket());
    let buf = '';
    s.on('connect', () => s.write(`${JSON.stringify({ id: 'edith', method, params })}\n`));
    s.on('data', d => {
      buf += d;
      if (!buf.includes('\n')) return;
      s.end();
      const m = JSON.parse(buf.slice(0, buf.indexOf('\n'))) as { result?: unknown; error?: { code: string; message: string } };
      if (m.error) no(new Error(`${m.error.code}: ${m.error.message}`)); else ok(m.result);
    });
    s.on('error', no);
  });
}

type RawPane = {
  pane_id: string; tab_id: string; workspace_id: string; agent?: string | null; name?: string; agent_status?: string;
  agent_session?: { agent: string; kind: string; value: string };
  terminal_title_stripped?: string; cwd?: string; foreground_cwd?: string; focused: boolean; scroll?: { viewport_rows: number };
};
type Rect = { x: number; y: number; width: number; height: number };
type Raw = {
  focused_pane_id: string; workspaces: unknown[]; tabs: unknown[]; panes: RawPane[];
  layouts: { tab_id: string; zoomed: boolean; area: Rect; panes: { pane_id: string; rect: Rect }[]; splits: { id: string; direction: string; ratio: number; rect: Rect }[] }[];
};

const frac = (r: Rect, a: Rect) => ({ x: (r.x - a.x) / a.width, y: (r.y - a.y) / a.height, w: r.width / a.width, h: r.height / a.height });

// pane 에 에이전트가 새로 뜬 시각 — 콘솔이 켜진 뒤 생긴 pane, 또는 셸 → 에이전트로 바뀐 pane 만.
// 대화 기록을 고를 때 그보다 먼저 만든 파일(다른 세션)을 이 pane 의 것으로 잡지 않게 한다(chat.ts claudeFile).
const seen = new Map<string, string | null>(), born = new Map<string, number>();
let started = false;
export const agentSince = (id: string) => born.get(id);
export function noteAgents(panes: { id: string; agent: string | null }[]) {
  for (const p of panes) {
    const was = seen.get(p.id);
    if (p.agent && p.agent !== was && (was !== undefined || started)) born.set(p.id, Date.now());
    seen.set(p.id, p.agent);
  }
  started = true;
}

// pane 의 에이전트 세션 — herdr 통합 훅이 알려 준 것(0.9.2+). Claude 는 `herdr integration install claude` 뒤 새로 시작한
// 세션부터 알려 준다(시작·/resume·/clear·compact 때). 대화 기록 파일을 제목으로 추측하지 않고 바로 찾는 데 쓴다(chat.ts).
const sessions = new Map<string, { agent: string; kind: string; value: string }>();
export const sessionOf = (id: string) => sessions.get(id);

export async function snapshot() {
  const s = JSON.parse((await sh('herdr', ['api', 'snapshot'])).stdout).result.snapshot as Raw;
  const width = new Map(s.layouts.flatMap(l => l.panes.map(p => [p.pane_id, p.rect.width] as const)));
  const snap = {
    focused: s.focused_pane_id, workspaces: s.workspaces, tabs: s.tabs,
    // 탭 배치 — pane 칸을 탭 영역 대비 비율(0~1)로. herdr 화면의 사이드바 폭 같은 바깥 여백은 뺀다.
    layouts: s.layouts.map(l => ({
      tab: l.tab_id, zoomed: l.zoomed,
      panes: l.panes.map(p => ({ id: p.pane_id, ...frac(p.rect, l.area) })),
      // 나눔 경계 — id 는 split_<깊이>_<root|0·1 경로>. 경로는 비율 조정(layout.set_split_ratio)의 path 다(1 = 둘째 쪽).
      splits: l.splits.map(x => {
        const bits = x.id.split('_')[2];
        return { path: bits === 'root' ? [] : [...bits].map(c => c === '1'), dir: x.direction, ratio: x.ratio, ...frac(x.rect, l.area) };
      }),
    })),
    panes: s.panes.map(p => ({
      id: p.pane_id, tab: p.tab_id, workspace: p.workspace_id, agent: p.agent ?? null, name: p.name ?? null, status: p.agent_status ?? null,
      // 창 제목 — Claude 가 앞에 붙이는 상태 기호(✳ ◐ …)는 뺀다
      title: (p.terminal_title_stripped ?? '').replace(/^[^\p{L}\p{N}]+\s+/u, ''), cwd: p.foreground_cwd ?? p.cwd ?? '', focused: p.focused,
      // 터미널 크기 — 배치 칸에서 테두리·스크롤 막대 3칸을 뺀 것이 셸의 tput cols 와 같았다(0.8.0 실측). 줄 수는 viewport_rows.
      cols: width.has(p.pane_id) ? width.get(p.pane_id)! - 3 : 120, rows: p.scroll?.viewport_rows ?? 40,
    })),
  };
  noteAgents(snap.panes);
  for (const p of s.panes) if (p.agent_session) sessions.set(p.pane_id, p.agent_session); else sessions.delete(p.pane_id);
  return snap;
}

// 바뀌었는지 볼 때 쓰는 값 — 출력마다 바뀌는 revision·제목(스피너)은 뺀다. 세션이 바뀌면(/clear·/resume) 대화를 다시 읽게 넣는다.
export const signature = (s: Awaited<ReturnType<typeof snapshot>>) =>
  JSON.stringify([s.workspaces, s.tabs, s.panes.map(p => [p.id, p.agent, p.name, p.status, p.cwd, sessions.get(p.id)?.value]), s.layouts]);

// herdr 이벤트 구독 — 바뀔 때만 changed 를 부른다(폴링 대신). 연결 하나를 열어 두므로 요청마다 100ms 지연과는 상관없다.
// 구독은 지난 이벤트를 다시 주지 않는다(0.9.0) — 구독이 시작되면(첫 줄) 한 번 부르니 그때 스냅샷을 새로 뜬다.
// 밀려서 events_lost 가 와도, 연결이 끊겨도(herdr 재시작) 같은 길이다. 줄 내용은 보지 않는다 — 무엇이든 오면 다시 본다.
// 에이전트 상태 변화는 pane 마다 구독해야 해서, 돌려준 함수에 지금 에이전트 pane 목록을 넘기면 달라졌을 때 다시 구독한다.
const WATCH = ['workspace.created', 'workspace.updated', 'workspace.renamed', 'workspace.moved', 'workspace.reordered', 'workspace.closed',
  'worktree.created', 'worktree.removed', 'tab.created', 'tab.closed', 'tab.renamed', 'tab.moved',
  'pane.created', 'pane.closed', 'pane.updated', 'pane.moved', 'pane.exited', 'pane.agent_detected', 'layout.updated'];
export function watch(changed: () => void) {
  let sock: ReturnType<typeof connect> | undefined, panes: string[] = [];
  const open = () => {
    const s = sock = connect(socket());
    s.write(`${JSON.stringify({ id: 'edith-watch', method: 'events.subscribe', params: { subscriptions: [
      ...WATCH.map(type => ({ type })), ...panes.map(pane_id => ({ type: 'pane.agent_status_changed', pane_id }))] } })}\n`);
    // herdr 가 꺼져 있으면 소켓 오류를 readline 도 다시 낸다 — 둘 다 받아야 서버가 죽지 않고 1초 뒤 다시 붙는다
    createInterface({ input: s }).on('line', changed).on('error', () => undefined);
    s.on('error', () => undefined);
    s.on('close', () => { if (sock === s) setTimeout(open, 1000); });
  };
  open();
  return (ids: string[]) => {
    if (ids.join() === panes.join()) return;
    panes = ids;
    const old = sock;
    open();
    old?.destroy();
  };
}

// pane 터미널 흐름 — herdr terminal session 의 프레임(base64 ANSI)을 SSE 로 넘긴다. 첫 프레임은 화면 전체(full), 그 뒤는 바뀐 부분.
// 보기(observe)는 여럿이 같이 붙어도 된다. 입력(control)은 pane 하나에 하나만 — 이미 있으면 herdr 가 closed 로 거절하고,
// takeover 면 가져온다. 입력 중에도 herdr 화면·CLI 의 입력은 그대로 들어간다(실측).
const controllers = new Map<string, ChildProcess>();

export async function streamPane(req: IncomingMessage, res: ServerResponse, id: string, mode: { control: boolean; takeover: boolean }) {
  const p = (await snapshot()).panes.find(p => p.id === id);
  if (!p) { res.writeHead(404).end('pane 없음'); return; }
  const size = ['--cols', String(p.cols), '--rows', String(p.rows)];
  const c = mode.control
    ? spawn('herdr', ['terminal', 'session', 'control', id, ...(mode.takeover ? ['--takeover'] : []), ...size], { stdio: ['pipe', 'pipe', 'ignore'] })
    : spawn('herdr', ['terminal', 'session', 'observe', id, ...size], { stdio: ['ignore', 'pipe', 'ignore'] });
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  createInterface({ input: c.stdout }).on('line', l => {
    let o: { type?: string; full?: boolean; width?: number; height?: number; bytes?: string; reason?: string };
    try { o = JSON.parse(l); } catch { return; }
    if (o.type === 'terminal.frame') {
      if (mode.control && controllers.get(id) !== c) controllers.set(id, c);   // 첫 프레임이 왔으면 붙은 것 — 그때부터 입력을 받는다
      res.write(`data: ${JSON.stringify({ full: o.full, w: o.width, h: o.height, b: o.bytes })}\n\n`);
    }
    else if (o.type === 'terminal.closed') res.write(`event: closed\ndata: ${o.reason ?? ''}\n\n`);
  });
  c.on('exit', () => { if (controllers.get(id) === c) controllers.delete(id); res.end(); });
  req.on('close', () => c.kill());
}

// 입력 중인 pane 에 키(xterm 이 만든 그대로)·스크롤을 넘긴다. 입력 흐름이 없으면 false.
export function control(id: string, cmd: { text?: unknown; scroll?: unknown }) {
  const c = controllers.get(id);
  if (!c?.stdin?.writable) return false;
  if (typeof cmd.text === 'string' && cmd.text.length <= 65536) c.stdin.write(`${JSON.stringify({ type: 'terminal.input', text: cmd.text })}\n`);
  else if (cmd.scroll === 'up' || cmd.scroll === 'down') c.stdin.write(`${JSON.stringify({ type: 'terminal.scroll', direction: cmd.scroll, lines: 3 })}\n`);
  else throw new Error('입력 형식이 아니다');
  return true;
}

// 프롬프트 — 에이전트 pane 은 agent.prompt(붙여넣기 모드를 맞추고 엔터까지), 셸은 글 + 엔터.
export async function prompt(id: string, text: string) {
  const p = (await snapshot()).panes.find(p => p.id === id);
  if (!p) throw new Error('pane 없음');
  if (!p.agent) return void await api('pane.send_input', { pane_id: id, text, keys: ['enter'] });
  // Codex 는 스킬을 $이름으로 부르는 등 기호가 달라 Claude 방식으로 쓴 글을 바꿔 보낸다
  return promptAgent(id, p.agent === 'codex' ? toCodex(text) : text);
}
// 에이전트에게만 보낸다 — 셸로 새는 길이 없다(실행기가 쓴다: 에이전트가 꺼져 셸만 남았으면 herdr 가 거절한다)
export async function promptAgent(id: string, text: string) {
  const params = { target: id, text };
  // 에이전트가 막 뜨는 중이면 herdr 가 agent_not_ready 로 거절한다 — 준비 확인(ready) 뒤 20초까지 1초마다 다시
  for (const t0 = Date.now(); ;) {
    try { return void await api('agent.prompt', params); }
    catch (e) {
      // 질문·승인 화면에서 막힌 것(blocked)은 기다려도 안 풀린다 — 바로 돌려준다
      if (!String(e).includes('agent_not_ready') || /blocked/.test(String(e)) || Date.now() - t0 > 20_000) throw e;
      await ready(id).catch(() => undefined);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

// 소켓의 agent.start 는 띄우기만 하고 바로 돌아온다. 누군가 agent.get 으로 확인해야 이름이 붙고 프롬프트를 받는다
// (CLI 의 agent start 는 이 확인까지 한다 — herdr 0.8.0 실측). 준비됐으면 true.
async function ready(id: string) {
  const r = await api('agent.get', { target: id }) as { agent?: { interactive_ready?: boolean } };
  return !!r.agent?.interactive_ready;
}

// 지금 화면의 아래쪽 — 기록에 아직 없는 화면. 작업 중이면 진행 부분(쓰는 중인 글·도구 진행·스피너), 쉬는 중이면 메뉴 같은 것.
// 입력칸: Claude 는 가로선 바로 아래 ❯ 줄, Codex 는 › 줄 + 아래 3줄 안의 상태줄(… used · for shortcuts).
// 입력칸이 있으면 그 바로 위까지 18줄, 없으면(메뉴가 입력칸 자리를 차지했다) 보이는 화면 전체 — 긴 승인(파일 쓰기)·질문(커밋 지킴이)은
// 화면을 거의 다 채운다. 메뉴의 질문은 screenMenu 가 가로줄·점선으로 자른다. 아래쪽 빈 줄은 먼저 뗀다. input 은 입력칸이 보였는지.
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
// Claude 입력칸 줄(가로선 바로 아래 ❯) — 없으면 -1
const claudeBox = (plain: string[]) => plain.findLastIndex((l, i) => /^\s*❯/.test(l) && i > 0 && /^─{3,}/.test(plain[i - 1].trim()));
export async function live(id: string) {
  const lines = (await sh('herdr', ['pane', 'read', id, '--source', 'visible', '--format', 'ansi'])).stdout.replace(/\r/g, '').split('\n');
  const plain = lines.map(l => l.replace(ANSI, ''));
  const claude = claudeBox(plain);
  const codex = plain.findLastIndex((l, i) => /^\s*›(\s|$)/.test(l) && plain.slice(i + 1, i + 4).some(x => /% used|for shortcuts/.test(x)));
  const box = claude >= 0 ? claude - 1 : codex;
  return { lines: lines.slice(...liveWindow(plain, box)), input: box >= 0 };
}
export function liveWindow(plain: string[], box: number): [number, number] {
  let b = box >= 0 ? box : plain.length;
  while (b > 0 && !plain[b - 1].trim()) b--;
  let a = box >= 0 ? Math.max(0, b - 18) : 0;
  while (a < b && !plain[a].trim()) a++;
  return [a, b];
}

// 사용량 — 모델·생각 강도(effort), 컨텍스트가 몇 % 찼는지, 5시간·7일 한도를 몇 % 썼는지(reset 은 다시 차기까지 남은 시간 글).
export type Limit = { pct: number; reset: string | null };
export type Usage = { model: string | null; effort: string | null; ctx: number | null; five: Limit | null; week: Limit | null };

// Claude 는 상태줄(~/.claude/statusline-command.sh 가 그리는 「✦ Opus 5.5 [xhigh] · CONTEXT 45% · DAILY 30% | 2h10m · WEEKLY 12% | 3d4h」)을 화면에서 읽는다.
// 상태줄은 입력칸 아래에만 있어서 입력칸 아래 줄만 본다. 입력칸이 안 보이면(메뉴 중) null. 상태줄 모양을 바꾸면 이 정규식도 같이 바꾼다.
export async function statusline(id: string): Promise<Usage | null> {
  const plain = (await sh('herdr', ['pane', 'read', id, '--source', 'visible'])).stdout.replace(/\r/g, '').split('\n');
  const box = claudeBox(plain);
  if (box < 0) return null;
  const tail = plain.slice(box + 1).join(' ');
  const at = (k: string) => tail.match(new RegExp(`${k}\\s+(\\d+)%(?:\\s*\\|\\s*(\\S+))?`));
  const lim = (m: RegExpMatchArray | null): Limit | null => m ? { pct: Number(m[1]), reset: m[2] ?? null } : null;
  const c = at('CONTEXT'), m = tail.match(/✦\s+(.+?)(?:\s+\[([^\]]+)\])?(?=\s+·|\s*$)/);
  const u: Usage = { model: m?.[1] ?? null, effort: m?.[2] ?? null, ctx: c ? Number(c[1]) : null, five: lim(at('DAILY')), week: lim(at('WEEKLY')) };
  if (!u.model && u.ctx === null && !u.five && !u.week) return null;
  // 한도는 계정 전체 — 어느 pane 상태줄에서든 읽으면 다시 찰 시각으로 기억해 두고, 한도가 안 보이는 상태줄(막 띄운 세션 등)에 채운다
  for (const k of ['five', 'week'] as const) {
    const seen = u[k];
    if (seen) limits[k] = { pct: seen.pct, at: seen.reset ? Date.now() + resetSecs(seen.reset) * 1000 : null };
    else if (limits[k]) u[k] = fromSeen(limits[k]!, k === 'week');
  }
  return u;
}
const limits: { five?: { pct: number; at: number | null }; week?: { pct: number; at: number | null } } = {};
export const knowLimits = () => !!(limits.five || limits.week);
// 한도에 닿은(100%) 것이 다시 차는 시각(둘 다면 늦은 쪽) — 상태줄에서 못 읽었으면 null
export const limitReset = () => Math.max(0, ...[limits.five, limits.week].flatMap(l => l && l.pct >= 100 && l.at && l.at > Date.now() ? [l.at] : [])) || null;
// 사용량 한도로 멈춘 화면 — Claude 가 대화 끝에 남기는 글(「usage limit reached」 · 「You've hit your limit」 · 「send a message after it resets to continue」)
// shortcut: 화면 아래쪽 글로만 가린다 — Claude 가 답에 이 말을 그대로 쓰면 한도로 본다(결과 파일 없이 쉴 때만 보니 드물다)
export const isLimitScreen = (lines: string[]) => /usage limit reached|hit your (?:\w+ )?limit|after it resets to continue/i.test(lines.join('\n'));
export const limitHit = async (id: string) => isLimitScreen((await live(id)).lines.map(l => l.replace(ANSI, '')));
// 백그라운드 셸이 도는가 — 입력칸 아래 모드 줄의 「· 1 shell」(⏵⏵ auto mode on · 1 shell · …). 셸을 백그라운드로 돌리고 턴을 끝낸 Claude 는 셸이 끝나면 스스로 이어 간다
export const hasShells = (plain: string[]) => { const box = claudeBox(plain); return box >= 0 && plain.slice(box + 1).some(l => /(?:^|·)\s*\d+ shells?(?:\s|$)/.test(l)); };
export const bgShells = async (id: string) => hasShells((await sh('herdr', ['pane', 'read', id, '--source', 'visible'])).stdout.replace(/\r/g, '').split('\n'));
// 상태줄의 남은 시간 글(3h10m · 2d4h · now) ↔ 초
export const resetSecs = (r: string) => { const h = r.match(/^(\d+)h(\d+)m$/), d = r.match(/^(\d+)d(\d+)h$/); return h ? +h[1] * 3600 + +h[2] * 60 : d ? +d[1] * 86400 + +d[2] * 3600 : 0; };
export const until = (ms: number, day: boolean) => {
  const s = (ms - Date.now()) / 1000;
  return day ? `${Math.floor(s / 86400)}d${Math.floor(s % 86400 / 3600)}h` : `${Math.floor(s / 3600)}h${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}m`;
};
// 다시 찰 시각이 지났으면 그 뒤로 안 썼다는 뜻이라 0%
const fromSeen = (l: { pct: number; at: number | null }, day: boolean): Limit =>
  l.at && l.at <= Date.now() ? { pct: 0, reset: null } : { pct: l.pct, reset: l.at ? until(l.at, day) : null };

// 셸 명령 기록 — 터미널의 지난 출력을 프롬프트 줄 기준으로 「명령 + 출력」 으로 자른다(브라우저 스크롤로 보려고).
// 프롬프트 기호는 줄 첫 낱말 중 흔한 것(➜ ❯ $ % # λ, PowerShell 의 PS)에서 가장 많이 나온 것. 오래된 출력은 끝 3000줄까지만. 출력 줄은 색(ANSI) 그대로.
// ponytail: robbyrussell(➜ 폴더 git:(브랜치) ✗ 명령)·PowerShell(PS 경로> 명령) 꼴만 명령을 떼어 낸다. 다른 테마는 프롬프트 줄 통째로 보인다.
const MARKS = ['➜', '❯', '$', '%', '#', 'λ', 'PS'];
export async function history(id: string) {
  // 출력은 터미널 색(ANSI) 그대로 넘기고, 프롬프트 찾기는 색을 뺀 글로 한다
  const raw = (await sh('herdr', ['pane', 'read', id, '--source', 'recent-unwrapped', '--lines', '3000', '--format', 'ansi'])).stdout.replace(/\r/g, '').split('\n');
  const lines = raw.map(l => l.replace(ANSI, ''));
  const count = new Map<string, number>();
  for (const l of lines) { const m = l.split(' ')[0]; if (MARKS.includes(m)) count.set(m, (count.get(m) ?? 0) + 1); }
  const mark = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
  type Block = { cmd: string; where: string; out: string[] };
  const blocks: Block[] = [];
  let cur: Block | null = null;
  lines.forEach((l, i) => {
    if (mark && l.startsWith(`${mark} `)) {
      // PowerShell 은 「PS C:\경로> 명령」 — 폴더는 경로의 마지막 칸
      const ps = mark === 'PS' ? l.match(/^PS (.+?)>\s?(.*)$/) : null;
      const m = ps ? [l, ps[1].split(/[\\/]/).pop() ?? ps[1], ps[2]] : l.match(/^\S+\s+(\S+)(?:\s+git:\([^)]*\))?(?:\s+✗)?\s?(.*)$/);
      cur = { cmd: m ? m[2] : l, where: m ? m[1] : '', out: [] };
      blocks.push(cur);
    } else if (cur) cur.out.push(raw[i]);
    else if (l.trim()) { cur = { cmd: '', where: '', out: [raw[i]] }; blocks.push(cur); }   // 첫 프롬프트 앞 출력
  });
  for (const b of blocks) while (b.out.length && !b.out.at(-1)!.replace(ANSI, '').trim()) b.out.pop();
  return { mark: mark ?? null, blocks: blocks.slice(-200) };
}

// 배치 바꾸기 — 나누기(왼·오·위·아래)·닫기·새 칸에 에이전트 띄우기. herdr 배치를 바꾸므로 터미널 herdr 화면도 같이 바뀐다.
// herdr 는 오른쪽·아래로만 나눈다 — 왼쪽·위는 나눈 뒤 두 칸 자리를 바꾼다. 새 칸은 원래 칸의 작업 폴더에서 시작한다.
export async function split(id: string, dir: string) {
  if (!['left', 'right', 'up', 'down'].includes(dir)) throw new Error(`나눌 방향이 아니다: ${dir}`);
  const p = (await snapshot()).panes.find(p => p.id === id);
  if (!p) throw new Error('pane 없음');
  const r = await api('pane.split', { target_pane_id: id, direction: dir === 'left' || dir === 'right' ? 'right' : 'down', cwd: p.cwd, focus: false }) as { pane: { pane_id: string } };
  if (dir === 'left' || dir === 'up') await api('pane.swap', { source_pane_id: r.pane.pane_id, target_pane_id: id });
  return r.pane.pane_id;
}
export const close = (id: string) => api('pane.close', { pane_id: id });
// 「봤다」 표시 — herdr 는 포커스로만 끝남(done)을 봤다로 바꾼다(봤다만 표시하는 API 는 없다, 0.9.3 까지). 포커스는 터미널 herdr 화면도 그 pane 으로 옮긴다.
export const focus = (id: string) => api('pane.focus', { pane_id: id });

// 옮기기 — 끌어 놓기로. pane 은 다른 pane 옆(왼·오·위·아래, 다른 탭·워크스페이스여도)·자리 바꾸기·다른 워크스페이스의 새 탭으로.
// 다른 워크스페이스로 가면 pane id 가 바뀐다 — herdr 가 준 새 id 를 돌려준다. 안에서 돌던 것은 끊기지 않는다.
const PANE = /^w[0-9A-Za-z]+:p[0-9A-Za-z]+$/, WS = /^w[0-9A-Za-z]+$/;
type MoveResult = { move_result?: { pane?: { pane_id: string } } };
export async function movePane(id: string, to: { pane?: unknown; side?: unknown; workspace?: unknown }) {
  if (typeof to.workspace === 'string' && WS.test(to.workspace)) {
    const r = await api('pane.move', { pane_id: id, destination: { type: 'new_tab', workspace_id: to.workspace }, focus: false }) as MoveResult;
    return r.move_result?.pane?.pane_id ?? id;
  }
  if (typeof to.pane !== 'string' || !PANE.test(to.pane) || to.pane === id) throw new Error('옮길 자리가 아니다');
  if (to.side === 'swap') { await api('pane.swap', { source_pane_id: id, target_pane_id: to.pane }); return id; }
  if (!['left', 'right', 'up', 'down'].includes(String(to.side))) throw new Error(`붙일 쪽이 아니다: ${to.side}`);
  const panes = (await snapshot()).panes, target = panes.find(p => p.id === to.pane), self = panes.find(p => p.id === id);
  if (!target || !self) throw new Error('pane 없음');
  // herdr 는 같은 탭 안에서는 옮기지 않는다(changed:false) — 잠깐 새 탭으로 뺐다가 붙인다. 빈 임시 탭은 herdr 가 닫는다.
  let from = id;
  if (self.tab === target.tab) from = (await api('pane.move', { pane_id: id, destination: { type: 'new_tab', workspace_id: target.workspace }, focus: false }) as MoveResult).move_result?.pane?.pane_id ?? id;
  const r = await api('pane.move', { pane_id: from, destination: { type: 'tab', tab_id: target.tab, split: to.side === 'left' || to.side === 'right' ? 'right' : 'down', target_pane_id: to.pane }, focus: false }) as MoveResult;
  const moved = r.move_result?.pane?.pane_id ?? from;
  if (to.side === 'left' || to.side === 'up') await api('pane.swap', { source_pane_id: moved, target_pane_id: to.pane });
  return moved;
}
// 새 워크스페이스 — 이름과 시작 폴더(있는 폴더만, ~ 는 집). 첫 pane 을 돌려준다.
const expand = (p: string) => p.replace(/^~(?=[\\/]|$)/, homedir());
export async function newWorkspace(label: unknown, cwd: unknown) {
  if (typeof label !== 'string' || !label.trim() || label.length > 100) throw new Error('이름이 비었거나 너무 길다');
  const dir = typeof cwd === 'string' && cwd.trim() ? expand(cwd.trim()) : homedir();
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`폴더가 없다: ${dir}`);
  const r = await api('workspace.create', { label: label.trim(), cwd: dir, focus: false }) as { root_pane: { pane_id: string } };
  return r.root_pane.pane_id;
}
// 새 워크트리 — herdr 가 git 워크트리와 그 워크스페이스를 한 번에 만든다(자리는 herdr 기본 ~/.herdr/worktrees/<레포>/<브랜치>).
// 실행기가 「새 워크트리」 엔진을 돌릴 때 쓴다. 워크트리 경로와 그 워크스페이스의 첫 pane(셸)을 돌려준다.
export async function newWorktree(repo: string, branch: string, base: string | undefined, label: string) {
  const r = await sh('herdr', ['worktree', 'create', '--cwd', repo, '--branch', branch, ...(base ? ['--base', base] : []), '--label', label, '--no-focus'])
    .catch((e: Error) => { throw new Error(e.message.match(/"message"\s*:\s*"([^"]+)"/)?.[1] ?? e.message.split('\n').filter(Boolean).at(-1)); });
  const out = JSON.parse(r.stdout).result as { worktree: { path: string }; root_pane: { pane_id: string } };
  return { path: out.worktree.path, pane: out.root_pane.pane_id };
}
// 폴더 고르기 — 셸 탭 완성처럼 마지막 칸의 앞글자로 하위 폴더를 찾는다(숨김 폴더는 . 으로 시작할 때만).
export function folders(q: string) {
  const full = expand(q || '~/'), cut = Math.max(full.lastIndexOf('/'), full.lastIndexOf('\\'));   // Windows 는 \ 도
  const parent = full.slice(0, cut + 1) || '/', head = full.slice(cut + 1).toLowerCase();
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.toLowerCase().startsWith(head) && (head.startsWith('.') || !e.name.startsWith('.')))
      .map(e => (parent + e.name).replace(homedir(), '~')).sort().slice(0, 30);
  } catch { return []; }
}

// 워크스페이스 메뉴 — 새 탭(그 워크스페이스 폴더에서), 이름 바꾸기. 워크스페이스 닫기는 두지 않는다(사용자 결정).
export async function workspaceAction(id: string, what: string, b: { label?: unknown }) {
  if (what === 'rename') {
    if (typeof b.label !== 'string' || !b.label.trim() || b.label.length > 100) throw new Error('이름이 비었거나 너무 길다');
    await api('workspace.rename', { workspace_id: id, label: b.label.trim() });
    return undefined;
  }
  if (what === 'tab') {
    const s = await snapshot();
    const w = (s.workspaces as { workspace_id: string; worktree?: { checkout_path: string } }[]).find(w => w.workspace_id === id);
    const cwd = w?.worktree?.checkout_path ?? s.panes.find(p => p.workspace === id)?.cwd;
    const r = await api('tab.create', { workspace_id: id, cwd, focus: false }) as { root_pane: { pane_id: string } };
    return r.root_pane.pane_id;
  }
  throw new Error(`모르는 동작: ${what}`);
}

// 탭 이름 바꾸기
export function renameTab(tab: string, label: unknown) {
  if (typeof label !== 'string' || !label.trim() || label.length > 100) throw new Error('이름이 비었거나 너무 길다');
  return api('tab.rename', { tab_id: tab, label: label.trim() });
}

// 워크스페이스 순서 — before 앞에(없으면 맨 끝). herdr 의 insert_index 는 「지금 그 자리에 있는 것 앞」이라 before 의 지금 자리를 그대로 준다.
export async function moveWorkspace(id: string, before: unknown) {
  const ws = (await snapshot()).workspaces as { workspace_id: string; number: number }[];
  const b = typeof before === 'string' ? ws.find(w => w.workspace_id === before) : undefined;
  await api('workspace.move', { workspace_id: id, insert_index: b ? b.number - 1 : ws.length });
}
// 칸 경계 옮기기 — 탭 안 나눔(path)의 비율. 0.1~0.9 로 막는다.
export function ratio(tab: string, path: unknown, value: unknown) {
  if (!Array.isArray(path) || path.length > 16 || !path.every(b => typeof b === 'boolean') || typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('비율 형식이 아니다');
  return api('layout.set_split_ratio', { tab_id: tab, path, ratio: Math.min(0.9, Math.max(0.1, value)) });
}
// 셸 pane 에 에이전트를 띄운다(herdr agent start — 셸이 프롬프트에 있어야 한다). 이름은 herdr 가 요구해서 붙인다.
// args 는 그 에이전트 명령에 붙일 인자(실행기가 Claude 에 --add-dir 을 넘긴다).
export async function start(id: string, kind: string, args: string[] = []) {
  if (kind !== 'claude' && kind !== 'codex') throw new Error(`띄울 수 없는 종류: ${kind}`);
  await api('agent.start', { name: `${kind}-${Date.now().toString(36)}`, kind, pane_id: id, timeout_ms: 60000, ...(args.length ? { args } : {}) });
  for (const t0 = Date.now(); Date.now() - t0 < 60_000; await new Promise(r => setTimeout(r, 1000)))
    if (await ready(id).catch(() => false)) return;
  throw new Error(`${kind} 가 60초 안에 준비되지 않았다`);
}

// 선택 질문에 답하기 — 번호를 누르면 그 선택지로 바로 답이 들어간다(Claude 질문·승인 화면 실측). 직접 입력 선택지는
// 번호를 누른 뒤 글을 넣고 엔터. 번호로 고르기만 되는 화면(Codex 폴더 신뢰)은 잠깐 뒤에도 같은 메뉴가 그 번호에 커서를 둔 채면 엔터로 확정한다
// (다음 질문이 1번에 커서를 두고 뜬 것에 엔터를 넣지 않게 — 누르기 전 메뉴와 같을 때만).
export async function choose(id: string, n: unknown, text: unknown) {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 9) throw new Error('선택지 번호가 아니다');
  const screen = async () => (await live(id)).lines.map(l => l.replace(ANSI, ''));
  const key = (lines: string[]) => JSON.stringify(parseMenu(lines)?.options.map(o => o.label) ?? null);
  const before = typeof text === 'string' && text.trim() ? '' : key(await screen());
  await api('pane.send_keys', { pane_id: id, keys: [String(n)] });   // 글로 보내면 붙여넣기로 들어가 질문 화면이 무시한다 — 키로
  if (typeof text === 'string' && text.trim()) {
    await new Promise(r => setTimeout(r, 400));
    await api('pane.send_input', { pane_id: id, text, keys: ['enter'] });
  } else {
    await new Promise(r => setTimeout(r, 400));
    const after = await screen();
    if (stillPicked(after, n) && key(after) === before) await api('pane.send_keys', { pane_id: id, keys: ['enter'] });
  }
}

// 빠른 키(승인 메뉴 등) — 입력 흐름 없이 보낸다. 정해 둔 키와 숫자 한 자리만.
const KEYS = new Set(['esc', 'enter', 'ctrl+c', 'up', 'down', 'left', 'right', 'tab', 'shift+tab']);
export async function keys(id: string, key: string) {
  if (/^[0-9]$/.test(key) || KEYS.has(key)) await api('pane.send_keys', { pane_id: id, keys: [key] });
  else throw new Error(`보낼 수 없는 키: ${key}`);
}
