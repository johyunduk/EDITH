// 공방 — 체인(노드를 이은 것)과 엔진(체인 · 엔진을 이은 것)을 그리고 고친다. 둘은 파일 꼴이 같고 kind 로 가른다(만들 때 고른다). 왼쪽 목록, 가운데 캔버스(React Flow), 오른쪽 공방 Claude pane.
// engine.json 은 이 화면만 쓴다(서버는 읽은 판이 같을 때만 저장). 스킬 파일은 오른쪽 Claude 가 쓰고, 사람이 노드에서 「연결」을 눌러 붙인다.
// 노드는 스킬(Claude 가 한다) · 명령(실행기가 돌린다) · 체인 · 엔진(그 자리에서 그것이 돈다 — 엔진에서만) 중 하나. 화살표는 보통 또는 「실패하면」(고치고 다시).
// 주소는 #/workshop/<폴더>. 설계만 한다 — 돌리는 것(런)은 머리줄 「런」.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Background, Controls, Handle, MiniMap, Position, ReactFlow, applyEdgeChanges, applyNodeChanges,
  type Connection, type Edge as RFEdge, type EdgeChange, type Node as RFNode, type NodeChange, type NodeProps, type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { get, post, useHerdr } from './api.ts';
import { Button } from '@/components/ui/button';
import { AgentPane } from './AgentPane.tsx';
import { putDraft } from './Prompt.tsx';
import { FolderInput } from './Side.tsx';
import { Empty, Icon, Tag } from './ui.tsx';
import { Kind, STATUS } from './herdrUi.tsx';
import { toast } from './copy.ts';
import { StepFlow } from './StepFlow.tsx';
import { EngineMap } from './EngineMap.tsx';
import type { FlowStep } from './stepFlow.ts';

type SkillRef = { from: 'engine' | 'installed'; id: string };
type WNode = { id: string; title: string; skill: SkillRef | null; command?: string; engine?: string; x: number; y: number };
type WEdge = { from: string; to: string; fail?: true; max?: number };
type Workdir = { kind: 'ask' } | { kind: 'fixed'; dir: string } | { kind: 'worktree'; repo: string; base?: string };
type Engine = { name: string; kind?: 'chain' | 'engine'; nodes: WNode[]; edges: WEdge[]; common?: SkillRef; workdir?: Workdir };
type Read = { id: string; engine: Engine | null; errors: string[]; version: string; skills: { id: string; desc: string }[]; draft: { engine: Engine | null; errors: string[] } | null };
type List = { root: string; engines: Item[]; claude: string | null };
// uses — 노드가 부르는 체인 · 엔진(노드 순서, 적용된 engine.json 기준), draft — draft.json 이 있다
type Item = { id: string; name: string; nodes: number; kind: 'chain' | 'engine'; broken: boolean; uses: string[]; draft: boolean };
type Installed = { id: string; name: string; call: string; agents: string[]; desc: string };

const PLUS = <path d="M12 5v14M5 12h14" />;
const KIND = { chain: '체인', engine: '엔진' } as const;
const VIEWS = [['map', '흐름 지도', '단계 칸과 줄로 본다 — 줄을 누르면 하는 일 · Claude 가 받는 지시 · 앞뒤 흐름'], ['canvas', '캔버스', '노드 · 화살표를 놓고 고친다'],
  ['flat', '펼쳐 보기', '안에 든 체인 · 엔진을 노드까지 펼친 캔버스 — 런 화면과 같은 모양']] as const;
const CHEVRON_L = <path d="m15 18-6-6 6-6" />, CHEVRON_R = <path d="m9 18 6-6-6-6" />;
// 목록의 종류 표시 — 엔진은 겹친 판, 체인은 사슬
const KIND_ICON = {
  engine: <><path d="m12 2 10 5-10 5L2 7z" /><path d="m2 12 10 5 10-5" /><path d="m2 17 10 5 10-5" /></>,
  chain: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>,
};

export function WorkshopPage({ id, side }: { id?: string; side: boolean }) {
  const list = useQuery({ queryKey: ['workshop'], queryFn: () => get<List>('/api/workshop'), refetchInterval: 5000 });
  // 오른쪽 Claude 접기 — 이 브라우저에만 기억한다(저장이 막혀도 동작)
  const [fold, setFoldState] = useState(() => { try { return localStorage.getItem('edith.workshop.claude') === 'off'; } catch { return false; } });
  const setFold = (v: boolean) => { setFoldState(v); try { localStorage.setItem('edith.workshop.claude', v ? 'off' : 'on'); } catch { /* 저장 안 됨 */ } };
  const claude = list.data?.claude ?? null;
  const ask = (text: string) => { if (!claude) return; putDraft(claude, text); setFold(false); };
  if (list.error && !list.data) return <p className="p-4 text-sm text-destructive">{String(list.error)}</p>;
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside className={`max-h-72 shrink-0 overflow-y-auto border-b bg-sidebar p-1.5 md:max-h-none md:w-64 md:border-r md:border-b-0 ${side ? '' : 'hidden'}`}>
        <EngineList list={list.data} sel={id} />
      </aside>
      <main className="flex min-h-[32rem] min-w-0 flex-1 flex-col">
        {id ? <Editor key={id} id={id} root={list.data?.root ?? ''} engines={list.data?.engines ?? []} claude={claude} onAsk={ask} />
          : <div className="p-6"><Empty>왼쪽에서 고르거나 새로 만든다. 체인은 노드(스킬 · 명령)를 잇고, 엔진은 체인 · 엔진(과 노드)을 잇는다.</Empty></div>}
      </main>
      <ClaudePanel id={claude} fold={fold} setFold={setFold} />
    </div>
  );
}

