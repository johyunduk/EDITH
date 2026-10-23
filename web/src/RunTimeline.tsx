// 런 타임라인 — 런 화면 기본 보기(카드 덱). 서버가 노드 상태 기록으로 만든 시도 · 줄(src/timeline.ts)을 체인(노드가 든 체인)마다 묶는다.
// 지금 체인(갈래마다 — 도는 노드나 확인 필요 노드가 있는 체인)을 큰 카드로, 그 앞에 마지막으로 끝난 체인 하나, 뒤에 다음 체인 둘만 펼치고 나머지는 앞뒤 덱으로 접는다.
// 덱을 누르면 체인마다 카드로 펼치고, 끝난 체인 카드를 누르면 그 체인의 줄이 나온다. 지금 체인 카드는 스킬 노드 줄(명령 노드는 숨김) — 줄을 누르면 그 노드 자세히(detail).
// 열 때와 지금 체인이 바뀔 때 지금 체인 카드로 화면을 옮긴다.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from './api.ts';
import { Empty } from './ui.tsx';
import { NODE, type NodeState } from './StepFlow.tsx';
import { chainView, claudeChip, dur, short, type ClaudeUsed } from './runFlow.ts';
import type { FlowStep } from './stepFlow.ts';

export type Entry = {
  kind: 'node' | 'pass' | 'skip' | 'rewind' | 'phase'; t: number; keys: string[]; titles: string[];
  place?: string; tone?: 'now' | 'done' | 'warn' | 'fail'; state?: NodeState; how?: NodeState; attempt?: number; fixOnly?: boolean; work?: number; human?: number; text?: string;
  line?: string;   // 사람용 한 줄(결과 파일 「한줄」)
  claude?: ClaudeUsed;   // 그 시도에 띄운 Claude 설정 · 이유(판단자 등)
};
type Node = { state: NodeState; attempt: number; summary?: string; line?: string; reason?: string };
type RunLike = { state: string; steps: FlowStep[]; nodes: Record<string, Node>; timeline?: Entry[]; pane?: string; panes?: Record<string, { pane?: string }> };
type ChatItem = { kind: string; text: string };

const hm = (t: number) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
const TL_DOT = { now: 'size-2.5 bg-sky-500 animate-pulse', done: 'size-2 bg-emerald-500', warn: 'size-2 bg-amber-500', fail: 'size-2 bg-rose-500' };
const TL_CARD = { now: 'border-sky-500/60 bg-sky-500/5', done: 'bg-card', warn: 'border-amber-500/50 bg-amber-500/5', fail: 'border-rose-500/40 bg-rose-500/5' };
const TL_LINE = { pass: 'size-1.5 bg-muted-foreground/40', skip: 'size-1.5 bg-muted-foreground/40', rewind: 'size-2 bg-amber-500', phase: 'size-2 bg-primary' };
const ACTIVE: NodeState[] = ['running', 'sending', 'blocked'];
const CHIP = 'rounded-full px-2 py-px text-[0.6875rem] font-semibold';
const AMBER = 'bg-amber-500/15 text-amber-800 dark:text-amber-300';
const SKY = 'bg-sky-500/10 text-sky-800 dark:text-sky-300';   // Claude 설정 칩
const CARD = 'block w-full rounded-xl border px-3.5 py-2.5 text-left hover:border-primary/60';   // 노드 · 단계 · 덱 카드가 같은 꼴

