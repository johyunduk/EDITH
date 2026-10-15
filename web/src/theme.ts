// 앱 이름은 테마와 분리한다. 템플릿으로 만든 앱은 이 값만 바꾼다.
export const APP_NAME = 'EDITH';

// 색·질감은 index.css에 둬 화면 컴포넌트를 복사하지 않는다.
// desc·swatch(바탕·카드·강조색)는 설정 화면의 고르기 칸에만 쓴다 — 고르기 전 테마는 CSS 변수로 그릴 수 없어서
export const THEMES = {
  edith: { label: 'EDITH', dark: false, desc: '밝은 화면 · 청록', swatch: ['oklch(0.985 0.005 215)', 'oklch(1 0 0)', 'oklch(0.62 0.115 212)'] },
  ultron: { label: 'ULTRON', dark: true, desc: '어두운 화면 · 붉은 빛', swatch: ['#100e13', '#1b181f', '#ef5266'] },
} as const;
export type Theme = keyof typeof THEMES;
export const DEFAULT_THEME: Theme = 'edith';
// 예전 이름(daylight·neural)으로 저장된 값도 이어 받는다
const LEGACY: Record<string, Theme> = { daylight: 'edith', neural: 'ultron' };

export function parseTheme(value: string | null): Theme {
  if (value && Object.hasOwn(LEGACY, value)) return LEGACY[value];
  return Object.hasOwn(THEMES, value ?? '') ? value as Theme : DEFAULT_THEME;
}

// 저장소가 막혀 있어도 테마를 선택하고 화면을 사용할 수 있다.
export function readTheme(): Theme {
  try { return parseTheme(localStorage.getItem('edith.theme')); } catch { return DEFAULT_THEME; }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('dark', THEMES[theme].dark);
  try { localStorage.setItem('edith.theme', theme); } catch { /* 저장 없이 현재 화면에 적용 */ }
}
