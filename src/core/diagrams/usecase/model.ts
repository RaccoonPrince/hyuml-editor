import type { Direction, NodeId, SourceRange } from '../../types';
import type { RelationEdge } from '../class/model';
import type { DiagramGroup } from '../groups';

export type UsecaseNodeType = 'actor' | 'usecase';

export interface UsecaseNode {
  id: NodeId;
  label: string;
  type: UsecaseNodeType;
  /** `Id[label]` 은 사각형, 그 외(`Id(label)`, `Id`)는 타원 */
  shape: 'ellipse' | 'rect';
  stereotype?: string;
  /** 이름을 가리키는 모든 위치 (따옴표 이름이면 따옴표 안쪽) */
  refs: SourceRange[];
  /** `Id(label)` / `Id[label]` 의 label 범위 */
  labelRange?: SourceRange;
  /** 첫 등장 위치의 식별자 끝 — 라벨 `(…)` 삽입 지점 */
  declIdEnd?: number;
  /** 따옴표 이름("…")으로 선언됨 → 이름 자체가 표시 라벨 */
  quoted: boolean;
}

/** 관계 화살표 토큰 — 라벨을 붙이거나 뗄 때 `-- label -->` 형태로 다시 쓰기 위해 보관 */
export interface UsecaseEdge extends RelationEdge {
  arrowRange: SourceRange;
  /** '<--' | 'o--' | 'x--' | '--' */
  leftToken: string;
  /** '-->' | '--o' | '--x' | '--' */
  rightToken: string;
  /** include / extend / generalization — Mermaid 문법상 라벨을 붙일 수 없다 */
  semantic: boolean;
}

export interface UsecaseModel {
  kind: 'usecase';
  direction: Direction;
  nodes: UsecaseNode[];
  edges: UsecaseEdge[];
  /** systemBoundary 블록 */
  groups: DiagramGroup[];
}
