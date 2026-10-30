// 엔진 설정 — 주소 #/settings/engine/<id>. 공방 엔진 on: "settings" 명령이 낸 표(src/engineSettings.ts)를 그리고, 줄을 펼쳐 그 자리에서 고친다.
// 표 모양(칸 · 줄 · 묶음 · 더하기)은 엔진이 정한다. 비밀 칸은 「설정됨」 만 보이고, 새로 넣은 값만 보낸다
import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { get, post } from './api.ts';

type Field = { key: string; label: string; type: 'text' | 'select' | 'bool' | 'secret'; options?: { value: string; label: string }[]; hint?: string; mono?: boolean };
type Values = Record<string, string | boolean>;
type Row = { id: string; group?: string; values: Values; note?: string; tone?: 'ok' | 'warn' | 'off'; edit: string[]; remove: boolean };
type Table = { title: string; note?: string; status?: string; fields: Field[]; columns: string[]; groups: { id: string; label: string; note?: string }[]; rows: Row[];
  add: { label: string; group?: string; edit: string[]; values: Values }[] };

const TONE = { ok: 'bg-emerald-500', warn: 'bg-amber-500', off: 'bg-muted-foreground/40' };
const field = 'h-9 w-full rounded-md border bg-card px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40';

// 칸 값을 표에 보일 글로 — 고르기는 그 이름, 참거짓은 예 · 아니오, 비밀은 설정됐는지만
function shown(f: Field | undefined, v: string | boolean | undefined) {
  if (!f || v === undefined || v === '') return '—';
  if (f.type === 'secret') return v ? '설정됨' : '없음';
  if (f.type === 'bool') return v ? '예' : '아니오';
  if (f.type === 'select') return f.options?.find(o => o.value === v)?.label ?? String(v);
  return String(v);
}

