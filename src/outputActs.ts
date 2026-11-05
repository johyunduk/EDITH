// 산출물 단추 — 공방 엔진 actions.json 의 {"label", "on": "output", "match": "<산출물 경로 정규식>", "command"}.
// 런 화면 산출물 보기 창 머리줄에 단추 하나가 생기고, 누르면 창 안에 띠가 펼쳐진다(명령이 낸 고르기 · 칸). 「시작」 하면 그 명령이 뒤에서 오래 돈다
// (예: 확인 문서를 브라우저로 따라 해 보고 결과를 그 문서에 다시 그린다). 명령은 그 엔진의 공방 폴더에서 —
//   EDITH_OUTPUT_MODE=form  띠에 보일 JSON(Form)을 표준 출력에, 30초 안
//   EDITH_OUTPUT_MODE=run   표준 입력의 {"ids", "values"} 로 돈다, 1시간까지. 표준 출력 줄 중 {"progress", "ratio"?} JSON 은 진행 줄이 된다
// 값은 환경 변수(EDITH_OUTPUT_FILE · EDITH_RUN · EDITH_WORK)와 표준 입력으로만 넘긴다 — 명령 글에 붙이지 않는다
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.ts';
import { ROOT as WORKSHOP } from './workshop.ts';
import type { RunAction } from './runner.ts';

const LOGS = join(DATA_DIR, 'output-acts');
const ID = /^[\w가-힣.-]{1,40}$/;
const str = (v: unknown, n: number) => typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined;
const ids = (v: unknown, n = 200) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && ID.test(x)).slice(0, n) : [];

// 띠 — pick 은 고를 것(번호 칩 · 빠른 고르기), rows 는 묶음(group)마다 한 줄: key 가 있으면 사람이 넣는 칸, 없으면 text 를 보이기만.
// for 를 적은 줄은 그 id 중 하나라도 고른 때만, when 을 적은 줄은 그 칸 값이 그것일 때만 보인다. options 가 있는 칸은 넣는 대신 그중 하나를 누른다.
// each — 하나에 걸리는 시간(초) · 비용(달러), 화면이 고른 수를 곱해 어림을 보인다
export type FormRow = { group?: string; label: string; sub?: string; for?: string[]; when?: { key: string; value: string }; key?: string; value?: string; options?: { value: string; label: string }[]; placeholder?: string; text?: string; src?: string; tone?: 'ok' | 'warn'; hint?: string };
export type Form = {
  pick?: { label?: string; items: { id: string; label: string }[]; quick?: { label: string; ids: string[] }[]; selected: string[] };
  rows: FormRow[]; note?: string; each?: { sec?: number; usd?: number }; start?: string;
};
export function parseForm(t: string): Form {
  let o: Record<string, unknown>;
  try { o = JSON.parse(t); } catch { throw new Error('단추 명령이 띠 JSON 을 내지 않았다'); }
  if (!o || typeof o !== 'object') throw new Error('단추 명령이 띠 JSON 을 내지 않았다');
  const p = o.pick as Record<string, unknown> | undefined;
  const items = Array.isArray(p?.items) ? (p.items as Record<string, unknown>[]).flatMap(x => typeof x?.id === 'string' && ID.test(x.id) && str(x.label, 200) ? [{ id: x.id, label: str(x.label, 200)! }] : []).slice(0, 200) : [];
  const known = new Set(items.map(x => x.id)), only = (v: unknown) => ids(v).filter(x => known.has(x));
  const pick = items.length ? { ...(str(p!.label, 20) ? { label: str(p!.label, 20) } : {}), items,
    quick: Array.isArray(p!.quick) ? (p!.quick as Record<string, unknown>[]).flatMap(q => str(q?.label, 30) ? [{ label: str(q.label, 30)!, ids: only(q.ids) }] : []).slice(0, 6) : [], selected: only(p!.selected) } : undefined;
  const rows = Array.isArray(o.rows) ? (o.rows as Record<string, unknown>[]).flatMap(r => {
    const label = str(r?.label, 60);
    if (!label) return [];
    const key = typeof r.key === 'string' && ID.test(r.key) ? r.key : undefined;
    const row: FormRow = { label };
    for (const [k, n] of [['group', 20], ['sub', 80], ['placeholder', 60], ['text', 200], ['src', 30], ['hint', 200]] as const) { const v = str(r[k], n); if (v) row[k] = v; }
    if (key) { row.key = key; row.value = typeof r.value === 'string' ? r.value.slice(0, 500) : ''; }
    const opts = key && Array.isArray(r.options) ? (r.options as Record<string, unknown>[]).flatMap(x => typeof x?.value === 'string' && ID.test(x.value) && str(x.label, 20) ? [{ value: x.value, label: str(x.label, 20)! }] : []).slice(0, 6) : [];
    if (opts.length) { row.options = opts; if (!opts.some(x => x.value === row.value)) row.value = opts[0].value; }
    const w = r.when as Record<string, unknown> | undefined;
    if (typeof w?.key === 'string' && ID.test(w.key) && typeof w.value === 'string') row.when = { key: w.key, value: w.value.slice(0, 40) };
    if (r.tone === 'ok' || r.tone === 'warn') row.tone = r.tone;
    if (Array.isArray(r.for)) row.for = only(r.for);
    return [row];
  }).slice(0, 30) : [];
  const e = o.each as Record<string, unknown> | undefined, num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e6 ? v : undefined;
  const each = e && (num(e.sec) !== undefined || num(e.usd) !== undefined) ? { ...(num(e.sec) !== undefined ? { sec: num(e.sec) } : {}), ...(num(e.usd) !== undefined ? { usd: num(e.usd) } : {}) } : undefined;
  return { ...(pick ? { pick } : {}), rows, ...(str(o.note, 300) ? { note: str(o.note, 300) } : {}), ...(each ? { each } : {}), ...(str(o.start, 20) ? { start: str(o.start, 20) } : {}) };
}