// 펼침 · 접힘 — 높이를 0fr ↔ 1fr 로 움직인다. 접힌 동안은 inert(누르기 · 탭 이동 안 됨)
function Fold({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`} inert={!open}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

export function RunTimeline({ r, sel, pick, detail }: { r: RunLike; sel: string | null; pick: (k: string) => void; detail: (bare: boolean) => ReactNode }) {
  const list = r.timeline ?? [], by = new Map(r.steps.map(s => [s.key, s]));
  const [pastOpen, setPastOpen] = useState(false), [nextOpen, setNextOpen] = useState(false), [open, setOpen] = useState<Set<string>>(new Set());
  const [opens, setOpens] = useState(0);   // 덱을 펼친 횟수 — 펼칠 때마다 카드 움직임을 다시
  const [cmds, setCmds] = useState<Set<string>>(new Set());   // 이름을 펼친 「명령 N개 통과」 줄
  // 지금 — 도는 시도, 또는 지금 확인 필요인 시도(갈래마다 하나)
  const isNow = (e: Entry) => e.tone === 'now' || (e.tone === 'warn' && r.nodes[e.keys[0]]?.state === e.how && r.nodes[e.keys[0]]?.attempt === e.attempt);
  const nowEs = list.filter(e => e.kind === 'node' && isNow(e));
  const endAt = (k: string) => Math.max(0, ...list.filter(e => e.keys.includes(k)).map(e => e.t + (e.work ?? 0) + (e.human ?? 0)));
  const v = chainView(r.steps, k => r.nodes[k], endAt, nowEs.map(e => e.keys[0]), r.state === 'done');
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: 'center' }); }, [v.now.join()]);
  if (!r.timeline) return <Empty>서버가 옛 코드라 타임라인이 없다 — 머리줄 「새 코드 · 다시 켜기」 뒤에 보인다. 그동안은 「캔버스」 로 본다.</Empty>;
  if (!list.length) return <Empty>이 런은 노드 기록(events.jsonl)이 없어 타임라인을 못 만든다 — 「캔버스」 로 본다.</Empty>;

  const at = sel ? list.findLastIndex(e => e.kind !== 'rewind' && e.keys.includes(sel)) : -1;
  const nameOf = (k: string) => by.get(k)?.boxes?.at(-1)?.name ?? by.get(k)?.lane ?? k;
  const placeOf = (k: string) => by.get(k)?.boxes?.slice(0, -1).map(b => b.name).join(' › ') ?? '';
  // 끝난 체인마다 그 체인의 줄 — 되돌림 줄(키 없음)은 바로 앞 줄의 체인에
  const groups = (cs: string[]) => {
    const out = new Map<string, { id: string; name: string; es: Entry[] }>(cs.map(c => [c, { id: c, name: nameOf(v.keys(c)[0] ?? c), es: [] }]));
    let prev: string | undefined;
    for (const e of list) {
      if (e.kind === 'phase') continue;
      const c = e.keys[0] ? v.of(e.keys[0]) : prev;
      prev = c;
      if (c) out.get(c)?.es.push(e);
    }
    return [...out.values()].filter(g => g.es.length);
  };
  const human = (es: Entry[]) => es.reduce((a, e) => a + (e.human ?? 0), 0), warns = (es: Entry[]) => es.filter(e => e.tone === 'warn' || e.tone === 'fail').length;
  const past = groups(v.done.slice(0, -1)), lastDone = groups(v.done.slice(-1))[0];
  const lines = past.flatMap(g => g.es).sort((a, b) => a.t - b.t), lastLine = lines.at(-1);
  const next = v.ahead.slice(0, 2), rest = v.ahead.slice(2);
  const skillTitles = (c: string) => v.keys(c).map(k => by.get(k)!).filter(s => s.kind === 'skill').map(s => s.title);
  const cmdCount = (c: string) => v.keys(c).filter(k => by.get(k)?.kind === 'command').length;

  // 여럿을 묶은 줄 — 노드 이름마다 눌러 고른다
  const names = (e: Entry) => e.keys.map((k, i) => (
    <span key={k}>{i > 0 && ' · '}<button type="button" onClick={() => pick(k)} className="underline-offset-2 hover:text-foreground hover:underline">{e.titles[i]}</button></span>
  ));
  const tags = (e: Entry) => {
    const n = r.nodes[e.keys[0]], out: [string, string][] = [];
    if (e.tone === 'warn' && e.how) out.push([n?.attempt === e.attempt && n.state === e.how ? NODE[e.how][0] : `${NODE[e.how][0]}였음`, AMBER]);
    if (e.tone === 'fail') out.push(['실패 → 고치는 노드', 'bg-rose-500/15 text-rose-700 dark:text-rose-300']);
    if ((e.attempt ?? 0) > 1) out.push([`${e.attempt}번째 시도`, 'bg-muted text-muted-foreground']);
    if (e.human) out.push([`사람 ${dur(e.human)}`, 'bg-muted text-muted-foreground']);
    return out;
  };
  // 카드에 보일 한 줄 — 「한줄」, 없으면 요약 첫 문장. 덱 맨 위 줄은 줄 종류마다
  const head = (e: Entry) => e.line ?? short(e.text);
  const gist = (e: Entry) => e.kind === 'node' ? `${e.titles[0]}${head(e) ? ` — ${head(e)}` : ''}` : e.kind === 'pass' ? (e.keys.length > 1 ? `명령 ${e.keys.length}개 통과` : `$ ${e.titles[0]} 통과`)
    : e.kind === 'skip' ? `건너뜀 ${e.titles.join(' · ')}` : e.kind === 'rewind' ? `되돌림 → ${e.titles[0]}` : e.titles[0];
  const ek = (e: Entry) => `${e.t}:${e.keys.join()}`;
  // 펼친 체인 안의 줄(자리는 그 체인이라 뺀다)
  const item = (e: Entry, i: number) => (
    <li key={`${e.kind}:${e.keys.join()}:${e.t}`} className="flex gap-2.5">
      <Rail time={hm(e.t)} dot={e.kind === 'node' ? TL_DOT[e.tone!] : TL_LINE[e.kind]} />
      <div className="min-w-0 flex-1 pb-2">
        {e.kind === 'node' ? (
          <button type="button" onClick={() => pick(e.keys[0])} aria-expanded={i === at} className={`${CARD} ${TL_CARD[e.tone!]} ${i === at ? 'ring-2 ring-primary/40' : ''}`}>
            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-sm font-semibold">{e.fixOnly ? '↳ ' : ''}{e.titles[0]}</span>
              {tags(e).map(([t, c]) => <span key={t} className={`${CHIP} ${c}`}>{t}</span>)}
              {e.claude && <span title={e.claude.why} className={`${CHIP} ${SKY}`}>{claudeChip(e.claude)}</span>}
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">{e.work ? dur(e.work) : ''}</span>
            </span>
            {head(e) && <span className="mt-1 block truncate text-sm text-foreground/85">{head(e)}</span>}
            {i === at && e.text && e.text !== head(e) && <span className="mt-1.5 block text-sm whitespace-pre-wrap text-muted-foreground">{e.text}</span>}
          </button>
        ) : e.kind === 'rewind' ? (
          <p className="pt-2 text-[0.8125rem] text-amber-800 dark:text-amber-300"><span className="font-semibold">되돌림 → {e.titles[0]}</span> — {e.text}</p>
        ) : e.kind === 'pass' && e.keys.length > 1 && !cmds.has(ek(e)) ? (
          <button type="button" onClick={() => setCmds(s => new Set(s).add(ek(e)))} className="pt-2 text-left text-[0.8125rem] text-muted-foreground hover:text-foreground">
            <span className="font-mono text-xs">$ </span>명령 {e.keys.length}개 통과 <span className="text-xs">▸</span>
          </button>
        ) : (
          <p className="pt-2 text-[0.8125rem] text-muted-foreground">
            {e.kind === 'pass' ? <span className="font-mono text-xs">$ </span> : <span className="font-semibold">건너뜀 </span>}{names(e)}{e.kind === 'pass' ? ' 통과' : ''}{e.kind === 'skip' && e.text ? ` — ${short(e.text)}` : ''}
          </p>
        )}
        {i === at && <div className="mt-2 animate-fan">{detail(e.kind === 'node')}</div>}
      </div>
    </li>
  );
  const flip = (g: string) => { setOpen(s => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n; }); };
  const flipPast = (v: boolean) => { setPastOpen(v); if (v) setOpens(n => n + 1); };
  const flipNext = (v: boolean) => { setNextOpen(v); if (v) setOpens(n => n + 1); };
  // 덱을 여닫는 막대 — 펼친 덱의 맨 위 · 맨 아래
  const bar = (label: string, close: () => void) => (
    <li className="flex gap-2.5">
      <Rail dot="size-1.5 bg-muted-foreground/40" />
      <div className="min-w-0 flex-1 pb-2">
        <button type="button" onClick={close} aria-expanded className="flex w-full items-baseline gap-2.5 rounded-xl bg-muted px-3.5 py-2 text-left hover:bg-muted/70">
          <span className="text-sm font-semibold">{label}</span><span className="ml-auto text-xs font-semibold text-accent-foreground">덱 접기 ▴</span>
        </button>
      </div>
    </li>
  );
  // 끝난 체인 카드 — 누르면 그 체인의 줄
  const doneChain = (g: { id: string; name: string; es: Entry[] }, gi: number) => {
    const steps = v.keys(g.id).map(k => by.get(k)!).filter(s => !s.fixOnly), skipped = steps.every(s => r.nodes[s.key].state === 'skipped'), skills = steps.filter(s => s.kind === 'skill').length;
    // 대표 결과 — 끝난 스킬 노드 중 마지막(1분 넘게 일한 것 먼저 — 할 일 없이 넘어간 노드를 피한다)
    const done1 = [...g.es].reverse().filter(e => e.kind === 'node' && e.tone === 'done' && !e.fixOnly && head(e));
    const lastNode = done1.find(e => (e.work ?? 0) >= 60_000) ?? done1[0], track = steps.every(s => s.track && s.track === steps[0].track) ? steps[0]?.track : undefined;
    const h = human(g.es), w = warns(g.es), on = open.has(g.id), end = Math.max(...g.es.map(e => e.t + (e.work ?? 0) + (e.human ?? 0)));
    return (
      <li key={g.id} className="list-none animate-fan" style={{ animationDelay: `${gi * 40}ms` }}>
        <div className="flex gap-2.5">
          <Rail time={hm(g.es[0].t)} dot={skipped ? 'size-2 bg-muted-foreground/40' : 'size-2 bg-emerald-500'} />
          <div className="min-w-0 flex-1 pb-2">
            <button type="button" onClick={() => flip(g.id)} aria-expanded={on} className={`${CARD} bg-card ${on ? 'border-primary/40' : ''}`}>
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                {track && <span className="rounded-md bg-violet-500/12 px-1.5 font-mono text-[0.6875rem] font-semibold text-violet-700 dark:text-violet-300">{track}</span>}
                <span className={`text-sm font-semibold ${skipped ? 'text-muted-foreground' : ''}`}>{g.name}</span>
                <span className="text-xs text-muted-foreground">{skipped ? '건너뜀' : skills ? `노드 ${skills}` : `명령 ${steps.length}`}</span>
                {w > 0 && <span className={`${CHIP} ${AMBER}`}>막힘 · 실패 {w}</span>}
                {h >= 60_000 && <span className={`${CHIP} bg-muted text-muted-foreground`}>사람 {dur(h)}</span>}
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">{skipped ? '' : dur(end - g.es[0].t)}</span>
                <span className={`text-xs text-muted-foreground transition-transform ${on ? 'rotate-90' : ''}`} aria-hidden>›</span>
              </span>
              {lastNode && <span className="mt-1 block truncate text-sm text-foreground/85"><span className="text-muted-foreground">{lastNode.titles[0]} — </span>{head(lastNode)}</span>}
            </button>
          </div>
        </div>
        <Fold open={on}><ol>{g.es.map(e => item(e, list.indexOf(e)))}</ol></Fold>
      </li>
    );
  };

  // 모든 줄이 같은 꼴 — 왼쪽 시간 · 가운데 선과 점 · 오른쪽 카드(Rail). 덱도 그 칸 안에서 쌓인다.
  // 브라우저가 스크롤을 타임라인 안 요소에 맞춰 옮기지 않게(overflow-anchor) — 펼치면 누른 자리에서 아래로 밀어낸다
  return (
    <ol aria-label="일어난 일 — 지금 체인이 가운데" className="[overflow-anchor:none]">
      {lines.length > 0 && (
        <li className="list-none">
          <Fold open={!pastOpen}>
            <div className="flex gap-2.5">
              <Rail time={hm(lines[0].t)} dot="size-2 bg-emerald-500 ring-[3px] ring-emerald-500/20" />
              <div className="min-w-0 flex-1 pb-2">
                <button type="button" onClick={() => flipPast(true)} aria-expanded={false} aria-label={`지난 체인 ${past.length}개 펼치기`} className="relative block h-[6.25rem] w-full text-left">
                  {past.slice(-3, -1).map((g, i) => (
                    <span key={g.id} aria-hidden className="absolute h-12 truncate rounded-xl border bg-card px-3.5 pt-1.5 text-[0.6875rem] text-muted-foreground"
                      style={{ left: (2 - i) * 18, right: (2 - i) * 18, top: i * 14, opacity: 0.55 + i * 0.25 }}>{hm(g.es[0].t)} · {g.name}</span>
                  ))}
                  <span className={`absolute inset-x-0 top-7 ${CARD} bg-card shadow-sm hover:border-primary/60`}>
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold">지난 체인 {past.length}개</span>
                      <span className="text-xs text-muted-foreground">{hm(lines[0].t)} – {hm(lastLine!.t)}</span>
                      {warns(lines) > 0 && <span className={`${CHIP} ${AMBER}`}>막힘 · 실패 {warns(lines)}</span>}
                      {human(lines) >= 60_000 && <span className={`${CHIP} bg-muted text-muted-foreground`}>사람 {dur(human(lines))}</span>}
                      <span className="ml-auto text-xs font-semibold text-accent-foreground">덱 펼치기 ▾</span>
                    </span>
                    <span className="mt-1 block truncate text-sm text-foreground/85">{past.map(g => g.name).join(' · ')}</span>
                  </span>
                </button>
              </div>
            </div>
          </Fold>
          <Fold open={pastOpen}>
            <ol key={opens}>
              {bar(`지난 체인 ${past.length}개 · ${hm(lines[0].t)} – ${hm(lastLine!.t)}`, () => flipPast(false))}
              {past.map(doneChain)}
            </ol>
          </Fold>
        </li>
      )}

      {lastDone && doneChain(lastDone, 0)}

      {v.now.map((c, i) => {
        const keys = v.keys(c), nowE = nowEs.find(e => keys.includes(e.keys[0])), t = list.find(e => e.keys[0] && keys.includes(e.keys[0]))?.t;
        const n = nowE && r.nodes[nowE.keys[0]], ask = !!n && !ACTIVE.includes(n.state);
        return (
          <li key={c} ref={i === 0 ? ref : undefined} className="flex gap-2.5">
            <Rail time={t ? hm(t) : ''} dot={!nowE ? 'size-2.5 bg-muted-foreground/50' : ask ? 'size-2.5 bg-amber-500 ring-[3px] ring-amber-500/20' : 'size-2.5 bg-sky-500 ring-[3px] ring-sky-500/20'} dashed={i === v.now.length - 1 && v.ahead.length > 0} />
            <div className="min-w-0 flex-1 pb-3">
              <ChainCard r={r} steps={keys.map(k => by.get(k)!)} name={nameOf(keys[0])} place={placeOf(keys[0])} nowE={nowE} sel={sel} pick={pick} detail={detail} />
            </div>
          </li>
        );
      })}

      {next.map(c => (
        <li key={c} className="flex gap-2.5">
          <Rail time="다음" dot="size-2 border-[1.5px] border-muted-foreground/50" dashed />
          <div className="min-w-0 flex-1 pb-2">
            <div className={`${CARD} border-dashed bg-card/60`}>
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                {by.get(v.keys(c)[0])?.track && <span className="rounded-md bg-violet-500/12 px-1.5 font-mono text-[0.6875rem] font-semibold text-violet-700 dark:text-violet-300">{by.get(v.keys(c)[0])!.track}</span>}
                <span className="text-sm font-semibold text-foreground/80">{nameOf(v.keys(c)[0] ?? c)}</span>
                <span className="text-xs text-muted-foreground">{placeOf(v.keys(c)[0] ?? c)}</span>
              </span>
              <span className="mt-1 block truncate text-sm text-muted-foreground">{[...skillTitles(c), ...(cmdCount(c) ? [`명령 ${cmdCount(c)}`] : [])].join(' · ')}</span>
            </div>
          </div>
        </li>
      ))}

      {rest.length > 0 && (
        <li className="list-none">
          <Fold open={!nextOpen}>
            <div className="flex gap-2.5">
              <Rail dot="size-2 border-[1.5px] border-muted-foreground/50" dashed />
              <div className="min-w-0 flex-1 pb-2">
                <button type="button" onClick={() => flipNext(true)} aria-expanded={false} className="relative block h-[5.5rem] w-full text-left">
                  <span aria-hidden className="absolute inset-x-9 top-10 h-10 rounded-b-xl border border-t-0 border-dashed bg-card/60 opacity-60" />
                  <span aria-hidden className="absolute inset-x-[1.125rem] top-7 h-10 rounded-b-xl border border-t-0 border-dashed bg-card/70 opacity-80" />
                  <span className={`absolute inset-x-0 top-0 ${CARD} border-dashed bg-card hover:border-primary/60`}>
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold text-foreground/80">남은 체인 {rest.length}개</span>
                      <span className="ml-auto text-xs font-semibold text-accent-foreground">덱 펼치기 ▾</span>
                    </span>
                    <span className="mt-1 block truncate text-sm text-muted-foreground">{rest.map(c => nameOf(v.keys(c)[0] ?? c)).join(' · ')}</span>
                  </span>
                </button>
              </div>
            </div>
          </Fold>
          <Fold open={nextOpen}>
            <ol key={opens}>
              {rest.map((c, i) => (
                <li key={c} className="flex gap-2.5 animate-fan" style={{ animationDelay: `${i * 40}ms` }}>
                  <Rail dot="size-2 border-[1.5px] border-muted-foreground/50" dashed />
                  <div className="min-w-0 flex-1 pb-2">
                    <div className={`${CARD} border-dashed bg-card/60`}>
                      <span className="flex items-baseline gap-2"><span className="text-sm font-semibold text-foreground/80">{nameOf(v.keys(c)[0] ?? c)}</span><span className="text-xs text-muted-foreground">{placeOf(v.keys(c)[0] ?? c)}</span></span>
                      <span className="mt-1 block text-sm text-muted-foreground">{[...skillTitles(c), ...(cmdCount(c) ? [`명령 ${cmdCount(c)}`] : [])].join(' → ')}</span>
                    </div>
                  </div>
                </li>
              ))}
              {bar(`남은 체인 ${rest.length}개`, () => flipNext(false))}
            </ol>
          </Fold>
        </li>
      )}
    </ol>
  );
}

// 한 줄의 왼쪽 — 시간 · 가운데 선과 점(갈 길은 점선). 타임라인의 모든 줄이 이 꼴이라 덱 · 단계 · 노드가 한 줄로 이어진다
function Rail({ time = '', dot, dashed }: { time?: string; dot: string; dashed?: boolean }) {
  return (
    <>
      <span className="w-11 shrink-0 pt-2.5 text-right text-xs text-muted-foreground tabular-nums">{time}</span>
      <span className="flex w-3 shrink-0 flex-col items-center">
        <span className={`mt-3.5 shrink-0 rounded-full ${dot}`} />
        <span className={`mt-1 flex-1 ${dashed ? 'w-0 border-l border-dashed border-muted-foreground/40' : 'w-px bg-border'}`} />
      </span>
    </>
  );
}

// 지금 체인 카드 — 몇 분째 · 스킬 노드 줄(명령 노드는 돌거나 막히거나 실패했을 때만, 나머지는 「보기」 로) · 도는 노드는 Claude 의 마지막 말.
// 노드 줄을 누르면 그 자리에 자세히(detail)
function ChainCard({ r, steps, name, place, nowE, sel, pick, detail }: {
  r: RunLike; steps: FlowStep[]; name: string; place: string; nowE?: Entry; sel: string | null; pick: (k: string) => void; detail: (bare: boolean) => ReactNode;
}) {
  const [cmd, setCmd] = useState(false);
  const k = nowE?.keys[0], n = k ? r.nodes[k] : undefined, ask = !!n && !ACTIVE.includes(n.state);
  const s0 = steps.find(x => x.key === k) ?? steps[0];
  const pane = s0.track ? r.panes?.[s0.track]?.pane : r.pane, live = !!k && s0.kind === 'skill' && !ask && !!pane;
  // 런 pane 대화(오른쪽 Claude 칸과 같은 것) — 노드마다 새 대화라 이 노드의 것
  const chat = useQuery({ queryKey: ['chat', pane], queryFn: () => get<{ items: ChatItem[] }>(`/api/herdr/panes/${pane}/chat`), enabled: live, refetchInterval: 3000 });
  const said = live ? chat.data?.items.findLast(x => x.kind === 'text')?.text : undefined;
  const last = new Map((r.timeline ?? []).filter(x => x.kind === 'node').map(x => [x.keys[0], x]));   // 노드마다 마지막 시도
  const start = Math.min(...steps.map(x => last.get(x.key)?.t ?? Infinity));
  const loud = (x: FlowStep) => ['running', 'sending', 'blocked', 'check'].includes(r.nodes[x.key].state) || last.get(x.key)?.tone === 'fail';
  const rows = steps.filter(x => x.kind === 'skill' || cmd || loud(x)), hidden = steps.filter(x => x.kind === 'command' && !loud(x)).length;
  const skills = steps.filter(x => x.kind === 'skill' && !x.fixOnly);
  const color = !nowE ? 'text-muted-foreground' : ask ? 'text-amber-700 dark:text-amber-300' : 'text-sky-700 dark:text-sky-300';
  return (
    <div className={`rounded-2xl border-[1.5px] bg-card px-5 py-4 ${!nowE ? '' : ask ? 'border-amber-500 shadow-lg ring-[6px] ring-amber-500/15' : 'border-sky-500 shadow-lg shadow-sky-500/5 ring-[6px] ring-sky-500/15'}`}>
      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className={`text-[0.6875rem] font-bold tracking-wider ${color}`}>{n ? `지금 · ${NODE[n.state][0]}` : '도는 중 — 다음 노드 차례'}</span>
        {s0.track && <span className="rounded-md bg-violet-500/12 px-1.5 font-mono text-[0.6875rem] font-semibold text-violet-700 dark:text-violet-300">{s0.track}</span>}
        {place && <span className="text-xs text-muted-foreground">{place}</span>}
        {Number.isFinite(start) && <span className={`ml-auto font-mono text-sm font-bold tabular-nums ${color}`}>{dur(Date.now() - start)}째</span>}
      </span>
      <span className="mt-1 block text-lg font-bold">{name}</span>
      {skills.length > 1 && (
        <span className="mt-2 flex gap-1" aria-label={`스킬 노드 ${skills.length}개 중 ${skills.filter(x => ['done', 'skipped'].includes(r.nodes[x.key].state)).length}개 끝`}>
          {skills.map(x => {
            const st = r.nodes[x.key].state;
            return <span key={x.key} title={x.title} className={`h-1.5 flex-1 rounded-full ${x.key === k ? (ask ? 'bg-amber-500' : 'bg-sky-500') : st === 'done' || st === 'skipped' ? 'bg-emerald-500' : 'bg-muted'}`} />;
          })}
        </span>
      )}
      <ul className="mt-2.5 space-y-0.5">
        {rows.map(x => {
          const st = r.nodes[x.key].state, e = last.get(x.key), me = x.key === k, on = sel === x.key, c = x.kind === 'command';
          const line = r.nodes[x.key].line ?? short(r.nodes[x.key].summary), off = st === 'wait' || st === 'skipped';
          return (
            <li key={x.key}>
              <button type="button" onClick={() => pick(x.key)} aria-expanded={on}
                className={`-mx-2 flex w-[calc(100%+1rem)] items-baseline gap-2 rounded-lg px-2 py-1 text-left hover:bg-muted/60 ${me ? (ask ? 'bg-amber-500/10' : 'bg-sky-500/10') : ''} ${on ? 'ring-2 ring-primary/40' : ''}`}>
                <span className={`shrink-0 rounded-full ${c ? 'size-1.5' : 'size-2'} ${st === 'wait' ? 'border-[1.5px] border-muted-foreground/50' : NODE[st][1]}`} />
                <span className="min-w-0 flex-1">
                  <span className={c ? 'font-mono text-xs text-muted-foreground' : `text-[0.8125rem] ${off ? 'text-muted-foreground' : 'font-semibold'}`}>{c ? '$ ' : ''}{x.fixOnly ? '↳ ' : ''}{x.title}</span>
                  {st === 'skipped' && <span className="ml-1.5 text-xs text-muted-foreground">건너뜀</span>}
                  {me && e?.claude && <span title={e.claude.why} className={`ml-1.5 ${CHIP} ${SKY}`}>{claudeChip(e.claude)}</span>}
                  {!me && st === 'done' && !c && line && <span className="block truncate text-xs text-muted-foreground">{line}</span>}
                </span>
                <span className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground tabular-nums">{me && e ? `${dur(Date.now() - e.t)}째` : st === 'done' && e?.work ? dur(e.work) : ''}</span>
              </button>
              {me && (ask ? <span className="mt-1 block rounded-lg bg-amber-500/10 px-3 py-2 text-sm whitespace-pre-wrap text-amber-900 dark:text-amber-200">{n!.state === 'blocked' ? '답을 기다린다 — 오른쪽 런 pane 의 질문 창' : n!.reason ?? n!.summary ?? '확인이 필요하다 — 「이어서」 · 「건너뛰기」'}</span>
                : said && <span className="mt-1 line-clamp-3 block rounded-lg bg-muted/60 px-3 py-2 text-sm"><span className="block text-[0.6875rem] font-semibold text-muted-foreground">Claude</span>{said}</span>)}
              {on && <div className="mt-2 mb-1 animate-fan">{detail(true)}</div>}
            </li>
          );
        })}
      </ul>
      {(hidden > 0 || cmd) && (
        <button type="button" onClick={() => setCmd(v => !v)} className="mt-1 text-xs text-muted-foreground hover:text-foreground">
          {cmd ? '명령 노드 숨기기' : `명령 노드 ${hidden}개 숨김 — 보기`}
        </button>
      )}
      {nowE && !ask && <span className="shimmer mt-3 block h-0.5 rounded-full" />}
    </div>
  );
}
