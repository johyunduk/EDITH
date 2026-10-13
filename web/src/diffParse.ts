// git diff 글 읽기 — 파일·덩어리·줄 번호, 줄 안 바뀐 곳, 나란히 보기 짝. 화면(Diff.tsx)이 쓴다. 테스트: diffParse.test.ts
export type Line = { t: ' ' | '+' | '-'; text: string; o?: number; n?: number; mark?: [number, number] };
export type Hunk = { o: number; n: number; head: string; lines: Line[] };
export type DFile = { name: string; old: string; status: 'A' | 'D' | 'R' | 'M'; binary: boolean; add: number; del: number; hunks: Hunk[]; key: string };

const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

// git diff 글 → 파일들. 파일 머리(@@ 앞)에서만 new/deleted/rename/Binary/---/+++ 를 읽는다 — 본문의 「---」 줄과 헷갈리지 않게.
export function parseDiff(text: string): DFile[] {
  return text.split(/^(?=diff --git )/m).filter(s => s.startsWith('diff --git ')).map(raw => {
    const ls = raw.replace(/\n$/, '').split('\n'), g = ls[0].match(/^diff --git a\/(.*) b\/(.*)$/);
    const f: DFile = { name: g?.[2] ?? ls[0], old: g?.[1] ?? '', status: 'M', binary: false, add: 0, del: 0, hunks: [], key: hash(raw) };
    let h: Hunk | null = null, o = 0, n = 0;
    for (const l of ls.slice(1)) {
      const at = l.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/);
      if (at) { o = +at[1]; n = +at[2]; h = { o, n, head: at[3], lines: [] }; f.hunks.push(h); continue; }
      if (!h) {
        if (l.startsWith('new file mode')) f.status = 'A';
        else if (l.startsWith('deleted file mode')) f.status = 'D';
        else if (l.startsWith('rename from ')) { f.status = 'R'; f.old = l.slice(12); }
        else if (l.startsWith('rename to ')) f.name = l.slice(10);
        else if (l.startsWith('Binary files ')) f.binary = true;
        else if (l.startsWith('+++ b/')) f.name = l.slice(6);
        else if (l.startsWith('--- a/')) f.old = l.slice(6);
      } else if (l[0] === '+') { h.lines.push({ t: '+', text: l.slice(1), n: n++ }); f.add++; }
      else if (l[0] === '-') { h.lines.push({ t: '-', text: l.slice(1), o: o++ }); f.del++; }
      else if (l[0] !== '\\') h.lines.push({ t: ' ', text: l.slice(1), o: o++, n: n++ });   // \ No newline … 은 뺀다
    }
    for (const hk of f.hunks) markPairs(hk.lines);
    return f;
  });
}

// 지운 줄 묶음과 바로 뒤 더한 줄 묶음을 차례로 짝지어, 같은 앞뒤를 뺀 가운데를 표시한다. 같은 곳이 30% 도 안 되면 통째로 바뀐 줄로 둔다.
export function markPairs(ls: Line[]) {
  for (let i = 0; i < ls.length;) {
    if (ls[i].t !== '-') { i++; continue; }
    const d = i; while (ls[i]?.t === '-') i++;
    const a = i; while (ls[i]?.t === '+') i++;
    for (let j = 0; j < Math.min(a - d, i - a); j++) {
      const x = ls[d + j].text, y = ls[a + j].text;
      let p = 0, s = 0;
      while (p < x.length && p < y.length && x[p] === y[p]) p++;
      while (s < x.length - p && s < y.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++;
      if (p + s < Math.max(x.length, y.length) * 0.3) continue;
      ls[d + j].mark = [p, x.length - s];
      ls[a + j].mark = [p, y.length - s];
    }
  }
}

// 나란히 보기의 줄 — 같은 줄은 양쪽에, 지운 묶음·더한 묶음은 차례로 짝지어 한 줄에
export function pairs(lines: Line[]) {
  const out: [Line | null, Line | null][] = [];
  for (let i = 0; i < lines.length;) {
    if (lines[i].t === ' ') { out.push([lines[i], lines[i]]); i++; continue; }
    const del: Line[] = [], add: Line[] = [];
    while (lines[i]?.t === '-') del.push(lines[i++]);
    while (lines[i]?.t === '+') add.push(lines[i++]);
    for (let k = 0; k < Math.max(del.length, add.length); k++) out.push([del[k] ?? null, add[k] ?? null]);
  }
  return out;
}
