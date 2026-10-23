// 실시간 화면 — 런이 띄운 브라우저(엔진이 작업 문서에 남긴 edith-live.json {"port": <CDP 포트>})에서 화면을 받아 MJPEG 로 넘긴다.
// 보는 사람이 있는 동안만 붙는다. 페이지가 바뀌면 새 페이지로 옮겨 붙고, 30초 동안 브라우저가 없으면 끝낸다.
// 이 기기(127.0.0.1)의 포트에만 붙는다 — 브라우저가 알려 준 웹소켓 주소도 호스트를 127.0.0.1 로 바꿔 쓴다.
import { readFileSync, realpathSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export const LIVE_FILE = 'edith-live.json';

// 작업 문서 안의 edith-live.json 에서 포트(1024~65535) — 없거나 틀렸거나 링크로 밖을 가리키면 null
export function livePort(work: string): number | null {
  try {
    const f = realpathSync(join(work, LIVE_FILE));
    if (!f.startsWith(realpathSync(work) + sep)) return null;
    const p = (JSON.parse(readFileSync(f, 'utf8')) as { port?: unknown }).port;
    return Number.isInteger(p) && (p as number) >= 1024 && (p as number) <= 65535 ? p as number : null;
  } catch { return null; }
}

type Target = { type?: string; url?: string; webSocketDebuggerUrl?: string };
// 화면이 있는 페이지 — DevTools 는 빼고, 빈 페이지보다 주소가 있는 것을 먼저
export const pickPage = (list: Target[]) => {
  const pages = list.filter(t => t.type === 'page' && t.webSocketDebuggerUrl && !String(t.url).startsWith('devtools://'));
  return pages.find(t => t.url !== 'about:blank') ?? pages[0];
};

export async function stream(req: IncomingMessage, res: ServerResponse, port: number) {
  let closed = false, started = false;
  req.on('close', () => { closed = true; });
  let idle = Date.now();
  while (!closed && Date.now() - idle < 30_000) {
    const list = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) }).then(r => r.json() as Promise<Target[]>).catch(() => [] as Target[]);
    const page = Array.isArray(list) ? pickPage(list) : undefined;
    if (!page) { if (!started) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('지금 화면을 보낼 브라우저가 없다'); return; } await sleep(1000); continue; }
    if (!started) { res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=frame', 'cache-control': 'no-store' }); started = true; }
    idle = Date.now();
    await new Promise<void>(done => {
      let ws: WebSocket;
      try { ws = new WebSocket(`ws://127.0.0.1:${port}${new URL(page.webSocketDebuggerUrl!).pathname}`); } catch { done(); return; }
      let id = 0;
      const send = (method: string, params: object = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
      const stop = () => { try { ws.close(); } catch { /* 이미 닫힘 */ } done(); };
      req.once('close', stop);
      ws.onopen = () => send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 900 });
      ws.onmessage = e => {
        const m = JSON.parse(String(e.data)) as { method?: string; params?: { data: string; sessionId: number } };
        if (m.method !== 'Page.screencastFrame' || !m.params) return;
        const jpg = Buffer.from(m.params.data, 'base64');
        res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpg.length}\r\n\r\n`);
        res.write(jpg);
        res.write('\r\n');
        send('Page.screencastFrameAck', { sessionId: m.params.sessionId });
      };
      ws.onclose = () => { req.off('close', stop); done(); };
      ws.onerror = () => stop();
    });
    // 페이지가 닫혀 끊겼으면 잠깐 쉬고 다음 페이지를 찾는다(바로 다시 돌면 목록 요청이 몰린다)
    if (!closed) await sleep(500);
  }
  if (!res.writableEnded) res.end();
}
