// 화면 서버 — herdr 워크스페이스·pane 터미널, Claude·Codex 대화 기록, 스킬 목록, git 변경을 web/ 화면에 준다.
// 지키는 것: 127.0.0.1 에만 뜨고 Host 머리가 다르면 거절(DNS rebinding), 쓰기 요청은 이 화면 출처만(CSRF),
// 다른 사이트가 이 화면을 틀에 넣지 못하게(클릭재킹). 응답에 CORS 머리를 달지 않으니 다른 출처는 읽지 못한다.
// 위는 브라우저만 막는다 — Docker 컨테이너는 host.docker.internal 로 127.0.0.1 에 닿고 머리를 꾸밀 수 있다.
// 그래서 API 는 열쇠(내 계정만 읽는 파일, 600)를 쿠키로 실어야 쓴다. 막는 범위가 herdr 소켓(600)과 같아진다.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve, sep } from 'node:path';
import { hostname, userInfo } from 'node:os';
import { execFileSync } from 'node:child_process';
import { CONFIG_DIR, DATA_DIR, HOME, REPO } from './config.ts';
import { choose, close, control, focus, folders, history, keys, live, movePane, moveWorkspace, newWorkspace, prompt, ratio, renameTab, signature, snapshot, split, start, statusline, knowLimits, streamPane, watch, workspaceAction, type Usage } from './herdr.ts';
import { backgroundTasks, chat, checkAlive, claudeStarted, codexUsage, remoteControl, taskOutput } from './chat.ts';
import { lastAsks } from '../web/src/asks.ts';
import { commands, findFiles } from './complete.ts';
import { firstLine } from './sh.ts';
import { branches, diff } from './diff.ts';
import { summarize } from './summary.ts';
import { forgetSkills, skillFile, skills } from './skills.ts';
import { engineMap, workshopFile } from './engineMap.ts';
import { apply, install, pack, plan, preview, unpack } from './skillsMove.ts';
import { closeTunnels, connectMachine, machines, openMachine, tailscalePeers } from './machines.ts';
import { canShoot, screenshot } from './screenshot.ts';
import { prune, UPLOAD_KEEP, UPLOADS } from './uploads.ts';
import { isToggle, setSetting, settings } from './settings.ts';
import { applyDraft, createEngine, discardDraft, ensureClaude, findClaude, listEngines, NAME, readEngine, removeEngine, ROOT as WORKSHOP, saveEngine, syncGuide } from './workshop.ts';
import { act, acted, actionsOf, dropRun, listRuns, loadRun, pickAction, pickRequest, previewSteps, requestHook, resumeRuns, runAction, runLimit, runPicks, RUNS, runView, setRunLimit, startRun } from './runner.ts';
import { repoDiff, repoStatus } from './repos.ts';
import { listOutputs, readOutput } from './outputs.ts';
import { livePort, stream } from './live.ts';
import { runAnalysis } from './analysis.ts';
import { answerRequest, listRequests, readRequest, REQ_ID, REQUESTS } from './requests.ts';
import { brief, dayAi, todoOp, todoState } from './today.ts';
import { addItem, addTask, checkTask, deployBoard, deployDiff, deployDone, deployFetch, deployFile, editItems, prepareMerge, prepItems, promoteCheck, promoteMany } from './deploy.ts';
import { cleanFix, cleanRun, cleanStart, cleanState } from './cleanup.ts';
import { withAgenda } from './agenda.ts';
import { readSettings, saveSettings, settingsPages } from './engineSettings.ts';

const WEB = join(REPO, 'web', 'dist');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

// 실시간 갱신(SSE) — herdr 상태가 바뀌면 herdr. 화면이 그때 목록을 다시 받는다.
// 이벤트 구독(herdr.ts watch)으로 — 이벤트가 오면 스냅샷을 떠서 달라졌을 때만 알린다. 몰려 오면 100ms 안의 것을 한 번으로 묶는다.
const clients = new Set<ServerResponse>();
let lastHerdr = '';
function watchHerdr() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resubscribe = watch(() => {
    clearTimeout(timer);
    timer = setTimeout(() => void snapshot().then(s => {
      resubscribe(s.panes.filter(p => p.agent).map(p => p.id));
      const sig = signature(s);
      if (sig !== lastHerdr) { lastHerdr = sig; for (const c of clients) c.write('event: herdr\ndata:\n\n'); }
    }).catch(() => undefined), 100);
  });
}

