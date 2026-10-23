import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needed, refWarnings } from './refs.ts';
import type { Step } from './runner.ts';

test('적용 전 검사 — 「없으면」 문장의 작업 문서 파일만, EDITH 파일 · 절대 경로 · 엔진 폴더는 빼고', () => {
  assert.deepEqual(needed('먼저 작업 문서의 bin/rules.md(런 공통 규칙)를 읽고, 없으면 막힘으로 끝낸다.\nsource.md 에 옮긴다.'), ['bin/rules.md']);
  assert.deepEqual(needed('result.json 이 없으면 다시. /Users/x/a.md 가 없으면 · $EDITH_ENGINE/check.sh 가 없으면 · ~/.claude/b.md 가 없으면'), []);
  assert.deepEqual(needed('inputs/list.md 가 없으면 멈춘다. 없으면 run/spec.md 도'), ['inputs/list.md']);
  assert.deepEqual(needed('기획(노션 원본, 없으면 「기획 받기」 원문)으로 레포 · 워크트리 · spec.md 를 준비한다'), []);   // 「없으면」 이 다른 것을 가리킨다
});

test('적용 전 검사 — 앞 노드(화살표로 거슬러, 고치는 노드는 고칠 노드 앞까지)가 그 이름을 쓰면 조용, 아니면 알린다', () => {
  const st = (key: string, kind: Step['kind'], deps: string[], more: Partial<Step> = {}): Step => ({ key, title: key.toUpperCase(), lane: '체인', group: '.', kind, engine: 'e', deps, ...more });
  const TEXT: Record<string, string> = {
    prep: 'cp $EDITH_ENGINE/rules.md work/bin/rules.md',
    gather: 'bin/rules.md 를 읽고, 없으면 막힘. inputs/list.md 가 없으면 멈춘다.',
    fix: 'run/plan.md 가 없으면 막힘',
    plan: 'run/plan.md 에 계획을 쓴다',
  };
  const steps = [st('prep', 'command', []), st('gather', 'skill', ['prep'], { failTo: 'fix' }), st('plan', 'skill', []), st('fix', 'skill', [], { fixOnly: true })];
  assert.deepEqual(refWarnings(steps, s => TEXT[s.key]), [
    '체인 › 「GATHER」 — inputs/list.md 가 없으면 멈추는데, 앞 노드 어디서도 이 파일을 만들지 않는다',
    '체인 › 「FIX」 — run/plan.md 가 없으면 멈추는데, 앞 노드 어디서도 이 파일을 만들지 않는다',   // plan 은 gather 앞이 아니다
  ]);
  TEXT.prep = 'mkdir -p "$W/bin"; cp -R "$EDITH_ENGINE/kit/." "$W/bin/"\nrules.md\ncheck.sh';   // 폴더째 깔기 — 파일 이름은 kit 목록에서
  assert.equal(refWarnings(steps, s => TEXT[s.key]).length, 2);
  steps[1].deps.push('plan');
  assert.equal(refWarnings(steps, s => TEXT[s.key]).length, 1);   // 고칠 노드 앞에 plan 이 들어오면 fix 는 조용
});