// 체인 · 엔진 목록(트리) + 새 체인 · 새 엔진 — 이름(한글 가능)과 폴더 이름(영문 소문자 · 숫자 · -)
function EngineList({ list, sel }: { list?: List; sel?: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<'chain' | 'engine' | null>(null), [name, setName] = useState(''), [folder, setFolder] = useState(''), [err, setErr] = useState('');
  const create = async () => {
    try {
      await post('/api/workshop', { id: folder.trim(), name: name.trim(), kind: open });
      await qc.invalidateQueries({ queryKey: ['workshop'] });
      setOpen(null); setName(''); setFolder(''); setErr('');
      location.hash = `#/workshop/${folder.trim()}`;
    } catch (e) { setErr((e as Error).message); }
  };
  const field = 'w-full rounded-md border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/50';
  return (
    <>
      <div className="mb-1 flex gap-1">
        {(['chain', 'engine'] as const).map(k => (
          <button key={k} onClick={() => { setOpen(v => v === k ? null : k); setErr(''); }} aria-pressed={open === k}
            title={k === 'chain' ? '스킬 · 명령 노드를 잇는다' : '체인 · 엔진과 노드를 잇는다'}
            className={`flex flex-1 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left text-[0.8125rem] font-medium ${open === k ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/70'}`}>
            <Icon className="size-3.5">{PLUS}</Icon>새 {KIND[k]}
          </button>
        ))}
      </div>
      {open && (
        <form onSubmit={e => { e.preventDefault(); void create(); }} className="mb-2 space-y-1.5 rounded-lg border bg-card p-2">
          <p className="text-xs font-semibold">새 {KIND[open]} — {open === 'chain' ? '스킬 · 명령 노드를 잇는다' : '체인 · 엔진과 노드를 잇는다'}</p>
          <label className="block text-xs text-muted-foreground">이름<input value={name} onChange={e => setName(e.target.value)} placeholder={open === 'chain' ? '기획 파악' : '기능 개발'} className={`mt-0.5 ${field}`} /></label>
          <label className="block text-xs text-muted-foreground">폴더 이름 — 영문 소문자 · 숫자 · -
            <input value={folder} onChange={e => setFolder(e.target.value.toLowerCase())} placeholder={open === 'chain' ? 'read' : 'feature'} className={`mt-0.5 font-mono ${field}`} /></label>
          {err && <p className="text-xs text-destructive">{err}</p>}
          <Button type="submit" size="sm" className="h-7 w-full text-xs" disabled={!name.trim() || !folder.trim()}>만들기</Button>
        </form>
      )}
      {!list ? <p className="p-2.5 text-xs text-muted-foreground">불러오는 중…</p>
        : !list.engines.length ? <p className="p-2.5 text-xs text-muted-foreground">아직 없다 — 노드를 이은 체인부터 만든다</p>
        : <EngineTree engines={list.engines} sel={sel} />}
      {list && <p className="mt-2 px-2.5 font-mono text-[0.625rem] break-all text-muted-foreground/70" title="공방 폴더">{list.root}</p>}
    </>
  );
}

// 트리 — 뿌리는 다른 체인 · 엔진이 쓰지 않는 것(엔진 먼저), 펼치면 그 안에서 부르는 것을 노드 순서대로. 여러 곳에서 쓰면 부모마다 나온다.
// 펼침은 길(폴더 이름을 / 로 이은 것)로 이 브라우저에 기억한다. 서버가 고리를 막지만 손으로 고친 engine.json 에 대비해 길 안 반복은 끊는다.
// 「체인」 은 체인을 이름 순으로 한 번씩, 「엔진」 은 위의 트리 — 어느 엔진에서 쓰는지는 이름에 마우스를 올리면.
const TREE_KEY = 'edith.workshop.tree', VIEW_KEY = 'edith.workshop.view';
function EngineTree({ engines, sel }: { engines: Item[]; sel?: string }) {
  const [view, setViewState] = useState<'tree' | 'chains'>(() => { try { return localStorage.getItem(VIEW_KEY) === 'chains' ? 'chains' : 'tree'; } catch { return 'tree'; } });
  const setView = (v: 'tree' | 'chains') => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* 저장 안 됨 */ } };
  const chains = useMemo(() => engines.filter(e => e.kind === 'chain').sort((a, b) => a.name.localeCompare(b.name, 'ko')), [engines]);
  const users = (id: string) => [...new Set(engines.filter(x => x.uses.includes(id)).map(x => x.name))];
  const byId = useMemo(() => new Map(engines.map(e => [e.id, e])), [engines]);
  const roots = useMemo(() => {
    const used = new Set(engines.flatMap(e => e.uses.filter(u => u !== e.id)));
    const top = engines.filter(e => !used.has(e.id)), seen = new Set<string>();
    const reach = (id: string) => { if (seen.has(id)) return; seen.add(id); byId.get(id)?.uses.forEach(reach); };
    top.forEach(e => reach(e.id));
    // 고리만 이룬 것은 뿌리가 없다 — 뿌리에서 닿지 않는 것도 뿌리로 둬서 목록에서 사라지지 않게
    return [...top, ...engines.filter(e => !seen.has(e.id))].sort((a, b) => +(a.kind === 'chain') - +(b.kind === 'chain'));
  }, [engines, byId]);
  const [open, setOpen] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem(TREE_KEY) ?? '[]') as string[]); } catch { return new Set(); } });
  useEffect(() => { try { localStorage.setItem(TREE_KEY, JSON.stringify([...open])); } catch { /* 저장 안 됨 */ } }, [open]);
  const toggle = (k: string) => setOpen(s => { const n = new Set(s); if (!n.delete(k)) n.add(k); return n; });
  // 고른 것이 펼친 곳 어디에도 안 보이면 처음 닿는 길을 펼친다 — 고를 때 한 번만(5초마다 다시 읽어도 사람이 접은 것을 다시 펴지 않게)
  const shown = useRef<string>(undefined);
  useEffect(() => {
    if (!sel || shown.current === sel) return;
    const paths: string[][] = [];
    const walk = (p: string[]) => { if (p.at(-1) === sel) paths.push(p); byId.get(p.at(-1)!)?.uses.forEach(u => { if (!p.includes(u)) walk([...p, u]); }); };
    roots.forEach(r => walk([r.id]));
    if (!paths.length) return;
    shown.current = sel;
    const up = (p: string[]) => p.slice(1).map((_, i) => p.slice(0, i + 1).join('/'));
    setOpen(s => paths.some(p => up(p).every(k => s.has(k))) ? s : new Set([...s, ...up(paths[0])]));
  }, [sel, roots, byId]);
  const pad = (depth: number) => ({ paddingLeft: 4 + depth * 14 });
  const row = (e: Item, path: string[], key: string): ReactNode => {
    const k = path.join('/'), kids = e.uses.filter(u => !path.includes(u)), on = open.has(k);
    return (
      <div key={key}>
        <div style={pad(path.length - 1)}
          className={`flex items-center gap-0.5 rounded-md border-l-2 pr-2 ${e.id === sel ? 'border-primary bg-accent text-accent-foreground' : 'border-transparent hover:bg-muted/70'}`}>
          {kids.length
            ? <button type="button" onClick={() => toggle(k)} aria-expanded={on} aria-label={`${e.name} ${on ? '접기' : '펼치기'}`}
                className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
                <Icon className={`size-3.5 transition-transform ${on ? 'rotate-90' : ''}`}>{CHEVRON_R}</Icon>
              </button>
            : <span className="size-5 shrink-0" />}
          <a href={`#/workshop/${e.id}`} title={`${KIND[e.kind]} · ${e.id}${e.draft ? ' · 초안(아직 적용 안 함)' : ''}${users(e.id).length ? ` · 쓰는 곳: ${users(e.id).join(', ')}` : ''}`} aria-current={e.id === sel ? 'page' : undefined}
            className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5">
            <span className={`shrink-0 ${e.kind === 'engine' ? 'text-foreground/70' : 'text-muted-foreground/70'}`}><Icon className="size-3.5">{KIND_ICON[e.kind]}</Icon></span>
            <span className="sr-only">{KIND[e.kind]}</span>
            <span className={`min-w-0 truncate text-[0.8125rem] ${e.kind === 'engine' ? 'font-medium' : ''}`}>{e.name}</span>
            {e.draft && <span className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-label="초안" />}
            {e.broken && <span className="ml-auto shrink-0 text-[0.6875rem] text-destructive">형식 오류</span>}
          </a>
        </div>
        {on && kids.map((u, i) => {
          const c = byId.get(u);
          return c ? row(c, [...path, u], `${key}/${i}`)
            : <p key={`${key}/${i}`} style={pad(path.length)} className="py-1 pl-6 text-[0.6875rem] text-destructive">공방에 없다 · {u}</p>;
        })}
      </div>
    );
  };
  return (
    <div className="mb-2">
      <div role="group" aria-label="목록 보기" className="mb-1 flex gap-0.5 px-1">
        {([['chains', '체인'], ['tree', '엔진']] as const).map(([v, label]) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
            className={`rounded px-2 py-0.5 text-[0.6875rem] ${view === v ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>
        ))}
      </div>
      {view === 'tree' ? roots.map(e => row(e, [e.id], e.id))
        : chains.length ? chains.map(e => row(e, [e.id], e.id)) : <p className="px-2.5 py-1 text-[0.6875rem] text-muted-foreground">체인이 없다</p>}
    </div>
  );
}

// 노드 상자 — 제목과 스킬. 스킬 칸은 붙음 · 없는 스킬 · Claude 가 쓰는 중 · 스킬 없음
type Card = { title: string; chip: string; tone: 'linked' | 'missing' | 'writing' | 'none' | 'cmd' | 'eng'; engine?: boolean };
type StepNode = RFNode<Card, 'step'>;
const CHIP: Record<Card['tone'], string> = {
  linked: 'bg-accent font-mono text-accent-foreground',
  missing: 'bg-destructive/10 text-destructive',
  writing: 'border border-dashed border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  none: 'bg-muted text-muted-foreground',
  cmd: 'bg-code font-mono text-code-foreground',
  eng: 'bg-primary/15 font-semibold text-primary',
};
function Step({ data, selected }: NodeProps<StepNode>) {
  // 명령 노드는 잇는 일(측 정하기 · 갈림 · 키트 깔기)이 많아 작은 칩으로 — 명령은 올려 보거나 눌러서 본다
  if (data.tone === 'cmd') return (
    <div title={data.chip} className={`flex max-w-44 items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs shadow-xs ${selected ? 'border-primary ring-3 ring-primary/25' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <span className="font-mono text-[0.625rem] text-muted-foreground">$</span>
      <span className="truncate">{data.title}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
  return (
    <div className={`w-48 rounded-lg border bg-card px-3 py-2 shadow-xs ${data.engine ? 'border-2 border-primary/50' : ''} ${selected ? 'border-primary ring-3 ring-primary/25' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="truncate text-[0.84375rem] font-semibold">{data.title}</div>
      <span className={`mt-1 inline-block max-w-full truncate rounded-full px-2 py-px text-[0.6875rem] ${CHIP[data.tone]}`}>{data.chip}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { step: Step };
const EDGE = { markerEnd: { type: 'arrowclosed' as const, width: 16, height: 16 } };
const FAIL = '#e5484d';   // 실패 화살표 — 두 테마에서 같은 빨강(화살촉은 CSS 변수를 못 받는다)

function Editor({ id, root, engines, claude, onAsk }: { id: string; root: string; engines: List['engines']; claude: string | null; onAsk: (text: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['workshop', id], queryFn: () => get<Read>(`/api/workshop/${id}`), refetchInterval: 2000 });
  const installedQ = useQuery({ queryKey: ['skills'], queryFn: () => get<Installed[]>('/api/skills'), staleTime: 30_000 });
  const installed = useMemo(() => (installedQ.data ?? []).filter(s => s.agents.includes('claude')), [installedQ.data]);   // 1판은 Claude 가 부를 수 있는 것만
  const [eng, setEng] = useState<Engine | null>(null);
  const engRef = useRef<Engine | null>(null), ver = useRef(''), timer = useRef<ReturnType<typeof setTimeout> | null>(null), chain = useRef(Promise.resolve()), saving = useRef(false);
  const [sel, setSel] = useState<string | null>(null), [selEdge, setSelEdge] = useState<string | null>(null), [writing, setWriting] = useState<string[]>([]);
  // 초안 미리 보기 — 켜면 캔버스가 Claude 초안을 보여 주고 고치기는 막는다
  const draft = q.data?.draft ?? null, [preview, setPreview] = useState(false), shownEng = preview && draft?.engine ? draft.engine : eng;
  useEffect(() => { if (!draft?.engine) setPreview(false); }, [draft?.engine]);

  // 서버 판 받기 — 처음, 또는 판이 바뀌었고 이 화면에 저장 안 한 고침이 없을 때만(고치는 중인 것을 덮지 않게)
  useEffect(() => {
    const d = q.data;
    if (!d || timer.current || saving.current || d.version === ver.current) return;
    ver.current = d.version; engRef.current = d.engine; setEng(d.engine);
  }, [q.data]);

  // 저장 — 고침마다 바로(제목은 조금 기다렸다가), 차례로 하나씩. 서버가 거절하면 서버 판으로 돌아간다.
  const flush = useCallback(async (next: Engine) => {
    saving.current = true;
    try {
      const r = await post<Read>(`/api/workshop/${id}`, { engine: next, version: ver.current });
      ver.current = r.version; qc.setQueryData(['workshop', id], r);
      void qc.invalidateQueries({ queryKey: ['workshop'], exact: true });   // 왼쪽 목록의 노드 수
    } catch (e) {
      // ponytail: 거절되면 이 화면의 마지막 고침을 버리고 서버 판을 다시 읽는다 — engine.json 을 쓰는 쪽은 이 화면뿐이라 다른 탭에서 같이 고칠 때만 일어난다
      toast(`저장하지 못했다 — ${(e as Error).message}`, 5000);
      const r = await get<Read>(`/api/workshop/${id}`).catch(() => null);
      if (r) { ver.current = r.version; engRef.current = r.engine; setEng(r.engine); qc.setQueryData(['workshop', id], r); }
    } finally { saving.current = false; }
  }, [id, qc]);
  const update = (f: (e: Engine) => Engine, wait = 0) => {
    if (!engRef.current) return;
    const next = f(engRef.current);
    engRef.current = next; setEng(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; chain.current = chain.current.then(() => flush(next)); }, wait);
  };

  const skills = useMemo(() => q.data?.skills ?? [], [q.data]);
  const card = useCallback((n: WNode): Card => {
    if (n.command) return { title: n.title, chip: `$ ${n.command}`, tone: 'cmd' };
    if (n.engine) {
      const e = engines.find(x => x.id === n.engine);
      return e ? { title: n.title, chip: `${KIND[e.kind]} · ${e.name} · 노드 ${e.nodes}`, tone: 'eng', engine: true } : { title: n.title, chip: `공방에 없다 · ${n.engine}`, tone: 'missing', engine: true };
    }
    if (!n.skill) return writing.includes(n.id) ? { title: n.title, chip: 'Claude 가 쓰는 중…', tone: 'writing' } : { title: n.title, chip: '스킬 없음', tone: 'none' };
    if (n.skill.from === 'engine') return skills.some(s => s.id === n.skill!.id) ? { title: n.title, chip: `/${n.skill.id}`, tone: 'linked' } : { title: n.title, chip: `없는 스킬 · ${n.skill.id}`, tone: 'missing' };
    const s = installed.find(x => x.id === n.skill!.id);
    return s ? { title: n.title, chip: s.call, tone: 'linked' } : { title: n.title, chip: `없는 스킬 · ${n.skill.id}`, tone: 'missing' };
  }, [writing, skills, installed, engines]);

  // 캔버스 상태 — 노드 크기 · 끄는 중 · 고름은 React Flow 가 들고, 위치 · 연결 · 지우기는 끝날 때 engine.json 으로
  const [nodes, setNodes] = useState<StepNode[]>([]), [edges, setEdges] = useState<RFEdge[]>([]);
  useEffect(() => {
    if (!shownEng) return;
    const eng = shownEng;
    setNodes(prev => eng.nodes.map(n => {
      const p = prev.find(x => x.id === n.id);
      return { ...p, id: n.id, type: 'step' as const, position: p?.dragging ? p.position : { x: n.x, y: n.y }, data: card(n) };
    }));
    setEdges(prev => eng.edges.map(e => {
      const k = `${e.from}>${e.to}`, base = { ...prev.find(x => x.id === k), id: k, source: e.from, target: e.to };
      return e.fail
        ? { ...base, className: 'fail', label: `실패하면 · 최대 ${e.max ?? 3}번`, labelStyle: { fill: FAIL, fontSize: 11, fontWeight: 600 }, labelBgStyle: { fill: 'var(--card)' }, markerEnd: { ...EDGE.markerEnd, color: FAIL } }
        : { ...base, className: '', label: undefined, markerEnd: EDGE.markerEnd };
    }));
  }, [shownEng, card]);
  // 처음 그릴 때 노드가 다 들어온 뒤에 띄워야 화면 맞추기(fitView)가 노드에 맞는다
  const [shown, setShown] = useState(false);
  // 보기 — 엔진은 흐름 지도(단계 칸 · 줄, EngineMap.tsx)가 처음, 캔버스(고치는 곳), 펼쳐 보기(런처럼 노드 한 줄로). 체인은 캔버스만
  const [view, setView] = useState<'map' | 'canvas' | 'flat'>('map');
  useEffect(() => { if (eng && nodes.length === eng.nodes.length) setShown(true); }, [eng, nodes.length]);
  // 스킬이 붙으면 「쓰는 중」 표시를 뗀다
  useEffect(() => {
    if (eng) setWriting(w => { const k = w.filter(x => eng.nodes.some(n => n.id === x && !n.skill)); return k.length === w.length ? w : k; });
  }, [eng]);

  const onNodesChange = useCallback((ch: NodeChange<StepNode>[]) => setNodes(ns => applyNodeChanges(ch, ns)), []);
  const onEdgesChange = useCallback((ch: EdgeChange[]) => setEdges(es => applyEdgeChanges(ch, es)), []);
  const onConnect = (c: Connection) => update(e => c.source === c.target || e.edges.some(x => x.from === c.source && x.to === c.target) ? e
    : { ...e, edges: [...e.edges, { from: c.source, to: c.target }] });
  const onDragStop = (_: unknown, __: unknown, moved: StepNode[]) => update(e => ({
    ...e, nodes: e.nodes.map(n => { const m = moved.find(x => x.id === n.id); return m ? { ...n, x: Math.round(m.position.x), y: Math.round(m.position.y) } : n; }),
  }));
  const removeNodes = (gone: string[]) => update(e => ({
    ...e, nodes: e.nodes.filter(n => !gone.includes(n.id)), edges: e.edges.filter(x => !gone.includes(x.from) && !gone.includes(x.to)),
  }));
  // 새 노드는 지금 보이는 캔버스 가운데에 — 그 자리에 노드가 있으면 아래로 한 줄씩 비켜 놓는다(옆으로 가면 화면 밖으로 금방 나간다)
  const flow = useRef<ReactFlowInstance<StepNode, RFEdge> | null>(null), wrap = useRef<HTMLDivElement>(null);
  // 「+ 노드」 — 흐름 지도 · 펼쳐 보기에서 누르면 캔버스로 바꾸고, 캔버스가 뜨면(onInit) 그 자리에 놓는다
  const addOnInit = useRef(false);
  const add = () => {
    const e = engRef.current, f = flow.current, r = wrap.current?.getBoundingClientRect();
    if (!e) return;
    let k = e.nodes.length + 1;
    while (e.nodes.some(n => n.id === `n${k}`)) k++;
    const c = f && r ? f.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : { x: 96, y: 28 };
    let x = Math.round(c.x - 96), y = Math.round(c.y - 28);   // 노드 상자(가로 192) 가운데가 화면 가운데에
    while (e.nodes.some(n => Math.abs(n.x - x) < 200 && Math.abs(n.y - y) < 80)) y += 96;
    update(v => ({ ...v, nodes: [...v.nodes, { id: `n${k}`, title: '새 노드', skill: null, x, y }] }));
    setSel(`n${k}`);
  };
  // 초안 적용 · 버리기 — 적용은 지금 판(version)이 같을 때만. 저장 기다리는 고침은 초안이 통째로 바꾸니 버린다.
  const draftAct = (what: 'apply' | 'discard') => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    chain.current = chain.current.then(async () => {
      try {
        const r = await post<Read>(`/api/workshop/${id}/draft`, { do: what, version: ver.current });
        if (what === 'apply') { ver.current = r.version; engRef.current = r.engine; setEng(r.engine); toast('초안을 적용했다'); }
        qc.setQueryData(['workshop', id], r); setPreview(false);
        void qc.invalidateQueries({ queryKey: ['workshop'], exact: true });
      } catch (e) { toast(`하지 못했다 — ${(e as Error).message}`, 5000); }
    });
  };
  // 체인 · 엔진 만드는 법은 공방 CLAUDE.md 가 가리키는 만들기 스킬(EDITH 레포 workshop/engine-skill.md)에 있다
  const askEngine = () => onAsk(`공방 ${KIND[eng!.kind ?? 'chain']} 「${eng!.name}」(${id}/)을 ${eng!.nodes.length ? '고쳐' : '만들어'} 줘 — 공방 CLAUDE.md 의 만들기 스킬대로(묻고 → 스킬 → draft.json 초안).\n하는 일: `);
  const ask = (n: WNode) => {
    const where = `공방 「${eng!.name}」(${id}/)의 노드 「${n.title}」`;
    if (n.skill?.from === 'engine') onAsk(`${where}가 쓰는 스킬 ${id}/skills/${n.skill.id}/SKILL.md 를 고쳐 줘.\n고칠 점: `);
    else {
      onAsk(`${where}가 쓸 스킬을 새로 써 줘. ${id}/skills/<이름>/SKILL.md 로 쓴다(이름은 영문 소문자 · 숫자 · -). engine.json 은 고치지 않는다.\n하는 일: `);
      setWriting(w => w.includes(n.id) ? w : [...w, n.id]);
    }
  };

  if (q.error && !q.data) return <div className="p-6"><Empty>읽지 못했다 — {String(q.error)}</Empty></div>;
  if (!q.data) return <div className="p-6"><Empty>불러오는 중…</Empty></div>;
  if (!eng) return (
    <div className="space-y-2 p-6">
      <p className="text-sm font-semibold text-destructive">engine.json 형식이 맞지 않아 그릴 수 없다</p>
      <ul className="list-disc pl-5 text-sm text-muted-foreground">{q.data.errors.map(x => <li key={x}>{x}</li>)}</ul>
      <p className="font-mono text-xs text-muted-foreground">{root}/{id}/engine.json</p>
    </div>
  );
  const node = preview ? undefined : eng.nodes.find(n => n.id === sel), edge = preview ? undefined : eng.edges.find(x => `${x.from}>${x.to}` === selEdge);
  const what = KIND[eng.kind ?? 'chain'], mode = eng.kind === 'engine' ? view : 'canvas';
  const ref = (v: string) => { const at = v.indexOf(':'); return v ? { from: v.slice(0, at) as SkillRef['from'], id: v.slice(at + 1) } : undefined; };
  return (
    <>
      <div className="space-y-1.5 border-b px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-base font-bold">{eng.name}</h1>
          <span className="rounded-full bg-accent px-2 py-px text-[0.6875rem] font-semibold text-accent-foreground" title={eng.kind === 'engine' ? '체인 · 엔진과 노드를 잇는다' : '스킬 · 명령 노드만 잇는다 — 체인을 이으려면 엔진을 만든다'}>{what}</span>
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={`${root}/${id}`}>{id}/</span>
          <span className="ml-auto text-xs text-muted-foreground">노드 {eng.nodes.length} · 스킬 {skills.length}</span>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={askEngine} disabled={!claude}
            title={claude ? `이 ${what}을 만들거나 고쳐 달라는 글을 오른쪽 Claude 입력칸에 넣는다 — Claude 는 초안(draft.json)을 쓰고, 여기서 미리 보고 적용한다` : '오른쪽에서 공방 Claude 를 먼저 띄운다'}>Claude 에게 맡기기</Button>
          {eng.kind === 'engine' && (
            <span role="group" aria-label="보기" className="flex rounded-md border bg-card p-0.5">
              {VIEWS.map(([v, label, tip]) => (
                <button key={v} type="button" aria-pressed={mode === v} onClick={() => setView(v)} title={tip}
                  className={`rounded px-2.5 py-1 text-xs ${mode === v ? 'bg-primary font-semibold text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{label}</button>
              ))}
            </span>
          )}
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={preview} title={preview ? '초안을 미리 보는 중에는 고칠 수 없다' : mode === 'canvas' ? undefined : '캔버스로 바꿔 새 노드를 놓는다'}
            onClick={() => { if (mode === 'canvas') return add(); addOnInit.current = true; setView('canvas'); }}><Icon className="size-3.5">{PLUS}</Icon>노드</Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
          <WorkdirSetting key={id} w={eng.workdir} onChange={(w, wait) => update(x => ({ ...x, workdir: w }), wait)} />
          <label className="flex items-center gap-1.5" title={`이 ${what}의 모든 스킬 노드 지시 앞에 같이 붙는 스킬`}>공통 규칙
            <select value={eng.common ? `${eng.common.from}:${eng.common.id}` : ''} onChange={e => update(x => ({ ...x, common: ref(e.target.value) }))}
              className="h-7 max-w-52 rounded-md border bg-background px-1.5 text-xs outline-none focus:ring-2 focus:ring-ring/50">
              <option value="">없음</option><SkillOptions id={id} skills={skills} installed={installed} />
            </select>
          </label>
          <span className="ml-auto"><RemoveEngine id={id} what={what} /></span>
        </div>
      </div>
      {draft && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-violet-500/10 px-4 py-2 text-sm">
          <span className="font-semibold text-violet-700 dark:text-violet-300">Claude 초안</span>
          {draft.engine
            ? <span className="text-xs text-muted-foreground">노드 {draft.engine.nodes.length} · 화살표 {draft.engine.edges.length} · 새 노드 {draft.engine.nodes.filter(n => !eng.nodes.some(m => m.id === n.id)).length} · 빠지는 노드 {eng.nodes.filter(n => !draft.engine!.nodes.some(m => m.id === n.id)).length}{preview && ' — 미리 보는 중(고칠 수 없음)'}</span>
            : <span className="text-xs text-destructive">형식이 맞지 않다 — {draft.errors.join(' · ')}</span>}
          <span className="ml-auto flex gap-1.5">
            {draft.engine && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPreview(v => !v)}>{preview ? '지금 판 보기' : '미리 보기'}</Button>}
            {draft.engine && <Button size="sm" className="h-7 text-xs" onClick={() => draftAct('apply')}>적용</Button>}
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => draftAct('discard')}>버리기</Button>
          </span>
        </div>
      )}
      <RefWarnings id={id} />
      {mode === 'map' ? <EngineMap id={id} root={root} claude={claude} onAsk={onAsk} /> : mode === 'flat' ? <Expanded id={id} /> : <div ref={wrap} className="relative min-h-0 flex-1">
        {shown && (
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} defaultEdgeOptions={EDGE} onInit={i => { flow.current = i; if (addOnInit.current) { addOnInit.current = false; add(); } }}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onNodeDragStop={onDragStop}
            onNodesDelete={d => removeNodes(d.map(n => n.id))}
            onEdgesDelete={d => update(e => ({ ...e, edges: e.edges.filter(x => !d.some(y => y.source === x.from && y.target === x.to)) }))}
            onNodeClick={(_, n) => { setSel(n.id); setSelEdge(null); }} onEdgeClick={(_, e) => { setSelEdge(e.id); setSel(null); }}
            onPaneClick={() => { setSel(null); setSelEdge(null); }} deleteKeyCode={preview ? null : ['Backspace', 'Delete']}
            nodesDraggable={!preview} nodesConnectable={!preview} elementsSelectable={!preview}
            fitView fitViewOptions={{ padding: 0.3, maxZoom: 1 }} proOptions={{ hideAttribution: true }}>
            <Background gap={20} size={1.2} />
            <Controls showInteractive={false} position="bottom-right" />
            <MiniMap pannable zoomable position="top-right" nodeBorderRadius={8} />
          </ReactFlow>
        )}
        {edge ? <EdgePanel key={selEdge} e={edge} eng={eng}
          onChange={p => update(x => ({ ...x, edges: x.edges.map(y => y === edge ? { from: y.from, to: y.to, ...p } : y) }))}
          onRemove={() => { update(x => ({ ...x, edges: x.edges.filter(y => y !== edge) })); setSelEdge(null); }} />
        : node ? <Inspector key={node.id} n={node} eng={eng} id={id} engines={engines} skills={skills} installed={installed} claude={claude}
          onChange={(p, wait) => update(e => ({ ...e, nodes: e.nodes.map(x => x.id === node.id ? { ...x, ...p } : x) }), wait)}
          onAsk={() => ask(node)} onRemove={() => { removeNodes([node.id]); setSel(null); }} />
          : (
            <div className="absolute bottom-3 left-3 z-10 max-w-[calc(100%-1.5rem)] rounded-lg border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-xs">
              {preview ? 'Claude 초안을 미리 보는 중 — 위 띠에서 「적용」 하면 이대로 바뀐다' : eng.nodes.length ?  `노드를 누르면 제목 · ${eng.kind === 'engine' ? '스킬 · 명령 · 체인 · 엔진' : '스킬 · 명령'}을 고른다 · 오른쪽 점을 끌어 다른 노드에 놓으면 이어진다 · 화살표를 누르면 「실패하면」으로 · Delete 로 지운다` : '「+ 노드」로 노드를 놓거나 「Claude 에게 맡기기」로 초안을 받는다'}
            </div>
          )}
      </div>}
    </>
  );
}

