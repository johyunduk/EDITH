// 질문·승인 화면 읽기 — 에이전트가 입력칸 대신 띄운 선택지를 화면 글에서 찾는다(Herdr.tsx 가 카드·버튼으로 그린다).
// 두 꼴을 안다:
//   번호 메뉴  「❯ 1. 빨강」 + 그 아래 들여 쓴 설명 줄 — 번호 키 하나로 답한다(Claude 질문·승인 화면)
//   커서 메뉴  「❯ No, exit」 / 「  Yes, I trust this folder」 처럼 번호 없이 ❯ 로 고르는 것 — ↑↓ 로 옮기고 Enter(폴더 신뢰 등).
//              잘못 알아보지 않게 아래에 조작 안내(Enter to confirm 등)가 있을 때만.
// 선택지 앞, 마지막 가로줄 아래의 글을 질문으로 본다. 선택지가 둘 미만이면 질문이 아니다.

// cursor 는 커서 메뉴에서 지금 ❯ 가 있는 선택지(0부터) — 번호 메뉴면 없다.
// multi 는 여러 개 고르기(Claude 질문의 「1. [ ] 사과」 꼴) — 번호는 체크만 켜고 끄고(checked), → 로 다음 질문·제출 화면으로 넘어간다.
// tabs 는 질문이 여럿일 때 맨 위 줄(「☒ 과일  ☐ 크기  ✔ Submit」) — 어디쯤인지 보여 준다.
// preview 는 미리 보기가 붙은 Claude 질문에서 지금 커서(❯)가 있는 선택지(n)의 미리 보기 글 — ↑↓ 로 커서를 옮기면 바뀐다.
// block 은 Claude 승인 화면의 점선(╌) 사이 — 명령·파일 내용·diff 가 든 줄 범위 [시작, 끝)(받은 lines 의 줄 번호). 화면이 터미널 색 그대로 따로 그린다.
export type Menu = { question: string; options: { n: number; label: string; desc: string; checked?: boolean }[]; cursor?: number; multi?: boolean; tabs?: string; preview?: { n?: number; text: string }; block?: [number, number] };

const OPT = /^\s*(?:[❯›>]\s*)?(\d{1,2})\.\s+(.+)$/;
const CURSOR = /^(\s*)❯\s+(\S.*)$/;
const RULE = /^\s*[─━▔-]{3,}/;
const HINT = /Enter to (select|confirm)|Esc to (cancel|exit)|↑\/↓|to navigate|to add notes/i;   // Codex 는 「Press enter to confirm or esc to cancel」
const DASH = /^\s*╌{3,}\s*$/;                    // Claude 승인 화면의 점선 — 두 줄 사이가 명령·파일 내용·diff
const TALK = /^\s*[•⏺]\s/;                       // 대화 줄(Codex •·Claude ⏺) — 가로줄 없는 질문(Codex 승인)은 그 아래부터
const TIP = /^Tip: /;                             // 승인 화면의 안내 한 줄(「Tip: auto mode handles…」)
const BOX = /^\[([ ✔✓xX])\]\s*(.*)$/;          // 여러 개 고르기의 체크 상자
const TABS = /^←.*→$/;                           // 질문 여럿일 때 맨 위 줄
const CHIP = /^[☐☒✔]\s+\S/;                      // 질문 하나일 때 맨 위 머리표(「☐ git commit」) — tabs 자리에 작게 보인다
const STEP = /^(Next|Submit)$/;                  // 여러 개 고르기 아래의 「다음」 줄 — 선택지 설명이 아니다
const BOXAT = /^(.*?\S)\s{2,}([┌│└])/;            // 글 뒤에 두 칸 넘게 띄우고 붙은 미리 보기 상자 조각(┌ · │ · └)
const JUNK = /\s+[┌│└┐┘].*$/;                      // 선택지 글 뒤에 남은 상자 조각 — 선택지 이름에는 상자 글자가 없다

// 번호를 누른 뒤에도 그 번호에 커서(›·❯)가 남아 있으면 아직 확정 전 — Codex 폴더 신뢰 화면은 숫자가 고르기만 하고 Enter 로 확정한다.
// 여러 개 고르기([ ]·☐)는 숫자가 체크만 하는 게 맞으니 확정 전으로 보지 않는다.
export const stillPicked = (lines: string[], n: number) =>
  lines.some(l => new RegExp(`^\\s*[❯›>]\\s*${n}\\.\\s`).test(l) && !/\[[ xX✔✓]\]|[☐☒]/.test(l));

