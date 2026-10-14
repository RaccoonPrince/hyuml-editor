import type { Edge, Node } from '@xyflow/react';
import type { ClassNodeModel, RelationEdge } from '../core/diagrams/class/model';
import type { DiagramGroup } from '../core/diagrams/groups';
import type { SeqLayout } from '../core/diagrams/sequence/layout';
import type { UsecaseNode as UsecaseNodeModel } from '../core/diagrams/usecase/model';
import type { Participant } from '../core/diagrams/sequence/model';
import type { LayoutState, NodeLayout } from '../core/document/schema';
import type { EdgeLabels } from '../core/layout/labels';
import type { ThemeColors } from '../core/theme';
import type { Point, Rect } from '../core/types';

export type UmlNodeData = {
  model: ClassNodeModel;
  layout: NodeLayout;
  canvas: LayoutState['canvas'];
  textStyles: LayoutState['textStyles'];
  theme: ThemeColors;
  /** 내용이 잘리지 않는 최소 크기 (NodeResizer 제한) */
  minSize: { w: number; h: number };
};
export type UmlNode = Node<UmlNodeData, 'umlClass'>;

export type UmlEdgeData = {
  edge: RelationEdge;
  points: Point[];
  labels: EdgeLabels;
  stroke: string;
  strokeWidth: number;
  labelColor: string;
  /** 관계 라벨 글꼴 (저장 단위 pt / 렌더 px) */
  centerFontPt: number;
  centerFontPx: number;
  endpointFontPx: number;
  background: string;
  /** 사용자가 꺾은 경유점 (없으면 자동 경로) */
  waypoints: Point[];
  /** 라벨 편집 가능 여부 (usecase include/extend 는 불가) */
  labelEditable: boolean;
};
export type UmlEdge = Edge<UmlEdgeData, 'uml'>;

/* ───────────── 시퀀스 다이어그램 ───────────── */

export type SeqParticipantData = {
  participant: Participant;
  layout: NodeLayout;
  canvas: LayoutState['canvas'];
  textStyles: LayoutState['textStyles'];
  theme: ThemeColors;
  minSize: { w: number; h: number };
};
export type SeqParticipantNode = Node<SeqParticipantData, 'seqParticipant'>;

export type SeqBodyData = {
  seq: SeqLayout;
  participants: Participant[];
  nodes: LayoutState['nodes'];
  canvas: LayoutState['canvas'];
  textStyles: LayoutState['textStyles'];
  edgeStyles: LayoutState['edgeStyles'];
  theme: ThemeColors;
  /** 본문 노드의 flow 좌표 원점 — 내부 좌표 = flow 좌표 - origin */
  origin: Point;
};
export type SeqBodyNode = Node<SeqBodyData, 'seqBody'>;

/* ───────────── 유스케이스 · 그룹 ───────────── */

export type UsecaseNodeData = {
  node: UsecaseNodeModel;
  layout: NodeLayout;
  canvas: LayoutState['canvas'];
  textStyles: LayoutState['textStyles'];
  theme: ThemeColors;
  minSize: { w: number; h: number };
};
export type UsecaseFlowNode = Node<UsecaseNodeData, 'usecase'>;

export type GroupNodeData = {
  group: DiagramGroup;
  rect: Rect;
  kind: 'class' | 'usecase';
  canvas: LayoutState['canvas'];
  textStyles: LayoutState['textStyles'];
  theme: ThemeColors;
};
export type GroupFlowNode = Node<GroupNodeData, 'umlGroup'>;
export const GROUP_NODE_PREFIX = 'group:';

export type AppNode = UmlNode | UsecaseFlowNode | GroupFlowNode | SeqParticipantNode | SeqBodyNode;
export const SEQ_BODY_ID = '__seq_body__';
