// herdr 화면 여러 곳(사이드바·pane 머리·칸·알림함)이 같이 쓰는 조각 — 상태 글·점, 에이전트 아이콘, pane 이름, 끌어 놓기, 우클릭 메뉴.
import { useQueryClient } from '@tanstack/react-query';
import type { HerdrView, HPane, HTab, HWorkspace } from './api.ts';
import { Icon, TERMINAL } from './ui.tsx';
import type { MenuItem } from './Menu.tsx';
import claudeIcon from './icons/claude.svg';
import codexIcon from './icons/codex.svg';

// unknown 은 에이전트가 없거나 herdr 가 상태를 못 가린 것 — 표시하지 않는다.
export const STATUS: Record<string, string> = { working: '작업 중', blocked: '승인 대기', done: '끝남', idle: '대기' };
export const DOT: Record<string, string> = { working: 'bg-sky-500', blocked: 'bg-amber-500', done: 'bg-emerald-500' };
const ICON: Record<string, string> = { claude: claudeIcon, codex: codexIcon };

// 에이전트 종류 — Claude·Codex 는 아이콘, 그 밖의 에이전트는 첫 글자, 셸은 터미널 아이콘.
export function Kind({ agent }: { agent: string | null }) {
  if (agent && ICON[agent]) return <img src={ICON[agent]} alt={agent} className="size-3.5 shrink-0" />;
  if (!agent) return <Icon className="size-3.5 text-muted-foreground">{TERMINAL}</Icon>;
  return <span className="w-3.5 shrink-0 text-center font-mono text-[0.625rem] text-muted-foreground">{agent[0].toUpperCase()}</span>;
}

// 끌어 놓기 — pane 은 DRAG_PANE, 워크스페이스는 DRAG_WS 로 싣는다. 옮긴 뒤 herdr 가 준 새 pane id 로 간다(워크스페이스를 넘으면 바뀐다).
export const DRAG_PANE = 'text/x-herdr-pane', DRAG_WS = 'text/x-herdr-ws';
export const carrying = (e: React.DragEvent, t: string) => e.dataTransfer.types.includes(t);
export function useMove() {
  const qc = useQueryClient();
  return async (url: string, body: unknown) => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { alertLine(await r.text()); return false; }
    const j = await r.json() as { id?: string };
    await qc.invalidateQueries({ queryKey: ['herdr'] });
    if (j.id) location.hash = `#/herdr/${j.id}`;
    return true;
  };
}
// 우클릭 메뉴 — pane(사이드바 줄·칸 머리), 워크스페이스(사이드바). 고르는 것은 버튼·끌어 놓기와 같은 API 를 부른다.
// 셸이 프롬프트에서 쉬는 중인지 — 창 제목이 비었거나, macOS·Linux 는 사용자@호스트:경로, Windows 는 셸 이름·경로(pwsh·powershell·cmd).
// 명령이 돌면 창 제목이 그 명령이 된다.
// ponytail: Windows 셸 창 제목은 확인하지 않았다 — 명령이 돌아도 제목이 그대로면 「실행 중」 이 안 보일 뿐이다.
export const atPrompt = (title: string) => !title || /^[^\s@]+@[^:\s]+:/.test(title)
  || /(^|[\\/ ])(pwsh|powershell|cmd)(\.exe)?$/i.test(title.trim()) || /^(Windows )?PowerShell( \d.*)?$/i.test(title.trim());
