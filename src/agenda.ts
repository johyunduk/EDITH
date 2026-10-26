// 런의 안건 이름 — 런이 남긴 레포(edith-repos.json)의 브랜치(이슈 런이면 via — 들어갈 안건 브랜치)가 배포 목록(src/deploy.ts)에 있으면 그 항목이 든 배포 카드의 이름(예: 「포인트」).
// 런 화면이 「ISSUE-5 [포인트] 제목」 으로 보인다. 본 레포는 워크트리의 .git 파일(gitdir: <본 레포>/.git/worktrees/<이름>)로 찾는다 —
// 런 목록은 3초마다 읽어서 git 을 띄우지 않는다. 배포 화면의 런 잇기(deployBoard)와 같은 짝(본 레포 · 브랜치)이다.
// shortcut: .git 파일 꼴만 본다 — --separate-git-dir 같은 특이한 레포는 안건이 안 붙는다(배포 화면은 git 으로 잇는다), 그런 레포가 생기면 git rev-parse 로
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DEPLOY_FILE, loadStore, type Item } from './deploy.ts';
import { readRefs } from './repos.ts';
import { RUNS } from './runner.ts';

// 워크트리(또는 본 체크아웃)의 본 레포 경로 — 못 읽으면 null
export function mainOf(path: string) {
  try {
    if (statSync(join(path, '.git')).isDirectory()) return path;
    const m = readFileSync(join(path, '.git'), 'utf8').match(/^gitdir:\s*(.+?)[\\/]\.git[\\/]worktrees[\\/][^\\/\n]+\s*$/m);
    return m ? m[1] : null;
  } catch { return null; }
}
// 배포 화면 카드 이름과 같게 — 안건 키(QA 이슈는 상위 안건)가 있으면 그 안건 자기 항목(ticket 이 없거나 agenda 와 같은 것)의 tag
function cardOf(x: Item, items: Item[]) {
  const head = x.agenda ? items.find(i => i.agenda === x.agenda && i.done === x.done && (!i.ticket || i.ticket === i.agenda)) : undefined;
  return head?.tag ?? x.tag;
}
export function agendaOf(work: string, items: Item[]) {
  for (const x of readRefs(work)) {
    const repo = mainOf(x.path), branch = (x.via ?? x.branch ?? '').replace(/^origin\//, '');
    const hit = repo && branch ? items.find(i => i.repo === repo && i.branch === branch) : undefined;
    const name = hit && cardOf(hit, items);
    if (name) return name;
  }
  return undefined;
}
// 런 목록 · 런 하나에 agenda 를 붙인다(배포 목록은 한 번만 읽는다)
export function withAgenda<T extends { id: number }>(runs: T[], file = DEPLOY_FILE): (T & { agenda?: string })[] {
  const items = loadStore(file).items;
  return runs.map(r => { const agenda = agendaOf(join(RUNS, String(r.id), 'work'), items); return agenda ? { ...r, agenda } : r; });
}