const lastUsage = new Map<string, Usage>();
const VERSION = (() => { try { return JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version as string; } catch { return ''; } })();
// 이 기기 이름 — macOS 는 hostname 이 네트워크 이름(ip-192-168-…)일 때가 많아 「컴퓨터 이름」 을 쓴다
const machineName = (() => {
  if (process.platform === 'darwin') try { return execFileSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 2000 }).trim(); } catch { /* 아래로 */ }
  return hostname().split('.')[0];
})();

// 서버 코드가 뜬 뒤 바뀌었는지(git pull·고침) — 바뀌었으면 화면이 「다시 켜기」 를 보인다. 화면(web/dist)은 요청마다 읽어서 새로 고침이면 된다.
const BOOT = Date.now(), SRC = join(REPO, 'src');
const stale = () => readdirSync(SRC).some(f => f.endsWith('.ts') && !f.endsWith('.test.ts') && statSync(join(SRC, f)).mtimeMs > BOOT);
const webBuilt = () => { try { return statSync(join(WEB, 'index.html')).mtimeMs; } catch { return 0; } };
// 다시 켜기 — 같은 프로세스·같은 터미널에서 새 코드로 다시 뜬다(execve). 브라우저는 다시 열지 않는다.
// 터널은 먼저 끈다(exit 를 거치지 않는다) — 다른 기기를 다시 열면 새로 연다.
const canRestart = typeof process.execve === 'function';   // Windows 에는 없다 — 터미널에서 Ctrl+C 뒤 edith
function restart() {
  closeTunnels();
  const args = process.argv.slice(1);
  if (!args.includes('--no-open')) args.push('--no-open');
  process.execve!(process.execPath, [process.execPath, ...process.execArgv, ...args]);
}

// Host 는 127.0.0.1·localhost 만 받는다(DNS rebinding — 남의 도메인 이름으로 이 서버를 부르지 못하게). 포트는 묻지 않는다:
// 다른 기기가 이 EDITH 를 SSH 터널로 열면 그 기기의 다른 포트로 들어온다(machines.ts).
export const hostPort = (host?: string) => host?.match(/^(?:127\.0\.0\.1|localhost):(\d{1,5})$/)?.[1] ?? null;
// 쓰기는 지금 주소와 같은 출처에서 온 것만
const sameOrigin = (origin: string | undefined, host: string) => origin === `http://${host}`;

// 화면 열쇠 — 처음 serve 때 만들어 파일에 둔다. 바꾸려면 파일을 지우고 serve 를 다시 띄운다.
export function consoleKey() {
  const file = join(CONFIG_DIR, 'console.key');
  try { return readFileSync(file, 'utf8').trim(); } catch { /* 처음 */ }
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const key = randomBytes(24).toString('base64url');
  writeFileSync(file, `${key}\n`, { mode: 0o600 });
  return key;
}
const same = (a: string | undefined, b: string) => !!a && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
// 열쇠 쿠키는 포트마다 따로(edith-<포트>) — 같은 127.0.0.1 에 이 기기 EDITH 와 터널로 연 다른 기기 EDITH 가 포트만 달리 뜨면 쿠키가 겹친다
const cookieKey = (req: Pick<IncomingMessage, 'headers'>, port: string) => req.headers.cookie?.match(new RegExp(`(?:^|;\\s*)edith-${port}=([^;]+)`))?.[1];

