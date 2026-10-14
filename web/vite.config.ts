// 개발: npm --prefix web run dev — /api 는 `edith`(4320)로 넘긴다. 배포: build → web/dist 를 serve 가 준다.
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  // changeOrigin — 서버가 Host 머리를 127.0.0.1:4320 으로만 받는다
  server: { host: '127.0.0.1', proxy: { '/api': { target: 'http://127.0.0.1:4320', changeOrigin: true } } },
});