const shellIdle = (p: HPane) => !p.agent && atPrompt(p.title);
export function usePaneMenu() {
  const move = useMove();
  return (p: HPane): MenuItem[] => {
    const call = (what: string, body: unknown = {}) => () => move(`/api/herdr/panes/${p.id}/${what}`, body);
    return [
      { label: '열기', run: () => { location.hash = `#/herdr/${p.id}`; } },
      '-',
      { label: '왼쪽에 새 칸', run: call('split', { direction: 'left' }) },
      { label: '오른쪽에 새 칸', run: call('split', { direction: 'right' }) },
      { label: '위에 새 칸', run: call('split', { direction: 'up' }) },
      { label: '아래에 새 칸', run: call('split', { direction: 'down' }) },
      { label: '새 탭으로 빼기', run: call('move', { workspace: p.workspace }) },
      ...(shellIdle(p) ? ['-', { label: '여기서 Claude 띄우기', run: call('start', { kind: 'claude' }) }, { label: '여기서 Codex 띄우기', run: call('start', { kind: 'codex' }) }] as MenuItem[] : []),
      '-',
      { label: 'Esc 보내기', run: call('keys', { key: 'esc' }) },
      { label: 'Ctrl+C 보내기', run: call('keys', { key: 'ctrl+c' }) },
      { label: '작업 폴더 경로 복사', run: () => navigator.clipboard.writeText(p.cwd) },
      '-',
      { label: '닫기', danger: true, confirm: true, run: async () => { await move(`/api/herdr/panes/${p.id}/close`, {}); if (decodeURIComponent(location.hash).endsWith(p.id)) location.hash = '#/herdr'; } },
    ];
  };
}
export function useWorkspaceMenu(data: HerdrView) {
  const move = useMove();
  return (w: HWorkspace): MenuItem[] => {
    const call = (what: string, body: unknown = {}) => () => move(`/api/herdr/workspaces/${w.workspace_id}/${what}`, body);
    const first = [...data.workspaces].sort((a, b) => a.number - b.number)[0];
    const path = w.worktree?.checkout_path ?? data.panes.find(p => p.workspace === w.workspace_id)?.cwd ?? '';
    return [
      { label: '새 탭', run: call('tab') },
      { label: '이름 바꾸기', input: { initial: w.label, submit: v => move(`/api/herdr/workspaces/${w.workspace_id}/rename`, { label: v }) } },
      '-',
      { label: '맨 위로', run: call('move', { before: first.workspace_id }) },
      { label: '맨 아래로', run: call('move', { before: null }) },
      { label: '경로 복사', run: () => navigator.clipboard.writeText(path) },
    ];
  };
}

// 탭 메뉴 — 사이드바 탭 줄·제목 옆 탭 이름. 워크스페이스 이름도 여기서 바꾼다.
export function useTabMenu() {
  const move = useMove();
  return (w: HWorkspace, t: HTab): MenuItem[] => [
    { label: '워크스페이스 이름 바꾸기', input: { initial: w.label, submit: v => move(`/api/herdr/workspaces/${w.workspace_id}/rename`, { label: v }) } },
    { label: '탭 이름 바꾸기', input: { initial: t.label, submit: v => move(`/api/herdr/tabs/${t.tab_id}/rename`, { label: v }) } },
    '-',
    { label: '새 탭', run: () => move(`/api/herdr/workspaces/${w.workspace_id}/tab`, {}) },
  ];
}

// 옮기기 실패를 잠깐 띄운다(모달 없이 화면 위쪽 한 줄)
function alertLine(msg: string) {
  const el = document.createElement('div');
  el.textContent = `하지 못했다 — ${msg}`;
  el.className = 'fixed top-14 left-1/2 z-50 -translate-x-1/2 rounded-md bg-destructive px-3 py-1.5 text-sm text-white shadow';
  document.body.append(el);
  setTimeout(() => el.remove(), 4000);
}

// pane 이름 — 창 제목(종류는 앞 아이콘). 셸은 프롬프트(사용자@호스트:경로)면 「셸」, 명령이 돌면 그 명령.
export function paneText(p: HPane) {
  if (!p.agent) return atPrompt(p.title) ? '셸' : p.title;
  return p.title || p.agent;
}

// 다른 기기·Remote Control 아이콘
export const REMOTE = <><path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8" /><path d="M10 19v-3.96 3.15" /><path d="M7 19h5" /><rect width="6" height="10" x="16" y="12" rx="2" /></>;   // lucide monitor-smartphone
