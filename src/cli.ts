#!/usr/bin/env node
// EDITH — herdr 의 Claude Code·Codex pane 을 브라우저에서 보고 다루는 화면 서버.
const USAGE = `사용: edith serve [--port N]   화면 서버(127.0.0.1, 기본 4320) — 먼저 npm run build`;

const [cmd, ...args] = process.argv.slice(2);
if (cmd !== 'serve') { console.log(USAGE); process.exit(cmd ? 2 : 0); }
const i = args.indexOf('--port'), port = i >= 0 ? Number(args[i + 1]) : 4320;
if (!Number.isInteger(port) || port <= 0 || port > 65535) { console.error('--port 는 1~65535'); process.exit(1); }
(await import('./server.ts')).serve(port);
