import type { TextEdit } from './types';

/** 겹치지 않는 편집들을 뒤에서부터 적용한다. 겹치면 throw — 호출부 버그를 조용히 삼키지 않는다. */
export function applyTextEdits(source: string, edits: readonly TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let result = source;
  let lastStart = Number.POSITIVE_INFINITY;
  for (const edit of sorted) {
    if (edit.start < 0 || edit.end > source.length || edit.start > edit.end) {
      throw new Error(`Invalid text edit range [${edit.start}, ${edit.end})`);
    }
    if (edit.end > lastStart) throw new Error('Overlapping text edits');
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    lastStart = edit.start;
  }
  return result;
}

/** 오프셋 → 1-based 줄/열 (Monaco 마커 등에 사용) */
export function offsetToLineColumn(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  const end = Math.min(offset, source.length);
  for (let index = 0; index < end; index += 1) {
    if (source.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: end - lineStart + 1 };
}

export function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}
