// herdr 사이드바 — 새 워크스페이스, 워크스페이스·탭·pane 트리(끌어 놓기·우클릭), 상태 표시, 다른 기기, 하단 줄.
import { useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, useView, type HerdrView, type HPane, type HWorkspace } from './api.ts';
import { Button } from '@/components/ui/button';
import { Icon } from './ui.tsx';
import { openMenu } from './Menu.tsx';
import { toast } from './copy.ts';
import { DOT, DRAG_PANE, DRAG_WS, Kind, REMOTE, STATUS, carrying, paneText, useMove, usePaneMenu, useTabMenu, useWorkspaceMenu } from './herdrUi.tsx';

// 상태 표시 — 모든 pane 의 작업 중·승인 대기·끝남 수. 줄에 마우스를 올리면(키보드는 Tab) 그 상태의 pane 목록이 오른쪽에 뜨고, 누르면 그 pane 으로.
// 사이드바가 overflow-hidden 이라 목록은 fixed 로 띄운다. 목록도 이 div 의 자식이라 줄에서 목록으로 옮겨 가도 닫히지 않는다.
export function Legend({ data }: { data: HerdrView }) {
  const [at, setAt] = useState<{ s: string; left: number; bottom: number } | null>(null);
  const show = (s: string) => (e: React.SyntheticEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setAt({ s, left: Math.min(r.right, innerWidth - 296), bottom: innerHeight - r.bottom });   // 좁은 화면이면 화면 안으로 당긴다
  };
  return (
    <div className="m-1.5 mt-0 shrink-0 border-t px-2.5 pt-2 pb-1" onMouseLeave={() => setAt(null)}
      onKeyDown={e => { if (e.key === 'Escape') setAt(null); }} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setAt(null); }}>
      <div className="mb-0.5 text-[0.6875rem] font-semibold text-muted-foreground">상태 표시</div>
      {(['working', 'blocked', 'done'] as const).map(s => {
        const n = data.panes.filter(p => p.status === s).length;
        return (
          <div key={s} tabIndex={n ? 0 : undefined} onMouseEnter={n ? show(s) : () => setAt(null)} onFocus={n ? show(s) : undefined}
            className={`-mx-1 flex h-6 items-center gap-2 rounded px-1 text-[0.8125rem] outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${at?.s === s ? 'bg-muted/70' : ''}`}>
            <span className={`size-2.5 rounded-full ${DOT[s]}`} />{STATUS[s]}<span className="ml-auto text-muted-foreground tabular-nums">{n}</span>
          </div>
        );
      })}
      {at && <StatusList data={data} s={at.s} style={{ left: at.left, bottom: at.bottom }} onPick={() => setAt(null)} />}
    </div>
  );
}

