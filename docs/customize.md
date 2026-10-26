# EDITH 고치기

EDITH 는 받아서 자기 것으로 고쳐 쓰라고 만든 기본판입니다. 서버는 Node 내장 모듈만 쓰는 약 2,200줄, 화면은 React 한 벌이라 처음부터 끝까지 읽을 수 있는 크기입니다.
가장 쉬운 방법은 쓰고 있는 Claude Code·Codex 에게 시키는 것입니다 — 레포의 [`AGENTS.md`](../AGENTS.md)(Claude 는 `CLAUDE.md` 가 그것을 불러온다)에 구조·확인 명령·지켜야 할 보안 규칙이 있습니다.

```
EDITH 폴더에서: "AGENTS.md 를 읽고, pane 머리에 /review 를 보내는 「리뷰」 버튼을 달아 줘"
```

## 내 것으로 만들기

1. GitHub 에서 [johyunduk/EDITH](https://github.com/johyunduk/EDITH) 의 **Use this template** → 내 레포를 만든다(내 히스토리로 새로 시작). 원본 변경을 계속 받고 싶으면 Fork 도 된다.
2. 설치 주소를 내 레포로 바꾼다 — `grep -rn "johyunduk/EDITH" .` 로 나오는 곳(`install.sh`·`install.ps1` 의 기본 주소, `README.md` 의 설치 줄).
3. 내 레포를 클론하고 그 폴더에서 `./install.sh`(Windows 는 `.\install.ps1`) → `edith`. 설치 스크립트는 클론한 폴더를 알아보고 그 자리에서 빌드·등록한다.
   한 줄 설치로 받게 하려면 2번처럼 기본 주소를 바꾸거나, 받을 때 `EDITH_REPO` 를 준다: `curl -fsSL <내 레포의 install.sh 주소> | EDITH_REPO=<내 레포 .git 주소> bash`.

원본 EDITH 의 변경을 받아 오기:

```sh
git remote add upstream https://github.com/johyunduk/EDITH.git
git fetch upstream
git merge upstream/main     # 템플릿으로 만든 레포는 처음 한 번 --allow-unrelated-histories
```

## 고치면서 보기

- **화면(`web/`)** — `edith --no-open` 을 띄운 채 `npm --prefix web run dev` 를 돌리고 찍힌 주소(Vite, 기본 5173)를 연다. 고치는 대로 바로 바뀐다. `/api` 는 4320 의 EDITH 로 넘어가고, 열쇠 쿠키는 포트를 가리지 않아 그대로 쓰인다.
  다 고쳤으면 `npm --prefix web run build` — 평소 `edith` 는 `web/dist` 를 준다(브라우저 새로 고침이면 반영).
- **서버(`src/`)** — 고치면 화면 머리줄에 **새 코드 · 다시 켜기** 가 뜬다(30초 안) — 누르면 같은 터미널에서 새 코드로 다시 뜬다. Ctrl+C → `edith` 도 된다. herdr 와 pane 은 그대로 돈다.
- **확인** — `npm test`, `npm run typecheck`.

## 구조 지도

| 파일 | 하는 일 |
|---|---|
| `src/cli.ts` | `edith` 명령 — 도구 확인, herdr 서버 시작, 화면 서버, 브라우저, `edith update`·`setup`·`connect` |
| `src/server.ts` | HTTP 서버 — 보안 검사(Host·열쇠·출처 — `refuse`), `/api/*` 길 나누기, `web/dist` 주기, SSE(`/api/events`), 다시 켜기(`/api/restart`) |
| `src/herdr.ts` | herdr — 스냅샷, 이벤트 구독, 터미널 흐름(보기·입력), 프롬프트·키, 나누기·옮기기·닫기, 셸 기록, 상태줄 사용량 |
| `src/chat.ts` | Claude·Codex 세션 기록(JSONL) → 대화 항목, 기록 파일 찾기, Codex 사용량, 백그라운드 작업 |
| `src/complete.ts` | 입력칸 자동 완성(`/` 명령·스킬, `@` 파일), Claude 식 글을 Codex 식으로 바꾸기 |
| `src/diff.ts` · `src/summary.ts` | git 변경(커밋 안 한 것·브랜치·커밋), 파일별 AI 요약(`claude -p`) |
| `src/skills.ts` · `src/skillsMove.ts` | 스킬·명령 목록과 서로 부르는 관계, 스킬 옮기기(묶음 파일 내보내기·가져오기) |
| `src/workshop.ts` | 공방 — 체인 · 엔진 · 런 폴더(`~/.local/share/edith/workshop/<id>/`, 코드에서는 셋 다 `engine` — `engine.json` 의 `kind`(`chain` · `engine` · `run`, 없으면 노드로 정함)로 가른다. 런은 노드 없이 `engine`(돌릴 엔진) · `workdir` · `input` · `unattended`, 런이 돌리는 엔진은 못 지운다) 목록(각각이 부르는 체인 · 엔진 `uses` — 초안이 있으면 초안 것, 초안 유무) · 만들기 · 읽기 · 저장(형식 검사 — 종류(체인은 체인 · 엔진 노드 금지) · 노드 종류 · 실패 화살표 · 고리 · 작업 폴더 설정, 읽은 판이 다르면 거절), 초안(`draft.json`) 읽기 · 적용 · 버리기, 공방 Claude pane 찾기 · 띄우기와 안내 `CLAUDE.md` |
| `src/runner.ts` | 실행기(화면 말로 「런」 — 코드는 `run`) — 작업 폴더(고르기 · 고정 · 새 워크트리 `herdr worktree create`), 사본 · 펼치기(체인 · 엔진 노드를 그 안의 노드로 — 공방 「펼쳐 보기」 도 같은 것 `previewSteps`, 초안 기준 · 스킬 파일은 안 찾는다), 노드를 하나씩(스킬은 런 pane 의 Claude 에 새 대화로, 명령은 셸로), 결과 파일 · 실패 화살표 · 확인 필요, 건너뛰기 끝 코드(`SKIP_CODE` 77 — 든 체인 · 엔진의 남은 노드) · 되돌리기(`rewind` — 화면 「이 노드부터 다시」 · 명령 노드의 `$EDITH_REWIND` · 스킬 노드의 `rewind.json` · 런 단추), 갈래(`track` — 갈래마다 노드 하나 · pane 하나 동시에, `nextSteps`), Claude 띄우기 설정(`edith-claude.json` → `--model` · `--effort` · `--mcp-config`), 런 단추(`actions.json` — `on: "results"` 는 결과 체크 때 도는 명령 `resultHook`, `copy` 는 끝까지 기다려 출력을 돌려준다), 동시 런 한도 · 대기 줄(`runs.json` · `startQueued`), 시도마다 띄운 Claude 설정 기록(`claude.json`), 사용량 한도 기다림 · Mac 알림, 무인 런(`unattended` — 확인 필요를 2번까지 다시 돌리고 건너뜀 `unattend`, 백그라운드 셸 동안은 안 일깨움 `bgShells`), `workshop-runs/<번호>/run.json` · `events.jsonl`, 다시 켜면 이어 가기 |
| `src/repos.ts` · `src/outputs.ts` · `src/runSummary.ts` · `src/live.ts` | 런 화면 「레포」(엔진이 남긴 `edith-repos.json` 의 레포를 git 으로 읽기만 — 런 작업 폴더 안만, 「변경 보기」 diff 도) · 「산출물」(`edith-outputs.json` — 파일은 런 작업 폴더 · 실행 폴더 안 글 파일만) · 끝난 런 「요약」(`edith-summary.json`) · 「브라우저 화면」(`edith-live.json` 의 CDP 포트에서 화면 전송을 MJPEG 로 — 127.0.0.1 만) |
| `src/reach.ts` | 코드가 어디까지 — `reachOf`(커밋 그대로 · 내용 일치 — 임시 인덱스에 거꾸로 적용 · 일부 · 제목만), 런 하나의 레포 상태 `runRepos`(`edith-repos.json` — 커밋 안 한 파일 · 올렸는지 · `via` · 브랜치마다), 런 단추 중 단계(`reach`)가 적힌 것 `runActions` · 런 제목 · 꼬리표 |
| `src/deploy.ts` · `web/src/Deploy.tsx` | 「배포」 화면(옛 「결과」 를 품음) — 배포 목록(`deploy.json` — 레포 · 브랜치 · 안건 · 배포일 · 연기 · 보관 · 환경별 할 일 · 기록, 화면 쓰기는 판 `rev` 이 같을 때만, 모든 쓰기는 잠금 `deploy.json.lock`), 코드 상태(`reachOf` 를 브랜치 이름으로 — 워크트리 없이, 안 들어간 환경은 `merge-tree` 충돌 수), 보관한 것은 수만 싣고 목록은 「COMPLETE」 창이 열 때 `deployDone`(`/api/deploy/done?q=&before=` — 날짜로 넘겨 같은 날은 안 자름), 런 잇기(`deployBoard` — 런의 `edith-repos.json` 을 본 레포 · 브랜치로, `via` 면 이슈 줄, 목록에 없으면 `extra`), 안건 단위 다음 환경에 올리기(`promoteMany` — 레포를 모두 먼저 보고 하나라도 안 되면 무, 작업 트리 없이 머지 커밋 → 강제 아닌 push, 처음 · 마지막 환경은 안 함), CLI `edith deploy import · add · set · note · task · range · block · check · done · drop · show`(스킬 · 엔진이 쓴다), 직접 한 일 적기(`addTask` — `hand` 줄은 다시 뽑아도 남김), 배포 조치 뽑기(`prepItems` — 공방 훅 `on: "prep"` 을 기다리지 않고, 상태는 `prep`) |
| `src/cleanup.ts` | 배포 화면 「정리」 — 미리보기(`cleanPlan` — 원본 · 이슈 · `merge/<끝>` · `merge-<환경>/<끝>` 마다 워크트리 · herdr 워크스페이스 · 로컬 브랜치, 코드가 들어갔나는 `contentIn`(합친 트리 = 대상 트리), 커밋 안 한 변경 · stash · 일하는 워크스페이스, 공방 훅 `on: "cleanup"` check)와 정리(`cleanRun` — 훅 run → 워크스페이스 닫기 → 워크트리 제거 → `branch -D` → 보관). 원격 · 본 체크아웃 · 런 기록은 남김 |
| `src/analysis.ts` · `src/timeline.ts` · `src/refs.ts` · `src/requests.ts` | 런 분석(노드마다 시간 · 사람 대기 · 토큰 · 노드 안쪽 도구 시간 — `events.jsonl` 과 Claude 세션 기록, 흐름(벽시계 일 · 사람 · 빈 시간) · 갈래 병목, 엔진 기록 `edith-records.jsonl` — Codex `usage` 줄, 다시 돈 시간, 같은 엔진 런 비교) · 공방 「적용」 전 검사(스킬이 「없으면」 멈춘다고 적은 작업 문서 파일을 앞 노드가 만드는지 — `previewSteps` 의 `warnings`) · 런 타임라인(`events.jsonl` 을 노드 시도로 묶고 시도마다 결과를 붙여 일어난 차례대로 — 런 화면 기본 보기) · 받은 요청(`requests/<id>.json` → 사람이 열기 · 거절, 답 `<id>.answer.json`, `edith request <id>`) |
| `src/today.ts` · `web/src/Today.tsx` | 「오늘」 화면 — 마지막으로 일한 평일부터 어제까지 한 일(`~/.claude/history.jsonl` 의 내 말 — 런이 보낸 글 · `paste-cache` 의 붙여넣기까지 보고 거른다, 그 폴더 레포의 내 커밋, 그 기간 움직인 런), 작업마다 한 줄 · 하다 만 일(`claude -p` 하루 한 번 → `today/<날짜>.json`, `src/summary.ts` 의 `claudeJson`), 체크 · 직접 추가 · 이어 받기(`today/<날짜>.todo.json` — 없으면 앞 날 것에서 `carry`), 할 일 중 대기 · 요청 · 배포는 화면이 승인 대기 · 받은 요청 · 배포 할 일 API 를 그대로 읽는다 |
| `src/settings.ts` | 설정 화면의 플러그인 켜짐(`claude plugin configure <플러그인>@edith`) — 켜고 끌 플러그인은 `PLUGINS` |
| `src/machines.ts` | 다른 기기의 EDITH — `machines.json`, SSH 터널, 그 기기의 열쇠 붙은 주소 |
| `src/config.ts` · `src/sh.ts` | 경로(설정·데이터 폴더), 프로세스 실행 도우미 |
| `web/src/App.tsx` | 머리줄·주소(#/today, #/herdr, #/skills, #/workshop, #/runs, #/deploy — 옛 #/results 도)·승인 대기 알림·새 코드 알림(다시 켜기) |
| `web/src/Herdr.tsx` | herdr 화면 틀 — 왼쪽 사이드바, 오른쪽 고른 pane |
| `web/src/Side.tsx` | 사이드바 — 새 워크스페이스, 워크스페이스·탭·pane 트리(끌어 놓기), 상태 표시, 다른 기기 |
| `web/src/PaneView.tsx` | pane 화면 — 머리(브랜치·사용량·원격·변경·칸 버튼), 본문 고르기, 탭 전체 칸 배치 |
| `web/src/Chat.tsx` · `ShellLog.tsx` · `Term.tsx` | 본문 — 에이전트 대화, 셸 기록, 터미널(xterm.js)·빠른 키 |
| `web/src/Prompt.tsx` | 입력칸 — 보내기, 질문 선택지, 자동 완성, 첨부, 쓰다 만 글 |
| `web/src/herdrUi.tsx` | herdr 화면이 같이 쓰는 조각 — 상태 글·점, 에이전트 아이콘, pane 이름, 끌어 놓기, 우클릭 메뉴 |
| `web/src/Diff.tsx` · `Tasks.tsx` · `Alerts.tsx` · `Skills.tsx` · `Settings.tsx` | 변경 보기, 백그라운드 작업, 알림함, 스킬 화면, 설정 화면 |
| `web/src/Workshop.tsx` · `Runs.tsx` · `AgentPane.tsx` | 공방 화면(체인 · 엔진 목록 — 트리, 서버 목록의 `uses` 로 짠다, 캔버스 React Flow `@xyflow/react`, 노드 · 화살표 칸, 엔진의 「흐름 지도」 `EngineMap.tsx` — 칸 · 줄은 서버 `src/engineMap.ts`(map.json · 기본 지도 · 「전체 보기」 파일 읽기는 공방 폴더 안만)), 런 화면(런 목록 · 새 런, 타임라인 카드 덱 `RunTimeline.tsx` — 체인마다 지금 · 끝 · 남음 나누기는 `runFlow.ts` 의 `chainView`, 「캔버스」 = 런 흐름 `RunFlow.tsx` — 큰 단계 상자 · 갈래 줄 묶기는 `runFlow.ts`, 「분석」 의 먼저 볼 것 · 단계별 묶기는 `runStats.ts`), 공방 「펼쳐 보기」 의 펼친 캔버스(`StepFlow.tsx` — 자리는 `stepFlow.ts`, 런 기록의 `boxes` 로 상자를 짠다), 둘이 같이 쓰는 오른쪽 Claude 칸 |
| `web/src/api.ts` · `ui.tsx` · `Menu.tsx` · `copy.ts` | 서버 호출(`get`·`post`)·응답 타입, 작은 공용 조각, 우클릭 메뉴, 복사·알림 한 줄 |
| `web/src/index.css` | 색·글꼴(밝은·어두운 화면 변수) |
| `install.sh` · `install.ps1` | 설치 스크립트(macOS·Linux / Windows) |
| `plugins/` · `.claude-plugin/marketplace.json` | Claude Code 플러그인(mod) — `rc-keepalive`(끊긴 Remote Control 다시 켜기), `commit-guard`(git commit·push 전에 묻기), `peer-message`(Claude 끼리는 SendMessage). 레포가 마켓플레이스 `edith` |
| `workshop/engine-skill.md` | 공방 Claude 의 만들기 스킬(체인 · 엔진) — 묻기 · 노드 나누기 · 스킬 쓰기 · 초안(`draft.json`). 공방 폴더 `CLAUDE.md` 가 이 파일을 경로로 가리킨다(플러그인 아님 — 공방에서만 쓴다) |

## 흔한 수정

### pane 머리에 버튼 달기 — 프롬프트 보내기

`web/src/PaneView.tsx` 의 `PaneView` 머리줄 `<span className="ml-auto flex items-center gap-1">` 안(`<BgTasks p={p} />` 옆)에:

```tsx
<button onClick={() => void post(`/api/herdr/panes/${p.id}/prompt`, { text: '/review' })}
  className="flex h-7 items-center rounded-md border bg-card px-2 text-xs font-semibold hover:bg-muted">리뷰</button>
```

에이전트 pane 이면 그 에이전트 입력으로(herdr `agent.prompt`), 셸이면 명령 + Enter 로 들어간다. Codex pane 에는 `/스킬` 이 `$스킬` 로 바뀌어 간다.

### 우클릭 메뉴에 항목 넣기

`web/src/herdrUi.tsx` 의 `usePaneMenu` 가 돌려주는 목록에 `{ label: '테스트 돌리기', run: call('prompt', { text: 'npm test' }) }` 를 넣는다. `'-'` 는 구분선, `danger`·`confirm` 은 빨간색·두 번 눌러야 실행.

### API 하나 더하기

`src/server.ts` 의 `/api/herdr` 줄 위쪽에:

```ts
if (path === '/api/hello') return reply(res, 200, { hello: 'world' });

if (req.method === 'POST' && path === '/api/note') {
  const b = await body(req) as { text?: unknown };
  if (typeof b.text !== 'string' || !b.text.trim()) return reply(res, 400, 'text 가 없다');
  // … 할 일
  return reply(res, 200, { ok: true });
}
```

`/api/` 아래라 열쇠·출처 검사는 이미 앞에서 끝난다. 브라우저에서 온 값은 `unknown` 으로 받아 모양을 확인한다. 화면에서는 `get<{ hello: string }>('/api/hello')`·`post('/api/note', { text })`(`web/src/api.ts`), 다시 읽기를 원하면 TanStack Query 의 `useQuery`.

### herdr 기능 쓰기

`src/herdr.ts` 에 함수를 더한다. 읽기는 `sh('herdr', [...])`(CLI 가 소켓보다 빠르다), 쓰기는 `api('메서드', { … })`. 쓸 수 있는 메서드와 인자는 `herdr api schema`, CLI 는 `herdr <명령>` 을 하위 명령 없이 쳐서 본다. 예: 워크스페이스 이름 바꾸기는 `api('workspace.rename', { workspace_id, label })`.

### 머리줄에 화면(탭) 하나 더하기

`web/src/App.tsx`:

1. `route()` 에 `#/notes` 를 알아보는 줄을 더한다.
2. `<nav>` 에 `<a href="#/notes" className={nav(r.view === 'notes')}>노트</a>`.
3. 아래 `{r.view === 'skills' ? … : …}` 에 새 화면 컴포넌트를 더한다(새 파일 `web/src/Notes.tsx`).

### 알림 바꾸기

승인 대기 브라우저 알림·소리는 `App.tsx` 의 `useBlockedAlert`·`beep`, 알림함 내역은 `Alerts.tsx`. 끝남에도 소리를 내려면 `useBlockedAlert` 의 `blocked` 조건에 `done` 을 더한다.

### 색·글꼴·기본 포트

「설정」 화면(`web/src/Settings.tsx`)에서 **EDITH**(밝은 청록)와 **ULTRON**(어두운 붉은 신경망)을 전환한다. 기본은 EDITH 이며 OS 밝기 설정과 독립적이다. 선택은 브라우저의 `edith.theme`에 저장한다(저장이 막히면 현재 화면에서만 적용).

앱 이름은 `web/src/theme.ts`의 `APP_NAME`에서 테마와 별도로 정한다. 선택지·밝기 모드는 `web/src/theme.ts`의 `THEMES`, 템플릿 기본값은 `DEFAULT_THEME`에서 바꾼다. 색·모서리·질감은 `web/src/index.css`의 `:root`(EDITH 기본값)와 `:root[data-theme="ultron"]`에서 정의한다. 예전 이름(daylight·neural)으로 저장된 값은 새 이름으로 이어 받는다. 새 테마는 `THEMES`에 항목(설정 화면 고르기 칸의 `desc`·`swatch` 포함)을 추가하고 해당 `data-theme` CSS 변수를 정의하면 선택 목록에 나타난다. `dark:…` 스타일은 선택한 테마의 `dark` 값에 따라 적용된다. 상태 점·승인 카드·diff·코드 출력의 의미 색은 유지한다. 테마를 바꿔도 헤더·사이드바 하단·브라우저 제목은 EDITH를 유지하며 CLI 명령과 서버 설정 이름은 `edith`를 유지한다.

기본 포트 4320 은 `src/cli.ts`, 화면 개발 서버가 넘기는 곳은 `web/vite.config.ts` 의 `TARGET`.

## 지켜야 할 보안

이 화면은 내 터미널에 키를 보낼 수 있습니다. [`AGENTS.md`](../AGENTS.md) 「지켜야 하는 것」 의 규칙(127.0.0.1 에만, Host 확인, 열쇠 쿠키, 같은 출처 JSON POST, 파일은 정해 둔 폴더만)을 약하게 만드는 수정은 위험을 알고 할 때만 합니다. 다른 기기에서 보고 싶으면 서버를 밖으로 열지 말고 SSH 터널(README 「다른 기기의 EDITH 열기」)을 씁니다.
