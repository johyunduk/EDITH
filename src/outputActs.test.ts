import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { formOf, jobOf, parseForm, parseStart, readLine, startJob, stopJob, type Job } from './outputActs.ts';

test('띠 읽기 — 모르는 id 는 고른 것 · 빠른 고르기 · for 에서 뺀다, 칸은 key 가 있을 때만', () => {
  const f = parseForm(JSON.stringify({
    pick: { label: '시나리오', items: [{ id: '1', label: '하나' }, { id: '2', label: '둘' }, { id: 'a b', label: '빈칸 있는 id' }], quick: [{ label: '실패한 것', ids: ['2', '9'] }], selected: ['1', '9'] },
    rows: [{ group: '데이터', label: '사용자 A', text: '[시험]사용자1', src: '설정에서', for: ['1', '7'] }, { group: '데이터', label: '사용자 B', key: 'B', value: '홍길동', placeholder: '이름' }, { label: '' }],
    note: 'dev 에 저장한다', each: { sec: 30, usd: 0.04 }, start: '재생 시작',
  }));
  assert.deepEqual(f.pick?.items.map(x => x.id), ['1', '2']);
  assert.deepEqual(f.pick?.quick, [{ label: '실패한 것', ids: ['2'] }]);
  assert.deepEqual(f.pick?.selected, ['1']);
  assert.deepEqual(f.rows.map(r => [r.label, r.key ?? null, r.for ?? null]), [['사용자 A', null, ['1']], ['사용자 B', 'B', null]]);
  assert.deepEqual(f.each, { sec: 30, usd: 0.04 });
  assert.throws(() => parseForm('없음'), /띠 JSON/);
});

test('띠 읽기 — 고르기 칸 값은 그 선택지 중 하나(아니면 첫 것), when 은 칸 이름 꼴만', () => {
  const f = parseForm(JSON.stringify({ rows: [
    { label: '어디서', key: 'where', value: 'moon', options: [{ value: 'local', label: '로컬' }, { value: 'dev', label: 'dev' }, { value: 'a b', label: '빈칸' }] },
    { label: '시드', text: '두 개', when: { key: 'where', value: 'local' } },
    { label: '이상한 조건', text: 'x', when: { key: 'a b', value: 'local' } },
    { label: '칸 없는 선택지', options: [{ value: 'x', label: 'x' }] },
  ] }));
  assert.deepEqual(f.rows[0].options?.map(o => o.value), ['local', 'dev']);
  assert.equal(f.rows[0].value, 'local');
  assert.deepEqual(f.rows[1].when, { key: 'where', value: 'local' });
  assert.equal(f.rows[2].when, undefined);
  assert.equal(f.rows[3].options, undefined, 'key 가 없으면 선택지도 없다');
});

test('시작 값 — id 꼴 · 칸 이름이 맞는 것만, 너무 긴 값은 거절', () => {
  assert.deepEqual(parseStart({ ids: ['1', 'x y', 3], values: { B: ' 홍길동 ', 'a b': 'x', C: 1 } }), { ids: ['1'], values: { B: '홍길동' } });
  assert.deepEqual(parseStart(null), { ids: [], values: {} });
  assert.throws(() => parseStart({ values: { B: 'x'.repeat(501) } }), /너무 길거나/);
});

test('출력 줄 — 진행 JSON 은 진행 줄로, 나머지는 마지막 줄로', () => {
  const j: Job = { label: 'l', at: 0, state: 'running' };
  readLine(j, '{"progress":"5번 · 2/3단계","ratio":0.66}');
  assert.equal(j.progress, '5번 · 2/3단계'); assert.equal(j.ratio, 0.66);
  readLine(j, '{"progress":"6번","ratio":7}');
  assert.equal(j.ratio, undefined, '0~1 밖이면 버린다');
  readLine(j, '{"다른":"json"}'); readLine(j, '오류: 없음');
  assert.equal(j.last, '오류: 없음');
});

const hook = (command: string) => ({ dir: mkdtempSync(join(tmpdir(), 'oact-')), action: { label: '재생', command } });
const until = async (f: () => boolean) => { for (let n = 0; n < 100 && !f(); n++) await sleep(30); };

test('띠 명령 — form 모드 · 값은 환경 변수로, 실패하면 오류 마지막 줄', async () => {
  const f = await formOf(hook('test "$EDITH_OUTPUT_MODE" = form && echo "{\\"rows\\":[{\\"label\\":\\"$EDITH_OUTPUT_FILE\\"}]}"'), { EDITH_OUTPUT_FILE: '/x/dev-guide.html' });
  assert.equal(f.rows[0].label, '/x/dev-guide.html');
  await assert.rejects(formOf(hook('echo 첫 줄 >&2; echo 못 찾음 >&2; exit 3'), {}), /끝 코드 3 — 못 찾음/);
});

test('시작 · 진행 · 끝 — 표준 입력으로 값, 같은 산출물은 하나만, 멈추기', async () => {
  const h = hook('read -r line; echo "{\\"progress\\":\\"받음 ${#line}자\\"}"; sleep 0.2; echo 끝');
  const j = startJob(h, 9001, 0, {}, { ids: ['1'], values: {} });
  assert.equal(j.state, 'running');
  assert.throws(() => startJob(h, 9001, 0, {}, { ids: [], values: {} }), /이미 도는 중/);
  await until(() => jobOf(9001, 0)?.state !== 'running');
  const done = jobOf(9001, 0)!;
  assert.equal(done.state, 'done');
  assert.equal(done.progress, `받음 ${JSON.stringify({ ids: ['1'], values: {} }).length}자`);
  assert.equal(done.last, '끝');
  assert.match(readFileSync(join(process.env.HOME!, '.local/share/edith/output-acts/9001-0.log'), 'utf8'), /끝/);

  startJob(hook('sleep 5'), 9001, 1, {}, { ids: [], values: {} });
  stopJob(9001, 1);
  await until(() => jobOf(9001, 1)?.state !== 'running');
  assert.equal(jobOf(9001, 1)?.state, 'stopped');
  assert.throws(() => stopJob(9001, 1), /도는 중이 아니다/);
  for (const n of [0, 1]) rmSync(join(process.env.HOME!, `.local/share/edith/output-acts/9001-${n}.log`), { force: true });
});
