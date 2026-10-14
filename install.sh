#!/usr/bin/env bash
# EDITH 설치 — herdr·Claude Code·Codex CLI, herdr 통합·스킬, EDITH 를 한 번에. 다시 돌려도 된다(있는 것은 건너뛰고 통합·스킬은 새로 맞춘다).
#   curl -fsSL https://raw.githubusercontent.com/johyunduk/EDITH/main/install.sh | bash
# sudo 는 쓰지 않는다. 받는 곳은 각 도구의 공식 설치 경로(herdr.dev·claude.ai·npm)와 이 레포뿐이다.
# EDITH 는 이 파일이 든 체크아웃에서 돌리면 그 폴더에, 아니면 $EDITH_REPO(기본 이 레포)를 $EDITH_DIR(기본 ~/.edith)에 받는다.
# 내 것으로 만든(템플릿·포크) 레포라면 아래 기본 주소만 내 레포로 바꾼다.
set -euo pipefail

main() {
  local repo=${EDITH_REPO:-https://github.com/johyunduk/EDITH.git} path0=$PATH
  export PATH="$HOME/.local/bin:$PATH"   # Claude Code·herdr 설치 스크립트가 여기에 둔다

  case "$(uname -s)" in Darwin | Linux) ;; *) die "macOS·Linux 만 지원한다" ;; esac
  have git || die "git 이 필요하다"
  have curl || die "curl 이 필요하다"

  # Homebrew 가 없으면 nvm 으로(sudo 없이 ~/.nvm 에, nvm 이 셸 설정에 자기 줄을 넣는다)
  step "Node 24+ (EDITH 서버·Codex CLI)"
  if ! node_ok; then
    if have brew; then run brew install node
    else
      touch "$(profile)"   # 새 맥엔 ~/.zshrc 가 없는데, nvm 은 셸 설정 파일이 없으면 자기 줄을 넣지 않는다
      pipe https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh bash
      export NVM_DIR="$HOME/.nvm"
      set +eu; . "$NVM_DIR/nvm.sh"; run nvm install 24; set -eu   # nvm.sh 는 -e·-u 를 견디지 못한다 — 결과는 아래 node_ok 로 본다
    fi
    node_ok || die "Node 24 를 설치하지 못했다 — https://nodejs.org 에서 설치하고 다시 돌린다"
  fi
  echo "  node $(node -v)"

  step "herdr"
  if have herdr; then echo "  있음 — $(herdr --version)"
  elif have brew; then run brew install herdr
  else pipe https://herdr.dev/install.sh sh; fi

  step "Claude Code"
  if have claude; then echo "  있음 — $(claude --version)"
  else pipe https://claude.ai/install.sh bash; fi

  step "Codex CLI"
  if have codex; then echo "  있음 — $(codex --version)"
  else run npm install -g @openai/codex; fi

  # Claude Code·herdr 설치 스크립트는 ~/.local/bin 에 두고 PATH 는 알려 주기만 한다 — 새 터미널에서도 찾게 셸 설정에 넣는다
  if [ -e "$HOME/.local/bin/claude" ] || [ -e "$HOME/.local/bin/herdr" ]; then
    case ":$path0:" in *":$HOME/.local/bin:"*) ;; *)
      local rc line='export PATH="$HOME/.local/bin:$PATH"'
      rc=$(profile)
      if ! grep -qsF "$line" "$rc"; then printf '\n# EDITH 설치 — Claude Code·herdr\n%s\n' "$line" >> "$rc"; echo "  $rc 에 ~/.local/bin 을 PATH 로 넣었다"; fi ;;
    esac
  fi

  # 통합은 설정 폴더가 있어야 설치된다 — 처음 설치면 아직 없어서 만든다(Claude·Codex 는 빈 폴더를 그대로 쓴다)
  step "herdr 통합 — 세션 ID 를 herdr 에 알린다(EDITH 대화 화면이 그 기록을 바로 연다)"
  mkdir -p "$HOME/.claude" "$HOME/.codex"
  run herdr integration install claude
  run herdr integration install codex

  # 스킬 원본은 herdr 저장소의 skills/herdr/SKILL.md 이고 `herdr --skill` 이 설치된 판의 것을 그대로 준다.
  # Codex 는 ~/.agents/skills, Claude 는 ~/.claude/skills 를 읽는다 — 한 벌을 두고 Claude 쪽은 링크(이미 있으면 두기).
  step "herdr 스킬 — Claude·Codex 가 herdr 를 다루는 법"
  mkdir -p "$HOME/.agents/skills/herdr" "$HOME/.claude/skills"
  herdr --skill > "$HOME/.agents/skills/herdr/SKILL.md"
  echo "  ~/.agents/skills/herdr/SKILL.md"
  if [ ! -e "$HOME/.claude/skills/herdr" ]; then run ln -s ../../.agents/skills/herdr "$HOME/.claude/skills/herdr"; fi

  step "EDITH"
  local here dir
  here=$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd) || here=
  if [ -n "$here" ] && grep -qs '"name": "edith"' "$here/package.json"; then dir=$here
  else
    dir=${EDITH_DIR:-$HOME/.edith}
    if [ -d "$dir/.git" ]; then run git -C "$dir" pull --ff-only
    else run git clone "$repo" "$dir"; fi
  fi
  (cd "$dir" && run npm install --no-audit --no-fund && run npm run build && run npm link)

  step "끝 — 새 터미널을 열고(PATH·nvm 이 새 터미널부터 잡힌다) 처음 한 번"
  cat <<EOF
  claude   # 로그인
  codex    # 로그인
  edith    # herdr 서버가 꺼져 있으면 띄우고 화면을 브라우저로 연다 — 다음부터는 edith 만

  선택: Claude 사용량 칩 — README 「사용량 칩」 처럼 statusLine 을 $dir/extras/statusline.sh 로
EOF
}

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
run() { printf '  $ %s\n' "$*"; "$@"; }
pipe() { printf '  $ curl -fsSL %s | %s\n' "$1" "$2"; curl -fsSL "$1" | "$2"; }
have() { command -v "$1" >/dev/null 2>&1; }
node_ok() { have node && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ]; }
# 새 터미널이 읽는 셸 설정 파일 — zsh 는 .zshrc, bash 는 macOS 면 .bash_profile·Linux 면 .bashrc
profile() {
  case "${SHELL##*/}" in
    zsh) echo "$HOME/.zshrc" ;;
    bash) if [ "$(uname -s)" = Darwin ]; then echo "$HOME/.bash_profile"; else echo "$HOME/.bashrc"; fi ;;
    *) echo "$HOME/.profile" ;;
  esac
}
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# 맨 끝에서 부른다 — 받다 끊긴 스크립트가 반만 돌지 않게
main "$@"
