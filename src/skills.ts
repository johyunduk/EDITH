// 스킬 지도 — Claude·Codex 의 스킬·명령을 모으고, 서로 부르는 관계(한 스킬의 md 글에 다른 스킬을 부르는 꼴이 나오는지)를 찾는다. 읽기만 한다.
// Claude: ~/.claude/skills(일부는 ~/.agents/skills 로 가는 링크), ~/.claude/commands, 켜 둔 플러그인의 skills·commands.
// Codex: ~/.agents/skills(공유), ~/.codex/skills(.system 은 Codex 기본 스킬), ~/.codex/prompts.
// 같은 실제 폴더는 하나로 친다 — 링크로 둘 다 쓰는 ~/.agents 스킬은 「공유」.
// ponytail: 관계는 글 속 이름 찾기라 어림이다(부르는 꼴 /이름 · $이름 · skills/이름 · `이름` · 「이름 스킬」). 놓치거나 더 잡을 수 있다.
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { describe, pluginRoots } from './complete.ts';

type Agent = 'claude' | 'codex';
export type Use = { id: string; how: string };
export type SkillNode = {
  id: string; name: string; call: string; agents: Agent[]; source: string; kind: 'skill' | 'command' | 'prompt';
  desc: string; path: string; files: string[]; uses: Use[];
};

const H = homedir();
const list = (d: string) => { try { return readdirSync(d).filter(f => !f.startsWith('.') || f === '.system'); } catch { return []; } };
const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };
const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };

// 스킬 폴더 안 md 파일(SKILL.md 먼저, 두 단계까지)
function mdFiles(dir: string) {
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    for (const f of list(d)) {
      const p = join(d, f);
      if (isDir(p)) { if (depth < 2 && f !== 'node_modules') walk(p, depth + 1); } else if (f.endsWith('.md')) out.push(relative(dir, p));
    }
  };
  walk(dir, 0);
  return out.sort((a, b) => Number(b === 'SKILL.md') - Number(a === 'SKILL.md') || a.localeCompare(b));
}