// 화면이 보낸 시작 값 — 고른 id 와 칸 값(글)만, 크기를 자른다. 무엇이 맞는 값인지는 명령이 다시 본다
export function parseStart(b: unknown): { ids: string[]; values: Record<string, string> } {
  const o = (b ?? {}) as { ids?: unknown; values?: unknown };
  const values: Record<string, string> = {};
  if (o.values && typeof o.values === 'object') for (const [k, v] of Object.entries(o.values).slice(0, 50)) {
    if (!ID.test(k) || typeof v !== 'string') continue;
    if (v.length > 500 || v.includes('\0')) throw new Error(`「${k}」 칸 값이 너무 길거나 글이 아니다`);
    values[k] = v.trim();
  }
  return { ids: ids(o.ids), values };
}

// 뒤에서 도는 일 — 산출물(런 · 차례)마다 하나. EDITH 를 다시 켜면 잊는다(돌던 명령은 출력 줄이 끊겨 보통 같이 멈춘다)
export type Job = { label: string; at: number; state: 'running' | 'done' | 'failed' | 'stopped'; progress?: string; ratio?: number; end?: number; code?: number; last?: string };
const jobs = new Map<string, Job & { child?: ChildProcess; stopping?: boolean }>();
const keyOf = (run: number, i: number) => `${run}/${i}`;
export function jobOf(run: number, i: number): Job | undefined {
  const j = jobs.get(keyOf(run, i));
  if (!j) return undefined;
  const { child: _c, stopping: _s, ...v } = j;
  return v;
}
// 출력 한 줄 — {"progress": 글, "ratio"?: 0~1} 이면 진행 줄, 아니면 마지막 줄(실패하면 까닭으로 보인다)
export function readLine(j: Job, line: string) {
  const t = line.trim();
  if (!t) return;
  if (t.startsWith('{')) try {
    const o = JSON.parse(t) as { progress?: unknown; ratio?: unknown };
    if (typeof o.progress === 'string') {
      j.progress = o.progress.slice(0, 120);
      if (typeof o.ratio === 'number' && o.ratio >= 0 && o.ratio <= 1) j.ratio = o.ratio; else delete j.ratio;
      return;
    }
  } catch { /* 진행 줄이 아니다 */ }
  j.last = t.slice(0, 200);
}

