// 서버(src/server.ts) 응답 모양과 조회. 실시간 갱신은 SSE — herdr 가 바뀌면 워크스페이스 목록을 다시 받는다.
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export type HWorkspace = {
  workspace_id: string; number: number; label: string; agent_status?: string; tab_count: number; pane_count: number; focused: boolean;
  worktree?: { repo_key: string; repo_name: string; checkout_path: string; is_linked_worktree: boolean };
};
export type HTab = { tab_id: string; workspace_id: string; number: number; label: string; agent_status?: string; pane_count: number };
export type HPane = {
  id: string; tab: string; workspace: string; agent: string | null; name: string | null; status: string | null;
  title: string; cwd: string; focused: boolean; cols: number; rows: number;
};
type Box = { x: number; y: number; w: number; h: number };
export type HSplit = Box & { path: boolean[]; dir: string; ratio: number };
export type HLayout = { tab: string; zoomed: boolean; panes: (Box & { id: string })[]; splits: HSplit[] };
export type HerdrView = { focused: string; workspaces: HWorkspace[]; tabs: HTab[]; panes: HPane[]; layouts: HLayout[] };

export async function get<T>(path: string, as: 'json' | 'text' = 'json'): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (as === 'json' ? r.json() : r.text()) as Promise<T>;
}

// 쓰기 — 서버가 JSON 본문·같은 출처만 받는다.
export async function post<T = unknown>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text());
  return await r.json() as T;
}

export const useHerdr = () => useQuery({ queryKey: ['herdr'], queryFn: () => get<HerdrView>('/api/herdr') });
// 이 화면을 어디서 보는지 — remote 면 다른 기기의 EDITH 를 SSH 터널로 보고 있다(host 는 그 기기 이름)
export const useView = () => useQuery({ queryKey: ['view'], queryFn: () => get<{ remote: boolean; host: string; version?: string }>('/api/view'), staleTime: Infinity });

export function useLive() {
  const qc = useQueryClient();
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.addEventListener('herdr', () => void qc.invalidateQueries({ queryKey: ['herdr'] }));
    return () => es.close();
  }, [qc]);
}
