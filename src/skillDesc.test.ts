import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skillBrief, skillDetail } from '../web/src/skillDesc.ts';

test('앞머리 · 제목 되풀이를 떼고, 짧게는 괄호 없는 첫 문장', () => {
  const plan = '개발판 — 엔진 「BE 계획」 단계(be-plan). BE 계획 — API 계약(run/api.json) · DB 변경 목록(run/db.json) · 시드 · plan.md(「측: BE」 절).';
  assert.equal(skillDetail(plan, 'be-plan'), 'API 계약(run/api.json) · DB 변경 목록(run/db.json) · 시드 · plan.md(「측: BE」 절).');
  assert.equal(skillBrief(plan, 'be-plan'), 'API 계약 · DB 변경 목록 · 시드 · plan.md');
  const review = '개발판 — 엔진 「BE 계획 리뷰」 단계(be-plan-review). BE 계획을 Codex 와 왕복 리뷰하고 반영한다. 끝나면 계약을 고정한다.';
  assert.equal(skillBrief(review, 'be-plan-review'), 'BE 계획을 Codex 와 왕복 리뷰하고 반영한다');
  const recover = '개발판 — 앞 노드가 실패로 끝났을 때 처리한다(엔진 next → 수정 단계).';
  assert.equal(skillDetail(recover, 'recover'), '앞 노드가 실패로 끝났을 때 처리한다(엔진 next → 수정 단계).');
  assert.equal(skillBrief(recover, 'recover'), '앞 노드가 실패로 끝났을 때 처리한다');
  assert.equal(skillBrief('API 계약(run/api.json)과 실제 라우트가 맞는지 대조하고, 다른 곳을 목록으로 남긴다.', 'api-check'), 'API 계약과 실제 라우트가 맞는지 대조하고, 다른 곳을 목록으로 남긴다');
  assert.equal(skillBrief('시안 만들기', 'draft'), '시안 만들기');
});
