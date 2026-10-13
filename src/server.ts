// 화면 서버 — herdr 워크스페이스·pane 터미널, Claude·Codex 대화 기록, 스킬 목록, git 변경을 web/ 화면에 준다.
// 지키는 것: 127.0.0.1 에만 뜨고 Host 머리가 다르면 거절(DNS rebinding), 쓰기 요청은 이 화면 출처만(CSRF),
// 다른 사이트가 이 화면을 틀에 넣지 못하게(클릭재킹). 응답에 CORS 머리를 달지 않으니 다른 출처는 읽지 못한다.
// 위는 브라우저만 막는다 — Docker 컨테이너는 host.docker.internal 로 127.0.0.1 에 닿고 머리를 꾸밀 수 있다.
// 그래서 API 는 열쇠(내 계정만 읽는 파일, 600)를 쿠키로 실어야 쓴다. 막는 범위가 herdr 소켓(600)과 같아진다.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve, sep } from 'node:path';
import { CONFIG_DIR, DATA_DIR, REPO } from './config.ts';
import { choose, close, control, focus, folders, history, keys, live, movePane, moveWorkspace, newWorkspace, prompt, ratio, renameTab, signature, snapshot, split, start, statusline, knowLimits, streamPane, workspaceAction, type Usage } from './herdr.ts';
import { backgroundTasks, chat, checkAlive, codexUsage, taskOutput } from './chat.ts';
import { commands, findFiles } from './complete.ts';
import { firstLine } from './sh.ts';
import { branches, diff } from './diff.ts';
import { summarize } from './summary.ts';
import { skillFile, skills } from './skills.ts';

const WEB = join(REPO, 'web', 'dist');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

// 실시간 갱신(SSE) — herdr 상태가 바뀌면 herdr. 화면이 그때 목록을 다시 받는다.
// ponytail: 2초마다 snapshot 을 떠서 비교한다. 승인 대기 알림이 2초도 늦으면 herdr events.subscribe 로 바꾼다.
const clients = new Set<ServerResponse>();
let lastHerdr = '', herdrBusy = false;
function tick() {
  if (!clients.size || herdrBusy) return;
  herdrBusy = true;
  snapshot().then(s => {
    const sig = signature(s);
    if (sig !== lastHerdr) { lastHerdr = sig; for (const c of clients) c.write('event: herdr\ndata:\n\n'); }
  }).catch(() => undefined).finally(() => { herdrBusy = false; });
}

const lastUsage = new Map<string, Usage>();

const sameOrigin = (origin: string | undefined, port: number) => origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;

// 화면 열쇠 — 처음 serve 때 만들어 파일에 둔다. 바꾸려면 파일을 지우고 serve 를 다시 띄운다.
function consoleKey() {
  const file = join(CONFIG_DIR, 'console.key');
  try { return readFileSync(file, 'utf8').trim(); } catch { /* 처음 */ }
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const key = randomBytes(24).toString('base64url');
  writeFileSync(file, `${key}\n`, { mode: 0o600 });
  return key;
}
const same = (a: string | undefined, b: string) => !!a && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const cookieKey = (req: IncomingMessage) => req.headers.cookie?.match(/(?:^|;\s*)edith=([^;]+)/)?.[1];

const body = (req: IncomingMessage, max = 1_000_000) => new Promise<unknown>((ok, no) => {
  let b = '';
  req.on('data', d => { b += d; if (b.length > max) req.destroy(new Error('본문이 너무 크다')); });
  req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch (e) { no(e); } });
  req.on('error', no);
});

const reply = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