// 열쇠·출처 검사(Host 는 그 앞에서 본다) — /api/ 는 그 포트의 열쇠 쿠키, 쓰기는 이 화면에서 온 JSON POST 만
// (다른 사이트는 Origin 이 다르고, JSON 본문은 브라우저가 사전 확인 없이 못 보낸다). 막으면 [코드, 사유], 통과면 null.
export function refuse(req: Pick<IncomingMessage, 'method' | 'headers'>, path: string, hp: string, key: string): [number, string] | null {
  if (path.startsWith('/api/') && !same(cookieKey(req, hp), key)) return [401, '열쇠 없음 — 터미널에서 edith 를 다시 치면 열쇠 붙은 주소로 열린다'];
  if (req.method !== 'GET' && (req.method !== 'POST' || !sameOrigin(req.headers.origin, req.headers.host ?? '') || !req.headers['content-type']?.startsWith('application/json')))
    return [403, '쓰기는 이 화면에서 온 요청만'];
  return null;
}

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
// 7일 지난 첨부는 올릴 때 지운다(src/uploads.ts) — 에이전트는 받자마자 읽는다. 지난 대화를 이어 가다 그 파일이 다시 필요하면 다시 올린다.
const UPLOAD_MAX = 15 * 1024 * 1024;
function upload(b: { name?: unknown; data?: unknown }) {
  if (typeof b.data !== 'string') throw new Error('파일이 없다');
  const buf = Buffer.from(b.data, 'base64');
  if (!buf.length || buf.length > UPLOAD_MAX) throw new Error('파일은 15MB 까지');
  const name = (typeof b.name === 'string' ? basename(b.name) : '').replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^\.+/, '').slice(-80) || 'file';
  const dir = UPLOADS;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  prune(dir, UPLOAD_KEEP);
  const path = join(dir, `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}-${name}`);
  writeFileSync(path, buf, { mode: 0o600, flag: 'wx' });
  return path;
}

