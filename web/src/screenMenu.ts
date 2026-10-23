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
const SIDE = /^(.*?)(?:^|\s{2,})([┌│└].*[┐│┘])\s*$/;   // 선택지 줄 오른쪽에 붙은 미리 보기 상자 조각(┌─┐ · │ … │ · └─┘)

// 번호를 누른 뒤에도 그 번호에 커서(›·❯)가 남아 있으면 아직 확정 전 — Codex 폴더 신뢰 화면은 숫자가 고르기만 하고 Enter 로 확정한다.
// 여러 개 고르기([ ]·☐)는 숫자가 체크만 하는 게 맞으니 확정 전으로 보지 않는다.
export const stillPicked = (lines: string[], n: number) =>
  lines.some(l => new RegExp(`^\\s*[❯›>]\\s*${n}\\.\\s`).test(l) && !/\[[ xX✔✓]\]|[☐☒]/.test(l));

// 터미널에서 두 칸을 차지하는 글자(한글·한자·가나·전각·이모지) — 미리 보기를 터미널 칸대로 맞춰 그릴 때 쓴다(Prompt.tsx)
// shortcut: 자주 쓰는 동아시아 글자와 이모지 범위만 두 칸, 모호한 폭(▾·← 등)은 Claude 화면처럼 한 칸 — 어긋나는 글자가 보이면 범위를 더한다
export const wide = (c: string) => /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1f64f}\u{1f900}-\u{1f9ff}\u{20000}-\u{3fffd}]/u.test(c);

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
  // 미리 보기가 붙은 질문은 첫 선택지 줄 오른쪽에서 상자(┌)가 시작한다 — 줄마다 오른쪽 상자 조각을 떼어 미리 보기로 모은다.
  // 이 꼴에서 Claude 는 선택지 설명을 화면에 그리지 않는다(desc 가 빈다).
  const side = SIDE.exec(lines[first])?.[2].startsWith('┌'), box: string[] = [];
  const rest = lines.slice(first).map(l => { const m = side && l.match(SIDE); if (!m) return l; box.push(m[2]); return m[1]; });
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
  const preview = side && { ...(cur ? { n: Number(cur) } : {}), text: box.slice(1, end < 0 ? undefined : end).map(b => b.replace(/^│ ?/, '').replace(/\s*│$/, '')).join('\n') };
  let multi = false;
  for (const o of options) {
    const b = o.label.match(BOX);
    if (b) { multi = true; o.label = b[2].trim(); o.checked = b[1] !== ' '; }
  }
  const head = lines.slice(0, first).map(l => l.trim()), tabs = head.findLast(l => TABS.test(l))?.replace(/^←\s*|\s*→$/g, '') ?? head.findLast(l => CHIP.test(l))?.replace(/^[☐☒✔]\s+/, '');
  const q = question(lines, first), top = tabs ?? q.kind;
  return { question: q.text, options, ...(multi ? { multi } : {}), ...(top ? { tabs: top } : {}), ...(preview ? { preview } : {}), ...(q.block ? { block: q.block } : {}) };
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
