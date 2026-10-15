// 설정 화면의 서버 쪽 — EDITH 가 함께 까는 Claude 플러그인의 켜짐(옵션 enabled). 값은 Claude Code 가 쥔다(settings.json pluginConfigs):
// claude plugin configure 로 읽고 쓰고, 떠 있는 Claude 세션도 다음 호출부터 따른다(플러그인이 호출마다 읽는다).
// ponytail: Windows 에서 npm 으로 깐 claude(.cmd)는 셸 없이 못 띄운다 — 네이티브 설치(claude.exe)만 된다
import { sh } from './sh.ts';

// 커밋 지킴이(git commit·push 전에 묻기), Claude 끼리는 SendMessage
export const PLUGINS = { commitGuard: 'commit-guard@edith', peerMessage: 'peer-message@edith' } as const;
export type Toggle = keyof typeof PLUGINS;
export const isToggle = (k: string): k is Toggle => Object.hasOwn(PLUGINS, k);

// configure --json 의 inputs 는 글자("true"·"false") — 기본값(켜짐)이 채워져 온다
export const enabledIn = (json: string) => (JSON.parse(json) as { inputs?: { enabled?: string } }).inputs?.enabled !== 'false';

// 켜짐 true·꺼짐 false, 설치 안 됨 null
async function read(k: Toggle): Promise<boolean | null> {
  const r = await sh('claude', ['plugin', 'configure', PLUGINS[k], '--json'], { ok: true, timeoutMs: 20_000 }).catch(() => null);
  return r?.code === 0 ? enabledIn(r.stdout) : null;
}

export async function settings() {
  const ks = Object.keys(PLUGINS) as Toggle[];
  return Object.fromEntries(await Promise.all(ks.map(async k => [k, await read(k)]))) as Record<Toggle, boolean | null>;
}

export async function setSetting(k: Toggle, on: boolean) {
  await sh('claude', ['plugin', 'configure', PLUGINS[k], '--values-stdin'], { input: JSON.stringify({ enabled: String(on) }), timeoutMs: 20_000 });
  return settings();
}