// 화면 서버를 띄우고, 뜨면 열쇠 붙은 주소를 돌려준다. 포트가 차 있으면 그 오류(EADDRINUSE)로 끝난다 — cli 가 이미 뜬 EDITH 인지 본다.
export function serve(port: number) {
  const KEY = consoleKey();
  const server = createServer(async (req, res) => {
    res.setHeader('x-edith', '1');   // 이미 뜬 EDITH 인지 알아보는 표시(cli)
    const hp = hostPort(req.headers.host);
    if (!hp) return reply(res, 403, 'host');
    const url = new URL(req.url ?? '/', 'http://x'), path = url.pathname;
    // 열쇠 붙은 주소로 열면 쿠키로 남기고 주소에서 열쇠를 지운다.
    if (url.searchParams.has('key')) {
      if (!same(url.searchParams.get('key') ?? '', KEY)) return reply(res, 403, '열쇠가 맞지 않다');
      res.writeHead(302, { 'set-cookie': `edith-${hp}=${KEY}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`, location: '/' });
      return res.end();
    }
    const no = refuse(req, path, hp, KEY);
    if (no) return reply(res, ...no);
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
      // 공방 — 체인 · 엔진 목록(+ 공방 Claude pane, herdr 가 없으면 null), 새로 만들기, 공방 Claude 띄우기, 하나 읽기 · 저장
      if (path === '/api/workshop' && req.method === 'GET')
        return reply(res, 200, { root: WORKSHOP, engines: listEngines(), claude: await findClaude().catch(() => null) });
      if (path === '/api/workshop' && req.method === 'POST') {
        const b = await body(req) as { id?: unknown; name?: unknown; kind?: unknown; engine?: unknown };   // engine — 런이 돌릴 엔진
        try { return reply(res, 200, createEngine(b.id, b.name, b.kind, undefined, b.engine)); } catch (e) { return fail(e); }
      }
      if (path === '/api/workshop/claude' && req.method === 'POST') return await ensureClaude().then(id => reply(res, 200, { id }), fail);
      // 초안 — 적용(읽은 판이 같을 때만) · 버리기, 지우기(휴지통으로)
      const wd = path.match(/^\/api\/workshop\/([^/]+)\/(draft|remove)$/);
      if (wd && NAME.test(wd[1]) && req.method === 'POST') {
        const b = await body(req) as { do?: unknown; version?: unknown };
        try {
          if (wd[2] === 'remove') return reply(res, 200, { trash: removeEngine(wd[1]) });
          return reply(res, 200, b.do === 'apply' ? applyDraft(wd[1], b.version) : discardDraft(wd[1]));
        } catch (e) { return fail(e); }
      }
      // 펼쳐 보기 — 런처럼 노드 한 줄로(읽기만)
      const ws = path.match(/^\/api\/workshop\/([^/]+)\/steps$/);
      if (ws && NAME.test(ws[1]) && req.method === 'GET') return reply(res, 200, previewSteps(ws[1]));
      // 흐름 지도 — 엔진을 단계 칸 · 줄로(읽기만, src/engineMap.ts), 「전체 보기」 — 공방 폴더 안 파일 하나
      const wmap = path.match(/^\/api\/workshop\/([^/]+)\/map$/);
      if (wmap && NAME.test(wmap[1]) && req.method === 'GET') { try { return reply(res, 200, engineMap(wmap[1])); } catch (e) { return fail(e); } }
      if (path === '/api/workshop-file') {
        const t = workshopFile(url.searchParams.get('path') ?? '');
        return t === null ? reply(res, 404, '없음') : reply(res, 200, t);
      }
      const we = path.match(/^\/api\/workshop\/([^/]+)$/);
      // 새 런 칸의 고르기 목록 — 엔진 actions.json 의 on: "picks" 명령을 돌린다(src/runner.ts runPicks). 명령을 돌리니 POST 로만
      const wp = path.match(/^\/api\/workshop\/([^/]+)\/picks$/);
      if (wp && req.method === 'POST') return await runPicks(wp[1]).then(v => reply(res, 200, v), fail);
      if (we && NAME.test(we[1])) {
        if (req.method === 'GET') { try { return reply(res, 200, { ...readEngine(we[1]), picks: pickAction(we[1])?.label, actions: actionsOf(we[1]) }); } catch { return reply(res, 404, '공방에 없다'); } }
        const b = await body(req) as { engine?: unknown; version?: unknown };
        try { return reply(res, 200, saveEngine(we[1], b.engine, b.version)); } catch (e) { return fail(e); }
      }
      // 런 — 목록, 새 런(체인 · 엔진, 작업 폴더, 입력), 하나 보기, 멈춤 · 이어서 · 건너뛰기
      if (path === '/api/runs' && req.method === 'GET') return reply(res, 200, withAgenda(listRuns()));   // 안건 이름(배포 목록 tag)까지 — src/agenda.ts
      // 동시 런 한도 — 넘으면 새 런은 줄을 선다
      if (path === '/api/runs/limit' && req.method === 'GET') return reply(res, 200, { max: runLimit() });
      if (path === '/api/runs/limit' && req.method === 'POST') { try { return reply(res, 200, setRunLimit((await body(req) as { max?: unknown }).max)); } catch (e) { return fail(e); } }
      // 엔진 설정(src/engineSettings.ts) — 공방 엔진 on: "settings" 표 목록 · 하나 읽기 · 저장(엔진 명령이 그 자리에서 돈다)
      if (path === '/api/settings/engine' && req.method === 'GET') return reply(res, 200, settingsPages().map(p => ({ id: p.id, label: p.label })));
      if (path === '/api/settings/engine/table' && req.method === 'GET') return await readSettings(url.searchParams.get('id')).then(t => reply(res, 200, t), fail);
      if (path === '/api/settings/engine/save' && req.method === 'POST') return await saveSettings((await body(req) ?? {}) as Record<string, unknown>).then(t => reply(res, 200, t), fail);
      if (path === '/api/runs' && req.method === 'POST') {
        const b = await body(req) as { engine?: unknown; cwd?: unknown; input?: unknown; branch?: unknown; unattended?: unknown; request?: unknown; pick?: unknown };
        // 요청에서 연 런이면 시작한 뒤 그 요청에 런 번호로 답한다
        const rq = typeof b.request === 'string' && b.request ? b.request : null;
        const asked = rq ? readRequest(rq) : null;
        if (rq && (!asked || !listRequests().some(x => x.id === rq))) return reply(res, 400, '없거나 이미 답한 요청이다');
        // 고르기 목록에서 고른 채로 시작하면 그 제목 · 꼬리표를 요청처럼 남긴다
        return await startRun(b.engine, b.cwd, b.input, b.branch, port, b.unattended, asked ?? pickRequest(b.engine, b.input, b.pick)).then(r => {
          if (asked) {
            answerRequest(asked.id, { state: 'started', run: r.id });
            requestHook(asked.engine, { EDITH_REQUEST_FILE: join(REQUESTS, `${asked.id}.json`), EDITH_REQUEST_STATE: 'started', EDITH_REQUEST_RUN: String(r.id), EDITH_REQUEST_REASON: '' }, join(REQUESTS, `${asked.id}.hook.log`));
          }
          reply(res, 200, r);
        }, fail);
      }
      if (path === '/api/requests' && req.method === 'GET') return reply(res, 200, listRequests());
      if (path === '/api/today' && req.method === 'GET') return reply(res, 200, await brief());
      if (path === '/api/today/ai' && req.method === 'POST') {
        const b = await body(req) as { force?: unknown };
        return await dayAi(b.force === true).then(a => reply(res, 200, a), fail);
      }
      if (path === '/api/today/todo' && req.method === 'GET') return reply(res, 200, todoState());
      if (path === '/api/today/todo' && req.method === 'POST') {
        const b = await body(req) as Record<string, unknown>;
        try { return reply(res, 200, todoOp(b)); } catch (e) { return fail(e); }
      }
      // 끝난 런의 코드가 어느 브랜치까지 갔나(src/reach.ts) · 「새로 받기」 — 그 레포들을 origin 에서 fetch
      // 배포 목록(src/deploy.ts) — 보기(항목 + 그 브랜치의 런) · 최신화(fetch) · 배포일 · 연기 · 보관 · 메모 · 할 일 체크 · 직접 한 일 적기 · 항목 더하기 · 다음 환경에 올리기(레포마다 push) · 그 머지 준비(충돌은 Claude pane)
      // · 배포 조치 뽑기(공방 훅 on: prep — 기다리지 않는다) · 정리 미리보기 · 정리(src/cleanup.ts — 워크트리 · 워크스페이스 · 로컬 브랜치, 공방 훅 on: cleanup) · 걸린 확인 고치기(같은 훅 fix)
      if (path === '/api/deploy' && req.method === 'GET') return reply(res, 200, await deployBoard());
      if (path === '/api/deploy/clean-plan' && req.method === 'GET') return reply(res, 200, cleanState(url.searchParams.get('ids') ?? ''));
      // 「변경 ›」 의 AI 요약 — pane 변경 보기와 같은 summarize(파일마다, 같은 diff 는 기억해 둔 것). 화면이 보는 것과 같은 deployDiff 를 서버가 다시 떠서 묻는다
      if (path === '/api/deploy/diff-summary' && req.method === 'POST') {
        const b = (await body(req) ?? {}) as { id?: unknown; cached?: unknown };
        return await deployDiff(b.id).then(d => summarize(d.text, b.cached === true)).then(s => reply(res, 200, s), fail);
      }
      if (path === '/api/deploy/diff' && req.method === 'GET') { try { return reply(res, 200, await deployDiff(url.searchParams.get('id'))); } catch (e) { return reply(res, 404, { error: (e as Error).message }); } }
      if (path === '/api/deploy/file' && req.method === 'GET') { try { return reply(res, 200, deployFile(url.searchParams.get('id'), url.searchParams.get('name'))); } catch (e) { return reply(res, 404, { error: (e as Error).message }); } }
      if (path === '/api/deploy/done' && req.method === 'GET') return reply(res, 200, deployDone(url.searchParams.get('q') ?? '', url.searchParams.get('before') ?? undefined));
      const dp = path.match(/^\/api\/deploy\/(fetch|edit|task|task-add|add|promote|promote-check|prepare|prep|clean-plan|clean-fix|clean)$/);
      if (dp && req.method === 'POST') {
        const b = (await body(req) ?? {}) as Record<string, unknown>;
        try {
          if (dp[1] === 'fetch') return reply(res, 200, await deployFetch(b.ids));
          if (dp[1] === 'edit') return reply(res, 200, editItems(b));
          if (dp[1] === 'task') return reply(res, 200, checkTask(b));
          if (dp[1] === 'task-add') return reply(res, 200, addTask(b));
          if (dp[1] === 'prep') return reply(res, 200, prepItems(b));
          if (dp[1] === 'promote-check') return reply(res, 200, await promoteCheck(b));
          if (dp[1] === 'clean-plan') return reply(res, 200, cleanStart(b));
          if (dp[1] === 'clean') return reply(res, 200, await cleanRun(b));
          if (dp[1] === 'clean-fix') return reply(res, 200, await cleanFix(b));
          if (dp[1] === 'add') return reply(res, 200, await addItem(b));
          if (dp[1] === 'prepare') return reply(res, 200, await prepareMerge(b));
          return reply(res, 200, await promoteMany(b));
        } catch (e) { return fail(e); }
      }
      const rj = path.match(/^\/api\/requests\/([^/]+)\/reject$/);
      if (rj && REQ_ID.test(rj[1]) && req.method === 'POST') {
        const why = (await body(req) as { reason?: unknown } | null)?.reason, reason = typeof why === 'string' ? why.trim().slice(0, 1000) : '';
        try {
          const asked = readRequest(rj[1]);
          answerRequest(rj[1], { state: 'rejected', ...(reason ? { reason } : {}) });
          if (asked) requestHook(asked.engine, { EDITH_REQUEST_FILE: join(REQUESTS, `${asked.id}.json`), EDITH_REQUEST_STATE: 'rejected', EDITH_REQUEST_RUN: '', EDITH_REQUEST_REASON: reason }, join(REQUESTS, `${asked.id}.hook.log`));
          return reply(res, 200, { ok: true });
        } catch (e) { return fail(e); }
      }
      // 런 단추 기록(최근 5개, code null 이면 도는 중) — 배포 화면이 단추를 누른 뒤 끝났는지만 가볍게 본다
      const rac = path.match(/^\/api\/runs\/(\d{1,6})\/acted$/);
      if (rac && req.method === 'GET') return reply(res, 200, acted(Number(rac[1])).map(a => ({ label: a.label, at: a.at, code: a.code, ...(a.note ? { note: a.note } : {}) })));
      const ru = path.match(/^\/api\/runs\/(\d{1,6})(?:\/(stop|resume|skip|rewind|action|drop))?$/);
      if (ru && !ru[2] && req.method === 'GET') { const v = runView(Number(ru[1])); return v ? reply(res, 200, withAgenda([v])[0]) : reply(res, 404, '없는 런'); }
      // 런의 레포 커밋 상태 — 엔진이 남긴 edith-repos.json 의 레포를 git 으로 읽는다(src/repos.ts)
      const rp = path.match(/^\/api\/runs\/(\d{1,6})\/repos$/);
      if (rp && req.method === 'GET') { const r = loadRun(Number(rp[1])); return r ? reply(res, 200, await repoStatus(join(RUNS, rp[1], 'work'), r.cwd)) : reply(res, 404, '없는 런'); }
      // 런 레포의 변경 — i 번째 레포를 딴 커밋부터 지금까지(src/repos.ts repoDiff)
      const rd = path.match(/^\/api\/runs\/(\d{1,6})\/repos\/(\d{1,2})\/diff$/);
      if (rd && req.method === 'GET') {
        const r = loadRun(Number(rd[1]));
        if (!r) return reply(res, 404, '없는 런');
        try { return reply(res, 200, await repoDiff(join(RUNS, rd[1], 'work'), r.cwd, Number(rd[2]))); } catch (e) { return fail(e); }
      }
      // 런 산출물 — 엔진이 남긴 edith-outputs.json 의 목록 · i 번째 파일의 글(src/outputs.ts). 파일은 런 작업 폴더 · 실행 폴더 안만
      const ro = path.match(/^\/api\/runs\/(\d{1,6})\/outputs(?:\/(\d{1,2}))?$/);
      if (ro && req.method === 'GET') {
        const r = loadRun(Number(ro[1]));
        if (!r) return reply(res, 404, '없는 런');
        const work = join(RUNS, ro[1], 'work'), roots = [r.cwd, join(RUNS, ro[1])];
        try { return reply(res, 200, ro[2] === undefined ? listOutputs(work, roots) : readOutput(work, roots, Number(ro[2]))); } catch (e) { return fail(e); }
      }
      // 런이 띄운 브라우저 화면 — 엔진이 남긴 edith-live.json 의 포트(이 기기)에서 MJPEG 로(src/live.ts)
      const rl = path.match(/^\/api\/runs\/(\d{1,6})\/live$/);
      if (rl && req.method === 'GET') { const p = livePort(join(RUNS, rl[1], 'work')); return p ? await stream(req, res, p) : reply(res, 404, '이 런은 화면을 보내지 않는다'); }
      const ra = path.match(/^\/api\/runs\/(\d{1,6})\/analysis$/);
      if (ra && req.method === 'GET') { const v = runAnalysis(Number(ra[1])); return v ? reply(res, 200, v) : reply(res, 404, '없는 런'); }
      if (ru?.[2] && req.method === 'POST') {
        const b = await body(req) as { key?: unknown; n?: unknown; text?: unknown; reason?: unknown; repo?: unknown };   // repo — 레포 줄 단추(row)의 그 줄 워크트리
        try {
          if (ru[2] === 'action') return reply(res, 200, { ok: true, ...await runAction(Number(ru[1]), b.n, b.text, b.repo) });
          if (ru[2] === 'drop') { dropRun(Number(ru[1]), b.reason); return reply(res, 200, { ok: true }); }
          act(Number(ru[1]), { do: ru[2] as 'stop' | 'resume' | 'skip' | 'rewind', key: b.key });
          return reply(res, 200, { ok: true });
        } catch (e) { return fail(e); }
      }
      // 다른 기기의 EDITH(machines.json) — 이름 목록, 열기(SSH 터널을 열고 그 기기의 열쇠 붙은 주소)
      if (path === '/api/machines') return reply(res, 200, machines().map(m => m.name));
      if (path === '/api/machines/open' && req.method === 'POST')
        return await openMachine(String((await body(req) as { name?: unknown }).name ?? '')).then(url => reply(res, 200, { url }), fail);
      // 다른 기기 잇기 — Tailscale 기기 목록, 잇기(키 등록·machines.json — 비밀번호는 ssh 에 한 번 넘기고 버린다)
      if (path === '/api/machines/peers') { const peers = tailscalePeers(); return reply(res, 200, { tailscale: peers !== null, peers: peers ?? [], user: userInfo().username }); }
      if (path === '/api/machines/connect' && req.method === 'POST') {
        const b = await body(req) as { name?: unknown; target?: unknown; password?: unknown }, log: string[] = [];
        return await connectMachine(String(b.name ?? ''), String(b.target ?? ''), m => log.push(m), typeof b.password === 'string' && b.password ? b.password : undefined)
          .then(() => reply(res, 200, { log }), fail);
      }
      // 스킬 옮기기 — 고른 스킬(내 것·공유만)을 묶음 파일로(공개 스킬·부르는 플러그인은 설치 명령으로), 받은 묶음은 먼저 미리 보고(apply 없이)
      // 고른 대로 홈에 쓰고 고른 설치 명령을 돌린다
      if (path === '/api/skills/export' && req.method === 'POST') {
        if (hp === String(port)) return reply(res, 403, '이 기기 스킬은 이미 여기 있다 — 다른 기기에서 이 EDITH 를 열었을 때만 내려받는다');
        const b = await body(req) as { ids?: unknown; plugins?: unknown }, ids = Array.isArray(b.ids) ? b.ids : [], all = skills();
        const p = plan(HOME, all.filter(n => ids.includes(n.id) && !n.source.startsWith('plugin:') && n.source !== 'system'), all, !!b.plugins);
        const buf = pack(HOME, p.units, p.plugins, p.sources);
        res.writeHead(200, { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="edith-skills-${new Date().toISOString().slice(0, 10)}.json.gz"` });
        return res.end(buf);
      }
      if (path === '/api/skills/import' && req.method === 'POST') {
        const b = await body(req, 40 * 1024 * 1024) as { data?: unknown; apply?: unknown; overwrite?: unknown; install?: { sources?: unknown; plugins?: unknown } };
        try {
          if (typeof b.data !== 'string') throw new Error('파일이 없다');
          const bundle = unpack(Buffer.from(b.data, 'base64'));
          if (!b.apply) return reply(res, 200, preview(HOME, bundle));
          const done = apply(HOME, bundle, Array.isArray(b.overwrite) ? b.overwrite.filter((u): u is string => typeof u === 'string') : []);
          const installed = b.install ? await install(bundle, b.install) : [];
          forgetSkills();
          return reply(res, 200, { ...done, installed });
        } catch (e) { return fail(e); }
      }
      // 📸 스크린샷 — 이 기기 화면에서 영역을 골라 찍는다. 다른 기기가 터널로 연 화면에서는 받지 않는다(그 기기 화면이 아니라 이 기기 화면이 찍혀서)
      if (req.method === 'POST' && path === '/api/shot') {
        if (hp !== String(port)) return reply(res, 403, '스크린샷은 이 기기 화면에서만 — 원격으로 보는 중');
        return await screenshot().then(p => reply(res, 200, { path: p }), fail);
      }
      // 설정 — EDITH 가 까는 Claude 플러그인 켜고 끄기(이 화면을 연 기기의 Claude 에). 테마는 브라우저에 남아 서버가 모른다.
      if (path === '/api/settings' && req.method === 'GET') return reply(res, 200, await settings());
      if (path === '/api/settings' && req.method === 'POST') {
        const b = await body(req) as { key?: unknown; on?: unknown };
        if (typeof b.key !== 'string' || !isToggle(b.key) || typeof b.on !== 'boolean') return reply(res, 400, '{ key: 설정 이름, on: true·false }');
        return await setSetting(b.key, b.on).then(v => reply(res, 200, v), fail);
      }
      if (req.method === 'POST' && path === '/api/upload') return reply(res, 200, { path: upload(await body(req, UPLOAD_MAX * 1.4) as Record<string, unknown>) });
      if (path === '/api/herdr') return reply(res, 200, await snapshot());
      // 이 화면을 어디서 보는지 — 들어온 포트가 이 서버 포트와 다르면 다른 기기가 SSH 터널로 연 것(machines.ts)
      if (path === '/api/view') return reply(res, 200, { remote: hp !== String(port), host: machineName, version: VERSION, shot: canShoot, stale: stale(), web: webBuilt(), restart: canRestart });
      if (req.method === 'POST' && path === '/api/restart') {
        if (!canRestart) return reply(res, 409, '여기서는 다시 켤 수 없다 — 터미널에서 Ctrl+C 뒤 edith');
        reply(res, 200, { ok: true });
        setTimeout(restart, 200);   // 답이 나간 뒤
        return;
      }
      const h = decodeURIComponent(path).match(/^\/api\/herdr\/panes\/(w[0-9A-Za-z]+:p[0-9A-Za-z]+)\/(stream|prompt|keys|input|chat|live|history|split|close|start|choose|commands|files|move|focus|diff|branch|usage|summary|tasks|remote|asks)$/);
      if (h?.[2] === 'stream' && req.method === 'GET')
        return await streamPane(req, res, h[1], { control: url.searchParams.get('mode') === 'control', takeover: url.searchParams.has('takeover') });
      if (h?.[2] === 'live' && req.method === 'GET') return reply(res, 200, await live(h[1]));
      if (h?.[2] === 'remote' && req.method === 'GET') return reply(res, 200, remoteControl(h[1]) ?? null);
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
        if (!task) return reply(res, 200, await checkAlive(backgroundTasks(p.id, p.cwd, p.title, others), claudeStarted(p.id)));
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
      // 시킨 말 — 마지막에 내가 친 말과 답 첫 줄(web/src/asks.ts). 사이드바 카드·상태 목록·알림함이 pane 에 들어가기 전에 본다.
      // ponytail: 대화와 같은 끝 600 항목 안에서만 찾는다 — 그보다 길게 혼자 돈 세션은 「시킨 말 없음」, 불편하면 older() 로 더 거슬러 읽는다
      if (h?.[2] === 'asks' && req.method === 'GET') {
        const snap = await snapshot(), p = snap.panes.find(p => p.id === h[1]);
        if (!p) return reply(res, 404, 'pane 없음');
        if (p.agent !== 'claude' && p.agent !== 'codex') return reply(res, 200, { asks: [] });
        const others = snap.panes.filter(x => x.agent === p.agent && x.cwd === p.cwd && x.id !== p.id).map(x => x.title);
        return reply(res, 200, lastAsks(chat(p.id, p.agent, p.cwd, p.title, others).items));
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
  });
  return new Promise<string>((ok, no) => {
    server.once('error', no);
    server.listen(port, '127.0.0.1', () => { watchHerdr(); resumeRuns(port); try { syncGuide(); } catch { /* 안내는 다음에 */ } ok(`http://127.0.0.1:${port}/?key=${KEY}`); });
  });
}
