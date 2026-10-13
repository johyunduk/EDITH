// 입력칸 자동 완성 — / 명령·스킬, $ 스킬(Codex), @ 파일. 화면이 고를 목록만 준다(보내기는 그대로 프롬프트).
// Claude: 기본 명령 + 내 명령·스킬(~/.claude) + 프로젝트 명령·스킬(작업 폴더 레포의 .claude) + 켜 둔 플러그인의 명령·스킬(/플러그인:이름).
// Codex: 기본 명령 + ~/.codex/prompts(/prompts:이름) + 스킬. 스킬은 Codex 에선 $이름이지만 화면은 Claude 처럼 /이름으로 보이고,
// 보낼 때 toCodex 가 $이름으로 바꾼다(아래).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { sh } from './sh.ts';

export type Entry = { name: string; desc: string; skill?: boolean };
const HOME = homedir();

const CLAUDE_BUILTIN: [string, string][] = [
  ['/clear', '대화 비우고 새로'], ['/compact', '대화 요약해 줄이기'], ['/context', '컨텍스트 사용량'], ['/cost', '쓴 비용·토큰'],
  ['/model', '모델 고르기'], ['/effort', '생각 강도'], ['/resume', '지난 세션 이어 가기'], ['/rename', '세션 이름 바꾸기'],
  ['/rewind', '앞 지점으로 되돌리기'], ['/memory', '메모리 파일 고치기'], ['/init', 'CLAUDE.md 만들기'], ['/review', 'PR 리뷰'],
  ['/security-review', '보안 리뷰'], ['/agents', '에이전트 관리'], ['/mcp', 'MCP 서버'], ['/hooks', '훅 설정'], ['/permissions', '권한'],
  ['/config', '설정'], ['/status', '상태'], ['/usage', '사용량 한도'], ['/todos', '할 일 목록'], ['/export', '대화 내보내기'],
  ['/add-dir', '작업 폴더 더하기'], ['/doctor', '설치 점검'], ['/help', '도움말'], ['/exit', '끝내기'],
];
const CODEX_BUILTIN: [string, string][] = [
  ['/model', '모델·생각 강도'], ['/approvals', '승인 방식'], ['/review', '변경 리뷰'], ['/new', '새 대화'], ['/compact', '대화 요약해 줄이기'],
  ['/diff', 'git diff 보기'], ['/mention', '파일 언급'], ['/status', '상태'], ['/init', 'AGENTS.md 만들기'], ['/mcp', 'MCP 도구'], ['/quit', '끝내기'],
];

