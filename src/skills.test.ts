import { test } from 'node:test';
import assert from 'node:assert/strict';
import { link, type SkillNode } from './skills.ts';

const node = (id: string, name: string, agents: ('claude' | 'codex')[], text: string) =>
  ({ id, name, call: '', agents, source: 'user', kind: 'skill', desc: '', path: text, files: [], uses: [] } as SkillNode);

test('스킬 관계 — 부르는 꼴만 세고, 같은 이름은 꼴($·/·경로)과 같은 에이전트로 고른다', () => {
  const nodes = [
    node('claude:review', 'review', ['claude'], '리뷰어는 $flow 를 쓰고 `herdr` 를 로드한다. flow-tree 나 .flow/ 는 다른 이름이다'),
    node('claude:flow', 'flow', ['claude'], '/flow-tree 로 시작'),
    node('codex:flow', 'flow', ['codex'], ''),
    node('shared:herdr', 'herdr', ['claude', 'codex'], ''),
    node('claude:flow-tree', 'flow-tree', ['claude'], '끝나면 /flow 를 부른다. ~/.claude/skills/flow-status/status.py'),
    node('claude:flow-status', 'flow-status', ['claude'], ''),
  ];
  link(nodes, n => n.path);
  const uses = Object.fromEntries(nodes.map(n => [n.id, n.uses.map(u => `${u.id}(${u.how})`)]));
  assert.deepEqual(uses['claude:review'], ['codex:flow($)', 'shared:herdr(`)']);
  assert.deepEqual(uses['claude:flow'], ['claude:flow-tree(/)']);
  assert.deepEqual(uses['claude:flow-tree'], ['claude:flow(/)', 'claude:flow-status(경로)']);
});

