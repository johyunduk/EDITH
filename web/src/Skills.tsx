// 스킬 — Claude·Codex 스킬·명령 목록과 서로 부르는 관계(서버 skills.ts, 읽기만). 주소는 #/skills, #/skills/<id>.
// 왼쪽 목록(찾기·범위), 오른쪽은 고른 스킬의 설명·관계 그림(부르는 곳 → 이 스킬 → 부르는 것)·md 본문.
// 고른 게 없으면 전체 관계도. #/skills/@move 는 옮기기(내보내기·가져오기).
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from './api.ts';
import { base64 } from './Attach.tsx';
import { copyText, toast } from './copy.ts';
import { Md } from './ui.tsx';
import claudeIcon from './icons/claude.svg';
import codexIcon from './icons/codex.svg';

type Use = { id: string; how: string };
type Skill = { id: string; name: string; call: string; agents: ('claude' | 'codex')[]; source: string; kind: 'skill' | 'command' | 'prompt'; desc: string; path: string; files: string[]; uses: Use[]; origin?: string };

const SOURCE: Record<string, [string, string]> = {
  shared: ['공유', 'bg-teal-500/12 text-teal-700 dark:text-teal-300'], user: ['내 것', 'bg-primary/10 text-primary'],
  system: ['Codex 기본', 'bg-muted text-muted-foreground'], plugin: ['플러그인', 'bg-muted text-muted-foreground'],
};
const KIND: Record<Skill['kind'], string> = { skill: '스킬', command: '명령', prompt: '프롬프트' };
const HOW: Record<string, string> = { '$': '$이름으로 부름', '/': '/이름으로 부름', '경로': '스킬 경로로 읽음', '`': '이름을 짚음', '언급': '「…스킬」 로 언급' };
const src = (s: Skill) => s.source.split(':')[0];
const go = (id?: string) => { location.hash = id ? `#/skills/${encodeURIComponent(id)}` : '#/skills'; };

function Agents({ s, size = 'size-3.5' }: { s: Skill; size?: string }) {
  return <span className="flex shrink-0 items-center gap-0.5">{s.agents.map(a => <img key={a} src={a === 'claude' ? claudeIcon : codexIcon} alt={a} className={size} />)}</span>;
}
function Badge({ s }: { s: Skill }) {
  const [label, tone] = SOURCE[src(s)] ?? SOURCE.user;
  return <span className={`shrink-0 rounded px-1.5 text-[0.65625rem] leading-4 font-semibold ${tone}`}>{src(s) === 'plugin' ? s.source.slice(7) : label}</span>;
}

type Scope = 'mine' | 'all' | 'plugin' | 'system';
const SCOPES: [Scope, string][] = [['mine', '내 것·공유'], ['plugin', '플러그인'], ['system', 'Codex 기본'], ['all', '전체']];
const inScope = (s: Skill, k: Scope) => k === 'all' || (k === 'mine' ? ['user', 'shared'].includes(src(s)) : src(s) === k);

