// 질문·승인 화면 읽기 — 에이전트가 입력칸 대신 띄운 선택지를 화면 글에서 찾는다(Herdr.tsx 가 카드·버튼으로 그린다).
// 두 꼴을 안다:
//   번호 메뉴  「❯ 1. 빨강」 + 그 아래 들여 쓴 설명 줄 — 번호 키 하나로 답한다(Claude 질문·승인 화면)
//   커서 메뉴  「❯ No, exit」 / 「  Yes, I trust this folder」 처럼 번호 없이 ❯ 로 고르는 것 — ↑↓ 로 옮기고 Enter(폴더 신뢰 등).
//              잘못 알아보지 않게 아래에 조작 안내(Enter to confirm 등)가 있을 때만.
// 선택지 앞, 마지막 가로줄 아래의 글을 질문으로 본다. 선택지가 둘 미만이면 질문이 아니다.

// cursor 는 커서 메뉴에서 지금 ❯ 가 있는 선택지(0부터) — 번호 메뉴면 없다.
// multi 는 여러 개 고르기(Claude 질문의 「1. [ ] 사과」 꼴) — 번호는 체크만 켜고 끄고(checked), → 로 다음 질문·제출 화면으로 넘어간다.
// tabs 는 질문이 여럿일 때 맨 위 줄(「☒ 과일  ☐ 크기  ✔ Submit」) — 어디쯤인지 보여 준다.
export type Menu = { question: string; options: { n: number; label: string; desc: string; checked?: boolean }[]; cursor?: number; multi?: boolean; tabs?: string };

const OPT = /^\s*(?:[❯›>]\s*)?(\d{1,2})\.\s+(.+)$/;
const CURSOR = /^(\s*)❯\s+(\S.*)$/;
const RULE = /^\s*[─━▔-]{3,}/;
const HINT = /Enter to (select|confirm)|Esc to (cancel|exit)|↑\/↓|to navigate/;
const BOX = /^\[([ ✔✓xX])\]\s*(.*)$/;          // 여러 개 고르기의 체크 상자
const TABS = /^←.*→$/;                           // 질문 여럿일 때 맨 위 줄
const STEP = /^(Next|Submit)$/;                  // 여러 개 고르기 아래의 「다음」 줄 — 선택지 설명이 아니다

// 번호를 누른 뒤에도 그 번호에 커서(›·❯)가 남아 있으면 아직 확정 전 — Codex 폴더 신뢰 화면은 숫자가 고르기만 하고 Enter 로 확정한다.
// 여러 개 고르기([ ]·☐)는 숫자가 체크만 하는 게 맞으니 확정 전으로 보지 않는다.
export const stillPicked = (lines: string[], n: number) =>
  lines.some(l => new RegExp(`^\\s*[❯›>]\\s*${n}\\.\\s`).test(l) && !/\[[ xX✔✓]\]|[☐☒]/.test(l));

// 직접 써서 답하는 선택지(「Type something」 등) — 고르면 글을 받아야 한다
export const isFree = (l: string) => /type something|직접|other/i.test(l);

const question = (lines: string[], end: number) => {
  const before = lines.slice(0, end), cut = before.findLastIndex(l => RULE.test(l));
  return before.slice(cut + 1).filter(l => l.trim() && !TABS.test(l.trim())).slice(-6).map(l => l.trim().replace(/^[☐☒✔]\s*/, '')).join('\n');   // 질문 머리표(☐ 색)의 상자는 뺀다
};

export function parseMenu(lines: string[]): Menu | null {
  const first = lines.findIndex(l => OPT.test(l));
  if (first < 0) return cursorMenu(lines);
  const options: Menu['options'] = [];
  for (const l of lines.slice(first)) {
    const m = l.match(OPT);
    if (m) options.push({ n: Number(m[1]), label: m[2].trim(), desc: '' });
    else if (l.trim() && !RULE.test(l) && !HINT.test(l) && !STEP.test(l.trim()) && options.length) options.at(-1)!.desc += `${options.at(-1)!.desc ? ' ' : ''}${l.trim()}`;
  }
  if (options.length < 2) return null;
  let multi = false;
  for (const o of options) {
    const b = o.label.match(BOX);
    if (b) { multi = true; o.label = b[2].trim(); o.checked = b[1] !== ' '; }
  }
  const tabs = lines.slice(0, first).map(l => l.trim()).findLast(l => TABS.test(l))?.replace(/^←\s*|\s*→$/g, '');
  return { question: question(lines, first), options, ...(multi ? { multi } : {}), ...(tabs ? { tabs } : {}) };
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
  return options.length < 2 ? null : { question: question(lines, a), options, cursor };
}
