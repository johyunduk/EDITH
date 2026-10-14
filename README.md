# EDITH

Browser console for [herdr](https://herdr.dev) — watch and drive Claude Code and Codex panes from one page.

herdr 로 띄운 Claude Code·Codex·셸 pane 을 브라우저 한 화면에서 보고 다루는 로컬 화면입니다. 터미널을 대신하지 않고, 여러 pane 을 한눈에 보고 답해야 할 곳으로 바로 가게 합니다.

## 하는 일

- **herdr 트리** — 워크스페이스 → 탭 → pane, 에이전트 상태(작업 중·승인 대기·끝남). herdr 이벤트를 구독해 바뀌면 0.2초 안팎으로 화면에 옵니다. 레포의 링크 워크트리는 그 레포 밑에 묶습니다. 끌어 놓기로 pane·워크스페이스를 옮기고, 우클릭으로 나누기·닫기·이름 바꾸기.
- **pane 보기** — 에이전트는 대화(세션 기록 JSONL 을 풀어서, 이전 대화 더 보기), 셸은 명령별 기록, 필요하면 실시간 터미널(누르면 입력). 탭 전체를 herdr 배치 그대로 칸으로 보고 칸 경계를 끌어 크기를 바꿉니다.
- **답하기** — 프롬프트 칸(`/` 명령·스킬, `@` 파일 자동 완성), 승인·선택 질문은 버튼으로, 빠른 키, 파일 첨부(고르기·붙여넣기).
- **알림** — 승인 대기가 되면 브라우저 알림·소리, 헤더 종에 내역.
- **변경** — pane 폴더의 git diff(커밋 안 한 것·브랜치 전체·커밋 하나), 파일별 AI 요약(`claude -p`, haiku).
- **사용량** — 모델·컨텍스트 %, 5시간·7일 한도(아래 「사용량 칩」).
- **백그라운드 작업** — Claude 가 띄운 셸·에이전트와 그 출력.
- **스킬** — Claude·Codex 의 스킬·명령 목록과 서로 부르는 관계도.

## 필요한 것

- macOS(확인한 환경), Linux, Windows(네이티브 — WSL 없이). Linux·Windows 는 코드만 맞춰 두었고 아직 돌려 보지 않았습니다.
- Node 24 이상 — 서버는 빌드 없이 `node src/cli.ts` 로 돕니다(type stripping). 런타임 의존성은 없습니다.
- [herdr](https://herdr.dev) 0.9.4(확인한 판) — `herdr` 명령과 소켓(Windows 는 named pipe). 소켓은 `HERDR_SOCKET_PATH`(herdr pane 안에서 띄우면 있음), 없으면 `herdr status server` 가 알려 주는 경로를 씁니다.
- 권장: herdr Claude 통합(`herdr integration install claude`). 세션이 시작·`/resume`·`/clear` 될 때 세션 ID 를 herdr 에 알려서, 대화 화면이 그 세션 기록을 바로 엽니다(통합 뒤 새로 시작한 세션부터). 통합이 없거나 그 전에 시작한 세션은 그 pane 의 `claude` 프로세스가 쓰는 `~/.claude/sessions/<pid>.json` 으로 찾고(Claude Code 내부 파일, 2.1.x 확인), 그것도 안 되면 창 제목으로 추측합니다. Codex 도 herdr 가 세션을 알려 주면 같은 방식으로 엽니다.
- 쓰는 만큼: Claude Code(`claude`), Codex CLI(`codex`), git. `lsof` 가 있으면 끝 표시 없이 죽은 백그라운드 셸도 가립니다(Windows 는 없음 — 끝 표시로만).

## 설치·실행

한 줄 설치 — 없는 것만 설치하고, 다시 돌려도 됩니다.

macOS·Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/johyunduk/EDITH/main/install.sh | bash
```

Windows(PowerShell, 관리자 아님):

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/johyunduk/EDITH/main/install.ps1 | iex"
```

[`install.sh`](install.sh)·[`install.ps1`](install.ps1) 이 하는 일(sudo·관리자 권한은 쓰지 않습니다 — 먼저 읽어 보고 돌려도 됩니다):

1. Node 24+ 확인(없으면 macOS·Linux 는 Homebrew, Homebrew 가 없으면 nvm, Windows 는 winget 으로)
2. herdr(Homebrew 또는 `https://herdr.dev/install.sh`·`.ps1`), Claude Code(`https://claude.ai/install.sh`·`.ps1`), Codex CLI(`npm i -g @openai/codex`) — 이미 있으면 건너뜀
3. herdr 통합 `herdr integration install claude`·`codex`(`~/.claude`·`~/.codex` 에 세션을 알리는 훅)
4. herdr 스킬(`herdr --skill`) → `~/.agents/skills/herdr`(Codex), `~/.claude/skills/herdr` 는 그 링크(Claude, Windows 는 복사본)
5. Claude Code·herdr 가 깔린 `~/.local/bin` 이 PATH 에 없으면 셸 설정(`~/.zshrc` 등, Windows 는 사용자 PATH)에 넣음
6. EDITH 를 `~/.edith`(또는 `EDITH_DIR`)에 받고 `npm install` → `npm run build` → `npm link`

끝나면 새 터미널을 열고(바뀐 PATH 는 새 터미널부터) 처음 한 번 `claude`·`codex` 로 로그인한 뒤 `edith` 를 칩니다.

직접 클론했다면 그 폴더에서 `./install.sh`(Windows 는 `.\install.ps1`)를 한 번 돌립니다 — 그 폴더에서 빌드하고 `edith` 명령을 등록합니다. `edith` 는 alias 가 아니라 `npm link` 가 npm 전역 bin(macOS·Linux 는 Homebrew·nvm 의 bin, Windows 는 `%APPDATA%\npm`)에 만든 명령이라 셸 설정 없이 새 터미널에서 바로 됩니다(nvm 으로 Node 판을 바꾸면 그 판에서 `edith setup` 한 번).

손으로 설치:

```sh
git clone https://github.com/johyunduk/EDITH.git edith && cd edith
npm install
npm run build        # web/ 화면 빌드 → web/dist
npm link             # edith 명령 (선택)
edith                # 또는 npm start
```

## 쓰기

```sh
edith                # herdr 서버 확인(꺼져 있으면 화면 없이 띄움) → 화면 서버 → 브라우저
edith --no-open      # 브라우저는 열지 않고 주소만 찍는다
edith --port 4400    # 다른 포트(기본 4320)
edith setup          # 설치 스크립트 다시 — 빠진 도구, herdr 통합·스킬, 화면 빌드
```

- 이미 떠 있으면 새로 띄우지 않고 브라우저만 엽니다. 브라우저는 열쇠 붙은 주소로 열려 그대로 쿠키(30일)가 남습니다.
- Ctrl+C 로 EDITH 를 꺼도 herdr 서버와 그 안의 pane 은 계속 돕니다. 터미널에서도 보려면 `herdr` 로 같은 서버에 붙습니다.
- 업데이트: `git -C ~/.edith pull && edith setup`(설치 스크립트로 받았을 때. 직접 클론했으면 그 폴더에서).

화면 개발: `edith --no-open` 을 띄운 채 `npm --prefix web run dev`(Vite, `/api` 는 4320 으로 넘김).

## 사용량 칩

- **Codex** — 세션 기록(`~/.codex/sessions`)에서 읽어서 따로 할 일이 없습니다.
- **Claude** — Claude Code 상태줄을 화면에서 읽습니다. 상태줄이 아래 꼴이어야 칩이 뜹니다(아니면 칩만 안 뜨고 나머지는 그대로).

  ```
  ✦ <모델> [<effort>]  ·  CONTEXT 45%  ·  DAILY 30% | 2h10m  ·  WEEKLY 12% | 3d4h
  ```

  `extras/statusline.sh`(jq·bc 필요, Windows 는 Git Bash 의 sh 로)가 이 꼴을 찍습니다. `~/.claude/settings.json` 에:

  ```json
  { "statusLine": { "type": "command", "command": "sh /path/to/edith/extras/statusline.sh" } }
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
```

- 서버 `src/`(Node 내장만), 화면 `web/`(React·Vite·Tailwind·xterm.js).
- TypeScript 는 지울 수 있는 문법만 씁니다 — enum·namespace·생성자 매개변수 속성 금지(`erasableSyntaxOnly`).

## 라이선스

MIT
