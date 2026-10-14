// 스킬 옮기기 — 내 스킬·명령·Codex 프롬프트를 파일 하나(edith-skills-<날짜>.json.gz)로 내보내고, 다른 기기에서 가져온다.
// 묶음은 JSON 을 gzip 한 것: { edith: 1, files: [{ path, data(base64), exec }], links: [{ path, target }], plugins: [{ id, add }] }.
// path 는 홈 기준(.claude/skills/x/SKILL.md 꼴)이고 ROOTS 안만 받는다. tar 대신 이 꼴인 까닭: 풀 때 경로·링크를 하나하나 확인할 수 있고 Windows 에서도 같다.
// 덩이(unit) = ROOTS 바로 아래 하나(스킬 폴더·명령 파일). 가져올 때는 덩이째 — 이미 있으면 건너뛰고, 고른 것만 지우고 새로 쓴다.
// 플러그인은 파일 대신 켜 둔 목록과 마켓플레이스 주소만 — 받는 쪽에서 claude plugin 명령으로 다시 설치한다.
import { lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

export const ROOTS = ['.claude/skills', '.claude/commands', '.agents/skills', '.codex/skills', '.codex/prompts'];
const MAX = 100 * 1024 * 1024;   // 풀었을 때 크기 한도
const SKIP = new Set(['.DS_Store', 'node_modules', '.git']);

type File = { path: string; data: string; exec?: boolean };
type Link = { path: string; target: string };
export type Plugin = { id: string; add: string | null };
export type Bundle = { edith: 1; at: string; files: File[]; links: Link[]; plugins: Plugin[] };

// 홈 기준 경로 → 그 덩이(ROOTS/이름). 절대 경로·「..」·빈 조각·「.」 으로 시작하는 덩이·ROOTS 밖이면 null.
export function unitOf(rel: string) {
  if (typeof rel !== 'string' || /[\\:]/.test(rel) || rel.startsWith('/')) return null;
  const seg = rel.split('/');
  if (seg.some(s => !s || s === '.' || s === '..') || seg.length < 3 || seg[2].startsWith('.')) return null;
  const root = `${seg[0]}/${seg[1]}`;
  return ROOTS.includes(root) ? `${root}/${seg[2]}` : null;
}
// 링크는 덩이 자리에만, 가리키는 곳도 ROOTS 안의 덩이(상대 경로)여야 — 공유 스킬의 ~/.claude/skills/x → ../../.agents/skills/x 꼴
export const linkOk = (l: Link) => unitOf(l.path) === l.path && typeof l.target === 'string' && !l.target.startsWith('/')
  && !/[\\:]/.test(l.target) && unitOf(posix.normalize(posix.join(posix.dirname(l.path), l.target))) !== null;

const list = (d: string) => { try { return readdirSync(d); } catch { return []; } };
const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };

// 이 홈의 덩이들 중 realpath 가 paths 에 든 것(스킬 지도 skills.ts 의 path 는 realpath) — 공유 스킬이면 원본 폴더와 링크 둘 다
export function unitsAt(home: string, paths: string[]) {
  const want = new Set(paths);
  return ROOTS.flatMap(root => list(join(home, root)).filter(f => !f.startsWith('.')).map(f => `${root}/${f}`)).filter(u => want.has(real(join(home, u))));
}

// 켜 둔 Claude 플러그인과 그 마켓플레이스를 더하는 주소(github 은 owner/repo, git 은 url, directory 는 경로 — 다른 기기에선 없을 수 있다)
export function enabledPlugins(home: string): Plugin[] {
  const json = (p: string) => { try { return JSON.parse(readFileSync(join(home, p), 'utf8')); } catch { return {}; } };
  const on = (json('.claude/settings.json').enabledPlugins ?? {}) as Record<string, boolean>;
  const known = json('.claude/plugins/known_marketplaces.json') as Record<string, { source?: { repo?: string; url?: string; path?: string } }>;
  return Object.entries(on).filter(([, v]) => v).map(([id]) => {
    const s = known[id.split('@')[1] ?? '']?.source;
    return { id, add: s?.repo ?? s?.url ?? s?.path ?? null };
  });
}