export function SkillsPage({ id, side }: { id?: string; side: boolean }) {
  const { data, error } = useQuery({ queryKey: ['skills'], queryFn: () => get<Skill[]>('/api/skills') });
  const [q, setQ] = useState(''), [scope, setScope] = useState<Scope>('mine');
  const by = useMemo(() => new Map((data ?? []).map(s => [s.id, s])), [data]);
  const usedBy = useMemo(() => {
    const m = new Map<string, Use[]>();
    for (const s of data ?? []) for (const u of s.uses) m.set(u.id, [...(m.get(u.id) ?? []), { id: s.id, how: u.how }]);
    return m;
  }, [data]);
  if (error && !data) return <p className="p-4 text-sm text-destructive">{String(error)}</p>;
  if (!data) return <p className="p-4 text-sm text-muted-foreground">불러오는 중…</p>;
  const sel = id ? by.get(id) : undefined, moving = id === '@move';
  const shown = data.filter(s => inScope(s, scope) && (!q || `${s.name} ${s.desc}`.toLowerCase().includes(q.toLowerCase())));
  const groups: [string, Skill[]][] = [['Claude', shown.filter(s => src(s) === 'user' && s.agents.includes('claude'))],
    ['공유 (Claude·Codex)', shown.filter(s => src(s) === 'shared')],
    ['Codex', shown.filter(s => (src(s) === 'user' || src(s) === 'system') && s.agents.includes('codex') && !s.agents.includes('claude'))], ['플러그인', shown.filter(s => src(s) === 'plugin')]];
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside className={`max-h-72 shrink-0 overflow-y-auto border-b bg-sidebar p-1.5 md:max-h-none md:w-80 md:border-r md:border-b-0 ${side ? '' : 'hidden'}`}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="이름·설명으로 찾기"
          className="mb-1.5 w-full rounded-md border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/50" />
        <div className="mb-1.5 flex flex-wrap gap-0.5 rounded-lg bg-muted p-0.5">
          {SCOPES.map(([k, label]) => (
            <button key={k} onClick={() => setScope(k)} className={`flex-1 rounded-md px-1.5 py-1 text-xs whitespace-nowrap ${scope === k ? 'bg-card font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>
          ))}
        </div>
        <button onClick={() => go('@graph')} className={`mb-1 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[0.8125rem] font-medium ${!sel && !moving ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/70'}`}>
          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="6" r="2.5" /><circle cx="19" cy="6" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M7 7.5 10.5 16M17 7.5 13.5 16M7.5 6h9" /></svg>전체 관계도
        </button>
        <button onClick={() => go('@move')} className={`mb-1 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[0.8125rem] font-medium ${moving ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/70'}`}>
          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m8 11 4 4 4-4" /><path d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4" /></svg>옮기기 — 내보내기·가져오기
        </button>
        {groups.filter(([, l]) => l.length).map(([title, l]) => (
          <div key={title} className="pb-1.5">
            <div className="px-2.5 pt-1.5 pb-0.5 text-[0.65625rem] font-semibold text-muted-foreground/70">{title} · {l.length}</div>
            {l.map(s => (
              <a key={s.id} href={`#/skills/${encodeURIComponent(s.id)}`} title={s.desc}
                className={`flex items-center gap-2 rounded-md border-l-2 px-2 py-1.5 ${s.id === sel?.id ? 'border-primary bg-accent text-accent-foreground' : 'border-transparent hover:bg-muted/70'}`}>
                <Agents s={s} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[0.78125rem] font-medium">{s.name}{s.kind !== 'skill' && <span className="ml-1 font-sans text-[0.625rem] text-muted-foreground">{KIND[s.kind]}</span>}</span>
                  {s.desc && <span className="block truncate text-[0.6875rem] text-muted-foreground">{s.desc}</span>}
                </span>
                {(s.uses.length > 0 || (usedBy.get(s.id)?.length ?? 0) > 0) && (
                  <span className="shrink-0 font-mono text-[0.625rem] text-muted-foreground tabular-nums" title="부르는 것 → · ← 부르는 곳">{s.uses.length}→ ←{usedBy.get(s.id)?.length ?? 0}</span>
                )}
              </a>
            ))}
          </div>
        ))}
        {!shown.length && <p className="p-3 text-sm text-muted-foreground">찾는 스킬이 없다</p>}
      </aside>
      <main className="min-w-0 flex-1 overflow-auto p-4">
        {moving ? <Move all={data} /> : sel ? <Detail s={sel} by={by} usedBy={usedBy.get(sel.id) ?? []} /> : <Overview all={data} scope={scope} />}
      </main>
    </div>
  );
}

// 관계 그림 — 열마다 상자를 세로로 쌓고 선을 긋는다. 앞 열 → 뒤 열은 오른쪽에서 왼쪽으로, 뒤 → 앞은 왼쪽으로 돌아가고,
// 같은 열끼리는 오른쪽으로 둥글게. 서로 부르면 선 하나에 양쪽 화살표. 상자에 마우스를 올리면 그 선만 진하게, 누르면 그 스킬로.
type Edge = { a: string; b: string; how: string; both?: boolean };
const W = 200, BH = 34, GX = 110, GY = 12;
function Graph({ cols, edges, focus }: { cols: Skill[][]; edges: Edge[]; focus?: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const pos = new Map<string, { x: number; y: number; col: number; row: number }>();
  const tall = Math.max(...cols.map(c => c.length), 1) * (BH + GY);
  cols.forEach((c, i) => c.forEach((s, j) => pos.set(s.id, { x: i * (W + GX), y: (tall - c.length * (BH + GY)) / 2 + j * (BH + GY), col: i, row: j })));
  const width = cols.length * W + (cols.length - 1) * GX + 60;
  const lit = (e: Edge) => hover === e.a || hover === e.b;
  const path = (p: { x: number; y: number; col: number; row: number }, q: typeof p) => {
    const y1 = p.y + BH / 2, y2 = q.y + BH / 2;
    if (p.col < q.col) { const x1 = p.x + W, x2 = q.x, m = (x1 + x2) / 2; return `M${x1},${y1} C${m},${y1} ${m},${y2} ${x2},${y2}`; }
    if (p.col > q.col) { const x1 = p.x, x2 = q.x + W, m = (x1 + x2) / 2; return `M${x1},${y1} C${m},${y1} ${m},${y2} ${x2},${y2}`; }
    const x = p.x + W, off = 24 + 10 * Math.abs(p.row - q.row);
    return `M${x},${y1} C${x + off},${y1} ${x + off},${y2} ${x},${y2}`;
  };
  return (
    // 자리가 모자라면 그만큼만 줄여 맞추고(늘리지는 않는다) 가운데에
    <svg viewBox={`-4 -4 ${width + 8} ${tall + 8}`} style={{ maxWidth: width + 8 }} className="mx-auto block h-auto w-full">
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="fill-muted-foreground/70" /></marker>
        <marker id="arr-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="fill-primary" /></marker>
      </defs>
      {[...edges].sort((x, y) => Number(lit(x)) - Number(lit(y))).map(e => {
        const p = pos.get(e.a), q = pos.get(e.b);
        if (!p || !q) return null;
        const on = lit(e), m = on ? 'url(#arr-on)' : 'url(#arr)';
        return <path key={`${e.a}>${e.b}`} d={path(p, q)} fill="none" strokeWidth={on ? 2.2 : 1.3} markerEnd={m} markerStart={e.both ? m : undefined}
          className={on ? 'stroke-primary' : e.how === '$' ? 'stroke-indigo-400/70' : 'stroke-muted-foreground/40'} />;
      })}
      {cols.flat().map(s => {
        const p = pos.get(s.id)!, on = s.id === focus || s.id === hover;
        const tone = src(s) === 'shared' ? 'stroke-teal-500/70' : src(s) === 'plugin' || src(s) === 'system' ? 'stroke-muted-foreground/40' : s.agents.includes('codex') ? 'stroke-indigo-400/80' : 'stroke-orange-400/80';
        return (
          <g key={s.id} transform={`translate(${p.x},${p.y})`} className="cursor-pointer" onClick={() => go(s.id)}
            onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)}>
            <title>{`${s.call}${s.desc ? `\n${s.desc}` : ''}`}</title>
            <rect width={W} height={BH} rx={8} className={on ? 'fill-accent stroke-primary' : `fill-card ${tone}`} strokeWidth={on ? 2 : 1.3} />
            {s.agents.map((a, k) => <image key={a} href={a === 'claude' ? claudeIcon : codexIcon} x={8 + k * 15} y={BH / 2 - 7} width={14} height={14} />)}
            <text x={12 + s.agents.length * 15} y={BH / 2 + 4} className="fill-foreground font-mono text-[12px]">{s.name.length > 23 ? `${s.name.slice(0, 22)}…` : s.name}</text>
          </g>
        );
      })}
    </svg>
  );
}

// 부름 목록 → 선. 서로 부르면 하나로 합쳐 양쪽 화살표.
function toEdges(pairs: [string, string, string][]) {
  const key = (a: string, b: string) => `${a}>${b}`, has = new Set(pairs.map(([a, b]) => key(a, b))), out: Edge[] = [];
  for (const [a, b, how] of pairs) {
    if (has.has(key(b, a))) { if (a < b) out.push({ a, b, how, both: true }); } else out.push({ a, b, how });
  }
  return out;
}

// 전체 관계도 — 관계가 있는 것만 네 열로: 부르기만 하는 것 · 많이 부르는 것 · 많이 불리는 것 · 불리기만 하는 것.
function Overview({ all, scope }: { all: Skill[]; scope: Scope }) {
  const nodes = all.filter(s => inScope(s, scope));
  const ids = new Set(nodes.map(s => s.id));
  const pairs = nodes.flatMap(s => s.uses.filter(u => ids.has(u.id)).map(u => [s.id, u.id, u.how] as [string, string, string]));
  const out = (id: string) => pairs.filter(([a]) => a === id).length, inn = (id: string) => pairs.filter(([, b]) => b === id).length;
  const linked = nodes.filter(s => out(s.id) + inn(s.id) > 0);
  const name = (a: Skill, b: Skill) => a.name.localeCompare(b.name);
  const cols = [
    linked.filter(s => !inn(s.id)), linked.filter(s => inn(s.id) && out(s.id) && out(s.id) >= inn(s.id)),
    linked.filter(s => inn(s.id) && out(s.id) && out(s.id) < inn(s.id)), linked.filter(s => !out(s.id)),
  ].map(c => c.sort(name)).filter(c => c.length);
  const alone = nodes.filter(s => !out(s.id) && !inn(s.id));
  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-bold tracking-tight">스킬 관계도</h1>
        <span className="text-sm text-muted-foreground">스킬 {nodes.length} · 관계 {pairs.length}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        왼쪽부터 부르기만 하는 것 → 많이 부르는 것 → 많이 불리는 것 → 불리기만 하는 것. 화살표가 부르는 방향, 양쪽 화살표는 서로 부름. 상자를 누르면 자세히.
        관계는 스킬 md 글에서 다른 스킬을 부르는 꼴(/이름 · $이름 · skills/이름 · `이름` · 「이름 스킬」)을 찾은 어림이다.
      </p>
      {cols.length ? <div className="overflow-x-auto rounded-xl border bg-card p-4"><Graph cols={cols} edges={toEdges(pairs)} /></div> : <p className="text-sm text-muted-foreground">이 범위에는 서로 부르는 스킬이 없다</p>}
      {alone.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-semibold text-muted-foreground">관계가 없는 것 · {alone.length}</div>
          <div className="flex flex-wrap gap-1.5">
            {alone.map(s => <a key={s.id} href={`#/skills/${encodeURIComponent(s.id)}`} className="flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 font-mono text-xs hover:bg-muted"><Agents s={s} size="size-3" />{s.name}</a>)}
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ s, by, usedBy }: { s: Skill; by: Map<string, Skill>; usedBy: Use[] }) {
  const [file, setFile] = useState(s.files[0]);
  const cur = s.files.includes(file) ? file : s.files[0];
  const body = useQuery({ queryKey: ['skill-file', s.id, cur], queryFn: () => get<string>(`/api/skills/file?id=${encodeURIComponent(s.id)}&file=${encodeURIComponent(cur)}`, 'text') });
  const uses = s.uses.map(u => [by.get(u.id), u.how] as const).filter((x): x is readonly [Skill, string] => !!x[0]);
  const callers = usedBy.map(u => [by.get(u.id), u.how] as const).filter((x): x is readonly [Skill, string] => !!x[0]);
  // 그림: 부르기만 하는 곳은 왼쪽, 부르는 것(서로 부르는 것 포함)은 오른쪽 — 서로 부르면 양쪽 화살표 하나
  const both = new Set(uses.map(([c]) => c.id).filter(x => callers.some(([c]) => c.id === x)));
  const edges: Edge[] = [...callers.filter(([c]) => !both.has(c.id)).map(([c, how]) => ({ a: c.id, b: s.id, how })), ...uses.map(([c, how]) => ({ a: s.id, b: c.id, how, both: both.has(c.id) }))];
  const list = (title: string, l: readonly (readonly [Skill, string])[]) => (
    <div className="min-w-0 flex-1 rounded-xl border bg-card p-3">
      <div className="mb-1.5 text-xs font-semibold text-muted-foreground">{title} · {l.length}</div>
      {!l.length && <p className="text-xs text-muted-foreground/70">없음</p>}
      {l.map(([x, how]) => (
        <a key={x.id} href={`#/skills/${encodeURIComponent(x.id)}`} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted">
          <Agents s={x} size="size-3" /><span className="truncate font-mono text-[0.78125rem]">{x.name}</span>
          <span className="ml-auto shrink-0 text-[0.65625rem] text-muted-foreground">{HOW[how] ?? how}</span>
        </a>
      ))}
    </div>
  );
  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Agents s={s} size="size-5" />
          <h1 className="font-mono text-xl font-bold tracking-tight">{s.name}</h1>
          <Badge s={s} />
          {s.kind !== 'skill' && <span className="rounded bg-muted px-1.5 text-[0.65625rem] leading-4 text-muted-foreground">{KIND[s.kind]}</span>}
          <button onClick={() => void copyText(s.call)} title="부르는 꼴 복사" className="rounded-md border bg-card px-2 py-0.5 font-mono text-xs hover:bg-muted">{s.call}</button>
        </div>
        {s.desc && <p className="mt-1.5 text-sm text-foreground/80">{s.desc}</p>}
        <button onClick={() => void copyText(s.path)} title="경로 복사" className="mt-1 font-mono text-xs text-muted-foreground hover:text-foreground">{s.path.replace(/^\/(Users|home)\/[^/]+/, '~')}</button>
      </div>
      {edges.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-card p-4">
          <Graph cols={[callers.filter(([c]) => !both.has(c.id)).map(([c]) => c), [s], uses.map(([c]) => c)].filter(c => c.length)} edges={edges} focus={s.id} />
        </div>
      )}
      <div className="flex flex-col gap-3 md:flex-row">{list('이 스킬을 부르는 곳', callers)}{list('이 스킬이 부르는 것', uses)}</div>
      <div className="rounded-xl border bg-card">
        <div className="flex flex-wrap gap-1 border-b px-3 py-2">
          {s.files.map(f => <button key={f} onClick={() => setFile(f)} className={`rounded-md px-2 py-0.5 font-mono text-xs ${f === cur ? 'bg-accent font-semibold text-accent-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{f}</button>)}
        </div>
        <div className="px-4 py-3">{body.data ? <Md text={body.data.replace(/^---\n[\s\S]*?\n---\n/, '')} /> : <p className="text-sm text-muted-foreground">{body.error ? String(body.error) : '불러오는 중…'}</p>}</div>
      </div>
    </div>
  );
}

// 옮기기 — 내 것·공유 스킬(명령·Codex 프롬프트 포함)을 묶음 파일로 내려받고, 다른 기기에서 받은 묶음은 미리 본 뒤 고른 대로 넣는다(서버 skillsMove.ts).
// 공개 스킬(npx skills 로 깐 것)과 고른 스킬이 부르는 플러그인은 파일 대신 설치 명령으로 담고, 가져올 때 고르면 EDITH 가 설치한다.
// 내려받기는 다른 기기의 EDITH 를 터널로 열어 볼 때만(/api/view remote) — 이 기기 스킬은 이미 여기 있다.
// 이미 있는 스킬은 건너뛰고, 「덮어쓰기」 를 고른 것만 지우고 새로 쓴다.
type Preview = {
  at: string; units: { unit: string; link: boolean; files: number; exists: boolean }[];
  sources: { name: string; source: string; have: boolean }[]; plugins: { id: string; add: string | null; need: string[]; have: boolean }[];
};
type Done = { added: string[]; replaced: string[]; skipped: string[]; installed: { what: string; ok: boolean; msg: string }[] };
const pluginOf = (s: Skill) => s.source.startsWith('plugin:') ? s.source.slice(7) : null;
function Move({ all }: { all: Skill[] }) {
  const mine = all.filter(s => ['user', 'shared'].includes(src(s))), by = new Map(all.map(s => [s.id, s]));
  const [pick, setPick] = useState(() => new Set(mine.map(s => s.id))), [plugins, setPlugins] = useState(false), [busy, setBusy] = useState(false);
  const [data, setData] = useState<string | null>(null), [pre, setPre] = useState<Preview | null>(null), [done, setDone] = useState<Done | null>(null);
  const [over, setOver] = useState(new Set<string>()), [inst, setInst] = useState(new Set<string>());
  const qc = useQueryClient();
  const { data: view } = useQuery({ queryKey: ['view'], queryFn: () => get<{ remote: boolean; host: string }>('/api/view'), staleTime: Infinity });
  const remote = !!view?.remote;
  const toggle = (set: Set<string>, k: string) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); return n; };
  const card = 'rounded-xl border bg-card p-4 space-y-3';
  const btn = 'rounded-md border bg-card px-2.5 py-1 text-sm hover:bg-muted disabled:opacity-50';

  // 고른 스킬이 부르는 것 — 플러그인(설치 명령으로 같이 담긴다)과, 고르지 않은 내 스킬(빠지면 그 기기에서 못 부른다)
  const picked = mine.filter(s => pick.has(s.id)), deps = picked.flatMap(s => s.uses.map(u => [s, by.get(u.id)] as const)).filter((x): x is readonly [Skill, Skill] => !!x[1]);
  const needPlugins = new Map<string, Set<string>>(), missing = new Map<string, Set<string>>();
  for (const [s, d] of deps) {
    const pl = pluginOf(d);
    if (pl) needPlugins.set(pl, (needPlugins.get(pl) ?? new Set()).add(s.name));
    else if (['user', 'shared'].includes(src(d)) && !pick.has(d.id)) missing.set(d.id, (missing.get(d.id) ?? new Set()).add(s.name));
  }

  const download = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/skills/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [...pick], plugins }) });
      if (!r.ok) throw new Error(await r.text());
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await r.blob()), download: r.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] ?? 'edith-skills.json.gz' });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e) { toast(`내보내지 못했다 — ${(e as Error).message}`, 5000); } finally { setBusy(false); }
  };
  const load = async (f?: File) => {
    if (!f) return;
    setPre(null); setDone(null); setOver(new Set());
    try {
      const d = await base64(f), p = await post<Preview>('/api/skills/import', { data: d });
      setPre(p); setData(d);
      setInst(new Set([...p.sources.filter(x => !x.have).map(x => `s:${x.name}`), ...p.plugins.filter(x => !x.have).map(x => `p:${x.id}`)]));
    } catch (e) { toast(`읽지 못했다 — ${(e as Error).message}`, 5000); }
  };
  const run = async () => {
    setBusy(true);
    const ids = (k: string) => [...inst].filter(x => x.startsWith(k)).map(x => x.slice(2));
    try {
      setDone(await post<Done>('/api/skills/import', { data, apply: true, overwrite: [...over], install: { sources: ids('s:'), plugins: ids('p:') } }));
      await qc.invalidateQueries({ queryKey: ['skills'] });
    } catch (e) { toast(`가져오지 못했다 — ${(e as Error).message}`, 5000); } finally { setBusy(false); }
  };
  const files = pre ? pre.units.filter(u => !u.exists || over.has(u.unit)).length : 0;
  const row = 'flex items-center gap-2 border-b px-2.5 py-1.5 text-sm last:border-b-0';

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">스킬 옮기기</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          다른 기기의 스킬을 이 컴퓨터로 옮깁니다 — 사이드 메뉴 아래에서 그 기기의 EDITH 를 열어 거기서 <b>내려받기</b>, 이 기기 EDITH 에서 <b>가져오기</b>.
          공개 스킬(npx skills 로 깐 것)과 고른 스킬이 부르는 플러그인은 파일 대신 설치 명령으로 담겨, 가져올 때 고르면 EDITH 가 설치합니다.
          회사 스킬에는 회사 내용이 들어 있을 수 있으니 파일을 어디에 두는지 조심합니다.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {!remote ? (
          <section className={`${card} opacity-70`}>
            <h2 className="font-semibold">내려받기</h2>
            <p className="text-sm text-muted-foreground">
              지금은 이 기기({view?.host ?? '…'}) 화면이라 내려받을 게 없습니다 — 이 기기 스킬은 이미 여기 있습니다.
              다른 기기의 스킬을 옮기려면 사이드 메뉴 아래에서 그 기기의 EDITH 를 열고, 거기 스킬 화면에서 내려받습니다.
            </p>
          </section>
        ) : (
        <section className={card}>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">내려받기 <span className="font-normal text-muted-foreground">— {view?.host} 의 스킬을 이 컴퓨터로</span></h2><span className="text-sm text-muted-foreground">{pick.size} / {mine.length}</span>
            <button onClick={() => setPick(new Set(mine.map(s => s.id)))} className="ml-auto text-xs text-muted-foreground hover:text-foreground">모두</button>
            <button onClick={() => setPick(new Set())} className="text-xs text-muted-foreground hover:text-foreground">없음</button>
          </div>
          <div className="max-h-96 overflow-y-auto rounded-md border">
            {mine.map(s => (
              <label key={s.id} className={`${row} cursor-pointer hover:bg-muted/50`}>
                <input type="checkbox" checked={pick.has(s.id)} onChange={() => setPick(p => toggle(p, s.id))} />
                <Agents s={s} size="size-3" /><span className="truncate font-mono text-[0.78125rem]">{s.name}</span>
                {s.kind !== 'skill' && <span className="text-[0.625rem] text-muted-foreground">{KIND[s.kind]}</span>}<Badge s={s} />
                {s.origin && <span className="ml-auto shrink-0 truncate text-[0.65625rem] text-muted-foreground" title="파일 대신 설치 명령으로 담긴다">공개 · {s.origin}</span>}
              </label>
            ))}
          </div>
          {needPlugins.size > 0 && (
            <div className="text-xs text-muted-foreground">
              <div className="mb-0.5 font-semibold">같이 담기는 플러그인(설치 명령으로)</div>
              {[...needPlugins].map(([pl, users]) => <div key={pl}><span className="font-mono text-foreground">{pl}</span> ← {[...users].join(', ')}</div>)}
            </div>
          )}
          {missing.size > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
              <div className="mb-0.5 flex items-center font-semibold text-amber-700 dark:text-amber-300">고른 스킬이 부르는데 빠진 것
                <button onClick={() => setPick(p => new Set([...p, ...missing.keys()]))} className="ml-auto font-normal underline">같이 넣기</button>
              </div>
              {[...missing].map(([id, users]) => <div key={id}><span className="font-mono">{by.get(id)?.name}</span> ← {[...users].join(', ')}</div>)}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={plugins} onChange={e => setPlugins(e.target.checked)} />부르지 않는 켜 둔 플러그인도 담기</label>
          <button onClick={() => void download()} disabled={busy || !pick.size} className={btn}>{busy && !pre ? '묶는 중…' : `내려받기 (${pick.size}개)`}</button>
        </section>
        )}
        <section className={card}>
          <h2 className="font-semibold">가져오기 <span className="font-normal text-muted-foreground">— 받은 파일을 이 기기({view?.host ?? '…'})에</span></h2>
          <input type="file" accept=".gz,application/gzip" onChange={e => void load(e.target.files?.[0])} className="block w-full text-sm file:mr-2 file:rounded-md file:border file:bg-card file:px-2.5 file:py-1" />
          {pre && (
            <>
              <p className="text-xs text-muted-foreground">{pre.at.slice(0, 16).replace('T', ' ')} 에 묶은 것. 이미 있는 것은 덮어쓰기를 고른 것만 바꿉니다.</p>
              {pre.units.length > 0 && (
                <div className="max-h-60 overflow-y-auto rounded-md border">
                  {pre.units.map(u => (
                    <div key={u.unit} className={row}>
                      <span className="min-w-0 flex-1 truncate font-mono text-[0.78125rem]">~/{u.unit}</span>
                      {u.link && <span className="text-[0.625rem] text-muted-foreground">링크</span>}
                      {u.exists
                        ? <label className="flex shrink-0 items-center gap-1 text-xs text-amber-700 dark:text-amber-300"><input type="checkbox" checked={over.has(u.unit)} onChange={() => setOver(o => toggle(o, u.unit))} />있음 — 덮어쓰기</label>
                        : <span className="shrink-0 text-xs text-emerald-700 dark:text-emerald-300">새로</span>}
                    </div>
                  ))}
                </div>
              )}
              {(pre.sources.length > 0 || pre.plugins.length > 0) && (
                <div className="rounded-md border">
                  <div className="border-b px-2.5 py-1 text-xs font-semibold text-muted-foreground">설치로 받는 것 — 고른 것을 EDITH 가 설치합니다</div>
                  {pre.sources.map(x => (
                    <label key={x.name} className={`${row} cursor-pointer`}>
                      {x.have ? <span className="w-[13px]" /> : <input type="checkbox" checked={inst.has(`s:${x.name}`)} onChange={() => setInst(i => toggle(i, `s:${x.name}`))} />}
                      <span className="font-mono text-[0.78125rem]">{x.name}</span><span className="truncate text-xs text-muted-foreground">공개 스킬 · {x.source}</span>
                      {x.have && <span className="ml-auto shrink-0 text-xs text-muted-foreground">이미 있음</span>}
                    </label>
                  ))}
                  {pre.plugins.map(p => (
                    <label key={p.id} className={`${row} cursor-pointer`}>
                      {p.have ? <span className="w-[13px]" /> : <input type="checkbox" checked={inst.has(`p:${p.id}`)} onChange={() => setInst(i => toggle(i, `p:${p.id}`))} />}
                      <span className="font-mono text-[0.78125rem]">{p.id}</span>
                      <span className="truncate text-xs text-muted-foreground">플러그인{p.add ? ` · ${p.add}` : ' · 마켓플레이스 주소 없음'}{p.need.length ? ` ← ${p.need.join(', ')}` : ''}</span>
                      {p.have && <span className="ml-auto shrink-0 text-xs text-muted-foreground">이미 있음</span>}
                    </label>
                  ))}
                </div>
              )}
              <button onClick={() => void run()} disabled={busy || (!files && !inst.size)} className={btn}>{busy ? '넣는 중…(설치는 몇 분 걸릴 수 있다)' : `가져오기 (파일 ${files} · 설치 ${inst.size})`}</button>
            </>
          )}
          {done && (
            <div className="space-y-1 text-sm">
              <p>새로 {done.added.length} · 덮어씀 {done.replaced.length} · 건너뜀 {done.skipped.length}. Claude·Codex 는 새 세션부터 봅니다.</p>
              {done.installed.map(r => <p key={r.what} className={r.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-400'}>{r.ok ? '설치함' : '설치 못 함'} — {r.what}{r.msg && ` (${r.msg})`}</p>)}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
