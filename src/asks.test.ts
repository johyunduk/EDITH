import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstLine, lastAsks } from '../web/src/asks.ts';

test('마지막 시킨 말과 그 뒤 답 첫 줄', () => {
  const r = lastAsks([
    { t: 1, kind: 'user', text: '로그인 버튼 색 바꿔 줘', at: 0 },
    { t: 2, kind: 'text', text: '바꿨습니다.' },
    { t: 3, kind: 'user', text: '부분 환불도 되게 환불 API 고쳐 줘', at: 100 },
    { t: 4, kind: 'tool', text: 'Bash npm test' },
    { t: 5, kind: 'text', text: '중간 보고' },
    { t: 6, kind: 'text', text: '**부분 환불을 넣었습니다.** 테스트 통과\n\n- 자세히' },
  ]);
  assert.deepEqual(r, { asks: [{ t: 3, text: '부분 환불도 되게 환불 API 고쳐 줘', at: 100 }], answer: { t: 6, text: '부분 환불을 넣었습니다. 테스트 통과' } });
});

test('짧은 말이면 그 앞 말도 — / 명령 · 런 재촉은 시킨 말이 아니다', () => {
  const r = lastAsks([
    { t: 1, kind: 'user', text: '부분 환불도 되게 환불 API 고쳐 줘' },
    { t: 2, kind: 'text', text: '고칠까요?' },
    { t: 3, kind: 'user', text: '/compact' },
    { t: 4, kind: 'user', text: '응 해줘' },
    { t: 5, kind: 'user', text: '결과 파일(/x/result.json)을 아직 쓰지 않았다.' },
  ]);
  assert.deepEqual(r.asks.map(a => a.text), ['부분 환불도 되게 환불 API 고쳐 줘', '응 해줘']);
  assert.equal(r.answer, undefined);   // 마지막 말 뒤에 답이 아직 없다
});

test('다른 세션이 보낸 말도 시킨 말 — 보낸 세션 이름과 함께', () => {
  const r = lastAsks([{ t: 1, kind: 'peer', text: '끝난 거면 커밋해 줘', from: 'main' }]);
  assert.deepEqual(r.asks, [{ t: 1, text: '끝난 거면 커밋해 줘', from: 'main' }]);
  assert.deepEqual(lastAsks([{ t: 1, kind: 'text', text: '안녕' }]), { asks: [] });
});

test('붙여 넣은 글은 꼬리표를 벗긴다', () => {
  const r = lastAsks([{ t: 1, kind: 'user', text: '<pasted_content id="ab12">\n배포 목록 고쳐 줘\n</pasted_content>' }]);
  assert.equal(r.asks[0].text, '배포 목록 고쳐 줘');
});

test('답 첫 줄 — 머리 · 목록 표시를 벗기고 빈 줄은 건너뛴다', () => {
  assert.equal(firstLine('\n## 결론\n본문'), '결론');
  assert.equal(firstLine('- `a.ts` 고침'), 'a.ts 고침');
});