export function pack(home: string, units: string[], plugins: Plugin[]) {
  const files: File[] = [], links: Link[] = [];
  let size = 0;
  const walk = (abs: string, rel: string) => {
    const st = statSync(abs);   // 덩이 안의 링크는 따라가 내용을 담는다
    if (st.isDirectory()) { for (const f of list(abs)) if (!SKIP.has(f)) walk(join(abs, f), `${rel}/${f}`); return; }
    size += st.size;
    if (size > MAX) throw new Error('묶음이 100MB 를 넘는다');
    files.push({ path: rel, data: readFileSync(abs).toString('base64'), ...(st.mode & 0o111 ? { exec: true } : {}) });
  };
  for (const u of units) {
    if (unitOf(u) !== u) continue;
    const abs = join(home, u), l = lstatSync(abs);
    const link = l.isSymbolicLink() ? { path: u, target: readlinkSync(abs).replace(/\\/g, '/') } : null;
    if (link && linkOk(link)) links.push(link);
    else walk(abs, u);   // 밖을 가리키는 링크는 내용으로
  }
  return gzipSync(JSON.stringify({ edith: 1, at: new Date().toISOString(), files, links, plugins } satisfies Bundle));
}

// 받은 파일 → 묶음. 경로·링크가 하나라도 맞지 않으면 통째로 거절한다. 링크인 덩이에는 파일이 없어야 한다(링크 너머로 쓰지 않게).
export function unpack(buf: Buffer): Bundle {
  let b: Bundle;
  try { b = JSON.parse(gunzipSync(buf, { maxOutputLength: MAX * 1.4 }).toString('utf8')); } catch { throw new Error('EDITH 스킬 묶음(.json.gz)이 아니다'); }
  if (b?.edith !== 1 || !Array.isArray(b.files) || !Array.isArray(b.links)) throw new Error('EDITH 스킬 묶음이 아니다');
  for (const f of b.files) if (!unitOf(f.path) || typeof f.data !== 'string') throw new Error(`받을 수 없는 경로: ${String(f.path)}`);
  for (const l of b.links) if (!linkOk(l)) throw new Error(`받을 수 없는 링크: ${String(l.path)} → ${String(l.target)}`);
  const linked = new Set(b.links.map(l => l.path));
  if (b.files.some(f => linked.has(unitOf(f.path)!))) throw new Error('링크인 덩이에 파일이 들어 있다');
  b.plugins = Array.isArray(b.plugins) ? b.plugins.filter(p => typeof p?.id === 'string') : [];
  return b;
}

const units = (b: Bundle) => [...new Set([...b.files.map(f => unitOf(f.path)!), ...b.links.map(l => l.path)])].sort();
const lexists = (p: string) => { try { lstatSync(p); return true; } catch { return false; } };

export function preview(home: string, b: Bundle) {
  return {
    at: b.at, plugins: b.plugins,
    units: units(b).map(u => ({ unit: u, link: b.links.some(l => l.path === u), files: b.files.filter(f => unitOf(f.path) === u).length, exists: lexists(join(home, u)) })),
  };
}

// 덩이째 쓴다 — 있으면 overwrite 에 든 것만 지우고 새로, 아니면 건너뛴다. 링크는 Windows 면 정션(관리자 권한 없이 되는 폴더 링크)으로.
export function apply(home: string, b: Bundle, overwrite: string[]) {
  const done = { added: [] as string[], replaced: [] as string[], skipped: [] as string[] };
  for (const u of units(b)) {
    const abs = join(home, u), had = lexists(abs);
    if (had && !overwrite.includes(u)) { done.skipped.push(u); continue; }
    if (had) rmSync(abs, { recursive: true, force: true });   // 링크면 링크만 지운다
    const link = b.links.find(l => l.path === u);
    if (link) {
      mkdirSync(dirname(abs), { recursive: true });
      if (process.platform === 'win32') symlinkSync(resolve(dirname(abs), link.target), abs, 'junction');
      else symlinkSync(link.target, abs);
    }
    for (const f of b.files.filter(f => unitOf(f.path) === u)) {
      const p = join(home, f.path);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, Buffer.from(f.data, 'base64'), { mode: f.exec ? 0o755 : 0o644 });
    }
    (had ? done.replaced : done.added).push(u);
  }
  return done;
}
