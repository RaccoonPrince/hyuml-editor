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
