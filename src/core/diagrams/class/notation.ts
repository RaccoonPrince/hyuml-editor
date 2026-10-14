import type { EndKind, LineStyle, RelationEdge, UmlRelationType } from './model';

/**
 * UML 표기 규칙은 전부 이 파일에만 둔다.
 * 파서(토큰 → 의미), 레이아웃(계층 방향·가중치), 렌더러(마커 모양)가 모두 여기를 참조한다.
 */

export const LEFT_END_TOKENS: Record<string, EndKind> = {
  '<|': 'triangle', '*': 'diamondFilled', o: 'diamondHollow', '<': 'arrow', '()': 'lollipop',
};
export const RIGHT_END_TOKENS: Record<string, EndKind> = {
  '|>': 'triangle', '*': 'diamondFilled', o: 'diamondHollow', '>': 'arrow', '()': 'lollipop',
};

export interface RelationSemantics {
  relationType: UmlRelationType;
  parentEnd?: 'source' | 'target';
}

const RANK: EndKind[] = ['triangle', 'diamondFilled', 'diamondHollow', 'lollipop', 'arrow', 'cross'];

export function classifyRelation(ends: RelationEdge['ends'], line: LineStyle): RelationSemantics {
  // 양 끝 중 의미가 더 강한 쪽이 관계 종류를 결정한다.
  const dominant = RANK.find((kind) => ends.source === kind || ends.target === kind);
  const side = dominant === undefined ? undefined : ends.source === dominant ? 'source' : 'target';
  switch (dominant) {
    case 'triangle':
      return { relationType: line === 'dotted' ? 'implementation' : 'inheritance', parentEnd: side };
    case 'diamondFilled':
      return { relationType: 'composition', parentEnd: side };
    case 'diamondHollow':
      return { relationType: 'aggregation', parentEnd: side };
    case 'lollipop':
      return { relationType: 'lollipop' };
    case 'arrow':
    case 'cross':
      // 화살표가 가리키는 쪽이 아래(피참조)로 간다 → 반대편이 parent.
      return {
        relationType: line === 'dotted' ? 'dependency' : 'association',
        parentEnd: side === 'source' ? 'target' : 'source',
      };
    default:
      return { relationType: line === 'dotted' ? 'dependency' : 'association' };
  }
}

/** 레이아웃 엔진 가중치: 계층 관계일수록 수직 정렬을 강하게 유지 */
export function relationWeight(type: UmlRelationType): number {
  switch (type) {
    case 'inheritance':
    case 'implementation':
      return 5;
    case 'composition':
      return 3;
    case 'aggregation':
      return 2;
    case 'association':
      return 1.5;
    default:
      return 1;
  }
}

export interface MarkerShape {
  /** viewBox 0 0 W H 기준 path. 끝점(tip)은 항상 (W, H/2) */
  path: string;
  width: number;
  height: number;
  /** 'stroke' = 선 색으로 채움, 'background' = 배경색으로 채움(속 빈 모양), 'none' = 열린 선 */
  fill: 'stroke' | 'background' | 'none';
}

export function markerShape(kind: EndKind): MarkerShape | undefined {
  switch (kind) {
    case 'arrow':
      return { path: 'M 1 1 L 13 7 L 1 13', width: 14, height: 14, fill: 'none' };
    case 'triangle':
      return { path: 'M 1 1 L 17 9 L 1 17 Z', width: 18, height: 18, fill: 'background' };
    case 'diamondFilled':
      return { path: 'M 1 7 L 10 1 L 19 7 L 10 13 Z', width: 20, height: 14, fill: 'stroke' };
    case 'diamondHollow':
      return { path: 'M 1 7 L 10 1 L 19 7 L 10 13 Z', width: 20, height: 14, fill: 'background' };
    case 'lollipop':
      return { path: 'M 13 7 m -6 0 a 6 6 0 1 0 12 0 a 6 6 0 1 0 -12 0', width: 20, height: 14, fill: 'background' };
    case 'cross':
      return { path: 'M 3 2 L 13 12 M 3 12 L 13 2', width: 14, height: 14, fill: 'none' };
    default:
      return undefined;
  }
}

/** 끝점 라벨이 마커와 겹치지 않도록 확보해야 하는 거리 */
export function markerClearance(kind: EndKind): number {
  return (markerShape(kind)?.width ?? 0) + 6;
}
