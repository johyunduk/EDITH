import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import './index.css';
import { applyTheme, readTheme } from './theme.ts';

// 첫 화면부터 저장된 테마를 적용해 밝은 화면이 잠깐 비치지 않게 한다.
applyTheme(readTheme());
const qc = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}><App /></QueryClientProvider>
  </StrictMode>,
);
