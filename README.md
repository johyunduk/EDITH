# EDITH

Browser console for [herdr](https://herdr.dev) — watch and drive Claude Code and Codex panes from one page.

herdr 로 띄운 Claude Code·Codex·셸 pane 을 브라우저 한 화면에서 보고 다루는 로컬 화면입니다. 여러 pane 을 한눈에 보고, 답해야 할 곳(승인 대기·끝남)으로 바로 갑니다. 터미널을 대신하지는 않습니다 — 같은 herdr 서버에 터미널로도 붙을 수 있습니다.

## 빠른 시작

**1. 설치** — 없는 것만 설치하고, 다시 돌려도 됩니다. sudo·관리자 권한은 쓰지 않습니다.

macOS·Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/johyunduk/EDITH/main/install.sh | bash
```

Windows(PowerShell — WSL 없이):

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/johyunduk/EDITH/main/install.ps1 | iex"
```

**2. 새 터미널을 열고 로그인** — 바뀐 PATH 는 새 터미널부터 잡힙니다.

```sh
claude    # Claude Code 로그인
codex     # Codex 로그인
```

**3. 실행**

```sh
edith
```

herdr 서버가 꺼져 있으면 화면 없이 띄우고, 브라우저로 EDITH 를 엽니다. 다음부터는 `edith` 만 치면 됩니다.

설명서: [사용 설명서](docs/guide.md) · [고치기](docs/customize.md)

> 확인한 환경: macOS, herdr 0.9.4, Claude Code 2.1.x. Linux·Windows 는 코드만 맞춰 두었고 아직 실기기에서 돌려 보지 않았습니다 — 막히면 「막힐 때」 를 보고 이슈로 알려 주세요.

## 쓰기

```sh
edith                # herdr 확인(꺼져 있으면 띄움) → 화면 서버 → 브라우저
edith --no-open      # 브라우저는 열지 않고 주소만 찍는다
edith --port 4400    # 다른 포트(기본 4320)
edith setup          # 설치 스크립트 다시 — 빠진 도구, herdr 통합·스킬, 화면 빌드
```

- 이미 떠 있으면 새로 띄우지 않고 브라우저만 엽니다. 브라우저는 열쇠가 붙은 주소로 열리고, 열쇠는 쿠키로 30일 남습니다.
- Ctrl+C 로 EDITH 를 꺼도 herdr 서버와 그 안의 pane 은 계속 돕니다. 터미널에서도 보려면 `herdr` 로 같은 서버에 붙습니다.
- 처음엔 워크스페이스가 없을 수 있습니다 — 왼쪽 「+ 새 워크스페이스」 로 폴더를 고르고, 셸 pane 에서 Claude·Codex 를 띄웁니다.
- 업데이트: `git -C ~/.edith pull && edith setup` (직접 클론했으면 그 폴더에서).

## 내 것으로 만들기

EDITH 는 받아서 마음대로 고쳐 쓰라고 만든 기본판입니다(MIT).

1. GitHub 의 **Use this template** 로 내 레포를 만든다(원본 변경을 계속 받으려면 Fork).
2. `install.sh`·`install.ps1`·이 README 의 `johyunduk/EDITH` 를 내 레포 주소로 바꾼다.
3. 고치고 싶은 것을 쓰고 있는 Claude Code·Codex 에게 시킨다 — 레포의 [`AGENTS.md`](AGENTS.md)(Claude 는 `CLAUDE.md` 가 불러온다)에 구조·확인 명령·지켜야 할 보안 규칙이 있다.

구조 지도, 흔한 수정(pane 버튼·우클릭 메뉴·API·화면 탭 더하기), 고치면서 보는 법, 원본 변경 받기는 [docs/customize.md](docs/customize.md).

## 하는 일

- **herdr 트리** — 워크스페이스 → 탭 → pane 과 에이전트 상태(작업 중·승인 대기·끝남). herdr 이벤트를 구독해 0.2초 안팎으로 바뀝니다. 레포의 링크 워크트리는 그 레포 밑에 묶습니다. 끌어 놓기로 옮기고, 우클릭으로 나누기·닫기·이름 바꾸기.
- **pane 보기** — 에이전트는 대화(세션 기록을 풀어서, 이전 대화 더 보기), 셸은 명령별 기록, 필요하면 실시간 터미널(누르면 입력). 탭 전체를 herdr 배치 그대로 보고 칸 경계를 끌어 크기를 바꿉니다.
- **답하기** — 프롬프트 칸(`/` 명령·스킬, `@` 파일 자동 완성), 승인·선택 질문은 버튼으로, 빠른 키, 파일 첨부(고르기·붙여넣기).
- **알림** — 승인 대기가 되면 브라우저 알림·소리, 헤더 종에 내역.
- **변경** — pane 폴더의 git diff(커밋 안 한 것·브랜치 전체·커밋 하나), 파일별 AI 요약(`claude -p`, haiku).
- **사용량** — 모델·컨텍스트 %, 5시간·7일 한도(「사용량 칩」).
- **백그라운드 작업** — Claude 가 띄운 셸·에이전트와 그 출력.
- **스킬** — Claude·Codex 의 스킬·명령 목록과 서로 부르는 관계도.

## 설치 자세히

[`install.sh`](install.sh)·[`install.ps1`](install.ps1) 이 하는 일 — 먼저 읽어 보고 돌려도 됩니다:

1. Node 24+ — 없으면 macOS·Linux 는 Homebrew, Homebrew 가 없으면 nvm(`~/.nvm`), Windows 는 winget 으로
2. herdr(Homebrew 또는 `herdr.dev/install.sh`·`.ps1`), Claude Code(`claude.ai/install.sh`·`.ps1`), Codex CLI(`npm i -g @openai/codex`) — 있으면 건너뜀
3. herdr 통합 `herdr integration install claude`·`codex` — 세션 ID 를 herdr 에 알리는 훅(`~/.claude`·`~/.codex`)
4. herdr 스킬(`herdr --skill`) → `~/.agents/skills/herdr`(Codex), `~/.claude/skills/herdr`(Claude — 링크, Windows 는 복사본)
5. Claude Code·herdr 가 깔린 `~/.local/bin` 이 PATH 에 없으면 셸 설정(`~/.zshrc` 등, Windows 는 사용자 PATH)에 넣음
6. EDITH 를 `~/.edith`(또는 `EDITH_DIR`)에 받고 `npm install` → `npm run build` → `npm link`

`edith` 는 alias 가 아니라 `npm link` 가 npm 전역 bin(macOS·Linux 는 Homebrew·nvm 의 bin, Windows 는 `%APPDATA%\npm`)에 만든 명령입니다. 셸 설정 없이 새 터미널에서 바로 되고, nvm 으로 Node 판을 바꾸면 그 판에서 `edith setup` 을 한 번 돌립니다.

직접 클론했다면 그 폴더에서 `./install.sh`(Windows 는 `.\install.ps1`)를 한 번 돌립니다 — 그 폴더에서 빌드하고 `edith` 를 등록합니다. 스크립트 없이 하려면:

```sh
git clone https://github.com/johyunduk/EDITH.git edith && cd edith
npm install
npm run build        # web/ 화면 빌드 → web/dist
npm link             # edith 명령
edith
```

## 막힐 때

- **`edith`·`claude`·`node` 를 못 찾는다** — 설치 뒤 새 터미널을 열었는지 봅니다(PATH·nvm 은 새 터미널부터). 그래도 없으면 `edith setup`(또는 EDITH 폴더의 `./install.sh`)을 다시 돌립니다.
- **새 맥에서 `git clone` 중 「명령어 라인 개발자 도구」 설치 창이 뜬다** — 설치를 끝내고 설치 한 줄을 다시 돌립니다.
- **「화면이 아직 빌드되지 않았다」** — `edith setup`.
- **「4320 포트를 다른 프로그램이 쓴다」** — `edith --port <다른 번호>`.
- **「herdr 에 닿지 않는다」·「herdr 서버가 10초 안에 뜨지 않았다」** — 터미널에서 `herdr` 를 직접 띄워 보고, `herdr status server` 로 상태를 봅니다.
- **브라우저가 안 열린다** — 터미널에 찍힌 `http://127.0.0.1:4320/?key=…` 주소를 직접 엽니다.
- **「열쇠 없음」** — 터미널에서 `edith` 를 다시 치면 열쇠가 붙은 주소로 열립니다.

## 동작 방식

- **herdr 연결** — 읽기는 `herdr` CLI, 쓰기·이벤트 구독은 herdr 소켓(Windows 는 named pipe). 소켓은 `HERDR_SOCKET_PATH`(herdr pane 안에서 띄우면 있음), 없으면 `herdr status server` 가 알려 주는 경로.
- **대화 기록 찾기** — herdr 통합이 알려 준 세션 ID → 그 pane 의 `claude` 프로세스가 쓰는 `~/.claude/sessions/<pid>.json`(Claude Code 내부 파일, 2.1.x 확인) → 창 제목으로 추측, 순서로 찾습니다. Codex 는 herdr 가 알려 준 세션, 없으면 `~/.codex/session_index.jsonl` 의 스레드 이름으로.
- **백그라운드 셸** — 끝 표시·끝남 알림으로 상태를 가리고, `lsof` 가 있으면 끝 표시 없이 죽은 셸도 가립니다(Windows 는 끝 표시로만).

## 사용량 칩

- **Codex** — 세션 기록(`~/.codex/sessions`)에서 읽어서 따로 할 일이 없습니다.
- **Claude** — Claude Code 상태줄을 화면에서 읽습니다. 상태줄이 아래 꼴이어야 칩이 뜹니다(아니면 칩만 안 뜨고 나머지는 그대로).

  ```
  ✦ <모델> [<effort>]  ·  CONTEXT 45%  ·  DAILY 30% | 2h10m  ·  WEEKLY 12% | 3d4h
  ```

  `extras/statusline.sh`(jq·bc 필요, Windows 는 Git Bash 의 sh 로)가 이 꼴을 찍습니다. `~/.claude/settings.json` 에:

  ```json
  { "statusLine": { "type": "command", "command": "sh ~/.edith/extras/statusline.sh" } }
  ```

## 보안

이 화면은 내 터미널에 키를 보낼 수 있습니다. 열쇠를 가진 사람은 내 계정으로 명령을 돌릴 수 있다는 뜻입니다.

- 서버는 `127.0.0.1` 에만 뜹니다. Host 머리가 `127.0.0.1:<포트>`·`localhost:<포트>` 가 아니면 거절합니다(DNS rebinding).
- 모든 `/api` 는 열쇠 쿠키(`HttpOnly`, `SameSite=Strict`)가 있어야 합니다. 열쇠는 `~/.config/edith/console.key`(600)에 있고, 바꾸려면 지우고 다시 띄웁니다.
- 쓰기는 같은 출처에서 온 JSON `POST` 만 받습니다(CSRF). 화면은 다른 사이트의 틀에 들어가지 않습니다(`frame-ancestors 'none'`). CORS 머리는 달지 않습니다.
- **포트를 밖으로 열지 마세요** — 터널·리버스 프록시·`0.0.0.0` 포워딩 금지. 원격에서 쓰려면 SSH 포트 포워딩(`ssh -L 4320:127.0.0.1:4320`)으로.
- 화면이 읽는 것은 내 계정 파일입니다: herdr 상태, `~/.claude`·`~/.codex` 의 세션 기록·스킬, pane 폴더의 git. 밖으로 보내는 것은 AI 요약을 누를 때 `claude -p` 로 넘기는 diff 뿐입니다(도구·MCP·훅 끄고 실행).
- 첨부한 파일은 `~/.local/share/edith/uploads`(700/600)에 남습니다. 지우지 않으니 가끔 비웁니다.

## 데이터

| 경로 | 내용 |
|---|---|
| `~/.config/edith/console.key` | 화면 열쇠 |
| `~/.local/share/edith/summaries.json` | AI 요약 기억(파일 diff 해시별, 최근 2000개) |
| `~/.local/share/edith/uploads/` | 첨부 |

## 개발

```sh
npm test             # node --test
npm run typecheck    # 서버 + 화면
npm --prefix web run dev   # 화면 개발(Vite) — edith --no-open 을 띄운 채, /api 는 4320 으로 넘김
```

규칙·구조는 [`AGENTS.md`](AGENTS.md)·[docs/customize.md](docs/customize.md).

- 서버 `src/`(Node 내장만), 화면 `web/`(React·Vite·Tailwind·xterm.js).
- TypeScript 는 지울 수 있는 문법만 씁니다 — enum·namespace·생성자 매개변수 속성 금지(`erasableSyntaxOnly`).

## 라이선스

MIT
