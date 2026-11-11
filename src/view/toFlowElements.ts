import type { ClassNodeModel } from '../core/diagrams/class/model';
import { groupBounds } from '../core/diagrams/groups';
import { measureShapes } from '../core/diagrams/measureShapes';
import type { DiagramModel, GraphDiagramModel } from '../core/diagrams/registry';
import type { UsecaseNode as UsecaseNodeModel } from '../core/diagrams/usecase/model';
import { styleKeys } from '../core/document/keys';
import type { LayoutState, NodeLayout } from '../core/document/schema';
import { placeLabels } from '../core/layout/labels';
import { ptToPx } from '../core/layout/measure';
import { computeRoutes } from '../core/layout/routing';
import type { ThemeColors } from '../core/theme';
import { TYPO } from '../core/theme';
import type { NodeId, Rect } from '../core/types';
import type { AppNode, GroupFlowNode, UmlEdge, UmlNode, UsecaseFlowNode } from './flowTypes';
import { GROUP_NODE_PREFIX } from './flowTypes';
import { toSequenceElements } from './toSequenceElements';

export interface FlowInput {
  model: DiagramModel | null;
  layout: LayoutState;
  selection: readonly NodeId[];
  theme: ThemeColors;
  /** 지금 드래그 중인 도형들. 있으면 그 도형에 붙은 간선만 다시 계산한다 (놓으면 전체를 정확히 다시 계산) */
  dragIds?: ReadonlySet<NodeId> | null;
}

/** 직전에 계산한 그래프 간선 결과 — 드래그 중 재사용용 */
let lastGraph: {
  model: GraphDiagramModel; canvas: LayoutState['canvas']; textStyles: LayoutState['textStyles'];
  edgeStyles: LayoutState['edgeStyles']; edgeWaypoints: LayoutState['edgeWaypoints']; theme: ThemeColors; edges: Map<string, UmlEdge>;
} | null = null;

/**
 * 도형 노드 객체 캐시: 입력이 같으면 같은 객체를 돌려줘 React Flow 가 해당 노드를 다시 렌더하지 않게 한다.
 * (드래그 중 매 프레임 전체 노드가 리렌더되는 것을 방지)
 */
const nodeCache = new WeakMap<object, { deps: unknown[]; node: AppNode }>();

function cached<T extends AppNode>(key: object, deps: unknown[], build: () => T): T {
  const hit = nodeCache.get(key);
  if (hit && hit.deps.length === deps.length && hit.deps.every((dep, index) => dep === deps[index])) return hit.node as T;
  const node = build();
  nodeCache.set(key, { deps, node });
  return node;
}

/** 다이어그램 종류별 React Flow 요소 변환 — 뷰 계산은 전부 여기서 한 번만 한다 */
export function toFlowElements(input: FlowInput): { nodes: AppNode[]; edges: UmlEdge[] } {
  const { model } = input;
  if (!model) return { nodes: [], edges: [] };
  if (model.kind === 'sequence') return toSequenceElements({ ...input, model });
  return toGraphElements({ ...input, model });
}