// 펼친 노드 · 「적용」 전 검사 — 펼쳐 보기와 경고 띠가 같이 쓴다(초안이 있으면 초안 기준)
const useSteps = (id: string) => useQuery({
  queryKey: ['workshop', id, 'steps'], refetchInterval: 5000,
  queryFn: () => get<{ steps: FlowStep[]; errors: string[]; draft: boolean; warnings?: string[] }>(`/api/workshop/${id}/steps`),
});
// 「적용」 전 검사 띠 — 스킬이 없으면 멈춘다고 적은 작업 문서 파일을 앞 노드가 만들지 않으면(src/refs.ts). 경고일 뿐 적용 · 런은 막지 않는다
function RefWarnings({ id }: { id: string }) {
  const w = useSteps(id).data?.warnings ?? [];
  if (!w.length) return null;
  return (
    <details className="border-b bg-amber-500/10 px-4 py-2 text-sm text-amber-900 dark:text-amber-200">
      <summary className="cursor-pointer"><span className="font-semibold">런 전에 볼 것 {w.length}</span> — 스킬이 「없으면 멈춘다」 고 적은 파일을 앞 노드가 만들지 않는다</summary>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[0.8125rem]">{w.map(x => <li key={x}>{x}</li>)}</ul>
      <p className="mt-1.5 text-xs opacity-80">앞 노드(준비 체인 등)가 그 파일을 깔게 하거나 스킬 문장을 고친다. 스크립트가 이름을 조립해 만들면 헛경고일 수 있다 — 그 스크립트에 파일 이름을 적으면 사라진다.</p>
    </details>
  );
}