// 터미널에서 두 칸을 차지하는 글자(한글·한자·가나·전각·이모지) — 미리 보기를 터미널 칸대로 맞춰 그릴 때 쓴다(Prompt.tsx)
// shortcut: 자주 쓰는 동아시아 글자와 이모지 범위만 두 칸, 모호한 폭(▾·← 등)은 Claude 화면처럼 한 칸 — 어긋나는 글자가 보이면 범위를 더한다
export const wide = (c: string) => /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1f64f}\u{1f900}-\u{1f9ff}\u{20000}-\u{3fffd}]/u.test(c);

// 커밋 지킴이의 main · master 푸시 질문 — 머리표 「⚠ main 푸시」 와 질문 첫 줄 「⚠ main 에 바로 올라간다 — origin/main」(plugins/commit-guard).
// 카드 · 배지 · 사이드바 · 알림을 빨강으로 보인다. question 은 그 첫 줄을 뗀 나머지(카드는 그 줄을 머리로 올린다)
export function mainPush(m: Menu | null): { branch: string; ref: string; question: string } | null {
  const branch = m?.tabs?.match(/^⚠ (\S+) 푸시$/)?.[1];
  if (!m || !branch) return null;
  const head = m.question.match(/^⚠ \S+ 에 바로 올라간다 — (\S+)\n*/);
  return { branch, ref: head?.[1] ?? branch, question: head ? m.question.slice(head[0].length) : m.question };
}

// 커밋 지킴이 질문을 카드로 — 「왜:」 단락, 레포마다 커밋 · 푸시 · 머지 줄, 명령 원문(plugins/commit-guard describe 가 쓰는 줄 꼴).
// 같은 레포가 잇따르면(커밋하고 푸시) 한 상자. 못 알아보는 꼴(설명을 못 푼 명령 · 다른 질문)이면 null — 카드는 글 그대로 보인다.
// 터미널 폭에서 접힌 줄은 아는 머리(커밋할 브랜치: · push: …)로 시작하지 않으면 앞 줄에 잇는다.
// shortcut: 접힌 줄을 빈칸 하나로 잇는다 — 낱말 가운데서 잘린 긴 경로는 빈칸이 끼어 보인다
export type GuardRow = { op: 'commit' | 'push' | 'merge'; refs: string[]; title?: string; files?: string; notes: string[] };
export type Guard = { why: string; boxes: { repo: string; worktree?: string; rows: GuardRow[] }[]; warn: string[]; raw: string };
const GUARD_KV = /^(커밋할 브랜치|머지 마무리|제목|push|파일 \d+개): (.*)$/;
const GUARD_HEAD = /^(커밋할 브랜치|머지 마무리|제목|push|파일 \d+개): |^(staged 파일 없음$|git (add|push)\b|commit (-a|--all) —|amend —)/;
const RAW = '\n명령 원문(앞 400자):\n';

export function guardCard(q: string): Guard | null {
  const at = q.indexOf(RAW), paras = (at < 0 ? q : q.slice(0, at)).split(/\n\s*\n/).map(p => p.split('\n').map(l => l.trim()).filter(Boolean));
  if (!paras[0]?.[0]?.startsWith('왜:') || !/^git (commit|push) \d+건/.test(paras[1]?.[0] ?? '')) return null;
  const g: Guard = { why: paras[0].join(' '), boxes: [], warn: [], raw: at < 0 ? '' : q.slice(at + RAW.length) };
  for (const p of paras.slice(2)) {
    const lines: string[] = [];
    for (const l of p) if (lines.length && !GUARD_HEAD.test(l)) lines[lines.length - 1] += ` ${l}`; else lines.push(l);
    const [head, ...items] = lines;
    if (head.startsWith('명령 글에 git commit·push 가')) { g.warn.push(head); continue; }
    const m = /^(.+?) · 워크트리 (.+)$/.exec(head), repo = m?.[1] ?? head, worktree = m?.[2];
    let box = g.boxes.at(-1), row: GuardRow | undefined;
    if (!box || box.repo !== repo || box.worktree !== worktree) g.boxes.push(box = { repo, worktree, rows: [] });
    for (const it of items) {
      const [, k = '', v = ''] = GUARD_KV.exec(it) ?? [];
      if (k === '커밋할 브랜치') box.rows.push(row = { op: 'commit', refs: [v], notes: [] });
      else if (k === '머지 마무리') box.rows.splice(box.rows.length - 1, 0, { op: 'merge', refs: v.split(' → '), notes: [] });   // 커밋 줄 앞에
      else if (k === 'push') box.rows.push(row = { op: 'push', refs: v.split(' → '), notes: [] });
      else if (k === '제목' && row) row.title = v;
      else if (k.startsWith('파일') && row) row.files = `${k} · ${v}`;
      else {
        if (!row) box.rows.push(row = { op: 'push', refs: [], notes: [] });   // push: 줄 없는 push(--tags 등)는 원문 줄만
        row.notes.push(it);
      }
    }
  }
  return g;
}

