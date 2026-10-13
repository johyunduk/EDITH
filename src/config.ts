import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOME = homedir();
export const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
export const CONFIG_DIR = join(HOME, '.config', 'edith');         // 화면 열쇠(console.key)
export const DATA_DIR = join(HOME, '.local', 'share', 'edith');   // 요약 기억(summaries.json), 첨부(uploads/)
