import { useEffect, useRef } from 'react';
import MonacoEditor from '@monaco-editor/react';
import type { OnMount } from '@monaco-editor/react';
import { useShallow } from 'zustand/react/shallow';
import { offsetToLineColumn } from '../../core/text';
import type { Diagnostic } from '../../core/types';
import { registerEditorBridge } from '../../store/editorBridge';
import { useDiagramStore } from '../../store/useDiagramStore';

type EditorInstance = Parameters<OnMount>[0];
type MonacoInstance = Parameters<OnMount>[1];

const MARKER_OWNER = 'hyuml';

export function CodeEditor() {
  const { source, diagnostics, isDarkMode } = useDiagramStore(useShallow((s) => ({
    source: s.doc.source,
    diagnostics: s.diagnostics,
    isDarkMode: s.isDarkMode,
  })));
  const editorRef = useRef<EditorInstance | null>(null);
  const monacoRef = useRef<MonacoInstance | null>(null);
  const unregisterRef = useRef<(() => void) | null>(null);

  useEffect(() => () => unregisterRef.current?.(), []);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    unregisterRef.current?.();
    unregisterRef.current = registerEditorBridge({
      applyEdits: (edits) => {
        const model = editor.getModel();
        if (!model) return;
        const operations = edits.map((edit) => {
          const start = model.getPositionAt(edit.start);
          const end = model.getPositionAt(edit.end);
          return {
            range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
            text: edit.text,
            forceMoveMarkers: true,
          };
        });
        editor.pushUndoStop();
        editor.executeEdits('canvas', operations);
        editor.pushUndoStop();
      },
    });
    applyMarkers(useDiagramStore.getState().diagnostics);
  };

  const applyMarkers = (items: Diagnostic[]) => {
    const monaco = monacoRef.current;
    const model = editorRef.current?.getModel();
    if (!monaco || !model) return;
    const text = model.getValue();
    monaco.editor.setModelMarkers(model, MARKER_OWNER, items.map((item) => {
      const start = offsetToLineColumn(text, item.range.start);
      const end = offsetToLineColumn(text, Math.max(item.range.end, item.range.start + 1));
      return {
        message: item.message,
        severity: item.severity === 'error' ? monaco.MarkerSeverity.Error
          : item.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info,
        startLineNumber: start.line,
        startColumn: start.column,
        endLineNumber: end.line,
        endColumn: end.column,
      };
    }));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- applyMarkers 는 ref 만 읽는다
  useEffect(() => { applyMarkers(diagnostics); }, [diagnostics, source]);

  const revealDiagnostic = (item: Diagnostic) => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    const position = model.getPositionAt(item.range.start);
    editor.revealLineInCenter(position.lineNumber);
    editor.setPosition(position);
    editor.focus();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <MonacoEditor
          language="mermaid"
          theme={isDarkMode ? 'vs-dark' : 'light'}
          value={source}
          onMount={handleMount}
          onChange={(value) => {
            // 캔버스 편집/Undo 로 Store 가 먼저 바뀐 경우 이미 반영된 값이므로 무시
            const next = value ?? '';
            if (next !== useDiagramStore.getState().doc.source) useDiagramStore.getState().setSource(next);
          }}
          options={{ minimap: { enabled: false }, fontSize: 14, wordWrap: 'on', scrollBeyondLastLine: false, automaticLayout: true }}
        />
      </div>
      {diagnostics.length > 0 && (
        <ul
          aria-label="진단"
          style={{
            listStyle: 'none', margin: 0, padding: 6, maxHeight: 140, overflowY: 'auto', fontSize: 12,
            borderTop: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`, background: isDarkMode ? '#1e1e1e' : '#fafafa',
          }}
        >
          {diagnostics.slice(0, 50).map((item, index) => (
            <li key={`${item.range.start}-${index}`}>
              <button
                type="button"
                onClick={() => revealDiagnostic(item)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer',
                  padding: '2px 4px', font: 'inherit',
                  color: item.severity === 'error' ? '#dc2626' : item.severity === 'warning' ? '#b45309' : (isDarkMode ? '#d1d5db' : '#374151'),
                }}
              >
                {item.severity === 'error' ? '⛔' : item.severity === 'warning' ? '⚠️' : 'ℹ️'} {offsetToLineColumn(source, item.range.start).line}행: {item.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
