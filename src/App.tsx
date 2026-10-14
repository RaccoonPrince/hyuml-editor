import DiagramEditor from './ui/DiagramEditor';
import { ErrorBoundary } from './ui/ErrorBoundary';

function App() {
  return (
    <div style={{ width: '100vw', height: '100vh', padding: 20, overflow: 'hidden', backgroundColor: '#eef2f6' }}>
      <div style={{ width: '100%', height: '100%', overflow: 'hidden', borderRadius: 12, boxShadow: '0 8px 24px rgba(15, 42, 68, 0.16)', backgroundColor: '#fff' }}>
        <ErrorBoundary name="편집기">
          <DiagramEditor />
        </ErrorBoundary>
      </div>
    </div>
  );
}

export default App;
