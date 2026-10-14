// 📸 스크린샷 — ⌘⇧4 와 같은 영역 고르기(스페이스면 창, Esc 면 취소)로 이 기기 화면을 찍어 첨부 폴더에 두고 그 경로를 준다.
// 서버가 도는 기기의 화면을 찍으므로 화면은 이 기기(LOCAL)에서 볼 때만 버튼을 보인다 — 원격으로 보면 다른 기기 화면이 찍힌다.
// ponytail: macOS 만(screencapture). 다른 OS 는 OS 캡처를 클립보드로 찍어 입력칸에 붙여넣는다.
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DATA_DIR } from './config.ts';
import { sh } from './sh.ts';

export const canShoot = process.platform === 'darwin';

// 떠 있는 썸네일이 파일 저장을 몇 초 늦추므로 찍는 동안만 끄고 원래 설정으로 되돌린다(없던 설정은 없게)
const THUMB = ['com.apple.screencapture', 'show-thumbnail'];
export async function screenshot() {
  if (!canShoot) throw new Error('스크린샷 버튼은 macOS 만 — OS 캡처를 클립보드로 찍어 입력칸에 붙여넣는다');
  const dir = join(DATA_DIR, 'uploads');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}-screenshot.png`);
  const prev = await sh('defaults', ['read', ...THUMB], { ok: true });
  try {
    await sh('defaults', ['write', ...THUMB, '-bool', 'false'], { ok: true });
    await sh('screencapture', ['-i', path], { ok: true, timeoutMs: 300_000 });
  } finally {
    if (prev.code !== 0) await sh('defaults', ['delete', ...THUMB], { ok: true });
    else await sh('defaults', ['write', ...THUMB, '-bool', prev.stdout.trim() === '0' ? 'false' : 'true'], { ok: true });
  }
  if (!existsSync(path)) return null;   // Esc 로 취소
  chmodSync(path, 0o600);
  return path;
}
