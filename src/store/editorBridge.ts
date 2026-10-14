import type { TextEdit } from '../core/types';

/**
 * Store → Monaco 최소 편집 전달 통로.
 * 캔버스에서 이름을 바꾸면 전체 텍스트를 갈아끼우지 않고 해당 범위만 편집해
 * 커서 위치와 Monaco 자체 Undo 스택을 보존한다.
 */
export interface EditorBridge {
  applyEdits: (edits: readonly TextEdit[]) => void;
}

let current: EditorBridge | null = null;

export function registerEditorBridge(bridge: EditorBridge): () => void {
  current = bridge;
  return () => {
    if (current === bridge) current = null;
  };
}

export const getEditorBridge = () => current;
