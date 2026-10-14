import { useEffect, useRef } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { themeOf } from '../core/theme';
import { useDiagramStore } from '../store/useDiagramStore';
import { FlowCanvas } from './canvas/FlowCanvas';
import { CodeEditor } from './editor/CodeEditor';
import { ErrorBoundary } from './ErrorBoundary';
import { Toast } from './Toast';
import { Toolbar } from './Toolbar';

/** 레이아웃 셸: 코드 창 | 스플리터 | 캔버스. 로직은 Store/코어에 있고 여기서는 배치만 한다. */
export default function DiagramEditor() {
  const { isDarkMode, editorWidth, isEditorVisible } = useDiagramStore(useShallow((s) => ({
    isDarkMode: s.isDarkMode, editorWidth: s.editorWidth, isEditorVisible: s.isEditorVisible,
  })));
  const resizing = useRef(false);
  const theme = themeOf(isDarkMode);

  useEffect(() => { void useDiagramStore.getState().commitNow(); }, []);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (resizing.current) useDiagramStore.getState().setEditorWidth(event.clientX);
    };
    const onUp = () => { resizing.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isEditorVisible ? `${editorWidth}px 5px minmax(0, 1fr)` : 'minmax(0, 1fr)',
      width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden',
    }}>
      {isEditorVisible && (
        <>
          <div style={{ minWidth: 0, minHeight: 0, overflow: 'hidden', borderRight: `1px solid ${isDarkMode ? '#374151' : '#ddd'}` }}>
            <ErrorBoundary name="코드 에디터">
              <CodeEditor />
            </ErrorBoundary>
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="코드 창 너비 조절"
            onMouseDown={(event) => {
              event.preventDefault();
              resizing.current = true;
            }}
            style={{ cursor: 'col-resize', background: isDarkMode ? '#374151' : '#d1d5db' }}
          />
        </>
      )}
      <div id="canvas-root" style={{ position: 'relative', minWidth: 0, minHeight: 0, overflow: 'hidden', background: theme.canvasBg }}>
        <ReactFlowProvider>
          <ErrorBoundary name="캔버스">
            <Toolbar />
            <FlowCanvas />
          </ErrorBoundary>
        </ReactFlowProvider>
        <div aria-hidden="true" className="hy-no-export" style={{
          position: 'absolute', right: 18, bottom: 14, zIndex: 5, color: theme.watermark, opacity: 0.42,
          fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', pointerEvents: 'none', userSelect: 'none',
        }}>
          DKU Software
        </div>
        <Toast />
      </div>
    </div>
  );
}
