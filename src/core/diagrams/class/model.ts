import type { Direction, EdgeId, NodeId, SourceRange } from '../../types';
import type { DiagramGroup } from '../groups';

export type MemberKind = 'attribute' | 'method';
export type Classifier = 'static' | 'abstract' | undefined;

export interface ClassMember {
  /** 스타일 키 등에 쓰는 안정 키. 순서가 아닌 내용 기반: `a:<text>` / `m:<text>` (+ 중복 시 `#n`) */
  key: string;
  kind: MemberKind;
  /** 소스에 쓰인 그대로의 텍스트 (classifier 기호 포함) */
  text: string;
  /** 화면 표시용: classifier 기호 제거 + 제네릭 ~T~ → <T> */
  display: string;
  classifier: Classifier;
  /** text 가 차지하는 소스 범위 — 편집은 이 범위만 교체한다 */
  range: SourceRange;
  /** 멤버가 한 줄을 단독으로 차지할 때 그 줄 전체 범위(개행 포함) — 삭제용 */
  lineRange?: SourceRange;
}

export interface ClassNodeModel {
  id: NodeId;
  /** 화면 표시 이름: 명시 라벨 > 이름<제네릭> */
  label: string;
  generic?: string;
  stereotype?: string;
  attributes: ClassMember[];
  methods: ClassMember[];
  /** 이 클래스를 가리키는 모든 식별자 위치 (선언, 관계 끝, `X : member`, 어노테이션 …) */
  refs: SourceRange[];
  /** `class X["Label"]` 의 Label 텍스트 범위 */
  labelRange?: SourceRange;
  /** 첫 `class X` 선언의 식별자 끝 위치 — 라벨 삽입 지점 */
  declIdEnd?: number;
}

/** 관계 끝 모양. Mermaid 토큰과 1:1 대응 — notation.ts 참고 */
export type EndKind = 'none' | 'arrow' | 'triangle' | 'diamondFilled' | 'diamondHollow' | 'lollipop' | 'cross';
export type LineStyle = 'solid' | 'dotted';

export type UmlRelationType =
  | 'inheritance'
  | 'implementation'
  | 'composition'
  | 'aggregation'
  | 'dependency'
  | 'association'
  | 'lollipop';

export interface RelationEdge {
  id: EdgeId;
  source: NodeId;
  target: NodeId;
  ends: { source: EndKind; target: EndKind };
  line: LineStyle;
  relationType: UmlRelationType;
  /**
   * 계층상 "위"에 와야 하는 끝. 상속/실현의 부모(삼각형 쪽), 합성/집합의 전체(다이아몬드 쪽).
   * 없으면 방향성 없는 관계 → source 를 위로 둔다.
   */
  parentEnd?: 'source' | 'target';
  sourceLabel?: string;
  targetLabel?: string;
  label?: string;
  /** 편집 불가 고정 라벨 (유스케이스 «include» / «extend») */
  stereotype?: string;
  /** 관계 줄 전체 범위 */
  range: SourceRange;
  /** `: label` 의 label 텍스트 범위 */
  labelRange?: SourceRange;
  /** 라벨 절(앞 공백 + ':' + label) 전체 범위 — 라벨 삭제용 */
  labelClauseRange?: SourceRange;
}

export interface ClassModel {
  kind: 'class';
  direction: Direction;
  nodes: ClassNodeModel[];
  edges: RelationEdge[];
  /** namespace 블록 */
  groups: DiagramGroup[];
}

export const allMembers = (node: ClassNodeModel): ClassMember[] => [...node.attributes, ...node.methods];

export function findMember(node: ClassNodeModel, key: string): ClassMember | undefined {
  return node.attributes.find((member) => member.key === key) ?? node.methods.find((member) => member.key === key);
}

/** Mermaid 제네릭 표기(~T~) ↔ 화면 표기(<T>) */
export const genericToDisplay = (text: string) => text.replace(/~([^~]*)~/g, '<$1>');
export const genericToSource = (text: string) => text.replace(/<([^<>]*)>/g, '~$1~');
