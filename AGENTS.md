# AGENTS.md — EDITH 를 고치는 에이전트에게

EDITH 는 herdr 의 Claude Code·Codex·셸 pane 을 브라우저에서 보고 다루는 로컬 화면이다. 받은 사람이 자기 것으로 고쳐 쓰라고 만든 기본판이라,
사용자가 원하는 대로 고치는 것이 일이다. 고치기 전에 [docs/customize.md](docs/customize.md)(구조 지도·흔한 수정 방법)를 읽는다.
화면 쓰는 법은 [docs/guide.md](docs/guide.md).

## 확인 명령

```sh
npm test                    # node --test — src/*.test.ts
npm run typecheck           # 서버(tsc) + 화면(web tsc)
npm --prefix web run build  # 화면 빌드 → web/dist (edith 가 요청마다 디스크에서 읽으니 브라우저 새로 고침이면 반영)
edith --no-open             # 서버 코드를 바꿨으면 껐다 켠다
```

바꾼 뒤에는 typecheck·test 를 통과시키고, 화면을 바꿨으면 build 까지 한다. 로직(분기·파싱·경로 판단)을 더하면 그 옆에 `*.test.ts` 로 확인 하나를 남긴다.

## 지켜야 하는 것

**보안 — 이 화면은 내 터미널에 키를 보낼 수 있다. 아래를 약하게 만드는 수정은 사용자가 위험을 알고 분명히 원할 때만 한다.**

- 서버는 `127.0.0.1` 에만 뜬다(`src/server.ts` 의 `listen`). `0.0.0.0`·외부 공개로 바꾸지 않는다.
- Host 머리가 `127.0.0.1:<포트>`·`localhost:<포트>` 가 아니면 거절한다(DNS rebinding).
- 모든 `/api/` 는 열쇠 쿠키(`edith`)가 있어야 한다. 새 API 도 `/api/` 아래에 두면 이 검사를 그대로 탄다 — 검사 앞에 끼워 넣지 않는다.
- 쓰기는 같은 출처의 JSON `POST` 만 받는다(CSRF). CORS 머리를 달지 않는다. `x-frame-options: DENY`·`frame-ancestors 'none'` 을 지우지 않는다.
- 파일을 읽어 주는 API 는 정해 둔 폴더 안만 준다(`realpath` 뒤 경로 확인 — `skillFile`·`taskOutput` 참고). 브라우저가 보낸 경로를 그대로 열지 않는다.
- 프로세스를 띄울 때는 인자 배열로(`sh(cmd, args)`) — 셸 문자열로 이어 붙이지 않는다.
- 열쇠를 로그·화면·URL 에 남기지 않는다(시작 때 찍는 주소 빼고).

**코드 꼴**

- 서버(`src/`)는 빌드 없이 `node src/cli.ts` 로 돈다(Node 24 type stripping). 지울 수 있는 TypeScript 만 — enum·namespace·생성자 매개변수 속성 금지(`erasableSyntaxOnly`). import 는 `.ts` 확장자까지 쓴다.
- 서버에 런타임 의존성을 넣지 않는다(Node 내장만). 화면(`web/`)은 React·TanStack Query·Tailwind·xterm.js.
- 둘레 코드와 같게: 짧은 함수, 위에 한두 줄 주석(왜 그렇게 하는지), 한국어 주석. 깨질 수 있는 단순화는 `ponytail:` 주석으로 한계를 적는다.
- herdr 는 읽기는 CLI(`sh('herdr', …)`), 쓰기·구독은 소켓(`api(method, params)`) — 이유는 `src/herdr.ts` 머리 주석. 쓸 수 있는 메서드는 `herdr api schema`.
- macOS·Linux·Windows 를 다 생각한다: 경로는 `node:path`, Windows 는 `\`·대소문자·`.cmd` 가 다르다.

## 고친 뒤

- 사용자에게 바꾼 것과 확인한 것(실행한 명령·결과)을 짧게 알린다. 확인하지 못한 것은 못 했다고 말한다.
- 커밋·push 는 사용자가 하라고 할 때만.
