// 엔진 스케줄 — 공방 엔진 머리의 「스케줄」 줄과 런 화면 「스케줄」 탭이 같이 쓴다(서버 src/schedule.ts · GET /api/schedule)
export type Schedule = { at: string; days: 'mon-fri' | 'daily' };
export type SchedRun = { id: number; state: 'queued' | 'running' | 'check' | 'stopped' | 'done' | 'dropped'; created: number; title?: string; reason?: string };
export type Sched = { id: string; name: string; kind: string; schedule: Schedule; next: number | null; runs: SchedRun[]; error?: string };
export const DAYS: Record<Schedule['days'], string> = { 'mon-fri': '평일', daily: '매일' };

// 「11. 5. (목) 08:40」 — 오늘 · 내일이면 그 말을 앞에
export function nextText(t: number | null, now = new Date()) {
  if (t == null) return '없음';
  const d = new Date(t), days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
  const hm = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${days === 0 ? '오늘 ' : days === 1 ? '내일 ' : ''}${d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short' })} ${hm}`;
}