// 터미널 칸 — 줄을 칸 col 에서 둘로 나눈다(두 칸 글자가 걸치면 왼쪽에 둔다)
function cutAt(l: string, col: number): [string, string] {
  const cs = [...l];
  let n = 0, i = 0;
  for (; i < cs.length && n < col; i++) n += wide(cs[i]) ? 2 : 1;
  return [cs.slice(0, i).join(''), cs.slice(i).join('')];
}
// 줄에서 미리 보기 상자가 시작하는 칸 — 상자 조각만 있는 줄은 그 들여쓰기, 아니면 글 뒤 두 칸 넘게 띄운 ┌ · │ · └. 없으면 null
// (상자 조각만 있는 줄을 BOXAT 로 읽으면 왼쪽 테두리를 글로 보고 오른쪽 테두리에서 자른다)
const cellsOf = (s: string) => [...s].reduce((n, c) => n + (wide(c) ? 2 : 1), 0);
const isBox = (s: string) => /^[┌│└]/.test(s.trimStart());
function boxCol(l: string): number | null {
  if (isBox(l)) return cellsOf(l.slice(0, l.length - l.trimStart().length));
  const m = BOXAT.exec(l);
  return m ? cellsOf(l.slice(0, m[0].length - 1)) : null;
}

// 직접 써서 답하는 선택지(「Type something」 등) — 고르면 글을 받아야 한다
export const isFree = (l: string) => /type something|직접|other/i.test(l);

// 가로줄 아래는 전부 질문 — 커밋 지킴이처럼 긴 질문도 머리(무엇을 할지)가 잘리지 않게. 빈 줄은 단락으로 하나만 남긴다.
// 가로줄이 없으면(커서 메뉴·Codex 승인) 위쪽 대화가 섞이지 않게 마지막 대화 줄(•·⏺) 아래, 끝 6줄만. 왼쪽 막대(│ — 질문 상자)는 떼고 그 안의 들여쓰기는 둔다.
// 점선 두 줄이 있으면(Claude 승인 화면) 그 사이는 block 으로 빼고, 맨 첫 줄(「Bash command」·「Edit file」)은 종류(kind)로 뺀다.
function question(lines: string[], end: number) {
  const cut = lines.slice(0, end).findLastIndex(l => RULE.test(l));
  let at = [...lines.keys()].slice(cut + 1, end);
  // 가로줄이 화면 밖으로 밀려난 긴 승인 화면(45줄 파일 쓰기 등)은 점선 두 줄로 알아보고 화면 맨 위부터 읽는다
  if (cut < 0 && at.filter(i => DASH.test(lines[i])).length < 2) { const talk = at.findLast(i => TALK.test(lines[i])) ?? -1; at = at.filter(i => i > talk && lines[i].trim()).slice(-6); }
  at = at.filter(i => !TABS.test(lines[i].trim()) && !CHIP.test(lines[i].trim()) && !TIP.test(lines[i].trim()));
  const dash = at.filter(i => DASH.test(lines[i])), block = dash.length > 1 ? [dash[0] + 1, dash[1]] as [number, number] : undefined;
  const text = at.filter(i => !block || i < block[0] - 1 || i > block[1]).map(i => lines[i].trim().replace(/^│ ?/, '').trimEnd());
  const k = text.findIndex(Boolean), kind = block && k >= 0 ? text.splice(k, 1)[0] : undefined;
  return { text: text.join('\n').replace(/\n{3,}/g, '\n\n').trim(), block, kind };
}

