// herdr — 왼쪽 워크스페이스·탭·pane 과 에이전트 상태, 오른쪽 고른 pane 의 터미널(실시간, 누르면 입력)·빠른 키·프롬프트. 주소는 #/herdr/<pane id>.
// 사이드바는 Side.tsx, pane 화면은 PaneView.tsx(본문 Chat·ShellLog·Term, 입력칸 Prompt), 같이 쓰는 조각은 herdrUi.tsx.
import { useHerdr } from './api.ts';
import { Empty } from './ui.tsx';
import { MenuHost } from './Menu.tsx';
import { Legend, NewWorkspace, OtherDevices, SideFooter, Tree } from './Side.tsx';
import { PaneView } from './PaneView.tsx';

export function HerdrPage({ pane, side = true, brand = 'EDITH' }: { pane?: string; side?: boolean; brand?: string }) {
  const { data, error } = useHerdr();
  if (!data && !error) return null;
  // herdr 에 닿지 않아도(edith --no-herdr 등) 사이드 메뉴의 「다른 기기」 는 쓸 수 있게 둔다
  const sel = data?.panes.find(p => p.id === pane);
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <MenuHost />
      {/* 트리만 스크롤하고 아래(상태 표시·다른 기기·하단 줄)는 붙여 둔다 */}
      <aside className={`workspace-sidebar flex max-h-72 shrink-0 flex-col overflow-hidden border-b bg-sidebar md:max-h-none md:w-80 md:border-r md:border-b-0 ${side ? '' : 'hidden'}`}>
        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
          {data && <><NewWorkspace /><Tree data={data} sel={sel?.id} /></>}
        </nav>
        {data && <Legend data={data} />}
        <OtherDevices />
        <SideFooter brand={brand} ready={!!data} />
      </aside>
      <main className="min-w-0 flex-1 overflow-auto p-4">
        {!data ? <Empty>이 기기 herdr 에 닿지 않는다 — {String(error)}. 다른 기기의 EDITH 는 왼쪽 아래 「다른 기기」 에서 연다.</Empty>
          : sel ? <PaneView p={sel} data={data} /> : <Empty>{pane ? `pane ${pane} 이 없다(닫혔을 수 있다)` : '왼쪽에서 pane 을 고른다'}</Empty>}
      </main>
    </div>
  );
}