// 펼쳐 보기 — 안에 든 체인 · 엔진을 노드까지 펼친 캔버스(런 화면과 같은 것). 서버가 런과 같은 펼치기로 만든다. 노드를 누르면 그 체인으로 간다.
function Expanded({ id }: { id: string }) {
  const q = useSteps(id);
  if (!q.data) return <div className="p-6"><Empty>{q.error ? `읽지 못했다 — ${String(q.error)}` : '불러오는 중…'}</Empty></div>;
  if (q.data.errors.length) return (
    <div className="space-y-2 p-6">
      <p className="text-sm font-semibold">아직 펼칠 수 없다</p>
      <ul className="list-disc pl-5 text-sm text-muted-foreground">{q.data.errors.map(x => <li key={x}>{x}</li>)}</ul>
    </div>
  );
  const fix = q.data.steps.filter(s => s.fixOnly).length;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <p className="text-xs text-muted-foreground">
        노드 {q.data.steps.length - fix}개가 화살표 차례로 돈다{fix ? ` · 고치는 노드 ${fix}개(점선 — 「실패하면」 으로만 불린다)` : ''}{q.data.draft ? ' · 초안 기준(적용하면 이대로)' : ''} · 상자 머리를 누르면 펼친다 · 노드를 누르면 그 체인으로 간다
      </p>
      <StepFlow steps={q.data.steps} onPick={s => { if (s.engine) location.hash = `#/workshop/${s.engine}`; }} className="min-h-[24rem] flex-1" />
    </div>
  );
}

