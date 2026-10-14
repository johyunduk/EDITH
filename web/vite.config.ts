// 개발: npm --prefix web run dev — /api 는 `edith`(4320)로 넘긴다. 배포: build → web/dist 를 serve 가 준다.
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const TARGET = 'http://127.0.0.1:4320';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': {
        // changeOrigin — 서버가 Host 머리를 127.0.0.1:4320 으로만 받는다.
        // 서버는 쓰기(POST)를 같은 출처(4320)에서 온 것만 받으니, 이 개발 서버(127.0.0.1·localhost)에서 온 것만 출처를 바꿔 넘긴다.
        target: TARGET, changeOrigin: true,
        configure: proxy => proxy.on('proxyReq', (req, from) => {
          if (/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(from.headers.origin ?? '')) req.setHeader('origin', TARGET);
        }),
      },
    },
  },
});
