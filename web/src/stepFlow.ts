// 펼친 캔버스(공방 「펼쳐 보기」 · 런 화면)의 자리 — 런이 펼친 노드 한 줄(runner.ts flatten)을 상자 · 노드 · 화살표 자리로.
// 체인 상자 안 노드는 왼쪽→오른쪽, 엔진 상자 안의 체인 · 엔진은 위→아래, 맨 위 엔진의 큰 단계는 옆으로. 고치는 노드는 고칠 노드 아래.
// 접은 상자는 이름 카드 하나가 되고, 안쪽으로 오가는 화살표는 그 카드에 잇는다. 손으로 그린 자리는 쓰지 않는다(런 기록엔 자리가 없다).
// React 없이 — src/stepFlow.test.ts 가 확인한다.
export type FlowStep = {
  key: string; title: string; lane: string; group: string; kind: 'skill' | 'command'; engine?: string;
  deps: string[]; failTo?: string; fixOnly?: boolean; boxes?: { name: string; kind: 'chain' | 'engine' }[]; track?: string;
};
export type Box = { key: string; name: string; kind: 'chain' | 'engine'; parent: string | null; steps: string[] };
export type Placed = Box & { x: number; y: number; w: number; h: number; fold: boolean };
export type Laid = { w: number; h: number; boxes: Placed[]; nodes: { key: string; x: number; y: number }[]; edges: { a: string; b: string; d: string; fail?: boolean }[] };

export const NW = 164, NH = 40;
const GX = 24, GY = 12, PAD = 12, HEAD = 26, CW = 196, CH = 50;

// 상자 — 묶음 앞붙이(n1.n2.)마다 하나, steps 는 안에 든 (고치는 노드가 아닌) 노드. 옛 런(boxes 없음)은 맨 안쪽 묶음만.
export function boxesOf(steps: FlowStep[]): Map<string, Box> {
  const m = new Map<string, Box>();
  for (const s of steps) {
    if (s.group === '.') continue;
    const parts = s.group.split('.').slice(0, -1);
    const keys = s.boxes?.length === parts.length ? parts.map((_, i) => `${parts.slice(0, i + 1).join('.')}.`) : [s.group];
    keys.forEach((k, i) => {
      const b = s.boxes?.length === parts.length ? s.boxes[i] : { name: s.lane, kind: 'chain' as const };
      if (!m.has(k)) m.set(k, { key: k, name: b.name, kind: b.kind, parent: i ? keys[i - 1] : null, steps: [] });
      if (!s.fixOnly) m.get(k)!.steps.push(s.key);
    });
  }
  return m;
}

// 이 노드가 든 상자(안쪽부터)
export const ancestors = (boxes: Map<string, Box>, group: string) => {
  const out: string[] = [];
  for (let g: string | null = group; g && g !== '.'; g = boxes.get(g)?.parent ?? null) out.push(g);
  return out;
};

type Item = { t: 'S'; key: string; fx: string[]; w: number; h: number; x?: number; y?: number }
  | { t: 'B' | 'R'; key: string; dir: 'row' | 'col'; kids: Item[]; gap: number; w: number; h: number; fold?: boolean; x?: number; y?: number };