// 첨부 — 화면이 올린 파일(base64)을 내 데이터 폴더에 두고 그 경로를 돌려준다. 에이전트가 그 경로로 읽는다.
// 이름은 글자·숫자·.-_ 만 남기고 앞에 시각·난수를 붙여 겹치지 않게 한다.
// ponytail: 올린 파일은 지우지 않는다 — 쌓이면 ~/.local/share/edith/uploads 를 비운다.
const UPLOAD_MAX = 15 * 1024 * 1024;
function upload(b: { name?: unknown; data?: unknown }) {
  if (typeof b.data !== 'string') throw new Error('파일이 없다');
  const buf = Buffer.from(b.data, 'base64');
  if (!buf.length || buf.length > UPLOAD_MAX) throw new Error('파일은 15MB 까지');
  const name = (typeof b.name === 'string' ? basename(b.name) : '').replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^\.+/, '').slice(-80) || 'file';
  const dir = join(DATA_DIR, 'uploads');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}-${name}`);
  writeFileSync(path, buf, { mode: 0o600, flag: 'wx' });
  return path;
}

export function serve(port: number) {
  const KEY = consoleKey();
  setInterval(tick, 2000);
  createServer(async (req, res) => {
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) return reply(res, 403, 'host');
    const url = new URL(req.url ?? '/', 'http://x'), path = url.pathname;
    // 열쇠 붙은 주소로 열면 쿠키로 남기고 주소에서 열쇠를 지운다.
    if (url.searchParams.has('key')) {
      if (!same(url.searchParams.get('key') ?? '', KEY)) return reply(res, 403, '열쇠가 맞지 않다');
      res.writeHead(302, { 'set-cookie': `edith=${KEY}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`, location: '/' });
      return res.end();
    }
    const authed = same(cookieKey(req), KEY);
    if (path.startsWith('/api/') && !authed) return reply(res, 401, '열쇠 없음 — edith serve 가 보여 준 주소로 연다');
    // 쓰기는 이 화면에서 온 JSON POST 만 — 다른 사이트는 Origin 이 다르고, JSON 본문은 브라우저가 사전 확인 없이 못 보낸다.
    if (req.method !== 'GET' && (req.method !== 'POST' || !sameOrigin(req.headers.origin, port) || !req.headers['content-type']?.startsWith('application/json')))
      return reply(res, 403, '쓰기는 이 화면에서 온 요청만');
    const fail = (e: unknown) => reply(res, 409, firstLine(e));
    try {
      if (path === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write(':\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      // 스킬 지도(읽기만) — 목록·관계, 스킬 폴더의 md 한 개
      if (path === '/api/skills') return reply(res, 200, skills());
      if (path === '/api/skills/file') {
        const t = skillFile(url.searchParams.get('id') ?? '', url.searchParams.get('file') ?? '');
        return t === null ? reply(res, 404, '없음') : reply(res, 200, t);
      }
      if (req.method === 'POST' && path === '/api/upload') return reply(res, 200, { path: upload(await body(req, UPLOAD_MAX * 1.4) as Record<string, unknown>) });
      if (path === '/api/herdr') return reply(res, 200, await snapshot());
      const h = decodeURIComponent(path).match(/^\/api\/herdr\/panes\/(w[0-9A-Za-z]+:p[0-9A-Za-z]+)\/(stream|prompt|keys|input|chat|live|history|split|close|start|choose|commands|files|move|focus|diff|branch|usage|summary|tasks)$/);
      if (h?.[2] === 'stream' && req.method === 'GET')
        return await streamPane(req, res, h[1], { control: url.searchParams.get('mode') === 'control', takeover: url.searchParams.has('takeover') });
      if (h?.[2] === 'live' && req.method === 'GET') return reply(res, 200, await live(h[1]));
      if (h?.[2] === 'history' && req.method === 'GET') return reply(res, 200, await history(h[1]));
      if ((h?.[2] === 'commands' || h?.[2] === 'files') && req.method === 'GET') {
        const p = (await snapshot()).panes.find(p => p.id === h[1]);
        if (!p) return reply(res, 404, 'pane 없음');
        return reply(res, 200, h[2] === 'commands' ? await commands(p.agent ?? '', p.cwd) : await findFiles(p.cwd, url.searchParams.get('q') ?? ''));
      }
      // 사용량(컨텍스트·5시간·7일) — 못 읽었을 때(메뉴로 상태줄이 가려짐 등)는 마지막으로 읽은 값
      if (h?.[2] === 'usage' && req.method === 'GET') {
        const snap = await snapshot(), p = snap.panes.find(p => p.id === h[1]);
        if (!p) return reply(res, 404, 'pane 없음');
        // 서버를 막 띄워 Claude 한도를 아직 모르면 다른 Claude pane 상태줄에서 먼저 찾는다
        if (p.agent === 'claude' && !knowLimits()) for (const o of snap.panes.filter(o => o.agent === 'claude' && o.id !== p.id)) if ((await statusline(o.id))?.five) break;
        const u = p.agent === 'claude' ? await statusline(p.id) : p.agent === 'codex' ? codexUsage(p.id, p.cwd, p.title) : null;
        if (u) lastUsage.set(p.id, u);
        return reply(res, 200, u ?? lastUsage.get(p.id) ?? null);
      }
      if (h?.[2] === 'branch' && req.method === 'GET') {
        const s = await snapshot(), p = s.panes.find(p => p.id === h[1]);
        if (!p) return reply(res, 404, 'pane 없음');
        const ws = (s.workspaces as { workspace_id: string; worktree?: Parameters<typeof branches>[1] }[]).find(w => w.workspace_id === p.workspace);
        return reply(res, 200, await branches(p.cwd, ws?.worktree));
      }
      if (h?.[2] === 'diff' && req.method === 'GET') {
        const p = (await snapshot()).panes.find(p => p.id === h[1]);
        if (!p) return reply(res, 404, 'pane 없음');
        const g = (k: string) => url.searchParams.get(k);
        return await diff(p.cwd, { mode: g('mode'), base: g('base'), commit: g('commit') }).then(d => reply(res, 200, d), fail);
      }
      // 백그라운드 작업(Claude 가 띄운 셸·에이전트) — 목록, ?task=<id> 면 그 출력 끝
      if (h?.[2] === 'tasks' && req.method === 'GET') {
        const snap = await snapshot(), p = snap.panes.find(p => p.id === h[1]);
        if (!p) return reply(res, 404, 'pane 없음');
        if (p.agent !== 'claude') return reply(res, 200, []);
        const others = snap.panes.filter(x => x.agent === p.agent && x.cwd === p.cwd && x.id !== p.id).map(x => x.title), task = url.searchParams.get('task');
        if (!task) return reply(res, 200, await checkAlive(backgroundTasks(p.id, p.cwd, p.title, others)));
        const out = taskOutput(p.id, p.cwd, p.title, others, task);
        return out === null ? reply(res, 404, '작업 없음') : reply(res, 200, out);
      }
      if (h?.[2] === 'chat') {
        const snap = await snapshot(), p = snap.panes.find(p => p.id === h[1]);
        if (!p) return reply(res, 404, 'pane 없음');
        if (p.agent !== 'claude' && p.agent !== 'codex') return reply(res, 400, '대화는 Claude·Codex pane 만');
        const others = snap.panes.filter(x => x.agent === p.agent && x.cwd === p.cwd && x.id !== p.id).map(x => x.title);   // 같은 폴더의 다른 세션 제목
        const before = url.searchParams.has('before') ? Math.max(0, Number(url.searchParams.get('before')) || 0) : undefined;   // 이전 대화
        const c = chat(p.id, p.agent, p.cwd, p.title, others, before);
        return reply(res, 200, { file: c.file && basename(c.file), items: c.items, more: c.more });
      }
      if (h && req.method === 'POST') {
        const b = await body(req) as { text?: unknown; key?: unknown; scroll?: unknown };
        switch (h[2]) {
          case 'prompt':
            if (typeof b.text !== 'string' || !b.text.trim()) return reply(res, 400, '보낼 글이 없다');
            // herdr 가 거절한 것(승인 대기 중 등)은 409 로 그 사유를 그대로
            return await prompt(h[1], b.text).then(() => reply(res, 200, { ok: true }), fail);
          case 'keys': return await keys(h[1], String(b.key)).then(() => reply(res, 200, { ok: true }), e => reply(res, 400, firstLine(e)));
          case 'input': return control(h[1], b) ? reply(res, 200, { ok: true }) : reply(res, 409, '입력 흐름이 없다 — 터미널을 눌러 입력 모드로');
          case 'split': return await split(h[1], String((b as { direction?: unknown }).direction)).then(id => reply(res, 200, { id }), fail);
          case 'close': return await close(h[1]).then(() => reply(res, 200, { ok: true }), fail);
          case 'focus': return await focus(h[1]).then(() => reply(res, 200, { ok: true }), fail);
          case 'move': return await movePane(h[1], b as Record<string, unknown>).then(id => reply(res, 200, { id }), fail);
          case 'choose': {
            const c = b as { n?: unknown; text?: unknown };
            return await choose(h[1], c.n, c.text).then(() => reply(res, 200, { ok: true }), fail);
          }
          case 'summary': {   // 변경 AI 요약 — 화면이 보는 것과 같은 기준으로 서버가 diff 를 다시 떠서 묻는다. cached 면 기억해 둔 것만
            const p = (await snapshot()).panes.find(x => x.id === h[1]), q = b as { mode?: string; base?: string; commit?: string; cached?: boolean };
            if (!p) return reply(res, 404, 'pane 없음');
            return await diff(p.cwd, q).then(d => summarize(d.text, !!q.cached)).then(s => reply(res, 200, s), fail);
          }
          case 'start': return await start(h[1], String((b as { kind?: unknown }).kind)).then(() => reply(res, 200, { ok: true }), fail);
        }
      }
      if (path === '/api/herdr/folders') return reply(res, 200, folders(url.searchParams.get('q') ?? ''));
      if (path === '/api/herdr/workspaces' && req.method === 'POST') {
        const b = await body(req) as { label?: unknown; cwd?: unknown };
        return await newWorkspace(b.label, b.cwd).then(id => reply(res, 200, { id }), fail);
      }
      const wm = decodeURIComponent(path).match(/^\/api\/herdr\/workspaces\/(w[0-9A-Za-z]+)\/(move|tab|rename)$/);
      if (wm && req.method === 'POST') {
        const b = await body(req) as { before?: unknown; label?: unknown };
        if (wm[2] === 'move') return await moveWorkspace(wm[1], b.before).then(() => reply(res, 200, { ok: true }), fail);
        return await workspaceAction(wm[1], wm[2], b).then(id => reply(res, 200, id ? { id } : { ok: true }), fail);
      }
      const tb = decodeURIComponent(path).match(/^\/api\/herdr\/tabs\/(w[0-9A-Za-z]+:t[0-9A-Za-z]+)\/(ratio|rename)$/);
      if (tb && req.method === 'POST') {
        const b = await body(req) as { path?: unknown; ratio?: unknown; label?: unknown };
        return await Promise.resolve().then(() => tb[2] === 'ratio' ? ratio(tb[1], b.path, b.ratio) : renameTab(tb[1], b.label))
          .then(() => reply(res, 200, { ok: true }), fail);
      }
      if (req.method === 'POST' || path.startsWith('/api/')) return reply(res, 404, '없음');
      // 화면 — 빌드한 web/dist. 없는 경로는 index.html(화면 안 주소).
      const f = resolve(WEB, `.${decodeURIComponent(path)}`);
      const file = f.startsWith(WEB + sep) && existsSync(f) && statSync(f).isFile() ? f : join(WEB, 'index.html');
      if (!existsSync(file)) return reply(res, 503, 'web/dist 없음 — npm run build');
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" });
      res.end(readFileSync(file));
    } catch (e) { reply(res, 500, firstLine(e)); }
  }).listen(port, '127.0.0.1', () => console.log(`EDITH: http://127.0.0.1:${port}/?key=${KEY}  (한 번 열면 브라우저에 30일 남는다)`));
}
