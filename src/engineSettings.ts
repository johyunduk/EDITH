// 엔진 설정 — 공방 엔진 폴더 actions.json 의 on: "settings" 명령이 내는 표(그 엔진이 쓰는 계정 · 키 같은 것)를 설정 화면에서 고친다.
// EDITH 는 표를 그리고 바꿀 것을 넘길 뿐이다 — 무엇을 어디에 저장하는지는 엔진 명령 몫(docs/customize.md 「엔진 설정」).
//   읽기: EDITH_SETTINGS=read → 표준 출력에 표 JSON
//   저장: EDITH_SETTINGS=save, 표준 입력에 {op: set | add | remove, id?, add?, values?} → 표준 출력에 새 표 JSON. 실패면 끝 코드 ≠ 0 과 {"error": "…"}
// 비밀 칸(type secret)은 엔진이 설정됐는지(true · false)만 주고, 화면은 새로 넣은 값만 보낸다 — 그 값은 표준 입력으로만 넘기고 남기지 않는다
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runHook, type RunAction } from './runner.ts';
import { NAME, ROOT as WORKSHOP } from './workshop.ts';

export type Field = { key: string; label: string; type: 'text' | 'select' | 'bool' | 'secret'; options?: { value: string; label: string }[]; hint?: string; mono?: boolean };
type Values = Record<string, string | boolean>;
export type Row = { id: string; group?: string; values: Values; note?: string; tone?: 'ok' | 'warn' | 'off'; edit: string[]; remove: boolean };
export type Table = { title: string; note?: string; status?: string; fields: Field[]; columns: string[]; groups: { id: string; label: string; note?: string }[]; rows: Row[];
  add: { label: string; group?: string; edit: string[]; values: Values }[] };

const KEY = /^[A-Za-z][\w-]{0,40}$/, ROW = /^[\w.:-]{1,100}$/, TYPES = ['text', 'select', 'bool', 'secret'], TONES = ['ok', 'warn', 'off'];
const str = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const list = (v: unknown, max: number) => Array.isArray(v) ? v.slice(0, max) as Record<string, unknown>[] : [];
const opt = <K extends string, V>(k: K, v: V | '' | undefined) => (v === '' || v === undefined ? {} : { [k]: v }) as Partial<Record<K, V>>;

// 엔진 명령의 출력 — 모양을 맞추고 길이를 자른다. 모르는 칸 · 틀린 줄은 버리고, 비밀 칸 값은 참 · 거짓으로만 둔다(엔진이 값을 내도 화면에 안 간다)
export function parseTable(out: string): Table {
  let t: Record<string, unknown>;
  try { t = JSON.parse(out); } catch { throw new Error('엔진 설정 명령이 JSON 을 내지 않았다'); }
  if (!t || typeof t !== 'object' || !str(t.title, 80)) throw new Error('엔진 설정 명령이 표(title)를 내지 않았다');
  const fields: Field[] = list(t.fields, 40).filter(f => f && KEY.test(String(f.key)) && str(f.label, 80)).map(f => ({
    key: String(f.key), label: str(f.label, 80), type: (TYPES.includes(String(f.type)) ? f.type : 'text') as Field['type'],
    ...opt('options', f.type === 'select' ? list(f.options, 100).filter(o => typeof o?.value === 'string').map(o => ({ value: str(o.value, 200), label: str(o.label, 200) || str(o.value, 200) })) : undefined),
    ...opt('hint', str(f.hint, 200)), ...(f.mono === true ? { mono: true } : {}),
  })).filter((f, i, all) => all.findIndex(g => g.key === f.key) === i);
  const byKey = new Map(fields.map(f => [f.key, f])), keys = (v: unknown) => list(v, 40).map(String).filter(k => byKey.has(k));
  const values = (v: unknown): Values => Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).flatMap(([k, x]): [string, string | boolean][] => {
    const f = byKey.get(k);
    if (!f) return [];
    if (f.type === 'secret') return [[k, !!x]];
    return typeof x === 'boolean' ? [[k, x]] : typeof x === 'string' || typeof x === 'number' ? [[k, String(x).slice(0, 4000)]] : [];
  }));
  const groups = list(t.groups, 12).filter(g => g && KEY.test(String(g.id)) && str(g.label, 40)).map(g => ({ id: String(g.id), label: str(g.label, 40), ...opt('note', str(g.note, 300)) }));
  const group = (v: unknown) => groups.some(g => g.id === v) ? { group: String(v) } : {};
  const rows: Row[] = list(t.rows, 500).filter(r => r && ROW.test(String(r.id))).map(r => ({
    id: String(r.id), ...group(r.group), values: values(r.values), ...opt('note', str(r.note, 200)),
    ...(TONES.includes(String(r.tone)) ? { tone: r.tone as Row['tone'] } : {}), edit: keys(r.edit), remove: r.remove === true,
  })).filter((r, i, all) => all.findIndex(x => x.id === r.id) === i);
  const columns = keys(t.columns);
  return {
    title: str(t.title, 80), ...opt('note', str(t.note, 600)), ...opt('status', str(t.status, 30)), fields, columns: columns.length ? columns.slice(0, 8) : fields.slice(0, 4).map(f => f.key),
    groups, rows, add: list(t.add, 8).filter(a => a && str(a.label, 60)).map(a => ({ label: str(a.label, 60), ...group(a.group), edit: keys(a.edit), values: values(a.values) })),
  };
}