export function EngineSettingsPage({ id }: { id: string }) {
  const qc = useQueryClient(), key = ['engine-settings', id];
  const { data: t, error } = useQuery({ queryKey: key, queryFn: () => get<Table>(`/api/settings/engine/table?id=${encodeURIComponent(id)}`) });
  const [group, setGroup] = useState(''), [open, setOpen] = useState<string | null>(null);   // open — 펼친 줄 id, 더하기는 「+<차례>」
  const save = async (b: Record<string, unknown>) => { qc.setQueryData(key, await post<Table>('/api/settings/engine/save', { id, ...b })); setOpen(null); };
  if (error) return <Page><p className="text-sm text-destructive">엔진 설정을 읽지 못했다 — {(error as Error).message}</p></Page>;
  if (!t) return <Page><p className="text-sm text-muted-foreground">불러오는 중…</p></Page>;

  const byKey = new Map(t.fields.map(f => [f.key, f])), rows = t.rows.filter(r => !group || r.group === group);
  const g = t.groups.find(x => x.id === group), cols = (t.groups.length && !group ? 1 : 0) + t.columns.length + (t.status ? 1 : 0) + 1;
  const chip = (on: boolean) => `h-8 rounded-full border px-3.5 text-sm transition ${on ? 'border-primary bg-accent font-semibold text-accent-foreground' : 'bg-card hover:bg-muted/60'}`;
  return (
    <Page>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-xl font-bold tracking-tight">{t.title}</h1>
          {t.note && <p className="max-w-3xl text-sm text-muted-foreground">{t.note}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {t.add.map((a, i) => <Button key={a.label} onClick={() => { setOpen(`+${i}`); if (a.group) setGroup(a.group); }}>+ {a.label}</Button>)}
        </div>
      </div>

      {t.groups.length > 0 && (
        <div role="group" aria-label="묶음으로 거르기" className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={!group} onClick={() => setGroup('')} className={chip(!group)}>전체 {t.rows.length}</button>
          {t.groups.map(x => {
            const n = t.rows.filter(r => r.group === x.id).length;
            return <button key={x.id} type="button" aria-pressed={group === x.id} onClick={() => setGroup(x.id)} className={chip(group === x.id)}>{x.label} {n || '—'}</button>;
          })}
        </div>
      )}
      {g?.note && <p className="-mt-2 text-sm text-muted-foreground">{g.note}</p>}

      {t.add.map((a, i) => open === `+${i}` && (
        <section key={a.label} aria-label={a.label} className="rounded-lg border border-primary bg-card p-4 ring-3 ring-primary/15">
          <h2 className="mb-3 text-sm font-semibold">{a.label}</h2>
          <Edit fields={a.edit.map(k => byKey.get(k)!)} values={a.values} onCancel={() => setOpen(null)} onSave={values => save({ op: 'add', add: i, values })} adding />
        </section>
      ))}

      {rows.length === 0
        ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{g?.note ?? '줄이 없다'}</p>
        : (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="bg-muted text-left text-xs text-muted-foreground">
                  {t.groups.length > 0 && !group && <th scope="col" className="px-3.5 py-2.5 font-semibold">묶음</th>}
                  {t.columns.map(c => <th key={c} scope="col" className="px-3.5 py-2.5 font-semibold">{byKey.get(c)?.label}</th>)}
                  {t.status && <th scope="col" className="px-3.5 py-2.5 font-semibold">{t.status}</th>}
                  <th scope="col" className="px-3.5 py-2.5"><span className="sr-only">고치기</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.flatMap(r => {
                  const on = open === r.id, can = r.edit.length > 0 || r.remove;
                  return [
                    <tr key={r.id} className={`border-t align-top ${on ? 'bg-accent/60' : ''}`}>
                      {t.groups.length > 0 && !group && <td className="px-3.5 py-3 text-muted-foreground">{t.groups.find(x => x.id === r.group)?.label ?? '—'}</td>}
                      {t.columns.map((c, j) => <td key={c} className={`px-3.5 py-3 break-words ${j === 0 ? 'font-semibold' : ''} ${byKey.get(c)?.mono ? 'font-mono text-[0.8rem]' : ''}`}>{shown(byKey.get(c), r.values[c])}</td>)}
                      {t.status && <td className="px-3.5 py-3">{r.note && <span className="inline-flex items-start gap-2"><span className={`mt-1.5 size-2 shrink-0 rounded-full ${TONE[r.tone ?? 'off']}`} />{r.note}</span>}</td>}
                      <td className="px-3.5 py-2 text-right">{can && <Button variant={on ? 'outline' : 'secondary'} size="sm" aria-expanded={on} onClick={() => setOpen(on ? null : r.id)}>{on ? '접기 ▴' : '펼치기 ▾'}</Button>}</td>
                    </tr>,
                    on && (
                      <tr key={`${r.id}-edit`} className="bg-accent/60">
                        <td colSpan={cols} className="px-3.5 pb-4">
                          <div className="rounded-lg border bg-card p-4">
                            <Edit fields={r.edit.map(k => byKey.get(k)!)} values={r.values} onCancel={() => setOpen(null)} onSave={values => save({ op: 'set', row: r.id, values })}
                              onRemove={r.remove ? () => save({ op: 'remove', row: r.id }) : undefined} />
                          </div>
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
    </Page>
  );
}

const Page = ({ children }: { children: ReactNode }) => (
  <div className="min-h-0 flex-1 overflow-y-auto">
    <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6">
      <a href="#/settings" className="w-fit text-sm text-muted-foreground hover:text-foreground">‹ 설정</a>
      {children}
    </div>
  </div>
);

// 고치기 칸 — 바꾼 칸만 보낸다(더하기는 다). 비밀 칸은 비워 두면 그대로, 지우기는 한 번 더 눌러야
function Edit({ fields, values, onSave, onCancel, onRemove, adding }: { fields: Field[]; values: Values; onSave: (v: Values) => Promise<void>; onCancel: () => void; onRemove?: () => Promise<void>; adding?: boolean }) {
  const start = Object.fromEntries(fields.map(f => [f.key, f.type === 'secret' ? '' : f.type === 'bool' ? values[f.key] === true : String(values[f.key] ?? '')])) as Values;
  const [v, setV] = useState(start), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [sure, setSure] = useState(false);
  const run = async (f: () => Promise<void>) => { setBusy(true); setErr(''); try { await f(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const changed = Object.fromEntries(Object.entries(v).filter(([k, x]) => adding ? true : fields.find(f => f.key === k)?.type === 'secret' ? x !== '' : x !== start[k]));
  return (
    <form onSubmit={e => { e.preventDefault(); void run(() => onSave(changed)); }} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {fields.filter(f => f.type !== 'bool').map(f => (
          <label key={f.key} className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
            {f.label}
            {f.type === 'select'
              ? <select value={String(v[f.key])} onChange={e => setV({ ...v, [f.key]: e.target.value })} className={field}>
                  {!f.options?.some(o => o.value === v[f.key]) && <option value={String(v[f.key])}>{String(v[f.key]) || '—'}</option>}
                  {f.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              : <input type={f.type === 'secret' ? 'password' : 'text'} autoComplete={f.type === 'secret' ? 'new-password' : 'off'} value={String(v[f.key])}
                  placeholder={f.type === 'secret' ? (values[f.key] ? '설정됨 — 바꿀 때만 넣는다' : '없음') : undefined}
                  onChange={e => setV({ ...v, [f.key]: e.target.value })} className={`${field} ${f.mono ? 'font-mono' : ''}`} />}
            {f.hint && <span className="text-xs text-muted-foreground/90">{f.hint}</span>}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {fields.filter(f => f.type === 'bool').map(f => (
          <label key={f.key} className="mr-auto flex items-center gap-2 text-sm">
            <input type="checkbox" checked={v[f.key] === true} onChange={e => setV({ ...v, [f.key]: e.target.checked })} className="size-4 accent-[var(--primary)]" />{f.label}
          </label>
        ))}
        {onRemove && (sure
          ? <Button type="button" variant="destructive" disabled={busy} onClick={() => void run(onRemove)}>정말 지운다</Button>
          : <Button type="button" variant="outline" className="text-destructive" disabled={busy} onClick={() => setSure(true)}>지우기</Button>)}
        <span className="ml-auto flex gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>취소</Button>
          <Button type="submit" disabled={busy || (!adding && !Object.keys(changed).length)}>{busy ? '저장 중…' : '저장'}</Button>
        </span>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
    </form>
  );
}