/** class·usecase 공통: 도형 + 그룹 상자 + 장애물 회피 경로 + 전역 라벨 배치 */
function toGraphElements(input: FlowInput & { model: GraphDiagramModel }): { nodes: AppNode[]; edges: UmlEdge[] } {
  const { model, layout, theme, selection, dragIds } = input;
  const minSizes = measureShapes(model, layout);
  const shapeDeps = (nodeLayout: NodeLayout, selected: boolean) => [nodeLayout, selected, layout.canvas, layout.textStyles, theme];

  const shapes: AppNode[] = [];
  const rects: Record<NodeId, Rect> = {};
  for (const shape of model.nodes as readonly (ClassNodeModel | UsecaseNodeModel)[]) {
    const nodeLayout = layout.nodes[shape.id];
    if (!nodeLayout) continue; // 배치 대기 중인 도형은 그리지 않는다 (좌표 0,0 에 튀는 현상 방지)
    rects[shape.id] = nodeLayout;
    const selected = selection.includes(shape.id);
    const min = minSizes[shape.id] ?? { w: 80, h: 40 };
    const common = {
      id: shape.id,
      position: { x: nodeLayout.x, y: nodeLayout.y },
      width: nodeLayout.w,
      height: nodeLayout.h,
      selected,
      zIndex: 2,
    };
    if (model.kind === 'class') {
      const classNode = shape as ClassNodeModel;
      shapes.push(cached<UmlNode>(classNode, shapeDeps(nodeLayout, selected), () => ({
        ...common,
        type: 'umlClass',
        data: { model: classNode, layout: nodeLayout, canvas: layout.canvas, textStyles: layout.textStyles, theme, minSize: { w: Math.min(min.w, TYPO.minWidth), h: min.h } },
      })));
    } else {
      const usecaseNode = shape as UsecaseNodeModel;
      shapes.push(cached<UsecaseFlowNode>(usecaseNode, shapeDeps(nodeLayout, selected), () => ({
        ...common,
        type: 'usecase',
        data: { node: usecaseNode, layout: nodeLayout, canvas: layout.canvas, textStyles: layout.textStyles, theme, minSize: { w: Math.min(min.w, 90), h: min.h } },
      })));
    }
  }

  // 그룹 상자: 구성원 도형으로부터 계산 (저장하지 않음)
  const groupNodes: GroupFlowNode[] = [];
  for (const group of model.groups) {
    const rect = groupBounds(group.members.map((id) => rects[id]).filter((value): value is Rect => value !== undefined));
    if (!rect) continue;
    const id = `${GROUP_NODE_PREFIX}${group.id}`;
    groupNodes.push({
      id,
      type: 'umlGroup',
      position: { x: rect.x, y: rect.y },
      width: rect.w,
      height: rect.h,
      selected: selection.includes(id),
      // 간선보다 아래. 상자 몸통은 클릭이 통과하고(안쪽 간선·도형 조작 가능) 라벨만 잡기/선택 손잡이
      zIndex: -1,
      style: { pointerEvents: 'none' },
      data: { group, rect, kind: model.kind, canvas: layout.canvas, textStyles: layout.textStyles, theme },
    });
  }

  const visibleEdges = model.edges.filter((edge) => rects[edge.source] && rects[edge.target]);

  // 드래그 중 근사 모드: 움직이는 도형에 붙은 간선만 다시 계산하고 나머지는 직전 결과를 재사용한다.
  // 입력(모델·스타일·꺾임점·테마)이 직전 계산과 같을 때만 쓰며, 드래그가 끝나면 dragIds 가 비어 전체를 정확히 다시 계산한다.
  const previous = lastGraph;
  const reusable = dragIds && dragIds.size > 0 && previous
    && previous.model === model && previous.canvas === layout.canvas && previous.textStyles === layout.textStyles
    && previous.edgeStyles === layout.edgeStyles && previous.edgeWaypoints === layout.edgeWaypoints && previous.theme === theme
    ? previous.edges : null;
  const affected = reusable
    ? visibleEdges.filter((edge) => dragIds!.has(edge.source) || dragIds!.has(edge.target) || !reusable.has(edge.id))
    : visibleEdges;
  const affectedIds = new Set(affected.map((edge) => edge.id));

  const routes = computeRoutes(visibleEdges, rects, {
    waypoints: layout.edgeWaypoints, direction: model.direction, ...(reusable ? { only: affectedIds } : {}),
  });
  const centerFontPt = (edgeId: string) => layout.textStyles[styleKeys.edgeLabel(edgeId)]?.fontSize ?? layout.canvas.fontSizePt;
  const endpointFontPt = (edgeId: string) => Math.max(8, centerFontPt(edgeId) + TYPO.endpointDeltaPt);
  const labels = placeLabels(affected, routes, rects, {
    center: (edgeId) => ptToPx(centerFontPt(edgeId)),
    endpoint: (edgeId) => ptToPx(endpointFontPt(edgeId)),
  });

  const edges: UmlEdge[] = [];
  for (const edge of visibleEdges) {
    if (reusable && !affectedIds.has(edge.id)) {
      const kept = reusable.get(edge.id);
      if (kept) edges.push(kept);
      continue;
    }
    const route = routes[edge.id];
    if (!route) continue;
    const edgeStyle = layout.edgeStyles[edge.id];
    const labelStyle = layout.textStyles[styleKeys.edgeLabel(edge.id)];
    const semantic = 'semantic' in edge && edge.semantic === true;
    edges.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'uml',
      focusable: false,
      selectable: false,
      data: {
        edge,
        points: route.points,
        labels: labels[edge.id] ?? {},
        stroke: edgeStyle?.stroke ?? theme.edgeStroke,
        strokeWidth: edgeStyle?.strokeWidth ?? 1.5,
        labelColor: labelStyle?.color ?? theme.edgeLabelText,
        centerFontPt: centerFontPt(edge.id),
        centerFontPx: ptToPx(centerFontPt(edge.id)),
        endpointFontPx: ptToPx(endpointFontPt(edge.id)),
        background: theme.labelBg,
        waypoints: layout.edgeWaypoints[edge.id] ?? [],
        labelEditable: !semantic,
      },
    });
  }
  lastGraph = {
    model, canvas: layout.canvas, textStyles: layout.textStyles, edgeStyles: layout.edgeStyles,
    edgeWaypoints: layout.edgeWaypoints, theme, edges: new Map(edges.map((edge) => [edge.id, edge])),
  };
  // 그룹 상자가 가장 아래 → 간선 → 도형 순으로 그려진다
  return { nodes: [...groupNodes, ...shapes], edges };
}