export function layout(steps: FlowStep[], boxes: Map<string, Box>, folded: (box: string) => boolean): Laid {
  const by = new Map(steps.map(s => [s.key, s])), live = steps.filter(s => !s.fixOnly), fixes = new Map<string, string[]>();
  // 고치는 노드는 처음 부르는 노드 아래 한 번만 — 여럿이 같은 것을 부르면 나머지는 실패 화살표만(두 번 놓으면 화면 키가 겹쳐 접어도 남는다)
  const placed = new Set<string>();
  for (const s of steps) if (s.failTo && !placed.has(s.failTo)) { placed.add(s.failTo); fixes.set(s.key, [s.failTo]); }
  // 도는 차례대로 — 노드는 자기 묶음에, 묶음은 처음 나올 때 부모에
  const kids = new Map<string, string[]>();
  const add = (p: string, k: string) => { const l = kids.get(p) ?? []; if (!l.includes(k)) l.push(k); kids.set(p, l); };
  for (const s of live) {
    add(s.group, `S:${s.key}`);
    for (let c = s.group; c !== '.';) { const p = boxes.get(c)?.parent ?? '.'; add(p, `B:${c}`); c = p; }
  }
  const size = (n: Extract<Item, { kids: Item[] }>) => {
    const row = n.dir === 'row', ws = n.kids.map(c => c.w), hs = n.kids.map(c => c.h), gaps = n.gap * (n.kids.length - 1);
    n.w = row ? ws.reduce((a, b) => a + b, 0) + gaps : Math.max(0, ...ws);
    n.h = row ? Math.max(0, ...hs) : hs.reduce((a, b) => a + b, 0) + gaps;
  };
  const build = (id: string, depth: number): Item => {
    const key = id.slice(2);
    if (id[0] === 'S') { const fx = fixes.get(key) ?? []; return { t: 'S', key, fx, w: Math.max(NW, fx.length * (NW + GX) - GX), h: fx.length ? NH * 2 + GY + 6 : NH }; }
    if (key !== '.' && folded(key)) return { t: 'B', key, dir: 'row', kids: [], gap: 0, w: CW, h: CH, fold: true };
    const chain = key !== '.' && boxes.get(key)?.kind === 'chain', dir = chain || depth === 0 ? 'row' : 'col';
    const list: Item[] = [];
    for (const c of kids.get(key) ?? []) {
      const n = build(c, depth + 1), last = list.at(-1);
      // 엔진 상자 안에 바로 놓인 노드는 이어진 것끼리 한 줄로
      if (dir === 'col' && n.t === 'S') { if (last?.t === 'R') last.kids.push(n); else list.push({ t: 'R', key: n.key, dir: 'row', kids: [n], gap: GX, w: 0, h: 0 }); continue; }
      list.push(n);
    }
    for (const r of list) if (r.t === 'R') size(r);
    const n: Item = { t: 'B', key, dir, kids: list, gap: dir === 'row' ? (chain ? GX : GX + 18) : GY + 12, w: 0, h: 0 };
    size(n);
    if (key !== '.') { n.w += PAD * 2; n.h += HEAD + PAD; }
    return n;
  };
  const out: Laid = { w: 0, h: 0, boxes: [], nodes: [], edges: [] };
  const place = (n: Item, x: number, y: number) => {
    n.x = x; n.y = y;
    if (n.t === 'S') { out.nodes.push({ key: n.key, x, y }); n.fx.forEach((f, i) => out.nodes.push({ key: f, x: x + i * (NW + GX), y: y + NH + GY + 6 })); return; }
    const framed = n.t === 'B' && n.key !== '.';
    if (framed) out.boxes.push({ ...boxes.get(n.key)!, x, y, w: n.w, h: n.h, fold: !!n.fold });
    let cx = x + (framed ? PAD : 0), cy = y + (framed ? HEAD : 0);
    for (const c of n.kids) { place(c, cx, cy); if (n.dir === 'row') cx += c.w + n.gap; else cy += c.h + n.gap; }
  };
  const root = build('B:.', 0);
  place(root, 0, 0);
  out.w = root.w; out.h = root.h;
  // 화살표 — 끝이 접힌 상자 안이면 그 카드로, 같은 카드 안끼리는 그리지 않는다
  const rect = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const n of out.nodes) rect.set(`S:${n.key}`, { x: n.x, y: n.y, w: NW, h: NH });
  for (const b of out.boxes) if (b.fold) rect.set(`B:${b.key}`, b);
  const rep = (k: string) => { const a = ancestors(boxes, by.get(k)!.group); for (let i = a.length - 1; i >= 0; i--) if (folded(a[i])) return `B:${a[i]}`; return `S:${k}`; };
  const seen = new Set<string>();
  for (const s of live) for (const d of s.deps) {
    const a = rep(d), b = rep(s.key), ra = rect.get(a), rb = rect.get(b);
    if (a === b || seen.has(`${a}>${b}`) || !ra || !rb) continue;
    seen.add(`${a}>${b}`);
    out.edges.push({ a, b, d: curve(ra, rb) });
  }
  for (const s of steps) if (s.failTo) {
    const ra = rect.get(`S:${s.key}`), rb = rect.get(`S:${s.failTo}`);
    if (ra && rb) out.edges.push({ a: `S:${s.key}`, b: `S:${s.failTo}`, fail: true, d: `M${ra.x + 28},${ra.y + NH} C${ra.x + 28},${ra.y + NH + 10} ${rb.x + 28},${rb.y - 10} ${rb.x + 28},${rb.y}` });
  }
  return out;
}

// 오른쪽에 있으면 옆으로, 아래에 있으면 밑에서 위로, 그 밖(위 · 왼쪽)은 옆으로 크게 돈다
function curve(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  const ax = a.x + a.w, ay = a.y + a.h / 2, by = b.y + b.h / 2;
  if (b.x >= ax - 2) { const c = Math.max(24, (b.x - ax) / 2); return `M${ax},${ay} C${ax + c},${ay} ${b.x - c},${by} ${b.x},${by}`; }
  const sx = a.x + a.w / 2, sy = a.y + a.h, ex = b.x + b.w / 2;
  if (b.y >= sy) { const c = Math.max(20, (b.y - sy) / 2); return `M${sx},${sy} C${sx},${sy + c} ${ex},${b.y - c} ${ex},${b.y}`; }
  return `M${ax},${ay} C${ax + 80},${ay} ${b.x - 80},${by} ${b.x},${by}`;
}
