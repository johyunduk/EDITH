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
edith --no-herdr     # 이 기기 herdr 는 띄우지 않고 화면만 — 다른 기기의 EDITH 를 열 때
edith --port 4400    # 다른 포트(기본 4320)
edith update         # 받기(git pull)·화면 빌드 → 떠 있는 EDITH 를 새 코드로 다시 켜기
edith setup          # 설치 스크립트 다시 — 빠진 도구, herdr 통합·스킬, 화면 빌드, Claude 플러그인
edith connect        # 다른 기기 잇기 — SSH 키 등록·machines.json(「다른 기기의 EDITH 열기」)
```

- 이미 떠 있으면 새로 띄우지 않고 브라우저만 엽니다. 브라우저는 열쇠가 붙은 주소로 열리고, 열쇠는 쿠키로 30일 남습니다.
- Ctrl+C 로 EDITH 를 꺼도 herdr 서버와 그 안의 pane 은 계속 돕니다. 터미널에서도 보려면 `herdr` 로 같은 서버에 붙습니다.
- 처음엔 워크스페이스가 없을 수 있습니다 — 왼쪽 「+ 새 워크스페이스」 로 폴더를 고르고, 셸 pane 에서 Claude·Codex 를 띄웁니다.
- 업데이트: `edith update` — 받고, 화면을 빌드하고, 떠 있는 EDITH 를 같은 터미널에서 새 코드로 다시 켭니다(herdr·pane 은 그대로). 설치 단계(도구·herdr 통합·플러그인)가 바뀌었으면 `edith setup`.
- 서버 코드가 바뀌면(받기·고침) 머리줄에 **새 코드 · 다시 켜기** 가 뜹니다 — 누르면 다시 켜고 화면을 새로 고칩니다. 화면만 새로 빌드됐으면 **새 화면 · 새로 고침**. 다른 기기를 터널로 보고 있으면 그 기기 EDITH 를 다시 켭니다. Windows 는 다시 켜기가 없어 터미널에서 Ctrl+C 뒤 `edith`.

## 내 것으로 만들기

EDITH 는 받아서 마음대로 고쳐 쓰라고 만든 기본판입니다(MIT).

1. GitHub 의 **Use this template** 로 내 레포를 만든다(원본 변경을 계속 받으려면 Fork).
2. `install.sh`·`install.ps1`·이 README 의 `johyunduk/EDITH` 를 내 레포 주소로 바꾼다.
3. 고치고 싶은 것을 쓰고 있는 Claude Code·Codex 에게 시킨다 — 레포의 [`AGENTS.md`](AGENTS.md)(Claude 는 `CLAUDE.md` 가 불러온다)에 구조·확인 명령·지켜야 할 보안 규칙이 있다.

구조 지도, 흔한 수정(pane 버튼·우클릭 메뉴·API·화면 탭 더하기), 고치면서 보는 법, 원본 변경 받기는 [docs/customize.md](docs/customize.md).

## 하는 일

- **herdr 트리** — 워크스페이스 → 탭 → pane 과 에이전트 상태(작업 중·승인 대기·끝남). herdr 이벤트를 구독해 0.2초 안팎으로 바뀝니다. 레포의 링크 워크트리는 그 레포 밑에 묶습니다. 끌어 놓기로 옮기고, 우클릭으로 나누기·닫기·이름 바꾸기.
- **pane 보기** — 에이전트는 대화(세션 기록을 풀어서, 이전 대화 더 보기), 셸은 명령별 기록, 필요하면 실시간 터미널(누르면 입력). 탭 전체를 herdr 배치 그대로 보고 칸 경계를 끌어 크기를 바꿉니다.
- **답하기** — 프롬프트 칸(`/` 명령·스킬, `@` 파일 자동 완성, 쓰다 만 글은 pane 마다 따로 브라우저에 남음), 승인·선택 질문은 버튼으로, 빠른 키, 파일 첨부(고르기·붙여넣기).
- **알림** — 승인 대기가 되면 브라우저 알림·소리, 헤더 종에 내역.
- **변경** — pane 폴더의 git diff(커밋 안 한 것·브랜치 전체·커밋 하나), 파일별 AI 요약(`claude -p`, haiku).
- **사용량** — 모델·컨텍스트 %, 5시간·7일 한도(「사용량 칩」).
- **백그라운드 작업** — Claude 가 띄운 셸·에이전트와 그 출력. 「끄기」는 그 Claude 에게 꺼도 되는지 묻고 TaskStop 으로 끄게 합니다.
- **원격** — Claude pane 의 Remote Control 이 켜졌는지. 켜져 있으면 claude.ai 에서 그 세션을 여는 링크, 꺼져 있으면 「원격 켜기」. 함께 설치되는 Claude 플러그인 `rc-keepalive` 가 켜 두었던 세션이 끊기면 다시 켭니다(「Remote Control 지킴이」).
- **스킬** — Claude·Codex 의 스킬·명령 목록과 서로 부르는 관계도. 다른 기기의 스킬을 파일 하나로 내려받아 이 기기로 가져오기(공개 스킬·플러그인은 설치 명령으로).
- **설정** — 화면 테마(EDITH·ULTRON), 커밋 지킴이(Claude 가 git commit·push 전에 묻기)·Claude 끼리는 SendMessage 켜고 끄기.

## 설치 자세히

[`install.sh`](install.sh)·[`install.ps1`](install.ps1) 이 하는 일 — 먼저 읽어 보고 돌려도 됩니다:

1. Node 24+ — 없으면 macOS·Linux 는 Homebrew, Homebrew 가 없으면 nvm(`~/.nvm`), Windows 는 winget 으로
2. herdr(Homebrew 또는 `herdr.dev/install.sh`·`.ps1`), Claude Code(`claude.ai/install.sh`·`.ps1`), Codex CLI(`npm i -g @openai/codex`) — 있으면 건너뜀
3. herdr 통합 `herdr integration install claude`·`codex` — 세션 ID 를 herdr 에 알리는 훅(`~/.claude`·`~/.codex`)
4. herdr 스킬(`herdr --skill`) → `~/.agents/skills/herdr`(Codex), `~/.claude/skills/herdr`(Claude — 링크, Windows 는 복사본)
5. Claude Code·herdr 가 깔린 `~/.local/bin` 이 PATH 에 없으면 셸 설정(`~/.zshrc` 등, Windows 는 사용자 PATH)에 넣음
6. EDITH 를 `~/.edith`(또는 `EDITH_DIR`)에 받고 `npm install` → `npm run build` → `npm link`
7. 그 체크아웃을 Claude 플러그인 마켓플레이스로 더하고(`claude plugin marketplace add <체크아웃>`) `rc-keepalive@edith`·`commit-guard@edith`·`peer-message@edith` 설치

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
- **대화 기록 찾기** — herdr 통합이 알려 준 세션 ID → 그 pane 의 `claude` 프로세스가 쓰는 `~/.claude/sessions/<pid>.json`(Claude Code 내부 파일, 2.1.x 확인) → 창 제목으로 추측, 순서로 찾습니다. Codex 는 그 pane 의 `codex` 프로세스가 열어 둔 기록 파일(`lsof`), 없으면 herdr 가 알려 준 세션, 그다음 `~/.codex/session_index.jsonl` 의 스레드 이름으로.
- **백그라운드 셸** — 끝 표시·끝남 알림으로 상태를 가리고, `lsof` 가 있으면 끝 표시 없이 죽은 셸도 가립니다(Windows 는 끝 표시로만). 셸·에이전트 모두, pane 의 `claude` 가 다시 뜨기 전에 띄운 것은 끝난 것으로 봅니다.

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

## 다른 기기의 EDITH 열기

EDITH 는 그 기기의 herdr 만 봅니다. 집에서 회사 PC 의 herdr·대화·Codex 를 보려면 집 EDITH 사이드 메뉴 아래의 **회사**(기기 이름)를 누릅니다 — 집 EDITH 가 SSH 터널을 열고 회사 EDITH 를 새 탭으로 엽니다. 회사 EDITH 는 그대로 `127.0.0.1` 에만 떠 있고, 밖으로 여는 포트는 없습니다.

처음 한 번:

1. **두 기기를 잇는다** — [Tailscale](https://tailscale.com)(개인 무료)을 두 기기에 깔고 같은 계정으로 로그인합니다. 회사 PC 에 이미 VPN 이 있으면 같이 쓸 수 있는지, 회사 규정에 맞는지 먼저 확인합니다. 집에서 회사 VPN 에 들어갈 수 있으면 그것도 됩니다.
2. **회사 PC 에 SSH 를 켠다** — macOS: 시스템 설정 → 일반 → 공유 → 원격 로그인. Linux: `openssh-server`. Windows 를 열리는 쪽으로 쓰려면 설정 → 선택적 기능에서 OpenSSH 서버를 켜고, 키는 손으로 등록합니다(`edith connect` 의 키 등록은 macOS·Linux 만 — Windows 쪽은 아직 실기기 확인 전).
3. **집 EDITH 사이드 메뉴 아래 「+ 다른 기기 잇기」**(터미널이면 `edith connect`) — Tailscale 에 붙은 기기 목록에서 회사 PC 를 고르고, 그 기기 사용자 이름·EDITH 에 보일 이름(예: 회사)·비밀번호를 넣습니다. 이렇게 합니다:
   - SSH 키가 없으면 `~/.ssh/id_ed25519` 를 만들고, 회사 PC 에 등록합니다 — **회사 PC 비밀번호를 한 번** 씁니다(화면에서 넣은 비밀번호는 ssh 에 넘기고 저장하지 않습니다).
   - `~/.config/edith/machines.json` 에 `{ "회사": "<사용자>@<회사 PC 의 Tailscale 이름>" }` 을 적고, 회사 EDITH 열쇠가 읽히는지 봅니다.
   - Tailscale 없이(회사 VPN 등) 잇는다면 `edith connect 회사 <사용자>@<주소>`. 회사 EDITH 가 다른 포트면 machines.json 에서 `{ "회사": { "ssh": "…", "port": 4400 } }`. 집 쪽 포트는 적은 순서대로 4321, 4322 … 를 씁니다.
4. **회사 PC 에서 EDITH 를 띄워 둔다** — `edith --no-open`(꺼져 있으면 「떠 있지 않다」 고 알려 줍니다).

집 쪽은 그 기기를 열기만 할 거라면 `edith --no-herdr` 로 띄워도 됩니다 — 집 herdr 를 띄우지 않고, 사이드 메뉴의 「다른 기기」 만 씁니다.

못 열면 사유를 알려 줍니다 — 닿지 않음(Tailscale·VPN), 원격 로그인 꺼짐, SSH 키 거절(다시 잇기), 호스트 키 바뀜, 그 기기에 EDITH 열쇠 없음·EDITH 꺼짐.

터널은 집 EDITH 가 꺼질 때 같이 닫힙니다(kill -9 처럼 갑자기 꺼져 남은 터널은 다음에 열 때 그대로 씁니다). 회사 화면의 열쇠는 SSH 로 읽어 주소에 붙였다가 바로 지웁니다(처음 `edith` 가 여는 주소와 같은 방식).

## Remote Control 지킴이

Claude Code 의 Remote Control(`/rc`)을 켜 두면 다른 기기의 claude.ai/code·Claude 앱에서 그 세션을 이어 씁니다. 그런데 VPN·네트워크가 바뀌거나 오래 서버에 닿지 못하면 끊긴 채로 남습니다.
[`plugins/rc-keepalive`](plugins/rc-keepalive) 는 이걸 다시 켜는 Claude Code mod 입니다(EDITH 가 꺼져 있어도 Claude 안에서 돕니다).

- 1분마다 그 세션의 `~/.claude/sessions/<pid>.json` 의 `bridgeSessionId` 를 보고, 켜져 있던 세션이 두 번 연달아 꺼져 있고 일하는 중이 아니면 `/remote-control` 을 보냅니다.
- 처음부터 안 켠 세션, `/rc` 패널에서 직접 끊은 세션, 같은 대화를 다른 터미널이 원격으로 쥔 세션은 두고, 30분에 세 번 다시 켜도 또 끊기면 멈추고 아래 줄에 알립니다.
- Remote Control 이 들어간 알림은 `~/.claude/rc-keepalive.log` 에 남습니다.
- 끄기: `claude plugin disable rc-keepalive@edith`. 레포에서 그대로 읽으니 고치면 다음 세션부터(또는 `/reload-plugins`) 반영됩니다. 확인은 `cd plugins/rc-keepalive && claude plugin test`.

## 커밋 지킴이

[`plugins/commit-guard`](plugins/commit-guard) 는 Claude 가 `git commit`·`git push` 를 하기 전에 매번 묻는 Claude Code mod 입니다.
auto 모드에서는 분류기가 대신 답하고 허용 규칙에 넣어 둔 명령은 묻지 않아서, 커밋·push 가 묻지 않고 나갈 수 있습니다 — 이 mod 는 그보다 앞에서 사람에게 직접 묻습니다.
설치기가 함께 깔고 처음엔 켜져 있습니다. EDITH 「설정」 화면의 **커밋·push 전에 묻기** 로 끄고 켭니다(Claude `/config`, `claude plugin configure commit-guard@edith` 로도).
떠 있는 Claude 세션도 다음 커밋·push 부터 바로 따릅니다. 설치기를 거치지 않은 기기는 직접 깝니다.

```sh
claude plugin marketplace add <EDITH 체크아웃>   # 체크아웃이 없으면 johyunduk/EDITH
claude plugin install commit-guard@edith
```

- 셸 명령(Bash·PowerShell 등)에 `git commit`·`git push` 가 들어 있으면(`git -C <폴더> push`, `cd x && git commit`, `bash -c "git push"` 도) 질문 창에 「실행」·「막기」 를 묻습니다. EDITH 화면에서는 질문 카드로 답합니다.
- 질문 창은 커밋마다 레포·브랜치·제목·파일(이미 staged 된 것과 같은 명령의 `git add` 인자)을, push 는 레포·브랜치·인자를 풀어 보이고 아래에 명령 원문(앞 400자)을 붙입니다. 브랜치·staged 파일은 허락 전에 그 레포에서 git 으로 읽기만 합니다(fsmonitor 끔, 2초). 변수·`bash -c` 처럼 못 푸는 명령은 원문만 보입니다.
- 「실행」 이면 그 호출은 권한 확인을 다시 묻지 않고 실행하고(설정의 deny 규칙은 그대로), 「막기」·창 닫기·물을 사람이 없는 `claude -p` 는 막습니다.
- 글자로 찾아서 `echo "git push"` 처럼 실행하지 않는 글에도 묻고, git 별칭(`git ci`)·스크립트 안의 커밋은 못 봅니다. Codex 는 해당 없음.
- 끄면 Claude Code 의 보통 권한 확인대로 커밋·push 합니다. 플러그인을 통째로 빼려면 `claude plugin disable commit-guard@edith`. 확인은 `cd plugins/commit-guard && claude plugin test`.

## Claude 끼리는 SendMessage

Claude 가 다른 Claude 세션에 말을 넘길 때 herdr 로 그 입력칸에 치면, 받는 쪽은 그 글을 사용자 지시로 받고 승인 창이 떠 있으면 글자가 키로 먹힙니다.
Claude Code 에는 세션끼리 주고받는 `SendMessage`(대상은 `ListAgents` 로)가 있어서 「다른 에이전트가 보낸 메시지」 로 표시되고 바쁜 세션에는 다음 도구 사이에 들어갑니다.
[`plugins/peer-message`](plugins/peer-message) 는 Claude 가 이걸 쓰게 하는 mod 입니다. 설치기가 함께 깔고 처음엔 켜져 있습니다(EDITH 「설정」 에서 끕니다).

- Claude 가 `herdr agent prompt`·`pane send-text`·`pane run` 으로 그냥 글을 보내려는데 받는 pane 이 `ListAgents` 에 하나뿐인 Claude 세션이면 막고 `SendMessage({ to: "<그 이름>" })` 를 알려 줍니다. Claude 가 그대로 다시 보냅니다.
- 그대로 두는 것: Codex·셸 pane, `ListAgents` 에 없거나 이름이 겹치는 세션, 슬래시 명령(`/clear` 등)·키 입력·띄우기·화면 읽기. 판단은 규칙으로만 합니다(모델 호출 없음).
- Bash 도구 설명에 고르는 법을 붙여, 처음부터 맞게 고르게 합니다.
- EDITH 대화 화면은 받은 메시지를 왼쪽 점선 말풍선(「<세션> 에게서 받은 메시지」)으로, 보낸 것은 `SendMessage → <세션> · <본문>` 으로 보입니다.
- 받는 pane 은 창 제목(= Claude 세션 이름)으로 `ListAgents` 와 짝짓습니다. 변수에 담은 대상(`$PANE`)·스크립트 안의 herdr 는 보지 못하고 그대로 갑니다.

## 보안

이 화면은 내 터미널에 키를 보낼 수 있습니다. 열쇠를 가진 사람은 내 계정으로 명령을 돌릴 수 있다는 뜻입니다.

- 서버는 `127.0.0.1` 에만 뜹니다. Host 머리가 `127.0.0.1:<포트>`·`localhost:<포트>` 가 아니면 거절합니다(DNS rebinding). 포트는 따지지 않습니다 — 다른 기기가 SSH 터널(다른 포트)로 열 수 있게.
- 모든 `/api` 는 열쇠 쿠키(`edith-<포트>`, `HttpOnly`, `SameSite=Strict`)가 있어야 합니다. 쿠키는 포트마다 따로라 이 기기 EDITH 와 터널로 연 다른 기기 EDITH 가 섞이지 않습니다. 열쇠는 `~/.config/edith/console.key`(600)에 있고, 바꾸려면 지우고 다시 띄웁니다.
- 쓰기는 같은 출처에서 온 JSON `POST` 만 받습니다(CSRF). 화면은 다른 사이트의 틀에 들어가지 않습니다(`frame-ancestors 'none'`). CORS 머리는 달지 않습니다.
- **포트를 밖으로 열지 마세요** — 터널·리버스 프록시·`0.0.0.0` 포워딩 금지. 다른 기기에서 쓰려면 「다른 기기의 EDITH 열기」(SSH 터널)로.
- 화면이 읽는 것은 내 계정 파일입니다: herdr 상태, `~/.claude`·`~/.codex` 의 세션 기록·스킬, pane 폴더의 git. 밖으로 보내는 것은 AI 요약을 누를 때 `claude -p` 로 넘기는 diff 뿐입니다(도구·MCP·훅 끄고 실행).
- 첨부한 파일은 `~/.local/share/edith/uploads`(700/600)에 두고, 7일 지난 것은 다음에 올릴 때 지웁니다.

## 데이터

| 경로 | 내용 |
|---|---|
| `~/.config/edith/console.key` | 화면 열쇠 |
| `~/.config/edith/machines.json` | 다른 기기 목록(이름 → SSH 대상) — 직접 만든다 |
| `~/.local/share/edith/summaries.json` | AI 요약 기억(파일 diff 해시별, 최근 2000개) |
| `~/.local/share/edith/uploads/` | 첨부(7일 지나면 지움) |
| `~/.claude/rc-keepalive.log` | Remote Control 지킴이 기록(최근 200줄) |

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