const shellOf = (command: string): [string, string[]] => process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', command]] : [process.env.SHELL || '/bin/sh', ['-c', command]];
const base = (dir: string, env: Record<string, string>) => ({ ...process.env, EDITH_ENGINE: dir, EDITH_WORKSHOP: WORKSHOP, ...env });

// 띠 내용 — 명령을 form 으로 30초까지. 실패하면 오류 줄 마지막을 까닭으로
export function formOf(h: { dir: string; action: RunAction }, env: Record<string, string>): Promise<Form> {
  mkdirSync(LOGS, { recursive: true, mode: 0o700 });
  const [cmd, args] = shellOf(h.action.command);
  return new Promise((ok, no) => {
    const child = spawn(cmd, args, { cwd: h.dir, env: base(h.dir, { ...env, EDITH_OUTPUT_MODE: 'form' }), stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
    let out = '', err = '';
    child.stdout.on('data', (d: Buffer) => { out += d; if (out.length > 256 * 1024) child.kill(); });
    child.stderr.on('data', (d: Buffer) => { err = (err + d).slice(-2000); });
    child.on('error', e => no(e));
    child.on('close', code => {
      if (code !== 0) return no(new Error(`「${h.action.label}」 명령이 끝 코드 ${code ?? '없음'} — ${err.trim().split('\n').at(-1) ?? ''}`));
      try { ok(parseForm(out)); } catch (e) { no(e); }
    });
  });
}

// 시작 — 같은 산출물에서 이미 돌면 거절. 출력 · 오류는 output-acts/<런>-<차례>.log 에(덮어 쓴다)
export function startJob(h: { dir: string; action: RunAction }, run: number, i: number, env: Record<string, string>, input: { ids: string[]; values: Record<string, string> }): Job {
  const k = keyOf(run, i);
  if (jobs.get(k)?.state === 'running') throw new Error('이미 도는 중이다');
  mkdirSync(LOGS, { recursive: true, mode: 0o700 });
  const log = createWriteStream(join(LOGS, `${run}-${i}.log`), { mode: 0o600 });
  const [cmd, args] = shellOf(h.action.command);
  const child = spawn(cmd, args, { cwd: h.dir, env: base(h.dir, { ...env, EDITH_OUTPUT_MODE: 'run' }), stdio: ['pipe', 'pipe', 'pipe'], timeout: 3600_000, detached: process.platform !== 'win32' });
  const j: Job & { child?: ChildProcess; stopping?: boolean } = { label: h.action.label, at: Date.now(), state: 'running', child };
  jobs.set(k, j);
  child.stdin.on('error', () => { /* 읽기 전에 끝난 명령 */ });
  child.stdin.end(JSON.stringify(input));
  let rest = '';
  child.stdout.on('data', (d: Buffer) => {
    log.write(d);
    const lines = (rest + d).split('\n');
    rest = lines.pop() ?? '';
    for (const l of lines) readLine(j, l);
  });
  child.stderr.on('data', (d: Buffer) => log.write(d));
  child.on('error', e => { j.last = `띄우지 못했다 — ${e.message}`; });
  child.on('close', code => {
    if (rest) readLine(j, rest);
    log.end();
    j.state = j.stopping ? 'stopped' : code === 0 ? 'done' : 'failed';
    j.code = code ?? 1; j.end = Date.now();
    delete j.child;
  });
  return jobOf(run, i)!;
}

// 멈추기 — 명령과 그 아래 프로세스까지(따로 띄운 묶음째)
export function stopJob(run: number, i: number) {
  const j = jobs.get(keyOf(run, i));
  if (!j?.child || j.state !== 'running') throw new Error('도는 중이 아니다');
  j.stopping = true;
  try { if (process.platform !== 'win32' && j.child.pid) process.kill(-j.child.pid, 'SIGTERM'); else j.child.kill(); } catch { j.child.kill(); }
}