// 설정 표 목록 — 공방 맨 위 폴더(이름 순, actions.json 이 그 폴더에 있는 것)마다 on: "settings" 단추. id = <폴더>.<그 폴더 안 차례>
export function settingsPages(root = WORKSHOP): { id: string; label: string; dir: string; action: RunAction }[] {
  let names: string[] = [];
  try { names = readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && NAME.test(d.name)).map(d => d.name).sort(); } catch { return []; }
  return names.flatMap(n => {
    let a: unknown;
    try { a = JSON.parse(readFileSync(join(root, n, 'actions.json'), 'utf8')); } catch { return []; }
    return (Array.isArray(a) ? a as RunAction[] : []).filter(x => x?.on === 'settings' && typeof x.label === 'string' && typeof x.command === 'string')
      .map((action, i) => ({ id: `${n}.${i}`, label: action.label.slice(0, 60), dir: join(root, n), action }));
  });
}

const pageOf = (id: unknown, root: string) => {
  const p = settingsPages(root).find(x => x.id === id);
  if (!p) throw new Error('없는 엔진 설정이다');
  return p;
};
// 기록은 공방 옆 settings/<id>.log(EDITH 데이터 폴더) — 표만 남는다(비밀 값은 표준 입력이라 안 남는다)
async function call(p: ReturnType<typeof pageOf>, mode: 'read' | 'save', root: string, input?: string): Promise<Table> {
  const dir = join(dirname(root), 'settings');
  mkdirSync(dir, { recursive: true });
  const log = join(dir, `${p.id}.log`), r = await runHook(p, { EDITH_SETTINGS: mode }, log, 30_000, input);
  if (r.code !== 0) {
    let msg = '';
    try { msg = str(JSON.parse(r.out).error, 300); } catch { /* JSON 이 아님 */ }
    throw new Error(msg || `엔진 설정 명령이 실패했다(끝 코드 ${r.code}) — 기록: ${log}`);
  }
  return parseTable(r.out);
}
export const readSettings = async (id: unknown, root = WORKSHOP) => call(pageOf(id, root), 'read', root);

// 저장 — 모양만 본다(무엇을 받을지는 엔진이 정한다). 값은 글(4000자) · 참거짓만
export function saveInput(b: Record<string, unknown>): string {
  if (!['set', 'add', 'remove'].includes(String(b.op))) throw new Error('op 는 set · add · remove');
  if (b.op !== 'add' && !(typeof b.row === 'string' && ROW.test(b.row))) throw new Error('고칠 줄이 없다');
  if (b.op === 'add' && !(Number.isInteger(b.add) && (b.add as number) >= 0 && (b.add as number) < 8)) throw new Error('더하기 차례가 틀렸다');
  const v = b.values && typeof b.values === 'object' ? Object.entries(b.values) : [];
  if (v.length > 40 || v.some(([k, x]) => !KEY.test(k) || !(typeof x === 'boolean' || (typeof x === 'string' && x.length <= 4000)))) throw new Error('값이 틀렸다 — 칸 이름 · 글(4000자) · 참거짓만');
  return JSON.stringify({ op: b.op, ...(b.op === 'add' ? { add: b.add } : { id: b.row }), values: Object.fromEntries(v) });
}
export const saveSettings = async (b: Record<string, unknown>, root = WORKSHOP) => call(pageOf(b.id, root), 'save', root, saveInput(b));