// 고른 노드 — 제목, 스킬 고르기, Claude 가 새로 쓴 스킬 「연결」, Claude 에게 쓰게 · 고치게 하기
function Inspector({ n, eng, id, engines, skills, installed, claude, onChange, onAsk, onRemove }: {
  n: WNode; eng: Engine; id: string; engines: List['engines']; skills: Read['skills']; installed: Installed[]; claude: string | null;
  onChange: (p: Partial<WNode>, wait?: number) => void; onAsk: () => void; onRemove: () => void;
}) {
  const [title, setTitle] = useState(n.title), [command, setCommand] = useState(n.command ?? '');
  // 종류 탭은 보기만 바꾼다 — 그 탭에서 새 값(스킬 · 명령 · 체인)을 실제로 골라야 노드가 바뀌고 다른 연결이 빠진다(탭만 눌러 연결이 지워져 저장되던 것을 막는다)
  const now = n.command !== undefined ? 'command' : n.engine !== undefined ? 'engine' : 'skill';
  const [kind, setKind] = useState<'skill' | 'command' | 'engine'>(now);
  const NOW = { skill: '스킬', command: '명령', engine: '체인 · 엔진' } as const;
  const name = (x: string) => eng.nodes.find(m => m.id === x)?.title ?? x;
  const ins = eng.edges.filter(e => e.to === n.id).map(e => name(e.from)), outs = eng.edges.filter(e => e.from === n.id).map(e => name(e.to));
  const value = n.skill ? `${n.skill.from}:${n.skill.id}` : '';
  const known = !n.skill || (n.skill.from === 'engine' ? skills.some(s => s.id === n.skill!.id) : installed.some(s => s.id === n.skill!.id));
  // Claude 가 새로 썼는데 아직 어느 노드에도 안 붙은 이 폴더 스킬 — 사람이 골라 붙인다(자동으로 붙이지 않는다)
  const fresh = n.skill ? [] : skills.filter(s => !eng.nodes.some(m => m.skill?.from === 'engine' && m.skill.id === s.id));
  const pick = (v: string) => {
    const at = v.indexOf(':');
    onChange(v ? { skill: { from: v.slice(0, at) as SkillRef['from'], id: v.slice(at + 1) }, command: undefined, engine: undefined } : { skill: null });
  };
  const field = 'h-8 rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring/50';
  return (
    <div className="absolute bottom-3 left-3 z-10 flex max-h-[calc(100%-1.5rem)] w-80 max-w-[calc(100%-1.5rem)] flex-col gap-2.5 overflow-y-auto rounded-xl border bg-card p-3 shadow-lg">
      <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">제목
        <input value={title} onChange={e => { setTitle(e.target.value); if (e.target.value.trim()) onChange({ title: e.target.value.trim() }, 500); }} className={field} />
      </label>
      <div className="flex gap-0.5 rounded-lg bg-muted p-0.5" role="tablist" aria-label="노드 종류">
        {([['skill', '스킬'], ['command', '명령'], ...(eng.kind === 'engine' ? [['engine', '체인 · 엔진']] as const : [])] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)}
            className={`flex-1 rounded-md px-2 py-1 text-xs ${kind === k ? 'bg-card font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>
        ))}
      </div>
      {kind !== now && (n.skill || n.command !== undefined || n.engine !== undefined) && (
        <p className="text-xs text-muted-foreground">지금 이 노드는 {NOW[now]} 노드다 — 여기서 새로 고르거나 적어야 {NOW[kind]}(으)로 바뀐다.</p>
      )}
      {kind === 'command' && (
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">명령 — 작업 폴더에서 셸로 돈다 · 끝 코드 0 이면 통과
          <input value={command} placeholder="pytest -q   또는   $EDITH_ENGINE/test.sh"
            onChange={e => { setCommand(e.target.value); onChange(e.target.value.trim() ? { command: e.target.value.trim(), skill: null, engine: undefined } : { command: undefined }, 600); }} className={`${field} font-mono text-xs`} />
          <span className="font-normal">이 폴더 사본은 <code>$EDITH_ENGINE</code>, 작업 문서는 <code>$EDITH_WORK</code></span>
        </label>
      )}
      {kind === 'engine' && (
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">체인 · 엔진 — 이 자리에서 그 안의 노드들이 돈다
          <div className="flex gap-1.5">
            <select value={n.engine ?? ''} onChange={e => onChange(e.target.value ? { engine: e.target.value, skill: null, command: undefined } : { engine: undefined })} className={`${field} min-w-0 flex-1`}>
              <option value="">고르기</option>
              {n.engine && !engines.some(x => x.id === n.engine) && <option value={n.engine}>공방에 없다 · {n.engine}</option>}
              {(['chain', 'engine'] as const).map(k => (
                <optgroup key={k} label={KIND[k]}>
                  {engines.filter(x => x.id !== id && x.kind === k).map(x => <option key={x.id} value={x.id}>{x.name} ({x.id} · 노드 {x.nodes})</option>)}
                </optgroup>
              ))}
            </select>
            {n.engine && <a href={`#/workshop/${n.engine}`} className="flex h-8 items-center rounded-md border px-2.5 text-xs font-semibold text-primary hover:bg-accent">열기 →</a>}
          </div>
        </label>
      )}
      {kind === 'skill' && (
      <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">스킬
        <select value={value} onChange={e => pick(e.target.value)} className={field}>
          <option value="">스킬 없음</option>
          {!known && <option value={value}>없는 스킬 · {n.skill!.id}</option>}
          <SkillOptions id={id} skills={skills} installed={installed} />
        </select>
      </label>
      )}
      {kind === 'skill' && fresh.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-semibold text-muted-foreground">아직 안 붙은 이 폴더 스킬 — 눌러서 이 노드에 연결</div>
          {fresh.map(s => (
            <button key={s.id} onClick={() => onChange({ skill: { from: 'engine', id: s.id }, command: undefined, engine: undefined })}
              className="flex w-full min-w-0 items-baseline gap-2 rounded-md border px-2 py-1 text-left text-xs hover:border-primary/50 hover:bg-accent">
              <span className="shrink-0 font-semibold text-primary">연결</span><span className="shrink-0 font-mono">/{s.id}</span>
              <span className="min-w-0 truncate text-muted-foreground">{s.desc}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {kind === 'skill' && (!n.skill || n.skill.from === 'engine') && (
          <Button size="sm" className="h-7 text-xs" onClick={onAsk} disabled={!claude}
            title={claude ? '이 노드 정보를 오른쪽 Claude 입력칸에 넣는다 — 이어 쓰고 보낸다' : '오른쪽에서 공방 Claude 를 먼저 띄운다'}>
            {n.skill ? 'Claude 에게 고치게 하기' : 'Claude 에게 쓰게 하기'}
          </Button>
        )}
        <Button size="sm" variant="outline" className="ml-auto h-7 text-xs text-destructive" onClick={onRemove}>노드 지우기</Button>
      </div>
      <div className="text-xs leading-relaxed text-muted-foreground">
        <span className="font-mono">{n.id}</span> · 들어옴: {ins.join(', ') || '없음'} · 나감: {outs.join(', ') || '없음'}
      </div>
    </div>
  );
}

// 지우기 — 두 번 눌러야 지운다. 폴더는 휴지통(workshop-trash)으로 옮긴다 — 되살릴 수 있다. 다른 엔진이 쓰고 있으면 서버가 거절한다.
function RemoveEngine({ id, what }: { id: string; what: string }) {
  const qc = useQueryClient(), [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); }, [armed]);
  const go = async () => {
    if (!armed) return setArmed(true);
    try {
      const r = await post<{ trash: string }>(`/api/workshop/${id}/remove`, {});
      toast(`지웠다 — ${r.trash.replace(/^\/(Users|home)\/[^/]+/, '~')} 로 옮겨 두었다`, 6000);
      await qc.invalidateQueries({ queryKey: ['workshop'] });
      location.hash = '#/workshop';
    } catch (e) { toast(`지우지 못했다 — ${(e as Error).message}`, 6000); setArmed(false); }
  };
  return (
    <Button size="sm" variant="outline" onClick={() => void go()} title="폴더를 휴지통(~/.local/share/edith/workshop-trash)으로 옮긴다"
      className={`h-7 text-xs ${armed ? 'border-destructive bg-destructive text-white hover:bg-destructive/90' : 'text-destructive'}`}>{armed ? '한 번 더 누르면 지운다' : `${what} 지우기`}</Button>
  );
}

// 작업 폴더 — 런 시작할 때 고르기 · 늘 같은 폴더 · 레포에서 새 워크트리(브랜치는 런 시작할 때). 돌리는 맨 바깥 것의 설정만 쓴다.
function WorkdirSetting({ w, onChange }: { w?: Workdir; onChange: (w: Workdir | undefined, wait?: number) => void }) {
  const kind = w?.kind ?? 'ask';
  const [dir, setDir] = useState(w?.kind === 'fixed' ? w.dir : ''), [repo, setRepo] = useState(w?.kind === 'worktree' ? w.repo : ''), [base, setBase] = useState(w?.kind === 'worktree' ? w.base ?? '' : '');
  const tree = (r: string, b: string): Workdir => ({ kind: 'worktree', repo: r, ...(b.trim() ? { base: b.trim() } : {}) });
  const field = 'h-7 rounded-md border bg-background px-1.5 font-mono text-xs outline-none focus:ring-2 focus:ring-ring/50';
  return (
    <span className="flex flex-wrap items-center gap-1.5" title="런에서 Claude 가 일하고 명령이 도는 곳 — 엔진 안의 체인은 엔진의 설정을 따른다">작업 폴더
      <select value={kind} onChange={e => onChange(e.target.value === 'fixed' ? { kind: 'fixed', dir } : e.target.value === 'worktree' ? tree(repo, base) : undefined)}
        className="h-7 rounded-md border bg-background px-1.5 text-xs outline-none focus:ring-2 focus:ring-ring/50">
        <option value="ask">런 시작할 때 고르기</option><option value="fixed">늘 같은 폴더</option><option value="worktree">새 워크트리</option>
      </select>
      {kind === 'fixed' && <FolderInput value={dir} onChange={v => { setDir(v); onChange({ kind: 'fixed', dir: v }, 600); }} placeholder="~/project" className={`${field} w-60`} />}
      {kind === 'worktree' && <>
        레포<FolderInput value={repo} onChange={v => { setRepo(v); onChange(tree(v, base), 600); }} placeholder="~/project (git 레포)" className={`${field} w-56`} />
        기준<input value={base} onChange={e => { setBase(e.target.value); onChange(tree(repo, e.target.value), 600); }} placeholder="origin/main" className={`${field} w-28`} />
      </>}
    </span>
  );
}

function SkillOptions({ id, skills, installed }: { id: string; skills: Read['skills']; installed: Installed[] }) {
  return <>
    <optgroup label={`이 폴더 (${id}/skills)`}>{skills.map(s => <option key={s.id} value={`engine:${s.id}`}>/{s.id}{s.desc && ` — ${s.desc}`}</option>)}</optgroup>
    <optgroup label="설치된 스킬">{installed.map(s => <option key={s.id} value={`installed:${s.id}`}>{s.call}{s.desc && ` — ${s.desc}`}</option>)}</optgroup>
  </>;
}

// 고른 화살표 — 보통 또는 「실패하면」(앞 노드가 실패하면 뒤 노드로 고치고 앞 노드를 다시, 최대 몇 번)
function EdgePanel({ e, eng, onChange, onRemove }: { e: WEdge; eng: Engine; onChange: (p: Partial<WEdge>) => void; onRemove: () => void }) {
  const name = (x: string) => eng.nodes.find(m => m.id === x)?.title ?? x;
  const pill = (on: boolean) => `flex-1 rounded-md px-2 py-1 text-xs ${on ? 'bg-card font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'}`;
  return (
    <div className="absolute bottom-3 left-3 z-10 flex w-80 max-w-[calc(100%-1.5rem)] flex-col gap-2.5 rounded-xl border bg-card p-3 shadow-lg">
      <div className="text-sm font-semibold">「{name(e.from)}」 → 「{name(e.to)}」</div>
      <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
        <button className={pill(!e.fail)} onClick={() => onChange({ fail: undefined, max: undefined })}>보통</button>
        <button className={pill(!!e.fail)} onClick={() => onChange({ fail: true, max: e.max ?? 3 })}>실패하면</button>
      </div>
      {e.fail && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">최대
          <select value={e.max ?? 3} onChange={x => onChange({ fail: true, max: Number(x.target.value) })} className="h-7 rounded-md border bg-background px-1.5 text-xs">
            {[1, 2, 3, 4, 5].map(k => <option key={k} value={k}>{k}번</option>)}
          </select>
        </label>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">{e.fail
        ? `「${name(e.from)}」이 실패하면 「${name(e.to)}」으로 고치고 「${name(e.from)}」을 다시 돌린다. 고치는 노드에는 다른 화살표를 잇지 않는다.`
        : `「${name(e.from)}」이 끝나면 「${name(e.to)}」으로 간다.`}</p>
      <Button size="sm" variant="outline" className="ml-auto h-7 text-xs text-destructive" onClick={onRemove}>화살표 지우기</Button>
    </div>
  );
}

// 오른쪽 공방 Claude — herdr 「공방」 워크스페이스의 Claude pane 대화와 입력칸. 없으면 띄우는 단추(누를 때만 띄운다).
// 넓이 — 왼쪽 가장자리를 끌거나(두 번 누르면 처음 넓이) 화살표 키로. 이 브라우저에만 기억한다(저장이 막혀도 동작). 캔버스 · 목록 자리는 남긴다.
const WIDE = 416, WIDE_KEY = 'edith.workshop.claudeWidth';
const wideOf = (v: number) => Math.round(Math.max(300, Math.min(v, innerWidth - 480)));
function ClaudePanel({ id, fold, setFold }: { id: string | null; fold: boolean; setFold: (v: boolean) => void }) {
  const herdr = useHerdr(), qc = useQueryClient();
  const p = herdr.data?.panes.find(x => x.id === id);
  const [busy, setBusy] = useState(false);
  const [wide, setWide] = useState(() => { try { return Number(localStorage.getItem(WIDE_KEY)) || WIDE; } catch { return WIDE; } }), [drag, setDrag] = useState(false);
  const keep = (v: number) => { setWide(v); try { localStorage.setItem(WIDE_KEY, String(v)); } catch { /* 저장 안 됨 */ } };
  const start = async () => {
    setBusy(true);
    try { await post('/api/workshop/claude', {}); await qc.invalidateQueries({ queryKey: ['workshop'] }); await qc.invalidateQueries({ queryKey: ['herdr'] }); }
    catch (e) { toast(`띄우지 못했다 — ${(e as Error).message}`, 6000); }
    setBusy(false);
  };
  if (fold) return (
    <aside className="flex shrink-0 items-center gap-2 border-t px-2 py-1.5 md:w-11 md:flex-col md:border-t-0 md:border-l md:py-2">
      <button onClick={() => setFold(false)} title="공방 Claude 펴기" className="rounded-md border bg-card p-1.5 hover:bg-muted"><Icon className="size-4">{CHEVRON_L}</Icon></button>
      <span className="text-xs font-semibold text-muted-foreground md:[writing-mode:vertical-rl]">공방 Claude</span>
    </aside>
  );
  return (
    <aside style={{ '--claude-w': `${wideOf(wide)}px` } as React.CSSProperties}
      className={`relative flex min-h-[28rem] w-full shrink-0 flex-col gap-2 border-t bg-sidebar p-2 md:min-h-0 md:w-(--claude-w) md:border-t-0 md:border-l ${drag ? 'select-none' : ''}`}>
      <div role="separator" aria-orientation="vertical" aria-label="공방 Claude 넓이" aria-valuenow={wideOf(wide)} tabIndex={0}
        title="끌어서 넓이 조절 · 두 번 누르면 처음 넓이"
        className={`absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize outline-none focus-visible:bg-sky-500/40 md:block ${drag ? 'bg-sky-500/60' : 'hover:bg-sky-500/30'}`}
        onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setDrag(true); }}
        onPointerMove={e => { if (drag) setWide(wideOf(e.currentTarget.parentElement!.getBoundingClientRect().right - e.clientX)); }}
        onPointerUp={() => { if (drag) { setDrag(false); keep(wide); } }}
        onDoubleClick={() => keep(WIDE)}
        onKeyDown={e => { const d = e.key === 'ArrowLeft' ? 32 : e.key === 'ArrowRight' ? -32 : 0; if (d) { e.preventDefault(); keep(wideOf(wide + d)); } }} />
      <div className="flex items-center gap-2 px-1">
        <Kind agent="claude" /><span className="text-sm font-semibold">공방 Claude</span>
        {p?.status && STATUS[p.status] && <Tag v={p.status}>{STATUS[p.status]}</Tag>}
        {p && <a href={`#/herdr/${p.id}`} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">herdr 에서 보기</a>}
        <button onClick={() => setFold(true)} title="공방 Claude 접기" className="ml-auto rounded-md border bg-card p-1 hover:bg-muted"><Icon className="size-4">{CHEVRON_R}</Icon></button>
      </div>
      {p ? <AgentPane p={p} />
        : (
          <div className="space-y-3 rounded-xl border bg-card p-4 text-sm">
            <p>공방 Claude 가 아직 없다. 띄우면 herdr 에 「공방」 워크스페이스를 만들고 공방 폴더에서 Claude 를 연다.</p>
            <p className="text-xs text-muted-foreground">노드에서 「Claude 에게 쓰게 하기」를 누르면 여기 입력칸에 그 노드 정보가 들어온다. 스킬을 다 쓰면 노드에서 「연결」을 누른다.</p>
            {herdr.error && !herdr.data ? <p className="text-xs text-destructive">herdr 에 닿지 않는다 — {String(herdr.error)}</p>
              : <Button size="sm" onClick={() => void start()} disabled={busy}>{busy ? '띄우는 중… (최대 1분)' : '공방 Claude 띄우기'}</Button>}
          </div>
        )}
    </aside>
  );
}
