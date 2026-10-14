import type { NodeId, Rect, SourceRange } from '../types';

/**
 * 그룹 = 여러 도형을 묶는 상위 상자 (명세 FR-14·15).
 *   class    → namespace Name { … }
 *   sequence → box Label … end
 *   usecase  → systemBoundary Id[Label] … end
 * 그룹 상자 위치·크기는 저장하지 않고 항상 구성원 도형으로부터 계산한다.
 */
export interface DiagramGroup {
  id: string;
  label: string;
  members: NodeId[];
  /** 이름/라벨 텍스트 범위 (없으면 식별자 범위) */
  labelRange?: SourceRange;
  /** 여는 줄 전체(개행 포함) — 그룹 해제 시 삭제 */
  headerLineRange: SourceRange;
  /** 닫는 줄 전체(개행 포함) */
  endLineRange?: SourceRange;
  /** sequence box 의 색상 */
  color?: string;
}

export const GROUP_PAD = { x: 18, top: 34, bottom: 18 } as const;

/** 구성원 도형들을 감싸는 그룹 상자 */
export function groupBounds(members: readonly Rect[]): Rect | undefined {
  if (members.length === 0) return undefined;
  const minX = Math.min(...members.map((rect) => rect.x)) - GROUP_PAD.x;
  const minY = Math.min(...members.map((rect) => rect.y)) - GROUP_PAD.top;
  const maxX = Math.max(...members.map((rect) => rect.x + rect.w)) + GROUP_PAD.x;
  const maxY = Math.max(...members.map((rect) => rect.y + rect.h)) + GROUP_PAD.bottom;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

