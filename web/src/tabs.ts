// 화면 탭(머리줄의 탭 — herdr 의 탭과 다르다) — 탭마다 주소(#/…) 하나, 보는 탭의 주소가 곧 location.hash.
// 그냥 이동(링크 · 사이드 클릭)은 보는 탭을 바꾸고, ⌘클릭 · 「+」 · 알림은 새 탭으로 연다. 같은 화면은 탭 하나만 — 이미 있으면 그 탭으로 간다.
export type Tab = { id: string; hash: string };
export type Tabs = { list: Tab[]; active: string; closed: string[] };

const HOME = '#/herdr', CLOSED_MAX = 10;

// 주소 — #/today, #/herdr/<pane id>, #/skills/<id>, #/workshop/<폴더>, #/runs/<번호>, #/deploy(옛 #/results — 배포가 결과를 품었다), #/settings
export const route = (hash = location.hash) => {
  const h = decode(hash), skill = h.match(/^#\/skills(?:\/(.+))?/), ws = h.match(/^#\/workshop(?:\/(.+))?/), runs = h.match(/^#\/runs(?:\/(.+))?/);
  if (h.startsWith('#/settings')) return { view: 'settings' as const, id: h.match(/^#\/settings\/engine\/(.+)/)?.[1] };   // 엔진 설정 표(EngineSettings.tsx)
  if (h.startsWith('#/deploy') || h.startsWith('#/results')) return { view: 'deploy' as const, id: undefined };
  if (h.startsWith('#/today')) return { view: 'today' as const, id: undefined };
  if (ws) return { view: 'workshop' as const, id: ws[1] };
  if (runs) return { view: 'runs' as const, id: runs[1] };
  return skill ? { view: 'skills' as const, id: skill[1] } : { view: 'herdr' as const, id: h.match(/^#\/herdr\/(.+)/)?.[1] };
};

function decode(h: string) {
  try { return decodeURIComponent(h); } catch { return h; }   // 깨진 % 는 그대로
}

// 탭에 적어 두는 주소 — 한 번 쓰는 ?run= · ?test= 는 뗀다(다시 그 탭으로 와도 새 런 창이 또 열리지 않게)
export const clean = (hash: string) => {
  const h = decode(hash.replace(/\?.*$/, ''));
  return h.startsWith('#/') && h.length > 2 ? h : HOME;
};

// 같은 화면인지 가르는 열쇠 — pane · 런 · 엔진 하나가 화면 하나. 런 산출물 창(#/runs/12/out/3)은 그 런 화면으로 친다
export function tabKey(hash: string) {
  const h = clean(hash);
  if (h.startsWith('#/results')) return 'deploy';
  const m = h.match(/^#\/(\w+)(?:\/(schedule\/[^/]+|engine\/[^/]+|[^/]+))?/);
  return !m ? 'herdr' : m[2] ? `${m[1]}:${m[2]}` : m[1];
}

const newId = () => Math.random().toString(36).slice(2, 10);
export const current = (s: Tabs) => s.list.find(t => t.id === s.active) ?? s.list[0];
const withHash = (s: Tabs, id: string, hash: string) => s.list.map(t => t.id === id ? { ...t, hash } : t);

// 그냥 이동 — 같은 화면이 다른 탭에 있으면 그 탭으로, 없으면 보는 탭의 주소를 바꾼다
export function navigate(s: Tabs, hash: string): Tabs {
  const h = clean(hash), cur = current(s), other = s.list.find(t => t.id !== cur.id && tabKey(t.hash) === tabKey(h));
  if (other) return { ...s, active: other.id, list: withHash(s, other.id, h) };
  return cur.hash === h ? s : { ...s, list: withHash(s, cur.id, h) };
}

// 새 탭으로 — 같은 화면이 이미 있으면 그 탭으로 간다. 새 탭은 맨 뒤에 붙는다
export function open(s: Tabs, hash: string): Tabs {
  const h = clean(hash), k = tabKey(h), have = s.list.find(t => tabKey(t.hash) === k);
  const closed = s.closed.filter(c => tabKey(c) !== k);
  if (have) return { ...s, closed, active: have.id, list: withHash(s, have.id, h) };
  const t = { id: newId(), hash: h };
  return { list: [...s.list, t], active: t.id, closed };
}

// 닫기 — 탭만 닫힌다(pane · 런은 그대로 돈다). 마지막 하나는 닫지 않는다. 보던 탭을 닫으면 오른쪽(없으면 왼쪽) 탭으로
export function close(s: Tabs, id: string): Tabs {
  const i = s.list.findIndex(t => t.id === id);
  if (i < 0 || s.list.length === 1) return s;
  const gone = s.list[i].hash, list = s.list.filter(t => t.id !== id);
  const closed = [gone, ...s.closed.filter(c => tabKey(c) !== tabKey(gone))].slice(0, CLOSED_MAX);
  return { list, closed, active: s.active === id ? list[Math.min(i, list.length - 1)].id : s.active };
}

// 끌어 놓기 — id 탭을 to 자리로(to 는 옮기기 전 차례 기준, 0 = 맨 앞, 길이 = 맨 뒤)
export function move(s: Tabs, id: string, to: number): Tabs {
  const i = s.list.findIndex(t => t.id === id);
  if (i < 0 || to === i || to === i + 1) return s;
  const list = s.list.filter(t => t.id !== id);
  list.splice(Math.max(0, Math.min(to > i ? to - 1 : to, list.length)), 0, s.list[i]);
  return { ...s, list };
}

// 저장해 둔 탭 되살리기 — 주소창 주소(새로 고침 · 북마크)가 우선: 그 화면 탭이 있으면 그 탭, 없으면 새 탭. 주소가 없으면 보던 탭
export function restore(saved: unknown, hash: string): Tabs {
  const v = (saved && typeof saved === 'object' ? saved : {}) as { list?: unknown; active?: unknown; closed?: unknown };
  const list = (Array.isArray(v.list) ? v.list : [])
    .filter((t): t is Tab => typeof t?.id === 'string' && typeof t?.hash === 'string').map(t => ({ id: t.id, hash: clean(t.hash) }));
  const closed = (Array.isArray(v.closed) ? v.closed : []).filter((c): c is string => typeof c === 'string').map(clean).slice(0, CLOSED_MAX);
  const given = hash.length > 2;
  if (!list.length) { const t = { id: newId(), hash: clean(hash) }; return { list: [t], active: t.id, closed }; }
  const s = { list, closed, active: list.some(t => t.id === v.active) ? v.active as string : list[0].id };
  return given ? open(s, hash) : s;
}
