// 설정 — 주소 #/settings. 화면 테마(이 브라우저에 남는다)와 EDITH 가 까는 Claude 플러그인 켜기·끄기(이 화면을 연 기기의 Claude).
// 다른 기기를 터널로 보고 있으면 플러그인은 그 기기 것을 바꾼다 — 그래서 기기 이름을 붙여 보인다.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { get, post, useView } from './api.ts';
import { THEMES, type Theme } from './theme.ts';

export function SettingsPage({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const view = useView().data;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
        <h1 className="text-xl font-bold tracking-tight">설정</h1>
        <Section title="화면 테마" note="이 브라우저에만 남는다">
          <div className="grid gap-3 sm:grid-cols-2">
            {(Object.entries(THEMES) as [Theme, (typeof THEMES)[Theme]][]).map(([id, t]) => (
              <button key={id} onClick={() => setTheme(id)} aria-pressed={theme === id}
                className={`flex items-center gap-3 rounded-lg border bg-card p-3 text-left transition hover:bg-muted/60 ${theme === id ? 'border-primary ring-2 ring-primary/30' : ''}`}>
                <span className="flex h-12 w-16 shrink-0 items-end gap-1 rounded-md border p-1.5" style={{ background: t.swatch[0] }}>
                  <span className="h-6 flex-1 rounded-sm" style={{ background: t.swatch[1] }} />
                  <span className="h-8 w-2 rounded-sm" style={{ background: t.swatch[2] }} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold tracking-[0.08em]">{t.label}</span>
                  <span className="block text-xs text-muted-foreground">{t.desc}</span>
                </span>
                <span className={`size-4 shrink-0 rounded-full border-2 ${theme === id ? 'border-primary bg-primary shadow-[inset_0_0_0_2px_var(--card)]' : 'border-muted-foreground/40'}`} />
              </button>
            ))}
          </div>
        </Section>
        <Section title="런" note="공방 엔진 · 체인을 돌리는 런">
          <RunLimit />
        </Section>
        <EngineSettings />
        <Section title="Claude" note={view ? `${view.remote ? '다른 기기' : '이 기기'} 「${view.host}」 의 Claude 에 적용` : undefined}>
          <PluginToggles />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2 border-b pb-1.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </div>
      {children}
    </section>
  );
}

// 엔진 설정 — 공방 엔진이 actions.json 에 on: "settings" 로 낸 표(src/engineSettings.ts). 없으면 칸을 안 보인다
function EngineSettings() {
  const { data } = useQuery({ queryKey: ['engine-settings-list'], queryFn: () => get<{ id: string; label: string }[]>('/api/settings/engine') });
  if (!data?.length) return null;
  return (
    <Section title="엔진 설정" note="공방 엔진이 쓰는 설정 — 무엇을 어디에 저장하는지는 그 엔진이 정한다">
      <div className="flex flex-col gap-2">
        {data.map(p => (
          <a key={p.id} href={`#/settings/engine/${encodeURIComponent(p.id)}`} className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 text-sm transition hover:bg-muted/60">
            <span className="font-semibold">{p.label}</span><span className="text-xs text-muted-foreground">{p.id.split('.')[0]} ›</span>
          </a>
        ))}
      </div>
    </Section>
  );
}

// 동시에 도는 런 수 — 넘으면 새 런은 「대기」 로 줄을 서고 자리가 나면 먼저 온 것부터(확인 필요인 런도 센다)
function RunLimit() {
  const qc = useQueryClient(), { data } = useQuery({ queryKey: ['run-limit'], queryFn: () => get<{ max: number }>('/api/runs/limit') });
  const [err, setErr] = useState('');
  const set = async (max: number) => {
    setErr('');
    try { qc.setQueryData(['run-limit'], await post<{ max: number }>('/api/runs/limit', { max })); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <label className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 text-sm">
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">동시에 도는 런</span>
        <span className="block text-xs text-muted-foreground">넘으면 새 런은 「대기」 로 줄을 서고, 도는 런이 끝나면 먼저 온 것부터 시작한다. 확인 필요(사람 대기)인 런도 센다 — 그동안에도 그 런의 Claude · 로컬 서버를 쥐고 있다.</span>
        {err && <span className="block text-xs text-destructive">{err}</span>}
      </span>
      <select value={data?.max ?? 2} disabled={!data} onChange={e => void set(Number(e.target.value))}
        className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring/50">
        {Array.from({ length: 10 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}개</option>)}
      </select>
    </label>
  );
}

// EDITH 가 함께 까는 Claude 플러그인 — 켜고 끄면 떠 있는 Claude 세션도 다음 호출부터 따른다.
type Toggle = 'commitGuard' | 'peerMessage';
const TOGGLES: { key: Toggle; plugin: string; title: string; desc: ReactNode }[] = [
  { key: 'commitGuard', plugin: 'commit-guard', title: '커밋·push 전에 묻기',
    desc: <>켜면 Claude 가 <code>git commit</code>·<code>git push</code> 를 하기 전에 매번 「실행 / 막기」 를 묻는다 — auto 모드·허용 규칙이어도. 끄면 Claude Code 의 보통 권한 확인대로 한다.</> },
  { key: 'peerMessage', plugin: 'peer-message', title: 'Claude 끼리는 SendMessage 로 보내기',
    desc: <>켜면 Claude 가 다른 Claude 세션에 herdr 로 글을 치려 할 때 막고 <code>SendMessage</code> 로 보내게 한다 — 받는 쪽에서 사용자 지시와 구분되고, 승인 창에 끼어들지 않는다. Codex·셸 pane, 슬래시 명령·키 입력은 herdr 그대로.</> },
];

function PluginToggles() {
  const qc = useQueryClient();
  const { data, error } = useQuery({ queryKey: ['settings'], queryFn: () => get<Record<Toggle, boolean | null>>('/api/settings') });
  const [busy, setBusy] = useState<Toggle | null>(null), [err, setErr] = useState('');
  const flip = async (key: Toggle) => {
    setBusy(key); setErr('');
    try { qc.setQueryData(['settings'], await post<Record<Toggle, boolean | null>>('/api/settings', { key, on: !data?.[key] })); }
    catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
    finally { setBusy(null); }
  };
  return (
    <div className="divide-y rounded-lg border bg-card">
      {TOGGLES.map(t => {
        const on = data?.[t.key];
        return (
          <div key={t.key} className="flex items-start gap-4 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t.desc}</p>
              {on === null && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">Claude 플러그인 {t.plugin} 가 설치돼 있지 않다 — 터미널에서 <code>edith setup</code></p>}
            </div>
            {data === undefined ? <span className="pt-1 text-xs text-muted-foreground">{error ? '' : '읽는 중…'}</span> : on !== null && (
              <button role="switch" aria-checked={!!on} aria-label={t.title} disabled={busy !== null} onClick={() => void flip(t.key)}
                className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition disabled:opacity-60 ${on ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
                <span className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
              </button>
            )}
          </div>
        );
      })}
      {(err || (error && !data)) && <p className="p-4 text-xs text-destructive">{err || String(error)}</p>}
      <p className="p-4 text-xs text-muted-foreground">떠 있는 Claude 세션에도 다음 호출부터 바로 적용된다. Claude 의 <code>/config</code> 에서도 바꿀 수 있다.</p>
    </div>
  );
}
