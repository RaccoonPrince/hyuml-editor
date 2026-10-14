export type NodeId = string;
export type EdgeId = string;

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

/** 원본 소스 문자열 기준 [start, end) 오프셋 */
export interface SourceRange { start: number; end: number }

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  message: string;
  range: SourceRange;
  severity: Severity;
  source?: 'parser' | 'mermaid' | 'app';
}

/** 소스에 적용할 최소 편집 단위. 모든 캔버스 → 코드 경로는 이것만 생성한다. */
export interface TextEdit { start: number; end: number; text: string }

export type Side = 'top' | 'right' | 'bottom' | 'left';
export type Direction = 'TB' | 'BT' | 'LR' | 'RL';