export function parseMenu(lines: string[]): Menu | null {
  // 선택지는 화면 맨 아래 메뉴 — 위 대화에 번호 목록·제목(「2. …」)이 보여도 마지막 「1.」 부터 읽는다
  const opts = [...lines.keys()].filter(i => OPT.test(lines[i]));
  const first = opts.findLast(i => lines[i].match(OPT)![1] === '1') ?? opts[0] ?? -1;
  if (first < 0) return cursorMenu(lines);
  // 미리 보기가 붙은 질문은 첫 선택지 줄 오른쪽에 상자가 붙는다 — 그 칸(col)부터 오른쪽을 줄마다 떼어 미리 보기로 모은다.
  // 이 꼴에서 Claude 는 선택지 설명을 화면에 그리지 않는다(desc 가 빈다).
  // Windows(ConPTY)는 한글 · 「·」 같은 글자 폭을 Claude 와 다르게 세어 화면이 어긋난다 — 상자 오른쪽 테두리가 없거나, 상자 조각이 줄마다
  // 다른 칸 · 질문 줄에 남는다. 그래서 테두리 짝을 찾지 않고 칸으로 자르고, 줄에 제 상자 자리가 있으면 그걸, 선택지 글 뒤 남은 조각은 떼어 낸다.
  const col = boxCol(lines[first]), side = col !== null, box: string[] = [];
  const rest = lines.slice(first).map(l => {
    if (!side) return l;
    const [a, b] = cutAt(l, boxCol(l) ?? col);
    if (isBox(b)) box.push(b.trim());
    return a.replace(JUNK, '');
  });
  // 질문 줄 오른쪽에 밀려온 상자 조각 · 상자 조각만 남은 줄도 뗀다 — 질문 왼쪽 막대(「│ 질문」, 맨 앞 몇 칸)는 상자가 아니다
  const top = side ? lines.slice(0, first).map(l => { const c = boxCol(l); return c === null || c <= 4 ? l : cutAt(l, c)[0].trimEnd(); }) : lines.slice(0, first);
  const options: Menu['options'] = [];
  let ruled = false;   // 선택지 아래 가로줄 밑(「Chat about this」 등)은 번호 선택지만 받고 설명으로 붙이지 않는다
  for (const l of rest) {
    const m = l.match(OPT);
    if (m) options.push({ n: Number(m[1]), label: m[2].trim(), desc: '' });
    else if (RULE.test(l)) ruled = true;
    else if (l.trim() && !ruled && !HINT.test(l) && !STEP.test(l.trim()) && options.length) options.at(-1)!.desc += `${options.at(-1)!.desc ? ' ' : ''}${l.trim()}`;
  }
  if (options.length < 2) return null;
  // 상자 안 글(┌ 다음부터 └ 앞까지, 양옆 │ 를 뗀다)은 커서(❯) 선택지의 미리 보기
  const end = box.findIndex(b => b.startsWith('└')), cur = rest.find(l => /^\s*[❯›>]\s*\d/.test(l))?.match(OPT)?.[1];
  const from = box[0]?.startsWith('┌') ? 1 : 0;   // 화면이 어긋나면 상자 윗줄이 선택지 줄에 없을 수 있다
  const preview = side && { ...(cur ? { n: Number(cur) } : {}), text: box.slice(from, end < 0 ? undefined : end).map(b => b.replace(/^│ ?/, '').replace(/\s*│$/, '')).join('\n') };
  let multi = false;
  for (const o of options) {
    const b = o.label.match(BOX);
    if (b) { multi = true; o.label = b[2].trim(); o.checked = b[1] !== ' '; }
  }
  const head = top.map(l => l.trim()), tabs = head.findLast(l => TABS.test(l))?.replace(/^←\s*|\s*→$/g, '') ?? head.findLast(l => CHIP.test(l))?.replace(/^[☐☒✔]\s+/, '');
  const q = question([...top, ...lines.slice(first)], first), chip = tabs ?? q.kind;
  return { question: q.text, options, ...(multi ? { multi } : {}), ...(chip ? { tabs: chip } : {}), ...(preview ? { preview } : {}), ...(q.block ? { block: q.block } : {}) };
}

// 커서 메뉴 — ❯ 줄의 글자 자리(칸)와 같은 칸에서 시작하는 줄이 선택지, 더 들여 쓴 줄은 그 설명. 빈 줄·가로줄·안내·덜 들여 쓴 줄에서 끝난다.
function cursorMenu(lines: string[]): Menu | null {
  const at = lines.findIndex(l => CURSOR.test(l));
  if (at < 0 || !lines.slice(at + 1).some(l => HINT.test(l))) return null;
  const m = lines[at].match(CURSOR)!, col = lines[at].indexOf(m[2], m[1].length + 1);
  const indent = (l: string) => l.search(/\S/);
  const inMenu = (i: number) => i === at || (!!lines[i].trim() && !RULE.test(lines[i]) && !HINT.test(lines[i]) && indent(lines[i]) >= col);
  let a = at;
  while (a > 0 && inMenu(a - 1)) a--;
  while (a < at && indent(lines[a]) > col) a++;   // 맨 위가 설명 줄이면 건너뛴다
  const options: Menu['options'] = [];
  let cursor = 0;
  for (let i = a; i < lines.length && inMenu(i); i++) {
    if (i === at) { cursor = options.length; options.push({ n: options.length + 1, label: m[2].trim(), desc: '' }); }
    else if (indent(lines[i]) === col) options.push({ n: options.length + 1, label: lines[i].trim(), desc: '' });
    else if (options.length) options.at(-1)!.desc += `${options.at(-1)!.desc ? ' ' : ''}${lines[i].trim()}`;
  }
  return options.length < 2 ? null : { question: question(lines, a).text, options, cursor };
}
