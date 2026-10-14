import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMachines } from './machines.ts';

test('machines.json — 문자열·객체 둘 다, 틀린 항목은 빼도 포트 순서는 그대로', () => {
  const m = parseMachines(JSON.stringify({ 회사: 'work-mac', 나쁨: '-oProxyCommand=x', 집: { ssh: 'me@home.ts.net', port: 4400 } }));
  assert.deepEqual(m, [
    { name: '회사', ssh: 'work-mac', port: 4320, local: 4321 },
    { name: '집', ssh: 'me@home.ts.net', port: 4400, local: 4323 },
  ]);
  assert.deepEqual(parseMachines('[]'), []);
  assert.deepEqual(parseMachines('깨진 글'), []);
});

test('Host 머리 — 127.0.0.1·localhost 면 포트는 상관없이(SSH 터널), 다른 이름은 거절', async () => {
  const { hostPort } = await import('./server.ts');
  assert.equal(hostPort('127.0.0.1:4321'), '4321');
  assert.equal(hostPort('localhost:4320'), '4320');
  for (const h of ['evil.com:4320', '127.0.0.1', '127.0.0.1.evil.com:4320', undefined]) assert.equal(hostPort(h), null);
});

test('machines.json 에 넣기 — 새 기기는 문자열, 있던 기기는 자리·port 를 두고 대상만 바꾼다', async () => {
  const { withMachine, parsePeers } = await import('./machines.ts');
  assert.equal(withMachine('', '회사', 'me@work'), '{\n  "회사": "me@work"\n}\n');
  const t = withMachine(JSON.stringify({ 집: 'a@home', 회사: { ssh: 'old@work', port: 4400 } }), '회사', 'me@work');
  assert.deepEqual(JSON.parse(t), { 집: 'a@home', 회사: { ssh: 'me@work', port: 4400 } });
  assert.deepEqual(parsePeers(JSON.stringify({ Peer: { k: { HostName: 'work-mac', DNSName: 'work-mac.tail1.ts.net.', OS: 'macOS', Online: true } } })),
    [{ host: 'work-mac', dns: 'work-mac.tail1.ts.net', os: 'macOS', online: true }]);
});
