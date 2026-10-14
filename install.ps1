# EDITH installer for Windows: herdr, Claude Code, Codex CLI, the herdr integrations and skill, then EDITH itself.
# Safe to run again: tools already present are skipped, integrations and the skill are refreshed.
#   powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/johyunduk/EDITH/main/install.ps1 | iex"
# No admin rights. Downloads only from each tool's official installer (herdr.dev, claude.ai, npm, winget) and this repo.
# Run from a checkout and EDITH is built there; otherwise it is cloned to $env:EDITH_DIR (default ~\.edith).
# This file stays ASCII: Windows PowerShell 5.1 reads a BOM-less .ps1 in the ANSI code page and would mangle anything else.
# ponytail: not yet run on a real Windows machine. If a step fails, follow the manual install in the README.

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Have($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }
function Run([string]$exe, [string[]]$a) {
  Write-Host "  > $exe $($a -join ' ')"
  & $exe @a
  if ($LASTEXITCODE) { throw "$exe failed (exit code $LASTEXITCODE)" }
}
# Other installers run in their own PowerShell so their `exit` cannot end this script; PATH is re-read afterwards.
function Pipe([string]$url) {
  Write-Host "  > irm $url | iex"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm $url | iex"
  if ($LASTEXITCODE) { throw "$url failed (exit code $LASTEXITCODE)" }
  Refresh-Path
}
function Refresh-Path {
  $env:Path = @([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User'), "$HOME\.local\bin") -join ';'
}
# Skill files are written as UTF-8 without BOM; a BOM hides the front matter (---).
function Write-Utf8([string]$path, [string]$text) { [IO.File]::WriteAllText($path, $text, [Text.UTF8Encoding]::new($false)) }

function Main {
  $ErrorActionPreference = 'Stop'
  [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)   # read `herdr --skill` output intact
  $repo = 'https://github.com/johyunduk/EDITH.git'
  Refresh-Path
  if (-not (Have git)) { throw 'git is required. Install Git for Windows (https://git-scm.com) and run again; Claude Code uses its Git Bash too.' }

  Step 'Node 24+ (EDITH server, Codex CLI)'
  $major = if (Have node) { [int](node -p "process.versions.node.split('.')[0]") } else { 0 }
  if ($major -lt 24) {
    if (Have winget) { Run winget @('install', '--id', 'OpenJS.NodeJS.LTS', '-e'); Refresh-Path }
    else { throw 'Node 24 or later is required. Install it from https://nodejs.org and run again.' }
  }
  Write-Host "  node $(node -v)"

  Step 'herdr'
  if (Have herdr) { Write-Host "  found: $(herdr --version)" } else { Pipe 'https://herdr.dev/install.ps1' }

  Step 'Claude Code'
  if (Have claude) { Write-Host "  found: $(claude --version)" } else { Pipe 'https://claude.ai/install.ps1' }

  Step 'Codex CLI'
  if (Have codex) { Write-Host "  found: $(codex --version)" } else { Run npm @('install', '-g', '@openai/codex'); Refresh-Path }

  # The Claude and herdr installers put their binaries in ~\.local\bin; keep it on the user PATH for new terminals.
  $lb = "$HOME\.local\bin"
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ((Test-Path "$lb\claude.exe") -and -not ("$userPath" -split ';' -contains $lb)) {
    [Environment]::SetEnvironmentVariable('Path', ("$userPath".TrimEnd(';') + ";$lb").TrimStart(';'), 'User')
    Write-Host "  added $lb to your user PATH"
  }

  # The integrations need the config folders to exist; a fresh install may not have them yet (both tools accept an empty one).
  Step 'herdr integrations (report session IDs so EDITH opens the right transcript)'
  New-Item -ItemType Directory -Force "$HOME\.claude", "$HOME\.codex" | Out-Null
  Run herdr @('integration', 'install', 'claude')
  Run herdr @('integration', 'install', 'codex')

  # `herdr --skill` prints skills/herdr/SKILL.md for the installed version. Codex reads ~\.agents\skills and Claude
  # reads ~\.claude\skills; symlinks need extra rights on Windows, so both get a copy.
  Step 'herdr skill (teaches Claude and Codex to drive herdr)'
  $skill = (herdr --skill) -join "`n"
  foreach ($d in "$HOME\.agents\skills\herdr", "$HOME\.claude\skills\herdr") {
    New-Item -ItemType Directory -Force $d | Out-Null
    Write-Utf8 "$d\SKILL.md" "$skill`n"
    Write-Host "  $d\SKILL.md"
  }

  Step 'EDITH'
  $pkg = if ($PSScriptRoot) { Join-Path $PSScriptRoot 'package.json' }
  $here = if ($pkg -and (Test-Path $pkg) -and (Select-String -Quiet -SimpleMatch '"name": "edith"' $pkg)) { $PSScriptRoot }
  $dir = if ($here) { $here } elseif ($env:EDITH_DIR) { $env:EDITH_DIR } else { "$HOME\.edith" }
  if (-not $here) {
    if (Test-Path "$dir\.git") { Run git @('-C', $dir, 'pull', '--ff-only') } else { Run git @('clone', $repo, $dir) }
  }
  Push-Location $dir
  try { Run npm @('install', '--no-audit', '--no-fund'); Run npm @('run', 'build'); Run npm @('link') } finally { Pop-Location }

  Step 'Done. Open a new PowerShell window (it picks up the new PATH), then once:'
  Write-Host @'
  claude   # sign in
  codex    # sign in
  edith    # starts the herdr server if needed and opens EDITH in your browser; next time just edith

  Optional: Claude usage chips, see "Usage chips" in the README (needs sh from Git Bash, jq and bc).
'@
}

# Called last, so a partially downloaded script never runs half-way.
Main
