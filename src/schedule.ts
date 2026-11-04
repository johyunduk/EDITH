// 엔진 스케줄 — engine.json 의 schedule({ at: "HH:MM", days: "mon-fri" | "daily" })대로 그 엔진 · 체인을 무인 런으로 시작한다. 서버가 1분마다 본다.
// 「그날 잡았다」 는 날짜별 표식 파일(schedule/<엔진>.<YYYY-MM-DD>)을 wx 로 만들어 정한다 — EDITH 가 여럿 떠도 하나만 시작한다. 파일 안은 그 결과(런 번호나 못 시작한 까닭).
// 서버가 꺼져 있다 켜지면 그날 놓친 것을 한 번 돌린다(지난 날 것은 돌리지 않는다). 범위(어디서부터 볼지)는 엔진이 자기 상태로 정한다 — 스케줄러는 모른다.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.ts';
import { listRuns, startRun } from './runner.ts';
import { listEngines, type Schedule } from './workshop.ts';

export const DIR = join(DATA_DIR, 'schedule');
const KEEP_DAYS = 30;
// 날짜 · 시각은 이 기기 시각대로
export const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const onDay = (s: Schedule, d: Date) => s.days === 'daily' || (d.getDay() >= 1 && d.getDay() <= 5);
const atOf = (s: Schedule, d: Date) => { const [h, m] = s.at.split(':').map(Number); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime(); };

// 돌릴지 — 오늘이 그 요일이고, 시각이 지났고, 오늘 아직 잡히지 않았으면
export const due = (s: Schedule, now: Date, claimed: (day: string) => boolean) => onDay(s, now) && now.getTime() >= atOf(s, now) && !claimed(dayOf(now));
// 다음 실행 시각 — 오늘 몫이 남았으면 오늘(시각이 지났으면 다음 확인 때 돈다), 아니면 다음 그 요일
export function nextAt(s: Schedule, now: Date, claimed: (day: string) => boolean) {
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    if (onDay(s, d) && !claimed(dayOf(d))) return atOf(s, d);
  }
  return null;
}

const mark = (id: string, day: string) => join(DIR, `${id}.${day}`);
const claimed = (id: string) => (day: string) => existsSync(mark(id, day));
// 잡기 — 처음 만든 쪽만 참(이미 있으면 다른 EDITH 가 먼저 잡았다)
function claim(id: string, day: string) {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  try { writeFileSync(mark(id, day), '', { flag: 'wx', mode: 0o600 }); return true; } catch { return false; }
}
// 마지막 표식의 글 — 못 시작했으면 「시작 못 함 — …」
function lastNote(id: string) {
  try {
    const f = readdirSync(DIR).filter(n => n.startsWith(`${id}.`)).sort().pop();
    return f ? readFileSync(join(DIR, f), 'utf8') : '';
  } catch { return ''; }
}
// 오래된 표식 지우기 — KEEP_DAYS 넘은 것만
function prune(now: Date) {
  const old = dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - KEEP_DAYS));
  try { for (const f of readdirSync(DIR)) if ((f.match(/\.(\d{4}-\d{2}-\d{2})$/)?.[1] ?? '9') < old) rmSync(join(DIR, f), { force: true }); } catch { /* 아직 없음 */ }
}

// 한 번 보기 — 때가 된 엔진을 잡아서 무인 런으로 시작한다. 작업 폴더는 엔진 설정(늘 같은 폴더)을 쓰고, 동시 런 한도가 차면 startRun 이 줄을 세운다
export async function tick(port: number, now = new Date()) {
  for (const e of listEngines()) {
    const s = e.schedule;
    if (!s || !due(s, now, claimed(e.id)) || !claim(e.id, dayOf(now))) continue;
    try { const { id } = await startRun(e.id, undefined, '', undefined, port, true, undefined, { at: s.at }); writeFileSync(mark(e.id, dayOf(now)), `#${id}`); }
    catch (x) { writeFileSync(mark(e.id, dayOf(now)), `시작 못 함 — ${(x as Error).message}`); }
  }
  prune(now);
}

// 서버가 뜰 때 — 1분마다 본다(곧 한 번 보니 꺼져 있던 동안 놓친 오늘 몫은 바로 돈다). 앞 확인이 안 끝났으면 건너뛴다
export function startSchedule(port: number) {
  let busy = false;
  const go = () => { if (busy) return; busy = true; tick(port).catch(e => console.error(`스케줄 확인 실패 — ${(e as Error).message}`)).finally(() => { busy = false; }); };
  setTimeout(go, 5_000).unref();
  setInterval(go, 60_000).unref();
}

// 화면 — 스케줄이 걸린 엔진마다 다음 시각 · 최근 스케줄 런 10개(최근 것부터) · 못 시작한 까닭
export function scheduleList(now = new Date()) {
  const runs = listRuns();
  return listEngines().flatMap(e => {
    if (!e.schedule) return [];
    const note = lastNote(e.id);
    return [{ id: e.id, name: e.name, kind: e.kind, schedule: e.schedule, next: nextAt(e.schedule, now, claimed(e.id)),
      runs: runs.filter(r => r.engine === e.id && r.scheduled).sort((a, b) => b.id - a.id).slice(0, 10), ...(note.startsWith('시작 못 함') ? { error: note } : {}) }];
  });
}
