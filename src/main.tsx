import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

const container = document.getElementById('root');
if (!container) throw new Error('#root 요소를 찾을 수 없습니다. index.html 을 확인하세요.');

// 이벤트 핸들러·비동기 코드의 예외는 ErrorBoundary 가 잡지 못하므로 전역에서 기록한다
window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandledrejection]', event.reason);
});

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// 개발 서버 전용: e2e 스크립트(e2e/run.mjs)가 상태를 읽고 검증할 수 있도록 스토어를 노출한다. 프로덕션 빌드에서는 제거된다.
if (import.meta.env.DEV) {
  void import('./store/useDiagramStore').then((m) => { (window as unknown as { __hyuml: unknown }).__hyuml = m.useDiagramStore; });
}