// 상태 목록 — 사이드바 트리 순서대로 맨 위 워크스페이스마다 묶고, 각 줄은 pane 이름 + 그 아래 「하위 워크트리 · 탭」(탭은 둘 이상일 때만 — 트리와 같게)
function StatusList({ data, s, style, onPick }: { data: HerdrView; s: string; style: React.CSSProperties; onPick: () => void }) {
  const wss = [...data.workspaces].sort((a, b) => a.number - b.number), childOf = parentOf(wss);
  const rows = data.panes.filter(p => p.status === s).flatMap(p => {
    const w = wss.find(x => x.workspace_id === p.workspace);
    return w ? [{ p, w, top: childOf(w) ?? w }] : [];
  });
  return (
    <div style={style} className="fixed z-50 max-h-[70vh] w-72 overflow-y-auto pl-1">
      <div className="rounded-md border bg-popover p-1 shadow-lg">
        {wss.filter(t => rows.some(r => r.top === t)).map(t => (
          <div key={t.workspace_id}>
            <div className="truncate px-2 pt-1 pb-0.5 text-[0.6875rem] font-semibold text-muted-foreground">{t.label}</div>
            {rows.filter(r => r.top === t).map(({ p, w }) => {
              const tabs = data.tabs.filter(x => x.workspace_id === w.workspace_id);
              const where = [w !== t && w.label, tabs.length > 1 && `탭 ${tabs.find(x => x.tab_id === p.tab)?.label ?? ''}`].filter(Boolean).join(' · ');
              return (
                <a key={p.id} href={`#/herdr/${p.id}`} onClick={onPick} className="block rounded px-2 py-1 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none">
                  <span className="flex items-center gap-2 text-xs"><Kind agent={p.agent} /><span className="truncate">{paneText(p)}</span></span>
                  {where && <span className="block truncate pl-5.5 text-[0.6875rem] text-muted-foreground">{where}</span>}
                </a>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
export function SideFooter({ brand, ready }: { brand: string; ready: boolean }) {
  const v = useView().data?.version;
  return (
    <div className="mx-1.5 mb-1.5 flex shrink-0 items-center justify-between border-t px-2.5 pt-1.5 text-[0.625rem] font-semibold tracking-[0.12em] text-muted-foreground/70 uppercase">
      <span>{brand}{v && ` v${v}`}</span><span>{ready ? 'Local · Ready' : 'Local · herdr 꺼짐'}</span>
    </div>
  );
}

// 다른 기기 — EDITH 는 이 기기의 herdr 만 본다. machines.json 에 둔 기기는 SSH 터널로 그 기기의 EDITH 를 새 탭으로 연다(서버 machines.ts).
// 「+ 다른 기기 잇기」 — Tailscale 기기를 고르고 그 기기 사용자 이름·비밀번호를 넣으면 SSH 키를 등록하고 목록에 더한다(비밀번호는 한 번 쓰고 버린다).
export function OtherDevices() {
  const { data = [] } = useQuery({ queryKey: ['machines'], queryFn: () => get<string[]>('/api/machines'), staleTime: 60_000 });
  const [busy, setBusy] = useState<string | null>(null), [adding, setAdding] = useState(false), remote = useView().data?.remote;
  const open = (name: string) => {
    const w = window.open('', '_blank');   // 누른 순간 먼저 열어 둔다 — 터널을 기다린 뒤 열면 팝업 막힘에 걸린다
    if (w) w.opener = null;
    setBusy(name);
    void post<{ url: string }>('/api/machines/open', { name })
      .then(r => { if (w) w.location.href = r.url; }, (e: Error) => { w?.close(); toast(`${name} 을 열지 못했다 — ${e.message}`, 6000); })
      .finally(() => setBusy(null));
  };
  if (remote) return null;   // 원격 화면 안에서 또 다른 기기로 넘어가면 헷갈린다 — 이 기기 EDITH 에서만
  const row = 'flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[0.8125rem] text-muted-foreground hover:bg-card hover:text-foreground';
  return (
    <div className="m-1.5 mt-0 shrink-0 border-t pt-1.5">
      <div className="px-2.5 pb-0.5 text-[0.6875rem] font-semibold text-muted-foreground">다른 기기</div>
      {data.map(n => (
        <button key={n} onClick={() => open(n)} disabled={busy === n} title={`${n} 의 EDITH 를 SSH 터널로 새 탭에 연다`} className={`${row} disabled:opacity-60`}>
          <Icon className="size-4">{REMOTE}</Icon><span className="truncate">{n}</span>
          <span className="ml-auto text-xs text-muted-foreground/70">{busy === n ? '여는 중…' : 'EDITH ↗'}</span>
        </button>
      ))}
      {adding ? <ConnectForm onClose={() => setAdding(false)} /> : (
        <button onClick={() => setAdding(true)} className={row}><span className="w-4 text-center text-base leading-none">+</span>다른 기기 잇기</button>
      )}
    </div>
  );
}

type Peer = { host: string; dns: string; os: string; online: boolean };
function ConnectForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['peers'], queryFn: () => get<{ tailscale: boolean; peers: Peer[]; user: string }>('/api/machines/peers') });
  const [host, setHost] = useState(''), [user, setUser] = useState(''), [name, setName] = useState(''), [pw, setPw] = useState(''), [busy, setBusy] = useState(false);
  const peers = [...(data?.peers ?? [])].sort((a, b) => Number(b.online) - Number(a.online));
  const peer = peers.find(p => p.dns === host);
  const go = () => {
    setBusy(true);
    void post<{ log: string[] }>('/api/machines/connect', { name: name.trim() || peer?.host || host.split('.')[0], target: `${user.trim() || data?.user}@${host.trim()}`, password: pw })
      .then(r => { toast(r.log.at(-1) ?? '이었다', 6000); setPw(''); void qc.invalidateQueries({ queryKey: ['machines'] }); onClose(); },
        (e: Error) => toast(e.message, 7000))
      .finally(() => setBusy(false));
  };
  const input = 'w-full rounded-md border bg-card px-2 py-1 text-[0.8125rem] outline-none focus:ring-2 focus:ring-ring/50';
  return (
    <form onSubmit={e => { e.preventDefault(); go(); }} className="space-y-1.5 rounded-md border bg-card/60 p-2 text-[0.8125rem]">
      <div className="flex items-center font-semibold">다른 기기 잇기<button type="button" onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground">×</button></div>
      {data && !data.tailscale && <p className="text-xs text-muted-foreground">Tailscale 이 없거나 꺼져 있다 — 주소를 직접 넣는다(회사 VPN 안의 주소 등)</p>}
      {peers.length > 0 && (
        <select value={peer ? host : ''} onChange={e => setHost(e.target.value)} className={input}>
          <option value="">Tailscale 기기 고르기…</option>
          {peers.map(p => <option key={p.dns} value={p.dns}>{p.host} · {p.os}{p.online ? '' : ' (꺼짐)'}</option>)}
        </select>
      )}
      <input value={host} onChange={e => setHost(e.target.value)} placeholder="주소(Tailscale 이름·IP)" className={input} />
      <input value={user} onChange={e => setUser(e.target.value)} placeholder={`그 기기 사용자 이름 (${data?.user ?? ''})`} className={input} />
      <input value={name} onChange={e => setName(e.target.value)} placeholder={`여기 보일 이름 (${peer?.host ?? '예: 회사'})`} className={input} />
      <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="그 기기 로그인 비밀번호(처음 한 번)" autoComplete="off" className={input} />
      <p className="text-[0.6875rem] leading-snug text-muted-foreground">그 기기에서 System Settings → General → Sharing → Remote Login 이 켜져 있어야 한다. 비밀번호는 SSH 키를 등록할 때 한 번만 쓰고 저장하지 않는다. 그 기기에 EDITH 가 떠 있어야 열린다.</p>
      <button disabled={busy || !host.trim()} className="w-full rounded-md border bg-primary px-2 py-1 font-semibold text-primary-foreground disabled:opacity-50">{busy ? '잇는 중…' : '잇기'}</button>
    </form>
  );
}

// 폴더 입력 — 셸 탭 완성처럼 하위 폴더를 추천한다(Tab 이면 첫 추천). 새 워크스페이스 · 새 런이 같이 쓴다.
export function FolderInput({ value, onChange, onKeyDown, placeholder, className }: {
  value: string; onChange: (v: string) => void; onKeyDown?: (e: React.KeyboardEvent) => void; placeholder?: string; className?: string;
}) {
  const [focus, setFocus] = useState(false);
  const sug = useQuery({
    queryKey: ['folders', value], queryFn: () => get<string[]>(`/api/herdr/folders?q=${encodeURIComponent(value)}`),
    enabled: focus, placeholderData: keepPreviousData,
  });
  return (
    <div>
      <input placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} className={className}
        onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)}
        onKeyDown={e => { if (e.key === 'Tab' && sug.data?.[0]) { e.preventDefault(); onChange(`${sug.data[0]}/`); } else onKeyDown?.(e); }} />
      {/* 추천은 입력칸 아래에 끼워 넣는다(아래 버튼을 덮지 않게). 친 경로 그대로 하나만 남으면 숨긴다 */}
      {focus && !!sug.data?.length && !(sug.data.length === 1 && sug.data[0] === value.replace(/\/$/, '')) && (
        <div className="mt-1 max-h-40 w-full overflow-y-auto rounded-md border bg-popover p-1">
          {sug.data.map(f => (
            <button key={f} onMouseDown={e => { e.preventDefault(); onChange(`${f}/`); }} className="block w-full truncate rounded px-2 py-0.5 text-left font-mono text-xs hover:bg-muted">{f}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// 새 워크스페이스 — 이름과 시작 폴더(FolderInput). 만들면 그 첫 pane 으로 간다.
export function NewWorkspace() {
  const move = useMove();
  const [open, setOpen] = useState(false), [label, setLabel] = useState(''), [cwd, setCwd] = useState('~/');
  const create = async () => { if (label.trim() && await move('/api/herdr/workspaces', { label, cwd })) { setOpen(false); setLabel(''); } };
  const enter = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void create(); } if (e.key === 'Escape') setOpen(false); };
  if (!open) return <button onClick={() => setOpen(true)} className="mb-1 flex h-8 w-full items-center gap-2 rounded-md border border-dashed px-2.5 text-left text-[0.8125rem] text-muted-foreground hover:border-primary/40 hover:bg-card hover:text-foreground"><span className="text-base leading-none">+</span>새 워크스페이스</button>;
  const input = 'w-full rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring/50';
  return (
    <div className="mb-1 space-y-2 rounded-lg border bg-card p-2.5 shadow-sm">
      <input autoFocus placeholder="이름" value={label} onChange={e => setLabel(e.target.value)} onKeyDown={enter} className={input} />
      <FolderInput placeholder="시작 폴더 (~/…)" value={cwd} onChange={setCwd} onKeyDown={enter} className={`${input} font-mono text-xs`} />
      <div className="flex gap-2">
        <Button size="sm" className="h-7" disabled={!label.trim()} onClick={() => void create()}>만들기</Button>
        <Button size="sm" variant="outline" className="h-7" onClick={() => setOpen(false)}>취소</Button>
      </div>
    </div>
  );
}

// 링크 워크트리 워크스페이스의 위(같은 레포의 본 워크스페이스) — 없으면 맨 위 단. 트리와 상태 목록이 같이 쓴다.
const parentOf = (wss: HWorkspace[]) => {
  const main = new Map(wss.filter(w => w.worktree && !w.worktree.is_linked_worktree).map(w => [w.worktree!.repo_key, w]));
  return (w: HWorkspace) => w.worktree?.is_linked_worktree ? main.get(w.worktree.repo_key) : undefined;
};

// 사이드바 — herdr 와 같은 레포 트리. 레포 워크스페이스 밑에 그 레포의 링크 워크트리를 붙이고, 각 아래에 pane.
// 레포 워크스페이스가 안 열린 워크트리는 맨 위 단에 둔다. 순서는 herdr 번호.
export function Tree({ data, sel }: { data: HerdrView; sel?: string }) {
  const wss = [...data.workspaces].sort((a, b) => a.number - b.number), childOf = parentOf(wss);
  return wss.filter(w => !childOf(w)).map(w => (
    <Node key={w.workspace_id} w={w} data={data} sel={sel} depth={0}>
      {wss.filter(c => childOf(c) === w).map(c => <Node key={c.workspace_id} w={c} data={data} sel={sel} depth={1} />)}
    </Node>
  ));
}

function Node({ w, data, sel, depth, children }: { w: HWorkspace; data: HerdrView; sel?: string; depth: number; children?: ReactNode[] }) {
  const move = useMove(), wsMenu = useWorkspaceMenu(data), tabMenu = useTabMenu();
  const [over, setOver] = useState<'pane' | 'ws' | null>(null);
  const tabs = data.tabs.filter(t => t.workspace_id === w.workspace_id).sort((a, b) => a.number - b.number);
  const panes = data.panes.filter(p => p.workspace === w.workspace_id);
  const kids = children?.length ?? 0;
  // 펼침·접힘은 누른 대로만 — 에이전트 상태·고른 pane 으로 바꾸지 않는다. 처음엔 접힘.
  // 이 탭에만 기억한다(sessionStorage — 다른 탭과 따로 놀고, 새로 고침해도 남는다. 저장이 막혀도 동작).
  const key = `edith.ws.${w.workspace_id}`;
  const [pick, setPick] = useState(() => { try { return sessionStorage.getItem(key) === 'open'; } catch { return false; } });
  const toggle = () => setPick(v => { try { sessionStorage.setItem(key, v ? 'closed' : 'open'); } catch { /* 저장 안 됨 */ } return !v; });
  const open = depth > 0 || pick;
  const mine = panes.some(p => p.id === sel);
  return (
    // 펼친 워크스페이스는 카드로 묶고, 접힌 건 같은 높이의 한 줄. 하위(링크 워크트리)는 왼쪽 안내선 아래로 들인다.
    // 하위(링크 워크트리)는 처음부터 펼쳐 둔다. 위 워크스페이스를 펼치면 접어 둔 하위도 다시 다 펼친다(하나씩 누르지 않게).
    <details open={open} className={depth ? 'ml-4 border-l pl-1' : 'rounded-lg open:my-1.5 open:bg-card open:shadow-sm open:ring-1 open:ring-border'}
      onToggle={e => { if (e.target === e.currentTarget && e.currentTarget.open) e.currentTarget.querySelectorAll('details').forEach(d => { d.open = true; }); }}>
      <summary draggable onDragStart={e => { e.dataTransfer.setData(DRAG_WS, w.workspace_id); e.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={e => { const k = carrying(e, DRAG_PANE) ? 'pane' : carrying(e, DRAG_WS) ? 'ws' : null; if (!k) return; e.preventDefault(); setOver(k); }}
        onDragLeave={() => setOver(null)}
        onContextMenu={e => openMenu(e, wsMenu(w))}
        onClick={e => { if (depth) return; e.preventDefault(); toggle(); }}   // 맨 위 단은 React 가 쥔다 — 탭에 기억하려고
        onDrop={e => {
          e.preventDefault(); setOver(null);
          const pane = e.dataTransfer.getData(DRAG_PANE), ws = e.dataTransfer.getData(DRAG_WS);
          if (pane) void move(`/api/herdr/panes/${pane}/move`, { workspace: w.workspace_id });   // 이 워크스페이스의 새 탭으로
          else if (ws && ws !== w.workspace_id) void move(`/api/herdr/workspaces/${ws}/move`, { before: w.workspace_id });   // 이 워크스페이스 앞으로
        }}
        title="끌어서 순서 바꾸기 · pane 을 여기 놓으면 이 워크스페이스의 새 탭으로"
        className={`flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md px-1.5 text-[0.8125rem] select-none hover:bg-muted/70 [&::-webkit-details-marker]:hidden ${over === 'ws' ? 'shadow-[inset_0_2px_0_var(--primary)]' : ''} ${over === 'pane' ? 'bg-primary/15' : ''}`}>
        <svg viewBox="0 0 16 16" className="size-3 shrink-0 text-muted-foreground/60 transition-transform [[open]>summary>&]:rotate-90" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 4 4 4-4 4" /></svg>
        <span className={`truncate ${mine ? 'font-semibold text-foreground' : 'font-medium text-foreground/90'}`}>{w.label}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-1">
          {w.agent_status && w.agent_status !== 'idle' && STATUS[w.agent_status] && <State v={w.agent_status} />}
          {kids > 0 && <span className="min-w-4 rounded-full bg-muted px-1 text-center text-[0.625rem] leading-4 text-muted-foreground tabular-nums">{kids}</span>}
        </span>
      </summary>
      <div className="pb-1.5">
        {tabs.map(t => (
          <div key={t.tab_id}>
            {tabs.length > 1 && (
              <div onContextMenu={e => openMenu(e, tabMenu(w, t))}
                className={`flex items-center gap-2 pt-1.5 pr-3 pb-0.5 text-[0.65625rem] font-medium text-muted-foreground/70 after:h-px after:flex-1 after:bg-border ${depth ? 'pl-7.5' : 'pl-6.5'}`}>탭 {t.label}</div>
            )}
            {panes.filter(p => p.tab === t.tab_id).map(p => <PaneRow key={p.id} p={p} on={p.id === sel} depth={depth} text={paneText(p)} />)}
          </div>
        ))}
        {children}
      </div>
    </details>
  );
}

// 워크스페이스 줄 상태 — 알약 대신 점 + 글자(줄 높이를 안 늘린다).
const STATE_TONE: Record<string, string> = { working: 'text-sky-600 dark:text-sky-400', blocked: 'text-amber-600 dark:text-amber-400', done: 'text-emerald-600 dark:text-emerald-400' };
function State({ v }: { v: string }) {
  return (
    <span className={`flex items-center gap-1 text-[0.6875rem] font-medium ${STATE_TONE[v] ?? 'text-muted-foreground'}`}>
      <span className={`size-1.5 rounded-full ${DOT[v] ?? 'bg-muted-foreground/40'} ${v === 'working' || v === 'blocked' ? 'animate-pulse' : ''}`} />{STATUS[v]}
    </span>
  );
}

function PaneRow({ p, on, depth, text }: { p: HPane; on: boolean; depth: number; text: string }) {
  const menu = usePaneMenu();
  return (
    <a href={`#/herdr/${p.id}`} title={`${p.agent ?? '셸'} · ${p.id} · ${p.cwd}`} draggable
      onDragStart={e => { e.dataTransfer.setData(DRAG_PANE, p.id); e.dataTransfer.effectAllowed = 'move'; }}
      onContextMenu={e => openMenu(e, menu(p))}
      className={`mx-1 flex h-8 items-center gap-2 rounded-lg border pr-2 text-xs ${depth ? 'ml-5 pl-2' : 'ml-4 pl-2'} ${on ? 'border-primary/70 bg-accent font-medium text-accent-foreground shadow-sm' : 'border-transparent hover:bg-muted/70'}`}>
      <span className={`size-2 shrink-0 rounded-full ${DOT[p.status ?? ''] ?? 'bg-muted-foreground/25'} ${p.status === 'working' || p.status === 'blocked' ? 'animate-pulse' : ''}`} />
      <Kind agent={p.agent} />
      <span className={`truncate ${p.agent || on ? '' : 'text-muted-foreground'}`}>{text}</span>
      {p.status === 'blocked' && <span className="ml-auto shrink-0 rounded-full bg-amber-500/15 px-1.5 text-[0.625rem] font-semibold text-amber-700 dark:text-amber-400">승인 대기</span>}
    </a>
  );
}
