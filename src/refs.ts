// 공방 「적용」 전 검사 — 스킬이 「없으면」 멈춘다고 적은 작업 문서 파일을 앞 노드 어디서도 언급하지(만들지) 않으면 미리 알린다.
// 다른 엔진에서 옮겨 온 스킬이 그 엔진의 준비 체인이 깔던 파일(예: bin/rules.md)을 찾아 첫 노드부터 막히는 일을 런 전에 잡는다.
// 「앞 노드」 = 화살표로 거슬러 닿는 노드(고치는 노드는 고칠 노드와 그 앞). 노드 글 = 스킬은 SKILL.md · 공통 규칙, 명령은 명령 줄과 그 줄이 부르는 엔진 폴더 파일.
// shortcut: 「없으면」 이 든 문장의 파일 이름만 보고, 앞 노드 글에 그 이름이 있는지로 「만든다」 를 가늠한다 —
//   스크립트가 이름을 조립해 만들면 헛경고(그 스크립트에 이름을 적으면 사라진다). 경고일 뿐 적용 · 런은 막지 않는다.
import type { Step } from './runner.ts';

// 작업 문서 기준 파일 이름(디렉터리 포함) — 절대 경로 · ~/ · $변수/ 뒤는 빼려고 앞 글자가 / 면 잡지 않는다
const FILE = /(?<![\w/$.~-])((?:[\w-]+\/)*[\w-][\w.-]*\.(?:md|json|jsonl|txt|ya?ml|sh|ts|js|py|sql|csv))(?![\w/-])/g;
// EDITH 가 만들거나 노드마다 주는 파일 — 경고하지 않는다
const OWN = new Set(['SKILL.md', 'result.json', 'rewind.json', 'edith-claude.json', 'edith-records.jsonl', 'edith-results.json']);

// 「없으면」 바로 앞(같은 줄 40자 안)에 놓인 파일들 — 「X 를 읽고, 없으면 막힘」 꼴. 「노션 원본, 없으면 …」 처럼 다른 것을 가리키는 「없으면」 뒤의 파일은 잡지 않는다
export function needed(text: string) {
  // 글 전체에서 파일을 찾은 뒤 자리로 고른다(잘라 낸 조각에서 찾으면 /Users/… 의 꼬리를 파일로 잘못 잡는다)
  const ifs = [...text.matchAll(/없으면/g)].map(m => m.index), files = [...text.matchAll(FILE)];
  const hit = (end: number) => ifs.some(i => i >= end && i - end <= 40 && !text.slice(end, i).includes('\n'));
  return [...new Set(files.filter(m => hit(m.index + m[0].length)).map(m => m[1]))].filter(f => !OWN.has(f) && !OWN.has(f.split('/').at(-1)!));
}

export function refWarnings(steps: Step[], textOf: (s: Step) => string) {
  const by = new Map(steps.map(s => [s.key, s])), host = new Map(steps.flatMap(s => s.failTo ? [[s.failTo, s.key] as const] : []));
  const text = new Map<string, string>(), of = (s: Step) => { if (!text.has(s.key)) text.set(s.key, textOf(s)); return text.get(s.key)!; };
  const before = (s: Step) => {
    const seen = new Set<string>(), todo = [...s.deps, ...(host.has(s.key) ? [host.get(s.key)!] : [])];
    while (todo.length) {
      const k = todo.pop()!;
      if (seen.has(k)) continue;
      seen.add(k);
      todo.push(...by.get(k)?.deps ?? [], ...(host.has(k) ? [host.get(k)!] : []));
    }
    return [...seen].map(k => of(by.get(k)!)).join('\n');
  };
  const out: string[] = [];
  for (const s of steps) {
    if (s.kind !== 'skill') continue;
    const prev = before(s);
    // 그 이름 그대로, 또는 폴더째 까는 꼴(「bin/」 과 그 안 파일 이름 「rules.md」 가 따로)이면 만든다고 본다
    const made = (f: string) => prev.includes(f) || (f.includes('/') && prev.includes(f.split('/').at(-1)!) && prev.includes(`${f.split('/').slice(0, -1).join('/')}/`));
    for (const f of needed(of(s))) if (!made(f)) out.push(`${s.lane} › 「${s.title}」 — ${f} 가 없으면 멈추는데, 앞 노드 어디서도 이 파일을 만들지 않는다`);
  }
  return [...new Set(out)];
}
