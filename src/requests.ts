// 요청 받기 — 다른 도구(대화방 봇 등)가 ~/.local/share/edith/requests/<id>.json 에 「이 엔진을 이 입력으로 돌려 달라」 를 두면
// 런 화면 왼쪽에 뜨고, 사람이 「열기」(새 런 칸에 채운 뒤 런 시작) 또는 「거절」 한다. 저절로 돌리지 않는다.
// EDITH 는 답을 <id>.answer.json 에 쓴다 — 요청 쪽은 그 파일이나 `edith request <id>`(읽기만)로 진행을 본다. 열쇠는 오가지 않는다.
// 요청 꼴: {"engine": "<공방 폴더>", "input": "<런 입력>", "from"?: "<요청자>", "room"?: "<방>", "cwd"?: "<작업 폴더>", "branch"?: "<새 워크트리 브랜치>", "unattended"?: true(무인 런 — 칸에 체크만 해 두고, 시작은 사람이),
//  "title"?: "<카드에 보일 제목 — 없으면 입력 첫 줄>", "tag"?: "<짧은 꼬리표 — 예: 티켓 번호>",
//  "meta"?: {<요청 쪽이 런까지 넘길 것 — 4KB 까지 · EDITH 는 보지 않고 런 작업 문서 edith-request.json 에 그대로 둔다>}}
// 답할 때(열어서 시작 · 거절) 엔진에 on: "request" 명령이 있으면 돈다(src/runner.ts requestHook) — 요청 쪽에 알리는 것은 엔진 몫
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.ts';
import { listRuns } from './runner.ts';

export const REQUESTS = join(DATA_DIR, 'requests');
export const REQ_ID = /^[A-Za-z0-9_-]{1,64}$/;
export type Req = { id: string; engine: string; input: string; title?: string; tag?: string; from?: string; room?: string; cwd?: string; branch?: string; unattended?: boolean; meta?: Record<string, unknown>; at: number };
type Answer = { state: 'started' | 'rejected'; run?: number; reason?: string; at: number };

const str = (v: unknown, n: number) => typeof v === 'string' && v.trim() ? v.slice(0, n) : undefined;
function readJson(f: string) { try { return JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>; } catch { return null; } }
export function readRequest(id: string, root = REQUESTS): Req | null {
  if (!REQ_ID.test(id)) return null;
  const f = join(root, `${id}.json`), o = readJson(f);
  if (!o || typeof o.engine !== 'string') return null;
  const meta = o.meta && typeof o.meta === 'object' && !Array.isArray(o.meta) && JSON.stringify(o.meta).length <= 4096 ? o.meta as Record<string, unknown> : undefined;
  return { id, engine: o.engine.slice(0, 64), input: str(o.input, 4000) ?? '', title: str(o.title, 200), tag: str(o.tag, 60), from: str(o.from, 200), room: str(o.room, 200), cwd: str(o.cwd, 1000), branch: str(o.branch, 200),
    ...(o.unattended === true ? { unattended: true } : {}), ...(meta ? { meta } : {}), at: statSync(f).mtimeMs };
}
const answerOf = (id: string, root: string) => readJson(join(root, `${id}.answer.json`)) as Answer | null;
// 아직 답하지 않은 요청 — 오래된 것부터
export function listRequests(root = REQUESTS): Req[] {
  let files: string[] = [];
  try { files = readdirSync(root); } catch { return []; }
  return files.flatMap(f => {
    const id = f.match(/^([A-Za-z0-9_-]{1,64})\.json$/)?.[1];
    const r = id && !answerOf(id, root) ? readRequest(id, root) : null;
    return r ? [r] : [];
  }).sort((a, b) => a.at - b.at);
}
export function answerRequest(id: string, a: Omit<Answer, 'at'>, root = REQUESTS) {
  if (!readRequest(id, root)) throw new Error('없는 요청이다');
  if (answerOf(id, root)) throw new Error('이미 답한 요청이다');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const f = join(root, `${id}.answer.json`), tmp = `${f}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...a, at: Date.now() }), { mode: 0o600 });
  renameSync(tmp, f);
}
// 진행 — 요청 · 답 · (시작했으면) 그 런의 상태 · 진행
export function requestStatus(id: string, root = REQUESTS) {
  const req = readRequest(id, root);
  if (!req) return null;
  const a = answerOf(id, root), run = a?.run ? listRuns().find(x => x.id === a.run) ?? null : null;
  return { id, state: a?.state ?? 'pending', engine: req.engine, run, ...(a?.reason ? { reason: a.reason } : {}) };
}