function collect() {
  const byPath = new Map<string, SkillNode>();
  const add = (agent: Agent, source: string, kind: SkillNode['kind'], name: string, path: string, call: string) => {
    const r = real(path), hit = byPath.get(r);
    if (hit) { if (!hit.agents.includes(agent)) hit.agents.push(agent); return; }
    const dir = isDir(r);
    if (dir && !existsSync(join(r, 'SKILL.md'))) return;
    const plugin = source.startsWith('plugin:') ? `${source.slice(7)}:` : '';
    byPath.set(r, {
      id: `${source === 'shared' ? 'shared' : agent}:${kind === 'skill' ? '' : `${kind}:`}${plugin}${name}`, name: plugin + name, call, agents: [agent], source, kind,
      desc: describe(dir ? join(r, 'SKILL.md') : r), path: r, files: dir ? mdFiles(r) : [basename(r)], uses: [],
    });
  };
  const skillDirs = (base: string) => list(base).flatMap(d => d === '.system' ? [] : [[d, join(base, d)] as const]);
  for (const [n, p] of skillDirs(join(H, '.agents', 'skills'))) add('codex', 'shared', 'skill', n, p, `$${n}`);
  for (const [n, p] of skillDirs(join(H, '.codex', 'skills'))) add('codex', 'user', 'skill', n, p, `$${n}`);
  for (const [n, p] of skillDirs(join(H, '.codex', 'skills', '.system'))) add('codex', 'system', 'skill', n, p, `$${n}`);
  for (const f of list(join(H, '.codex', 'prompts')).filter(f => f.endsWith('.md'))) add('codex', 'user', 'prompt', f.slice(0, -3), join(H, '.codex', 'prompts', f), `/prompts:${f.slice(0, -3)}`);
  for (const [n, p] of skillDirs(join(H, '.claude', 'skills'))) add('claude', 'user', 'skill', n, p, `/${n}`);
  for (const f of list(join(H, '.claude', 'commands')).filter(f => f.endsWith('.md'))) add('claude', 'user', 'command', f.slice(0, -3), join(H, '.claude', 'commands', f), `/${f.slice(0, -3)}`);
  for (const pl of pluginRoots()) {
    for (const [n, p] of skillDirs(join(pl.path, 'skills'))) add('claude', `plugin:${pl.name}`, 'skill', n, p, `/${pl.name}:${n}`);
    for (const f of list(join(pl.path, 'commands')).filter(f => f.endsWith('.md'))) add('claude', `plugin:${pl.name}`, 'command', f.slice(0, -3), join(pl.path, 'commands', f), `/${pl.name}:${f.slice(0, -3)}`);
  }
  const nodes = [...byPath.values()];
  for (const n of nodes) if (n.agents.length > 1) n.source = 'shared';
  link(nodes, n => n.files.map(f => { try { return readFileSync(n.files.length === 1 && !isDir(n.path) ? n.path : join(n.path, f), 'utf8'); } catch { return ''; } }).join('\n').slice(0, 400_000));
  return nodes;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 관계 찾기 — 이름마다 부르는 꼴을 찾고, 같은 이름이 여럿(Claude review · Codex review)이면 꼴로 고른다: $·.codex/ 는 Codex, /·.claude/ 는 Claude,
// 그 밖은 부르는 쪽과 같은 에이전트 것. 플러그인 스킬은 「플러그인:이름」 꼴만 센다(짧은 이름이 겹쳐서).
export function link(nodes: SkillNode[], text: (n: SkillNode) => string) {
  const byName = new Map<string, SkillNode[]>();
  for (const n of nodes) byName.set(n.name, [...(byName.get(n.name) ?? []), n]);
  for (const a of nodes) {
    const t = text(a), seen = new Set<string>();
    for (const [name, cands] of byName) {
      const N = esc(name), plugin = name.includes(':');
      const forms: [string, RegExp][] = plugin
        ? [['/', new RegExp(`(?<![\\w-])/?${N}(?![\\w-])`)]]
        : [
          ['$', new RegExp(`(?<![\\w$])\\$${N}(?![\\w-])`)], ['/', new RegExp(`(?<![\\w./~-])/${N}(?![\\w-])`)],
          ['경로', new RegExp(`skills/${N}(?![\\w-])`)], ['`', new RegExp(`\`${N}\``)], ['언급', new RegExp(`(?<![\\w./-])${N}\\s*(?:스킬|skill)`, 'i')],
        ];
      const hit = forms.find(([, r]) => r.test(t));
      if (!hit) continue;
      const how = hit[0], wantCodex = how === '$' || new RegExp(`\\.codex/skills/${N}`).test(t), wantClaude = how === '/' || new RegExp(`\\.claude/skills/${N}`).test(t);
      const b = cands.length === 1 ? cands[0]
        : cands.find(c => wantCodex && c.agents.includes('codex')) ?? cands.find(c => wantClaude && c.agents.includes('claude'))
          ?? cands.find(c => c.agents.some(x => a.agents.includes(x))) ?? cands[0];
      if (b === a || seen.has(b.id)) continue;
      seen.add(b.id);
      a.uses.push({ id: b.id, how });
    }
  }
}

let cache: { at: number; nodes: SkillNode[] } | null = null;
export const forgetSkills = () => { cache = null; };   // 가져오기로 바뀌었을 때
export function skills() {
  if (!cache || Date.now() - cache.at > 30_000) cache = { at: Date.now(), nodes: collect() };
  return cache.nodes;
}

// 스킬 폴더의 md 한 개 — 목록에 있는 파일만
export function skillFile(id: string, file: string) {
  const n = skills().find(x => x.id === id);
  if (!n || !n.files.includes(file)) return null;
  return readFileSync(isDir(n.path) ? join(n.path, file) : n.path, 'utf8');
}