// md 머리말(--- … ---)의 한 줄 값. 없으면 본문 첫 글줄.
export function describe(file: string) {
  try {
    const t = readFileSync(file, 'utf8').slice(0, 4000);
    const fm = t.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    const d = fm.match(/^description:\s*(.*)$/m)?.[1]?.replace(/^['"]|['"]$/g, '')
      ?? t.replace(/^---[\s\S]*?---/, '').split('\n').find(l => l.trim() && !l.startsWith('#'));
    return (d ?? '').trim().slice(0, 140);
  } catch { return ''; }
}
const list = (dir: string) => { try { return readdirSync(dir); } catch { return []; } };
// commands/*.md 와 skills/*/SKILL.md 를 이름 앞에 prefix 를 붙여 모은다.
function scan(base: string, prefix: string): Entry[] {
  return [
    ...list(join(base, 'commands')).filter(f => f.endsWith('.md')).map(f => ({ name: `${prefix}${f.slice(0, -3)}`, desc: describe(join(base, 'commands', f)) })),
    ...list(join(base, 'skills')).filter(d => existsSync(join(base, 'skills', d, 'SKILL.md'))).map(d => ({ name: `${prefix}${d}`, desc: describe(join(base, 'skills', d, 'SKILL.md')) })),
  ];
}

// 켜 둔 Claude 플러그인의 설치 폴더(이름은 @ 앞)
export function pluginRoots(): { name: string; path: string }[] {
  try {
    const on = JSON.parse(readFileSync(join(HOME, '.claude', 'settings.json'), 'utf8')).enabledPlugins as Record<string, boolean>;
    const inst = JSON.parse(readFileSync(join(HOME, '.claude', 'plugins', 'installed_plugins.json'), 'utf8'));
    const all = (inst.plugins ?? inst) as Record<string, { installPath: string }[] | { installPath: string }>;
    return Object.entries(on ?? {}).filter(([, v]) => v).flatMap(([id]) => {
      const e = all[id], path = Array.isArray(e) ? e[0]?.installPath : e?.installPath;
      return path ? [{ name: id.split('@')[0], path }] : [];
    });
  } catch { return []; }
}
const plugins = (): Entry[] => pluginRoots().flatMap(p => scan(p.path, `/${p.name}:`));

const codexSkills = () => list(join(HOME, '.codex', 'skills')).filter(d => existsSync(join(HOME, '.codex', 'skills', d, 'SKILL.md')));

// Claude 방식으로 쓴 글을 Codex 에 맞게 — /스킬 → $스킬(어디서든), 맨 앞 명령은 Codex 쪽 이름으로. 그 밖은 그대로.
const CODEX_CMD: Record<string, string> = { '/clear': '/new', '/exit': '/quit', '/context': '/status', '/cost': '/status' };
export function toCodex(text: string, skills = new Set(codexSkills())) {
  const t = text.replace(/(^|\s)\/([\w-]+)(?=\s|$)/g, (m, pre: string, name: string) => skills.has(name) ? `${pre}$${name}` : m);
  return t.replace(/^\/[\w-]+(?=\s|$)/, c => CODEX_CMD[c] ?? c);
}

const cache = new Map<string, { at: number; v: Entry[] }>();
const cached = (key: string, f: () => Entry[]) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.v;
  const v = f();
  cache.set(key, { at: Date.now(), v });
  return v;
};

const uniq = (es: Entry[]) => [...new Map(es.map(e => [e.name, e])).values()];   // 같은 이름(명령·스킬 둘 다)은 하나로

export async function commands(agent: string, cwd: string) {
  const root = (await sh('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { ok: true })).stdout.trim() || cwd;
  return cached(`${agent}:${root}`, () => uniq(agent === 'codex'
    ? [
      ...CODEX_BUILTIN.map(([name, desc]) => ({ name, desc })),
      ...list(join(HOME, '.codex', 'prompts')).filter(f => f.endsWith('.md')).map(f => ({ name: `/prompts:${f.slice(0, -3)}`, desc: describe(join(HOME, '.codex', 'prompts', f)) })),
      ...codexSkills().map(d => ({ name: `/${d}`, desc: describe(join(HOME, '.codex', 'skills', d, 'SKILL.md')), skill: true })),
    ]
    : [
      ...CLAUDE_BUILTIN.map(([name, desc]) => ({ name, desc })),
      ...scan(join(HOME, '.claude'), '/'),
      ...(root !== HOME ? scan(join(root, '.claude'), '/') : []),
      ...plugins(),
    ]));
}

// @ 파일 — 작업 폴더 아래 파일·폴더(git 이 무시하는 것 빼고). git 레포가 아니면 4단계까지 훑는다(node_modules·.git 빼고).
const files = new Map<string, { at: number; v: string[] }>();
function walk(dir: string, base: string, depth: number, out: string[]) {
  if (depth > 4 || out.length > 20000) return;
  for (const e of list(dir)) {
    if (e === 'node_modules' || e.startsWith('.git')) continue;
    const p = join(dir, e);
    let d = false;
    try { d = statSync(p).isDirectory(); } catch { continue; }
    out.push(relative(base, p) + (d ? '/' : ''));
    if (d) walk(p, base, depth + 1, out);
  }
}
async function fileList(cwd: string) {
  const hit = files.get(cwd);
  if (hit && Date.now() - hit.at < 30_000) return hit.v;
  const r = await sh('git', ['-C', cwd, 'ls-files', '--cached', '--others', '--exclude-standard'], { ok: true, timeoutMs: 10_000 });
  let v: string[];
  if (r.code === 0) {
    const fs = r.stdout.split('\n').filter(Boolean);
    const dirs = new Set(fs.flatMap(f => f.split('/').slice(0, -1).map((_, i, a) => `${a.slice(0, i + 1).join('/')}/`)));
    v = [...dirs, ...fs];
  } else { v = []; walk(cwd, cwd, 0, v); }
  files.set(cwd, { at: Date.now(), v });
  return v;
}

// 고르는 순서: 이름이 그 글로 시작 > 이름에 들어 있음 > 경로에 들어 있음 > 글자가 차례로 들어 있음. 짧은 경로가 먼저.
export async function findFiles(cwd: string, q: string) {
  const all = await fileList(cwd), s = q.toLowerCase();
  const score = (p: string) => {
    const low = p.toLowerCase(), name = low.replace(/\/$/, '').split('/').at(-1)!;
    if (!s) return 1;
    if (name.startsWith(s)) return 4;
    if (name.includes(s)) return 3;
    if (low.includes(s)) return 2;
    let i = 0;
    for (const c of low) if (c === s[i]) i++;
    return i === s.length ? 1 : 0;
  };
  return all.map(p => ({ p, sc: score(p) })).filter(x => x.sc > 0)
    .sort((a, b) => b.sc - a.sc || a.p.length - b.p.length).slice(0, 30).map(x => x.p);
}
